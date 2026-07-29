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
  /** Additional custom NGINX directives injected into the server block */
  customDirectives?: string;
  /** Client max body size (e.g. "50m") */
  clientMaxBodySize?: string;
  /** Enable gzip compression */
  gzip?: boolean;
  /** Custom error page mapping: status -> path */
  errorPages?: Record<number, string>;
  /** Rate limiting zone name */
  rateLimitZone?: string;
  /** Rate limiting rate (e.g. "10r/s") */
  rateLimitRate?: string;
  /** IP allow list */
  allowIps?: string[];
  /** IP deny list */
  denyIps?: string[];
  /** Basic auth user file path */
  authBasicFile?: string;
  /** Basic auth realm message */
  authBasicRealm?: string;
  /** SSL protocols override */
  sslProtocols?: string;
  /** HSTS max age in seconds (0 = disabled) */
  hstsMaxAge?: number;
  /** Custom listen port (default 80 or 443 for SSL) */
  listenPort?: number;
  /** Server aliases (additional server_name entries) */
  aliases?: string[];
  /** Access log path override */
  accessLogPath?: string;
  /** Error log path override */
  errorLogPath?: string;
  /** Maintenance mode: redirect all traffic to a static page */
  maintenance?: boolean;
  /** Maintenance page HTML content */
  maintenancePage?: string;
  /** Cache static assets duration (e.g. "30d") */
  cacheStaticDuration?: string;
}

/**
 * Generates a static site NGINX config.
 */
export function generateStaticConfig(domain: string, root: string, extraConfig?: NginxSiteConfig): string {
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${[domain, ...(extraConfig?.aliases || [])].join(' ')};
    root ${root};
    index index.html index.htm;`;

  if (extraConfig?.clientMaxBodySize) {
    config += `
    client_max_body_size ${extraConfig.clientMaxBodySize};`;
  }

  if (extraConfig?.gzip !== false) {
    config += `
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;`;
  }

  config += `

    location / {
        try_files $uri $uri/ =404;`;

  if (extraConfig?.cacheStaticDuration) {
    config += `
        expires ${extraConfig.cacheStaticDuration};`;
  }

  config += `
    }`;

  // Maintenance mode
  if (extraConfig?.maintenance) {
    config += generateMaintenanceLocation(extraConfig);
  }

  // Rate limiting
  if (extraConfig?.rateLimitZone && extraConfig?.rateLimitRate) {
    config += `
    location / {
        limit_req zone=${extraConfig.rateLimitZone} burst=10 nodelay;
        try_files $uri $uri/ =404;
    }`;
  }

  // IP restrictions
  if (extraConfig?.allowIps?.length || extraConfig?.denyIps?.length) {
    config += `
    # IP Access Control`;
    for (const ip of extraConfig?.denyIps || []) {
      config += `
    deny ${ip};`;
    }
    for (const ip of extraConfig?.allowIps || []) {
      config += `
    allow ${ip};`;
    }
    if (extraConfig?.denyIps?.length && !extraConfig?.allowIps?.length) {
      config += `
    allow all;`;
    }
  }

  // Basic auth
  if (extraConfig?.authBasicFile) {
    config += `
    auth_basic "${extraConfig.authBasicRealm || 'Restricted Area'}";
    auth_basic_user_file ${extraConfig.authBasicFile};`;
  }

  // Error pages
  if (extraConfig?.errorPages) {
    for (const [code, path] of Object.entries(extraConfig.errorPages)) {
      config += `
    error_page ${code} ${path};`;
    }
  }

  // Custom directives
  if (extraConfig?.customDirectives) {
    config += `
    ${extraConfig.customDirectives}`;
  }

  config += `

    access_log ${extraConfig?.accessLogPath || `/var/log/nginx/${domain}.access.log`};
    error_log ${extraConfig?.errorLogPath || `/var/log/nginx/${domain}.error.log`};
}`;
  return config;
}

/**
 * Generates a PHP-FPM NGINX config.
 */
