import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const result = await executeCommand('apt_install', ['fail2ban']);

    if (result.code !== 0) {
      return res.status(500).json({
        success: false,
        error: 'Falha ao instalar fail2ban: ' + (result.stderr || result.stdout),
      });
    }

    // Enable and start the service
    await executeCommand('systemctl_enable', ['fail2ban']);
    await executeCommand('systemctl_start', ['fail2ban']);

    return res.status(200).json({
      success: true,
      data: {
        installed: true,
        version: result.stdout,
        serviceStarted: true,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
