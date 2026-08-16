import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  DbType, DbInputError, assertPassword, mysqlString, pgString, jsString,
  mysqlExec, psqlExec, mongoshExec, friendlyDbError,
} from '@/lib/db';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const type = req.query.type as DbType;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const password = assertPassword(req.body?.newPassword);
    let result;

    if (type === 'mysql') {
      result = await mysqlExec(
        `ALTER USER 'root'@'localhost' IDENTIFIED BY ${mysqlString(password)};\nFLUSH PRIVILEGES;`,
      );
      if (result.code !== 0) {
        // Instalações antigas ainda usam o plugin nativo.
        result = await mysqlExec(
          `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY ${mysqlString(password)};\nFLUSH PRIVILEGES;`,
        );
      }
    } else if (type === 'postgresql') {
      result = await psqlExec(`ALTER ROLE postgres WITH PASSWORD ${pgString(password)};`);
    } else {
      result = await mongoshExec(
        `db.getSiblingDB("admin").changeUserPassword("root",${jsString(password)})`,
      );
      if (result.code !== 0) {
        result = await mongoshExec(
          `db.getSiblingDB("admin").changeUserPassword("admin",${jsString(password)})`,
        );
      }
    }

    if (result.code !== 0) {
      return res.status(400).json({ success: false, error: friendlyDbError(type, result.stderr || result.stdout) });
    }

    return res.status(200).json({ success: true, data: { changed: true } });
  } catch (err: any) {
    if (err instanceof DbInputError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
