import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { enable } = req.body;

  try {
    if (enable) {
      // Set default policies to DROP for INPUT, ACCEPT for OUTPUT and FORWARD
      // This "activates" the firewall by setting restrictive defaults
      await executeRaw('sudo iptables -P INPUT DROP', 5000);
      // Allow loopback
      await executeRaw('sudo iptables -A INPUT -i lo -j ACCEPT', 5000);
      // Allow established/related connections
      await executeRaw('sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT', 5000);
      // Allow SSH (port 22)
      await executeRaw('sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT', 5000);
      // Allow HTTP/HTTPS
      await executeRaw('sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT', 5000);
      await executeRaw('sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT', 5000);
    } else {
      // Reset to default ACCEPT policies and flush all rules
      await executeRaw('sudo iptables -P INPUT ACCEPT', 5000);
      await executeRaw('sudo iptables -P FORWARD ACCEPT', 5000);
      await executeRaw('sudo iptables -P OUTPUT ACCEPT', 5000);
      await executeRaw('sudo iptables -F', 5000);
      await executeRaw('sudo iptables -X', 5000);
    }

    return res.status(200).json({
      success: true,
      data: { status: enable ? 'active' : 'inactive' },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
