import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';
import { writeConfig } from '@/lib/data/config';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { hostname } = req.body;

    if (!hostname || typeof hostname !== 'string') {
      return res.status(400).json({ success: false, error: 'Hostname é obrigatório' });
    }

    const result = await executeCommand('hostnamectl_set', [hostname]);

    if (result.code !== 0) {
      return res.status(500).json({ success: false, error: result.stderr || 'Erro ao alterar hostname' });
    }

    writeConfig({ hostname });

    return res.status(200).json({ success: true, data: { hostname } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
