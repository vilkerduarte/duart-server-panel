/**
 * Gestão de aplicações Python.
 *
 * Antes, o único suporte a Python no painel era `python3` como opção de
 * interpretador do PM2. Isso falha para qualquer aplicação real: o Python do
 * sistema no Ubuntu 25.10 é PEP 668 (`externally-managed`), então `pip install`
 * é recusado sem venv; o PM2 não sabe fazer reload gracioso de WSGI/ASGI, então
 * todo deploy derruba conexões; e não há gestão de workers nem de ambiente.
 *
 * Aqui cada app tem venv próprio, roda sob gunicorn e é supervisionada pelo
 * systemd — que é o supervisor nativo do Ubuntu, sobrevive a reboot sem
 * depender do PATH do nvm, e entrega os logs no journal.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSafe, executeCommand } from './system';
import { readJson, writeJson, ensureDir, updateJson } from './fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
export const PYTHON_DATA_DIR = path.join(DATA_DIR, 'python');
export const APPS_FILE = path.join(PYTHON_DATA_DIR, 'apps.json');
export const ENV_DIR = path.join(PYTHON_DATA_DIR, 'env');
export const SYSTEMD_DIR = '/etc/systemd/system';
export const SOCKET_DIR = '/run/duart';
export const UNIT_PREFIX = 'duart-';

export type PythonFramework = 'wsgi' | 'asgi';

export interface PythonApp {
  id: string;
  name: string;
  directory: string;
  /** Ex.: "app:app" (Flask/FastAPI) ou "meuprojeto.wsgi:application" (Django). */
  module: string;
  framework: PythonFramework;
  pythonBin: string;
  venvPath: string;
  workers: number;
  threads?: number;
  timeout?: number;
  user: string;
  group: string;
  env: Record<string, string>;
  extraArgs?: string[];
  autoStart: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface PythonVersion {
  version: string;
  bin: string;
  hasVenv: boolean;
}

/* ------------------------------------------------------------------ */
/*  Detecção                                                           */
/* ------------------------------------------------------------------ */

export async function detectPythonVersions(): Promise<PythonVersion[]> {
  const found: PythonVersion[] = [];
  let entries: string[] = [];

  try {
    entries = fs.readdirSync('/usr/bin').filter(f => /^python3(\.\d+)?$/.test(f));
  } catch {
    return found;
  }

  for (const entry of Array.from(new Set(entries)).sort()) {
    const bin = path.join('/usr/bin', entry);
    const result = await execFileSafe(bin, ['--version'], { timeout: 5000 });
    if (result.code !== 0) continue;

    const version = (result.stdout || result.stderr).match(/Python (\d+\.\d+\.\d+)/)?.[1];
    if (!version) continue;

    const venvCheck = await execFileSafe(bin, ['-c', 'import venv'], { timeout: 5000 });
    found.push({ version, bin, hasVenv: venvCheck.code === 0 });
  }

  return found;
}

/** `uv` é bem mais rápido que venv+pip; usa quando estiver disponível. */
export async function hasUv(): Promise<boolean> {
  const result = await execFileSafe('which', ['uv'], { timeout: 5000 });
  return result.code === 0 && Boolean(result.stdout);
}

/* ------------------------------------------------------------------ */
/*  Ambiente virtual                                                   */
/* ------------------------------------------------------------------ */

export function venvPathFor(directory: string): string {
  return path.join(directory, '.venv');
}

export function venvBin(venvPath: string, program: string): string {
  return path.join(venvPath, 'bin', program);
}

export async function createVenv(
  directory: string,
  pythonBin: string,
): Promise<{ ok: boolean; venvPath: string; output: string }> {
  const venvPath = venvPathFor(directory);

  if (fs.existsSync(venvBin(venvPath, 'python'))) {
    return { ok: true, venvPath, output: 'Ambiente virtual já existia' };
  }
  if (!fs.existsSync(directory)) {
    return { ok: false, venvPath, output: `Diretório não encontrado: ${directory}` };
  }

  if (await hasUv()) {
    const result = await execFileSafe('uv', ['venv', '--python', pythonBin, venvPath], { timeout: 120000 });
    if (result.code === 0) return { ok: true, venvPath, output: result.stdout || 'venv criado com uv' };
  }

  const result = await execFileSafe(pythonBin, ['-m', 'venv', venvPath], { timeout: 180000 });
  return {
    ok: result.code === 0,
    venvPath,
    output: result.code === 0 ? 'Ambiente virtual criado' : (result.stderr || result.stdout),
  };
}

/**
 * Instala dependências e garante o gunicorn no venv.
 * Sem gunicorn instalado dentro do venv, o ExecStart da unit aponta para um
 * binário inexistente e o serviço entra em loop de restart.
 */
