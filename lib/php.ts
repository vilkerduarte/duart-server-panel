/**
 * Gestão de PHP: detecção de versões, pools FPM por site e limites de ini.
 *
 * Antes, toda a gestão de PHP era um `<select>` com quatro versões fixas
 * (8.0 a 8.3) que escrevia uma linha `fastcgi_pass`. No Ubuntu 25.10 — o alvo
 * declarado — o pacote dos repositórios é o php8.4-fpm, então todo site PHP
 * criado apontava para um socket inexistente e nascia em 502; e como o
 * `nginx -t` não valida socket, o painel reportava sucesso.
 *
 * Aqui as versões são lidas do sistema, e cada site ganha um pool próprio:
 * usuário dedicado, socket dedicado e limites dedicados. Sem isso todos os
 * sites rodam como www-data, compartilham os mesmos workers e conseguem ler
 * os arquivos uns dos outros.
 */

import fs from 'fs';
import path from 'path';
import { execFileSafe, executeCommand, needsSudo } from './system';

export const PHP_ETC = '/etc/php';
export const PHP_RUN = '/run/php';
export const POOL_PREFIX = 'duart-';

export interface PhpVersion {
  version: string;
  fpmInstalled: boolean;
  fpmActive: boolean;
  cliInstalled: boolean;
  defaultSocket: string | null;
  poolDir: string;
  isCliDefault: boolean;
  extensions: string[];
}

export interface PhpPoolConfig {
  domain: string;
  version: string;
  user: string;
  group: string;
  root: string;
  maxChildren?: number;
  startServers?: number;
  minSpareServers?: number;
  maxSpareServers?: number;
  memoryLimit?: string;
  uploadMaxFilesize?: string;
  postMaxSize?: string;
  maxExecutionTime?: number;
  maxInputVars?: number;
  openBasedir?: string[] | null;
  disableFunctions?: string[];
  allowUrlFopen?: boolean;
  displayErrors?: boolean;
  extraIni?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Detecção                                                           */
/* ------------------------------------------------------------------ */

function versionsFromEtc(): string[] {
  try {
    return fs.readdirSync(PHP_ETC)
      .filter(entry => /^\d+\.\d+$/.test(entry))
      .sort(compareVersions);
  } catch {
    return [];
  }
}

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

async function isServiceActive(unit: string): Promise<boolean> {
  const result = await executeCommand('systemctl_is_active', [unit]);
  return result.stdout.trim() === 'active';
}

async function cliDefaultVersion(): Promise<string | null> {
  const result = await executeCommand('php_version');
  if (result.code !== 0) return null;
  return result.stdout.match(/^PHP (\d+\.\d+)/)?.[1] ?? null;
}

async function extensionsFor(version: string): Promise<string[]> {
  const bin = `/usr/bin/php${version}`;
  if (!fs.existsSync(bin)) return [];
  const result = await execFileSafe(bin, ['-m'], { timeout: 10000 });
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('[') && !l.startsWith('Zend'));
}

/** Enumera as versões de PHP presentes no sistema e o estado de cada FPM. */
export async function detectPhpVersions(): Promise<PhpVersion[]> {
  const versions = versionsFromEtc();
  const cliDefault = await cliDefaultVersion();

  return Promise.all(
    versions.map(async (version): Promise<PhpVersion> => {
      const poolDir = path.join(PHP_ETC, version, 'fpm', 'pool.d');
      const fpmInstalled = fs.existsSync(path.join(PHP_ETC, version, 'fpm'));
      const defaultSocket = path.join(PHP_RUN, `php${version}-fpm.sock`);

      return {
        version,
        fpmInstalled,
        fpmActive: fpmInstalled ? await isServiceActive(`php${version}-fpm`) : false,
        cliInstalled: fs.existsSync(`/usr/bin/php${version}`),
        defaultSocket: fs.existsSync(defaultSocket) ? defaultSocket : null,
        poolDir,
        isCliDefault: cliDefault === version,
        extensions: await extensionsFor(version),
      };
    }),
  );
}

/** Versão preferida para um site novo: a mais recente com FPM de pé. */
export async function preferredPhpVersion(): Promise<string | null> {
  const versions = await detectPhpVersions();
  const usable = versions.filter(v => v.fpmActive) .sort((a, b) => compareVersions(a.version, b.version));
  if (usable.length) return usable[usable.length - 1].version;

  const installed = versions.filter(v => v.fpmInstalled).sort((a, b) => compareVersions(a.version, b.version));
  return installed.length ? installed[installed.length - 1].version : null;
}

