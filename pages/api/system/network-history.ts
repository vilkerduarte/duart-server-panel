import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NETWORK_HISTORY_DIR = path.join(DATA_DIR, 'network-history');

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const filePath = path.join(NETWORK_HISTORY_DIR, `${date}.txt`);

    if (!fs.existsSync(filePath)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const data = lines.map(line => {
      const parts = line.split(',');
      return {
        timestamp: parts[0] || '',
        rxBytes: parseInt(parts[1]) || 0,
        txBytes: parseInt(parts[2]) || 0,
        rxSpeed: parseFloat(parts[3]) || 0,
        txSpeed: parseFloat(parts[4]) || 0,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    return res.status(200).json({ success: true, data: [] });
  }
});
