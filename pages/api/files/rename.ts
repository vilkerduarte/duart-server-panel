import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') return methodNotAllowed(res);

  try {
    const { oldPath, newPath } = req.body ?? {};
    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'Caminhos são obrigatórios' });
    }

    const roots = configuredRoots();
    // Origem e destino precisam estar na jaula: senão renomear vira uma forma
    // de mover arquivo para fora dela.
    const resolvedOld = resolveSafePath(oldPath, { allowedRoots: roots });
    const resolvedNew = resolveSafePath(newPath, { allowedRoots: roots });

    if (fs.existsSync(resolvedNew)) {
      return res.status(409).json({ success: false, error: 'O destino já existe' });
    }

    fs.renameSync(resolvedOld, resolvedNew);
    return res.status(200).json({ success: true, data: { renamed: true, path: resolvedNew } });
  } catch (err) {
    return respondWithError(res, err);
  }
});
