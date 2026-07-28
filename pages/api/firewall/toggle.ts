import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { enable } = req.body;
  try {
    const cmdKey = enable ? 'ufw_enable' : 'ufw_disable';
    const result = await executeCommand(cmdKey);
    const newStatus = enable ? 'active' : 'inactive';

    return res.status(200).json({
      success: result.code === 0,
      data: { status: result.code === 0 ? newStatus : 'unknown' },
      error: result.code !== 0 ? result.stderr : undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
