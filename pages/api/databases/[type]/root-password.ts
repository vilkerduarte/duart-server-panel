import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  DbType, DbInputError, assertPassword, pgString, jsString,
  psqlExec, mongoshExec, friendlyDbError,
} from '@/lib/db';
import { readMysqlRootPassword, generateDbPassword } from '@/lib/db-credentials';
import { setMysqlRootPassword } from '@/lib/mysql';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const type = req.query.type as DbType;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  // Revelar a senha guardada pelo painel. Só existe para MySQL/MariaDB, onde o
  // painel precisa dela para se conectar depois que o root deixa o auth_socket.
  if (req.method === 'GET') {
    if (type !== 'mysql') {
      return res.status(400).json({ success: false, error: 'O painel só guarda a senha root do MySQL' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const password = readMysqlRootPassword();
    return res.status(200).json({ success: true, data: { stored: Boolean(password), password } });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    if (type === 'mysql') {
      // `generate: true` deixa o painel escolher a senha; senão vem digitada.
      const password = req.body?.generate === true ? generateDbPassword() : assertPassword(req.body?.newPassword);
      await setMysqlRootPassword(password);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ success: true, data: { changed: true, password } });
    }

    const password = assertPassword(req.body?.newPassword);
    let result;

    if (type === 'postgresql') {
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
  } catch (err) {
    if (err instanceof DbInputError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (type === 'mysql') {
      return res.status(400).json({ success: false, error: friendlyDbError('mysql', (err as Error).message) });
    }
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});
