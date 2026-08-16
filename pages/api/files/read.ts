import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

const MAX_READ_SIZE = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.md', '.csv', '.toml',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.css', '.scss', '.html', '.htm',
  '.conf', '.cfg', '.ini', '.env', '.sh', '.bash', '.zsh', '.service', '.socket', '.timer',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs',
  '.sql', '.graphql', '.vue', '.svelte', '.lock', '.pem', '.crt', '.key',
]);

/** Arquivos de configuração sem extensão que o painel precisa abrir. */
const TEXT_BASENAMES = new Set([
  'Dockerfile', 'Makefile', 'nginx.conf', 'sshd_config', 'crontab',
  'hosts', 'fstab', 'requirements.txt', 'Procfile', 'default',
]);

function looksTextual(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (TEXT_BASENAMES.has(path.basename(filePath))) return true;
  // Vhosts do NGINX normalmente não têm extensão.
  return filePath.startsWith('/etc/nginx/sites-') || !ext;
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const filePath = (req.query.path as string) || '';
    if (!filePath) return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });

    const resolved = resolveSafePath(filePath, { allowedRoots: configuredRoots() });

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'O caminho é um diretório' });
    }
    if (stat.size > MAX_READ_SIZE) {
      return res.status(400).json({ success: false, error: 'Arquivo maior que 5MB' });
    }
    if (!looksTextual(resolved)) {
      return res.status(400).json({ success: false, error: 'Tipo de arquivo não suportado para leitura' });
    }

    const buffer = fs.readFileSync(resolved);
    // Um NUL no início é o sinal mais barato de binário.
    if (buffer.subarray(0, 8000).includes(0)) {
      return res.status(400).json({ success: false, error: 'O arquivo parece ser binário' });
    }

    return res.status(200).json({
      success: true,
      data: { path: resolved, content: buffer.toString('utf-8'), size: stat.size, encoding: 'utf-8' },
    });
  } catch (err) {
    return respondWithError(res, err);
  }
});
