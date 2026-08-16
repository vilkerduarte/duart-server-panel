/**
 * Geração e leitura de configuração NGINX.
 *
 * Decisões que este módulo assume:
 *
 * - Todo vhost escuta em IPv4 e IPv6. VPS com registro AAAA que só escuta em
 *   IPv4 responde erro de conexão para parte dos visitantes, e o Let's Encrypt
 *   prefere IPv6 quando ele existe — o desafio HTTP-01 falha antes de começar.
 * - Modo manutenção usa `error_page 503` com named location. `try_files` trata
 *   seus argumentos como URIs relativas ao `root`, então caminho absoluto de
 *   filesystem nunca resolve; era por isso que a manutenção não fazia nada.
 * - Parâmetros de TLS, gzip e ACME vivem em snippets compartilhados. Endurecer
 *   TLS passa a ser mudança em um arquivo, e o diff de uma edição de site fica
 *   pequeno o bastante para o usuário conferir antes de aplicar.
 */

export const MAINTENANCE_DIR = '/var/lib/duart-panel/nginx/maintenance';
export const ACME_WEBROOT = '/var/www/acme';
export const SNIPPETS_DIR = '/etc/nginx/snippets';
export const CONF_D_DIR = '/etc/nginx/conf.d';

export const SNIPPET_SSL = `${SNIPPETS_DIR}/duart-ssl.conf`;
export const SNIPPET_ACME = `${SNIPPETS_DIR}/duart-acme.conf`;
export const SNIPPET_GZIP = `${SNIPPETS_DIR}/duart-gzip.conf`;
export const SNIPPET_PROXY = `${SNIPPETS_DIR}/duart-proxy.conf`;
export const CONF_RATELIMIT = `${CONF_D_DIR}/duart-ratelimit.conf`;

export type SiteType = 'static' | 'php' | 'proxy' | 'python' | 'node';

export interface NginxSiteConfig {
  domain: string;
  type: SiteType;
  root?: string;
  proxyPort?: number;
  proxyUrl?: string;
  /** Socket unix do upstream (apps Python/Node gerenciados pelo painel). */
  proxySocket?: string;
  websocket?: boolean;
  phpVersion?: string;
  /** Socket do pool PHP-FPM dedicado ao site. Sem isso, cai no pool padrão da versão. */
  phpSocket?: string;
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
  rateLimitBurst?: number;
  allowIps?: string[];
  denyIps?: string[];
  authBasicFile?: string;
  authBasicRealm?: string;
  sslProtocols?: string;
  hstsMaxAge?: number;
  hstsPreload?: boolean;
  listenPort?: number;
  ipv6?: boolean;
  aliases?: string[];
  accessLogPath?: string;
  errorLogPath?: string;
  maintenance?: boolean;
  maintenancePage?: string;
  /** IPs que continuam enxergando o site normalmente durante a manutenção. */
  maintenanceBypassIps?: string[];
  cacheStaticDuration?: string;
}

/* ------------------------------------------------------------------ */
/*  Snippets compartilhados                                            */
/* ------------------------------------------------------------------ */

/**
 * Perfil intermediário do Mozilla. A lista antiga (`HIGH:!aNULL:!MD5`) ainda
 * admite CBC e SHA1; esta remove os dois e mantém compatibilidade ampla.
 */
export function generateSslSnippet(): string {
  return `# Duart Panel — parâmetros TLS compartilhados
# Gerado automaticamente. Editar aqui vale para todos os sites gerenciados.

ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_ecdh_curve X25519:prime256v1:secp384r1;

ssl_session_cache shared:DuartSSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

ssl_stapling on;
ssl_stapling_verify on;
resolver 127.0.0.53 1.1.1.1 valid=300s;
resolver_timeout 5s;
`;
}

