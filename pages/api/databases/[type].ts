import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

const DB_CONFIGS: Record<string, { name: string; pkg: string; port: number; service: string }> = {
  mysql: { name: 'MySQL', pkg: 'mysql-server', port: 3306, service: 'mysql' },
  postgresql: { name: 'PostgreSQL', pkg: 'postgresql', port: 5432, service: 'postgresql' },
  mongodb: { name: 'MongoDB', pkg: 'mongod', port: 27017, service: 'mongod' },
};

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;
  const dbConfig = DB_CONFIGS[type as string];

  if (!dbConfig) {
    return res.status(400).json({ success: false, error: 'Tipo de banco inválido' });
  }

  try {
    if (req.method === 'GET') {
      // Check if installed
      let installed = false;
      let running = false;
      let version = '';

      try {
        const statusResult = await executeCommand('systemctl_status', [dbConfig.service]);
        installed = statusResult.code !== 4; // code 4 = not found
        running = statusResult.code === 0;
        if (running) {
          const verMatch = statusResult.stdout.match(/version[:\s]+([\d.]+)/i);
          if (verMatch) version = verMatch[1];
        }
      } catch {}

      return res.status(200).json({
        success: true,
        data: { installed, running, version, port: dbConfig.port, name: dbConfig.name },
      });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
