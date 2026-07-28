#!/usr/bin/env node
/**
 * Duart Panel - SSL Renewal Script
 * Checks certificates and renews those close to expiration.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SSL_DATA_FILE = path.join(DATA_DIR, 'ssl', 'certificates.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'ssl-renewal.log');

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function main() {
  log('=== Iniciando verificação de certificados SSL ===');

  if (!fs.existsSync(SSL_DATA_FILE)) {
    log('Nenhum certificado registrado. Nada a renovar.');
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(SSL_DATA_FILE, 'utf-8'));
  } catch (err) {
    log(`Erro ao ler certificates.json: ${err.message}`);
    return;
  }

  const now = new Date();
  let renewed = 0;
  let failed = 0;

  for (const cert of data.certificates || []) {
    if (!cert.autoRenew || cert.type !== 'letsencrypt') continue;

    const validUntil = new Date(cert.validUntil);
    const daysUntil = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
    const renewDays = cert.renewDaysBefore || 5;

    if (daysUntil > renewDays) {
      log(`Certificado ${cert.domains.join(', ')} ainda válido por ${daysUntil} dias. Pulando.`);
      continue;
    }

    log(`Renovando certificado: ${cert.domains.join(', ')} (expira em ${daysUntil} dias)`);

    // Execute certbot renew
    const { execSync } = require('child_process');
    try {
      const result = execSync('sudo certbot renew --quiet', { timeout: 120000, encoding: 'utf-8' });
      log(`Renovação concluída: ${result.trim()}`);

      // Update validUntil (Let's Encrypt = 90 days)
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 90);
      cert.validUntil = newExpiry.toISOString();
      renewed++;
    } catch (err) {
      log(`Falha na renovação: ${err.stderr || err.message}`);
      failed++;
    }
  }

  // Save updated data
  try {
    fs.writeFileSync(SSL_DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log(`Erro ao salvar certificates.json: ${err.message}`);
  }

  log(`=== Verificação concluída: ${renewed} renovado(s), ${failed} falha(s) ===`);
}

main().catch(err => log(`Erro fatal: ${err.message}`));
