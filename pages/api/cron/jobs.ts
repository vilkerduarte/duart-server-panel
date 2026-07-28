import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CRON_DIR = path.join(DATA_DIR, 'cron');

function ensureDir() { if (!fs.existsSync(CRON_DIR)) fs.mkdirSync(CRON_DIR, { recursive: true }); }

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  ensureDir();

  if (req.method === 'GET') {
    const customFile = path.join(CRON_DIR, 'custom.json');
    let custom = [];
    if (fs.existsSync(customFile)) {
      try { custom = JSON.parse(fs.readFileSync(customFile, 'utf-8')).jobs || []; } catch {}
    }

    return res.status(200).json({
      success: true,
      data: {
        system: [
          { id: 'ssl-renewal', expression: '0 3 * * *', command: 'node scripts/renew-ssl.js', description: 'Renovação SSL', type: 'system' },
          { id: 'cpu-cleanup', expression: '0 0 * * *', command: 'find data/cpu-history/ -mtime +30 -delete', description: 'Limpeza histórico CPU', type: 'system' },
          { id: 'log-rotation', expression: '0 0 * * 0', command: 'node scripts/rotate-logs.js', description: 'Rotação de logs', type: 'managed' },
        ],
        managed: [],
        custom,
      },
    });
  }

  if (req.method === 'POST') {
    const { expression, command, description } = req.body;
    if (!expression || !command) return res.status(400).json({ success: false, error: 'Expressão e comando são obrigatórios' });

    const customFile = path.join(CRON_DIR, 'custom.json');
    let data = { jobs: [] };
    if (fs.existsSync(customFile)) {
      try { data = JSON.parse(fs.readFileSync(customFile, 'utf-8')); } catch {}
    }

    const job = { id: Date.now().toString(), expression, command, description: description || '', active: true, createdAt: new Date().toISOString() };
    data.jobs.push(job);
    fs.writeFileSync(customFile, JSON.stringify(data, null, 2));

    return res.status(200).json({ success: true, data: { job } });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

    const customFile = path.join(CRON_DIR, 'custom.json');
    if (fs.existsSync(customFile)) {
      const data = JSON.parse(fs.readFileSync(customFile, 'utf-8'));
      data.jobs = (data.jobs || []).filter((j: any) => j.id !== id);
      fs.writeFileSync(customFile, JSON.stringify(data, null, 2));
    }

    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
