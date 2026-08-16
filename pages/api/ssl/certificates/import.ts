import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { listCertificates, syncFromCertbot } from '@/lib/certificates';
import { listCertbotLineages } from '@/lib/ssl';

/**
 * Importa para o painel os certificados emitidos fora dele.
 *
 * A versão anterior varria /etc/letsencrypt/live à mão, inferia a validade
 * quando o openssl falhava ("agora + 90 dias") e escrevia o certificates.json
 * diretamente. Agora a origem é o próprio certbot — que sabe qual lineage está
 * ativa, inclusive quando o diretório tem sufixo (`dominio-0001`) — e a
 * gravação passa pelo registro, que faz merge e lê a validade real do disco.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    // GET apenas relata o que seria importado, sem gravar nada.
    if (req.method === 'GET') {
      const lineages = await listCertbotLineages();
      const known = new Set((await listCertificates()).map(c => c.certPath));

      return res.status(200).json({
        success: true,
        data: {
          available: lineages.map(l => ({
            name: l.name,
            domains: l.domains,
            certPath: l.certPath,
            alreadyImported: known.has(l.certPath),
          })),
        },
      });
    }

    const { imported } = await syncFromCertbot();
    const certificates = await listCertificates();

    return res.status(200).json({
      success: true,
      data: {
        imported,
        total: certificates.length,
        certificates,
        message: imported > 0
          ? `${imported} certificado(s) importado(s).`
          : 'Nenhum certificado novo encontrado — todos já estavam registrados.',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});
