import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');
const SSL_CERTS_DIR = '/etc/ssl/duart-panel/certs';

interface Certificate {
  id: string;
  domains: string[];
  type: 'letsencrypt' | 'manual' | 'cloudflare';
  method?: 'http' | 'dns';
  issuer: string;
  validFrom: string;
  validUntil: string;
  certPath: string;
  keyPath: string;
  chainPath: string | null;
  autoRenew: boolean;
  renewDaysBefore: number;
  associatedSites: string[];
  createdAt: string;
}

function ensureDir() {
  if (!fs.existsSync(SSL_DIR)) fs.mkdirSync(SSL_DIR, { recursive: true });
  if (!fs.existsSync(CERTS_FILE)) {
    fs.writeFileSync(CERTS_FILE, JSON.stringify({ certificates: [] }, null, 2));
  }
  if (!fs.existsSync(SSL_CERTS_DIR)) {
    fs.mkdirSync(SSL_CERTS_DIR, { recursive: true });
  }
}

function readCerts(): Certificate[] {
  ensureDir();
  try {
    const data = JSON.parse(fs.readFileSync(CERTS_FILE, 'utf-8'));
    return data.certificates || [];
  } catch {
    return [];
  }
}

function writeCerts(certs: Certificate[]) {
  ensureDir();
  fs.writeFileSync(CERTS_FILE, JSON.stringify({ certificates: certs }, null, 2));
}