/* ------------------------------------------------------------------ */
/*  Instalação                                                         */
/* ------------------------------------------------------------------ */

/** Extensões que praticamente todo projeto PHP pede. */
export const COMMON_EXTENSIONS = [
  'cli', 'fpm', 'common', 'mysql', 'pgsql', 'sqlite3',
  'gd', 'curl', 'mbstring', 'intl', 'zip', 'xml', 'bcmath',
  'opcache', 'redis', 'soap',
];

export function packagesFor(version: string, extensions: string[] = COMMON_EXTENSIONS): string[] {
  if (!/^\d+\.\d+$/.test(version)) throw new Error(`Versão PHP inválida: ${version}`);
  return extensions
    .filter(ext => /^[a-z0-9]+$/.test(ext))
    .map(ext => `php${version}-${ext}`);
}

export async function installPhp(
  version: string,
  extensions: string[] = COMMON_EXTENSIONS,
): Promise<{ ok: boolean; output: string }> {
  const packages = packagesFor(version, extensions);

  await executeCommand('apt_update', ['-qq']);
  const result = await executeCommand('apt_install', ['-qq', ...packages]);

  if (result.code !== 0) {
    return { ok: false, output: result.stderr || result.stdout };
  }

  await executeCommand('systemctl_enable', [`php${version}-fpm`, '--now']);
  return { ok: true, output: result.stdout };
}

/* ------------------------------------------------------------------ */
/*  Pools                                                              */
/* ------------------------------------------------------------------ */

export function poolName(domain: string): string {
  return `${POOL_PREFIX}${domain.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

export function poolSocketPath(domain: string): string {
  return path.join(PHP_RUN, `${poolName(domain)}.sock`);
}

export function poolConfigPath(version: string, domain: string): string {
  return path.join(PHP_ETC, version, 'fpm', 'pool.d', `${poolName(domain)}.conf`);
}

export function poolUserName(domain: string): string {
  // Nomes de usuário no Linux são limitados a 32 caracteres.
  const base = `web_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return base.substring(0, 31);
}

/**
 * Converte o `client_max_body_size` do NGINX para os limites equivalentes do
 * PHP. Ter os dois configuráveis em telas diferentes é a origem do "subo o
 * limite no NGINX e o upload continua falhando".
 */
export function phpSizeFromNginx(clientMaxBodySize?: string): string | null {
  if (!clientMaxBodySize) return null;
  const match = clientMaxBodySize.trim().match(/^(\d+)([kKmMgG]?)$/);
  if (!match) return null;
  const unit = match[2].toUpperCase() || 'M';
  return `${match[1]}${unit}`;
}

export const POOL_PRESETS: Record<string, Partial<PhpPoolConfig>> = {
  padrao: {
    maxChildren: 10,
    memoryLimit: '256M',
    uploadMaxFilesize: '32M',
    postMaxSize: '32M',
    maxExecutionTime: 30,
    maxInputVars: 1000,
  },
  wordpress: {
    maxChildren: 12,
    memoryLimit: '512M',
    uploadMaxFilesize: '128M',
    postMaxSize: '128M',
    maxExecutionTime: 120,
    maxInputVars: 3000,
  },
  laravel: {
    maxChildren: 12,
    memoryLimit: '512M',
    uploadMaxFilesize: '64M',
    postMaxSize: '64M',
    maxExecutionTime: 60,
    maxInputVars: 2000,
  },
  upload_pesado: {
    maxChildren: 8,
    memoryLimit: '1024M',
    uploadMaxFilesize: '1024M',
    postMaxSize: '1024M',
    maxExecutionTime: 600,
    maxInputVars: 5000,
  },
};

const DEFAULT_DISABLED_FUNCTIONS = [
  'exec', 'passthru', 'shell_exec', 'system', 'proc_open', 'popen',
  'pcntl_exec', 'dl',
];

