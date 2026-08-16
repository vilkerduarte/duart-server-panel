/**
 * Operações de disco do NGINX, com rollback.
 *
 * O problema que este módulo existe para resolver: gravar um vhost, rodar
 * `nginx -t`, e retornar erro quando ele falha — sem desfazer a gravação.
 * O NGINX segue rodando com a configuração antiga em memória, então nada
 * parece errado; mas o `nginx -t` é global, então a partir dali qualquer
 * operação em qualquer site falha, e no próximo reboot o NGINX não sobe.
 *
 * Aqui nenhuma escrita chega ao disco sem que a validação tenha passado, ou
 * sem que o estado anterior tenha sido restaurado bit a bit.
 */

import fs from 'fs';
import path from 'path';
import { executeCommand } from './system';
import { writeFileAtomic, ensureDir, withFileLock } from './fsx';
import {
  ACME_WEBROOT,
  MAINTENANCE_DIR,
  SNIPPETS_DIR,
  CONF_D_DIR,
  SNIPPET_SSL,
  SNIPPET_ACME,
  SNIPPET_GZIP,
  SNIPPET_PROXY,
  CONF_RATELIMIT,
  generateSslSnippet,
  generateAcmeSnippet,
  generateGzipSnippet,
  generateProxySnippet,
  generateRateLimitConf,
} from './nginx';

export const NGINX_AVAILABLE = '/etc/nginx/sites-available';
export const NGINX_ENABLED = '/etc/nginx/sites-enabled';

/** Um único lock para todas as operações de NGINX: a validação é global. */
const NGINX_LOCK = '__nginx__';

export class NginxConfigError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(formatNginxError(detail));
    this.name = 'NginxConfigError';
    this.detail = detail;
  }
}

export function formatNginxError(output: string): string {
  if (!output) return 'nginx -t falhou sem mensagem';
  return output
    .split('\n')
    .filter(line => /emerg|error|warn/i.test(line) || line.includes('nginx:'))
    .map(line => line.replace(/^nginx:\s*/, '').replace(/\[(emerg|error|alert|crit|warn)\]\s*/i, '').trim())
    .filter(Boolean)
    .join(' | ')
    .substring(0, 600) || output.substring(0, 600);
}

/* ------------------------------------------------------------------ */
/*  Mutações de arquivo                                                */
/* ------------------------------------------------------------------ */

export type FileMutation =
  | { action: 'write'; path: string; content: string; mode?: number }
  | { action: 'delete'; path: string }
  | { action: 'symlink'; path: string; target: string };

interface Snapshot {
  path: string;
  existed: boolean;
  isSymlink: boolean;
  content: string | null;
  linkTarget: string | null;
  mode: number | null;
}

function snapshot(filePath: string): Snapshot {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return { path: filePath, existed: false, isSymlink: false, content: null, linkTarget: null, mode: null };
  }

  if (stat.isSymbolicLink()) {
    return {
      path: filePath,
      existed: true,
      isSymlink: true,
      content: null,
      linkTarget: fs.readlinkSync(filePath),
      mode: null,
    };
  }

  return {
    path: filePath,
    existed: true,
    isSymlink: false,
    content: fs.readFileSync(filePath, 'utf-8'),
    linkTarget: null,
    mode: stat.mode & 0o777,
  };
}

function restore(snap: Snapshot): void {
  try {
    if (fs.existsSync(snap.path) || isDanglingSymlink(snap.path)) {
      fs.rmSync(snap.path, { force: true });
    }
    if (!snap.existed) return;

    if (snap.isSymlink && snap.linkTarget) {
      fs.symlinkSync(snap.linkTarget, snap.path);
    } else if (snap.content !== null) {
      writeFileAtomic(snap.path, snap.content, snap.mode ?? 0o644);
    }
  } catch {
    // Restaurar é best-effort; o erro real já vai ser reportado ao usuário.
  }
}

function isDanglingSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function applyMutation(mutation: FileMutation): void {
  switch (mutation.action) {
    case 'write':
      ensureDir(path.dirname(mutation.path), 0o755);
      writeFileAtomic(mutation.path, mutation.content, mutation.mode ?? 0o644);
      break;
    case 'delete':
      if (fs.existsSync(mutation.path) || isDanglingSymlink(mutation.path)) {
        fs.rmSync(mutation.path, { force: true });
      }
      break;
    case 'symlink':
      if (fs.existsSync(mutation.path) || isDanglingSymlink(mutation.path)) {
        fs.rmSync(mutation.path, { force: true });
      }
      ensureDir(path.dirname(mutation.path), 0o755);
      fs.symlinkSync(mutation.target, mutation.path);
      break;
  }
}

/* ------------------------------------------------------------------ */
/*  Teste e reload                                                     */
/* ------------------------------------------------------------------ */

