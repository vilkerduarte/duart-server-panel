/**
 * Instalação do MySQL/MariaDB com escolha de versão, e gestão da senha root.
 *
 * O que cada distribuição oferece (o motivo de existir mais de uma opção):
 *
 * - Ubuntu traz `mysql-server` nos próprios repositórios: 8.0 no 22.04/24.04,
 *   8.4 LTS a partir do 25.04. Debian não distribui MySQL — só MariaDB.
 * - O repositório oficial da Oracle (repo.mysql.com) publica 8.0 e 8.4 LTS
 *   para as versões LTS do Ubuntu e as estáveis do Debian. Se o codinome do
 *   servidor está lá é conferido na hora, lendo o arquivo Release do
 *   repositório, em vez de uma lista fixa que envelhece.
 * - MariaDB vem dos repositórios da própria distro, nas duas famílias.
 */

import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { executeCommand } from './system';
import { DbInputError, mysqlExec, mysqlString, assertPassword } from './db';
import {
  readMysqlRootPassword, writeMysqlRootPassword, generateDbPassword, renderClientCnf,
} from './db-credentials';
import { writeFileAtomic } from './fsx';

/* ------------------------------------------------------------------ */
/*  Sistema operacional                                                */
/* ------------------------------------------------------------------ */

export interface OsInfo {
  /** `ubuntu`, `debian`… (campo ID do os-release). */
  id: string;
  /** Codinome (`noble`, `bookworm`…). */
  codename: string;
  versionId: string;
  prettyName: string;
}

export function parseOsRelease(text: string): OsInfo {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  const codename = values.VERSION_CODENAME || values.UBUNTU_CODENAME || '';
  return {
    id: (values.ID || '').toLowerCase(),
    codename: codename.toLowerCase(),
    versionId: values.VERSION_ID || '',
    prettyName: values.PRETTY_NAME || values.NAME || '',
  };
}

export function readOsInfo(): OsInfo {
  try {
    return parseOsRelease(fs.readFileSync('/etc/os-release', 'utf-8'));
  } catch {
    return { id: '', codename: '', versionId: '', prettyName: '' };
  }
}

/* ------------------------------------------------------------------ */
/*  Variantes                                                          */
/* ------------------------------------------------------------------ */

export type MysqlVariant = 'distro' | 'mysql-8.4' | 'mysql-8.0' | 'mariadb';

export const MYSQL_VARIANTS: Array<{ id: MysqlVariant; label: string; description: string }> = [
  {
    id: 'mysql-8.4',
    label: 'MySQL 8.4 LTS (repositório oficial)',
    description: 'Versão LTS atual da Oracle, via repo.mysql.com. Recomendada para instalações novas.',
  },
  {
    id: 'distro',
    label: 'MySQL da distribuição',
    description: 'Pacote mysql-server do Ubuntu (8.0 no 22.04/24.04, 8.4 nas versões mais novas). Atualizado pelo apt da distro.',
  },
  {
    id: 'mysql-8.0',
    label: 'MySQL 8.0 (repositório oficial)',
    description: 'Série 8.0 da Oracle, cujo suporte terminou em abril de 2026. Use só por compatibilidade.',
  },
  {
    id: 'mariadb',
    label: 'MariaDB (distribuição)',
    description: 'Compatível com MySQL na maioria dos usos. É a única opção nativa no Debian.',
  },
];

export function isMysqlVariant(value: unknown): value is MysqlVariant {
  return MYSQL_VARIANTS.some(v => v.id === value);
}

const OFFICIAL_COMPONENT: Partial<Record<MysqlVariant, string>> = {
  'mysql-8.4': 'mysql-8.4-lts',
  'mysql-8.0': 'mysql-8.0',
};

export const MYSQL_REPO_BASE = 'https://repo.mysql.com/apt';
export const MYSQL_REPO_KEY_URL = 'https://repo.mysql.com/RPM-GPG-KEY-mysql-2023';
export const MYSQL_KEYRING = '/etc/apt/keyrings/duart-mysql.asc';
export const MYSQL_SOURCES_LIST = '/etc/apt/sources.list.d/duart-mysql.list';
export const MYSQL_APT_PIN = '/etc/apt/preferences.d/duart-mysql';

