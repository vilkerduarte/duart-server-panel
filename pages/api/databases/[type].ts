import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

const DB_CONFIGS: Record<string, { name: string; pkg: string; port: number; service: string; cli: string; listDbsCmd: string; listUsersCmd: string }> = {
  mysql: {
    name: 'MySQL',
    pkg: 'mysql-server',
    port: 3306,
    service: 'mysql',
    cli: 'mysql',
    listDbsCmd: 'sudo mysql -e "SHOW DATABASES" -sN 2>/dev/null',
    listUsersCmd: 'sudo mysql -e "SELECT User, Host FROM mysql.user" -sN 2>/dev/null',
  },
  postgresql: {
    name: 'PostgreSQL',
    pkg: 'postgresql',
    port: 5432,
    service: 'postgresql',
    cli: 'psql',
    listDbsCmd: 'sudo -u postgres psql -tAc "SELECT datname FROM pg_database WHERE datistemplate = false" 2>/dev/null',
    listUsersCmd: 'sudo -u postgres psql -tAc "SELECT rolname FROM pg_roles WHERE rolcanlogin = true" 2>/dev/null',
  },
  mongodb: {
    name: 'MongoDB',
    pkg: 'mongod',
    port: 27017,
    service: 'mongod',
    cli: 'mongosh',
    listDbsCmd: 'sudo mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))" 2>/dev/null',
    listUsersCmd: 'sudo mongosh --quiet --eval "db.adminCommand({usersInfo:1}).users.forEach(u=>print(u.user+\'@\'+(u.db||\'admin\')))" 2>/dev/null',
  },
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
        installed = statusResult.code !== 4;
        running = statusResult.code === 0;
        if (running && statusResult.stdout) {
          const verMatch = statusResult.stdout.match(/version[:\s]+([\d.]+)/i) ||
                          statusResult.stdout.match(/v([\d.]+)/i) ||
                          statusResult.stdout.match(/Active:\s+active/);
          if (verMatch && verMatch[1]) version = verMatch[1];
          else version = 'running';
        }
      } catch {}

      // List databases
      let databases: string[] = [];
      if (running) {
        try {
          const dbsResult = await executeRaw(dbConfig.listDbsCmd, 8000);
          if (dbsResult.stdout) {
            databases = dbsResult.stdout.split('\n')
              .map(l => l.trim())
              .filter(l => l && !['Database', 'information_schema', 'performance_schema', 'mysql', 'sys', 'template0', 'template1'].includes(l.toLowerCase()));
          }
        } catch {}
      }

      // List users
      let users: { user: string; host: string }[] = [];
      if (running && type !== 'mongodb') {
        try {
          const usersResult = await executeRaw(dbConfig.listUsersCmd, 8000);
          if (usersResult.stdout) {
            users = usersResult.stdout.split('\n')
              .map(l => {
                const parts = l.trim().split(/\s+/);
                return { user: parts[0] || '', host: parts[1] || 'localhost' };
              })
              .filter(u => u.user && u.user !== 'User');
          }
        } catch {}
      }

      // MongoDB users
      if (running && type === 'mongodb') {
        try {
          const usersResult = await executeRaw(dbConfig.listUsersCmd, 8000);
          if (usersResult.stdout) {
            users = usersResult.stdout.split('\n')
              .map(l => {
                const parts = l.trim().split('@');
                return { user: parts[0] || '', host: parts[1] || 'admin' };
              })
              .filter(u => u.user);
          }
        } catch {}
      }

      return res.status(200).json({
        success: true,
        data: {
          installed,
          running,
          version,
          port: dbConfig.port,
          name: dbConfig.name,
          service: dbConfig.service,
          databases,
          users,
        },
      });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
