import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';
import { DbInputError } from '@/lib/db';
import {
  MYSQL_VARIANTS, isMysqlVariant, variantAvailability, readOsInfo, planMysqlInstall,
  installMysql, startInstallJob, getInstallJob, runningInstallJob, activeMysqlService,
} from '@/lib/mysql';
import { installPhpMyAdmin } from '@/lib/phpmyadmin';

const DB_PACKAGES: Record<string, string> = { postgresql: 'postgresql', mongodb: 'mongod' };

/**
 * MySQL: GET lista as versões possíveis neste servidor (ou o andamento de um
 * job com `?job=`); POST `{ variant, phpMyAdmin }` inicia a instalação em
 * segundo plano e devolve o id do job.
 */
async function handleMysql(req: AuthenticatedRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const jobId = typeof req.query.job === 'string' ? req.query.job : '';
    if (jobId) {
      const job = getInstallJob(jobId);
      if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado' });
      return res.status(200).json({ success: true, data: job });
    }
    const os = readOsInfo();
    const availability = variantAvailability(os);
    return res.status(200).json({
      success: true,
      data: {
        os: { id: os.id, codename: os.codename, prettyName: os.prettyName },
        variants: MYSQL_VARIANTS.map(v => ({ ...v, ...availability.find(a => a.id === v.id) })),
        runningJob: runningInstallJob()?.id ?? null,
      },
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });

  const variant = req.body?.variant;
  const withPhpMyAdmin = req.body?.phpMyAdmin === true;
  if (!isMysqlVariant(variant)) return res.status(400).json({ success: false, error: 'Versão inválida' });

  try {
    // Valida antes de criar o job, para o erro de "não existe nesta distro" voltar direto.
    planMysqlInstall(variant, readOsInfo());
  } catch (err) {
    return res.status(400).json({ success: false, error: (err as Error).message });
  }

  if (runningInstallJob()) {
    return res.status(409).json({ success: false, error: 'Já existe uma instalação em andamento' });
  }
  if (await activeMysqlService()) {
    return res.status(409).json({ success: false, error: 'MySQL/MariaDB já está instalado e rodando' });
  }

  const job = startInstallJob(async log => {
    const mysql = await installMysql(variant, log);
    if (!withPhpMyAdmin) return { mysql };
    log('Instalando phpMyAdmin');
    const phpMyAdmin = await installPhpMyAdmin(log);
    return { mysql, phpMyAdmin };
  });
  return res.status(202).json({ success: true, data: { jobId: job.id } });
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (type === 'mysql') {
    try {
      return await handleMysql(req, res);
    } catch (err) {
      const status = err instanceof DbInputError ? 400 : 500;
      return res.status(status).json({ success: false, error: (err as Error).message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });

  const pkg = DB_PACKAGES[type as string];
  if (!pkg) return res.status(400).json({ success: false, error: 'Tipo inválido' });

  try {
    // Check if already installed
    const checkResult = await executeCommand('systemctl_status', [type as string]);
    if (checkResult.code !== 4) {
      return res.status(409).json({ success: false, error: 'Já está instalado' });
    }

    const result = await executeCommand('apt_install', [pkg]);

    if (result.code !== 0) {
      return res.status(500).json({ success: false, error: result.stderr || 'Erro na instalação' });
    }

    // Start service
    await executeCommand('systemctl_start', [type as string]);
    await executeCommand('systemctl_enable', [type as string]);

    return res.status(200).json({ success: true, data: { installed: true, serviceStarted: true } });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});
