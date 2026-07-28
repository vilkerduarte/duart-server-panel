import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';

const LOG_SOURCES = [
  { id: 'panel', name: 'Painel', path: '/var/lib/duart-panel/logs/panel.log', description: 'Logs do painel Duart' },
  { id: 'nginx-access', name: 'NGINX Access', path: '/var/log/nginx/access.log', description: 'Logs de acesso NGINX' },
  { id: 'nginx-error', name: 'NGINX Error', path: '/var/log/nginx/error.log', description: 'Logs de erro NGINX' },
  { id: 'system', name: 'Sistema (journalctl)', path: 'journalctl', description: 'Logs do sistema via journalctl' },
  { id: 'ufw', name: 'UFW', path: '/var/log/ufw.log', description: 'Logs do firewall UFW' },
  { id: 'fail2ban', name: 'fail2ban', path: '/var/log/fail2ban.log', description: 'Logs do fail2ban' },
  { id: 'ssl-renewal', name: 'SSL Renewal', path: '/var/lib/duart-panel/logs/ssl-renewal.log', description: 'Logs de renovação SSL' },
];

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  return res.status(200).json({ success: true, data: LOG_SOURCES });
});
