import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { pid, signal = 'SIGTERM' } = req.body;

  if (!pid || typeof pid !== 'number') {
    return res.status(400).json({ success: false, error: 'PID inválido' });
  }

  // Protect critical PIDs
  if (pid === 1 || pid === 0) {
    return res.status(403).json({ success: false, error: 'Não é permitido finalizar este PID' });
  }

  try {
    const signalFlag = signal === 'SIGKILL' ? '-9' : '-15';
    const result = await executeCommand('kill_process', [signalFlag, String(pid)]);

    if (result.code !== 0) {
      return res.status(400).json({
        success: false,
        error: result.stderr || 'Erro ao finalizar processo',
      });
    }

    return res.status(200).json({
      success: true,
      data: { killed: true, pid, signal },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
