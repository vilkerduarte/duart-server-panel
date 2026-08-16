import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';
import { writeFileAtomic } from '@/lib/fsx';
import { unifiedDiff, describeDiff } from '@/lib/diff';

const MAX_WRITE_SIZE = 5 * 1024 * 1024;

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res);

  try {
    const { filePath, content, createDirs } = req.body ?? {};

    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'Caminho e conteúdo são obrigatórios' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Conteúdo deve ser texto' });
    }
    if (Buffer.byteLength(content) > MAX_WRITE_SIZE) {
      return res.status(413).json({ success: false, error: 'Conteúdo maior que 5MB' });
    }

    const resolved = resolveSafePath(filePath, { allowedRoots: configuredRoots() });
    const parent = path.dirname(resolved);

    if (!fs.existsSync(parent)) {
      // Criar a árvore de diretórios em silêncio esconde erro de digitação no caminho.
      if (!createDirs) {
        return res.status(400).json({
          success: false,
          error: `O diretório ${parent} não existe. Envie createDirs=true para criá-lo.`,
        });
      }
      resolveSafePath(parent, { allowedRoots: configuredRoots() });
      fs.mkdirSync(parent, { recursive: true });
    }

    const before = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : '';
    const mode = fs.existsSync(resolved) ? (fs.statSync(resolved).mode & 0o777) : 0o644;

    writeFileAtomic(resolved, content, mode);

    const diff = unifiedDiff(before, content, { fromLabel: resolved, toLabel: resolved });

    return res.status(200).json({
      success: true,
      data: { written: true, path: resolved, bytes: Buffer.byteLength(content), changes: describeDiff(diff) },
    });
  } catch (err) {
    return respondWithError(res, err);
  }
});
