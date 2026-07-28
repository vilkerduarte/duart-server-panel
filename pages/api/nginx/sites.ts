import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';
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

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const data = readSites();
      return res.status(200).json({ success: true, data: data.sites });
    }

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
        createdAt: new Date().toISOString(),
      };

      data.sites.push(site);
      writeSites(data);

      return res.status(200).json({ success: true, data: { site, nginxReloaded: true } });
    }

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
