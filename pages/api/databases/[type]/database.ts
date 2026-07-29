import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type as string)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    // GET - List databases
    if (req.method === 'GET') {
      let cmd = '';
      if (type === 'mysql') {
        cmd = 'sudo mysql -e "SHOW DATABASES" -sN 2>/dev/null';
      } else if (type === 'postgresql') {
        cmd = 'sudo -u postgres psql -tAc "SELECT datname FROM pg_database WHERE datistemplate = false" 2>/dev/null';
      } else if (type === 'mongodb') {
        cmd = 'sudo mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))" 2>/dev/null';
      }

      const result = await executeRaw(cmd, 8000);
      const databases = (result.stdout || '').split('\n')
        .map(l => l.trim())
        .filter(l => l && !['Database', 'information_schema', 'performance_schema', 'mysql', 'sys', 'template0', 'template1'].includes(l.toLowerCase()));

      return res.status(200).json({ success: true, data: { databases } });
    }

    // POST - Create / Drop / Import
    if (req.method === 'POST') {
      const { action, name, sqlFilePath } = req.body;

      if (!action) {
        return res.status(400).json({ success: false, error: 'Ação é obrigatória' });
      }

      // Create database
      if (action === 'create') {
        if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
        // Sanitize name
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');

        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "CREATE DATABASE \\\`${safeName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"`, 10000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres createdb "${safeName}"`, 10000);
        } else if (type === 'mongodb') {
          await executeRaw(`sudo mongosh --quiet --eval "use ${safeName}; db.createCollection(\\"init\\"); db.init.drop()"`, 10000);
        }
        return res.status(200).json({ success: true, data: { created: true, name: safeName } });
      }

      // Drop database
      if (action === 'drop') {
        if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');

        if (type === 'mysql') {
          await executeRaw(`sudo mysql -e "DROP DATABASE IF EXISTS \\\`${safeName}\\\`"`, 10000);
        } else if (type === 'postgresql') {
          await executeRaw(`sudo -u postgres dropdb "${safeName}"`, 10000);
        } else if (type === 'mongodb') {
          await executeRaw(`sudo mongosh --quiet --eval "db.getSiblingDB('${safeName}').dropDatabase()"`, 10000);
        }
        return res.status(200).json({ success: true, data: { dropped: true, name: safeName } });
      }

      // Import SQL file
      if (action === 'import') {
        if (!name || !sqlFilePath) {
          return res.status(400).json({ success: false, error: 'Nome do banco e caminho do SQL são obrigatórios' });
        }

        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        const resolvedPath = path.resolve('/', sqlFilePath);

        if (!fs.existsSync(resolvedPath)) {
          return res.status(400).json({ success: false, error: 'Arquivo SQL não encontrado: ' + resolvedPath });
        }

        if (type === 'mysql') {
          const result = await executeRaw(`sudo mysql \\\`${safeName}\\\` < "${resolvedPath}" 2>&1`, 30000);
          if (result.code !== 0) {
            return res.status(400).json({ success: false, error: result.stderr || 'Erro na importação' });
          }
        } else if (type === 'postgresql') {
          const result = await executeRaw(`sudo -u postgres psql "${safeName}" < "${resolvedPath}" 2>&1`, 30000);
          if (result.code !== 0) {
            return res.status(400).json({ success: false, error: result.stderr || 'Erro na importação' });
          }
        } else if (type === 'mongodb') {
          // mongorestore for MongoDB
          const result = await executeRaw(`sudo mongorestore --db "${safeName}" "${resolvedPath}" 2>&1`, 30000);
          if (result.code !== 0) {
            return res.status(400).json({ success: false, error: result.stderr || 'Erro na importação' });
          }
        }

        return res.status(200).json({ success: true, data: { imported: true, database: safeName, file: resolvedPath } });
      }

      return res.status(400).json({ success: false, error: 'Ação não suportada' });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
