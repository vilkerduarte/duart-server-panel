/**
 * Acesso administrativo a bancos de dados, sem shell.
 *
 * O código anterior montava a linha de comando por interpolação de string e a
 * executava via `exec()`. `username`, `database` e `host` eram sanitizados; a
 * senha não. Uma senha contendo `'; …; #` escapava das aspas e era executada
 * como root. Além disso a senha ia na linha de comando, ficando visível em
 * `ps aux` para qualquer processo da máquina — inclusive na própria tela de
 * Tarefas do painel.
 *
 * Aqui: `execFile` com array de argumentos (sem shell), SQL entregue por stdin
 * quando possível, e escape explícito de literais e identificadores.
 */

import { execFileSafe, needsSudo, CommandResult } from './system';

export type DbType = 'mysql' | 'postgresql' | 'mongodb';

export class DbInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbInputError';
  }
}

/* ------------------------------------------------------------------ */
/*  Escape                                                             */
/* ------------------------------------------------------------------ */

/** Literal de string para MySQL. */
export function mysqlString(value: string): string {
  const escaped = String(value).replace(/[\0\x08\x09\x1a\n\r"'\\%_]/g, char => {
    switch (char) {
      case '\0': return '\\0';
      case '\x08': return '\\b';
      case '\x09': return '\\t';
      case '\x1a': return '\\z';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '"':
      case "'":
      case '\\': return `\\${char}`;
      default: return char;
    }
  });
  return `'${escaped}'`;
}

/**
 * Literal de string para PostgreSQL.
 * Com `standard_conforming_strings` ligado (padrão desde a 9.1), a barra
 * invertida é literal e só a aspa simples precisa ser duplicada.
 */
