import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  applyPool, poolConfigPath, poolSocketPath, poolUserName, ensurePoolUser,
  diagnosePhpSite, readSlowLog, POOL_PRESETS, phpSizeFromNginx,
} from '@/lib/php';
import { getSiteByDomain, updateSite } from '@/lib/sites';
import { respondWithError } from '@/lib/api-helpers';

/**
 * Pool FPM por site.
 *
 * Sem pool dedicado todos os sites usam o pool `www`: mesmo usuário, mesmos
 * workers, e um script PHP de um site consegue ler os arquivos — inclusive
 * credenciais de banco — de todos os outros.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const domain = String(req.query.domain ?? req.body?.domain ?? '');
  if (!domain) return res.status(400).json({ success: false, error: 'Domínio é obrigatório' });

  const site = getSiteByDomain(domain);
  if (!site) return res.status(404).json({ success: false, error: 'Site não encontrado' });
  if (site.type !== 'php') return res.status(400).json({ success: false, error: 'O site não é do tipo PHP' });

  const version = site.phpVersion || '8.4';
  const configPath = poolConfigPath(version, domain);

  try {
    if (req.method === 'GET') {
      const socket = site.phpSocket || poolSocketPath(domain);
      return res.status(200).json({
        success: true,
        data: {
          domain,
          version,
          configPath,
          socket,
          user: poolUserName(domain),
          exists: fs.existsSync(configPath),
          config: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '',
          diagnosis: await diagnosePhpSite(version, socket, site.root || ''),
          slowLog: readSlowLog(domain, 60),
          presets: POOL_PRESETS,
        },
      });
    }

    if (req.method === 'PUT') {
      const {
        preset, maxChildren, memoryLimit, uploadMaxFilesize, postMaxSize,
        maxExecutionTime, maxInputVars, displayErrors, allowUrlFopen, disableFunctions,
      } = req.body ?? {};

      const base = POOL_PRESETS[preset as string] ?? POOL_PRESETS.padrao;
      const root = site.root || `/var/www/${domain}`;
      const user = await ensurePoolUser(domain, root);

      // O limite do NGINX e os do PHP precisam andar juntos: o usuário aumenta
      // client_max_body_size, o upload continua falhando no PHP, e nada na tela
      // explica por quê.
      const fromNginx = phpSizeFromNginx(site.clientMaxBodySize || undefined);

      const result = await applyPool({
        domain,
        version,
        user,
        group: user,
        root,
        ...base,
        maxChildren: maxChildren ?? base.maxChildren,
        memoryLimit: memoryLimit ?? base.memoryLimit,
        uploadMaxFilesize: uploadMaxFilesize ?? fromNginx ?? base.uploadMaxFilesize,
        postMaxSize: postMaxSize ?? fromNginx ?? base.postMaxSize,
        maxExecutionTime: maxExecutionTime ?? base.maxExecutionTime,
        maxInputVars: maxInputVars ?? base.maxInputVars,
        displayErrors: Boolean(displayErrors),
        allowUrlFopen: allowUrlFopen !== false,
        disableFunctions: Array.isArray(disableFunctions) ? disableFunctions : undefined,
      });

      if (!result.ok) {
        return res.status(400).json({ success: false, error: `PHP-FPM rejeitou a configuração: ${result.error}` });
      }

      if (site.phpSocket !== result.socket || site.phpPreset !== preset) {
        await updateSite(site.id, { phpSocket: result.socket, phpPreset: preset ?? 'padrao' });
      }

      return res.status(200).json({ success: true, data: { domain, socket: result.socket, applied: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err) {
    return respondWithError(res, err);
  }
});
