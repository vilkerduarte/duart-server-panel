/**
 * Certificados TLS — metadados lidos do disco, nunca inferidos.
 *
 * O painel registrava `validUntil` como `agora + 90 dias` em todos os pontos
 * onde um certificado era emitido, importado ou renovado. Isso torna a data
 * exibida uma ficção, e — pior — faz o renovador decidir se precisa renovar
 * com base nessa ficção: ele marcava +90 dias a cada execução bem-sucedida do
 * `certbot renew`, que retorna 0 mesmo quando não renova nada. O certificado
 * vencia enquanto a tela mostrava três meses de folga.
 *
 * Aqui a única fonte de verdade é o arquivo de certificado.
 */

import fs from 'fs';
import path from 'path';
import { execFileSafe, executeCommand, needsSudo } from './system';

export const LETSENCRYPT_LIVE = '/etc/letsencrypt/live';

export interface CertMetadata {
  validFrom: string;
  validUntil: string;
  issuer: string;
  subject: string;
  domains: string[];
  fingerprint: string | null;
  daysRemaining: number;
}

export type CertStatus = 'valid' | 'expiring_soon' | 'expired' | 'unknown';

function opensslArgs(args: string[]): { bin: string; args: string[] } {
  return needsSudo()
    ? { bin: 'sudo', args: ['-n', 'openssl', ...args] }
    : { bin: 'openssl', args };
}

/** Lê validade, emissor e SANs de um certificado no disco. */
export async function readCertMetadata(certPath: string): Promise<CertMetadata | null> {
  if (!certPath || !fs.existsSync(certPath)) return null;

  const base = opensslArgs(['x509', '-noout', '-in', certPath, '-startdate', '-enddate', '-issuer', '-subject']);
  const info = await execFileSafe(base.bin, base.args, { timeout: 10000 });
  if (info.code !== 0) return null;

  const notBefore = info.stdout.match(/notBefore=(.+)/)?.[1]?.trim();
  const notAfter = info.stdout.match(/notAfter=(.+)/)?.[1]?.trim();
  if (!notAfter) return null;

  const validUntilDate = new Date(notAfter);
  if (Number.isNaN(validUntilDate.getTime())) return null;

  const validFromDate = notBefore ? new Date(notBefore) : new Date();

  const issuerRaw = info.stdout.match(/issuer=\s*(.+)/)?.[1]?.trim() || 'Desconhecido';
  const subjectRaw = info.stdout.match(/subject=\s*(.+)/)?.[1]?.trim() || '';

  const san = opensslArgs(['x509', '-noout', '-in', certPath, '-ext', 'subjectAltName']);
  const sanResult = await execFileSafe(san.bin, san.args, { timeout: 10000 });
  const domains = Array.from(
    new Set(
      (sanResult.stdout.match(/DNS:([^,\s]+)/g) || [])
        .map(d => d.replace('DNS:', '').trim())
        .filter(Boolean),
    ),
  );

  if (!domains.length) {
    const cn = subjectRaw.match(/CN\s*=\s*([^,]+)/)?.[1]?.trim();
    if (cn) domains.push(cn);
  }

  const fp = opensslArgs(['x509', '-noout', '-in', certPath, '-fingerprint', '-sha256']);
  const fpResult = await execFileSafe(fp.bin, fp.args, { timeout: 10000 });
  const fingerprint = fpResult.stdout.match(/Fingerprint=(.+)/i)?.[1]?.trim() || null;

  return {
    validFrom: validFromDate.toISOString(),
    validUntil: validUntilDate.toISOString(),
    issuer: cleanDn(issuerRaw),
    subject: cleanDn(subjectRaw),
    domains,
    fingerprint,
    daysRemaining: daysUntil(validUntilDate),
  };
}

function cleanDn(dn: string): string {
  const cn = dn.match(/CN\s*=\s*([^,/]+)/)?.[1]?.trim();
  const org = dn.match(/O\s*=\s*([^,/]+)/)?.[1]?.trim();
  if (cn && org && cn !== org) return `${org} (${cn})`;
  return cn || org || dn;
}

export function daysUntil(date: Date | string): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return 0;
  return Math.floor((target.getTime() - Date.now()) / 86400000);
}

/**
 * O Let's Encrypt recomenda renovar aos 30 dias restantes. O limiar antigo
 * (avisar com 7 dias, renovar com 5) deixava margem menor que a de uma falha
 * de renovação seguida de fim de semana.
 */
export function getCertStatus(validUntil: string | null | undefined, warnDays = 30): CertStatus {
  if (!validUntil) return 'unknown';
  const days = daysUntil(validUntil);
  if (Number.isNaN(days)) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= warnDays) return 'expiring_soon';
  return 'valid';
}

