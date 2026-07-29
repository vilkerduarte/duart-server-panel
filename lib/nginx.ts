/**
 * NGINX configuration helpers.
 * Generates NGINX server block configs for different site types.
 * Also parses existing NGINX vhost files from the filesystem.
 */

export const MAINTENANCE_DIR = '/var/lib/duart-panel/nginx/maintenance';

export interface NginxSiteConfig {
  domain: string;
  type: 'static' | 'php' | 'proxy';
  root?: string;
  proxyPort?: number;
  proxyUrl?: string;
  websocket?: boolean;
  phpVersion?: string;
  ssl?: boolean;
  sslCertPath?: string;
  sslKeyPath?: string;
  sslChainPath?: string;
  redirectHttp?: boolean;
  customDirectives?: string;
  clientMaxBodySize?: string;
  gzip?: boolean;
  errorPages?: Record<number, string>;
  rateLimitZone?: string;
  rateLimitRate?: string;
  allowIps?: string[];
  denyIps?: string[];
  authBasicFile?: string;
  authBasicRealm?: string;
  sslProtocols?: string;
  hstsMaxAge?: number;
  listenPort?: number;
  aliases?: string[];
  accessLogPath?: string;
  errorLogPath?: string;
  maintenance?: boolean;
  maintenancePage?: string;
  cacheStaticDuration?: string;
}

/**
 * Returns the absolute path to the maintenance HTML file for a domain.
 */
export function getMaintenanceFilePath(domain: string): string {
  return `${MAINTENANCE_DIR}/${domain}.html`;
}

/**
 * Returns a default maintenance page HTML.
 */
export function getDefaultMaintenancePage(domain: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Em Manutencao - ${domain}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 600px;
            margin: 1rem;
        }
        .icon { font-size: 4rem; margin-bottom: 1.5rem; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
        h1 { font-size: 2rem; margin-bottom: 1rem; font-weight: 600; }
        p { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 1.5rem; }
        .status { display: inline-block; padding: 0.5rem 1rem; background: rgba(255,193,7,0.15);
                  border: 1px solid rgba(255,193,7,0.3); border-radius: 50px; color: #ffc107;
                  font-size: 0.875rem; font-weight: 500; }
        .footer { margin-top: 2rem; font-size: 0.75rem; color: rgba(255,255,255,0.3); }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">&#x1F527;</div>
        <h1>${domain}</h1>
        <div class="status">&#x26A0;&#xFE0F; Em Manutencao Programada</div>
        <p>Estamos realizando melhorias no servidor.<br>Por favor, tente novamente em alguns minutos.</p>
        <div class="footer">Duart Panel &copy; ${new Date().getFullYear()}</div>
    </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Config generators (standalone, non-SSL)                            */
/* ------------------------------------------------------------------ */

export function generateStaticConfig(domain: string, root: string, extraConfig?: NginxSiteConfig): string {
  const serverNames = [domain, ...(extraConfig?.aliases || [])].join(' ');
  const maintenancePath = `${MAINTENANCE_DIR}/${domain}.html`;
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${serverNames};
    root ${root};
    index index.html index.htm;`;

  config += buildCommonServerOpts(extraConfig, domain);

  config += `

    location / {
        try_files ${maintenancePath} $uri $uri/ =404;`;

  if (extraConfig?.cacheStaticDuration) {
    config += `
        expires ${extraConfig.cacheStaticDuration};`;
  }

  config += `
    }`;

  config += buildExtraServerConfig(extraConfig);

  config += `
}`;
  return config;
}

export function generatePhpConfig(domain: string, root: string, phpVersion: string = '8.3', extraConfig?: NginxSiteConfig): string {
  const serverNames = [domain, ...(extraConfig?.aliases || [])].join(' ');
  const maintenancePath = `${MAINTENANCE_DIR}/${domain}.html`;
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${serverNames};
    root ${root};
    index index.php index.html;`;

  config += buildCommonServerOpts(extraConfig, domain);

  config += `

    location / {
        try_files ${maintenancePath} $uri $uri/ /index.php?$query_string;`;

  if (extraConfig?.cacheStaticDuration) {
    config += `
        expires ${extraConfig.cacheStaticDuration};`;
  }

  config += `
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;

  config += buildExtraServerConfig(extraConfig);

  config += `
}`;
  return config;
}

export function generateProxyConfig(domain: string, port: number, websocket: boolean = false, extraConfig?: NginxSiteConfig): string {
  const serverNames = [domain, ...(extraConfig?.aliases || [])].join(' ');
  const maintenancePath = `${MAINTENANCE_DIR}/${domain}.html`;
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${serverNames};
`;

  if (extraConfig?.clientMaxBodySize) {
    config += `    client_max_body_size ${extraConfig.clientMaxBodySize};\n`;
  }

  if (extraConfig?.gzip !== false) {
    config += `    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
`;
  }

  config += `
    location / {
        try_files ${maintenancePath} @proxy_backend;
    }

    location @proxy_backend {
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
    }`;

  config += buildExtraServerConfig(extraConfig);

  config += `

    access_log ${extraConfig?.accessLogPath || `/var/log/nginx/${domain}.access.log`};
    error_log ${extraConfig?.errorLogPath || `/var/log/nginx/${domain}.error.log`};
}`;
  return config;
}

