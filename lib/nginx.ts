/**
 * NGINX configuration helpers.
 * Generates NGINX server block configs for different site types.
 * Also parses existing NGINX vhost files from the filesystem.
 */

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
}

/**
 * Generates a static site NGINX config.
 */
export function generateStaticConfig(domain: string, root: string): string {
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

/**
 * Generates a PHP-FPM NGINX config.
 */
export function generatePhpConfig(domain: string, root: string, phpVersion: string = '8.3'): string {
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

/**
 * Generates a reverse proxy NGINX config.
 */
export function generateProxyConfig(domain: string, port: number, websocket: boolean = false): string {
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
 * Generates an SSL-enabled NGINX server block.
 */
export function generateSslConfig(domain: string, certPath: string, keyPath: string, chainPath?: string): string {
  let config = `server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};`;

  if (chainPath) {
    config += `
    ssl_trusted_certificate ${chainPath};`;
  }

  config += `

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
}`;

  return config;
}

/**
 * Generates HTTP-to-HTTPS redirect NGINX config.
 */
export function generateHttpRedirectConfig(domain: string): string {
  return `server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}`;
}

/**
 * Generates a complete site config based on the provided configuration.
 */
export function generateSiteConfig(config: NginxSiteConfig): string {
  const parts: string[] = [];

  // HTTP redirect if SSL enabled
  if (config.ssl && config.redirectHttp !== false) {
    parts.push(generateHttpRedirectConfig(config.domain));
  }

  // Main server block
  let mainConfig = '';

  if (config.ssl && config.sslCertPath && config.sslKeyPath) {
    mainConfig = generateSslConfig(config.domain, config.sslCertPath, config.sslKeyPath, config.sslChainPath);

    // Add the location/content block inside SSL server
    switch (config.type) {
      case 'static':
        mainConfig = replaceClosingBrace(mainConfig, generateStaticContent(config.root || `/var/www/${config.domain}`));
        break;
      case 'php':
        mainConfig = replaceClosingBrace(mainConfig, generatePhpContent(config.root || `/var/www/${config.domain}`, config.phpVersion || '8.3'));
        break;
      case 'proxy':
        mainConfig = replaceClosingBrace(mainConfig, generateProxyContent(config.proxyPort || 3000, config.websocket || false));
        break;
    }
  } else {
    // Non-SSL
    switch (config.type) {
      case 'static':
        mainConfig = generateStaticConfig(config.domain, config.root || `/var/www/${config.domain}`);
        break;
      case 'php':
        mainConfig = generatePhpConfig(config.domain, config.root || `/var/www/${config.domain}`, config.phpVersion || '8.3');
        break;
      case 'proxy':
        mainConfig = generateProxyConfig(config.domain, config.proxyPort || 3000, config.websocket || false);
        break;
    }
  }

  parts.push(mainConfig);

  return parts.join('\n\n');
}

function generateStaticContent(root: string): string {
  return `
    root ${root};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }`;
}

function generatePhpContent(root: string, phpVersion: string): string {
  return `
    root ${root};
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;
}

function generateProxyContent(port: number, websocket: boolean): string {
  let content = `
    location / {
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
  return content;
}

function replaceClosingBrace(config: string, content: string): string {
  // Remove the last closing brace and append content + closing brace
  const lastBrace = config.lastIndexOf('}');
  if (lastBrace === -1) return config;
  return config.slice(0, lastBrace) + content + '\n}';
}

/**
 * Represents a parsed vhost found on the filesystem (not necessarily managed by the panel).
 */
export interface ParsedVhost {
  /** Filename in sites-available */
  fileName: string;
  /** Full path to the config file */
  configPath: string;
  /** Whether it's symlinked in sites-enabled */
  enabled: boolean;
  /** All server_name values found */
  domains: string[];
  /** Detected document root */
  root: string | null;
  /** Detected proxy_pass target */
  proxyPass: string | null;
  /** Whether websocket upgrade headers are present */
  websocket: boolean;
  /** PHP-FPM socket path if detected */
  phpFpmSocket: string | null;
  /** Detected site type */
  detectedType: 'static' | 'php' | 'proxy' | 'unknown';
  /** Whether this vhost is already managed by the panel */
  managed: boolean;
  /** Panel site ID if managed */
  panelId: string | null;
  /** Listen ports */
  listenPorts: string[];
  /** Has SSL configured */
  ssl: boolean;
  /** Raw config content (first 8KB) */
  rawConfigPreview: string;
}

/**
 * Parses a single NGINX config file and extracts vhost information.
 */
export function parseNginxConfigFile(content: string, fileName: string, configPath: string, enabled: boolean, panelSiteIds: Map<string, string>): ParsedVhost {
  const domains: string[] = [];
  let root: string | null = null;
  let proxyPass: string | null = null;
  let websocket = false;
  let phpFpmSocket: string | null = null;
  const listenPorts: string[] = [];
  let ssl = false;

  // Extract server_name
  const serverNameMatch = content.match(/server_name\s+([^;]+);/);
  if (serverNameMatch) {
    const names = serverNameMatch[1].trim().split(/\s+/).filter(n => n && n !== '_');
    domains.push(...names);
  }

  // Extract root
  const rootMatch = content.match(/root\s+([^;]+);/);
  if (rootMatch) {
    root = rootMatch[1].trim();
  }

  // Extract proxy_pass
  const proxyPassMatch = content.match(/proxy_pass\s+(https?:\/\/[^;]+|[^;]+);/);
  if (proxyPassMatch) {
    proxyPass = proxyPassMatch[1].trim();
  }

  // Check for websocket upgrade
  if (content.includes('Upgrade') && content.includes('Connection') && content.includes('upgrade')) {
    websocket = true;
  }

  // Check for PHP-FPM
  const phpMatch = content.match(/fastcgi_pass\s+([^;]+);/);
  if (phpMatch) {
    phpFpmSocket = phpMatch[1].trim();
  }

  // Extract listen directives
  const listenMatches = content.matchAll(/listen\s+([^;]+);/g);
  for (const m of listenMatches) {
    const listen = m[1].trim();
    listenPorts.push(listen);
    if (listen.includes('443') || listen.includes('ssl')) {
      ssl = true;
    }
  }

  // Also check for ssl_certificate directives
  if (content.includes('ssl_certificate')) {
    ssl = true;
  }

  // Detect type
  let detectedType: ParsedVhost['detectedType'] = 'unknown';
  if (phpFpmSocket) {
    detectedType = 'php';
  } else if (proxyPass) {
    detectedType = 'proxy';
  } else if (root) {
    detectedType = 'static';
  }

  // Check if managed by panel (match by domain in panelSiteIds)
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
    rawConfigPreview: content.substring(0, 8192),
  };
}