export function generatePhpConfig(domain: string, root: string, phpVersion: string = '8.3', extraConfig?: NginxSiteConfig): string {
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${[domain, ...(extraConfig?.aliases || [])].join(' ')};
    root ${root};
    index index.php index.html;`;

  if (extraConfig?.clientMaxBodySize) {
    config += `
    client_max_body_size ${extraConfig.clientMaxBodySize};`;
  }

  if (extraConfig?.gzip !== false) {
    config += `
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;`;
  }

  config += `

    location / {
        try_files $uri $uri/ /index.php?$query_string;`;

  if (extraConfig?.cacheStaticDuration) {
    config += `
        expires ${extraConfig.cacheStaticDuration};`;
  }

  config += `
    }`;

  // Maintenance mode
  if (extraConfig?.maintenance) {
    config += generateMaintenanceLocation(extraConfig);
  }

  config += `

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;

  // IP restrictions
  if (extraConfig?.allowIps?.length || extraConfig?.denyIps?.length) {
    config += `
    # IP Access Control`;
    for (const ip of extraConfig?.denyIps || []) {
      config += `
    deny ${ip};`;
    }
    for (const ip of extraConfig?.allowIps || []) {
      config += `
    allow ${ip};`;
    }
    if (extraConfig?.denyIps?.length && !extraConfig?.allowIps?.length) {
      config += `
    allow all;`;
    }
  }

  // Basic auth
  if (extraConfig?.authBasicFile) {
    config += `
    auth_basic "${extraConfig.authBasicRealm || 'Restricted Area'}";
    auth_basic_user_file ${extraConfig.authBasicFile};`;
  }

  // Error pages
  if (extraConfig?.errorPages) {
    for (const [code, path] of Object.entries(extraConfig.errorPages)) {
      config += `
    error_page ${code} ${path};`;
    }
  }

  // Custom directives
  if (extraConfig?.customDirectives) {
    config += `
    ${extraConfig.customDirectives}`;
  }

  config += `

    access_log ${extraConfig?.accessLogPath || `/var/log/nginx/${domain}.access.log`};
    error_log ${extraConfig?.errorLogPath || `/var/log/nginx/${domain}.error.log`};
}`;
  return config;
}

/**
 * Generates a reverse proxy NGINX config.
 */
export function generateProxyConfig(domain: string, port: number, websocket: boolean = false, extraConfig?: NginxSiteConfig): string {
  let config = `server {
    listen ${extraConfig?.listenPort || 80};
    server_name ${[domain, ...(extraConfig?.aliases || [])].join(' ')};
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

  // Maintenance mode
  if (extraConfig?.maintenance) {
    config += generateMaintenanceLocation(extraConfig);
  }

  // IP restrictions
  if (extraConfig?.allowIps?.length || extraConfig?.denyIps?.length) {
    config += `
    # IP Access Control`;
    for (const ip of extraConfig?.denyIps || []) {
      config += `
    deny ${ip};`;
    }
    for (const ip of extraConfig?.allowIps || []) {
      config += `
    allow ${ip};`;
    }
    if (extraConfig?.denyIps?.length && !extraConfig?.allowIps?.length) {
      config += `
    allow all;`;
    }
  }

  // Basic auth
  if (extraConfig?.authBasicFile) {
    config += `
    auth_basic "${extraConfig.authBasicRealm || 'Restricted Area'}";
    auth_basic_user_file ${extraConfig.authBasicFile};`;
  }

  // Error pages
  if (extraConfig?.errorPages) {
    for (const [code, path] of Object.entries(extraConfig.errorPages)) {
      config += `
    error_page ${code} ${path};`;
    }
  }

  // Custom directives
  if (extraConfig?.customDirectives) {
    config += `
    ${extraConfig.customDirectives}`;
  }

  config += `

    access_log ${extraConfig?.accessLogPath || `/var/log/nginx/${domain}.access.log`};
    error_log ${extraConfig?.errorLogPath || `/var/log/nginx/${domain}.error.log`};
}`;
  return config;
}

/**
 * Generates the maintenance mode location block that intercepts all requests.
 */
