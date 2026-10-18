/**
 * phpMyAdmin servido no host do próprio painel.
 *
 * O vhost do painel é escrito por scripts/install.sh e reescrito por
 * scripts/setup-ssl.sh quando o TLS é emitido — editar locations dentro dele
 * não sobreviveria. Em vez disso o vhost ganha uma única linha,
 * `include snippets/duart-phpmyadmin.conf;`, no(s) bloco(s) que fazem proxy
 * para o painel (nunca no bloco da porta 80 que só redireciona para HTTPS), e
 * todo o resto vive no snippet, que o painel regenera à vontade. Os dois
 * scripts também passam a escrever essa linha.
 *
 * O caminho é `/phpmyadmin_<seed>`: a seed é gerada uma vez e persistida no
 * DATA_DIR, então o endereço não muda entre reinstalações e não é adivinhável
 * por quem varre `/phpmyadmin` atrás de instalações expostas.
 *
 * Desativar o acesso público não remove o include: o snippet passa a conter
 * só um `return 404` para o caminho. Assim ligar e desligar mexe em um arquivo
 * só, e o 404 vem do NGINX em vez de cair no proxy do painel.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { executeCommand, executeCommandWithInput } from './system';
import { readJson, writeJson } from './fsx';
import { readConfig } from './data/config';
import { databasesDir, ensureDatabasesDir } from './db-credentials';
import { SNIPPET_PHPMYADMIN } from './nginx';
import { applyNginxChanges, NGINX_AVAILABLE, FileMutation } from './nginx-ops';
import {
  preferredPhpVersion, installPhp, ensurePoolUser, applyPool, poolSocketPath, poolName,
} from './php';
import { readOsInfo, OsInfo, activeMysqlService, InstallLog } from './mysql';

export const PMA_ROOT = '/usr/share/phpmyadmin';
export const PMA_POOL_DOMAIN = 'phpmyadmin';
export { SNIPPET_PHPMYADMIN };
export const PMA_INCLUDE_LINE = 'include snippets/duart-phpmyadmin.conf;';

/** Extensões que o phpMyAdmin exige ou usa para importação/exportação. */
export const PMA_PHP_EXTENSIONS = ['cli', 'fpm', 'common', 'mysql', 'mbstring', 'xml', 'zip', 'gd', 'curl', 'intl', 'bcmath'];

/* ------------------------------------------------------------------ */
/*  Estado e seed                                                      */
/* ------------------------------------------------------------------ */

export interface PhpMyAdminState {
  seed: string;
  installed: boolean;
  /** Acesso público pelo vhost do painel. */
  enabled: boolean;
  phpVersion?: string;
  installedAt?: string;
  updatedAt?: string;
}

export function phpMyAdminStatePath(): string {
  return path.join(databasesDir(), 'phpmyadmin.json');
}

export function isValidSeed(seed: unknown): seed is string {
  return typeof seed === 'string' && /^[a-z0-9]{12,64}$/.test(seed);
}

export function generateSeed(): string {
  return randomBytes(10).toString('hex');
}

export function readPhpMyAdminState(file = phpMyAdminStatePath()): PhpMyAdminState | null {
  const stored = readJson<Partial<PhpMyAdminState>>(file, {});
  if (!isValidSeed(stored.seed)) return null;
  return {
    seed: stored.seed,
    installed: Boolean(stored.installed),
    enabled: Boolean(stored.enabled),
    phpVersion: stored.phpVersion,
    installedAt: stored.installedAt,
    updatedAt: stored.updatedAt,
  };
}

export function writePhpMyAdminState(state: PhpMyAdminState, file = phpMyAdminStatePath()): void {
  if (file === phpMyAdminStatePath()) ensureDatabasesDir();
  writeJson(file, { ...state, updatedAt: new Date().toISOString() }, 0o600);
}

/**
 * Lê a seed persistida ou cria uma. Só é gerada uma vez: um arquivo com seed
 * inválida (editado à mão) também ganha uma nova, já que o caminho derivado
 * dela iria parar dentro de um arquivo do NGINX.
 */
export function ensurePhpMyAdminState(file = phpMyAdminStatePath()): PhpMyAdminState {
  const current = readPhpMyAdminState(file);
  if (current) return current;
  const state: PhpMyAdminState = { seed: generateSeed(), installed: false, enabled: false };
  writePhpMyAdminState(state, file);
  return state;
}

