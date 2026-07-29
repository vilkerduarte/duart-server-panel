import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';
import {
  parseNginxConfigFile,
  ParsedVhost,
  generateSiteConfig,
  getDefaultMaintenancePage,
  getMaintenanceFilePath,
  MAINTENANCE_DIR,
  NginxSiteConfig,
} from '@/lib/nginx';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NGINX_DATA_DIR = path.join(DATA_DIR, 'nginx');
const SITES_FILE = path.join(NGINX_DATA_DIR, 'sites.json');
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');

interface NginxSite {
  id: string;
  domain: string;
  type: 'static' | 'php' | 'proxy';
  root?: string;
  proxyPort?: number;
  proxyUrl?: string;
  websocket: boolean;
  phpVersion?: string;
  ssl: boolean;
  sslCertId?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
  sslChainPath?: string;
  enabled: boolean;
  configPath: string;
  fileName?: string;
  managed: boolean;
  maintenance: boolean;
  clientMaxBodySize?: string;
  gzip?: boolean;
  aliases?: string[];
  listenPort?: number;
  hstsMaxAge?: number;
  customDirectives?: string;
  errorPages?: Record<number, string>;
  allowIps?: string[];
  denyIps?: string[];
  authBasicFile?: string;
  authBasicRealm?: string;
  cacheStaticDuration?: string;
  createdAt: string;
  updatedAt?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(NGINX_DATA_DIR)) {
    fs.mkdirSync(NGINX_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SITES_FILE)) {
    fs.writeFileSync(SITES_FILE, JSON.stringify({ sites: [] }, null, 2));
  }
}

function readSites() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
}

function writeSites(data: any) {
  ensureDataDir();
  fs.writeFileSync(SITES_FILE, JSON.stringify(data, null, 2));
}

function readCertificates() {
  if (!fs.existsSync(CERTS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CERTS_FILE, 'utf-8'));
    return data.certificates || [];
  } catch {
    return [];
  }
}

function writeCertificatesJson(certificates: any[]) {
  if (!fs.existsSync(SSL_DIR)) {
    fs.mkdirSync(SSL_DIR, { recursive: true });
  }
  fs.writeFileSync(CERTS_FILE, JSON.stringify({ certificates }, null, 2));
}

function writeNginxConfig(site: NginxSite): string {
  const config: NginxSiteConfig = {
    domain: site.domain,
    type: site.type,
    root: site.root || undefined,
    proxyPort: site.proxyPort || undefined,
    websocket: site.websocket,
    phpVersion: site.phpVersion || undefined,
    ssl: site.ssl,
    sslCertPath: site.sslCertPath,
    sslKeyPath: site.sslKeyPath,
    sslChainPath: site.sslChainPath,
    redirectHttp: site.ssl,
    maintenance: site.maintenance,
    clientMaxBodySize: site.clientMaxBodySize,
    gzip: site.gzip,
    aliases: site.aliases,
    listenPort: site.listenPort,
    hstsMaxAge: site.hstsMaxAge,
    customDirectives: site.customDirectives,
    errorPages: site.errorPages,
    allowIps: site.allowIps,
    denyIps: site.denyIps,
    authBasicFile: site.authBasicFile,
    authBasicRealm: site.authBasicRealm,
    cacheStaticDuration: site.cacheStaticDuration,
  };

  return generateSiteConfig(config);
}

/**
 * Scans the filesystem for NGINX vhosts and parses them.
 */
function scanVhosts(): { managed: NginxSite[]; external: ParsedVhost[] } {
  const data = readSites();
  const managedSites: NginxSite[] = data.sites || [];

  const panelSiteIds = new Map<string, string>();
  for (const site of managedSites) {
    panelSiteIds.set(site.domain, site.id);
  }

  const external: ParsedVhost[] = [];

  const enabledFiles = new Set<string>();
  if (fs.existsSync(NGINX_ENABLED)) {
    const enabled = fs.readdirSync(NGINX_ENABLED);
    for (const f of enabled) {
      enabledFiles.add(f);
    }
  }

  if (fs.existsSync(NGINX_AVAILABLE)) {
    const availableFiles = fs.readdirSync(NGINX_AVAILABLE);
    for (const fileName of availableFiles) {
      if (fileName === 'default' || fileName.endsWith('.bak') || fileName.endsWith('.backup') || fileName.endsWith('~')) {
        continue;
      }

      const configPath = path.join(NGINX_AVAILABLE, fileName);
      let stat;
      try {
        stat = fs.statSync(configPath);
      } catch {
        continue;
      }

      if (!stat.isFile()) continue;

      let content: string;
      try {
        content = fs.readFileSync(configPath, 'utf-8');
      } catch {
        continue;
      }

      const enabled = enabledFiles.has(fileName);
      const parsed = parseNginxConfigFile(content, fileName, configPath, enabled, panelSiteIds);

      if (!parsed.managed) {
        external.push(parsed);
      }
    }
  }

  return { managed: managedSites, external };
}

