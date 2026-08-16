/**
 * Auto-modificação do painel.
 *
 * O modo irrestrito permite que a IA edite o próprio código do Duart Panel.
 * O risco específico dessa operação não é ela quebrar um site — é ela quebrar
 * a interface que você usaria para consertar o site.
 *
 * A sequência aqui existe para que isso não seja terminal:
 *
 *   snapshot → typecheck → build → reinício agendado → verificação → reversão
 *
 * Nenhuma dessas etapas pede aprovação; elas não são portões, são rede. O
 * reinício é agendado num timer transitório para que a resposta HTTP saia antes
 * de o processo morrer, e um segundo timer confere a saúde do painel e restaura
 * o snapshot se ele não voltar.
 */

import fs from 'fs';
import path from 'path';
import { execFileSafe, executeCommand } from '../system';
import { readConfig } from '../data/config';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
export const SNAPSHOT_DIR = path.join(DATA_DIR, 'backups', 'panel');
export const SERVICE_NAME = 'duart-panel';

/**
 * Raiz do projeto.
 *
 * Não dá para derivar de `__dirname`: em produção este arquivo vive dentro de
 * um chunk em `.next/server`, e a profundidade do caminho varia com o bundler.
 * Um erro aqui faria o snapshot arquivar o diretório errado — exatamente
 * quando ele mais importa.
 *
 * A unit do systemd define `WorkingDirectory` na raiz do projeto, então
 * `process.cwd()` é a fonte certa; a presença do package.json confirma.
 */
export function projectRoot(): string {
  const candidates = [
    process.env.PANEL_ROOT,
    process.cwd(),
    '/opt/duart-panel',
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === 'duart-panel') return dir;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Não foi possível localizar a raiz do painel. Defina PANEL_ROOT na unit do systemd.',
  );
}

export interface SnapshotResult {
  ok: boolean;
  file?: string;
  error?: string;
}

/**
 * Copia o código do painel para um tar.gz.
 *
 * Não usa git de propósito: o repositório pode estar sujo, num detached HEAD ou
 * simplesmente ausente numa instalação feita por cópia de arquivos. Um tar do
 * estado atual funciona nos três casos.
 */
