import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.status(200).json({ success: true, data: [] });
  if (req.method === 'POST') {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, error: 'Nome da imagem é obrigatório' });
    try {
      const result = await executeCommand('docker_pull', [image]);
      return res.status(200).json({ success: true, data: { pulled: true, image } });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  if (req.method === 'DELETE') {
    const { id, force } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });
    try {
      const args = force ? ['-f', id] : [id];
      await executeCommand('docker_rmi', args);
      return res.status(200).json({ success: true, data: { deleted: true } });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
