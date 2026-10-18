import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  generatePhpMyAdminSnippet,
  injectPanelInclude,
  ensurePhpMyAdminState,
  readPhpMyAdminState,
  writePhpMyAdminState,
  withPublicAccess,
  phpMyAdminPath,
  isValidSeed,
  generateSeed,
  PMA_INCLUDE_LINE,
} from '../lib/phpmyadmin';

/**
 * phpMyAdmin no vhost do painel.
 *
 * O que estes testes protegem: o caminho com seed não pode mudar sozinho (o
 * link salvo pelo usuário quebraria), desligar o acesso tem que fechar o
 * caminho de fato, e o include nunca pode cair no bloco HTTP que só
 * redireciona — senão o phpMyAdmin responde em texto puro.
 */

const SEED = 'a1b2c3d4e5f60718293a';
const SOCKET = '/run/php/duart-phpmyadmin.sock';

describe('generatePhpMyAdminSnippet — habilitado', () => {
  const snippet = generatePhpMyAdminSnippet({ seed: SEED, enabled: true, socket: SOCKET });

  it('serve no caminho com a seed, com prioridade sobre o proxy do painel', () => {
    expect(snippet).toContain(`location ^~ /phpmyadmin_${SEED}/ {`);
    expect(snippet).toContain(`alias /usr/share/phpmyadmin/;`);
  });

  it('redireciona o caminho sem barra final', () => {
    expect(snippet).toContain(`location = /phpmyadmin_${SEED} {`);
    expect(snippet).toContain(`return 301 /phpmyadmin_${SEED}/;`);
  });

  it('passa PHP para o pool dedicado com SCRIPT_FILENAME vindo da captura', () => {
    expect(snippet).toContain(`location ~ ^/phpmyadmin_${SEED}/(.+\\.php)$ {`);
    expect(snippet).toContain('fastcgi_param SCRIPT_FILENAME /usr/share/phpmyadmin/$1;');
    expect(snippet).toContain(`fastcgi_pass unix:${SOCKET};`);
    expect(snippet).toContain('include fastcgi_params;');
  });

  it('bloqueia diretórios internos e arquivos ocultos', () => {
    expect(snippet).toMatch(/\(libraries\|setup\|templates\|sql\|vendor\)\/ \{\n\s+deny all;/);
    expect(snippet).toContain('location ~ /\\. {');
  });

  it('tem chaves balanceadas (senão o nginx -t do vhost inteiro falha)', () => {
    const open = (snippet.match(/\{/g) || []).length;
    const close = (snippet.match(/\}/g) || []).length;
    expect(open).toBe(close);
  });

  it('não emite server block nem listen: é incluído dentro do vhost do painel', () => {
    expect(snippet).not.toMatch(/^\s*server\s*\{/m);
    expect(snippet).not.toMatch(/^\s*listen\b/m);
  });

  it('recusa socket ou seed inválidos em vez de gerar config injetável', () => {
    expect(() => generatePhpMyAdminSnippet({ seed: SEED, enabled: true })).toThrow();
    expect(() => generatePhpMyAdminSnippet({ seed: SEED, enabled: true, socket: '/run/x.sock; }' })).toThrow();
    expect(() => generatePhpMyAdminSnippet({ seed: 'abc/../x', enabled: true, socket: SOCKET })).toThrow();
  });
});

describe('generatePhpMyAdminSnippet — desabilitado', () => {
  const snippet = generatePhpMyAdminSnippet({ seed: SEED, enabled: false });

  it('responde 404 no caminho em vez de cair no proxy do painel', () => {
    expect(snippet).toContain(`location ^~ /phpmyadmin_${SEED} {`);
    expect(snippet).toContain('return 404;');
  });

  it('não expõe nada do PHP', () => {
    expect(snippet).not.toContain('fastcgi_pass');
    expect(snippet).not.toContain('alias');
  });
});

/* Os dois formatos que os scripts escrevem: install.sh (HTTP) e setup-ssl.sh (TLS). */

const HTTP_VHOST = `# Duart Panel — painel.exemplo.com
server {
    listen 80;
    listen [::]:80;
    server_name painel.exemplo.com;

    include snippets/duart-acme.conf;

    location / {
        proxy_pass http://127.0.0.1:34567;
        include snippets/duart-proxy.conf;
    }
}
`;

const TLS_VHOST = `# Duart Panel — painel.exemplo.com (TLS)
server {
    listen 80;
    server_name painel.exemplo.com;

    include snippets/duart-acme.conf;

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name painel.exemplo.com;

    ssl_certificate     /etc/letsencrypt/live/painel.exemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/painel.exemplo.com/privkey.pem;

    include snippets/duart-acme.conf;

    location / {
        proxy_pass http://127.0.0.1:34567;
        include snippets/duart-proxy.conf;
    }
}
`;

describe('injectPanelInclude', () => {
  it('insere o include antes do location / do proxy (vhost HTTP)', () => {
    const { content, changed } = injectPanelInclude(HTTP_VHOST);
    expect(changed).toBe(true);
    const includeAt = content.indexOf(PMA_INCLUDE_LINE);
    expect(includeAt).toBeGreaterThan(0);
    expect(includeAt).toBeLessThan(content.indexOf('location / {'));
    expect(content).toContain(`    ${PMA_INCLUDE_LINE}`);
  });

  it('no vhost TLS, só entra no bloco 443 — nunca no redirect da porta 80', () => {
    const { content } = injectPanelInclude(TLS_VHOST);
    expect(content.split(PMA_INCLUDE_LINE).length - 1).toBe(1);
    const [httpBlock, tlsBlock] = content.split(/\n(?=server \{)/).filter(b => b.startsWith('server'));
    expect(httpBlock).not.toContain(PMA_INCLUDE_LINE);
    expect(tlsBlock).toContain(PMA_INCLUDE_LINE);
  });

  it('preserva o bloco TLS e o http2 gerados antes', () => {
    const { content } = injectPanelInclude(TLS_VHOST);
    expect(content).toContain('http2 on;');
    expect(content).toContain('ssl_certificate_key /etc/letsencrypt/live/painel.exemplo.com/privkey.pem;');
    expect(content).toContain('proxy_pass http://127.0.0.1:34567;');
  });

  it('é idempotente', () => {
    const once = injectPanelInclude(TLS_VHOST).content;
    const twice = injectPanelInclude(once);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once);
  });

  it('reconhece o include já escrito pelos scripts', () => {
    const fromScript = HTTP_VHOST.replace(
      '    location / {',
      '    # phpMyAdmin (gerenciado pelo painel)\n    include snippets/duart-phpmyadmin.conf;\n\n    location / {',
    );
    expect(injectPanelInclude(fromScript).changed).toBe(false);
  });

  it('ignora include comentado', () => {
    const commented = HTTP_VHOST.replace('    location / {', `    # ${PMA_INCLUDE_LINE}\n    location / {`);
    const { content, changed } = injectPanelInclude(commented);
    expect(changed).toBe(true);
    expect(content.split('\n').filter(l => l.trim() === PMA_INCLUDE_LINE)).toHaveLength(1);
  });

  it('recusa vhost que não é o do painel', () => {
    const other = 'server {\n    listen 80;\n    root /var/www/x;\n    location / {\n        try_files $uri =404;\n    }\n}\n';
    expect(() => injectPanelInclude(other)).toThrow();
  });
});

describe('seed e estado persistido', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duart-pma-'));
    file = path.join(dir, 'phpmyadmin.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('gera seeds válidas e diferentes', () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(isValidSeed(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(phpMyAdminPath(a)).toBe(`/phpmyadmin_${a}`);
  });

  it('cria a seed uma vez e a reaproveita depois', () => {
    const first = ensurePhpMyAdminState(file);
    const second = ensurePhpMyAdminState(file);
    expect(second.seed).toBe(first.seed);
    expect(first.installed).toBe(false);
    expect(first.enabled).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a seed sobrevive a ligar e desligar', () => {
    const initial = ensurePhpMyAdminState(file);
    writePhpMyAdminState({ ...initial, installed: true, enabled: true }, file);
    writePhpMyAdminState(withPublicAccess(readPhpMyAdminState(file)!, false), file);
    const after = readPhpMyAdminState(file)!;
    expect(after.seed).toBe(initial.seed);
    expect(after.enabled).toBe(false);
    expect(after.installed).toBe(true);
  });

  it('troca uma seed inválida (editada à mão) antes de ela chegar ao NGINX', () => {
    fs.writeFileSync(file, JSON.stringify({ seed: 'x; return 200', installed: true, enabled: true }));
    expect(readPhpMyAdminState(file)).toBeNull();
    const state = ensurePhpMyAdminState(file);
    expect(isValidSeed(state.seed)).toBe(true);
  });

  it('não liga o acesso público sem o phpMyAdmin instalado', () => {
    const state = ensurePhpMyAdminState(file);
    expect(() => withPublicAccess(state, true)).toThrow(/Instale/);
    expect(withPublicAccess(state, false).enabled).toBe(false);
  });

  it('o toggle muda só o enabled', () => {
    const state = { seed: SEED, installed: true, enabled: false, phpVersion: '8.3' };
    expect(withPublicAccess(state, true)).toEqual({ ...state, enabled: true });
  });
});
