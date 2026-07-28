import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const result = await executeCommand('docker_images');
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const images = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return res.status(200).json({ success: true, data: images });
    }

    if (req.method === 'POST') {
      const { image } = req.body;
      if (!image) return res.status(400).json({ success: false, error: 'Nome da imagem é obrigatório' });
      const result = await executeCommand('docker_pull', [image]);
      return res.status(200).json({ success: true, data: { pulled: true, image } });
    }

    if (req.method === 'DELETE') {
      const { id, force } = req.query;
      const imageId = id as string;
      if (!imageId) return res.status(400).json({ success: false, error: 'ID é obrigatório' });
      const args = force === 'true' ? ['-f', imageId] : [imageId];
      await executeCommand('docker_rmi', args);
      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
