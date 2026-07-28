import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readConfig } from '@/lib/data/config';
import crypto from 'crypto';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const config = readConfig();

    if (!config.aiApiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key não configurada',
        code: 'MISSING_API_KEY',
      });
    }

    // Simple connectivity test using fetch to DeepSeek
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.aiApiKey}`,
      },
    });

    if (response.ok) {
      return res.status(200).json({ success: true, data: { connected: true } });
    } else {
      const body = await response.text();
      return res.status(400).json({ success: false, error: `Falha na conexão: ${body}` });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
