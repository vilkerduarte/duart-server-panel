import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    // Network interfaces
    const netResult = await executeCommand('network_info');
    const netLines = netResult.stdout.split('\n').slice(2); // Skip headers
    const interfaces: any[] = [];

    for (const line of netLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 10) {
        const name = parts[0].replace(':', '');
        if (name === 'lo') continue;
        interfaces.push({
          name,
          rxBytes: parseInt(parts[1]) || 0,
          txBytes: parseInt(parts[9]) || 0,
          rxSpeed: 0,
          txSpeed: 0,
        });
      }
    }

    // Connections
    const connResult = await executeCommand('connections');
    const connLines = connResult.stdout.split('\n');
    let totalConn = 0, tcpConn = 0, udpConn = 0, establishedConn = 0, timeWaitConn = 0, listenConn = 0;

    for (const line of connLines) {
      if (line.includes('Total:')) {
        const match = line.match(/(\d+)/);
        if (match) totalConn = parseInt(match[1]);
      }
      if (line.includes('TCP:')) {
        const match = line.match(/(\d+)/);
        if (match) tcpConn = parseInt(match[1]);
      }
      if (line.includes('estab')) {
        const match = line.match(/estab\s+(\d+)/);
        if (match) establishedConn = parseInt(match[1]);
      }
    }

    // Listening ports
    const portsResult = await executeCommand('listening_ports');
    const portLines = portsResult.stdout.split('\n').filter(Boolean);
    const listeningPorts = portLines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        port: parts[3]?.split(':').pop() || '',
        proto: 'tcp',
        process: parts.slice(6).join(' ') || '',
      };
    }).filter((p: any) => p.port);

    // NGINX metrics
    let nginxMetrics = { active: 0, requestsPerSec: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0 };
    try {
      const nginxResult = await executeCommand('nginx_status');
      const nginxLines = nginxResult.stdout.split('\n');
      if (nginxLines.length >= 3) {
        const activeMatch = nginxLines[0].match(/(\d+)/);
        if (activeMatch) nginxMetrics.active = parseInt(activeMatch[1]);
      }
    } catch {}

    return res.status(200).json({
      success: true,
      data: { interfaces, connections: { total: totalConn, tcp: tcpConn, udp: udpConn, established: establishedConn, timeWait: timeWaitConn, listen: listenConn }, listeningPorts, nginx: nginxMetrics },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
