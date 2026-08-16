/**
 * Jaula do gerenciador de arquivos.
 *
 * `path.resolve('/', filePath)` normaliza o caminho, mas não restringe nada —
 * o comentário "Security: resolve and validate path" descrevia uma validação
 * que não existia. Rodando como root, isso dava leitura e escrita em
 * /etc/shadow, /root/.ssh/authorized_keys e no próprio users.json do painel.
 *
 * Duas camadas aqui: uma lista de raízes permitidas (configurável) e uma lista
 * de negação que vale mesmo dentro de raiz permitida. A resolução passa por
 * realpath do ancestral existente, senão um symlink atravessa a jaula.
 */

import fs from 'fs';
import path from 'path';

export const DEFAULT_ALLOWED_ROOTS = [
  '/var/www',
  '/srv',
  '/opt',
  '/home',
  '/etc/nginx',
  '/etc/php',
  '/var/log',
  '/var/lib/duart-panel/nginx',
  '/var/lib/duart-panel/backups',
];

/**
 * Negado sempre, mesmo sob raiz permitida.
 * Escrever em qualquer um destes é escalada de privilégio ou perda de acesso
 * ao próprio painel.
 */
export const DENIED_PREFIXES = [
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/ssh/ssh_host_',
  '/root/.ssh',
  '/root/.bashrc',
  '/root/.profile',
  '/var/lib/duart-panel/auth',
  '/var/lib/duart-panel/ai',
  '/etc/letsencrypt/archive',
  '/etc/letsencrypt/keys',
  '/proc',
  '/sys',
  '/dev',
];

export class PathAccessError extends Error {
  readonly code: 'OUTSIDE_ROOTS' | 'DENIED' | 'INVALID';
  constructor(code: PathAccessError['code'], message: string) {
    super(message);
    this.name = 'PathAccessError';
    this.code = code;
  }
}

/**
 * Raízes passam pela mesma resolução dos candidatos.
 *
 * Comparar um caminho já resolvido por realpath contra uma raiz não resolvida
 * quebra sempre que algum ancestral é symlink — e uma raiz ainda inexistente
 * (criada no primeiro uso) não pode ser resolvida diretamente.
 */
function normalizeRoot(root: string): string {
  return realResolve(root);
}

/** Um caminho está sob uma raiz quando é a própria raiz ou um descendente dela. */
function isUnder(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/**
 * Resolve o caminho seguindo symlinks até onde ele existe.
 * Para um arquivo ainda inexistente, resolve o diretório pai mais próximo que
 * exista — é lá que a escrita vai acontecer de fato.
 */
export function realResolve(input: string): string {
  const resolved = path.resolve('/', input);

  let current = resolved;
  const tail: string[] = [];

  while (current !== '/') {
    if (fs.existsSync(current)) {
      try {
        return path.join(fs.realpathSync(current), ...tail.reverse());
      } catch {
        return resolved;
      }
    }
    tail.push(path.basename(current));
    current = path.dirname(current);
  }

  return resolved;
}

export interface JailOptions {
  allowedRoots?: string[];
  /** Escrita usa a mesma jaula, mas a lista de negação pesa mais. */
  write?: boolean;
}

/**
 * Valida e devolve o caminho canônico, ou lança.
 * Sempre use o valor retornado — não o caminho original — nas operações de fs.
 */
export function resolveSafePath(input: string, options: JailOptions = {}): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PathAccessError('INVALID', 'Caminho é obrigatório');
  }
  if (input.includes('\0')) {
    throw new PathAccessError('INVALID', 'Caminho inválido');
  }

  const normalized = path.resolve('/', input);
  const resolved = realResolve(input);

  // A lista de negação é conferida contra as duas formas: a normalizada pega o
  // caminho digitado direto, e a resolvida pega um symlink apontando para ele.
  for (const denied of DENIED_PREFIXES) {
    const deniedResolved = realResolve(denied);
    for (const candidate of [normalized, resolved]) {
      if (candidate === denied || isUnder(candidate, denied)
        || candidate === deniedResolved || isUnder(candidate, deniedResolved)) {
        throw new PathAccessError('DENIED', `Acesso bloqueado a ${denied} por segurança`);
      }
    }
  }

  const roots = (options.allowedRoots?.length ? options.allowedRoots : DEFAULT_ALLOWED_ROOTS).map(normalizeRoot);

  if (!roots.some(root => isUnder(resolved, root))) {
    throw new PathAccessError(
      'OUTSIDE_ROOTS',
      `Caminho fora dos diretórios permitidos. Permitidos: ${roots.join(', ')}`,
    );
  }

  return resolved;
}

/** Versão que não lança — útil para listagens que apenas ocultam o inacessível. */
export function isPathAllowed(input: string, options: JailOptions = {}): boolean {
  try {
    resolveSafePath(input, options);
    return true;
  } catch {
    return false;
  }
}

/** Raízes existentes, para a UI oferecer atalhos de navegação. */
export function listAccessibleRoots(allowedRoots?: string[]): string[] {
  const roots = allowedRoots?.length ? allowedRoots : DEFAULT_ALLOWED_ROOTS;
  return roots.filter(root => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}
