import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';
import { parseNginxConfigFile, ParsedVhost } from '@/lib/nginx';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NGINX_DATA_DIR = path.join(DATA_DIR, 'nginx');
const SITES_FILE = path.join(NGINX_DATA_DIR, 'sites.json');
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';

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
  enabled: boolean;
  configPath: string;
  fileName?: string;
  managed: boolean;
  createdAt: string;
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

function generateStaticConfig(domain: string, root: string): string {
  return `server {
    listen 80;
    server_name ${domain};
    root ${root};
    index index.html index.htm;
    location / {
        try_files $uri $uri/ =404;
    }
    access_log /var/log/nginx/${domain}.access.log;
    error_log /var/log/nginx/${domain}.error.log;
}`;
}

function generatePhpConfig(domain: string, root: string, phpVersion: string = '8.3'): string {
  return `server {
    listen 80;
    server_name ${domain};
    root ${root};
    index index.php index.html;
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }
    access_log /var/log/nginx/${domain}.access.log;
    error_log /var/log/nginx/${domain}.error.log;
}`;
}

function generateProxyConfig(domain: string, port: number, websocket: boolean): string {
  let config = `server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`;

  if (websocket) {
    config += `
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;`;
  }

  config += `
    }
}`;
  return config;
}

/**
 * Scans the filesystem for NGINX vhosts and parses them.
 * Returns both managed (panel) and unmanaged (external) vhosts.
 */
function scanVhosts(): { managed: NginxSite[]; external: ParsedVhost[] } {
  const data = readSites();
  const managedSites: NginxSite[] = data.sites || [];

  // Build a map of domain -> panel ID for matching
  const panelSiteIds = new Map<string, string>();
  for (const site of managedSites) {
    panelSiteIds.set(site.domain, site.id);
  }

  const external: ParsedVhost[] = [];

  // Get list of enabled sites (symlinks)
  const enabledFiles = new Set<string>();
  if (fs.existsSync(NGINX_ENABLED)) {
    const enabled = fs.readdirSync(NGINX_ENABLED);
    for (const f of enabled) {
      enabledFiles.add(f);
    }
  }

  // Scan sites-available
  if (fs.existsSync(NGINX_AVAILABLE)) {
    const availableFiles = fs.readdirSync(NGINX_AVAILABLE);
    for (const fileName of availableFiles) {
      // Skip default and backup files
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

      // Skip directories
      if (!stat.isFile()) continue;

      let content: string;
      try {
        content = fs.readFileSync(configPath, 'utf-8');
      } catch {
        continue;
      }

      const enabled = enabledFiles.has(fileName);
      const parsed = parseNginxConfigFile(content, fileName, configPath, enabled, panelSiteIds);

      // Only add as external if NOT already managed by the panel
      if (!parsed.managed) {
        external.push(parsed);
      }
    }
  }

  return { managed: managedSites, external };
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    // GET - List all sites (managed + external vhosts)
    if (req.method === 'GET') {
      const { scan } = req.query;

      // If scan=true, do a full filesystem scan
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

      // Default: return managed sites only (backward compatible)
      const data = readSites();
      return res.status(200).json({ success: true, data: data.sites });
    }

    // POST - Create new site
    if (req.method === 'POST') {
      const { domain, type, root, proxyPort, proxyUrl, websocket, phpVersion } = req.body;

      if (!domain || !type) {
        return res.status(400).json({ success: false, error: 'Domínio e tipo são obrigatórios' });
      }

      // Check duplicate
      const data = readSites();
      if (data.sites.find((s: NginxSite) => s.domain === domain)) {
        return res.status(409).json({ success: false, error: 'Domínio já existe' });
      }

      // Also check if a vhost file already exists on disk
      const existingPath = path.join(NGINX_AVAILABLE, domain);
      if (fs.existsSync(existingPath)) {
        return res.status(409).json({
          success: false,
          error: `Já existe um arquivo de configuração em ${existingPath}. Use a opção Importar.`,
        });
      }

      const id = require('uuid').v4();
      const configPath = path.join(NGINX_AVAILABLE, domain);

      // Generate config based on type
      let configContent = '';
      if (type === 'static') {
        configContent = generateStaticConfig(domain, root || '/var/www/' + domain);
      } else if (type === 'php') {
        configContent = generatePhpConfig(domain, root || '/var/www/' + domain, phpVersion || '8.3');
      } else if (type === 'proxy') {
        configContent = generateProxyConfig(domain, proxyPort || 3000, !!websocket);
      }

      // Write config
      fs.writeFileSync(configPath, configContent);

      // Create symlink
      const enabledPath = path.join(NGINX_ENABLED, domain);
      if (!fs.existsSync(enabledPath)) {
        fs.symlinkSync(configPath, enabledPath);
      }

      // Test nginx config
      const testResult = await executeCommand('nginx_test');
      if (testResult.code !== 0) {
        // Rollback
        if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        return res.status(400).json({
          success: false,
          error: 'Configuração NGINX inválida: ' + testResult.stderr,
        });
      }

      // Reload nginx
      await executeCommand('nginx_reload');

      // Save to local registry
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
        createdAt: new Date().toISOString(),
      };

      data.sites.push(site);
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

      // Remove files
      const enabledPath = path.join(NGINX_ENABLED, site.domain);
      if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
      if (fs.existsSync(site.configPath)) fs.unlinkSync(site.configPath);

      // Reload nginx
      await executeCommand('nginx_reload');

      data.sites.splice(index, 1);
      writeSites(data);

      return res.status(200).json({ success: true, data: { deleted: true, nginxReloaded: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
