/**
 * Serviço de sites NGINX.
 *
 * A lógica de criar, editar e remover vhost vivia inteira dentro do handler da
 * rota de API. Ela agora mora aqui porque a IA precisa executar exatamente as
 * mesmas operações — e uma IA que compõe playbooks testados é bem mais confiável
 * que uma que escreve shell na hora.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  generateSiteConfig,
  parseNginxConfigFile,
  getMaintenanceFilePath,
  getDefaultMaintenancePage,
  validateCustomDirectives,
  isValidDomain,
  isValidRate,
  isValidZoneName,
  MAINTENANCE_DIR,
  NginxSiteConfig,
  ParsedVhost,
  SiteType,
} from './nginx';
import {
  applyNginxChanges,
  ensureScaffoldSync,
  syncRateLimitZones,
  sitePaths,
  isSiteEnabled,
  NGINX_AVAILABLE,
  NGINX_ENABLED,
  NginxConfigError,
  FileMutation,
} from './nginx-ops';
import { readJson, writeJson, ensureDir, withFileLock } from './fsx';
import { applyPool, removePool, ensurePoolUser, preferredPhpVersion, phpSizeFromNginx, POOL_PRESETS } from './php';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const NGINX_DATA_DIR = path.join(DATA_DIR, 'nginx');
const SITES_FILE = path.join(NGINX_DATA_DIR, 'sites.json');

export interface ManagedSite {
  id: string;
  domain: string;
  type: SiteType;
  root?: string | null;
  proxyPort?: number | null;
  proxyUrl?: string | null;
  proxySocket?: string | null;
  websocket: boolean;
  phpVersion?: string | null;
  phpSocket?: string | null;
  phpPoolManaged?: boolean;
  phpPreset?: string | null;
  ssl: boolean;
  sslCertId?: string | null;
  sslCertPath?: string | null;
  sslKeyPath?: string | null;
  sslChainPath?: string | null;
  enabled: boolean;
  configPath: string;
  fileName: string;
  managed: boolean;
  maintenance: boolean;
  maintenanceBypassIps?: string[] | null;
  clientMaxBodySize?: string | null;
  gzip?: boolean;
  aliases?: string[] | null;
  listenPort?: number | null;
  ipv6?: boolean;
  hstsMaxAge?: number | null;
  hstsPreload?: boolean;
  customDirectives?: string | null;
  errorPages?: Record<number, string> | null;
  allowIps?: string[] | null;
  denyIps?: string[] | null;
  authBasicFile?: string | null;
  authBasicRealm?: string | null;
  cacheStaticDuration?: string | null;
  rateLimitZone?: string | null;
  rateLimitRate?: string | null;
  rateLimitBurst?: number | null;
  createdAt: string;
  updatedAt?: string;
}

interface SitesFile {
  sites: ManagedSite[];
}

export class SiteError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SiteError';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/*  Registro                                                           */
/* ------------------------------------------------------------------ */

export function readSites(): ManagedSite[] {
  ensureDir(NGINX_DATA_DIR);
  return readJson<SitesFile>(SITES_FILE, { sites: [] }).sites || [];
}

function persistSites(sites: ManagedSite[]): void {
  ensureDir(NGINX_DATA_DIR);
  writeJson(SITES_FILE, { sites });
}

export function getSite(id: string): ManagedSite | null {
  return readSites().find(s => s.id === id) ?? null;
}

