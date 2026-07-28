import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { id, lines, manager } = req.query;

  if (!id) {
    return res.status(400).json({ success: false, error: 'id é obrigatório' });
  }

  const numLines = parseInt((lines as string) || '100');

  try {
    if (manager === 'forever') {
      const result = await executeCommand('forever_logs', [String(id)]);
      const logLines = result.stdout.split('\n');
      const tail = logLines.slice(-numLines).join('\n');
      return res.status(200).json({ success: true, data: tail });
    } else {
      const result = await executeCommand('pm2_logs', [String(id), '--lines', String(numLines), '--nostream']);
      return res.status(200).json({ success: true, data: result.stdout });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
