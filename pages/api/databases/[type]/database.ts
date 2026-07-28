import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });

  const { type } = req.query;
  const { action, name } = req.body;

  if (!action || !name) return res.status(400).json({ success: false, error: 'Ação e nome são obrigatórios' });

  try {
    if (type === 'mysql') {
      if (action === 'create') {
        await executeRaw(`sudo mysql -e "CREATE DATABASE \\\`${name}\\\`"`, 10000);
        return res.status(200).json({ success: true, data: { created: true, name } });
      }
      if (action === 'drop') {
        await executeRaw(`sudo mysql -e "DROP DATABASE IF EXISTS \\\`${name}\\\`"`, 10000);
        return res.status(200).json({ success: true, data: { dropped: true, name } });
      }
    }
    if (type === 'postgresql') {
      if (action === 'create') {
        await executeRaw(`sudo -u postgres createdb "${name}"`, 10000);
        return res.status(200).json({ success: true, data: { created: true, name } });
      }
      if (action === 'drop') {
        await executeRaw(`sudo -u postgres dropdb "${name}"`, 10000);
        return res.status(200).json({ success: true, data: { dropped: true, name } });
      }
    }
    return res.status(400).json({ success: false, error: 'Ação não suportada' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
