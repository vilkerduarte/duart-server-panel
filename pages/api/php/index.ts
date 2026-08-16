import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  detectPhpVersions, preferredPhpVersion, installPhp, packagesFor,
  COMMON_EXTENSIONS, listPools, poolName, diagnosePhpSite, poolSocketPath,
  fpmTest, POOL_PRESETS,
} from '@/lib/php';
import { executeCommand } from '@/lib/system';
import { readSites } from '@/lib/sites';
import { respondWithError } from '@/lib/api-helpers';

/**
 * Módulo PHP.
 *
 * Antes não existia: a gestão inteira era um `<select>` com quatro versões
 * fixas (8.0 a 8.3) que escrevia uma linha `fastcgi_pass`. No Ubuntu 25.10 o
 * pacote dos repositórios é o php8.4-fpm, então todo site PHP criado apontava
 * para um socket inexistente e nascia em 502 — com o painel reportando sucesso,
 * porque `nginx -t` não valida socket.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const versions = await detectPhpVersions();
      const sites = readSites().filter(s => s.type === 'php');

      const enriched = versions.map(version => ({
        ...version,
        pools: listPools(version.version),
        sites: sites.filter(s => s.phpVersion === version.version).map(s => s.domain),
      }));

      return res.status(200).json({
        success: true,
        data: {
          versions: enriched,
          preferred: await preferredPhpVersion(),
          commonExtensions: COMMON_EXTENSIONS,
          presets: Object.keys(POOL_PRESETS),
          // Sem nenhuma versão instalada, a tela precisa dizer o que fazer.
          needsInstall: enriched.length === 0,
        },
      });
    }

    if (req.method === 'POST') {
      const { action, version, extensions } = req.body ?? {};

      if (!version || !/^\d+\.\d+$/.test(String(version))) {
        return res.status(400).json({ success: false, error: 'Versão inválida (ex.: 8.4)' });
      }

      if (action === 'install') {
        const result = await installPhp(String(version), Array.isArray(extensions) ? extensions : undefined);
        if (!result.ok) {
          return res.status(400).json({
            success: false,
            error: `Falha na instalação: ${result.output.substring(0, 600)}`,
          });
        }
        return res.status(200).json({
          success: true,
          data: { version, packages: packagesFor(String(version), extensions), installed: true },
        });
      }

      if (action === 'restart' || action === 'reload') {
        const key = action === 'restart' ? 'systemctl_restart' : 'systemctl_reload';
        const result = await executeCommand(key, [`php${version}-fpm`]);
        return result.code === 0
          ? res.status(200).json({ success: true, data: { version, action } })
          : res.status(400).json({ success: false, error: result.stderr || 'Falha ao aplicar a ação' });
      }

      if (action === 'test') {
        const result = await fpmTest(String(version));
        return res.status(200).json({ success: true, data: { valid: result.ok, output: result.output } });
      }

      return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err) {
    return respondWithError(res, err);
  }
});
