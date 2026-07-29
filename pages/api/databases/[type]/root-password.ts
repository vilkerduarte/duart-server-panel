import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type as string)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    // PUT - Change root password
    if (req.method === 'PUT') {
      const { newPassword } = req.body;

      if (!newPassword) {
        return res.status(400).json({ success: false, error: 'Nova senha é obrigatória' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 6 caracteres' });
      }

      if (type === 'mysql') {
        const result = await executeRaw(
          `sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '${newPassword}'" 2>&1`,
          10000
        );

        // Also try with mysql_native_password if the above fails
        if (result.code !== 0) {
          const result2 = await executeRaw(
            `sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${newPassword}'; FLUSH PRIVILEGES;" 2>&1`,
            10000
          );
          if (result2.code !== 0) {
            return res.status(400).json({
              success: false,
              error: result2.stderr || 'Erro ao alterar senha root do MySQL',
            });
          }
        }
        await executeRaw(`sudo mysql -e "FLUSH PRIVILEGES"`, 5000);
      } else if (type === 'postgresql') {
        const result = await executeRaw(
          `sudo -u postgres psql -c "ALTER ROLE postgres WITH PASSWORD '${newPassword}'" 2>&1`,
          10000
        );
        if (result.code !== 0) {
          return res.status(400).json({
            success: false,
            error: result.stderr || 'Erro ao alterar senha do PostgreSQL',
          });
        }
      } else if (type === 'mongodb') {
        const result = await executeRaw(
          `sudo mongosh --quiet --eval "db.changeUserPassword('root','${newPassword}')" 2>&1`,
          10000
        );
        // If root doesn't exist, try admin
        if (result.code !== 0) {
          const result2 = await executeRaw(
            `sudo mongosh --quiet --eval "db.getSiblingDB('admin').changeUserPassword('admin','${newPassword}')" 2>&1`,
            10000
          );
          if (result2.code !== 0) {
            return res.status(400).json({
              success: false,
              error: 'Erro ao alterar senha do MongoDB. Verifique se o usuário admin existe.',
            });
          }
        }
      }

      return res.status(200).json({ success: true, data: { changed: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