export async function installDependencies(
  app: Pick<PythonApp, 'directory' | 'venvPath' | 'framework'>,
): Promise<{ ok: boolean; output: string }> {
  const pip = venvBin(app.venvPath, 'pip');
  if (!fs.existsSync(pip)) {
    return { ok: false, output: 'pip não encontrado no ambiente virtual' };
  }

  const logs: string[] = [];

  const requirements = path.join(app.directory, 'requirements.txt');
  const pyproject = path.join(app.directory, 'pyproject.toml');

  if (fs.existsSync(requirements)) {
    const result = await execFileSafe(pip, ['install', '-r', requirements], { timeout: 600000, cwd: app.directory });
    logs.push(result.stdout || result.stderr);
    if (result.code !== 0) return { ok: false, output: logs.join('\n') };
  } else if (fs.existsSync(pyproject)) {
    const result = await execFileSafe(pip, ['install', '.'], { timeout: 600000, cwd: app.directory });
    logs.push(result.stdout || result.stderr);
    if (result.code !== 0) return { ok: false, output: logs.join('\n') };
  }

  const serverPackages = app.framework === 'asgi' ? ['gunicorn', 'uvicorn[standard]'] : ['gunicorn'];
  const result = await execFileSafe(pip, ['install', ...serverPackages], { timeout: 600000, cwd: app.directory });
  logs.push(result.stdout || result.stderr);

  return { ok: result.code === 0, output: logs.join('\n') };
}

/** Executa um comando dentro do venv — migrations, collectstatic, shell. */
export async function runInVenv(
  app: Pick<PythonApp, 'directory' | 'venvPath'>,
  argv: string[],
  timeout = 300000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  if (!argv.length) return { ok: false, stdout: '', stderr: 'Comando vazio' };

  const [program, ...args] = argv;
  const local = venvBin(app.venvPath, program);
  const bin = fs.existsSync(local) ? local : program;

  const result = await execFileSafe(bin, args, {
    timeout,
    cwd: app.directory,
    env: {
      ...process.env,
      PATH: `${path.join(app.venvPath, 'bin')}:${process.env.PATH ?? ''}`,
      VIRTUAL_ENV: app.venvPath,
    },
  });

  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

/* ------------------------------------------------------------------ */
/*  systemd                                                            */
/* ------------------------------------------------------------------ */

export function unitName(app: Pick<PythonApp, 'name'>): string {
  return `${UNIT_PREFIX}${app.name}.service`;
}

export function socketPathFor(app: Pick<PythonApp, 'name'>): string {
  return path.join(SOCKET_DIR, `${app.name}.sock`);
}

export function envFilePath(app: Pick<PythonApp, 'id'>): string {
  return path.join(ENV_DIR, `${app.id}.env`);
}

export function isValidAppName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,30}$/.test(name);
}

export function generateSystemdUnit(app: PythonApp): string {
  const gunicorn = venvBin(app.venvPath, 'gunicorn');
  const socket = socketPathFor(app);

  const args = [
    '--workers', String(app.workers),
    '--bind', `unix:${socket}`,
    // 007 deixa o socket em 0770 com grupo www-data: o NGINX conecta, o resto não.
    '--umask', '007',
    '--timeout', String(app.timeout ?? 60),
    '--graceful-timeout', '30',
    '--access-logfile', '-',
    '--error-logfile', '-',
  ];

  if (app.framework === 'asgi') {
    args.push('--worker-class', 'uvicorn.workers.UvicornWorker');
  } else if (app.threads && app.threads > 1) {
    args.push('--threads', String(app.threads));
  }

  if (app.extraArgs?.length) {
    args.push(...app.extraArgs.filter(a => /^[-a-zA-Z0-9_.:=/,]+$/.test(a)));
  }

  args.push(app.module);

  return `# Duart Panel — ${app.name}
# Arquivo gerenciado pelo painel.

[Unit]
Description=Duart Panel — aplicação Python ${app.name}
After=network.target
PartOf=duart-apps.target

[Service]
Type=simple
User=${app.user}
Group=${app.group}
WorkingDirectory=${app.directory}
RuntimeDirectory=duart
RuntimeDirectoryMode=0755
Environment="PATH=${path.join(app.venvPath, 'bin')}:/usr/local/bin:/usr/bin:/bin"
Environment="PYTHONUNBUFFERED=1"
EnvironmentFile=-${envFilePath(app)}
ExecStart=${gunicorn} ${args.join(' ')}
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=15

# Endurecimento
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${app.directory}

[Install]
WantedBy=multi-user.target
`;
}

