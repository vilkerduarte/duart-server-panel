import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  listCertificates, registerCertificate, removeCertificate, updateCertificate,
  syncFromCertbot, CertificateInUseError, MANAGED_CERTS_DIR,
} from '@/lib/certificates';
import { issueCertificate, readCertMetadata } from '@/lib/ssl';
import { ensureDir } from '@/lib/fsx';
import { readConfig } from '@/lib/data/config';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    /* ---------------------------- GET ---------------------------- */

    if (req.method === 'GET') {
      // Traz para o registro qualquer lineage emitida fora do painel.
      if (req.query.sync === 'true') await syncFromCertbot();
      return res.status(200).json({ success: true, data: await listCertificates() });
    }

    /* ---------------------------- POST --------------------------- */

    if (req.method === 'POST') {
      const { type, domains, method, email, cert, key, chain, certPath, keyPath, chainPath, dnsProvider, dnsCredentialsPath } = req.body ?? {};

      if (!type || !Array.isArray(domains) || domains.length === 0) {
        return res.status(400).json({ success: false, error: 'Tipo e domínios são obrigatórios' });
      }

      /* --- Let's Encrypt --- */
      if (type === 'letsencrypt') {
        const contactEmail = email || readConfig().sslContactEmail;
        if (!contactEmail) {
          return res.status(400).json({ success: false, error: 'Email é obrigatório para Let\'s Encrypt' });
        }

        const result = await issueCertificate({
          domains,
          email: contactEmail,
          challenge: method === 'dns' ? 'dns' : 'http',
          dnsProvider,
          dnsCredentialsPath,
        });

        if (!result.ok || !result.certPath || !result.keyPath) {
          return res.status(400).json({ success: false, error: result.error ?? 'Falha ao emitir certificado' });
        }

        const stored = await registerCertificate({
          type: 'letsencrypt',
          certName: result.certName,
          domains,
          certPath: result.certPath,
          keyPath: result.keyPath,
          method: method === 'dns' ? 'dns' : 'http',
          autoRenew: true,
        });

        return res.status(200).json({
          success: true,
          data: {
            certificate: {
              ...stored,
              validUntil: result.metadata?.validUntil ?? null,
              daysRemaining: result.metadata?.daysRemaining ?? null,
              issuer: result.metadata?.issuer ?? null,
            },
          },
        });
      }

      /* --- Certificado colado pelo usuário --- */
      if (type === 'manual') {
        if (!cert || !key) {
          return res.status(400).json({ success: false, error: 'Certificado e chave privada são obrigatórios' });
        }

        const dirName = domains[0].replace(/^\*\./, 'wildcard.').replace(/[^a-zA-Z0-9._-]/g, '_');
        const certDir = path.join(MANAGED_CERTS_DIR, dirName);
        ensureDir(certDir, 0o750);

        const finalCert = path.join(certDir, 'cert.pem');
        const finalKey = path.join(certDir, 'privkey.pem');
        const finalChain = chain ? path.join(certDir, 'chain.pem') : null;

        fs.writeFileSync(finalCert, cert, { mode: 0o644 });
        fs.writeFileSync(finalKey, key, { mode: 0o600 });
        if (finalChain) fs.writeFileSync(finalChain, chain, { mode: 0o644 });

        const metadata = await readCertMetadata(finalCert);
        if (!metadata) {
          fs.rmSync(certDir, { recursive: true, force: true });
          return res.status(400).json({
            success: false,
            error: 'O conteúdo enviado não é um certificado X.509 válido.',
          });
        }

        const stored = await registerCertificate({
          type: 'manual',
          domains: metadata.domains.length ? metadata.domains : domains,
          certPath: finalCert,
          keyPath: finalKey,
          chainPath: finalChain,
          autoRenew: false,
        });

        return res.status(200).json({
          success: true,
          data: { certificate: { ...stored, validUntil: metadata.validUntil, daysRemaining: metadata.daysRemaining, issuer: metadata.issuer } },
        });
      }

      /* --- Certificado já presente no disco (Cloudflare Origin etc.) --- */
      if (type === 'cloudflare') {
        if (!certPath || !keyPath) {
          return res.status(400).json({ success: false, error: 'Caminhos do certificado e da chave são obrigatórios' });
        }
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
          return res.status(400).json({ success: false, error: 'Arquivos não encontrados nos caminhos informados' });
        }

        const metadata = await readCertMetadata(certPath);
        if (!metadata) {
          return res.status(400).json({ success: false, error: 'Não foi possível ler o certificado informado' });
        }

        const stored = await registerCertificate({
          type: 'cloudflare',
          domains: metadata.domains.length ? metadata.domains : domains,
          certPath,
          keyPath,
          chainPath: chainPath ?? null,
          autoRenew: false,
        });

        return res.status(200).json({
          success: true,
          data: { certificate: { ...stored, validUntil: metadata.validUntil, daysRemaining: metadata.daysRemaining, issuer: metadata.issuer } },
        });
      }

      return res.status(400).json({ success: false, error: 'Tipo de certificado inválido' });
    }

    /* ---------------------------- PUT ---------------------------- */

    if (req.method === 'PUT') {
      const { id, autoRenew } = req.body ?? {};
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      const updated = await updateCertificate(id, { autoRenew: Boolean(autoRenew) });
      if (!updated) return res.status(404).json({ success: false, error: 'Certificado não encontrado' });

      return res.status(200).json({ success: true, data: updated });
    }

    /* --------------------------- DELETE -------------------------- */

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '');
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      try {
        await removeCertificate(id, { force: req.query.force === 'true' });
        return res.status(200).json({ success: true, data: { deleted: true } });
      } catch (err) {
        if (err instanceof CertificateInUseError) {
          return res.status(409).json({ success: false, error: err.message, data: { sites: err.sites } });
        }
        throw err;
      }
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
