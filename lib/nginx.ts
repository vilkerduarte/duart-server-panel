/**
 * NGINX configuration helpers.
 * Generates NGINX server block configs for different site types.
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