export function generateAcmeSnippet(): string {
  return `# Duart Panel — desafio ACME (Let's Encrypt)
# Precisa vir antes de qualquer redirect ou restrição de acesso, senão a
# renovação falha em sites com auth_basic, allow/deny ou redirect para HTTPS.

location ^~ /.well-known/acme-challenge/ {
    root ${ACME_WEBROOT};
    default_type "text/plain";
    allow all;
    auth_basic off;
    try_files $uri =404;
}
`;
}

export function generateGzipSnippet(): string {
  return `# Duart Panel — compressão
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 256;
gzip_types
    text/plain text/css text/xml text/javascript
    application/json application/javascript application/xml
    application/rss+xml application/atom+xml
    image/svg+xml font/woff font/woff2;
`;
}

export function generateProxySnippet(): string {
  return `# Duart Panel — cabeçalhos de proxy reverso
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_redirect off;
`;
}

/**
 * Zonas de rate limit vivem no escopo `http`, não dentro do server block —
 * por isso ficam em conf.d e não no arquivo do site.
 */
export function generateRateLimitConf(zones: Array<{ name: string; rate: string; size?: string }>): string {
  const lines = [
    '# Duart Panel — zonas de rate limit',
    '# Gerado automaticamente a partir dos sites gerenciados.',
    '',
    'limit_req_zone $binary_remote_addr zone=duart_default:10m rate=30r/s;',
  ];
  for (const zone of zones) {
    if (!isValidZoneName(zone.name)) continue;
    lines.push(`limit_req_zone $binary_remote_addr zone=${zone.name}:${zone.size || '10m'} rate=${zone.rate};`);
  }
  lines.push('');
  return lines.join('\n');
}

export function isValidZoneName(name: string): boolean {
  return /^[a-zA-Z0-9_]{1,32}$/.test(name);
}

export function isValidRate(rate: string): boolean {
  return /^\d{1,5}r\/[sm]$/.test(rate);
}

/* ------------------------------------------------------------------ */
/*  Página de manutenção                                               */
/* ------------------------------------------------------------------ */

export function getMaintenanceFilePath(domain: string): string {
  return `${MAINTENANCE_DIR}/${domain}.html`;
}

