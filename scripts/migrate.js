#!/usr/bin/env node
/**
 * Duart Panel — migração de instalação existente.
 *
 * Adequa o estado em disco de uma instalação antiga ao formato da versão nova.
 * Nada é apagado: os campos que saíram do schema continuam no arquivo (são
 * ignorados na leitura) e tudo é copiado para um backup antes de qualquer
 * escrita.
 *
 * Uso:
 *   node scripts/migrate.js            # só relata o que faria (padrão)
 *   node scripts/migrate.js --apply    # aplica
 *   node scripts/migrate.js --apply --no-backup
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_BACKUP = args.includes('--no-backup');

const C = {
  red: '\x1b[0;31m', green: '\x1b[0;32m', yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m', dim: '\x1b[2m', reset: '\x1b[0m',
};

const changes = [];
const warnings = [];
const manual = [];

const info = m => console.log(`${C.blue}[info]${C.reset} ${m}`);
const ok = m => console.log(`${C.green}[ok]${C.reset} ${m}`);
const warn = m => { warnings.push(m); console.log(`${C.yellow}[atenção]${C.reset} ${m}`); };
const change = m => { changes.push(m); console.log(`${C.green}[muda]${C.reset} ${m}`); };
const todo = m => { manual.push(m); console.log(`${C.yellow}[manual]${C.reset} ${m}`); };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  if (!APPLY) return;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o640 });
  fs.renameSync(tmp, file);
}

/* ------------------------------------------------------------------ */
/*  Backup                                                             */
/* ------------------------------------------------------------------ */