export function phpMyAdminPath(seed: string): string {
  if (!isValidSeed(seed)) throw new Error('Seed do phpMyAdmin inválida');
  return `/phpmyadmin_${seed}`;
}

/** Aplica ligar/desligar sobre o estado, sem tocar em disco. */
export function withPublicAccess(state: PhpMyAdminState, enabled: boolean): PhpMyAdminState {
  if (enabled && !state.installed) {
    throw new Error('Instale o phpMyAdmin antes de liberar o acesso');
  }
  return { ...state, enabled };
}

/* ------------------------------------------------------------------ */
/*  Configuração NGINX                                                 */
/* ------------------------------------------------------------------ */

export interface PhpMyAdminSnippetOptions {
  seed: string;
  enabled: boolean;
  /** Socket do pool PHP-FPM. Obrigatório quando habilitado. */
  socket?: string;
  root?: string;
  clientMaxBodySize?: string;
}

export function generatePhpMyAdminSnippet(options: PhpMyAdminSnippetOptions): string {
  const base = phpMyAdminPath(options.seed);
  const header = [
    '# Duart Panel — phpMyAdmin',
    '# Gerado automaticamente; incluído no vhost do painel. Use o painel para',
    '# ligar ou desligar o acesso — edições manuais são sobrescritas.',
    '',
  ];

  if (!options.enabled) {
    return [
      ...header,
      '# Acesso público desativado.',
      `location ^~ ${base} {`,
      '    return 404;',
      '}',
      '',
    ].join('\n');
  }

  if (!options.socket || !/^\/[A-Za-z0-9_./-]+\.sock$/.test(options.socket)) {
    throw new Error('Socket PHP-FPM inválido para o phpMyAdmin');
  }
  const root = (options.root || PMA_ROOT).replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9_./-]+$/.test(root)) throw new Error('Diretório do phpMyAdmin inválido');
  const bodySize = options.clientMaxBodySize || '128m';

  // `^~` vence as regex do server (e o `location /` do proxy do painel).
  // Com `alias` em location regex, o caminho precisa vir da captura; por isso
  // SCRIPT_FILENAME é montado com $1 em vez de $request_filename.
  return [
    ...header,
    `location = ${base} {`,
    `    return 301 ${base}/;`,
    '}',
    '',
    `location ^~ ${base}/ {`,
    `    alias ${root}/;`,
    '    index index.php;',
    `    client_max_body_size ${bodySize};`,
    '',
    '    # Código interno nunca é servido diretamente',
    `    location ~ ^${base}/(libraries|setup|templates|sql|vendor)/ {`,
    '        deny all;',
    '    }',
    '',
    `    location ~ ^${base}/(.+\\.php)$ {`,
    `        alias ${root}/$1;`,
    '        include fastcgi_params;',
    `        fastcgi_param SCRIPT_FILENAME ${root}/$1;`,
    '        fastcgi_param HTTP_PROXY "";',
    `        fastcgi_pass unix:${options.socket};`,
    '        fastcgi_read_timeout 300s;',
    '    }',
    '',
    '    location ~ /\\. {',
    '        deny all;',
    '    }',
    '}',
    '',
  ].join('\n');
}

/**
 * Insere o include no vhost do painel, antes do `location /` de cada bloco
 * que faz proxy para 127.0.0.1 (o Next.js do painel). Blocos que só
 * redirecionam para HTTPS ficam de fora — senão o phpMyAdmin responderia em
 * HTTP puro.
 *
 * Idempotente: se o include já existe, devolve o conteúdo sem mudança.
 */
