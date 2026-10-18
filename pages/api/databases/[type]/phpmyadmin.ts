import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { respondWithError } from '@/lib/api-helpers';
import { startInstallJob, runningInstallJob } from '@/lib/mysql';
import { phpMyAdminStatus, installPhpMyAdmin, setPhpMyAdminPublic } from '@/lib/phpmyadmin';

/**
 * phpMyAdmin no host do painel.
 *
 * GET  → estado, caminho (`/phpmyadmin_<seed>/`) e se o acesso público está ligado.
 * POST `{ action: 'install' }` → job em segundo plano (acompanhar por
 *      /api/databases/mysql/install?job=<id>).
 * POST `{ action: 'enable' | 'disable' }` → regrava o snippet com nginx -t e rollback.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.query.type !== 'mysql') {
    return res.status(400).json({ success: false, error: 'phpMyAdmin só está disponível para MySQL/MariaDB' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, data: phpMyAdminStatus() });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Método não permitido' });
    }

    const action = req.body?.action;

    if (action === 'install') {
      if (runningInstallJob()) {
        return res.status(409).json({ success: false, error: 'Já existe uma instalação em andamento' });
      }
      const job = startInstallJob(async log => ({ phpMyAdmin: await installPhpMyAdmin(log) }));
      return res.status(202).json({ success: true, data: { jobId: job.id } });
    }

    if (action === 'enable' || action === 'disable') {
      await setPhpMyAdminPublic(action === 'enable');
      return res.status(200).json({ success: true, data: phpMyAdminStatus() });
    }

    return res.status(400).json({ success: false, error: 'Ação inválida' });
  } catch (err) {
    return respondWithError(res, err);
  }
});