function backup() {
  if (SKIP_BACKUP) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(DATA_DIR, 'backups', `pre-migracao-${stamp}.tar.gz`);

  if (!APPLY) {
    info(`Backup seria gravado em ${target}`);
    return target;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const sources = [DATA_DIR, NGINX_AVAILABLE, NGINX_ENABLED, '/etc/letsencrypt/renewal']
    .filter(dir => fs.existsSync(dir));

  try {
    // --exclude do próprio diretório de backups evita o tar se auto-incluir.
    execFileSync('tar', [
      'czf', target,
      '--exclude', path.join(DATA_DIR, 'backups'),
      '--warning=no-file-changed',
      ...sources,
    ], { stdio: 'pipe' });
    ok(`Backup gravado: ${target} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
    return target;
  } catch (err) {
    // tar retorna 1 para "arquivo mudou durante a leitura", que aqui é benigno.
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      ok(`Backup gravado: ${target}`);
      return target;
    }
    warn(`Falha no backup: ${err.message}. Continue apenas se tiver um snapshot da VM.`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  config.json                                                        */
/* ------------------------------------------------------------------ */

function migrateConfig() {
  const file = path.join(DATA_DIR, 'settings', 'config.json');
  if (!fs.existsSync(file)) { warn('config.json não encontrado — instalação nova?'); return; }

  const config = readJson(file, null);
  if (!config) { warn('config.json ilegível; não será alterado'); return; }

  const before = JSON.stringify(config);

  // Campos novos, todos com valor conservador.
  if (config.aiBaseUrl === undefined) { config.aiBaseUrl = ''; change('config: aiBaseUrl (endpoint da IA configurável)'); }
  if (config.aiProvider === undefined) { config.aiProvider = 'deepseek'; change('config: aiProvider'); }
  if (config.aiDefaultMode === undefined) { config.aiDefaultMode = 'assisted'; change('config: aiDefaultMode = assisted'); }
  if (config.sslContactEmail === undefined) { config.sslContactEmail = ''; change('config: sslContactEmail'); }
  if (config.fileManagerRoots === undefined) { config.fileManagerRoots = []; change('config: fileManagerRoots (raízes do gerenciador de arquivos)'); }

  // O alerta de expiração era 5 dias; o Let's Encrypt recomenda 30.
  if (Number(config.sslRenewDaysBefore) > 0 && Number(config.sslRenewDaysBefore) < 30) {
    change(`config: sslRenewDaysBefore ${config.sslRenewDaysBefore} → 30 (recomendação do Let's Encrypt)`);
    config.sslRenewDaysBefore = 30;
  }

  if (JSON.stringify(config) !== before) {
    config.updatedAt = new Date().toISOString();
    writeJsonAtomic(file, config);
  } else {
    ok('config.json já está no formato novo');
  }
}

/* ------------------------------------------------------------------ */
/*  sites.json                                                         */
/* ------------------------------------------------------------------ */

function migrateSites() {
  const file = path.join(DATA_DIR, 'nginx', 'sites.json');
  if (!fs.existsSync(file)) { info('Nenhum site registrado'); return []; }

  const data = readJson(file, { sites: [] });
  const sites = Array.isArray(data.sites) ? data.sites : [];
  if (!sites.length) { info('Nenhum site registrado'); return []; }

  let touched = 0;

  for (const site of sites) {
    if (!site.fileName) { site.fileName = site.domain; touched++; }
    if (site.ipv6 === undefined) { site.ipv6 = true; touched++; }
    if (site.managed === undefined) { site.managed = true; touched++; }

    // O pool PHP dedicado é criado na primeira vez que o site for salvo ou
    // regenerado; até lá o site segue no pool padrão da versão.
    if (site.type === 'php' && site.phpPoolManaged === undefined) {
      site.phpPoolManaged = true;
      site.phpPreset = site.phpPreset || 'padrao';
      touched++;
    }
  }

  if (touched) {
    change(`sites.json: ${touched} campo(s) preenchido(s) em ${sites.length} site(s)`);
    writeJsonAtomic(file, { ...data, sites });
  } else {
    ok(`sites.json já está no formato novo (${sites.length} site(s))`);
  }

  return sites;
}

/* ------------------------------------------------------------------ */
/*  certificates.json                                                  */
/* ------------------------------------------------------------------ */

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

function certExpiry(certPath) {
  try {
    const out = execFileSync(
      'openssl',
      ['x509', '-noout', '-in', certPath, '-enddate'],
      // stderr em pipe: sem isso o "no such file" do openssl vaza para o relatório.
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const notAfter = out.match(/notAfter=(.+)/)?.[1]?.trim();
    if (!notAfter) return null;
    return Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
  } catch {
    return null;
  }
}

function migrateCertificates() {
  const file = path.join(DATA_DIR, 'ssl', 'certificates.json');
  const data = fs.existsSync(file) ? readJson(file, { certificates: [] }) : { certificates: [] };
  const certs = Array.isArray(data.certificates) ? data.certificates : [];

  const lineages = certbotLineages();
  if (!lineages.length && certs.length) {
    warn('certbot não respondeu; os certificados não puderam ser conferidos contra o disco');
  }

  const byPath = new Map(lineages.map(l => [l.certPath, l]));
  let touched = 0;

  for (const cert of certs) {
    // `certName` é o que permite renovar por lineage. Sem ele, a renovação cai
    // no primeiro domínio — que funciona na maioria dos casos, mas erra quando
    // o certbot criou a lineage com sufixo (dominio-0001).
    if (!cert.certName) {
      const lineage = byPath.get(cert.certPath);
      cert.certName = lineage?.name || cert.domains?.[0] || null;
      if (cert.certName) touched++;
    }

    // A validade gravada era sempre "emissão + 90 dias", inventada. Comparar com
    // o disco mostra se algum certificado já venceu sem o painel perceber.
    const realDays = certExpiry(cert.certPath);
    if (realDays === null) {
      warn(`Certificado ${cert.certName || cert.domains?.[0]}: arquivo ausente em ${cert.certPath}`);
    } else {
      const storedDays = cert.validUntil
        ? Math.floor((new Date(cert.validUntil).getTime() - Date.now()) / 86400000)
        : null;

      if (realDays < 0) {
        todo(`Certificado ${cert.certName || cert.domains?.[0]} está VENCIDO há ${-realDays} dia(s). Renove antes de continuar: certbot renew --cert-name ${cert.certName} --force-renewal`);
      } else if (storedDays !== null && Math.abs(storedDays - realDays) > 3) {
        warn(`Certificado ${cert.certName}: painel dizia ${storedDays} dias, o disco diz ${realDays}. A tela passa a mostrar o valor real.`);
      }
    }
  }

  // Lineages emitidas fora do painel entram no registro.
  const known = new Set(certs.map(c => c.certPath));
  let imported = 0;
  for (const lineage of lineages) {
    if (known.has(lineage.certPath)) continue;
    certs.push({
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

  if (touched || imported) {
    if (touched) change(`certificates.json: ${touched} lineage(s) identificada(s)`);
    if (imported) change(`certificates.json: ${imported} certificado(s) importado(s) do certbot`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, { certificates: certs });
  } else if (certs.length) {
    ok(`certificates.json já está no formato novo (${certs.length} certificado(s))`);
  }
}

/* ------------------------------------------------------------------ */
/*  Cron                                                               */
/* ------------------------------------------------------------------ */

function migrateCron() {
  const file = path.join(DATA_DIR, 'cron', 'custom.json');
  if (!fs.existsSync(file)) { info('Nenhum job de cron registrado'); return; }

  const data = readJson(file, { jobs: [] });
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  if (!jobs.length) { info('Nenhum job de cron registrado'); return; }

  let touched = 0;
  for (const job of jobs) {
    if (!job.user) { job.user = 'root'; touched++; }
    if (job.active === undefined) { job.active = true; touched++; }
  }

  if (touched) {
    change(`custom.json: campo "user" preenchido em ${touched} job(s)`);
    writeJsonAtomic(file, { ...data, jobs });
  }

  const ativos = jobs.filter(j => j.active !== false);
  if (ativos.length) {
    // Mudança de comportamento real: até agora esses jobs eram só um registro.
    todo(
      `${ativos.length} job(s) de cron estavam salvos mas NUNCA foram instalados no sistema. ` +
      `A partir de agora eles passam a rodar de verdade (via /etc/cron.d/duart-panel). ` +
      `Revise a lista na tela de Cron e desative o que não quiser executando.`,
    );
    for (const job of ativos) {
      console.log(`${C.dim}        ${job.expression}  ${job.command}${C.reset}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Sobras da versão antiga                                            */
/* ------------------------------------------------------------------ */

function checkLeftovers() {
  // Renovadores concorrentes: o antigo cron.d do painel e o certbot.timer
  // disputavam o mesmo lock e falhavam de forma intermitente.
  if (fs.existsSync('/etc/cron.d/duart-panel-ssl')) {
    change('remove /etc/cron.d/duart-panel-ssl (renovador concorrente com o certbot.timer)');
    if (APPLY) fs.rmSync('/etc/cron.d/duart-panel-ssl', { force: true });
  }

  // O script foi removido do repositório; um cron apontando para ele falharia.
  try {
    const crontab = execFileSync('crontab', ['-l'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (crontab.includes('renew-ssl.js')) {
      todo('O crontab do root chama scripts/renew-ssl.js, que não existe mais. Remova a linha: crontab -e');
    }
  } catch {
    // Sem crontab, nada a fazer.
  }

  // PM2 do painel: o serviço agora é systemd; os dois na mesma porta conflitam.
  try {
    const pm2 = execFileSync('pm2', ['jlist'], { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    const apps = JSON.parse(pm2);
    const painel = apps.find(a => a.name === 'duart-panel');
    if (painel) {
      todo('O painel ainda roda sob PM2. O install.sh remove essa instância e cria o serviço systemd — não faça isso à mão para não ficar com os dois na mesma porta.');
    }
    const outros = apps.filter(a => a.name !== 'duart-panel');
    if (outros.length) {
      info(`PM2 tem ${outros.length} outra(s) aplicação(ões) — elas são preservadas: ${outros.map(a => a.name).join(', ')}`);
    }
  } catch {
    // PM2 ausente é o caso normal daqui pra frente.
  }

  // Backups que versões anteriores deixavam dentro de sites-available. O painel
  // varre esse diretório, então cada um aparecia como se fosse outro vhost.
  try {
    const strays = fs.readdirSync(NGINX_AVAILABLE).filter(f => /\.bak(-|$)/.test(f));
    if (strays.length) {
      change(`move ${strays.length} backup(s) de sites-available para ${DATA_DIR}/backups/nginx (apareciam como vhosts duplicados)`);
      if (APPLY) {
        const dest = path.join(DATA_DIR, 'backups', 'nginx');
        fs.mkdirSync(dest, { recursive: true });
        for (const file of strays) {
          fs.renameSync(path.join(NGINX_AVAILABLE, file), path.join(dest, file));
        }
      }
    }
  } catch {}

  // ecosystem.config.js do painel deixa de ser usado.
  const eco = path.join(path.dirname(__dirname), 'ecosystem.config.js');
  if (fs.existsSync(eco)) {
    info('ecosystem.config.js não é mais usado pelo painel (pode ser removido depois de confirmar o systemd)');
  }
}

/* ------------------------------------------------------------------ */
/*  vhosts em formato antigo                                           */
/* ------------------------------------------------------------------ */

function checkVhosts(sites) {
  if (!sites.length) return;

  const desatualizados = [];
  const manuais = [];
  const ausentes = [];

  for (const site of sites) {
    const file = site.configPath || path.join(NGINX_AVAILABLE, site.fileName || site.domain);
    if (!fs.existsSync(file)) {
      ausentes.push(site.domain);
      warn(`Site ${site.domain}: o arquivo ${file} não existe — o site está registrado mas não servido`);
      continue;
    }

    const content = fs.readFileSync(file, 'utf-8');
    const gerenciado = content.includes('# Duart Panel');
    const novoFormato = content.includes('snippets/duart-acme.conf') || content.includes('duart-acme.conf');

    if (!gerenciado) {
      manuais.push(site.domain);
    } else if (!novoFormato) {
      desatualizados.push(site.domain);
    }
  }

  if (desatualizados.length) {
    todo(
      `${desatualizados.length} vhost(s) ainda no formato antigo: ${desatualizados.join(', ')}. ` +
      `Eles continuam funcionando, mas sem IPv6, sem o modo manutenção funcional e sem os snippets. ` +
      `Regenere pela tela de NGINX (botão "Regenerar configurações") depois de subir a versão nova.`,
    );
  }

  if (manuais.length) {
    warn(
      `${manuais.length} vhost(s) parecem ter sido editados à mão: ${manuais.join(', ')}. ` +
      `NÃO os regenere sem antes copiar as customizações — a regeneração sobrescreve o arquivo.`,
    );
  }

  if (ausentes.length) {
    todo(
      `${ausentes.length} site(s) sem arquivo de vhost: ${ausentes.join(', ')}. ` +
      `Regenere pela tela de NGINX para recriá-los, ou remova o registro se não forem mais usados.`,
    );
  }

  const intactos = sites.length - desatualizados.length - manuais.length - ausentes.length;
  if (intactos === sites.length) {
    ok(`Todos os ${sites.length} vhost(s) já estão no formato novo`);
  } else if (intactos > 0) {
    ok(`${intactos} de ${sites.length} vhost(s) já estão no formato novo`);
  }
}

/* ------------------------------------------------------------------ */

function main() {
  console.log('');
  console.log('========================================');
  console.log(`   Duart Panel — migração ${APPLY ? '' : `${C.yellow}(simulação)${C.reset}`}`);
  console.log('========================================');
  console.log('');

  if (!APPLY) {
    info('Modo simulação: nada será gravado. Rode com --apply para aplicar.');
    console.log('');
  }

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`${C.red}[erro]${C.reset} ${DATA_DIR} não existe — não há instalação anterior aqui.`);
    process.exit(1);
  }

  backup();
  console.log('');

  migrateConfig();
  const sites = migrateSites();
  migrateCertificates();
  migrateCron();
  checkLeftovers();
  checkVhosts(sites);

  console.log('');
  console.log('========================================');
  console.log(`   ${changes.length} alteração(ões) · ${warnings.length} aviso(s) · ${manual.length} ação(ões) manual(is)`);
  console.log('========================================');

  if (manual.length) {
    console.log('');
    console.log(`${C.yellow}Precisa da sua atenção:${C.reset}`);
    manual.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  }

  if (!APPLY && changes.length) {
    console.log('');
    console.log(`Para aplicar: ${C.blue}sudo node scripts/migrate.js --apply${C.reset}`);
  }
  console.log('');
}

main();
