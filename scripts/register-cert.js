#!/usr/bin/env node
/**
 * Duart Panel — registra um certificado no painel.
 *
 * Existe porque o shell não deve escrever o certificates.json diretamente: a
 * versão anterior do setup-ssl.sh gravava um arquivo com um array de um único
 * certificado, apagando o registro de todos os outros a cada execução.
 *
 * Aqui a gravação é por merge (chave: caminho do certificado ou nome da
 * lineage) e atômica, e a validade vem do arquivo — nunca de "agora + 90 dias".
 *
 * Uso: node register-cert.js --domain d --cert /path --key /path [--cert-name n]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function readCertMetadata(certPath) {
  try {
    const info = execFileSync(
      'openssl',
      ['x509', '-noout', '-in', certPath, '-startdate', '-enddate', '-issuer'],
      { encoding: 'utf-8', timeout: 10000 },
    );

    const notAfter = info.match(/notAfter=(.+)/)?.[1]?.trim();
    const notBefore = info.match(/notBefore=(.+)/)?.[1]?.trim();
    const issuer = info.match(/issuer=\s*(.+)/)?.[1]?.trim() ?? 'Desconhecido';

    let domains = [];
    try {
      const san = execFileSync(
        'openssl',
        ['x509', '-noout', '-in', certPath, '-ext', 'subjectAltName'],
        { encoding: 'utf-8', timeout: 10000 },
      );
      domains = [...new Set((san.match(/DNS:([^,\s]+)/g) ?? []).map(d => d.replace('DNS:', '').trim()))];
    } catch {}

    return {
      validFrom: notBefore ? new Date(notBefore).toISOString() : new Date().toISOString(),
      validUntil: notAfter ? new Date(notAfter).toISOString() : null,
      issuer,
      domains,
    };
  } catch (err) {
    return null;
  }
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, { mode: 0o640 });
  fs.renameSync(tmp, file);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.cert || !args.key) {
    console.error('Uso: register-cert.js --domain <d> --cert <path> --key <path> [--cert-name <n>]');
    process.exit(1);
  }
  if (!fs.existsSync(args.cert)) {
    console.error(`Certificado não encontrado: ${args.cert}`);
    process.exit(1);
  }

  const metadata = readCertMetadata(args.cert);
  if (!metadata) {
    console.error('Não foi possível ler os metadados do certificado.');
    process.exit(1);
  }

  let stored = { certificates: [] };
  if (fs.existsSync(CERTS_FILE)) {
    try {
      stored = JSON.parse(fs.readFileSync(CERTS_FILE, 'utf-8'));
      if (!Array.isArray(stored.certificates)) stored.certificates = [];
    } catch {
      // Arquivo corrompido: preserva o original antes de recomeçar.
      fs.copyFileSync(CERTS_FILE, `${CERTS_FILE}.corrupted-${Date.now()}`);
      stored = { certificates: [] };
    }
  }

  const certName = args['cert-name'] || args.domain;
  const domains = metadata.domains.length ? metadata.domains : [args.domain].filter(Boolean);

  const index = stored.certificates.findIndex(
    c => c.certPath === args.cert || (certName && c.certName === certName),
  );

  const now = new Date().toISOString();
  const entry = {
    id: index >= 0 ? stored.certificates[index].id : randomUUID(),
    certName,
    domains,
    type: 'letsencrypt',
    method: 'http',
    certPath: args.cert,
    keyPath: args.key,
    chainPath: null,
    autoRenew: true,
    createdAt: index >= 0 ? stored.certificates[index].createdAt : now,
    updatedAt: now,
  };

  if (index >= 0) stored.certificates[index] = entry;
  else stored.certificates.push(entry);

  writeAtomic(CERTS_FILE, JSON.stringify(stored, null, 2) + '\n');

  const days = metadata.validUntil
    ? Math.floor((new Date(metadata.validUntil) - Date.now()) / 86400000)
    : '?';

  console.log(`Registrado: ${certName} (${domains.join(', ')}) — expira em ${days} dias`);
}

main();
