import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');
const LETSENCRYPT_LIVE = '/etc/letsencrypt/live';

interface Certificate {
  id: string;
  domains: string[];
  type: 'letsencrypt';
  method: 'http';
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

async function getCertExpiry(certPath: string): Promise<Date> {
  try {
    const result = await executeRaw(
      `openssl x509 -in "${certPath}" -noout -enddate 2>/dev/null`,
      5000
    );
    const match = result.stdout.match(/notAfter=(.+)/);
    if (match) return new Date(match[1].trim());
  } catch {}
  // Default: 90 days from now
  return new Date(Date.now() + 90 * 86400000);
}

async function getCertIssuer(certPath: string): Promise<string> {
  try {
    const result = await executeRaw(
      `openssl x509 -in "${certPath}" -noout -issuer 2>/dev/null`,
      5000
    );
    const match = result.stdout.match(/issuer\s*=\s*(.+)/);
    if (match) return match[1].trim();
  } catch {}
  return "Let's Encrypt";
}

async function getCertDomains(certPath: string): Promise<string[]> {
  try {
    const result = await executeRaw(
      `openssl x509 -in "${certPath}" -noout -ext subjectAltName 2>/dev/null`,
      5000
    );
    // Parse DNS: entries from X509v3 Subject Alternative Name
    const dnsMatches = result.stdout.matchAll(/DNS:([^\s,]+)/g);
    const domains: string[] = [];
    for (const m of dnsMatches) {
      domains.push(m[1].trim());
    }
    if (domains.length > 0) return domains;
  } catch {}

  // Fallback: try to get CN from subject
  try {
    const result = await executeRaw(
      `openssl x509 -in "${certPath}" -noout -subject 2>/dev/null`,
      5000
    );
    const match = result.stdout.match(/CN\s*=\s*([^\s,/]+)/);
    if (match) return [match[1].trim()];
  } catch {}

  return [];
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    if (!fs.existsSync(LETSENCRYPT_LIVE)) {
      return res.status(200).json({
        success: true,
        data: { imported: 0, message: 'Diretório /etc/letsencrypt/live/ não encontrado' },
      });
    }

    const existingCerts = readCerts();
    const existingPaths = new Set(existingCerts.map(c => path.resolve(c.certPath)));
    const imported: Certificate[] = [];
    const skipped: string[] = [];

    const entries = fs.readdirSync(LETSENCRYPT_LIVE);

    for (const entry of entries) {
      const domainDir = path.join(LETSENCRYPT_LIVE, entry);

      // Skip non-directories and special entries
      if (entry.startsWith('.') || entry === 'README') continue;

      let stat;
      try {
        stat = fs.statSync(domainDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const fullchainPath = path.join(domainDir, 'fullchain.pem');
      const privkeyPath = path.join(domainDir, 'privkey.pem');

      if (!fs.existsSync(fullchainPath) || !fs.existsSync(privkeyPath)) {
        skipped.push(`${entry} (arquivos incompletos)`);
        continue;
      }

      const resolvedCertPath = path.resolve(fullchainPath);

      // Check if already imported
      if (existingPaths.has(resolvedCertPath)) {
        skipped.push(`${entry} (já importado)`);
        continue;
      }

      // Extract certificate info
      const domains = await getCertDomains(fullchainPath);
      const mainDomain = domains[0] || entry;

      // Check duplicate by main domain
      const domainExists = existingCerts.some(
        c => c.domains.includes(mainDomain) && c.type === 'letsencrypt'
      );
      if (domainExists) {
        skipped.push(`${entry} (domínio ${mainDomain} já possui certificado)`);
        continue;
      }

      const validUntil = await getCertExpiry(fullchainPath);
      const issuer = await getCertIssuer(fullchainPath);

      const cert: Certificate = {
        id: require('uuid').v4(),
        domains: domains.length > 0 ? domains : [entry],
        type: 'letsencrypt',
        method: 'http',
        issuer,
        validFrom: new Date().toISOString(),
        validUntil: validUntil.toISOString(),
        certPath: fullchainPath,
        keyPath: privkeyPath,
        chainPath: null,
        autoRenew: true,
        renewDaysBefore: 5,
        associatedSites: [],
        createdAt: new Date().toISOString(),
      };

      imported.push(cert);
      existingCerts.push(cert);
    }

    writeCerts(existingCerts);

    return res.status(200).json({
      success: true,
      data: {
        imported: imported.length,
        skipped: skipped.length,
        certificates: imported,
        skippedDetails: skipped,
        message: imported.length > 0
          ? `${imported.length} certificado(s) importado(s) com sucesso`
          : 'Nenhum certificado novo encontrado para importar',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
