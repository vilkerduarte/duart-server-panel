import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });

  const { type } = req.query;
  const { action, username, password } = req.body;

  if (!action || !username) return res.status(400).json({ success: false, error: 'Ação e username são obrigatórios' });

  try {
    if (type === 'mysql') {
      if (action === 'create' && password) {
        await executeRaw(`sudo mysql -e "CREATE USER '${username}'@'localhost' IDENTIFIED BY '${password}'"`, 10000);
        await executeRaw(`sudo mysql -e "GRANT ALL PRIVILEGES ON *.* TO '${username}'@'localhost' WITH GRANT OPTION"`, 10000);
        await executeRaw(`sudo mysql -e "FLUSH PRIVILEGES"`, 5000);
        return res.status(200).json({ success: true, data: { created: true, username } });
      }
      if (action === 'drop') {
        await executeRaw(`sudo mysql -e "DROP USER IF EXISTS '${username}'@'localhost'"`, 10000);
        return res.status(200).json({ success: true, data: { dropped: true, username } });
      }
      if (action === 'password' && password) {
        await executeRaw(`sudo mysql -e "ALTER USER '${username}'@'localhost' IDENTIFIED BY '${password}'"`, 10000);
        return res.status(200).json({ success: true, data: { changed: true } });
      }
    }
    if (type === 'postgresql') {
      if (action === 'create' && password) {
        await executeRaw(`sudo -u postgres psql -c "CREATE ROLE ${username} WITH LOGIN PASSWORD '${password}'"`, 10000);
        return res.status(200).json({ success: true, data: { created: true, username } });
      }
      if (action === 'drop') {
        await executeRaw(`sudo -u postgres psql -c "DROP ROLE IF EXISTS ${username}"`, 10000);
        return res.status(200).json({ success: true, data: { dropped: true, username } });
      }
      if (action === 'password' && password) {
        await executeRaw(`sudo -u postgres psql -c "ALTER ROLE ${username} WITH PASSWORD '${password}'"`, 10000);
        return res.status(200).json({ success: true, data: { changed: true } });
      }
    }
    return res.status(400).json({ success: false, error: 'Ação não suportada' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