export function getDefaultMaintenancePage(domain: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Em manutencao - ${domain}</title>
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
        @media (prefers-reduced-motion: reduce) { .icon { animation: none; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">&#x1F527;</div>
        <h1>${domain}</h1>
        <div class="status">&#x26A0;&#xFE0F; Em manutencao programada</div>
        <p>Estamos realizando melhorias no servidor.<br>Por favor, tente novamente em alguns minutos.</p>
        <div class="footer">Duart Panel &copy; ${new Date().getFullYear()}</div>
    </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Validação                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Diretivas customizadas entram cruas no server block. Uma chave desbalanceada
 * fecha o bloco e transforma o resto do arquivo em lixo — combinado com um
 * reload sem rollback, isso derruba o NGINX inteiro a partir de um textarea.
 */
export function validateCustomDirectives(text: string): ValidationResult {
  if (!text || !text.trim()) return { valid: true };

  let depth = 0;
  let inComment = false;
  let inString: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '#') { inComment = true; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth < 0) {
        return { valid: false, error: 'Chave "}" a mais — isso fecharia o bloco do site e invalidaria o arquivo.' };
      }
    }
  }

  if (depth !== 0) {
    return { valid: false, error: `Chaves desbalanceadas (${depth} bloco(s) sem fechar).` };
  }

  const forbidden = /^\s*(http|events|mail|stream)\s*\{/m;
  if (forbidden.test(text)) {
    return { valid: false, error: 'Blocos http, events, mail e stream não podem existir dentro de um server block.' };
  }

  return { valid: true };
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  return /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(domain);
}

/* ------------------------------------------------------------------ */
/*  Blocos                                                             */
/* ------------------------------------------------------------------ */

function serverNames(config: NginxSiteConfig): string {
  return [config.domain, ...(config.aliases || [])].filter(Boolean).join(' ');
}

function listenDirectives(config: NginxSiteConfig, ssl: boolean): string {
  const port = ssl ? 443 : (config.listenPort || 80);
  const suffix = ssl ? ' ssl' : '';
  const lines = [`    listen ${port}${suffix};`];
  if (config.ipv6 !== false) {
    lines.push(`    listen [::]:${port}${suffix};`);
  }
  if (ssl) lines.push('    http2 on;');
  return lines.join('\n');
}

function logDirectives(config: NginxSiteConfig): string {
  const access = config.accessLogPath || `/var/log/nginx/${config.domain}.access.log`;
  const error = config.errorLogPath || `/var/log/nginx/${config.domain}.error.log`;
  return `    access_log ${access};\n    error_log ${error};`;
}

function sslDirectives(config: NginxSiteConfig): string {
  const lines = [
    `    ssl_certificate ${config.sslCertPath};`,
    `    ssl_certificate_key ${config.sslKeyPath};`,
  ];
  if (config.sslChainPath) {
    lines.push(`    ssl_trusted_certificate ${config.sslChainPath};`);
  }
  lines.push(`    include ${SNIPPET_SSL};`);
  if (config.sslProtocols) {
    lines.push(`    ssl_protocols ${config.sslProtocols};`);
  }
  if (config.hstsMaxAge !== undefined && config.hstsMaxAge > 0) {
    const preload = config.hstsPreload ? '; preload' : '';
    lines.push(`    add_header Strict-Transport-Security "max-age=${config.hstsMaxAge}; includeSubDomains${preload}" always;`);
  }
  return lines.join('\n');
}

/**
 * Bloco de manutenção.
 *
 * Os três `if` a seguir usam apenas `set` e `return`, que são as duas formas
 * documentadas como seguras dentro de `if` no NGINX. A exceção para
 * /.well-known garante que a renovação de certificado continue funcionando
 * enquanto o site está em manutenção.
 */
function maintenanceDirectives(config: NginxSiteConfig): string {
  const file = `${MAINTENANCE_DIR}/${config.domain}.html`;
  const lines = [
    '    # Manutenção: controlada pela existência do arquivo abaixo.',
    '    set $duart_maint 0;',
    `    if (-f ${file}) { set $duart_maint 1; }`,
    '    if ($request_uri ~ ^/\\.well-known/) { set $duart_maint 0; }',
  ];

  for (const ip of config.maintenanceBypassIps || []) {
    if (isValidIpOrCidr(ip)) {
      lines.push(`    if ($remote_addr = ${ip}) { set $duart_maint 0; }`);
    }
  }

  lines.push('    if ($duart_maint) { return 503; }');
  lines.push('');
  lines.push('    error_page 503 @duart_maintenance;');
  lines.push('    location @duart_maintenance {');
  lines.push('        internal;');
  lines.push(`        root ${MAINTENANCE_DIR};`);
  lines.push('        default_type text/html;');
  lines.push('        add_header Retry-After 3600 always;');
  lines.push(`        try_files /${config.domain}.html =503;`);
  lines.push('    }');

  return lines.join('\n');
}

export function isValidIpOrCidr(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(value) || /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(value);
}

/**
 * Controle de acesso por IP.
 *
 * O módulo de acesso do NGINX libera por padrão o que não casa com nenhuma
 * regra. Uma lista de `allow` sem `deny all` no fim, portanto, não restringe
 * nada — a interface dizia "restrito" e o site ficava aberto.
 */
function accessControlDirectives(config: NginxSiteConfig): string {
  const allow = (config.allowIps || []).filter(isValidIpOrCidr);
  const deny = (config.denyIps || []).filter(isValidIpOrCidr);
  if (!allow.length && !deny.length) return '';

  const lines = ['    # Controle de acesso por IP'];
  for (const ip of deny) lines.push(`    deny ${ip};`);
  for (const ip of allow) lines.push(`    allow ${ip};`);

  if (allow.length) {
    // Lista de permissão é fechada: tudo que não foi liberado é negado.
    lines.push('    deny all;');
  } else {
    lines.push('    allow all;');
  }

  return lines.join('\n');
}

function rateLimitDirectives(config: NginxSiteConfig): string {
  if (!config.rateLimitZone || !isValidZoneName(config.rateLimitZone)) return '';
  const burst = config.rateLimitBurst && config.rateLimitBurst > 0 ? config.rateLimitBurst : 20;
  return `    limit_req zone=${config.rateLimitZone} burst=${burst} nodelay;\n    limit_req_status 429;`;
}

function extrasDirectives(config: NginxSiteConfig): string {
  const parts: string[] = [];

  if (config.clientMaxBodySize) {
    parts.push(`    client_max_body_size ${config.clientMaxBodySize};`);
  }
  if (config.gzip !== false) {
    parts.push(`    include ${SNIPPET_GZIP};`);
  }
  if (config.authBasicFile) {
    parts.push(`    auth_basic "${(config.authBasicRealm || 'Restricted Area').replace(/"/g, '')}";`);
    parts.push(`    auth_basic_user_file ${config.authBasicFile};`);
  }
  if (config.errorPages) {
    for (const [code, target] of Object.entries(config.errorPages)) {
      if (/^\d{3}$/.test(code)) parts.push(`    error_page ${code} ${target};`);
    }
  }

  const access = accessControlDirectives(config);
  if (access) parts.push(access);

  const rate = rateLimitDirectives(config);
  if (rate) parts.push(rate);

  if (config.customDirectives && validateCustomDirectives(config.customDirectives).valid) {
    parts.push('    # Diretivas customizadas');
    parts.push(config.customDirectives.split('\n').map(l => `    ${l.trim()}`).join('\n'));
  }

  return parts.filter(Boolean).join('\n');
}

/** Corpo do site: o que muda entre static, php, proxy, python e node. */
function contentDirectives(config: NginxSiteConfig): string {
  const root = config.root || `/var/www/${config.domain}`;
  const cache = config.cacheStaticDuration
    ? `\n        expires ${config.cacheStaticDuration};\n        add_header Cache-Control "public";`
    : '';

  switch (config.type) {
    case 'php': {
      const socket = config.phpSocket || `/run/php/php${config.phpVersion || '8.4'}-fpm.sock`;
      return `    root ${root};
    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;${cache}
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${socket};
        fastcgi_read_timeout 120s;
        fastcgi_param HTTP_PROXY "";
    }

    # Arquivos sensíveis nunca são servidos como estáticos
    location ~ /\\.(?!well-known) {
        deny all;
    }`;
    }

    case 'static': {
      return `    root ${root};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;${cache}
    }

    location ~ /\\.(?!well-known) {
        deny all;
    }`;
    }

    case 'proxy':
    case 'python':
    case 'node': {
      const upstream = config.proxySocket
        ? `http://unix:${config.proxySocket}`
        : `http://127.0.0.1:${config.proxyPort || 3000}`;

      const ws = config.websocket
        ? `
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;`
        : '';

      return `    location / {
        proxy_pass ${upstream};
        include ${SNIPPET_PROXY};${ws}
    }`;
    }

    default:
      return `    location / {
        return 404;
    }`;
  }
}

function renderServerBlock(config: NginxSiteConfig, ssl: boolean): string {
  const parts = [
    'server {',
    listenDirectives(config, ssl),
    `    server_name ${serverNames(config)};`,
    '',
  ];

  if (ssl) {
    parts.push(sslDirectives(config), '');
  }

  parts.push(logDirectives(config), '');
  parts.push(`    include ${SNIPPET_ACME};`, '');

  const extras = extrasDirectives(config);
  if (extras) parts.push(extras, '');

  parts.push(maintenanceDirectives(config), '');
  parts.push(contentDirectives(config));
  parts.push('}');

  return parts.filter(p => p !== undefined).join('\n');
}

function renderRedirectBlock(config: NginxSiteConfig): string {
  return `server {
${listenDirectives(config, false)}
    server_name ${serverNames(config)};

    include ${SNIPPET_ACME};

    location / {
        return 301 https://$host$request_uri;
    }
}`;
}

/* ------------------------------------------------------------------ */
/*  Gerador principal                                                  */
/* ------------------------------------------------------------------ */

export function generateSiteConfig(config: NginxSiteConfig): string {
  const header = `# Duart Panel — ${config.domain}
# Arquivo gerenciado pelo painel. Edições manuais são sobrescritas na próxima
# alteração pela interface; use "Editar configuração" para mudanças permanentes.
# Tipo: ${config.type}${config.ssl ? ' · TLS ativo' : ''}
`;

  const useSsl = Boolean(config.ssl && config.sslCertPath && config.sslKeyPath);
  const blocks: string[] = [];

  if (useSsl) {
    if (config.redirectHttp !== false) {
      blocks.push(renderRedirectBlock(config));
    }
    blocks.push(renderServerBlock(config, true));
  } else {
    blocks.push(renderServerBlock(config, false));
  }

  return `${header}\n${blocks.join('\n\n')}\n`;
}

/* ------------------------------------------------------------------ */
/*  Leitura de vhosts existentes                                       */
/* ------------------------------------------------------------------ */

export interface ParsedServerBlock {
  serverNames: string[];
  listen: string[];
  root: string | null;
  proxyPass: string | null;
  fastcgiPass: string | null;
  ssl: boolean;
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
  isRedirectOnly: boolean;
}

export interface ParsedVhost {
  fileName: string;
  configPath: string;
  enabled: boolean;
  domains: string[];
  root: string | null;
  proxyPass: string | null;
  websocket: boolean;
  phpFpmSocket: string | null;
  detectedType: SiteType | 'unknown';
  managed: boolean;
  panelId: string | null;
  listenPorts: string[];
  ssl: boolean;
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
  blocks: ParsedServerBlock[];
  rawConfigPreview: string;
}

/**
 * Separa o arquivo em server blocks contando chaves.
 *
 * O parser anterior usava `.match()` sem flag global, então lia só o primeiro
 * bloco. Arquivos com redirect na 80 mais o site real na 443 — o formato que o
 * próprio painel gera — eram lidos como se fossem só o redirect.
 */
export function splitServerBlocks(content: string): string[] {
  const blocks: string[] = [];
  const serverRe = /(^|\n)\s*server\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = serverRe.exec(content)) !== null) {
    const openIndex = content.indexOf('{', match.index);
    if (openIndex === -1) continue;

    let depth = 0;
    let inComment = false;
    let inString: string | null = null;
    let end = -1;

    for (let i = openIndex; i < content.length; i++) {
      const ch = content[i];

      if (inComment) {
        if (ch === '\n') inComment = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') { i++; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '#') { inComment = true; continue; }
      if (ch === '"' || ch === "'") { inString = ch; continue; }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    if (end !== -1) {
      blocks.push(content.slice(openIndex + 1, end));
      serverRe.lastIndex = end;
    }
  }

  return blocks;
}

function firstMatch(content: string, re: RegExp): string | null {
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Remove os blocos aninhados (location, if, limit_except) do corpo.
 *
 * Diretivas de escopo de servidor — root, server_name, listen — precisam ser
 * lidas fora deles. Sem isso, o `root` do named location de manutenção era
 * lido como se fosse a raiz do site.
 */
function stripNestedBlocks(block: string): string {
  let output = '';
  let depth = 0;
  let inComment = false;
  let inString: string | null = null;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];

    if (inComment) {
      if (ch === '\n') { inComment = false; if (depth === 0) output += ch; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      if (depth === 0) output += ch;
      continue;
    }
    if (ch === '#') { inComment = true; continue; }
    if (ch === '"' || ch === "'") { inString = ch; if (depth === 0) output += ch; continue; }

    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); output += '\n'; continue; }

    if (depth === 0) output += ch;
  }

  return output;
}