export async function nginxTest(): Promise<{ ok: boolean; output: string }> {
  const result = await executeCommand('nginx_test');
  return {
    ok: result.code === 0,
    output: result.stderr || result.stdout || '',
  };
}

export async function nginxReload(): Promise<{ ok: boolean; output: string }> {
  const result = await executeCommand('nginx_reload');
  if (result.code !== 0) {
    // `nginx -s reload` falha quando o master não está rodando; nesse caso um
    // start é o que o operador quer, não um erro.
    const start = await executeCommand('systemctl_start', ['nginx']);
    return { ok: start.code === 0, output: start.stderr || result.stderr || '' };
  }
  return { ok: true, output: '' };
}

/**
 * Aplica um conjunto de mutações e só as mantém se o `nginx -t` passar.
 *
 * As mutações são tratadas como uma unidade: ou todas ficam, ou nenhuma fica.
 * Isso importa porque criar um site mexe em dois caminhos (sites-available e o
 * symlink em sites-enabled) e deixar um sem o outro é um estado inválido.
 */
export async function applyNginxChanges(
  mutations: FileMutation[],
  options: { reload?: boolean } = {},
): Promise<void> {
  return withFileLock(NGINX_LOCK, async () => {
    ensureScaffoldSync();

    const snapshots = mutations.map(m => snapshot(m.path));

    try {
      for (const mutation of mutations) {
        applyMutation(mutation);
      }
    } catch (err) {
      for (const snap of snapshots) restore(snap);
      throw err;
    }

    const test = await nginxTest();
    if (!test.ok) {
      for (const snap of snapshots) restore(snap);
      // Confirma que a restauração devolveu o NGINX a um estado válido.
      const recheck = await nginxTest();
      if (!recheck.ok) {
        throw new NginxConfigError(
          `${test.output}\n[ATENÇÃO] A configuração continua inválida após o rollback. ` +
          `Verifique /etc/nginx manualmente ou execute duart-recover.`,
        );
      }
      throw new NginxConfigError(test.output);
    }

    if (options.reload !== false) {
      const reload = await nginxReload();
      if (!reload.ok) {
        for (const snap of snapshots) restore(snap);
        await nginxReload();
        throw new NginxConfigError(reload.output || 'Falha ao recarregar o NGINX');
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Estrutura de apoio                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cria snippets, webroot ACME e diretório de manutenção.
 *
 * Idempotente e barato: roda antes de qualquer aplicação de config para que um
 * `include` nunca aponte para arquivo inexistente — o que faria o `nginx -t`
 * falhar por um motivo que não tem nada a ver com a edição do usuário.
 */
export function ensureScaffoldSync(): void {
  ensureDir(SNIPPETS_DIR, 0o755);
  ensureDir(CONF_D_DIR, 0o755);
  ensureDir(ACME_WEBROOT + '/.well-known/acme-challenge', 0o755);
  ensureDir(MAINTENANCE_DIR, 0o755);

  const snippets: Array<[string, string]> = [
    [SNIPPET_SSL, generateSslSnippet()],
    [SNIPPET_ACME, generateAcmeSnippet()],
    [SNIPPET_GZIP, generateGzipSnippet()],
    [SNIPPET_PROXY, generateProxySnippet()],
  ];

  for (const [file, content] of snippets) {
    try {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
      if (current !== content) writeFileAtomic(file, content, 0o644);
    } catch {
      // Sem permissão de escrita em /etc/nginx: o erro aparece no nginx -t.
    }
  }

  try {
    if (!fs.existsSync(CONF_RATELIMIT)) {
      writeFileAtomic(CONF_RATELIMIT, generateRateLimitConf([]), 0o644);
    }
  } catch {}
}

/** Regrava as zonas de rate limit a partir dos sites gerenciados. */
export async function syncRateLimitZones(
  zones: Array<{ name: string; rate: string }>,
): Promise<void> {
  const content = generateRateLimitConf(zones);
  const current = fs.existsSync(CONF_RATELIMIT) ? fs.readFileSync(CONF_RATELIMIT, 'utf-8') : null;
  if (current === content) return;
  await applyNginxChanges([{ action: 'write', path: CONF_RATELIMIT, content, mode: 0o644 }]);
}

export function sitePaths(fileName: string): { available: string; enabled: string } {
  return {
    available: path.join(NGINX_AVAILABLE, fileName),
    enabled: path.join(NGINX_ENABLED, fileName),
  };
}

/** Um vhost está habilitado quando existe symlink correspondente em sites-enabled. */
export function isSiteEnabled(fileName: string): boolean {
  const { enabled } = sitePaths(fileName);
  try {
    fs.lstatSync(enabled);
    return true;
  } catch {
    return false;
  }
}
