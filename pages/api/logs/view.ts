import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const source = (req.query.source as string) || 'panel';
      const lines = parseInt((req.query.lines as string) || '200');
      const filter = (req.query.filter as string) || '';

      let logPath = '';
      switch (source) {
        case 'panel': logPath = '/var/lib/duart-panel/logs/panel.log'; break;
        case 'nginx-access': logPath = '/var/log/nginx/access.log'; break;
        case 'nginx-error': logPath = '/var/log/nginx/error.log'; break;
        case 'ufw': logPath = '/var/log/ufw.log'; break;
        case 'fail2ban': logPath = '/var/log/fail2ban.log'; break;
        case 'ssl-renewal': logPath = '/var/lib/duart-panel/logs/ssl-renewal.log'; break;
        default: logPath = '/var/lib/duart-panel/logs/panel.log';
      }

      let command = `tail -n ${lines} ${logPath} 2>/dev/null || echo ""`;
      const result = await executeRaw(command, 10000);

      const logLines = result.stdout.split('\n').filter(Boolean).map(line => {
        return { timestamp: '', level: 'INFO', message: line };
      });

      if (filter) {
        const filterLower = filter.toLowerCase();
        return res.status(200).json({
          success: true,
          data: {
            source,
            lines: logLines.filter(l => l.message.toLowerCase().includes(filterLower)),
            totalLines: logLines.length,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: { source, lines: logLines, totalLines: logLines.length },
      });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