function generateMaintenanceLocation(config: NginxSiteConfig): string {
  const pageContent = config.maintenancePage || getDefaultMaintenancePage(config.domain);
  const encoded = Buffer.from(pageContent).toString('base64');
  return `

    # Maintenance mode - redirect all to maintenance page
    set $maintenance 1;
    if ($uri = /maintenance.html) {
        set $maintenance 0;
    }
    if ($maintenance = 1) {
        return 503;
    }
    error_page 503 @maintenance;
    location @maintenance {
        default_type text/html;
        return 200 '${pageContent.replace(/'/g, "\\'").replace(/\n/g, '\\n')}';
    }`;
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
    <title>Em Manutenção - ${domain}</title>
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
        .icon {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            animation: pulse 2s ease-in-out infinite;
        }
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
        <div class="icon">🔧</div>
        <h1>${domain}</h1>
        <div class="status">⚠️ Em Manutenção Programada</div>
        <p>Estamos realizando melhorias no servidor.<br>Por favor, tente novamente em alguns minutos.</p>
        <div class="footer">Duart Panel &copy; ${new Date().getFullYear()}</div>
    </div>
</body>
</html>`;
}

/**
 * Generates an SSL-enabled NGINX server block.
 */
export function generateSslConfig(domain: string, certPath: string, keyPath: string, chainPath?: string, extraConfig?: NginxSiteConfig): string {
  let config = `server {
    listen ${extraConfig?.listenPort || 443} ssl http2;
    server_name ${[domain, ...(extraConfig?.aliases || [])].join(' ')};

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

/**
 * Generates HTTP-to-HTTPS redirect NGINX config.
 */
export function generateHttpRedirectConfig(domain: string, aliases?: string[]): string {
  return `server {
    listen 80;
    server_name ${[domain, ...(aliases || [])].join(' ')};
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
    parts.push(generateHttpRedirectConfig(config.domain, config.aliases));
  }

  // Main server block
  let mainConfig = '';

  if (config.ssl && config.sslCertPath && config.sslKeyPath) {
    mainConfig = generateSslConfig(config.domain, config.sslCertPath, config.sslKeyPath, config.sslChainPath, config);

    // Add the location/content block inside SSL server
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
    // Non-SSL
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

function generateStaticContent(root: string, config?: NginxSiteConfig): string {
  let content = `
    root ${root};
    index index.html index.htm;`;

  if (config?.clientMaxBodySize) {
    content += `
    client_max_body_size ${config.clientMaxBodySize};`;
  }

  content += `

    location / {
        try_files $uri $uri/ =404;`;

  if (config?.cacheStaticDuration) {
    content += `
        expires ${config.cacheStaticDuration};`;
  }

  content += `
    }`;

  if (config?.maintenance) {
    content += generateMaintenanceLocation(config);
  }

  return addExtraServerConfig(content, config);
}

function generatePhpContent(root: string, phpVersion: string, config?: NginxSiteConfig): string {
  let content = `
    root ${root};
    index index.php index.html;`;

  if (config?.clientMaxBodySize) {
    content += `
    client_max_body_size ${config.clientMaxBodySize};`;
  }

  content += `

    location / {
        try_files $uri $uri/ /index.php?$query_string;`;

  if (config?.cacheStaticDuration) {
    content += `
        expires ${config.cacheStaticDuration};`;
  }

  content += `
    }`;

  if (config?.maintenance) {
    content += generateMaintenanceLocation(config);
  }

  content += `

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${phpVersion}-fpm.sock;
    }`;

  return addExtraServerConfig(content, config);
}

function generateProxyContent(port: number, websocket: boolean, config?: NginxSiteConfig): string {
  let content = `\n    location / {
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

  if (config?.maintenance) {
    content += generateMaintenanceLocation(config);
  }

  return addExtraServerConfig(content, config);
}

function addExtraServerConfig(content: string, config?: NginxSiteConfig): string {
  if (!config) return content;

  // IP restrictions
  if (config.allowIps?.length || config.denyIps?.length) {
    content += `
    # IP Access Control`;
    for (const ip of config.denyIps || []) {
      content += `
    deny ${ip};`;
    }
    for (const ip of config.allowIps || []) {
      content += `
    allow ${ip};`;
    }
    if (config.denyIps?.length && !config.allowIps?.length) {
      content += `
    allow all;`;
    }
  }

  // Basic auth
  if (config.authBasicFile) {
    content += `
    auth_basic "${config.authBasicRealm || 'Restricted Area'}";
    auth_basic_user_file ${config.authBasicFile};`;
  }

  // Error pages
  if (config.errorPages) {
    for (const [code, path] of Object.entries(config.errorPages)) {
      content += `
    error_page ${code} ${path};`;
    }
  }

  // Custom directives
  if (config.customDirectives) {
    content += `
    ${config.customDirectives}`;
  }

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
