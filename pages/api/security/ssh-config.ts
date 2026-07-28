import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const sshConfigPath = '/etc/ssh/sshd_config';

    if (!fs.existsSync(sshConfigPath)) {
      return res.status(200).json({ success: true, data: {} });
    }

    const content = fs.readFileSync(sshConfigPath, 'utf-8');
    const lines = content.split('\n');

    const config: Record<string, string> = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          config[parts[0]] = parts.slice(1).join(' ');
        }
      }
    }

    return res.status(200).json({ success: true, data: config });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