export interface MysqlRepoPlan {
  url: string;
  suite: string;
  component: string;
  /** Linha do sources.list. */
  sourcesList: string;
  /** Pinning: sem ele o apt mistura o mysql da distro quando ela tem patch mais novo. */
  pin: string;
  releaseUrl: string;
}

export interface MysqlInstallPlan {
  variant: MysqlVariant;
  packages: string[];
  service: string;
  repo?: MysqlRepoPlan;
}

export function isSupportedFamily(os: OsInfo): boolean {
  return os.id === 'ubuntu' || os.id === 'debian';
}

/**
 * Decide pacotes e repositório para a variante escolhida.
 * Lança DbInputError quando a combinação não existe nesta distro.
 */
export function planMysqlInstall(variant: MysqlVariant, os: OsInfo): MysqlInstallPlan {
  if (!isSupportedFamily(os)) {
    throw new DbInputError(`Distribuição não suportada (${os.prettyName || os.id || 'desconhecida'}). Use Ubuntu ou Debian.`);
  }

  if (variant === 'mariadb') {
    return { variant, packages: ['mariadb-server'], service: 'mariadb' };
  }

  if (variant === 'distro') {
    if (os.id === 'debian') {
      throw new DbInputError('O Debian não distribui MySQL. Escolha MySQL 8.4 LTS (repositório oficial) ou MariaDB.');
    }
    return { variant, packages: ['mysql-server'], service: 'mysql' };
  }

  const component = OFFICIAL_COMPONENT[variant];
  if (!component) throw new DbInputError('Versão inválida');
  if (!/^[a-z]+$/.test(os.codename)) {
    throw new DbInputError('Não foi possível identificar o codinome da distribuição em /etc/os-release');
  }

  const url = `${MYSQL_REPO_BASE}/${os.id}/`;
  return {
    variant,
    packages: ['mysql-server'],
    service: 'mysql',
    repo: {
      url,
      suite: os.codename,
      component,
      sourcesList: `# Duart Panel — repositório oficial do MySQL (${component})\n` +
        `deb [signed-by=${MYSQL_KEYRING}] ${url} ${os.codename} ${component}\n`,
      pin: '# Duart Panel — prioriza os pacotes do repositório oficial do MySQL\n' +
        'Package: mysql-* libmysqlclient*\nPin: origin repo.mysql.com\nPin-Priority: 1001\n',
      releaseUrl: `${url}dists/${os.codename}/Release`,
    },
  };
}

/** Componentes anunciados no arquivo Release de um repositório APT. */
export function parseReleaseComponents(text: string): string[] {
  const line = text.split('\n').find(l => /^Components:/i.test(l));
  return line ? line.replace(/^Components:/i, '').trim().split(/\s+/).filter(Boolean) : [];
}