async function reloadNginx(res: NextApiResponse): Promise<boolean> {
  const testResult = await executeCommand('nginx_test');
  if (testResult.code !== 0) {
    return false;
  }
  await executeCommand('nginx_reload');
  return true;
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    // GET - List all sites (managed + external vhosts)
    if (req.method === 'GET') {
      const { scan, id } = req.query;

      // Get single site (optionally with raw config content)
      if (id && typeof id === 'string') {
        const data = readSites();
        const site = data.sites.find((s: NginxSite) => s.id === id);
        if (!site) {
          return res.status(404).json({ success: false, error: 'Site não encontrado' });
        }

        // If raw=true, include the actual config file content
        if (req.query.raw === 'true') {
          let rawContent = '';
          try {
            if (fs.existsSync(site.configPath)) {
              rawContent = fs.readFileSync(site.configPath, 'utf-8');
            }
          } catch {}
          return res.status(200).json({ success: true, data: { ...site, rawConfig: rawContent } });
        }

        return res.status(200).json({ success: true, data: site });
      }

      if (scan === 'true') {
        const { managed, external } = scanVhosts();
        return res.status(200).json({
          success: true,
          data: {
            managed,
            external,
            totalManaged: managed.length,
            totalExternal: external.length,
          },
        });
      }

      const data = readSites();
      return res.status(200).json({ success: true, data: data.sites });
    }

    // POST - Create new site
    if (req.method === 'POST') {
      const { domain, type, root, proxyPort, proxyUrl, websocket, phpVersion, ...extra } = req.body;

      if (!domain || !type) {
        return res.status(400).json({ success: false, error: 'Domínio e tipo são obrigatórios' });
      }

      const data = readSites();
      if (data.sites.find((s: NginxSite) => s.domain === domain)) {
        return res.status(409).json({ success: false, error: 'Domínio já existe' });
      }

      const existingPath = path.join(NGINX_AVAILABLE, domain);
      if (fs.existsSync(existingPath)) {
        return res.status(409).json({
          success: false,
          error: `Já existe um arquivo de configuração em ${existingPath}. Use a opção Importar.`,
        });
      }

      const id = require('uuid').v4();
      const configPath = path.join(NGINX_AVAILABLE, domain);

      const site: NginxSite = {
        id,
        domain,
        type,
        root: root || null,
        proxyPort: proxyPort || null,
        proxyUrl: proxyUrl || null,
        websocket: !!websocket,
        phpVersion: phpVersion || null,
        ssl: false,
        enabled: true,
        configPath,
        fileName: domain,
        managed: true,
        maintenance: false,
        aliases: extra.aliases || null,
        listenPort: extra.listenPort || null,
        clientMaxBodySize: extra.clientMaxBodySize || null,
        gzip: extra.gzip !== false,
        customDirectives: extra.customDirectives || null,
        createdAt: new Date().toISOString(),
      };

      const configContent = writeNginxConfig(site);
      fs.writeFileSync(configPath, configContent);

      const enabledPath = path.join(NGINX_ENABLED, domain);
      if (!fs.existsSync(enabledPath)) {
        fs.symlinkSync(configPath, enabledPath);
      }

      const reloaded = await reloadNginx(res);
      if (!reloaded) {
        // Rollback
        if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        return res.status(400).json({
          success: false,
          error: 'Configuração NGINX inválida. Verifique os parâmetros.',
        });
      }

      data.sites.push(site);
      writeSites(data);

      return res.status(200).json({ success: true, data: { site, nginxReloaded: true } });
    }

    // PUT - Update site
    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;

      if (!id) {
        return res.status(400).json({ success: false, error: 'ID é obrigatório' });
      }

      const data = readSites();
      const index = data.sites.findIndex((s: NginxSite) => s.id === id);

      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Site não encontrado' });
      }

      const site = data.sites[index];

      // Update fields
      const updatableFields = [
        'domain', 'type', 'root', 'proxyPort', 'proxyUrl', 'websocket',
        'phpVersion', 'ssl', 'sslCertId', 'sslCertPath', 'sslKeyPath', 'sslChainPath',
        'maintenance', 'clientMaxBodySize', 'gzip', 'aliases', 'listenPort',
        'hstsMaxAge', 'customDirectives', 'errorPages', 'allowIps', 'denyIps',
        'authBasicFile', 'authBasicRealm', 'cacheStaticDuration',
      ];

      for (const field of updatableFields) {
        if (updates[field] !== undefined) {
          (site as any)[field] = updates[field];
        }
      }

      site.updatedAt = new Date().toISOString();

      // Rewrite nginx config
      const configContent = writeNginxConfig(site);
      fs.writeFileSync(site.configPath, configContent);

      const reloaded = await reloadNginx(res);
      if (!reloaded) {
        return res.status(400).json({
          success: false,
          error: 'Configuração NGINX inválida após atualização.',
        });
      }

      data.sites[index] = site;
      writeSites(data);

      return res.status(200).json({ success: true, data: { site, nginxReloaded: true } });
    }

    // DELETE - Remove a site
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const data = readSites();
      const index = data.sites.findIndex((s: NginxSite) => s.id === id);

      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Site não encontrado' });
      }

      const site = data.sites[index];

      const enabledPath = path.join(NGINX_ENABLED, site.domain);
      const altEnabledPath = path.join(NGINX_ENABLED, site.fileName || site.domain);
      if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
      if (fs.existsSync(altEnabledPath) && altEnabledPath !== enabledPath) fs.unlinkSync(altEnabledPath);
      if (fs.existsSync(site.configPath)) fs.unlinkSync(site.configPath);

      await executeCommand('nginx_reload');

      data.sites.splice(index, 1);
      writeSites(data);

      return res.status(200).json({ success: true, data: { deleted: true, nginxReloaded: true } });
    }

    // PATCH - Special actions (toggle, maintenance, ssl)
    if (req.method === 'PATCH') {
      const { id, action, ...params } = req.body;

      if (!id || !action) {
        return res.status(400).json({ success: false, error: 'ID e action são obrigatórios' });
      }

      const data = readSites();
      const index = data.sites.findIndex((s: NginxSite) => s.id === id);

      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Site não encontrado' });
      }

      const site = data.sites[index];

      switch (action) {
        // Toggle enable/disable
        case 'toggle': {
          const enabledPath = path.join(NGINX_ENABLED, site.fileName || site.domain);

          if (site.enabled) {
            // Disable: remove symlink
            if (fs.existsSync(enabledPath)) {
              fs.unlinkSync(enabledPath);
            }
            site.enabled = false;
          } else {
            // Enable: create symlink
            if (!fs.existsSync(site.configPath)) {
              return res.status(400).json({
                success: false,
                error: 'Arquivo de configuração não encontrado: ' + site.configPath,
              });
            }
            if (!fs.existsSync(enabledPath)) {
              fs.symlinkSync(site.configPath, enabledPath);
            }
            site.enabled = true;
          }

          await executeCommand('nginx_reload');
          data.sites[index] = site;
          writeSites(data);

          return res.status(200).json({
            success: true,
            data: { site, action: 'toggle', enabled: site.enabled, nginxReloaded: true },
          });
        }

        // Toggle maintenance mode
        case 'maintenance': {
          site.maintenance = !site.maintenance;

          // Write/remove maintenance HTML file on disk
          const maintFilePath = getMaintenanceFilePath(site.domain);
          if (site.maintenance) {
            // Ensure directory exists and write file
            if (!fs.existsSync(MAINTENANCE_DIR)) {
              fs.mkdirSync(MAINTENANCE_DIR, { recursive: true });
            }
            const maintHtml = params.customHtml || getDefaultMaintenancePage(site.domain);
            fs.writeFileSync(maintFilePath, maintHtml);
          } else {
            // Remove maintenance file
            if (fs.existsSync(maintFilePath)) {
              fs.unlinkSync(maintFilePath);
            }
          }

          // Nginx config already has the try_files prefix; just reload
          const maintReloaded = await reloadNginx(res);
          if (!maintReloaded) {
            // Revert maintenance file
            site.maintenance = !site.maintenance;
            if (site.maintenance) {
              fs.writeFileSync(maintFilePath, params.customHtml || getDefaultMaintenancePage(site.domain));
            } else {
              if (fs.existsSync(maintFilePath)) fs.unlinkSync(maintFilePath);
            }
            return res.status(400).json({
              success: false,
              error: 'Falha ao recarregar NGINX no modo manutenção.',
            });
          }

          data.sites[index] = site;
          writeSites(data);

          return res.status(200).json({
            success: true,
            data: { site, action: 'maintenance', maintenance: site.maintenance, nginxReloaded: true },
          });
        }

        // SSL management
        case 'ssl_issue': {
          const { email, certId, certPath, keyPath, chainPath } = params;

          // Case 1: Issue Let's Encrypt
          if (email) {
            const domains = site.aliases
              ? [site.domain, ...site.aliases]
              : [site.domain];

            const args = [
              '--agree-tos',
              '--non-interactive',
              '--email', email,
            ];

            for (const d of domains) {
              args.push('-d', d);
            }

            // Use webroot if static/PHP, otherwise standalone
            if (site.type === 'static' || site.type === 'php') {
              args.push('--webroot', '-w', site.root || '/var/www/html');
            } else {
              args.push('--nginx');
            }

            const result = await executeCommand('certbot_certonly', args);

            if (result.code !== 0) {
              return res.status(400).json({
                success: false,
                error: 'Falha ao emitir certificado: ' + (result.stderr || result.stdout),
              });
            }

            const letsencryptDir = `/etc/letsencrypt/live/${site.domain}`;
            site.ssl = true;
            site.sslCertPath = path.join(letsencryptDir, 'fullchain.pem');
            site.sslKeyPath = path.join(letsencryptDir, 'privkey.pem');
            site.sslChainPath = null;

            // Auto-register certificate in the SSL certificates list
            try {
              const sslCertId = require('uuid').v4();
              const sslCerts = readCertificates();
              const alreadyExists = sslCerts.some((c: any) =>
                c.domains.includes(site.domain) && c.type === 'letsencrypt'
              );
              if (!alreadyExists) {
                sslCerts.push({
                  id: sslCertId,
                  domains: site.aliases ? [site.domain, ...site.aliases] : [site.domain],
                  type: 'letsencrypt',
                  method: 'http',
                  issuer: "Let's Encrypt",
                  validFrom: new Date().toISOString(),
                  validUntil: new Date(Date.now() + 90 * 86400000).toISOString(),
                  certPath: path.join(letsencryptDir, 'fullchain.pem'),
                  keyPath: path.join(letsencryptDir, 'privkey.pem'),
                  chainPath: null,
                  autoRenew: true,
                  renewDaysBefore: 5,
                  associatedSites: [site.domain],
                  createdAt: new Date().toISOString(),
                });
                writeCertificatesJson(sslCerts);
                site.sslCertId = sslCertId;
              }
            } catch {
              // Non-fatal: certificate issued but registration in list failed
            }
          }
          // Case 2: Use existing certificate by ID
          else if (certId) {
            const certs = readCertificates();
            const cert = certs.find((c: any) => c.id === certId);
            if (!cert) {
              return res.status(404).json({ success: false, error: 'Certificado não encontrado' });
            }

            site.ssl = true;
            site.sslCertId = certId;
            site.sslCertPath = cert.certPath;
            site.sslKeyPath = cert.keyPath;
            site.sslChainPath = cert.chainPath || null;
          }
          // Case 3: Manual certificate paths
          else if (certPath && keyPath) {
            site.ssl = true;
            site.sslCertPath = certPath;
            site.sslKeyPath = keyPath;
            site.sslChainPath = chainPath || null;
          }
          else {
            return res.status(400).json({ success: false, error: 'Forneça email, certId ou certPath+keyPath' });
          }

          // Regenerate config with SSL
          const sslConfigContent = writeNginxConfig(site);
          fs.writeFileSync(site.configPath, sslConfigContent);

          const sslReloaded = await reloadNginx(res);
          if (!sslReloaded) {
            site.ssl = false;
            site.sslCertPath = undefined;
            site.sslKeyPath = undefined;
            site.sslChainPath = undefined;
            site.sslCertId = undefined;
            const revertContent = writeNginxConfig(site);
            fs.writeFileSync(site.configPath, revertContent);
            await executeCommand('nginx_reload');
            return res.status(400).json({
              success: false,
              error: 'Configuração NGINX inválida com SSL. Verifique os certificados.',
            });
          }

          data.sites[index] = site;
          writeSites(data);

          return res.status(200).json({
            success: true,
            data: { site, action: 'ssl_issue', ssl: true, nginxReloaded: true },
          });
        }

        // Remove SSL
        case 'ssl_remove': {
          site.ssl = false;
          site.sslCertId = undefined;
          site.sslCertPath = undefined;
          site.sslKeyPath = undefined;
          site.sslChainPath = undefined;

          const noSslConfig = writeNginxConfig(site);
          fs.writeFileSync(site.configPath, noSslConfig);

          const noSslReloaded = await reloadNginx(res);
          if (!noSslReloaded) {
            return res.status(400).json({
              success: false,
              error: 'Erro ao aplicar configuração sem SSL.',
            });
          }

          data.sites[index] = site;
          writeSites(data);

          return res.status(200).json({
            success: true,
            data: { site, action: 'ssl_remove', ssl: false, nginxReloaded: true },
          });
        }

        // Save raw NGINX configuration manually
        case 'raw_config': {
          const { configContent } = params;

          if (!configContent || typeof configContent !== 'string' || configContent.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Conteúdo da configuração é obrigatório' });
          }

          // Write the raw config directly
          fs.writeFileSync(site.configPath, configContent);

          // Test and reload
          const rawReloaded = await reloadNginx(res);
          if (!rawReloaded) {
            return res.status(400).json({
              success: false,
              error: 'Configuração NGINX inválida. Corrija os erros e tente novamente.',
            });
          }

          return res.status(200).json({
            success: true,
            data: { site, action: 'raw_config', nginxReloaded: true },
          });
        }

        default:
          return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
      }
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
