import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') return methodNotAllowed(res);

  try {
    const { filePath, mode, recursive } = req.body ?? {};
    if (!filePath || !mode) {
      return res.status(400).json({ success: false, error: 'Caminho e modo são obrigatórios' });
    }

    if (!/^[0-7]{3,4}$/.test(String(mode))) {
      return res.status(400).json({ success: false, error: 'Modo inválido — use octal de 3 ou 4 dígitos (ex.: 755)' });
    }

    const modeNum = parseInt(String(mode), 8);
    const resolved = resolveSafePath(filePath, { allowedRoots: configuredRoots() });

    if (recursive && fs.statSync(resolved).isDirectory()) {
      chmodRecursive(resolved, modeNum);
    } else {
      fs.chmodSync(resolved, modeNum);
    }

    return res.status(200).json({ success: true, data: { changed: true, path: resolved, mode } });
  } catch (err) {
    return respondWithError(res, err);
  }
});

function chmodRecursive(target: string, mode: number): void {
  fs.chmodSync(target, mode);
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = `${target}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) chmodRecursive(child, mode);
    else fs.chmodSync(child, mode);
  }
}
