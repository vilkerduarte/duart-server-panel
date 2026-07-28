import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CPU_HISTORY_DIR = path.join(DATA_DIR, 'cpu-history');

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const historyFile = path.join(CPU_HISTORY_DIR, `${date}.txt`);

    if (!fs.existsSync(historyFile)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const content = fs.readFileSync(historyFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const data = lines.map(line => {
      const [timestamp, cpu, load1, load5, load15] = line.split(',');
      return {
        timestamp,
        cpu: parseFloat(cpu),
        load1: parseFloat(load1),
        load5: parseFloat(load5),
        load15: parseFloat(load15),
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
