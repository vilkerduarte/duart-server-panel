import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  DbType, DbInputError, assertIdentifier, jsString,
  mysqlIdent, pgIdent, mysqlExec, psqlExec, mongoshExec,
  listDatabases, friendlyDbError,
} from '@/lib/db';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const type = req.query.type as DbType;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, data: { databases: await listDatabases(type) } });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Método não permitido' });
    }

    const { action, name } = req.body ?? {};
    if (!action || !name) {
      return res.status(400).json({ success: false, error: 'Ação e nome são obrigatórios' });
    }

    const db = assertIdentifier(name, 'Nome do banco');
    let result;

    if (action === 'create') {
      if (type === 'mysql') {
        result = await mysqlExec(
          `CREATE DATABASE ${mysqlIdent(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
        );
      } else if (type === 'postgresql') {
        result = await psqlExec(`CREATE DATABASE ${pgIdent(db)} ENCODING 'UTF8';`);
      } else {
        result = await mongoshExec(
          `db.getSiblingDB(${jsString(db)}).createCollection("_init")`,
        );
      }
    } else if (action === 'drop') {
      // Bancos do sistema fora do alcance: apagar qualquer um deles quebra o servidor.
      const protectedNames = ['mysql', 'information_schema', 'performance_schema', 'sys', 'postgres', 'template0', 'template1', 'admin', 'local', 'config'];
      if (protectedNames.includes(db.toLowerCase())) {
        return res.status(403).json({ success: false, error: `O banco "${db}" é do sistema e não pode ser removido.` });
      }

      if (type === 'mysql') {
        result = await mysqlExec(`DROP DATABASE IF EXISTS ${mysqlIdent(db)};`);
      } else if (type === 'postgresql') {
        result = await psqlExec(`DROP DATABASE IF EXISTS ${pgIdent(db)};`);
      } else {
        result = await mongoshExec(`db.getSiblingDB(${jsString(db)}).dropDatabase()`);
      }
    } else {
      return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
    }

    if (result.code !== 0) {
      return res.status(400).json({ success: false, error: friendlyDbError(type, result.stderr || result.stdout) });
    }

    return res.status(200).json({ success: true, data: { action, name: db } });
  } catch (err: any) {
    if (err instanceof DbInputError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
