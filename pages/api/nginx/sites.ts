import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  readSites, getSite, createSite, updateSite, deleteSite,
  toggleSite, setMaintenance, attachCertificate, detachCertificate,
  writeRawConfig, readRawConfig, scanVhosts, reconcileEnabledFlags,
  SiteError,
} from '@/lib/sites';
import { NginxConfigError, ensureScaffoldSync } from '@/lib/nginx-ops';
import { issueCertificate, readCertMetadata } from '@/lib/ssl';
import { registerCertificate, findCertificate } from '@/lib/certificates';
import { readConfig } from '@/lib/data/config';

/**
 * Toda escrita de vhost passa por lib/sites, que aplica as mudanças dentro de
 * uma transação: se o `nginx -t` reprovar, o arquivo anterior volta byte a byte
 * antes de o erro chegar aqui. Antes, um PUT rejeitado deixava a configuração
 * inválida no disco e travava qualquer operação futura em todos os sites.
 */

function handleError(res: NextApiResponse, err: unknown) {
  if (err instanceof NginxConfigError) {
    return res.status(400).json({ success: false, error: `NGINX rejeitou a configuração: ${err.message}` });
  }
  if (err instanceof SiteError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ success: false, error: message });
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    ensureScaffoldSync();

    /* ---------------------------- GET ---------------------------- */

    if (req.method === 'GET') {
      const { scan, id, raw } = req.query;

      if (typeof id === 'string' && id) {
        const site = getSite(id);
        if (!site) return res.status(404).json({ success: false, error: 'Site não encontrado' });

        if (raw === 'true') {
          return res.status(200).json({ success: true, data: { ...site, rawConfig: readRawConfig(id) } });
        }
        return res.status(200).json({ success: true, data: site });
      }

      if (scan === 'true') {
        const { managed, external } = scanVhosts();
        return res.status(200).json({
          success: true,
          data: { managed, external, totalManaged: managed.length, totalExternal: external.length },
        });
      }

      return res.status(200).json({ success: true, data: reconcileEnabledFlags() });
    }

    /* ---------------------------- POST --------------------------- */

    if (req.method === 'POST') {
      const site = await createSite(req.body ?? {});
      return res.status(200).json({ success: true, data: { site, nginxReloaded: true } });
    }

    /* ---------------------------- PUT ---------------------------- */

    if (req.method === 'PUT') {
      const { id, ...updates } = req.body ?? {};
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      const site = await updateSite(id, updates);
      return res.status(200).json({ success: true, data: { site, nginxReloaded: true } });
    }

    /* --------------------------- DELETE -------------------------- */

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '');
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      await deleteSite(id, { removeFiles: req.query.removeFiles === 'true' });
      return res.status(200).json({ success: true, data: { deleted: true, nginxReloaded: true } });
    }

    /* --------------------------- PATCH --------------------------- */

    if (req.method === 'PATCH') {
      const { id, action, ...params } = req.body ?? {};
      if (!id || !action) {
        return res.status(400).json({ success: false, error: 'ID e action são obrigatórios' });
      }

      const existing = getSite(id);
      if (!existing) return res.status(404).json({ success: false, error: 'Site não encontrado' });

      switch (action) {
        case 'toggle': {
          const site = await toggleSite(id);
          return res.status(200).json({
            success: true,
            data: { site, action, enabled: site.enabled, nginxReloaded: true },
          });
        }

        case 'maintenance': {
          const enabled = params.enabled !== undefined ? Boolean(params.enabled) : !existing.maintenance;
          const site = await setMaintenance(id, enabled, {
            customHtml: params.customHtml,
            bypassIps: params.bypassIps,
          });
          return res.status(200).json({
            success: true,
            data: { site, action, maintenance: site.maintenance },
          });
        }

        case 'ssl_issue': {
          const { email, certId, certPath, keyPath, chainPath } = params;

          // 1) Emitir um certificado novo pelo Let's Encrypt.
          if (email) {
            const domains = existing.aliases?.length
              ? [existing.domain, ...existing.aliases]
              : [existing.domain];

            const result = await issueCertificate({ domains, email, certName: existing.domain });
            if (!result.ok || !result.certPath || !result.keyPath) {
              return res.status(400).json({ success: false, error: result.error ?? 'Falha ao emitir certificado' });
            }

            const registered = await registerCertificate({
              type: 'letsencrypt',
              certName: result.certName,
              domains,
              certPath: result.certPath,
              keyPath: result.keyPath,
              chainPath: null,
              autoRenew: true,
            });

            const site = await attachCertificate(id, {
              certPath: result.certPath,
              keyPath: result.keyPath,
              certId: registered.id,
            });

            return res.status(200).json({
              success: true,
              data: {
                site,
                action,
                ssl: true,
                certificate: registered,
                validUntil: result.metadata?.validUntil,
                daysRemaining: result.metadata?.daysRemaining,
              },
            });
          }

          // 2) Reaproveitar um certificado já registrado.
          if (certId) {
            const cert = findCertificate(certId);
            if (!cert) return res.status(404).json({ success: false, error: 'Certificado não encontrado' });

            const site = await attachCertificate(id, {
              certPath: cert.certPath,
              keyPath: cert.keyPath,
              chainPath: cert.chainPath,
              certId: cert.id,
            });
            return res.status(200).json({ success: true, data: { site, action, ssl: true } });
          }

          // 3) Caminhos informados manualmente.
          if (certPath && keyPath) {
            const metadata = await readCertMetadata(certPath);
            if (!metadata) {
              return res.status(400).json({
                success: false,
                error: 'Não foi possível ler o certificado no caminho informado. Confira o arquivo.',
              });
            }
            const site = await attachCertificate(id, { certPath, keyPath, chainPath: chainPath ?? null });
            return res.status(200).json({
              success: true,
              data: { site, action, ssl: true, validUntil: metadata.validUntil, daysRemaining: metadata.daysRemaining },
            });
          }

          return res.status(400).json({ success: false, error: 'Informe email, certId ou certPath + keyPath' });
        }

        case 'ssl_remove': {
          const site = await detachCertificate(id);
          return res.status(200).json({ success: true, data: { site, action, ssl: false, nginxReloaded: true } });
        }

        case 'raw_config': {
          const site = await writeRawConfig(id, params.configContent);
          return res.status(200).json({ success: true, data: { site, action, nginxReloaded: true } });
        }

        default:
          return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
      }
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err) {
    return handleError(res, err);
  }
});
