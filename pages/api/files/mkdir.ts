import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });

    const resolvedPath = path.resolve('/', dirPath);
    if (fs.existsSync(resolvedPath)) {
      return res.status(409).json({ success: false, error: 'Diretório já existe' });
    }

    fs.mkdirSync(resolvedPath, { recursive: true });
    return res.status(200).json({ success: true, data: { created: true, path: resolvedPath } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
