#!/usr/bin/env node
/**
 * Duart Panel — auditoria de certificados.
 *
 * Substitui o antigo renew-ssl.js, que renovava por conta própria e era a raiz
 * do pior modo de falha do painel: `certbot renew --quiet` sai com 0 tanto
 * quando renova quanto quando decide que ainda não é hora, e o script tratava
 * todo exit 0 como renovação — gravando validade "agora + 90 dias". O
 * certificado vencia enquanto a tela mostrava três meses de folga.
 *
 * Agora quem renova é o certbot.timer (um único renovador, sem disputa de
 * lock). Este script apenas confere o disco, sincroniza o registro do painel e
 * avisa sobre o que está perto de vencer. Ele nunca inventa uma data.
 *
 * Uso: node check-ssl.js [--json] [--quiet]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CERTS_FILE = path.join(DATA_DIR, 'ssl', 'certificates.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'ssl-renewal.log');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const quiet = args.includes('--quiet');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (!quiet && !asJson) console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function certMetadata(certPath) {
  try {
    const info = execFileSync(
      'openssl',
      ['x509', '-noout', '-in', certPath, '-enddate', '-issuer'],
      { encoding: 'utf-8', timeout: 10000 },
    );
    const notAfter = info.match(/notAfter=(.+)/)?.[1]?.trim();
    if (!notAfter) return null;

    const validUntil = new Date(notAfter);
    return {
      validUntil: validUntil.toISOString(),
      daysRemaining: Math.floor((validUntil.getTime() - Date.now()) / 86400000),
      issuer: info.match(/issuer=\s*(.+)/)?.[1]?.trim() ?? 'Desconhecido',
    };
  } catch {
    return null;
  }
}

function certbotLineages() {
  try {
    const output = execFileSync('certbot', ['certificates'], { encoding: 'utf-8', timeout: 30000 });
    const lineages = [];
    let current = null;

    for (const raw of output.split('\n')) {
      const line = raw.trim();
      const name = line.match(/^Certificate Name:\s*(.+)$/);
      if (name) {
        if (current?.certPath) lineages.push(current);
        current = { name: name[1], domains: [] };
        continue;
      }
      if (!current) continue;

      const domains = line.match(/^Domains:\s*(.+)$/);
      if (domains) { current.domains = domains[1].split(/\s+/); continue; }
      const cert = line.match(/^Certificate Path:\s*(.+)$/);
      if (cert) { current.certPath = cert[1]; continue; }
      const key = line.match(/^Private Key Path:\s*(.+)$/);
      if (key) current.keyPath = key[1];
    }

    if (current?.certPath) lineages.push(current);
    return lineages;
  } catch {
    return [];
  }
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode: 0o640 });
  fs.renameSync(tmp, file);
}

function main() {
  let stored = { certificates: [] };
  if (fs.existsSync(CERTS_FILE)) {
    try {
      stored = JSON.parse(fs.readFileSync(CERTS_FILE, 'utf-8'));
      if (!Array.isArray(stored.certificates)) stored.certificates = [];
    } catch {
      stored = { certificates: [] };
    }
  }

  // Importa lineages emitidas fora do painel, para nenhuma ficar sem monitoramento.
  const known = new Set(stored.certificates.map(c => c.certPath));
  let imported = 0;

  for (const lineage of certbotLineages()) {
    if (known.has(lineage.certPath)) continue;
    stored.certificates.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      certName: lineage.name,
      domains: lineage.domains,
      type: 'letsencrypt',
      method: 'http',
      certPath: lineage.certPath,
      keyPath: lineage.keyPath,
      chainPath: null,
      autoRenew: true,
      createdAt: new Date().toISOString(),
    });
    imported++;
  }

  const report = [];
  let expiring = 0;
  let expired = 0;
  let missing = 0;

  for (const cert of stored.certificates) {
    const metadata = certMetadata(cert.certPath);

    if (!metadata) {
      missing++;
      report.push({ name: cert.certName ?? cert.domains?.[0], status: 'arquivo ausente ou ilegível', path: cert.certPath });
      log(`AUSENTE: ${cert.certPath} não pôde ser lido`);
      continue;
    }

    const status = metadata.daysRemaining < 0
      ? 'expirado'
      : metadata.daysRemaining <= 30 ? 'expirando' : 'válido';

    if (status === 'expirado') expired++;
    if (status === 'expirando') expiring++;

    report.push({
      name: cert.certName ?? cert.domains?.[0],
      domains: cert.domains,
      validUntil: metadata.validUntil,
      daysRemaining: metadata.daysRemaining,
      status,
    });

    if (status !== 'válido') {
      log(`${status.toUpperCase()}: ${cert.certName ?? cert.domains?.[0]} — ${metadata.daysRemaining} dias`);
    }
  }

  if (imported > 0) {
    writeAtomic(CERTS_FILE, JSON.stringify(stored, null, 2) + '\n');
    log(`${imported} certificado(s) importado(s) do certbot`);
  }

  if (asJson) {
    console.log(JSON.stringify({ certificates: report, expiring, expired, missing, imported }, null, 2));
  } else {
    log(`Auditoria: ${report.length} certificado(s) · ${expiring} expirando · ${expired} expirado(s) · ${missing} ausente(s)`);
  }

  // Código de saída diferente de zero permite ao cron ou ao monitoramento
  // disparar alerta sem precisar interpretar a saída.
  process.exit(expired > 0 || missing > 0 ? 2 : expiring > 0 ? 1 : 0);
}

main();