/** Variáveis de ambiente em arquivo 0600 — segredo não vai para a unit. */
export function writeEnvFile(app: PythonApp): void {
  ensureDir(ENV_DIR, 0o700);
  const lines = Object.entries(app.env || {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `${key}=${String(value).replace(/[\n\r]/g, '')}`);
  fs.writeFileSync(envFilePath(app), lines.join('\n') + '\n', { mode: 0o600 });
}

export async function ensureAppUser(app: Pick<PythonApp, 'user' | 'directory'>): Promise<void> {
  if (app.user === 'root' || app.user === 'www-data') return;
  const exists = await executeCommand('id_user', [app.user]);
  if (exists.code !== 0) {
    await executeCommand('useradd_system', ['--home-dir', app.directory, app.user]);
  }
}

/**
 * Escreve a unit, recarrega o systemd e sobe o serviço.
 * Em falha, remove a unit e devolve as últimas linhas do journal — que é onde
 * o motivo real aparece.
 */
export async function applyApp(app: PythonApp): Promise<{ ok: boolean; error?: string }> {
  const unit = unitName(app);
  const unitPath = path.join(SYSTEMD_DIR, unit);

  if (!fs.existsSync(venvBin(app.venvPath, 'gunicorn'))) {
    return { ok: false, error: 'gunicorn não está instalado no ambiente virtual. Instale as dependências primeiro.' };
  }

  await ensureAppUser(app);
  writeEnvFile(app);

  const previous = fs.existsSync(unitPath) ? fs.readFileSync(unitPath, 'utf-8') : null;
  fs.writeFileSync(unitPath, generateSystemdUnit(app), { mode: 0o644 });

  await executeCommand('systemctl_daemon_reload');

  const enable = await executeCommand('systemctl_enable', [unit, '--now']);
  if (enable.code !== 0) {
    const restart = await executeCommand('systemctl_restart', [unit]);
    if (restart.code !== 0) {
      const logs = await appLogs(app, 30);
      if (previous === null) fs.rmSync(unitPath, { force: true });
      else fs.writeFileSync(unitPath, previous, { mode: 0o644 });
      await executeCommand('systemctl_daemon_reload');
      return { ok: false, error: `${restart.stderr || 'Falha ao iniciar o serviço'}\n\n${logs}` };
    }
  }

  return { ok: true };
}

export async function restartApp(app: PythonApp): Promise<{ ok: boolean; output: string }> {
  const result = await executeCommand('systemctl_restart', [unitName(app)]);
  return { ok: result.code === 0, output: result.stderr || result.stdout };
}

/** Reload gracioso: SIGHUP no gunicorn troca workers sem derrubar conexão. */
export async function reloadApp(app: PythonApp): Promise<{ ok: boolean; output: string }> {
  const result = await executeCommand('systemctl_reload', [unitName(app)]);
  return { ok: result.code === 0, output: result.stderr || result.stdout };
}

export async function stopApp(app: PythonApp): Promise<{ ok: boolean; output: string }> {
  const result = await executeCommand('systemctl_stop', [unitName(app)]);
  return { ok: result.code === 0, output: result.stderr || result.stdout };
}

export async function removeApp(app: PythonApp): Promise<void> {
  const unit = unitName(app);
  await executeCommand('systemctl_disable', [unit, '--now']);
  fs.rmSync(path.join(SYSTEMD_DIR, unit), { force: true });
  fs.rmSync(envFilePath(app), { force: true });
  await executeCommand('systemctl_daemon_reload');
}

export interface AppStatus {
  active: boolean;
  enabled: boolean;
  state: string;
  socketExists: boolean;
}

export async function appStatus(app: PythonApp): Promise<AppStatus> {
  const unit = unitName(app);
  const [active, enabled] = await Promise.all([
    executeCommand('systemctl_is_active', [unit]),
    executeCommand('systemctl_is_enabled', [unit]),
  ]);

  return {
    active: active.stdout.trim() === 'active',
    enabled: enabled.stdout.trim() === 'enabled',
    state: active.stdout.trim() || 'unknown',
    socketExists: fs.existsSync(socketPathFor(app)),
  };
}

export async function appLogs(app: Pick<PythonApp, 'name'>, lines = 200): Promise<string> {
  const result = await executeCommand('journalctl', ['-u', unitName(app), '-n', String(lines), '--no-pager']);
  return result.stdout || result.stderr;
}

/* ------------------------------------------------------------------ */
/*  Registro                                                           */
/* ------------------------------------------------------------------ */

interface AppsFile {
  apps: PythonApp[];
}

export function readApps(): PythonApp[] {
  ensureDir(PYTHON_DATA_DIR);
  return readJson<AppsFile>(APPS_FILE, { apps: [] }).apps;
}

export function writeApps(apps: PythonApp[]): void {
  ensureDir(PYTHON_DATA_DIR);
  writeJson(APPS_FILE, { apps });
}

export function updateApps(mutate: (apps: PythonApp[]) => PythonApp[]): Promise<AppsFile> {
  ensureDir(PYTHON_DATA_DIR);
  return updateJson<AppsFile>(APPS_FILE, { apps: [] }, current => ({ apps: mutate(current.apps) }));
}

/** Workers padrão do gunicorn: 2 × núcleos + 1, com teto para não estourar RAM. */
export function suggestedWorkers(): number {
  const cores = os.cpus().length || 1;
  return Math.min(2 * cores + 1, 12);
}