export function getSiteByDomain(domain: string): ManagedSite | null {
  return readSites().find(s => s.domain === domain) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Conversão para o gerador                                           */
/* ------------------------------------------------------------------ */

export function toNginxConfig(site: ManagedSite): NginxSiteConfig {
  return {
    domain: site.domain,
    type: site.type,
    root: site.root || undefined,
    proxyPort: site.proxyPort || undefined,
    proxySocket: site.proxySocket || undefined,
    websocket: site.websocket,
    phpVersion: site.phpVersion || undefined,
    phpSocket: site.phpSocket || undefined,
    ssl: site.ssl,
    sslCertPath: site.sslCertPath || undefined,
    sslKeyPath: site.sslKeyPath || undefined,
    sslChainPath: site.sslChainPath || undefined,
    redirectHttp: site.ssl,
    maintenance: site.maintenance,
    maintenanceBypassIps: site.maintenanceBypassIps || undefined,
    clientMaxBodySize: site.clientMaxBodySize || undefined,
    gzip: site.gzip,
    aliases: site.aliases || undefined,
    listenPort: site.listenPort || undefined,
    ipv6: site.ipv6,
    hstsMaxAge: site.hstsMaxAge ?? undefined,
    hstsPreload: site.hstsPreload,
    customDirectives: site.customDirectives || undefined,
    errorPages: site.errorPages || undefined,
    allowIps: site.allowIps || undefined,
    denyIps: site.denyIps || undefined,
    authBasicFile: site.authBasicFile || undefined,
    authBasicRealm: site.authBasicRealm || undefined,
    cacheStaticDuration: site.cacheStaticDuration || undefined,
    rateLimitZone: site.rateLimitZone || undefined,
    rateLimitRate: site.rateLimitRate || undefined,
    rateLimitBurst: site.rateLimitBurst ?? undefined,
  };
}

export function renderSiteConfig(site: ManagedSite): string {
  return generateSiteConfig(toNginxConfig(site));
}

/* ------------------------------------------------------------------ */
/*  Validação                                                          */
/* ------------------------------------------------------------------ */

function validate(site: Partial<ManagedSite>): void {
  if (site.domain && !isValidDomain(site.domain)) {
    throw new SiteError(`Domínio inválido: ${site.domain}`);
  }
  for (const alias of site.aliases || []) {
    if (!isValidDomain(alias)) throw new SiteError(`Alias inválido: ${alias}`);
  }
  if (site.customDirectives) {
    const check = validateCustomDirectives(site.customDirectives);
    if (!check.valid) throw new SiteError(`Diretivas customizadas inválidas: ${check.error}`);
  }
  if (site.rateLimitZone && !isValidZoneName(site.rateLimitZone)) {
    throw new SiteError('Nome de zona de rate limit inválido (use letras, números e _)');
  }
  if (site.rateLimitRate && !isValidRate(site.rateLimitRate)) {
    throw new SiteError('Taxa de rate limit inválida (formato esperado: 10r/s ou 100r/m)');
  }
  if (site.clientMaxBodySize && !/^\d+[kKmMgG]?$/.test(site.clientMaxBodySize)) {
    throw new SiteError('Tamanho máximo de corpo inválido (ex.: 64M)');
  }
}

/** Zonas declaradas pelos sites, para regravar o conf.d de rate limit. */
function collectZones(sites: ManagedSite[]): Array<{ name: string; rate: string }> {
  const zones = new Map<string, string>();
  for (const site of sites) {
    if (site.rateLimitZone && site.rateLimitRate && isValidZoneName(site.rateLimitZone) && isValidRate(site.rateLimitRate)) {
      zones.set(site.rateLimitZone, site.rateLimitRate);
    }
  }
  return Array.from(zones, ([name, rate]) => ({ name, rate }));
}

/* ------------------------------------------------------------------ */
/*  Pool PHP                                                           */
/* ------------------------------------------------------------------ */

/**
 * Garante um pool FPM dedicado ao site.
 * Sem isso todos os sites caem no pool `www`: mesmo usuário, mesmos workers e
 * leitura cruzada de arquivos entre sites.
 */
async function ensurePhpPool(site: ManagedSite): Promise<void> {
  if (site.type !== 'php' || site.phpPoolManaged === false) return;

  const version = site.phpVersion || await preferredPhpVersion();
  if (!version) {
    throw new SiteError(
      'Nenhuma versão de PHP-FPM foi encontrada no servidor. Instale o PHP pela tela de PHP antes de criar um site PHP.',
    );
  }

  const root = site.root || `/var/www/${site.domain}`;
  ensureDir(root, 0o755);

  const user = await ensurePoolUser(site.domain, root);
  const preset = POOL_PRESETS[site.phpPreset || 'padrao'] || POOL_PRESETS.padrao;
  const sizeFromNginx = phpSizeFromNginx(site.clientMaxBodySize || undefined);

  const result = await applyPool({
    domain: site.domain,
    version,
    user,
    group: user,
    root,
    ...preset,
    // O limite do NGINX manda: ter os dois configuráveis em telas diferentes é
    // a origem do "aumentei o limite e o upload continua falhando".
    uploadMaxFilesize: sizeFromNginx || preset.uploadMaxFilesize,
    postMaxSize: sizeFromNginx || preset.postMaxSize,
  });

  if (!result.ok) {
    throw new SiteError(`Falha ao configurar o pool PHP: ${result.error}`);
  }

  site.phpVersion = version;
  site.phpSocket = result.socket;
  site.phpPoolManaged = true;
}

/* ------------------------------------------------------------------ */
/*  Operações                                                          */
/* ------------------------------------------------------------------ */

export interface CreateSiteInput {
  domain: string;
  type: SiteType;
  root?: string;
  proxyPort?: number;
  proxySocket?: string;
  websocket?: boolean;
  phpVersion?: string;
  phpPreset?: string;
  aliases?: string[];
  listenPort?: number;
  clientMaxBodySize?: string;
  gzip?: boolean;
  customDirectives?: string;
  ipv6?: boolean;
}

export async function createSite(input: CreateSiteInput): Promise<ManagedSite> {
  ensureScaffoldSync();
  validate(input);

  if (!input.domain || !input.type) {
    throw new SiteError('Domínio e tipo são obrigatórios');
  }

  const existing = readSites();
  if (existing.some(s => s.domain === input.domain)) {
    throw new SiteError('Já existe um site com este domínio', 409);
  }

  const fileName = input.domain;
  const { available, enabled } = sitePaths(fileName);

  if (fs.existsSync(available)) {
    throw new SiteError(
      `Já existe um arquivo de configuração em ${available}. Use a opção Importar para trazê-lo para o painel.`,
      409,
    );
  }

  const site: ManagedSite = {
    id: randomUUID(),
    domain: input.domain,
    type: input.type,
    root: input.root || (input.type === 'static' || input.type === 'php' ? `/var/www/${input.domain}` : null),
    proxyPort: input.proxyPort ?? null,
    proxySocket: input.proxySocket ?? null,
    websocket: Boolean(input.websocket),
    phpVersion: input.phpVersion ?? null,
    phpPreset: input.phpPreset ?? 'padrao',
    ssl: false,
    enabled: true,
    configPath: available,
    fileName,
    managed: true,
    maintenance: false,
    aliases: input.aliases?.length ? input.aliases : null,
    listenPort: input.listenPort ?? null,
    ipv6: input.ipv6 !== false,
    clientMaxBodySize: input.clientMaxBodySize ?? null,
    gzip: input.gzip !== false,
    customDirectives: input.customDirectives ?? null,
    createdAt: new Date().toISOString(),
  };

  if (site.root) ensureDir(site.root, 0o755);
  await ensurePhpPool(site);

  await applyNginxChanges([
    { action: 'write', path: available, content: renderSiteConfig(site) },
    { action: 'symlink', path: enabled, target: available },
  ]);

  persistSites([...existing, site]);
  await syncRateLimitZones(collectZones([...existing, site]));

  return site;
}

const UPDATABLE_FIELDS: Array<keyof ManagedSite> = [
  'type', 'root', 'proxyPort', 'proxyUrl', 'proxySocket', 'websocket',
  'phpVersion', 'phpPreset', 'ssl', 'sslCertId', 'sslCertPath', 'sslKeyPath', 'sslChainPath',
  'maintenance', 'maintenanceBypassIps', 'clientMaxBodySize', 'gzip', 'aliases', 'listenPort', 'ipv6',
  'hstsMaxAge', 'hstsPreload', 'customDirectives', 'errorPages', 'allowIps', 'denyIps',
  'authBasicFile', 'authBasicRealm', 'cacheStaticDuration',
  'rateLimitZone', 'rateLimitRate', 'rateLimitBurst',
];

export async function updateSite(id: string, updates: Partial<ManagedSite>): Promise<ManagedSite> {
  return withFileLock(SITES_FILE, async () => {
    ensureScaffoldSync();

    const sites = readSites();
    const index = sites.findIndex(s => s.id === id);
    if (index === -1) throw new SiteError('Site não encontrado', 404);

    const site: ManagedSite = { ...sites[index] };

    for (const field of UPDATABLE_FIELDS) {
      if (updates[field] !== undefined) {
        Object.assign(site, { [field]: updates[field] });
      }
    }
    site.updatedAt = new Date().toISOString();

    validate(site);
    if (site.root) ensureDir(site.root, 0o755);
    await ensurePhpPool(site);

    // applyNginxChanges restaura o arquivo anterior se o nginx -t reprovar,
    // então o disco nunca fica com uma configuração inválida.
    await applyNginxChanges([
      { action: 'write', path: site.configPath, content: renderSiteConfig(site) },
    ]);

    sites[index] = site;
    persistSites(sites);
    await syncRateLimitZones(collectZones(sites));

    return site;
  });
}

export async function deleteSite(id: string, options: { removeFiles?: boolean } = {}): Promise<void> {
  return withFileLock(SITES_FILE, async () => {
    const sites = readSites();
    const index = sites.findIndex(s => s.id === id);
    if (index === -1) throw new SiteError('Site não encontrado', 404);

    const site = sites[index];
    const { available, enabled } = sitePaths(site.fileName || site.domain);

    const mutations: FileMutation[] = [
      { action: 'delete', path: enabled },
      { action: 'delete', path: available },
    ];
    if (site.configPath !== available) {
      mutations.push({ action: 'delete', path: site.configPath });
    }

    await applyNginxChanges(mutations);

    if (site.type === 'php' && site.phpVersion && site.phpPoolManaged) {
      await removePool(site.phpVersion, site.domain);
    }

    const maintenanceFile = getMaintenanceFilePath(site.domain);
    if (fs.existsSync(maintenanceFile)) fs.rmSync(maintenanceFile, { force: true });

    if (options.removeFiles && site.root && site.root.startsWith('/var/www/')) {
      fs.rmSync(site.root, { recursive: true, force: true });
    }

    const remaining = sites.filter(s => s.id !== id);
    persistSites(remaining);
    await syncRateLimitZones(collectZones(remaining));
  });
}

export async function toggleSite(id: string): Promise<ManagedSite> {
  return withFileLock(SITES_FILE, async () => {
    const sites = readSites();
    const index = sites.findIndex(s => s.id === id);
    if (index === -1) throw new SiteError('Site não encontrado', 404);

    const site = { ...sites[index] };
    const { available, enabled } = sitePaths(site.fileName || site.domain);

    if (site.enabled) {
      await applyNginxChanges([{ action: 'delete', path: enabled }]);
      site.enabled = false;
    } else {
      if (!fs.existsSync(site.configPath)) {
        throw new SiteError(`Arquivo de configuração não encontrado: ${site.configPath}`);
      }
      await applyNginxChanges([{ action: 'symlink', path: enabled, target: available }]);
      site.enabled = true;
    }

    sites[index] = site;
    persistSites(sites);
    return site;
  });
}

/**
 * Liga/desliga manutenção.
 *
 * A configuração já contém a checagem `if (-f …)`, então basta criar ou remover
 * o arquivo HTML — sem reescrever o vhost e sem reload. Antes o `try_files`
 * usava caminho absoluto, que o NGINX resolve relativo ao root, e a manutenção
 * simplesmente nunca era acionada.
 */
export async function setMaintenance(
  id: string,
  enabled: boolean,
  options: { customHtml?: string; bypassIps?: string[] } = {},
): Promise<ManagedSite> {
  return withFileLock(SITES_FILE, async () => {
    const sites = readSites();
    const index = sites.findIndex(s => s.id === id);
    if (index === -1) throw new SiteError('Site não encontrado', 404);

    const site = { ...sites[index] };
    const file = getMaintenanceFilePath(site.domain);
    const bypassChanged = options.bypassIps !== undefined
      && JSON.stringify(options.bypassIps) !== JSON.stringify(site.maintenanceBypassIps || []);

    ensureDir(MAINTENANCE_DIR, 0o755);

    if (enabled) {
      fs.writeFileSync(file, options.customHtml || getDefaultMaintenancePage(site.domain), { mode: 0o644 });
    } else if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }

    site.maintenance = enabled;
    if (options.bypassIps !== undefined) site.maintenanceBypassIps = options.bypassIps;

    // A lista de bypass vira diretiva no vhost, então essa mudança exige reload.
    if (bypassChanged) {
      await applyNginxChanges([{ action: 'write', path: site.configPath, content: renderSiteConfig(site) }]);
    }

    sites[index] = site;
    persistSites(sites);
    return site;
  });
}