export function injectPanelInclude(content: string, includeLine = PMA_INCLUDE_LINE): { content: string; changed: boolean } {
  const includeName = includeLine.replace(/^include\s+/, '').replace(/;$/, '').trim();
  const already = content.split('\n').some(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('#') && trimmed.startsWith('include') && trimmed.includes(includeName);
  });
  if (already) return { content, changed: false };

  const lines = content.split('\n');
  const insertAt: Array<{ index: number; indent: string }> = [];
  let lastRootLocation: { index: number; indent: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (/^server\s*\{/.test(trimmed)) {
      lastRootLocation = null;
      continue;
    }
    const location = line.match(/^(\s*)location\s+\/\s*\{/);
    if (location) {
      lastRootLocation = { index: i, indent: location[1] };
      continue;
    }
    if (lastRootLocation && /^proxy_pass\s+http:\/\/(127\.0\.0\.1|localhost):\d+/.test(trimmed)) {
      insertAt.push(lastRootLocation);
      lastRootLocation = null;
    }
  }

  if (!insertAt.length) {
    throw new Error('O vhost do painel não tem um `location /` com proxy para 127.0.0.1 — não foi possível incluir o phpMyAdmin');
  }

  for (const { index, indent } of [...insertAt].reverse()) {
    lines.splice(index, 0, `${indent}# phpMyAdmin (gerenciado pelo painel)`, `${indent}${includeLine}`, '');
  }
  return { content: lines.join('\n'), changed: true };
}

export function panelVhostPath(domain = readConfig().domain): string {
  if (!domain || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    throw new Error('Domínio do painel não configurado (config.domain). Reexecute scripts/install.sh.');
  }
  return path.join(NGINX_AVAILABLE, domain);
}

/** Mutações (snippet + include no vhost) para o estado desejado, aplicadas com nginx -t e rollback. */
export function phpMyAdminMutations(state: PhpMyAdminState, vhostFile: string): FileMutation[] {
  if (!fs.existsSync(vhostFile)) {
    throw new Error(`Vhost do painel não encontrado em ${vhostFile}`);
  }
  const snippet = generatePhpMyAdminSnippet({
    seed: state.seed,
    enabled: state.enabled,
    socket: state.enabled ? poolSocketPath(PMA_POOL_DOMAIN) : undefined,
  });
  const mutations: FileMutation[] = [{ action: 'write', path: SNIPPET_PHPMYADMIN, content: snippet, mode: 0o644 }];

  // install.sh/setup-ssl.sh podem reescrever o vhost sem a linha: confere sempre.
  const vhost = fs.readFileSync(vhostFile, 'utf-8');
  const injected = injectPanelInclude(vhost);
  if (injected.changed) {
    mutations.push({ action: 'write', path: vhostFile, content: injected.content, mode: 0o644 });
  }
  return mutations;
}

/* ------------------------------------------------------------------ */
/*  Operações                                                          */
/* ------------------------------------------------------------------ */

export interface PhpMyAdminStatus {
  installed: boolean;
  enabled: boolean;
  path: string;
  url: string | null;
  phpVersion?: string;
  packagePresent: boolean;
}

export function phpMyAdminStatus(): PhpMyAdminStatus {
  const state = ensurePhpMyAdminState();
  const domain = readConfig().domain;
  const pmaPath = `${phpMyAdminPath(state.seed)}/`;
  return {
    installed: state.installed,
    enabled: state.enabled,
    path: pmaPath,
    // O esquema real depende do TLS do vhost; a UI usa o da página atual.
    url: domain ? `//${domain}${pmaPath}` : null,
    phpVersion: state.phpVersion,
    packagePresent: fs.existsSync(path.join(PMA_ROOT, 'index.php')),
  };
}

export async function setPhpMyAdminPublic(enabled: boolean): Promise<PhpMyAdminState> {
  const current = ensurePhpMyAdminState();
  const next = withPublicAccess(current, enabled);
  await applyNginxChanges(phpMyAdminMutations(next, panelVhostPath()));
  writePhpMyAdminState(next);
  return next;
}

/** Versão de PHP que cada distro traz nos próprios repositórios. */
export function distroPhpVersion(os: OsInfo): string | null {
  const byCodename: Record<string, string> = {
    jammy: '8.1',
    noble: '8.3',
    oracular: '8.3',
    plucky: '8.4',
    questing: '8.4',
    bookworm: '8.2',
    trixie: '8.4',
  };
  return byCodename[os.codename] ?? null;
}

const DEBCONF_PHPMYADMIN = [
  // Sem banco de controle (dbconfig): ele pediria a senha root no postinst.
  'phpmyadmin phpmyadmin/dbconfig-install boolean false',
  // Nenhum servidor web para reconfigurar: o NGINX é configurado pelo painel.
  'phpmyadmin phpmyadmin/reconfigure-webserver multiselect',
  '',
].join('\n');

/**
 * Instala PHP-FPM (se faltar), o pacote phpmyadmin, um pool dedicado e a
 * configuração NGINX. Termina com o acesso público ligado.
 */
export async function installPhpMyAdmin(log: InstallLog): Promise<PhpMyAdminStatus> {
  const service = await activeMysqlService();
  if (!service) throw new Error('O MySQL/MariaDB precisa estar instalado e rodando antes do phpMyAdmin');

  const vhostFile = panelVhostPath();
  if (!fs.existsSync(vhostFile)) throw new Error(`Vhost do painel não encontrado em ${vhostFile}`);

  let version = await preferredPhpVersion();
  if (!version) {
    version = distroPhpVersion(readOsInfo());
    if (!version) {
      throw new Error('Nenhum PHP-FPM instalado e a versão padrão desta distro é desconhecida. Instale o PHP pela tela PHP e tente de novo.');
    }
    log(`PHP-FPM não encontrado; instalando PHP ${version}`);
  } else {
    log(`Usando PHP ${version}; conferindo extensões`);
  }
  // Idempotente: com tudo presente, o apt não faz nada.
  const php = await installPhp(version, PMA_PHP_EXTENSIONS);
  if (!php.ok) throw new Error(`Falha ao instalar PHP ${version}: ${php.output.slice(-600)}`);

  log('Pré-configurando o debconf do phpmyadmin');
  const preseed = await executeCommandWithInput('debconf_set_selections', [], DEBCONF_PHPMYADMIN);
  if (preseed.code !== 0) throw new Error(`debconf-set-selections falhou: ${preseed.stderr || preseed.stdout}`);

  log('Instalando o pacote phpmyadmin');
  // Sem recommends: eles puxariam o apache2, que disputa a porta 80 com o NGINX.
  const install = await executeCommand('apt_install_noninteractive', ['-qq', '--no-install-recommends', 'phpmyadmin']);
  if (install.code !== 0) throw new Error(`Instalação do phpmyadmin falhou: ${(install.stderr || install.stdout).slice(-800)}`);
  if (!fs.existsSync(path.join(PMA_ROOT, 'index.php'))) throw new Error(`${PMA_ROOT}/index.php não existe após a instalação`);

  log('Criando pool PHP-FPM dedicado');
  const user = await ensurePoolUser(PMA_POOL_DOMAIN, PMA_ROOT);
  const name = poolName(PMA_POOL_DOMAIN);
  const pool = await applyPool({
    domain: PMA_POOL_DOMAIN,
    version,
    user,
    // Grupo www-data: o pacote deixa config-db.php e blowfish_secret como root:www-data 0640.
    group: 'www-data',
    root: PMA_ROOT,
    maxChildren: 5,
    memoryLimit: '512M',
    uploadMaxFilesize: '128M',
    postMaxSize: '128M',
    maxExecutionTime: 300,
    maxInputVars: 10000,
    // O Debian separa as bibliotecas do phpMyAdmin em /usr/share/php e /usr/share/javascript.
    openBasedir: [PMA_ROOT, '/etc/phpmyadmin', '/var/lib/phpmyadmin', '/usr/share/php', '/usr/share/javascript', `/var/lib/php/sessions/${name}`, '/tmp'],
  });
  if (!pool.ok) throw new Error(`Pool PHP-FPM rejeitado: ${pool.error}`);

  // Sessões e tmp do phpMyAdmin precisam ser graváveis pelo usuário do pool.
  await executeCommand('chown_path', ['-R', `${user}:www-data`, `/var/lib/php/sessions/${name}`]);
  if (fs.existsSync('/var/lib/phpmyadmin/tmp')) {
    await executeCommand('chown_path', ['-R', `${user}:www-data`, '/var/lib/phpmyadmin/tmp']);
  }

  log('Configurando o NGINX (nginx -t com rollback)');
  const state: PhpMyAdminState = {
    ...ensurePhpMyAdminState(),
    installed: true,
    enabled: true,
    phpVersion: version,
    installedAt: new Date().toISOString(),
  };
  await applyNginxChanges(phpMyAdminMutations(state, vhostFile));
  writePhpMyAdminState(state);

  return phpMyAdminStatus();
}
