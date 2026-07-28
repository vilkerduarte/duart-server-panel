import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { filePath, mode } = req.body;
    if (!filePath || !mode) return res.status(400).json({ success: false, error: 'Caminho e modo são obrigatórios' });

    const resolvedPath = path.resolve('/', filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
    }

    const modeNum = parseInt(mode, 8);
    if (isNaN(modeNum) || modeNum < 0 || modeNum > 0o777) {
      return res.status(400).json({ success: false, error: 'Modo inválido (use octal: 755)' });
    }

    fs.chmodSync(resolvedPath, modeNum);
    return res.status(200).json({ success: true, data: { changed: true } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