export async function attachCertificate(
  id: string,
  cert: { certPath: string; keyPath: string; chainPath?: string | null; certId?: string | null },
): Promise<ManagedSite> {
  if (!fs.existsSync(cert.certPath)) throw new SiteError(`Certificado não encontrado: ${cert.certPath}`);
  if (!fs.existsSync(cert.keyPath)) throw new SiteError(`Chave privada não encontrada: ${cert.keyPath}`);

  return updateSite(id, {
    ssl: true,
    sslCertPath: cert.certPath,
    sslKeyPath: cert.keyPath,
    sslChainPath: cert.chainPath ?? null,
    sslCertId: cert.certId ?? null,
  });
}

export async function detachCertificate(id: string): Promise<ManagedSite> {
  return updateSite(id, {
    ssl: false,
    sslCertPath: null,
    sslKeyPath: null,
    sslChainPath: null,
    sslCertId: null,
  });
}

/** Grava configuração escrita à mão, mantendo a proteção de rollback. */
export async function writeRawConfig(id: string, content: string): Promise<ManagedSite> {
  const site = getSite(id);
  if (!site) throw new SiteError('Site não encontrado', 404);
  if (!content || !content.trim()) throw new SiteError('Conteúdo da configuração é obrigatório');

  await applyNginxChanges([{ action: 'write', path: site.configPath, content }]);
  return site;
}

