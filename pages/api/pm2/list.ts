import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    // Tenta PM2 primeiro
    const result = await executeCommand('pm2_jlist');
    const processes = JSON.parse(result.stdout || '[]');
    return res.status(200).json({ success: true, data: processes, manager: 'pm2' });
  } catch {
    // Fallback para forever
    try {
      const result = await executeCommand('forever_list');
      const lines = result.stdout.trim().split('\n').filter(Boolean);

      // Parse forever output: info:    Forever processes running
      // data:        uid  command             script   forever pid   id logfile                         uptime
      const processes: any[] = [];
      let dataStarted = false;

      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataStarted = true;
          continue;
        }
        if (dataStarted && line.trim()) {
          const parts = line.trim().split(/\s+/);
          // Format: uid command script forever pid id logfile uptime
          if (parts.length >= 7) {
            processes.push({
              uid: parts[0],
              command: parts[1],
              script: parts[2],
              foreverPid: parts[3],
              pid: parseInt(parts[4]) || 0,
              id: parts[5],
              logfile: parts[6],
              uptime: parts.slice(7).join(' '),
              name: parts[1] + ' - ' + parts[2],
              status: 'running',
            });
          }
        }
      }
      return res.status(200).json({ success: true, data: processes, manager: 'forever' });
    } catch {
      return res.status(200).json({ success: true, data: [], manager: 'none' });
    }
  }
});
