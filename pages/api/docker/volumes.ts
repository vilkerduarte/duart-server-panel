import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const result = await executeCommand('docker_volume_ls');
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const volumes = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ success: true, data: volumes });
    }
    if (req.method === 'POST') {
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
      await executeCommand('docker_volume_create', [name]);
      return res.status(200).json({ success: true, data: { created: true, name } });
    }
    if (req.method === 'DELETE') {
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
      await executeCommand('docker_volume_rm', [name]);
      return res.status(200).json({ success: true, data: { deleted: true } });
    }
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