export async function snapshotPanel(label = 'auto'): Promise<SnapshotResult> {
  const root = projectRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(SNAPSHOT_DIR, `panel-${label}-${stamp}.tar.gz`);

  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const result = await execFileSafe('tar', [
      'czf', file,
      '-C', root,
      '--exclude=./node_modules',
      '--exclude=./.next',
      '--exclude=./.git',
      '--exclude=./data',
      '--exclude=./tsconfig.tsbuildinfo',
      '.',
    ], { timeout: 180000 });

    if (result.code !== 0 && !fs.existsSync(file)) {
      return { ok: false, error: result.stderr || 'tar falhou' };
    }

    await pruneSnapshots();
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Mantém os 10 snapshots mais recentes; o resto é ruído em disco. */
async function pruneSnapshots(keep = 10): Promise<void> {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.startsWith('panel-') && f.endsWith('.tar.gz'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(SNAPSHOT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const file of files.slice(keep)) {
      fs.rmSync(path.join(SNAPSHOT_DIR, file.name), { force: true });
    }
  } catch {}
}

export function listSnapshots(): Array<{ file: string; createdAt: string; sizeMb: number }> {
  try {
    return fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.startsWith('panel-') && f.endsWith('.tar.gz'))
      .map(f => {
        const full = path.join(SNAPSHOT_DIR, f);
        const stat = fs.statSync(full);
        return {
          file: full,
          createdAt: stat.mtime.toISOString(),
          sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function restoreSnapshot(file: string): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(file)) return { ok: false, error: `Snapshot não encontrado: ${file}` };

  const result = await execFileSafe('tar', ['xzf', file, '-C', projectRoot()], { timeout: 180000 });
  return result.code === 0
    ? { ok: true }
    : { ok: false, error: result.stderr || 'Falha ao restaurar' };
}

/* ------------------------------------------------------------------ */
/*  Validação                                                          */
/* ------------------------------------------------------------------ */

export interface CheckResult {
  ok: boolean;
  step: 'typecheck' | 'build' | 'nenhum';
  output: string;
}

/**
 * Typecheck e build antes de reiniciar.
 *
 * O typecheck vem primeiro por ser ~10x mais rápido: quando a IA quebra um
 * tipo, o erro aparece em segundos em vez de depois do build inteiro.
 */
export async function validatePanelBuild(): Promise<CheckResult> {
  const root = projectRoot();

  const typecheck = await execFileSafe('npx', ['tsc', '--noEmit'], { timeout: 300000, cwd: root });
  if (typecheck.code !== 0) {
    return { ok: false, step: 'typecheck', output: (typecheck.stdout || typecheck.stderr).slice(-6000) };
  }

  const build = await execFileSafe('npm', ['run', 'build'], { timeout: 900000, cwd: root });
  if (build.code !== 0) {
    return { ok: false, step: 'build', output: (build.stdout || build.stderr).slice(-6000) };
  }

  return { ok: true, step: 'nenhum', output: 'typecheck e build passaram' };
}

/* ------------------------------------------------------------------ */
/*  Reinício com rede de segurança                                     */
/* ------------------------------------------------------------------ */

function healthcheckScript(): string {
  return path.join(projectRoot(), 'scripts', 'panel-healthcheck.sh');
}

/**
 * Agenda o reinício e a verificação subsequente.
 *
 * O reinício precisa ser adiado alguns segundos: quem está executando este
 * código é o próprio processo que vai morrer, e a resposta HTTP ainda não saiu.
 */
export async function scheduleRestartWithRollback(
  snapshotFile: string,
  options: { delaySeconds?: number; healthDelaySeconds?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const delay = options.delaySeconds ?? 3;
  const healthDelay = options.healthDelaySeconds ?? 25;
  const port = readConfig().port || 3000;
  const script = healthcheckScript();

  if (!fs.existsSync(script)) {
    return { ok: false, error: `Script de verificação ausente: ${script}` };
  }
  try {
    fs.chmodSync(script, 0o755);
  } catch {}

  const restart = await execFileSafe('systemd-run', [
    `--unit=duart-self-restart`,
    `--on-active=${delay}`,
    '--timer-property=AccuracySec=1s',
    '--collect',
    '--description=Duart Panel: reinício após auto-atualização',
    '--',
    'systemctl', 'restart', SERVICE_NAME,
  ], { timeout: 15000 });

  if (restart.code !== 0) {
    return { ok: false, error: restart.stderr || 'Falha ao agendar o reinício' };
  }

  // A verificação roda depois do reinício e reverte se o painel não voltar.
  const health = await execFileSafe('systemd-run', [
    `--unit=duart-self-healthcheck`,
    `--on-active=${healthDelay}`,
    '--timer-property=AccuracySec=1s',
    '--collect',
    '--description=Duart Panel: verificação pós-atualização',
    '--',
    'bash', script, snapshotFile, String(port), projectRoot(),
  ], { timeout: 15000 });

  if (health.code !== 0) {
    return { ok: false, error: `Reinício agendado, mas a verificação não: ${health.stderr}` };
  }

  return { ok: true };
}

/** Cancela a reversão agendada — usado quando o painel confirma que voltou bem. */
export async function cancelScheduledRollback(): Promise<void> {
  for (const unit of ['duart-self-healthcheck.timer', 'duart-self-healthcheck.service']) {
    await executeCommand('systemctl_stop', [unit]).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Operação completa                                                  */
/* ------------------------------------------------------------------ */

export interface SelfUpdateResult {
  ok: boolean;
  snapshot?: string;
  validation?: CheckResult;
  restartScheduled?: boolean;
  error?: string;
}

/**
 * Valida as alterações já gravadas no código do painel e, se passarem,
 * agenda o reinício com reversão automática.
 *
 * Chame depois de escrever os arquivos — esta função não edita nada.
 */
export async function applySelfUpdate(
  options: { restart?: boolean; label?: string } = {},
): Promise<SelfUpdateResult> {
  const snapshot = await snapshotPanel(options.label ?? 'self-update');
  if (!snapshot.ok || !snapshot.file) {
    return { ok: false, error: `Não foi possível criar o snapshot: ${snapshot.error}. Abortado antes de qualquer build.` };
  }

  const validation = await validatePanelBuild();
  if (!validation.ok) {
    return {
      ok: false,
      snapshot: snapshot.file,
      validation,
      error: `O ${validation.step} falhou — o painel NÃO foi reiniciado e segue rodando o código anterior em memória. ` +
        `Corrija os erros e chame novamente.\n\n${validation.output}`,
    };
  }

  if (options.restart === false) {
    return { ok: true, snapshot: snapshot.file, validation, restartScheduled: false };
  }

  const scheduled = await scheduleRestartWithRollback(snapshot.file);
  if (!scheduled.ok) {
    return { ok: false, snapshot: snapshot.file, validation, error: scheduled.error };
  }

  return { ok: true, snapshot: snapshot.file, validation, restartScheduled: true };
}
