import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ success: false, error: 'Caminhos são obrigatórios' });

    const resolvedOld = path.resolve('/', oldPath);
    const resolvedNew = path.resolve('/', newPath);

    if (!fs.existsSync(resolvedOld)) {
      return res.status(404).json({ success: false, error: 'Arquivo/diretório não encontrado' });
    }

    fs.renameSync(resolvedOld, resolvedNew);
    return res.status(200).json({ success: true, data: { renamed: true } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