export function pgString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Literal para o shell do MongoDB (JavaScript). */
export function jsString(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Identificadores (nome de banco, usuário, schema) nunca são parametrizáveis,
 * então passam por allowlist estrita em vez de escape.
 */
export function assertIdentifier(name: string, label = 'identificador'): string {
  const value = String(name ?? '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(value)) {
    throw new DbInputError(
      `${label} inválido: use letras, números, _ e - começando por letra (máx. 63 caracteres)`,
    );
  }
  return value;
}

export function assertHost(host: string): string {
  const value = String(host ?? 'localhost').trim();
  if (!/^[A-Za-z0-9_.%:-]{1,255}$/.test(value)) {
    throw new DbInputError('Host inválido');
  }
  return value;
}

export function assertPassword(password: string): string {
  const value = String(password ?? '');
  if (value.length < 8) throw new DbInputError('A senha deve ter no mínimo 8 caracteres');
  if (value.length > 256) throw new DbInputError('Senha longa demais');
  if (/[\n\r\0]/.test(value)) throw new DbInputError('A senha não pode conter quebras de linha');
  return value;
}

export function mysqlIdent(name: string): string {
  return `\`${assertIdentifier(name)}\``;
}

export function pgIdent(name: string): string {
  return `"${assertIdentifier(name)}"`;
}

/* ------------------------------------------------------------------ */
/*  Execução                                                           */
/* ------------------------------------------------------------------ */

function withSudo(bin: string, args: string[], asUser?: string): { bin: string; args: string[] } {
  if (asUser) {
    return { bin: 'sudo', args: ['-n', '-u', asUser, bin, ...args] };
  }
  return needsSudo() ? { bin: 'sudo', args: ['-n', bin, ...args] } : { bin, args };
}

/**
 * Executa SQL no MySQL. O SQL vai por stdin: nada dele aparece na linha de
 * comando, então não vaza em `ps aux` nem no histórico de processos.
 */
export async function mysqlExec(
  sql: string,
  options: { database?: string; timeout?: number; tabular?: boolean } = {},
): Promise<CommandResult> {
  const args = ['--batch', '--raw'];
  if (!options.tabular) args.push('--skip-column-names');
  if (options.database) args.push(assertIdentifier(options.database, 'nome do banco'));

  const { bin, args: finalArgs } = withSudo('mysql', args);
  return execFileSafe(bin, finalArgs, { timeout: options.timeout ?? 15000, input: `${sql}\n` });
}

/** Executa SQL no PostgreSQL como o usuário `postgres`. */
export async function psqlExec(
  sql: string,
  options: { database?: string; timeout?: number; tabular?: boolean } = {},
): Promise<CommandResult> {
  const args = ['-v', 'ON_ERROR_STOP=1'];
  if (!options.tabular) args.push('-tA');
  if (options.database) args.push('-d', assertIdentifier(options.database, 'nome do banco'));

  // O SQL entra como um único argumento — sem shell, aspas não têm efeito.
  args.push('-c', sql);

  const { bin, args: finalArgs } = withSudo('psql', args, 'postgres');
  return execFileSafe(bin, finalArgs, { timeout: options.timeout ?? 15000 });
}

/** Executa script no MongoDB. */
export async function mongoshExec(
  script: string,
  options: { timeout?: number } = {},
): Promise<CommandResult> {
  const { bin, args } = withSudo('mongosh', ['--quiet', '--eval', script]);
  return execFileSafe(bin, args, { timeout: options.timeout ?? 15000 });
}

/* ------------------------------------------------------------------ */
/*  Consultas de leitura já prontas                                    */
/* ------------------------------------------------------------------ */

export async function listDatabases(type: DbType): Promise<string[]> {
  if (type === 'mysql') {
    const result = await mysqlExec('SHOW DATABASES;');
    return result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  }
  if (type === 'postgresql') {
    const result = await psqlExec('SELECT datname FROM pg_database WHERE datistemplate = false;');
    return result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  }
  const result = await mongoshExec('db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))');
  return result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
}

export async function listUsers(type: DbType): Promise<Array<{ user: string; host: string }>> {
  if (type === 'mysql') {
    const result = await mysqlExec('SELECT User, Host FROM mysql.user;');
    return result.stdout.split('\n').filter(Boolean).map(line => {
      const [user, host] = line.split(/\t|\s{2,}/);
      return { user: (user ?? '').trim(), host: (host ?? 'localhost').trim() };
    }).filter(u => u.user);
  }
  if (type === 'postgresql') {
    const result = await psqlExec('SELECT rolname FROM pg_roles WHERE rolcanlogin = true;');
    return result.stdout.split('\n').map(l => l.trim()).filter(Boolean).map(user => ({ user, host: 'localhost' }));
  }
  const result = await mongoshExec(
    "db.adminCommand({usersInfo:1}).users.forEach(u=>print(u.user+'\\t'+(u.db||'admin')))",
  );
  return result.stdout.split('\n').filter(Boolean).map(line => {
    const [user, host] = line.split('\t');
    return { user: (user ?? '').trim(), host: (host ?? 'admin').trim() };
  }).filter(u => u.user);
}

/**
 * Mensagem de erro compreensível a partir da saída bruta do cliente.
 * A saída crua costuma trazer o comando inteiro, o que confunde e às vezes
 * expõe dados que não deveriam aparecer na tela.
 */
export function friendlyDbError(type: DbType, raw: string): string {
  const text = (raw || '').trim();
  if (!text) return 'O banco de dados não respondeu';

  if (/Access denied/i.test(text)) return 'Acesso negado pelo banco de dados. Verifique as credenciais administrativas.';
  if (/Can't connect|connection refused|could not connect/i.test(text)) {
    return `Não foi possível conectar ao ${type}. Verifique se o serviço está ativo.`;
  }
  if (/already exists/i.test(text)) return 'Já existe um objeto com esse nome.';
  if (/does not exist|Unknown database/i.test(text)) return 'O banco ou usuário informado não existe.';
  if (/command not found|não encontrado/i.test(text)) {
    return `O cliente de linha de comando do ${type} não está instalado neste servidor.`;
  }

  return text.split('\n').slice(0, 3).join(' ').substring(0, 400);
}