/* ------------------------------------------------------------------ */
/*  SSL-specific generators                                            */
/* ------------------------------------------------------------------ */

export function generateSslConfig(domain: string, certPath: string, keyPath: string, chainPath?: string, extraConfig?: NginxSiteConfig): string {
  const serverNames = [domain, ...(extraConfig?.aliases || [])].join(' ');
  let config = `server {
    listen ${extraConfig?.listenPort || 443} ssl http2;
    server_name ${serverNames};

    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};`;

  if (chainPath) {
    config += `
    ssl_trusted_certificate ${chainPath};`;
  }

  config += `

    ssl_protocols ${extraConfig?.sslProtocols || 'TLSv1.2 TLSv1.3'};
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;`;

  if (extraConfig?.hstsMaxAge !== undefined && extraConfig.hstsMaxAge > 0) {
    config += `
    add_header Strict-Transport-Security "max-age=${extraConfig.hstsMaxAge}; includeSubDomains" always;`;
  }

  return config;
}

export function generateHttpRedirectConfig(domain: string, aliases?: string[]): string {
  const serverNames = [domain, ...(aliases || [])].join(' ');
  return `server {
    listen 80;
    server_name ${serverNames};
    return 301 https://$server_name$request_uri;
}`;
}

/* ------------------------------------------------------------------ */
/*  Master config generator                                            */
/* ------------------------------------------------------------------ */

