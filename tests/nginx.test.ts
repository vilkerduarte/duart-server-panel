import { describe, it, expect } from 'vitest';
import {
  generateSiteConfig,
  parseNginxConfigFile,
  splitServerBlocks,
  validateCustomDirectives,
  isValidDomain,
  MAINTENANCE_DIR,
  NginxSiteConfig,
} from '../lib/nginx';

/**
 * Testes do gerador de vhost.
 *
 * Cada bloco aqui corresponde a um defeito que chegou à produção sem ser
 * percebido: manutenção que nunca acionava, ausência de IPv6, controle de
 * acesso que não restringia, e um parser que só lia o primeiro server block.
 */

const base: NginxSiteConfig = { domain: 'exemplo.com', type: 'static' };

describe('generateSiteConfig — escuta', () => {
  it('escuta em IPv4 e IPv6 por padrão', () => {
    const config = generateSiteConfig(base);
    expect(config).toContain('listen 80;');
    expect(config).toContain('listen [::]:80;');
  });

  it('permite desligar IPv6 em hosts sem a stack', () => {
    const config = generateSiteConfig({ ...base, ipv6: false });
    expect(config).toContain('listen 80;');
    expect(config).not.toContain('listen [::]');
  });

  it('usa a sintaxe atual de HTTP/2 quando há TLS', () => {
    const config = generateSiteConfig({
      ...base,
      ssl: true,
      sslCertPath: '/etc/letsencrypt/live/exemplo.com/fullchain.pem',
      sslKeyPath: '/etc/letsencrypt/live/exemplo.com/privkey.pem',
    });
    expect(config).toContain('listen 443 ssl;');
    expect(config).toContain('http2 on;');
    // `listen 443 ssl http2` é depreciado desde o NGINX 1.25.
    expect(config).not.toMatch(/listen\s+443\s+ssl\s+http2/);
  });
});

describe('generateSiteConfig — manutenção', () => {
  it('não usa caminho absoluto em try_files', () => {
    // try_files resolve seus argumentos relativos ao root; caminho absoluto de
    // filesystem nunca casa, e a manutenção silenciosamente não fazia nada.
    const config = generateSiteConfig(base);
    const tryFilesLines = config.split('\n').filter(l => l.includes('try_files'));
    for (const line of tryFilesLines) {
      expect(line).not.toContain(MAINTENANCE_DIR);
    }
  });

  it('aciona a manutenção por error_page com named location', () => {
    const config = generateSiteConfig(base);
    expect(config).toContain(`if (-f ${MAINTENANCE_DIR}/exemplo.com.html)`);
    expect(config).toContain('error_page 503 @duart_maintenance;');
    expect(config).toContain('location @duart_maintenance {');
    expect(config).toContain('try_files /exemplo.com.html =503;');
  });

  it('mantém o desafio ACME acessível durante a manutenção', () => {
    const config = generateSiteConfig(base);
    expect(config).toContain('if ($request_uri ~ ^/\\.well-known/) { set $duart_maint 0; }');
  });

  it('libera IPs de bypass', () => {
    const config = generateSiteConfig({ ...base, maintenanceBypassIps: ['203.0.113.10'] });
    expect(config).toContain('if ($remote_addr = 203.0.113.10) { set $duart_maint 0; }');
  });

  it('funciona igual em sites proxy, que não têm root', () => {
    const config = generateSiteConfig({ ...base, type: 'proxy', proxyPort: 3000 });
    expect(config).toContain('error_page 503 @duart_maintenance;');
    expect(config).toContain('proxy_pass http://127.0.0.1:3000;');
  });
});

describe('generateSiteConfig — ACME', () => {
  it('inclui o snippet de desafio em todo bloco', () => {
    const config = generateSiteConfig(base);
    expect(config).toContain('include /etc/nginx/snippets/duart-acme.conf;');
  });

  it('mantém o ACME no bloco 80 mesmo com redirect para HTTPS', () => {
    const config = generateSiteConfig({
      ...base,
      ssl: true,
      sslCertPath: '/tmp/cert.pem',
      sslKeyPath: '/tmp/key.pem',
    });
    const redirectBlock = config.split('server {')[1];
    expect(redirectBlock).toContain('duart-acme.conf');
    // O include precisa vir antes do redirect, senão a renovação é redirecionada.
    expect(redirectBlock.indexOf('duart-acme.conf')).toBeLessThan(redirectBlock.indexOf('return 301'));
  });
});

describe('generateSiteConfig — controle de acesso', () => {
  it('fecha a lista quando há allowIps', () => {
    // Sem `deny all`, uma lista de allow não restringe nada: o módulo de acesso
    // do NGINX libera por padrão o que não casa com nenhuma regra.
    const config = generateSiteConfig({ ...base, allowIps: ['10.0.0.0/8'] });
    expect(config).toContain('allow 10.0.0.0/8;');
    expect(config).toContain('deny all;');
  });

  it('mantém o site aberto quando só há denyIps', () => {
    const config = generateSiteConfig({ ...base, denyIps: ['203.0.113.5'] });
    expect(config).toContain('deny 203.0.113.5;');
    expect(config).toContain('allow all;');
  });

  it('descarta entradas que não são IP nem CIDR', () => {
    const config = generateSiteConfig({ ...base, allowIps: ['nao-e-um-ip; rm -rf /'] });
    expect(config).not.toContain('rm -rf');
  });
});

