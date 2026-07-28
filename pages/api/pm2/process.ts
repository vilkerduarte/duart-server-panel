import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { action, id, manager } = req.body;

  if (!action || !id) {
    return res.status(400).json({ success: false, error: 'action e id são obrigatórios' });
  }

  const validActions = ['start', 'stop', 'restart', 'reload', 'delete'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Ação inválida' });
  }

  try {
    if (manager === 'forever') {
      // Forever: restart e reload = restart, delete não existe = stop
      const foreverAction = action === 'reload' ? 'restart' : action === 'delete' ? 'stop' : action;
      const cmdKey = `forever_${foreverAction}` as string;
      await executeCommand(cmdKey, [String(id)]);
    } else {
      const cmdKey = `pm2_${action}` as string;
      await executeCommand(cmdKey, [String(id)]);
    }

    return res.status(200).json({ success: true, message: `${action} executado com sucesso` });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
