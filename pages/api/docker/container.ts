import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { id, action } = req.body;

  if (!id || !action) {
    return res.status(400).json({ success: false, error: 'ID e ação são obrigatórios' });
  }

  const actionMap: Record<string, string> = {
    start: 'docker_start',
    stop: 'docker_stop',
    restart: 'docker_restart',
    pause: 'docker_pause',
    unpause: 'docker_unpause',
    remove: 'docker_remove',
  };

  const commandKey = actionMap[action];
  if (!commandKey) {
    return res.status(400).json({ success: false, error: 'Ação inválida' });
  }

  try {
    const args = action === 'remove' ? ['-f', id] : [id];
    const result = await executeCommand(commandKey, args);

    return res.status(200).json({
      success: result.code === 0,
      data: { action, containerId: id, result: result.stdout || result.stderr },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
