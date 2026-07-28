import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readConfig, writeConfig, maskApiKey } from '@/lib/data/config';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const config = readConfig();
      return res.status(200).json({
        success: true,
        data: {
          ...config,
          aiApiKey: maskApiKey(config.aiApiKey),
        },
      });
    }

    if (req.method === 'PUT') {
      const updates = req.body;
      const config = writeConfig(updates);
      return res.status(200).json({
        success: true,
        data: {
          ...config,
          aiApiKey: maskApiKey(config.aiApiKey),
        },
      });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