export function readRawConfig(id: string): string {
  const site = getSite(id);
  if (!site) throw new SiteError('Site não encontrado', 404);
  try {
    return fs.readFileSync(site.configPath, 'utf-8');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Varredura do disco                                                 */
/* ------------------------------------------------------------------ */

/** Arquivos em sites-available que não são vhosts: backups, restos de pacote, editores. */
export const IGNORED_VHOST_FILE = /(^\.|\.(bak|backup|save|old|orig|tmp|swp|disabled)([.\-~].*)?$|\.dpkg-[a-z]+$|\.ucf-[a-z]+$|~$)/i;

export function scanVhosts(): { managed: ManagedSite[]; external: ParsedVhost[] } {
  const managed = readSites();

  const panelSiteIds = new Map<string, string>();
  for (const site of managed) {
    panelSiteIds.set(site.domain, site.id);
    for (const alias of site.aliases || []) panelSiteIds.set(alias, site.id);
  }

  const external: ParsedVhost[] = [];

  if (!fs.existsSync(NGINX_AVAILABLE)) {
    return { managed, external };
  }

  const enabledFiles = new Set<string>();
  try {
    for (const file of fs.readdirSync(NGINX_ENABLED)) enabledFiles.add(file);
  } catch {}

  for (const fileName of fs.readdirSync(NGINX_AVAILABLE)) {
    // O sufixo pode vir com timestamp (`.bak-20260816120000`), então a checagem
    // não pode ancorar no fim do nome — era por isso que backups gerados pelos
    // scripts apareciam como vhosts duplicados na listagem.
    if (fileName === 'default' || IGNORED_VHOST_FILE.test(fileName)) continue;

    const configPath = path.join(NGINX_AVAILABLE, fileName);
    try {
      if (!fs.statSync(configPath).isFile()) continue;
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = parseNginxConfigFile(content, fileName, configPath, enabledFiles.has(fileName), panelSiteIds);
      if (!parsed.managed) external.push(parsed);
    } catch {
      continue;
    }
  }

  return { managed, external };
}

/** Reflete no registro o estado real dos symlinks em sites-enabled. */
export function reconcileEnabledFlags(): ManagedSite[] {
  const sites = readSites();
  let changed = false;

  for (const site of sites) {
    const actual = isSiteEnabled(site.fileName || site.domain);
    if (site.enabled !== actual) {
      site.enabled = actual;
      changed = true;
    }
  }

  if (changed) persistSites(sites);
  return sites;
}

export { NginxConfigError };