/* ------------------------------------------------------------------ */
/*  Lineages do certbot                                                */
/* ------------------------------------------------------------------ */

export interface CertbotLineage {
  name: string;
  domains: string[];
  certPath: string;
  keyPath: string;
  expiryDate: string | null;
  keyType: string | null;
}

/**
 * Lê as lineages reais do certbot.
 *
 * O código anterior montava `/etc/letsencrypt/live/<domínio>` por dedução. Mas
 * quando já existe uma lineage com aquele nome, o certbot cria
 * `<domínio>-0001` — e o painel apontava o NGINX para um diretório inexistente.
 */
export async function listCertbotLineages(): Promise<CertbotLineage[]> {
  const result = await executeCommand('certbot_certificates');
  if (result.code !== 0) return [];

  const lineages: CertbotLineage[] = [];
  let current: Partial<CertbotLineage> | null = null;

  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();

    const nameMatch = trimmed.match(/^Certificate Name:\s*(.+)$/);
    if (nameMatch) {
      if (current?.name && current.certPath) lineages.push(current as CertbotLineage);
      current = { name: nameMatch[1].trim(), domains: [] };
      continue;
    }
    if (!current) continue;

    const domainsMatch = trimmed.match(/^Domains:\s*(.+)$/);
    if (domainsMatch) {
      current.domains = domainsMatch[1].trim().split(/\s+/).filter(Boolean);
      continue;
    }
    const certMatch = trimmed.match(/^Certificate Path:\s*(.+)$/);
    if (certMatch) { current.certPath = certMatch[1].trim(); continue; }

    const keyMatch = trimmed.match(/^Private Key Path:\s*(.+)$/);
    if (keyMatch) { current.keyPath = keyMatch[1].trim(); continue; }

    const expiryMatch = trimmed.match(/^Expiry Date:\s*(\S+\s+\S+)/);
    if (expiryMatch) {
      const parsed = new Date(expiryMatch[1].replace(' ', 'T'));
      current.expiryDate = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      continue;
    }
    const keyTypeMatch = trimmed.match(/^Key Type:\s*(.+)$/);
    if (keyTypeMatch) current.keyType = keyTypeMatch[1].trim();
  }

  if (current?.name && current.certPath) lineages.push(current as CertbotLineage);
  return lineages;
}

export async function findLineage(certName: string): Promise<CertbotLineage | null> {
  const lineages = await listCertbotLineages();
  return lineages.find(l => l.name === certName)
    || lineages.find(l => l.domains.includes(certName))
    || null;
}

/**
 * Resolve os caminhos reais de um certificado emitido.
 * Consulta o certbot; se ele não estiver disponível, cai para a inspeção do
 * diretório live/, escolhendo a lineage de sufixo mais alto.
 */