/** Disponibilidade de cada variante neste servidor, para a UI desabilitar o que não existe. */
export function variantAvailability(os: OsInfo): Array<{ id: MysqlVariant; available: boolean; reason?: string }> {
  return MYSQL_VARIANTS.map(({ id }) => {
    try {
      planMysqlInstall(id, os);
      return { id, available: true };
    } catch (err) {
      return { id, available: false, reason: (err as Error).message };
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Instalação                                                         */
/* ------------------------------------------------------------------ */

export type InstallLog = (line: string) => void;

function removeRepoFiles(): void {
  for (const file of [MYSQL_SOURCES_LIST, MYSQL_APT_PIN]) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return response.text();
}

async function configureOfficialRepo(repo: MysqlRepoPlan, log: InstallLog): Promise<void> {
  log(`Conferindo ${repo.releaseUrl}`);
  let release: string;
  try {
    release = await fetchText(repo.releaseUrl);
  } catch (err) {
    throw new DbInputError(
      `O repositório oficial do MySQL não publica pacotes para "${repo.suite}" (${(err as Error).message}). ` +
      'Escolha o MySQL da distribuição ou MariaDB.',
    );
  }
  const components = parseReleaseComponents(release);
  if (!components.includes(repo.component)) {
    throw new DbInputError(
      `O repositório oficial não tem ${repo.component} para "${repo.suite}" (disponível: ${components.join(', ') || 'nada'}).`,
    );
  }

  log('Baixando a chave de assinatura do repositório');
  const key = await fetchText(MYSQL_REPO_KEY_URL);
  if (!key.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
    throw new Error('A chave baixada de repo.mysql.com não é uma chave PGP');
  }

  writeFileAtomic(MYSQL_KEYRING, key, 0o644);
  writeFileAtomic(MYSQL_SOURCES_LIST, repo.sourcesList, 0o644);
  writeFileAtomic(MYSQL_APT_PIN, repo.pin, 0o644);
}

async function isActive(unit: string): Promise<boolean> {
  const result = await executeCommand('systemctl_is_active', [unit]);
  return result.stdout.trim() === 'active';
}

/** Serviço do banco ativo neste servidor (MariaDB também atende por `mysql`). */
export async function activeMysqlService(): Promise<string | null> {
  for (const unit of ['mysql', 'mariadb']) {
    if (await isActive(unit)) return unit;
  }
  return null;
}

/**
 * Instala a variante escolhida, sobe o serviço e define uma senha root
 * gerada, guardada pelo painel.
 */
export async function installMysql(variant: MysqlVariant, log: InstallLog): Promise<{ service: string; version: string }> {
  const os = readOsInfo();
  const plan = planMysqlInstall(variant, os);
  log(`Sistema: ${os.prettyName || os.id} (${os.codename || 'sem codinome'})`);

  if (plan.repo) {
    try {
      await configureOfficialRepo(plan.repo, log);
    } catch (err) {
      removeRepoFiles();
      throw err;
    }
  }

  log('Atualizando índices do apt');
  const update = await executeCommand('apt_update', ['-qq']);
  if (update.code !== 0) {
    if (plan.repo) removeRepoFiles();
    throw new Error(`apt-get update falhou: ${(update.stderr || update.stdout).slice(-600)}`);
  }

  log(`Instalando ${plan.packages.join(' ')} (pode levar alguns minutos)`);
  const install = await executeCommand('apt_install_noninteractive', ['-qq', ...plan.packages]);
  if (install.code !== 0) {
    // Sem os arquivos, um repositório quebrado não trava o próximo apt update.
    if (plan.repo) removeRepoFiles();
    throw new Error(`Instalação falhou: ${(install.stderr || install.stdout).slice(-800)}`);
  }

  await executeCommand('systemctl_enable', [plan.service, '--now']);
  if (!(await isActive(plan.service))) {
    await executeCommand('systemctl_start', [plan.service]);
  }
  log(`Serviço ${plan.service} ativo`);

  const version = await mysqlServerVersion();

  // Reaplica a senha já guardada (reinstalação) ou gera uma. Uma instalação
  // limpa deixa o root em auth_socket, que aceitaria qualquer senha do cnf
  // em silêncio e deixaria o phpMyAdmin sem login.
  const stored = readMysqlRootPassword();
  log(stored ? 'Reaplicando a senha root guardada pelo painel' : 'Definindo senha root gerada pelo painel');
  try {
    await setMysqlRootPassword(stored ?? generateDbPassword());
  } catch (err) {
    // O banco está instalado; a senha pode ser definida depois pela aba Root.
    log(`Aviso: não foi possível definir a senha root (${(err as Error).message})`);
  }

  return { service: plan.service, version };
}

/* ------------------------------------------------------------------ */
/*  Senha root                                                         */
/* ------------------------------------------------------------------ */

export async function mysqlServerVersion(): Promise<string> {
  const result = await mysqlExec('SELECT VERSION();');
  return result.code === 0 ? result.stdout.trim() : '';
}

export function isMariaDbVersion(version: string): boolean {
  return /mariadb/i.test(version);
}

/**
 * SQL que troca a senha do root@localhost.
 *
 * - MySQL: `IDENTIFIED BY` sozinho mantém o plugin atual — se for
 *   `auth_socket`, a senha é aceita e ignorada. Por isso o plugin vai
 *   explícito (`caching_sha2_password`, padrão desde o 8.0 e o único ativo
 *   por padrão no 8.4).
 * - MariaDB (10.4+): socket OU senha. O root do sistema continua entrando sem
 *   senha, e o phpMyAdmin entra com ela.
 */
export function rootPasswordSql(password: string, mariadb: boolean): string {
  const literal = mysqlString(password);
  if (mariadb) {
    return `ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD(${literal});\nFLUSH PRIVILEGES;`;
  }
  return `ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY ${literal};\nFLUSH PRIVILEGES;`;
}

/**
 * Aplica a senha no banco e só então atualiza o armazenamento. Se a gravação
 * local falhar depois do ALTER, o painel ficaria sem acesso ao banco; nesse
 * caso a senha anterior é restaurada no MySQL.
 */
export async function setMysqlRootPassword(newPassword: string): Promise<void> {
  const password = assertPassword(newPassword);

  const version = await mysqlServerVersion();
  if (!version) {
    throw new Error('Não foi possível conectar ao MySQL com a credencial atual do painel');
  }
  const mariadb = isMariaDbVersion(version);
  const previous = readMysqlRootPassword();

  const result = await mysqlExec(rootPasswordSql(password, mariadb));
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'ALTER USER falhou');
  }

  try {
    writeMysqlRootPassword(password);
  } catch (err) {
    // O banco já tem a senha nova e o cnf ainda a antiga: desfaz no banco,
    // conectando com um cnf temporário que carrega a senha nova.
    await revertRootPassword(password, previous, mariadb);
    throw err;
  }

  const check = await mysqlExec('SELECT 1;');
  if (check.code !== 0) {
    throw new Error('A senha foi alterada, mas o painel não conseguiu se reconectar ao MySQL com ela');
  }
}

async function revertRootPassword(current: string, previous: string | null, mariadb: boolean): Promise<void> {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'duart-mysql-'));
  const cnf = path.join(dir, 'client.cnf');
  try {
    fs.writeFileSync(cnf, renderClientCnf(current), { mode: 0o600 });
    const sql = previous
      ? rootPasswordSql(previous, mariadb)
      // Sem senha anterior, o root voltava a entrar só pelo socket.
      : (mariadb
        ? "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;\nFLUSH PRIVILEGES;"
        : "ALTER USER 'root'@'localhost' IDENTIFIED WITH auth_socket;\nFLUSH PRIVILEGES;");
    await mysqlExec(sql, { defaultsFile: cnf });
  } catch {
    // Best-effort: o erro original é o que vai para o usuário.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/*  Jobs de instalação                                               */
/* ------------------------------------------------------------------ */

/**
 * Instalações levam minutos; a requisição devolve um id e a UI acompanha.
 * Em memória, como os jobs de importação: um restart do painel perde o
 * acompanhamento, não a instalação (o apt segue até o fim ou falha sozinho).
 */
export interface InstallJob {
  id: string;
  status: 'running' | 'completed' | 'error';
  log: string[];
  error?: string;
  result?: Record<string, unknown>;
  startedAt: number;
  finishedAt?: number;
}

const globalJobs = globalThis as unknown as { __duartInstallJobs?: Map<string, InstallJob> };
const jobs = globalJobs.__duartInstallJobs ?? (globalJobs.__duartInstallJobs = new Map());

export function getInstallJob(id: string): InstallJob | null {
  return jobs.get(id) ?? null;
}

export function runningInstallJob(): InstallJob | null {
  for (const job of jobs.values()) if (job.status === 'running') return job;
  return null;
}

export function startInstallJob(
  task: (log: InstallLog) => Promise<Record<string, unknown> | void>,
): InstallJob {
  const job: InstallJob = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    log: [],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Jobs antigos saem depois de uma hora.
  for (const [id, other] of jobs) {
    if (other.finishedAt && Date.now() - other.finishedAt > 3600_000) jobs.delete(id);
  }

  const log: InstallLog = line => { job.log.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`); };

  task(log).then(result => {
    job.status = 'completed';
    job.result = result || {};
    log('Concluído');
  }).catch(err => {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    log(`Erro: ${job.error}`);
  }).finally(() => {
    job.finishedAt = Date.now();
  });

  return job;
}
