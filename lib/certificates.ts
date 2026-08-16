/**
 * Registro de certificados.
 *
 * Duas mudanças de fundo em relação à versão anterior:
 *
 * 1. A validade nunca é armazenada como verdade — ela é relida do arquivo a
 *    cada listagem. O JSON é cache, o disco é a fonte.
 * 2. O vínculo com sites (`associatedSites`) é derivado de sites.json em vez de
 *    mantido em paralelo. O campo antigo era criado como `[]` e nunca atualizado,
 *    então a trava que impedia apagar um certificado em uso nunca disparava.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { readJson, writeJson, ensureDir, withFileLock } from './fsx';
import { readCertMetadata, getCertStatus, CertStatus, CertMetadata } from './ssl';
import { readSites } from './sites';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');
export const MANAGED_CERTS_DIR = '/etc/ssl/duart-panel/certs';

export type CertType = 'letsencrypt' | 'manual' | 'cloudflare';

export interface StoredCertificate {
  id: string;
  /** Nome da lineage no certbot; é por ele que a renovação é feita. */
  certName?: string | null;
  domains: string[];
  type: CertType;
  method?: 'http' | 'dns';
  certPath: string;
  keyPath: string;
  chainPath: string | null;
  autoRenew: boolean;
  createdAt: string;
  updatedAt?: string;
  lastRenewedAt?: string | null;
}

export interface EnrichedCertificate extends StoredCertificate {
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
  daysRemaining: number | null;
  status: CertStatus;
  /** Domínios realmente presentes no certificado, não os que foram digitados. */
  certDomains: string[];
  fileExists: boolean;
  associatedSites: string[];
}

interface CertsFile {
  certificates: StoredCertificate[];
}

function readStored(): StoredCertificate[] {
  ensureDir(SSL_DIR);
  return readJson<CertsFile>(CERTS_FILE, { certificates: [] }).certificates || [];
}

function persist(certificates: StoredCertificate[]): void {
  ensureDir(SSL_DIR);
  writeJson(CERTS_FILE, { certificates });
}

/** Sites que usam este certificado, derivado do registro de sites. */
function sitesUsing(cert: StoredCertificate): string[] {
  return readSites()
    .filter(site => site.ssl && (site.sslCertId === cert.id || site.sslCertPath === cert.certPath))
    .map(site => site.domain);
}

async function enrich(cert: StoredCertificate): Promise<EnrichedCertificate> {
  const metadata: CertMetadata | null = await readCertMetadata(cert.certPath);

  return {
    ...cert,
    issuer: metadata?.issuer ?? null,
    validFrom: metadata?.validFrom ?? null,
    validUntil: metadata?.validUntil ?? null,
    daysRemaining: metadata?.daysRemaining ?? null,
    status: getCertStatus(metadata?.validUntil),
    certDomains: metadata?.domains ?? [],
    fileExists: fs.existsSync(cert.certPath),
    associatedSites: sitesUsing(cert),
  };
}

export async function listCertificates(): Promise<EnrichedCertificate[]> {
  return Promise.all(readStored().map(enrich));
}

export function findCertificate(id: string): StoredCertificate | null {
  return readStored().find(c => c.id === id) ?? null;
}

export function findByCertName(certName: string): StoredCertificate | null {
  return readStored().find(c => c.certName === certName) ?? null;
}

export function findByPath(certPath: string): StoredCertificate | null {
  return readStored().find(c => c.certPath === certPath) ?? null;
}

export interface RegisterInput {
  type: CertType;
  domains: string[];
  certPath: string;
  keyPath: string;
  chainPath?: string | null;
  certName?: string | null;
  method?: 'http' | 'dns';
  autoRenew?: boolean;
}

/**
 * Registra (ou atualiza) um certificado.
 * Reemitir o mesmo domínio atualiza o registro existente em vez de duplicá-lo.
 */
export async function registerCertificate(input: RegisterInput): Promise<StoredCertificate> {
  return withFileLock(CERTS_FILE, async () => {
    const certificates = readStored();

    const existingIndex = certificates.findIndex(c =>
      (input.certName && c.certName === input.certName) || c.certPath === input.certPath,
    );

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const updated: StoredCertificate = {
        ...certificates[existingIndex],
        domains: input.domains,
        certPath: input.certPath,
        keyPath: input.keyPath,
        chainPath: input.chainPath ?? null,
        certName: input.certName ?? certificates[existingIndex].certName ?? null,
        autoRenew: input.autoRenew ?? certificates[existingIndex].autoRenew,
        updatedAt: now,
      };
      certificates[existingIndex] = updated;
      persist(certificates);
      return updated;
    }

    const created: StoredCertificate = {
      id: randomUUID(),
      certName: input.certName ?? null,
      domains: input.domains,
      type: input.type,
      method: input.method,
      certPath: input.certPath,
      keyPath: input.keyPath,
      chainPath: input.chainPath ?? null,
      autoRenew: input.autoRenew ?? input.type === 'letsencrypt',
      createdAt: now,
    };

    certificates.push(created);
    persist(certificates);
    return created;
  });
}

export async function updateCertificate(
  id: string,
  updates: Partial<Pick<StoredCertificate, 'autoRenew' | 'domains' | 'certName' | 'lastRenewedAt'>>,
): Promise<StoredCertificate | null> {
  return withFileLock(CERTS_FILE, async () => {
    const certificates = readStored();
    const index = certificates.findIndex(c => c.id === id);
    if (index === -1) return null;

    certificates[index] = { ...certificates[index], ...updates, updatedAt: new Date().toISOString() };
    persist(certificates);
    return certificates[index];
  });
}

export class CertificateInUseError extends Error {
  readonly sites: string[];
  constructor(sites: string[]) {
    super(`Certificado em uso pelos sites: ${sites.join(', ')}. Remova o SSL desses sites antes.`);
    this.name = 'CertificateInUseError';
    this.sites = sites;
  }
}

export async function removeCertificate(id: string, options: { force?: boolean } = {}): Promise<void> {
  return withFileLock(CERTS_FILE, async () => {
    const certificates = readStored();
    const cert = certificates.find(c => c.id === id);
    if (!cert) throw new Error('Certificado não encontrado');

    const inUse = sitesUsing(cert);
    if (inUse.length && !options.force) {
      throw new CertificateInUseError(inUse);
    }

    // Só remove arquivos que o próprio painel criou; certificados do certbot
    // saem pelo `certbot delete`, senão a lineage fica órfã.
    if (cert.certPath.startsWith(MANAGED_CERTS_DIR)) {
      const dir = path.dirname(cert.certPath);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }

    persist(certificates.filter(c => c.id !== id));
  });
}

/**
 * Importa para o registro as lineages do certbot que ainda não estão nele.
 * Cobre o caso de certificados emitidos fora do painel — inclusive os que o
 * setup-ssl.sh antigo apagava ao sobrescrever o certificates.json inteiro.
 */
export async function syncFromCertbot(): Promise<{ imported: number }> {
  const { listCertbotLineages } = await import('./ssl');
  const lineages = await listCertbotLineages();
  const known = new Set(readStored().map(c => c.certPath));

  let imported = 0;
  for (const lineage of lineages) {
    if (known.has(lineage.certPath)) continue;
    await registerCertificate({
      type: 'letsencrypt',
      certName: lineage.name,
      domains: lineage.domains,
      certPath: lineage.certPath,
      keyPath: lineage.keyPath,
      autoRenew: true,
      method: 'http',
    });
    imported++;
  }

  return { imported };
}
