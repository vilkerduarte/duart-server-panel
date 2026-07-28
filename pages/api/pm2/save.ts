import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const result = await executeCommand('pm2_save');
    return res.status(200).json({ success: true, data: result.stdout || 'Configuração salva com sucesso' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
