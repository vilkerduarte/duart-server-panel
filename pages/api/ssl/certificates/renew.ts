import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { findCertificate, updateCertificate } from '@/lib/certificates';
import { renewCertificate } from '@/lib/ssl';
import { nginxReload } from '@/lib/nginx-ops';

/**
 * Renovação sob demanda.
 *
 * A versão anterior chamava `certbot renew` global e, ao ver exit 0, gravava
 * validade = agora + 90 dias. Mas exit 0 é o retorno normal quando o certbot
 * decide que ainda não é hora de renovar — então o painel marcava três meses de
 * folga sem ter renovado nada, e nunca mais tentava. Aqui a renovação é por
 * lineage e o "renovou de fato?" vem de comparar o notAfter antes e depois.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { id, force } = req.body ?? {};
  if (!id) return res.status(400).json({ success: false, error: 'ID do certificado é obrigatório' });

  const cert = findCertificate(id);
  if (!cert) return res.status(404).json({ success: false, error: 'Certificado não encontrado' });

  if (cert.type !== 'letsencrypt') {
    return res.status(400).json({
      success: false,
      error: 'Apenas certificados Let\'s Encrypt são renováveis automaticamente. Substitua o arquivo pela tela de importação.',
    });
  }

  const certName = cert.certName || cert.domains[0];
  if (!certName) {
    return res.status(400).json({ success: false, error: 'Certificado sem lineage identificada. Sincronize a lista de certificados.' });
  }

  try {
    const result = await renewCertificate(certName, { force: Boolean(force) });

    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error ?? 'Falha na renovação' });
    }

    if (result.renewed) {
      await updateCertificate(id, { lastRenewedAt: new Date().toISOString() });
      await nginxReload();
    }

    return res.status(200).json({
      success: true,
      data: {
        renewed: result.renewed,
        validUntil: result.metadata?.validUntil ?? null,
        daysRemaining: result.metadata?.daysRemaining ?? null,
        message: result.renewed
          ? 'Certificado renovado e NGINX recarregado.'
          : `Ainda não era hora de renovar — o certificado é válido por mais ${result.metadata?.daysRemaining ?? '?'} dias. Use "forçar" se precisar reemitir agora.`,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
