/**
 * Helpers compartilhados pelas rotas de API.
 */

import type { NextApiResponse } from 'next';
import { PathAccessError } from './paths';
import { SiteError } from './sites';
import { NginxConfigError } from './nginx-ops';
import { readConfig } from './data/config';

/** Traduz exceções conhecidas em resposta HTTP com o status certo. */
export function respondWithError(res: NextApiResponse, err: unknown): void {
  if (err instanceof PathAccessError) {
    res.status(403).json({ success: false, error: err.message, code: err.code });
    return;
  }
  if (err instanceof NginxConfigError) {
    res.status(400).json({ success: false, error: `NGINX rejeitou a configuração: ${err.message}` });
    return;
  }
  if (err instanceof SiteError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  const notFound = /ENOENT/.test(message);
  const denied = /EACCES|EPERM/.test(message);

  res.status(notFound ? 404 : denied ? 403 : 500).json({
    success: false,
    error: notFound ? 'Arquivo ou diretório não encontrado' : denied ? 'Permissão negada pelo sistema de arquivos' : message,
  });
}

/** Raízes permitidas para o gerenciador de arquivos, conforme configuração. */
export function configuredRoots(): string[] | undefined {
  const roots = readConfig().fileManagerRoots;
  return roots?.length ? roots : undefined;
}

export function methodNotAllowed(res: NextApiResponse): void {
  res.status(405).json({ success: false, error: 'Método não permitido' });
}