function parseServerBlock(block: string): ParsedServerBlock {
  // Escopo do servidor, sem o conteúdo de locations e ifs.
  const serverScope = stripNestedBlocks(block);

  const serverNamesRaw = firstMatch(serverScope, /(?:^|\n)\s*server_name\s+([^;]+);/);
  const names = serverNamesRaw
    ? serverNamesRaw.split(/\s+/).filter(n => n && n !== '_')
    : [];

  const listen: string[] = [];
  for (const m of serverScope.matchAll(/(?:^|\n)\s*listen\s+([^;]+);/g)) {
    listen.push(m[1].trim());
  }

  const sslCertPath = firstMatch(serverScope, /(?:^|\n)\s*ssl_certificate\s+([^;]+);/);
  const sslKeyPath = firstMatch(serverScope, /(?:^|\n)\s*ssl_certificate_key\s+([^;]+);/);
  const sslChainPath = firstMatch(serverScope, /(?:^|\n)\s*ssl_trusted_certificate\s+([^;]+);/);

  const ssl = Boolean(sslCertPath) || listen.some(l => /\bssl\b/.test(l) || /(^|:)443\b/.test(l));

  const hasReturnRedirect = /(?:^|\n)\s*return\s+30[12]\s+https:/.test(block);

  // A raiz do site é a do escopo do servidor. Só quando ela não existe é que
  // vale procurar dentro de locations — ignorando a do bloco de manutenção,
  // que aponta para o diretório do painel e não para o site.
  const root = firstMatch(serverScope, /(?:^|\n)\s*root\s+([^;]+);/)
    ?? Array.from(block.matchAll(/(?:^|\n)\s*root\s+([^;]+);/g))
        .map(m => m[1].trim())
        .find(candidate => !candidate.startsWith(MAINTENANCE_DIR))
    ?? null;

  // proxy_pass e fastcgi_pass vivem dentro de location, então usam o bloco todo.
  const proxyPass = firstMatch(block, /(?:^|\n)\s*proxy_pass\s+([^;]+);/);
  const fastcgiPass = firstMatch(block, /(?:^|\n)\s*fastcgi_pass\s+([^;]+);/);

  return {
    serverNames: names,
    listen,
    root,
    proxyPass,
    fastcgiPass,
    ssl,
    sslCertPath,
    sslKeyPath,
    sslChainPath,
    isRedirectOnly: hasReturnRedirect && !root && !proxyPass && !fastcgiPass,
  };
}

