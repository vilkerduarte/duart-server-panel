import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'DELETE') return methodNotAllowed(res);

  try {
    const { filePath, recursive } = req.body ?? {};
    if (!filePath) return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });

    const resolved = resolveSafePath(filePath, { allowedRoots: configuredRoots() });
    const stat = fs.lstatSync(resolved);

    if (stat.isDirectory() && !recursive) {
      const entries = fs.readdirSync(resolved);
      if (entries.length) {
        return res.status(409).json({
          success: false,
          error: `O diretório não está vazio (${entries.length} itens). Confirme a remoção recursiva.`,
          data: { requiresRecursive: true, itemCount: entries.length },
        });
      }
    }

    fs.rmSync(resolved, { recursive: Boolean(recursive), force: false });
    return res.status(200).json({ success: true, data: { deleted: true, path: resolved } });
  } catch (err) {
    return respondWithError(res, err);
  }
});
