import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res);

  try {
    const { dirPath } = req.body ?? {};
    if (!dirPath) return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });

    const resolved = resolveSafePath(dirPath, { allowedRoots: configuredRoots() });
    if (fs.existsSync(resolved)) {
      return res.status(409).json({ success: false, error: 'Diretório já existe' });
    }

    fs.mkdirSync(resolved, { recursive: true, mode: 0o755 });
    return res.status(200).json({ success: true, data: { created: true, path: resolved } });
  } catch (err) {
    return respondWithError(res, err);
  }
});
