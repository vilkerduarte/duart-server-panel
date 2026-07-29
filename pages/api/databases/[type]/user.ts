import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type as string)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    // GET - List users
    if (req.method === 'GET') {
      let cmd = '';
      if (type === 'mysql') {
        cmd = 'sudo mysql -e "SELECT User, Host FROM mysql.user" -sN 2>/dev/null';
      } else if (type === 'postgresql') {
        cmd = 'sudo -u postgres psql -tAc "SELECT rolname FROM pg_roles WHERE rolcanlogin = true" 2>/dev/null';
      } else if (type === 'mongodb') {
        cmd = 'sudo mongosh --quiet --eval "db.adminCommand({usersInfo:1}).users.forEach(u=>print(u.user+\'@\'+(u.db||\'admin\')))" 2>/dev/null';
      }

      const result = await executeRaw(cmd, 8000);
      const users = (result.stdout || '').split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const parts = l.split(/\s+/);
          return type === 'mongodb'
            ? { user: l.split('@')[0] || l, host: l.split('@')[1] || 'admin' }
            : { user: parts[0] || '', host: parts[1] || 'localhost' };
        })
        .filter(u => u.user && u.user !== 'User');

      return res.status(200).json({ success: true, data: { users } });
    }

    // POST - Create / Drop / Password / Grant
    if (req.method === 'POST') {
      const { action, username, password, database, host } = req.body;

      if (!action) {
        return res.status(400).json({ success: false, error: 'Ação é obrigatória' });
      }

      if (!username && action !== 'list') {
        return res.status(400).json({ success: false, error: 'Username é obrigatório' });
      }

      const safeUser = (username || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const safeDb = (database || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const safeHost = (host || 'localhost').replace(/[^a-zA-Z0-9_.%-]/g, '');

      // Create user
      if (action === 'create') {
        if (!password) return res.status(400).json({ success: false, error: 'Senha é obrigatória' });

        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "CREATE USER '${safeUser}'@'${safeHost}' IDENTIFIED BY '${password}'"`, 10000);
          if (safeDb) {
            await executeRaw(`sudo mysql -e "GRANT ALL PRIVILEGES ON \\\`${safeDb}\\\`.* TO '${safeUser}'@'${safeHost}'"`, 10000);
          } else {
            await executeRaw(`sudo mysql -e "GRANT ALL PRIVILEGES ON *.* TO '${safeUser}'@'${safeHost}' WITH GRANT OPTION"`, 10000);
          }
          await executeRaw(`sudo mysql -e "FLUSH PRIVILEGES"`, 5000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres psql -c "CREATE ROLE ${safeUser} WITH LOGIN PASSWORD '${password}'"`, 10000);
          if (safeDb) {
            await executeRaw(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \\"${safeDb}\\" TO ${safeUser}"`, 10000);
          }
        } else if (type === 'mongodb') {
          const targetDb = safeDb || 'admin';
          await executeRaw(`sudo mongosh --quiet --eval "db.getSiblingDB('${targetDb}').createUser({user:'${safeUser}',pwd:'${password}',roles:[{role:'readWrite',db:'${targetDb}'},{role:'dbAdmin',db:'${targetDb}'}]})"`, 10000);
        }

        return res.status(200).json({ success: true, data: { created: true, username: safeUser, database: safeDb || 'all' } });
      }

      // Drop user
      if (action === 'drop') {
        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "DROP USER IF EXISTS '${safeUser}'@'${safeHost}'"`, 10000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres psql -c "DROP ROLE IF EXISTS ${safeUser}"`, 10000);
        } else if (type === 'mongodb') {
          await executeRaw(`sudo mongosh --quiet --eval "db.getSiblingDB('${safeDb || 'admin'}').dropUser('${safeUser}')"`, 10000);
        }
        return res.status(200).json({ success: true, data: { dropped: true, username: safeUser } });
      }

      // Change password
      if (action === 'password') {
        if (!password) return res.status(400).json({ success: false, error: 'Nova senha é obrigatória' });

        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "ALTER USER '${safeUser}'@'${safeHost}' IDENTIFIED BY '${password}'"`, 10000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres psql -c "ALTER ROLE ${safeUser} WITH PASSWORD '${password}'"`, 10000);
        } else if (type === 'mongodb') {
          await executeRaw(`sudo mongosh --quiet --eval "db.getSiblingDB('${safeDb || 'admin'}').changeUserPassword('${safeUser}','${password}')"`, 10000);
        }
        return res.status(200).json({ success: true, data: { changed: true, username: safeUser } });
      }

      // Grant privileges to a specific database
      if (action === 'grant') {
        if (!safeDb) return res.status(400).json({ success: false, error: 'Database é obrigatório para grant' });

        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "GRANT ALL PRIVILEGES ON \\\`${safeDb}\\\`.* TO '${safeUser}'@'${safeHost}'"`, 10000);
          await executeRaw(`sudo mysql -e "FLUSH PRIVILEGES"`, 5000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \\"${safeDb}\\" TO ${safeUser}"`, 10000);
        }
        return res.status(200).json({ success: true, data: { granted: true, username: safeUser, database: safeDb } });
      }

      return res.status(400).json({ success: false, error: 'Ação não suportada' });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
