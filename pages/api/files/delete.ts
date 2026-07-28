import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { filePath, recursive } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });
    }

    const resolvedPath = path.resolve('/', filePath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Arquivo/diretório não encontrado' });
    }

    fs.rmSync(resolvedPath, { recursive: !!recursive, force: false });

    return res.status(200).json({
      success: true,
      data: { deleted: true },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