export function generateSiteConfig(config: NginxSiteConfig): string {
  const parts: string[] = [];

  // HTTP redirect if SSL enabled
  if (config.ssl && config.redirectHttp !== false) {
    parts.push(generateHttpRedirectConfig(config.domain, config.aliases));
  }

  let mainConfig = '';

  if (config.ssl && config.sslCertPath && config.sslKeyPath) {
    mainConfig = generateSslConfig(config.domain, config.sslCertPath, config.sslKeyPath, config.sslChainPath, config);

    switch (config.type) {
      case 'static':
        mainConfig = replaceClosingBrace(mainConfig, generateStaticContent(config.root || `/var/www/${config.domain}`, config));
        break;
      case 'php':
        mainConfig = replaceClosingBrace(mainConfig, generatePhpContent(config.root || `/var/www/${config.domain}`, config.phpVersion || '8.3', config));
        break;
      case 'proxy':
        mainConfig = replaceClosingBrace(mainConfig, generateProxyContent(config.proxyPort || 3000, config.websocket || false, config));
        break;
    }
  } else {
    switch (config.type) {
      case 'static':
        mainConfig = generateStaticConfig(config.domain, config.root || `/var/www/${config.domain}`, config);
        break;
      case 'php':
        mainConfig = generatePhpConfig(config.domain, config.root || `/var/www/${config.domain}`, config.phpVersion || '8.3', config);
        break;
      case 'proxy':
        mainConfig = generateProxyConfig(config.domain, config.proxyPort || 3000, config.websocket || false, config);
        break;
    }
  }

  parts.push(mainConfig);
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ */
/*  Content helpers (used inside SSL server blocks)                    */
/* ------------------------------------------------------------------ */

function generateStaticContent(root: string, config?: NginxSiteConfig): string {
  const maintenancePath = config ? `${MAINTENANCE_DIR}/${config.domain}.html` : null;
  let content = `
    root ${root};
    index index.html index.htm;`;

  if (config?.clientMaxBodySize) {
    content += `
    client_max_body_size ${config.clientMaxBodySize};`;
  }

  if (config?.gzip !== false) {
    content += `
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;`;
  }

  content += `

    location / {
        try_files ${maintenancePath || '/dev/null'} $uri $uri/ =404;`;

  if (config?.cacheStaticDuration) {
    content += `
        expires ${config.cacheStaticDuration};`;
  }

  content += `
    }`;

  content += buildExtraServerConfig(config);

  content += `

    access_log ${config?.accessLogPath || `/var/log/nginx/${config?.domain || 'site'}.access.log`};
    error_log ${config?.errorLogPath || `/var/log/nginx/${config?.domain || 'site'}.error.log`};`;
  return content;
}

function generatePhpContent(root: string, phpVersion: string, config?: NginxSiteConfig): string {
  const maintenancePath = config ? `${MAINTENANCE_DIR}/${config.domain}.html` : null;
  let content = `
    root ${root};
    index index.php index.html;`;

  if (config?.clientMaxBodySize) {
    content += `
    client_max_body_size ${config.clientMaxBodySize};`;
  }

  if (config?.gzip !== false) {
    content += `
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;`;
  }

  content += `

    location / {
        try_files ${maintenancePath || '/dev/null'} $uri $uri/ /index.php?$query_string;`;

  if (config?.cacheStaticDuration) {
    content += `
        expires ${config.cacheStaticDuration};`;
  }

  content += `
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;

  content += buildExtraServerConfig(config);

  content += `

    access_log ${config?.accessLogPath || `/var/log/nginx/${config?.domain || 'site'}.access.log`};
    error_log ${config?.errorLogPath || `/var/log/nginx/${config?.domain || 'site'}.error.log`};`;
  return content;
}

function generateProxyContent(port: number, websocket: boolean, config?: NginxSiteConfig): string {
  const maintenancePath = config ? `${MAINTENANCE_DIR}/${config.domain}.html` : null;
  let content = `
    location / {
        try_files ${maintenancePath || '/dev/null'} @proxy_backend;
    }

    location @proxy_backend {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`;

  if (websocket) {
    content += `
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;`;
  }

  content += `
    }`;

  content += buildExtraServerConfig(config);

  content += `

    access_log ${config?.accessLogPath || `/var/log/nginx/${config?.domain || 'site'}.access.log`};
    error_log ${config?.errorLogPath || `/var/log/nginx/${config?.domain || 'site'}.error.log`};`;
  return content;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function buildCommonServerOpts(config?: NginxSiteConfig, domain?: string): string {
  let s = '';
  if (config?.clientMaxBodySize) {
    s += `
    client_max_body_size ${config.clientMaxBodySize};`;
  }
  if (config?.gzip !== false) {
    s += `
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;`;
  }
  return s;
}

function buildExtraServerConfig(config?: NginxSiteConfig): string {
  if (!config) return '';
  let s = '';

  // IP restrictions
  if (config.allowIps?.length || config.denyIps?.length) {
    s += '\n    # IP Access Control';
    for (const ip of config.denyIps || []) {
      s += `\n    deny ${ip};`;
    }
    for (const ip of config.allowIps || []) {
      s += `\n    allow ${ip};`;
    }
    if (config.denyIps?.length && !config.allowIps?.length) {
      s += `\n    allow all;`;
    }
  }

  // Basic auth
  if (config.authBasicFile) {
    s += `\n    auth_basic "${config.authBasicRealm || 'Restricted Area'}";`;
    s += `\n    auth_basic_user_file ${config.authBasicFile};`;
  }

  // Error pages
  if (config.errorPages) {
    for (const [code, path] of Object.entries(config.errorPages)) {
      s += `\n    error_page ${code} ${path};`;
    }
  }

  // Custom directives
  if (config.customDirectives) {
    s += `\n    ${config.customDirectives}`;
  }

  return s;
}

function replaceClosingBrace(config: string, content: string): string {
  const lastBrace = config.lastIndexOf('}');
  if (lastBrace === -1) return config;
  return config.slice(0, lastBrace) + content + '\n}';
}

/* ------------------------------------------------------------------ */
/*  Vhost parsing                                                      */
/* ------------------------------------------------------------------ */

export interface ParsedVhost {
  fileName: string;
  configPath: string;
  enabled: boolean;
  domains: string[];
  root: string | null;
  proxyPass: string | null;
  websocket: boolean;
  phpFpmSocket: string | null;
  detectedType: 'static' | 'php' | 'proxy' | 'unknown';
  managed: boolean;
  panelId: string | null;
  listenPorts: string[];
  ssl: boolean;
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
  rawConfigPreview: string;
}

export function parseNginxConfigFile(content: string, fileName: string, configPath: string, enabled: boolean, panelSiteIds: Map<string, string>): ParsedVhost {
  const domains: string[] = [];
  let root: string | null = null;
  let proxyPass: string | null = null;
  let websocket = false;
  let phpFpmSocket: string | null = null;
  const listenPorts: string[] = [];
  let ssl = false;
  let sslCertPath: string | null = null;
  let sslKeyPath: string | null = null;
  let sslChainPath: string | null = null;

  const serverNameMatch = content.match(/server_name\s+([^;]+);/);
  if (serverNameMatch) {
    const names = serverNameMatch[1].trim().split(/\s+/).filter(n => n && n !== '_');
    domains.push(...names);
  }

  const rootMatch = content.match(/root\s+([^;]+);/);
  if (rootMatch) {
    root = rootMatch[1].trim();
  }

  const proxyPassMatch = content.match(/proxy_pass\s+(https?:\/\/[^;]+|[^;]+);/);
  if (proxyPassMatch) {
    proxyPass = proxyPassMatch[1].trim();
  }

  if (content.includes('Upgrade') && content.includes('Connection') && content.includes('upgrade')) {
    websocket = true;
  }

  const phpMatch = content.match(/fastcgi_pass\s+([^;]+);/);
  if (phpMatch) {
    phpFpmSocket = phpMatch[1].trim();
  }

  const listenMatches = content.matchAll(/listen\s+([^;]+);/g);
  for (const m of listenMatches) {
    const listen = m[1].trim();
    listenPorts.push(listen);
    if (listen.includes('443') || listen.includes('ssl')) {
      ssl = true;
    }
  }

  if (content.includes('ssl_certificate')) {
    ssl = true;
  }

  // Extract SSL certificate paths
  const sslCertMatch = content.match(/ssl_certificate\s+([^;]+);/);
  if (sslCertMatch) {
    sslCertPath = sslCertMatch[1].trim();
  }
  // Skip ssl_certificate_key that is NOT the private key (e.g., chain files)
  const sslKeyMatch = content.match(/ssl_certificate_key\s+([^;]+);/);
  if (sslKeyMatch) {
    sslKeyPath = sslKeyMatch[1].trim();
  }
  const sslChainMatch = content.match(/ssl_trusted_certificate\s+([^;]+);/);
  if (sslChainMatch) {
    sslChainPath = sslChainMatch[1].trim();
  }

  let detectedType: ParsedVhost['detectedType'] = 'unknown';
  if (phpFpmSocket) {
    detectedType = 'php';
  } else if (proxyPass) {
    detectedType = 'proxy';
  } else if (root) {
    detectedType = 'static';
  }

  let managed = false;
  let panelId: string | null = null;
  for (const domain of domains) {
    if (panelSiteIds.has(domain)) {
      managed = true;
      panelId = panelSiteIds.get(domain) || null;
      break;
    }
  }

  return {
    fileName,
    configPath,
    enabled,
    domains,
    root,
    proxyPass,
    websocket,
    phpFpmSocket,
    detectedType,
    managed,
    panelId,
    listenPorts,
    ssl,
    sslCertPath,
    sslKeyPath,
    sslChainPath,
    rawConfigPreview: content.substring(0, 8192),
  };
}
