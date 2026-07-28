import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NGINX_DATA_DIR = path.join(DATA_DIR, 'nginx');
const SITES_FILE = path.join(NGINX_DATA_DIR, 'sites.json');
const NGINX_AVAILABLE = '/etc/nginx/sites-available';

interface NginxSite {
  id: string;
  domain: string;
  type: 'static' | 'php' | 'proxy';
  root: string | null;
  proxyPort: number | null;
  proxyUrl: string | null;
  websocket: boolean;
  phpVersion: string | null;
  ssl: boolean;
  enabled: boolean;
  configPath: string;
  fileName: string | null;
  managed: boolean;
  createdAt: string;
}

function readSites() {
  if (!fs.existsSync(NGINX_DATA_DIR)) {
    fs.mkdirSync(NGINX_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SITES_FILE)) {
    fs.writeFileSync(SITES_FILE, JSON.stringify({ sites: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
}

function writeSites(data: any) {
  if (!fs.existsSync(NGINX_DATA_DIR)) {
    fs.mkdirSync(NGINX_DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(SITES_FILE, JSON.stringify(data, null, 2));
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { fileName, domain, type, root, proxyPort, websocket } = req.body;

    if (!fileName) {
      return res.status(400).json({ success: false, error: 'fileName é obrigatório' });
    }

    const configPath = path.join(NGINX_AVAILABLE, fileName);

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ success: false, error: `Arquivo ${configPath} não encontrado` });
    }

    const data = readSites();

    // Use provided domain or derive from filename
    const siteDomain = domain || fileName;

    // Check if already imported
    const existing = data.sites.find((s: NginxSite) => s.domain === siteDomain || s.configPath === configPath);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Este vhost já foi importado' });
    }

    // Try to extract proxy port from proxy_pass
    let detectedType: 'static' | 'php' | 'proxy' = type || 'static';
    let extractedPort: number | null = null;

    if (!type) {
      const content = fs.readFileSync(configPath, 'utf-8');
      if (content.includes('fastcgi_pass')) {
        detectedType = 'php';
      } else if (content.includes('proxy_pass')) {
        detectedType = 'proxy';
        // Try to extract port from proxy_pass
        const match = content.match(/proxy_pass\s+https?:\/\/[^:]+:(\d+)/);
        if (match) {
          extractedPort = parseInt(match[1]);
        } else {
          // Check for localhost:port
          const localMatch = content.match(/proxy_pass\s+https?:\/\/localhost:(\d+)/);
          if (localMatch) {
            extractedPort = parseInt(localMatch[1]);
          }
        }
      } else if (content.includes('root')) {
        detectedType = 'static';
      }
    }

    const id = require('uuid').v4();

    const site: NginxSite = {
      id,
      domain: siteDomain,
      type: detectedType,
      root: root || null,
      proxyPort: proxyPort || extractedPort || null,
      proxyUrl: null,
      websocket: !!websocket,
      phpVersion: null,
      ssl: false,
      enabled: true,
      configPath,
      fileName,
      managed: true,
      createdAt: new Date().toISOString(),
    };

    data.sites.push(site);
    writeSites(data);

    return res.status(200).json({
      success: true,
      data: { site, message: `Vhost ${fileName} importado com sucesso` },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
