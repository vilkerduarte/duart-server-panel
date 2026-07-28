import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureDir() { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  ensureDir();

  if (req.method === 'GET') {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz')).map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { id: f, name: f, path: path.join(BACKUP_DIR, f), size: stat.size, createdAt: stat.mtime.toISOString() };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json({ success: true, data: files });
  }

  if (req.method === 'POST') {
    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `duart-panel-${timestamp}.tar.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Simple tar of data directory
    const { execSync } = require('child_process');
    const dataDir = '/var/lib/duart-panel';
    try {
      execSync(`tar -czf "${filepath}" -C /var/lib duart-panel 2>/dev/null || tar -czf "${filepath}" -C "${DATA_DIR}" .`, { timeout: 60000 });
      const stat = fs.statSync(filepath);
      return res.status(200).json({ success: true, data: { id: filename, name: filename, path: filepath, size: stat.size, createdAt: new Date().toISOString() } });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const filepath = path.join(BACKUP_DIR, id as string);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return res.status(200).json({ success: true, data: { deleted: true } });
    }
    return res.status(404).json({ success: false, error: 'Backup não encontrado' });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
