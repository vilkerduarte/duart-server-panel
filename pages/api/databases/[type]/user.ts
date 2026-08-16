import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  DbType, DbInputError, assertIdentifier, assertHost, assertPassword,
  mysqlString, pgString, jsString, mysqlIdent, pgIdent,
  mysqlExec, psqlExec, mongoshExec, listUsers, friendlyDbError,
} from '@/lib/db';

/**
 * Usuários de banco.
 *
 * Nenhum valor entra por interpolação em linha de comando: o SQL é montado com
 * escape explícito e entregue ao cliente via stdin ou como argumento único de
 * execFile. Senha nunca aparece em `ps aux`.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const type = req.query.type as DbType;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, data: { users: await listUsers(type) } });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Método não permitido' });
    }

    const { action, username, password, database, host } = req.body ?? {};
    if (!action) return res.status(400).json({ success: false, error: 'Ação é obrigatória' });
    if (!username) return res.status(400).json({ success: false, error: 'Usuário é obrigatório' });

    const user = assertIdentifier(username, 'Nome de usuário');
    const userHost = assertHost(host || 'localhost');
    const db = database ? assertIdentifier(database, 'Nome do banco') : null;

    let result;

    switch (action) {
      case 'create': {
        const pass = assertPassword(password);
        if (type === 'mysql') {
          const statements = [
            `CREATE USER ${mysqlString(user)}@${mysqlString(userHost)} IDENTIFIED BY ${mysqlString(pass)};`,
            db
              ? `GRANT ALL PRIVILEGES ON ${mysqlIdent(db)}.* TO ${mysqlString(user)}@${mysqlString(userHost)};`
              : `GRANT ALL PRIVILEGES ON *.* TO ${mysqlString(user)}@${mysqlString(userHost)} WITH GRANT OPTION;`,
            'FLUSH PRIVILEGES;',
          ];
          result = await mysqlExec(statements.join('\n'));
        } else if (type === 'postgresql') {
          result = await psqlExec(`CREATE ROLE ${pgIdent(user)} WITH LOGIN PASSWORD ${pgString(pass)};`);
          if (result.code === 0 && db) {
            result = await psqlExec(`GRANT ALL PRIVILEGES ON DATABASE ${pgIdent(db)} TO ${pgIdent(user)};`);
          }
        } else {
          const target = db || 'admin';
          result = await mongoshExec(
            `db.getSiblingDB(${jsString(target)}).createUser({user:${jsString(user)},pwd:${jsString(pass)},` +
            `roles:[{role:"readWrite",db:${jsString(target)}},{role:"dbAdmin",db:${jsString(target)}}]})`,
          );
        }
        break;
      }

      case 'drop': {
        if (type === 'mysql') {
          result = await mysqlExec(
            `DROP USER IF EXISTS ${mysqlString(user)}@${mysqlString(userHost)};\nFLUSH PRIVILEGES;`,
          );
        } else if (type === 'postgresql') {
          result = await psqlExec(`DROP ROLE IF EXISTS ${pgIdent(user)};`);
        } else {
          result = await mongoshExec(`db.getSiblingDB(${jsString(db || 'admin')}).dropUser(${jsString(user)})`);
        }
        break;
      }

      case 'password': {
        const pass = assertPassword(password);
        if (type === 'mysql') {
          result = await mysqlExec(
            `ALTER USER ${mysqlString(user)}@${mysqlString(userHost)} IDENTIFIED BY ${mysqlString(pass)};\nFLUSH PRIVILEGES;`,
          );
        } else if (type === 'postgresql') {
          result = await psqlExec(`ALTER ROLE ${pgIdent(user)} WITH PASSWORD ${pgString(pass)};`);
        } else {
          result = await mongoshExec(
            `db.getSiblingDB(${jsString(db || 'admin')}).changeUserPassword(${jsString(user)},${jsString(pass)})`,
          );
        }
        break;
      }

      case 'grant': {
        if (!db) return res.status(400).json({ success: false, error: 'Banco de dados é obrigatório para conceder acesso' });

        if (type === 'mysql') {
          result = await mysqlExec(
            `GRANT ALL PRIVILEGES ON ${mysqlIdent(db)}.* TO ${mysqlString(user)}@${mysqlString(userHost)};\nFLUSH PRIVILEGES;`,
          );
        } else if (type === 'postgresql') {
          result = await psqlExec(`GRANT ALL PRIVILEGES ON DATABASE ${pgIdent(db)} TO ${pgIdent(user)};`);
        } else {
          result = await mongoshExec(
            `db.getSiblingDB(${jsString(db)}).grantRolesToUser(${jsString(user)},[{role:"readWrite",db:${jsString(db)}}])`,
          );
        }
        break;
      }

      default:
        return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
    }

    if (result && result.code !== 0) {
      return res.status(400).json({
        success: false,
        error: friendlyDbError(type, result.stderr || result.stdout),
      });
    }

    return res.status(200).json({ success: true, data: { action, username: user } });
  } catch (err: any) {
    if (err instanceof DbInputError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