describe('generateSiteConfig — PHP', () => {
  it('aponta para o socket do pool dedicado quando existe', () => {
    const config = generateSiteConfig({
      ...base,
      type: 'php',
      phpSocket: '/run/php/duart-exemplo.com.sock',
    });
    expect(config).toContain('fastcgi_pass unix:/run/php/duart-exemplo.com.sock;');
  });

  it('cai no socket padrão da versão quando não há pool', () => {
    const config = generateSiteConfig({ ...base, type: 'php', phpVersion: '8.4' });
    expect(config).toContain('fastcgi_pass unix:/run/php/php8.4-fpm.sock;');
  });

  it('bloqueia arquivos ocultos sem barrar o ACME', () => {
    const config = generateSiteConfig({ ...base, type: 'php' });
    expect(config).toContain('location ~ /\\.(?!well-known) {');
  });
});

describe('generateSiteConfig — rate limit', () => {
  it('emite limit_req quando a zona é válida', () => {
    const config = generateSiteConfig({ ...base, rateLimitZone: 'api_zone', rateLimitBurst: 50 });
    expect(config).toContain('limit_req zone=api_zone burst=50 nodelay;');
  });

  it('ignora nome de zona inválido', () => {
    const config = generateSiteConfig({ ...base, rateLimitZone: 'zona; inválida' });
    expect(config).not.toContain('limit_req zone=');
  });
});

describe('validateCustomDirectives', () => {
  it('aceita diretivas balanceadas', () => {
    expect(validateCustomDirectives('location /api { proxy_pass http://x; }').valid).toBe(true);
  });

  it('recusa uma chave a mais, que fecharia o server block', () => {
    const result = validateCustomDirectives('add_header X 1; }');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/a mais/);
  });

  it('recusa chave sem fechar', () => {
    expect(validateCustomDirectives('location /api {').valid).toBe(false);
  });

  it('recusa blocos de escopo http', () => {
    expect(validateCustomDirectives('http { server { } }').valid).toBe(false);
  });

  it('ignora chaves dentro de comentário e de string', () => {
    expect(validateCustomDirectives('# um } comentário\nadd_header X "}";').valid).toBe(true);
  });
});

describe('splitServerBlocks', () => {
  it('separa os dois blocos de um vhost com TLS', () => {
    const config = generateSiteConfig({
      ...base,
      ssl: true,
      sslCertPath: '/tmp/cert.pem',
      sslKeyPath: '/tmp/key.pem',
    });
    expect(splitServerBlocks(config)).toHaveLength(2);
  });

  it('não se confunde com chaves dentro de location aninhado', () => {
    const raw = `
server {
    listen 80;
    location / { try_files $uri =404; }
    location /api { proxy_pass http://x; }
}
server { listen 443 ssl; }
`;
    expect(splitServerBlocks(raw)).toHaveLength(2);
  });
});

describe('parseNginxConfigFile', () => {
  const ids = new Map<string, string>();

  it('lê o bloco do site, não apenas o primeiro redirect', () => {
    // O parser antigo usava .match() sem flag global e lia só o primeiro
    // server block — que num vhost com TLS é o redirect, sem root nem tipo.
    const config = generateSiteConfig({
      ...base,
      type: 'php',
      root: '/var/www/exemplo.com',
      phpSocket: '/run/php/duart-exemplo.com.sock',
      ssl: true,
      sslCertPath: '/etc/letsencrypt/live/exemplo.com/fullchain.pem',
      sslKeyPath: '/etc/letsencrypt/live/exemplo.com/privkey.pem',
    });

    const parsed = parseNginxConfigFile(config, 'exemplo.com', '/etc/nginx/sites-available/exemplo.com', true, ids);

    expect(parsed.detectedType).toBe('php');
    expect(parsed.root).toBe('/var/www/exemplo.com');
    expect(parsed.phpFpmSocket).toBe('unix:/run/php/duart-exemplo.com.sock');
    expect(parsed.ssl).toBe(true);
    expect(parsed.sslCertPath).toBe('/etc/letsencrypt/live/exemplo.com/fullchain.pem');
    expect(parsed.blocks).toHaveLength(2);
  });

  it('reúne os domínios de todos os blocos', () => {
    const config = generateSiteConfig({
      ...base,
      aliases: ['www.exemplo.com'],
      ssl: true,
      sslCertPath: '/tmp/c.pem',
      sslKeyPath: '/tmp/k.pem',
    });
    const parsed = parseNginxConfigFile(config, 'exemplo.com', '/x', true, ids);
    expect(parsed.domains).toEqual(['exemplo.com', 'www.exemplo.com']);
  });

  it('não confunde ssl_certificate_key com ssl_certificate', () => {
    const raw = `server {
  listen 443 ssl;
  ssl_certificate /a/fullchain.pem;
  ssl_certificate_key /a/privkey.pem;
  ssl_trusted_certificate /a/chain.pem;
}`;
    const parsed = parseNginxConfigFile(raw, 'x', '/x', true, ids);
    expect(parsed.sslCertPath).toBe('/a/fullchain.pem');
    expect(parsed.sslKeyPath).toBe('/a/privkey.pem');
    expect(parsed.sslChainPath).toBe('/a/chain.pem');
  });

  it('marca como gerenciado o vhost cujo domínio está no registro', () => {
    const known = new Map([['exemplo.com', 'id-123']]);
    const parsed = parseNginxConfigFile(generateSiteConfig(base), 'exemplo.com', '/x', true, known);
    expect(parsed.managed).toBe(true);
    expect(parsed.panelId).toBe('id-123');
  });
});

describe('isValidDomain', () => {
  it.each([
    ['exemplo.com', true],
    ['sub.exemplo.com.br', true],
    ['*.exemplo.com', true],
    ['exemplo', false],
    ['exemplo.com; rm -rf /', false],
    ['-invalido.com', false],
    ['', false],
  ])('%s → %s', (domain, expected) => {
    expect(isValidDomain(domain)).toBe(expected);
  });
});
