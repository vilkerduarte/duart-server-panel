import type { NextApiResponse } from 'next';
import fs from 'fs';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readSites, renderSiteConfig, updateSite, ManagedSite } from '@/lib/sites';
import { ensureScaffoldSync, NginxConfigError } from '@/lib/nginx-ops';
import { unifiedDiff, describeDiff } from '@/lib/diff';

/**
 * Regenera os vhosts dos sites gerenciados.
 *
 * Uma instalação que vem da versão anterior tem os arquivos de vhost no formato
 * antigo: sem IPv6, sem o snippet de desafio ACME e com o `try_files` de
 * manutenção que nunca aciona. Eles continuam servindo tráfego, mas só recebem
 * as correções quando são reescritos.
 *
 * Reescrever é destrutivo para quem editou o arquivo à mão, então o padrão é
 * simulação: devolve o diff de cada site e não toca em nada. A aplicação é
 * site a site, cada uma dentro da transação que reverte se o `nginx -t` reprovar.
 */

interface SiteReport {
  id: string;
  domain: string;
  configPath: string;
  status: 'atualizado' | 'desatualizado' | 'editado-manualmente' | 'arquivo-ausente' | 'aplicado' | 'falhou';
  changes?: string;
  diff?: string;
  error?: string;
}

/** Um vhost sem o cabeçalho do painel provavelmente foi editado à mão. */
function looksHandEdited(content: string): boolean {
  return !content.includes('# Duart Panel');
}

function inspect(site: ManagedSite): SiteReport {
  const base = { id: site.id, domain: site.domain, configPath: site.configPath };

  if (!fs.existsSync(site.configPath)) {
    return { ...base, status: 'arquivo-ausente' };
  }

  const current = fs.readFileSync(site.configPath, 'utf-8');
  const generated = renderSiteConfig(site);
  const diff = unifiedDiff(current, generated, {
    fromLabel: `${site.configPath} (atual)`,
    toLabel: `${site.configPath} (gerado)`,
  });

  if (diff.identical) {
    return { ...base, status: 'atualizado' };
  }

  return {
    ...base,
    status: looksHandEdited(current) ? 'editado-manualmente' : 'desatualizado',
    changes: describeDiff(diff),
    diff: diff.text.substring(0, 20000),
  };
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    ensureScaffoldSync();

    const sites = readSites();
    const requested: string[] | null = Array.isArray(req.body?.domains) ? req.body.domains : null;
    const target = requested ? sites.filter(s => requested.includes(s.domain)) : sites;

    // GET, ou POST sem apply, apenas relata.
    const apply = req.method === 'POST' && req.body?.apply === true;

    if (!apply) {
      const reports = target.map(inspect);
      return res.status(200).json({
        success: true,
        data: {
          dryRun: true,
          total: reports.length,
          upToDate: reports.filter(r => r.status === 'atualizado').length,
          outdated: reports.filter(r => r.status === 'desatualizado').length,
          handEdited: reports.filter(r => r.status === 'editado-manualmente').length,
          sites: reports,
        },
      });
    }

    // Aplicar em site com edição manual exige confirmação explícita: o arquivo
    // é sobrescrito e as customizações se perdem.
    const includeHandEdited = req.body?.includeHandEdited === true;
    const reports: SiteReport[] = [];

    for (const site of target) {
      const report = inspect(site);

      if (report.status === 'atualizado') {
        reports.push(report);
        continue;
      }
      if (report.status === 'editado-manualmente' && !includeHandEdited) {
        reports.push({
          ...report,
          error: 'Arquivo com edições manuais. Reenvie com includeHandEdited=true para sobrescrever.',
        });
        continue;
      }
      if (report.status === 'arquivo-ausente') {
        reports.push(report);
        continue;
      }

      try {
        // updateSite grava dentro da transação: se o nginx -t reprovar, o
        // arquivo anterior volta byte a byte antes de o erro chegar aqui.
        await updateSite(site.id, {});
        reports.push({ ...report, status: 'aplicado' });
      } catch (err) {
        reports.push({
          ...report,
          status: 'falhou',
          error: err instanceof NginxConfigError
            ? `NGINX rejeitou: ${err.message}`
            : (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    const applied = reports.filter(r => r.status === 'aplicado').length;
    const failed = reports.filter(r => r.status === 'falhou').length;

    return res.status(200).json({
      success: failed === 0,
      data: {
        dryRun: false,
        applied,
        failed,
        skipped: reports.length - applied - failed,
        sites: reports,
        message: failed === 0
          ? `${applied} vhost(s) regenerado(s).`
          : `${applied} regenerado(s), ${failed} falharam — os que falharam mantiveram a configuração anterior.`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});