export async function resolveLineagePaths(
  certName: string,
): Promise<{ certPath: string; keyPath: string; name: string } | null> {
  const lineage = await findLineage(certName);
  if (lineage) {
    return { certPath: lineage.certPath, keyPath: lineage.keyPath, name: lineage.name };
  }

  try {
    const entries = fs.readdirSync(LETSENCRYPT_LIVE)
      .filter(e => e === certName || e.startsWith(`${certName}-`))
      .sort();
    const chosen = entries[entries.length - 1];
    if (!chosen) return null;

    const certPath = path.join(LETSENCRYPT_LIVE, chosen, 'fullchain.pem');
    const keyPath = path.join(LETSENCRYPT_LIVE, chosen, 'privkey.pem');
    if (!fs.existsSync(certPath)) return null;

    return { certPath, keyPath, name: chosen };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Emissão e renovação                                                */
/* ------------------------------------------------------------------ */

export interface IssueOptions {
  domains: string[];
  email?: string;
  certName?: string;
  challenge?: 'http' | 'dns';
  dnsProvider?: 'cloudflare' | 'digitalocean';
  dnsCredentialsPath?: string;
  keyType?: 'ecdsa' | 'rsa';
  webroot?: string;
  dryRun?: boolean;
}

export interface IssueResult {
  ok: boolean;
  certName: string;
  certPath?: string;
  keyPath?: string;
  metadata?: CertMetadata | null;
  error?: string;
}

/**
 * Emite um certificado.
 *
 * Sempre por webroot num diretório único e imutável (`/var/www/acme`), servido
 * por um snippet incluído em todos os vhosts. O plugin `--nginx` foi removido
 * de propósito: ele reescreve o vhost por conta própria, e o painel sobrescreve
 * essa reescrita na edição seguinte — a renovação quebrava no meio.
 */
export async function issueCertificate(options: IssueOptions): Promise<IssueResult> {
  const domains = options.domains.filter(Boolean);
  if (!domains.length) {
    return { ok: false, certName: '', error: 'Informe ao menos um domínio' };
  }

  const certName = options.certName || domains[0].replace(/^\*\./, 'wildcard.');
  const wantsWildcard = domains.some(d => d.startsWith('*.'));
  const challenge = options.challenge || (wantsWildcard ? 'dns' : 'http');

  if (wantsWildcard && challenge !== 'dns') {
    return { ok: false, certName, error: 'Certificado wildcard exige desafio DNS-01' };
  }

  const args: string[] = ['--agree-tos', '--non-interactive', '--cert-name', certName];

  if (options.email) {
    args.push('--email', options.email);
  } else {
    args.push('--register-unsafely-without-email');
  }

  args.push('--key-type', options.keyType || 'ecdsa');

  for (const domain of domains) {
    args.push('-d', domain);
  }

  if (challenge === 'dns') {
    if (!options.dnsProvider || !options.dnsCredentialsPath) {
      return {
        ok: false,
        certName,
        error:
          'Desafio DNS exige um provedor e o arquivo de credenciais. ' +
          'Instale o plugin correspondente (ex.: python3-certbot-dns-cloudflare) e informe o caminho das credenciais.',
      };
    }
    if (!fs.existsSync(options.dnsCredentialsPath)) {
      return { ok: false, certName, error: `Credenciais não encontradas: ${options.dnsCredentialsPath}` };
    }
    if (options.dnsProvider === 'cloudflare') {
      args.push('--dns-cloudflare', '--dns-cloudflare-credentials', options.dnsCredentialsPath);
      args.push('--dns-cloudflare-propagation-seconds', '30');
    } else {
      args.push('--dns-digitalocean', '--dns-digitalocean-credentials', options.dnsCredentialsPath);
    }
  } else {
    args.push('--webroot', '-w', options.webroot || '/var/www/acme');
  }

  if (options.dryRun) args.push('--dry-run');

  const result = await executeCommand('certbot_certonly', args);

  if (result.code !== 0) {
    return { ok: false, certName, error: summarizeCertbotError(result.stderr || result.stdout) };
  }
  if (options.dryRun) {
    return { ok: true, certName };
  }

  const paths = await resolveLineagePaths(certName);
  if (!paths) {
    return { ok: false, certName, error: 'Certificado emitido, mas o caminho da lineage não pôde ser resolvido' };
  }

  const metadata = await readCertMetadata(paths.certPath);
  return { ok: true, certName: paths.name, certPath: paths.certPath, keyPath: paths.keyPath, metadata };
}

/**
 * Renova uma lineage específica e informa se ela realmente mudou.
 *
 * `certbot renew` sai com 0 tanto quando renova quanto quando decide que ainda
 * não é hora. Comparar o `notAfter` antes e depois é o que distingue os dois.
 */
export async function renewCertificate(
  certName: string,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; renewed: boolean; metadata: CertMetadata | null; error?: string }> {
  const before = await resolveLineagePaths(certName);
  const metaBefore = before ? await readCertMetadata(before.certPath) : null;

  const args = ['--cert-name', certName];
  if (options.force) args.push('--force-renewal');

  const result = await executeCommand('certbot_renew', args);
  if (result.code !== 0) {
    return { ok: false, renewed: false, metadata: metaBefore, error: summarizeCertbotError(result.stderr || result.stdout) };
  }

  const after = await resolveLineagePaths(certName);
  const metaAfter = after ? await readCertMetadata(after.certPath) : null;

  const renewed = Boolean(
    metaAfter && (!metaBefore || metaAfter.validUntil !== metaBefore.validUntil),
  );

  return { ok: true, renewed, metadata: metaAfter };
}

function summarizeCertbotError(output: string): string {
  if (!output) return 'Falha no certbot sem mensagem';

  if (/Another instance of Certbot is already running/i.test(output)) {
    return 'Outra execução do certbot está em andamento. Aguarde alguns minutos e tente novamente.';
  }
  if (/too many (certificates|failed authorizations)/i.test(output)) {
    return 'Limite de emissões do Let\'s Encrypt atingido para este domínio. Aguarde a janela de rate limit.';
  }
  if (/DNS problem|NXDOMAIN/i.test(output)) {
    return 'O domínio não resolve para este servidor. Verifique os registros A/AAAA no DNS.';
  }
  if (/Connection refused|Timeout during connect/i.test(output)) {
    return 'O Let\'s Encrypt não conseguiu alcançar a porta 80 deste servidor. Verifique firewall e registro AAAA (IPv6).';
  }

  const relevant = output
    .split('\n')
    .filter(l => /error|failed|problem|detail/i.test(l))
    .slice(0, 4)
    .join(' | ');

  return (relevant || output).substring(0, 500);
}
