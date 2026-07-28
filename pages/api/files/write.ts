import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { filePath, content } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'Caminho e conteúdo são obrigatórios' });
    }

    const resolvedPath = path.resolve('/', filePath);

    // Ensure parent directory exists
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf-8');

    return res.status(200).json({
      success: true,
      data: { written: true, path: resolvedPath },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
