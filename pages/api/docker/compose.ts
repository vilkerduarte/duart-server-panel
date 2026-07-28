import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    // List compose projects
    try {
      const result = await executeCommand('docker_compose_ls');
      return res.status(200).json({ success: true, data: { projects: result.stdout } });
    } catch (err: any) {
      return res.status(200).json({ success: true, data: { projects: '' } });
    }
  }

  if (req.method === 'POST') {
    const { path: composePath, action } = req.body;

    if (!composePath || !action) {
      return res.status(400).json({ success: false, error: 'Path e ação são obrigatórios' });
    }

    const allowedActions = ['up', 'down', 'restart', 'ps', 'logs', 'pull'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ success: false, error: 'Ação inválida. Permitidas: ' + allowedActions.join(', ') });
    }

    try {
      let cmd = `docker compose -f "${composePath}"`;

      if (action === 'ps') {
        const result = await executeCommand('docker_compose_ps');
        return res.status(200).json({ success: true, data: { result: result.stdout } });
      }

      switch (action) {
        case 'up':
          cmd += ' up -d';
          break;
        case 'down':
          cmd += ' down';
          break;
        case 'restart':
          cmd += ' restart';
          break;
        case 'logs':
          cmd += ' logs --tail=200';
          break;
        case 'pull':
          cmd += ' pull';
          break;
        default:
          break;
      }

      const result = await executeRaw(cmd, 120000);

      return res.status(200).json({
        success: result.code === 0,
        data: { action, result: result.stdout || result.stderr },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