function getCertStatus(validUntil: string): 'valid' | 'expiring_soon' | 'expired' {
  const now = new Date();
  const expiry = new Date(validUntil);
  const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) return 'expired';
  if (daysUntil < 7) return 'expiring_soon';
  return 'valid';
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  ensureDir();

  // GET - List all certificates
  if (req.method === 'GET') {
    const certs = readCerts();
    const enriched = certs.map(cert => ({
      ...cert,
      status: getCertStatus(cert.validUntil),
    }));
    return res.status(200).json({ success: true, data: enriched });
  }

  // POST - Create/register new certificate
  if (req.method === 'POST') {
    const { type, domains, method, email, cert, key, chain, certPath, keyPath, chainPath } = req.body;

    if (!type || !domains || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ success: false, error: 'Tipo e domínios são obrigatórios' });
    }

    const id = require('uuid').v4();
    const mainDomain = domains[0].replace(/^\*\./, 'wildcard.');
    const certDir = path.join(SSL_CERTS_DIR, mainDomain);

    try {
      // Handle different certificate types
      if (type === 'letsencrypt') {
        if (!email) {
          return res.status(400).json({ success: false, error: 'Email é obrigatório para Let\'s Encrypt' });
        }

        fs.mkdirSync(certDir, { recursive: true });

        // Build certbot command
        const args = [
          '--agree-tos',
          '--non-interactive',
          '--email', email,
        ];

        // Add domain arguments
        for (const domain of domains) {
          args.push('-d', domain);
        }

        // Challenge method
        if (method === 'dns') {
          args.push('--manual', '--preferred-challenges', 'dns');
        } else {
          args.push('--webroot', '-w', '/var/www/html');
        }

        const result = await executeCommand('certbot_certonly', args);

        if (result.code !== 0) {
          return res.status(400).json({
            success: false,
            error: 'Falha ao emitir certificado: ' + (result.stderr || result.stdout),
          });
        }

        // Determine cert paths from certbot output - use REAL Let's Encrypt paths
        const letsencryptDir = `/etc/letsencrypt/live/${domains[0]}`;
        const finalCertPath = path.join(letsencryptDir, 'fullchain.pem');
        const finalKeyPath = path.join(letsencryptDir, 'privkey.pem');

        const cert: Certificate = {
          id,
          domains,
          type: 'letsencrypt',
          method: method || 'http',
          issuer: 'Let\'s Encrypt',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 90 * 86400000).toISOString(),
          certPath: finalCertPath,
          keyPath: finalKeyPath,
          chainPath: null,
          autoRenew: true,
          renewDaysBefore: 5,
          associatedSites: [],
          createdAt: new Date().toISOString(),
        };

        const certs = readCerts();
        certs.push(cert);
        writeCerts(certs);

        return res.status(200).json({
          success: true,
          data: { certificate: { ...cert, status: 'valid' } },
        });

      } else if (type === 'manual') {
        if (!cert || !key) {
          return res.status(400).json({ success: false, error: 'Certificado e chave privada são obrigatórios' });
        }

        fs.mkdirSync(certDir, { recursive: true });
        fs.writeFileSync(path.join(certDir, 'cert.pem'), cert);
        fs.writeFileSync(path.join(certDir, 'privkey.pem'), key);
        if (chain) fs.writeFileSync(path.join(certDir, 'chain.pem'), chain);

        // Try to parse validity from cert
        let validUntil = new Date(Date.now() + 365 * 86400000).toISOString();
        let issuer = 'Manual';
        try {
          const parseResult = await executeRaw(`openssl x509 -in "${path.join(certDir, 'cert.pem')}" -noout -enddate -issuer 2>/dev/null`, 5000);
          const endMatch = parseResult.stdout.match(/notAfter=(.+)/);
          if (endMatch) validUntil = new Date(endMatch[1].trim()).toISOString();
          const issuerMatch = parseResult.stdout.match(/issuer=\s*(.+)/);
          if (issuerMatch) issuer = issuerMatch[1].trim();
        } catch {}

        const newCert: Certificate = {
          id,
          domains,
          type: 'manual',
          issuer,
          validFrom: new Date().toISOString(),
          validUntil,
          certPath: path.join(certDir, 'cert.pem'),
          keyPath: path.join(certDir, 'privkey.pem'),
          chainPath: chain ? path.join(certDir, 'chain.pem') : null,
          autoRenew: false,
          renewDaysBefore: 5,
          associatedSites: [],
          createdAt: new Date().toISOString(),
        };

        const certs = readCerts();
        certs.push(newCert);
        writeCerts(certs);

        return res.status(200).json({
          success: true,
          data: { certificate: { ...newCert, status: getCertStatus(validUntil) } },
        });

      } else if (type === 'cloudflare') {
        if (!certPath || !keyPath) {
          return res.status(400).json({ success: false, error: 'Caminhos do certificado e chave são obrigatórios' });
        }

        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
          return res.status(400).json({ success: false, error: 'Arquivos de certificado não encontrados nos caminhos informados' });
        }

        // Try to parse validity
        let validUntil = new Date(Date.now() + 365 * 86400000).toISOString();
        let issuer = 'Cloudflare';
        try {
          const parseResult = await executeRaw(`openssl x509 -in "${certPath}" -noout -enddate -issuer 2>/dev/null`, 5000);
          const endMatch = parseResult.stdout.match(/notAfter=(.+)/);
          if (endMatch) validUntil = new Date(endMatch[1].trim()).toISOString();
          const issuerMatch = parseResult.stdout.match(/issuer=\s*(.+)/);
          if (issuerMatch) issuer = issuerMatch[1].trim();
        } catch {}

        const newCert: Certificate = {
          id,
          domains,
          type: 'cloudflare',
          issuer,
          validFrom: new Date().toISOString(),
          validUntil,
          certPath,
          keyPath,
          chainPath: chainPath || null,
          autoRenew: false,
          renewDaysBefore: 5,
          associatedSites: [],
          createdAt: new Date().toISOString(),
        };

        const certs = readCerts();
        certs.push(newCert);
        writeCerts(certs);

        return res.status(200).json({
          success: true,
          data: { certificate: { ...newCert, status: getCertStatus(validUntil) } },
        });
      }

      return res.status(400).json({ success: false, error: 'Tipo de certificado inválido' });

    } catch (err: any) {
      // Cleanup on failure
      if (fs.existsSync(certDir)) {
        fs.rmSync(certDir, { recursive: true, force: true });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // DELETE - Remove certificate
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID é obrigatório' });
    }

    const certs = readCerts();
    const index = certs.findIndex(c => c.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado' });
    }

    const cert = certs[index];

    // Check if associated with any sites
    if (cert.associatedSites.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Este certificado está associado a sites. Remova a associação primeiro.',
      });
    }

    // Remove cert files if they're in our managed directory
    if (cert.certPath.startsWith(SSL_CERTS_DIR)) {
      const certDir = path.dirname(cert.certPath);
      if (fs.existsSync(certDir)) {
        fs.rmSync(certDir, { recursive: true, force: true });
      }
    }

    certs.splice(index, 1);
    writeCerts(certs);

    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