export function parseNginxConfigFile(
  content: string,
  fileName: string,
  configPath: string,
  enabled: boolean,
  panelSiteIds: Map<string, string>,
): ParsedVhost {
  const rawBlocks = splitServerBlocks(content);
  const blocks = rawBlocks.map(parseServerBlock);

  // O bloco que descreve o site é o primeiro que não é só redirect.
  const primary = blocks.find(b => !b.isRedirectOnly) || blocks[0] || null;

  const domains = Array.from(new Set(blocks.flatMap(b => b.serverNames)));
  const listenPorts = Array.from(new Set(blocks.flatMap(b => b.listen)));

  const sslBlock = blocks.find(b => b.ssl && b.sslCertPath) || null;
  const ssl = blocks.some(b => b.ssl);

  const root = primary?.root ?? null;
  const proxyPass = primary?.proxyPass ?? null;
  const phpFpmSocket = primary?.fastcgiPass ?? null;
  const websocket = /Upgrade\s+\$http_upgrade/.test(content) && /Connection\s+["']?upgrade/i.test(content);

  let detectedType: ParsedVhost['detectedType'] = 'unknown';
  if (phpFpmSocket) detectedType = 'php';
  else if (proxyPass) detectedType = 'proxy';
  else if (root) detectedType = 'static';

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
    sslCertPath: sslBlock?.sslCertPath ?? null,
    sslKeyPath: sslBlock?.sslKeyPath ?? null,
    sslChainPath: sslBlock?.sslChainPath ?? null,
    blocks,
    rawConfigPreview: content.substring(0, 8192),
  };
}
