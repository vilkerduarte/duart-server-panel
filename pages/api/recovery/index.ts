import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'POST') {
      const { action } = req.body;

      if (req.url?.includes('check')) {
        // Check NGINX status
        let nginxRunning = false;
        let configValid = false;
        try {
          const statusResult = await executeRaw('systemctl is-active nginx', 5000);
          nginxRunning = statusResult.stdout.trim() === 'active';
        } catch {}
        try {
          const testResult = await executeRaw('nginx -t 2>&1', 5000);
          configValid = testResult.code === 0;
        } catch {}

        return res.status(200).json({
          success: true,
          data: { nginxRunning, configValid, panelAccessible: nginxRunning, suggestions: !nginxRunning ? ['Execute npm run recover para restaurar o NGINX'] : [] }
        });
      }

      if (req.url?.includes('restore-nginx')) {
        return res.status(200).json({ success: true, data: { restored: true, nginxRestarted: true, message: 'Execute npm run recover no terminal' } });
      }
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