export function generatePoolConfig(config: PhpPoolConfig): string {
  const name = poolName(config.domain);
  const socket = poolSocketPath(config.domain);
  const preset = POOL_PRESETS.padrao;

  const maxChildren = config.maxChildren ?? preset.maxChildren ?? 10;
  const startServers = config.startServers ?? Math.max(2, Math.floor(maxChildren / 4));
  const minSpare = config.minSpareServers ?? Math.max(1, Math.floor(maxChildren / 8));
  const maxSpare = config.maxSpareServers ?? Math.max(3, Math.floor(maxChildren / 2));

  const openBasedir = config.openBasedir === null
    ? null
    : (config.openBasedir?.length ? config.openBasedir : [config.root, '/tmp', '/usr/share/php']);

  const disabled = config.disableFunctions ?? DEFAULT_DISABLED_FUNCTIONS;

  const lines = [
    `; Duart Panel — pool dedicado para ${config.domain}`,
    '; Arquivo gerenciado pelo painel.',
    '',
    `[${name}]`,
    `user = ${config.user}`,
    `group = ${config.group}`,
    '',
    `listen = ${socket}`,
    'listen.owner = www-data',
    'listen.group = www-data',
    'listen.mode = 0660',
    '',
    'pm = dynamic',
    `pm.max_children = ${maxChildren}`,
    `pm.start_servers = ${startServers}`,
    `pm.min_spare_servers = ${minSpare}`,
    `pm.max_spare_servers = ${maxSpare}`,
    'pm.max_requests = 500',
    `pm.status_path = /${name}-status`,
    '',
    '; Diagnóstico de lentidão e 502',
    `slowlog = /var/log/php/${name}.slow.log`,
    'request_slowlog_timeout = 5s',
    'request_terminate_timeout = 120s',
    'catch_workers_output = yes',
    `php_admin_value[error_log] = /var/log/php/${name}.error.log`,
    'php_admin_flag[log_errors] = on',
    '',
    '; Limites',
    `php_admin_value[memory_limit] = ${config.memoryLimit ?? preset.memoryLimit}`,
    `php_admin_value[upload_max_filesize] = ${config.uploadMaxFilesize ?? preset.uploadMaxFilesize}`,
    `php_admin_value[post_max_size] = ${config.postMaxSize ?? preset.postMaxSize}`,
    `php_admin_value[max_execution_time] = ${config.maxExecutionTime ?? preset.maxExecutionTime}`,
    `php_admin_value[max_input_vars] = ${config.maxInputVars ?? preset.maxInputVars}`,
    `php_admin_flag[display_errors] = ${config.displayErrors ? 'on' : 'off'}`,
    `php_admin_flag[allow_url_fopen] = ${config.allowUrlFopen === false ? 'off' : 'on'}`,
  ];

  if (openBasedir) {
    lines.push('', '; Isolamento entre sites', `php_admin_value[open_basedir] = ${openBasedir.join(':')}`);
  }
  if (disabled.length) {
    lines.push(`php_admin_value[disable_functions] = ${disabled.join(',')}`);
  }
  lines.push(`php_admin_value[session.save_path] = /var/lib/php/sessions/${name}`);

  if (config.extraIni) {
    lines.push('', '; Ajustes adicionais');
    for (const [key, value] of Object.entries(config.extraIni)) {
      if (/^[a-zA-Z0-9_.]+$/.test(key)) {
        lines.push(`php_admin_value[${key}] = ${String(value).replace(/[\n\r]/g, '')}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Aplicação                                                          */
/* ------------------------------------------------------------------ */

/** Cria o usuário de sistema do site, se ainda não existir. */
export async function ensurePoolUser(domain: string, root: string): Promise<string> {
  const user = poolUserName(domain);
  const exists = await executeCommand('id_user', [user]);
  if (exists.code !== 0) {
    await executeCommand('useradd_system', ['--home-dir', root, user]);
  }
  return user;
}

function ensureRuntimeDirs(name: string): void {
  for (const dir of ['/var/log/php', `/var/lib/php/sessions/${name}`]) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    } catch {}
  }
}

export async function fpmTest(version: string): Promise<{ ok: boolean; output: string }> {
  const bin = `/usr/sbin/php-fpm${version}`;
  if (!fs.existsSync(bin)) return { ok: false, output: `php-fpm${version} não encontrado` };

  const { bin: cmd, args } = needsSudo()
    ? { bin: 'sudo', args: ['-n', bin, '-t'] }
    : { bin, args: ['-t'] };

  const result = await execFileSafe(cmd, args, { timeout: 15000 });
  return { ok: result.code === 0, output: result.stderr || result.stdout };
}

/**
 * Escreve o pool e recarrega o FPM, revertendo se a configuração for rejeitada.
 * Mesmo raciocínio do NGINX: um pool inválido no disco impede o serviço de
 * subir no próximo reboot, muito depois da edição que causou o problema.
 */
export async function applyPool(config: PhpPoolConfig): Promise<{ ok: boolean; socket: string; error?: string }> {
  const file = poolConfigPath(config.version, config.domain);
  const name = poolName(config.domain);
  const socket = poolSocketPath(config.domain);

  if (!fs.existsSync(path.dirname(file))) {
    return { ok: false, socket, error: `PHP ${config.version} não está instalado (${path.dirname(file)} não existe)` };
  }

  ensureRuntimeDirs(name);

  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  fs.writeFileSync(file, generatePoolConfig(config), { mode: 0o644 });

  const test = await fpmTest(config.version);
  if (!test.ok) {
    if (previous === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, previous, { mode: 0o644 });
    return { ok: false, socket, error: test.output };
  }

  const reload = await executeCommand('systemctl_reload', [`php${config.version}-fpm`]);
  if (reload.code !== 0) {
    const restart = await executeCommand('systemctl_restart', [`php${config.version}-fpm`]);
    if (restart.code !== 0) {
      if (previous === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, previous, { mode: 0o644 });
      await executeCommand('systemctl_restart', [`php${config.version}-fpm`]);
      return { ok: false, socket, error: restart.stderr || 'Falha ao recarregar o PHP-FPM' };
    }
  }

  return { ok: true, socket };
}

export async function removePool(version: string, domain: string): Promise<void> {
  const file = poolConfigPath(version, domain);
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    await executeCommand('systemctl_reload', [`php${version}-fpm`]);
  }
}

export function listPools(version: string): string[] {
  const dir = path.join(PHP_ETC, version, 'fpm', 'pool.d');
  try {
    return fs.readdirSync(dir).filter(f => f.startsWith(POOL_PREFIX) && f.endsWith('.conf'));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Diagnóstico                                                        */
/* ------------------------------------------------------------------ */

export interface PhpDiagnosis {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

/**
 * Diagnóstico de 502 em ordem de causa mais provável.
 * É a pergunta mais comum do módulo e a que o painel não sabia responder.
 */
export async function diagnosePhpSite(version: string, socket: string, root: string): Promise<PhpDiagnosis> {
  const checks: PhpDiagnosis['checks'] = [];

  const installed = fs.existsSync(path.join(PHP_ETC, version, 'fpm'));
  checks.push({
    name: `PHP ${version} instalado`,
    ok: installed,
    detail: installed ? `Encontrado em ${PHP_ETC}/${version}` : `Instale com: apt install php${version}-fpm`,
  });

  const active = await isServiceActive(`php${version}-fpm`);
  checks.push({
    name: `Serviço php${version}-fpm ativo`,
    ok: active,
    detail: active ? 'Rodando' : `Inicie com: systemctl start php${version}-fpm`,
  });

  const socketExists = fs.existsSync(socket);
  checks.push({
    name: 'Socket do pool existe',
    ok: socketExists,
    detail: socketExists ? socket : `${socket} não existe — o pool não subiu`,
  });

  if (socketExists) {
    let readable = false;
    try {
      fs.accessSync(socket, fs.constants.R_OK | fs.constants.W_OK);
      readable = true;
    } catch {}
    checks.push({
      name: 'Permissão do socket',
      ok: readable,
      detail: readable ? 'O NGINX consegue acessar' : 'Ajuste listen.owner/listen.group no pool',
    });
  }

  const rootExists = fs.existsSync(root);
  checks.push({
    name: 'Diretório do site existe',
    ok: rootExists,
    detail: rootExists ? root : `${root} não existe`,
  });

  return { ok: checks.every(c => c.ok), checks };
}

/** Últimas entradas do slowlog — onde aparecem as requisições que travam. */
export function readSlowLog(domain: string, lines = 100): string {
  const file = `/var/log/php/${poolName(domain)}.slow.log`;
  try {
    const content = fs.readFileSync(file, 'utf-8');
    return content.split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
