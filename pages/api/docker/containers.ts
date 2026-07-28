import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const result = await executeCommand('docker_ps');
    const lines = result.stdout.trim().split('\n').filter(Boolean);

    const containers = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.status(200).json({ success: true, data: containers });
  } catch (err: any) {
    return res.status(200).json({ success: true, data: [] });
  }
});
