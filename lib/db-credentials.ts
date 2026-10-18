/**
 * Credencial root do MySQL/MariaDB guardada pelo painel.
 *
 * Numa instalação limpa do Ubuntu o root do MySQL usa `auth_socket`: quem é
 * root no sistema entra sem senha, e é assim que o painel sempre falou com o
 * banco (`sudo mysql`). Para o phpMyAdmin o root precisa de senha — e a partir
 * do momento em que tem, o `sudo mysql` sem credencial deixa de entrar no MySQL
 * (no MariaDB o socket continua valendo, ver setMysqlRootPassword).
 *
 * Por isso a senha fica em dois arquivos, ambos 0600 num diretório 0700 sob o
 * DATA_DIR, bloqueado no gerenciador de arquivos (DENIED_PREFIXES em
 * lib/paths.ts). As ferramentas de leitura da IA não usam essa jaula, assim
 * como já acontece com o segredo de sessão em auth/:
 *
 * - `mysql-root.json`: a fonte da verdade, para a UI revelar a senha;
 * - `mysql-root.cnf`: o mesmo valor no formato de option file do cliente, que
 *   o painel passa com `--defaults-extra-file`. A senha nunca vai na linha de
 *   comando, onde apareceria em `ps aux`.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { ensureDir, readJson, writeFileAtomic } from './fsx';

export function databasesDir(): string {
  return path.join(process.env.DATA_DIR || '/var/lib/duart-panel', 'databases');
}

export function mysqlRootJsonPath(): string {
  return path.join(databasesDir(), 'mysql-root.json');
}

export function mysqlRootCnfPath(): string {
  return path.join(databasesDir(), 'mysql-root.cnf');
}

interface StoredRootCredential {
  user: string;
  password: string;
  updatedAt: string;
}

export function readMysqlRootPassword(): string | null {
  const stored = readJson<Partial<StoredRootCredential>>(mysqlRootJsonPath(), {});
  return typeof stored.password === 'string' && stored.password ? stored.password : null;
}

/**
 * Valor de option file entre aspas duplas. O cliente só remove a aspa da
 * ponta e da cauda, então aspas no meio são literais; a barra invertida é
 * sequência de escape e precisa ser dobrada. `#` dentro de aspas não é
 * comentário.
 */
export function optionFileValue(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error('Valor não pode conter quebra de linha');
  return `"${value.replace(/\\/g, '\\\\')}"`;
}

export function renderClientCnf(password: string, user = 'root'): string {
  return [
    '# Duart Panel — credencial administrativa do MySQL. Não edite à mão.',
    '[client]',
    `user=${user}`,
    `password=${optionFileValue(password)}`,
    '',
  ].join('\n');
}

/** Diretório 0700: guarda a senha root e o estado do phpMyAdmin. */
export function ensureDatabasesDir(): void {
  ensureDir(databasesDir(), 0o700);
  try { fs.chmodSync(databasesDir(), 0o700); } catch {}
}

export function writeMysqlRootPassword(password: string): void {
  ensureDatabasesDir();
  const record: StoredRootCredential = { user: 'root', password, updatedAt: new Date().toISOString() };
  // A ordem importa pouco: os dois são reescritos atomicamente e sempre juntos.
  writeFileAtomic(mysqlRootCnfPath(), renderClientCnf(password), 0o600);
  writeFileAtomic(mysqlRootJsonPath(), JSON.stringify(record, null, 2) + '\n', 0o600);
}

export function clearMysqlRootPassword(): void {
  for (const file of [mysqlRootCnfPath(), mysqlRootJsonPath()]) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

/** Argumentos que vão antes de qualquer outro na chamada do cliente `mysql`. */
export function mysqlClientAuthArgs(): string[] {
  const cnf = mysqlRootCnfPath();
  // `--defaults-extra-file` precisa ser o primeiro argumento do cliente.
  return fs.existsSync(cnf) ? [`--defaults-extra-file=${cnf}`] : [];
}

/**
 * Senha gerada: 24 caracteres de um alfabeto sem ambiguidade visual e sem
 * nada que exija escape em SQL, shell ou option file.
 */
export function generateDbPassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    // Descarta o resto da divisão para não enviesar o alfabeto.
    if (bytes[i] >= 256 - (256 % alphabet.length)) continue;
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out.length === length ? out : generateDbPassword(length);
}
