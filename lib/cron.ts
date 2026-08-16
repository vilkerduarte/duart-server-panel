/**
 * Tarefas agendadas.
 *
 * Dois problemas na versão anterior: a tela listava três jobs "de sistema"
 * (renovação SSL, limpeza de histórico, rotação de logs) que eram objetos
 * hardcoded na resposta da API e não existiam no servidor; e os jobs criados
 * pelo usuário eram gravados num JSON e nunca instalados no cron — o painel
 * dizia que agendava e não agendava.
 *
 * Aqui o que é exibido vem do sistema, e o que é criado vai para
 * /etc/cron.d/duart-panel, que é o cron de verdade.
 */

import fs from 'fs';
import path from 'path';
import { executeCommand, execFileSafe, needsSudo } from './system';
import { readJson, writeJson, ensureDir, withFileLock } from './fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CRON_DATA_DIR = path.join(DATA_DIR, 'cron');
const CUSTOM_FILE = path.join(CRON_DATA_DIR, 'custom.json');

export const CRON_D_FILE = '/etc/cron.d/duart-panel';
export const CRON_D_DIR = '/etc/cron.d';

export interface CronJob {
  id: string;
  expression: string;
  command: string;
  description: string;
  user: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface SystemCronEntry {
  id: string;
  source: string;
  expression: string;
  command: string;
  description: string;
  user?: string;
  /** A tela distingue apenas gerenciado x sistema; `kind` guarda a origem real. */
  type: 'system';
  kind: 'cron.d' | 'crontab' | 'timer';
}

/* ------------------------------------------------------------------ */
/*  Validação                                                          */
/* ------------------------------------------------------------------ */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const CRON_SHORTCUTS = ['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];

interface FieldSpec {
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },              // minuto
  { min: 0, max: 23 },              // hora
  { min: 1, max: 31 },              // dia do mês
  { min: 1, max: 12, names: MONTHS },
  { min: 0, max: 7, names: DAYS },  // 0 e 7 são domingo
];

function resolveValue(token: string, spec: FieldSpec): number | null {
  const named = spec.names?.indexOf(token.toLowerCase());
  if (named !== undefined && named >= 0) {
    return spec.names === MONTHS ? named + 1 : named;
  }
  if (!/^\d+$/.test(token)) return null;
  const value = Number(token);
  return value >= spec.min && value <= spec.max ? value : null;
}

/**
 * Valida um campo aceitando a gramática completa do cron.
 * A validação anterior recusava `1-5/2`, `*\/2,15`, nomes (`MON`, `JAN`) e
 * atalhos (`@daily`) — expressões corretas que o painel dizia estarem erradas.
 */
function validateField(field: string, spec: FieldSpec): boolean {
  if (!field) return false;

  return field.split(',').every(part => {
    const [range, step] = part.split('/');

    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1 || Number(step) > spec.max) return false;
    }

    if (range === '*') return true;

    if (range.includes('-')) {
      const [start, end] = range.split('-');
      const from = resolveValue(start, spec);
      const to = resolveValue(end, spec);
      return from !== null && to !== null && from <= to;
    }

    return resolveValue(range, spec) !== null;
  });
}

export function validateCronExpression(expression: string): { valid: boolean; error?: string } {
  const value = String(expression ?? '').trim();
  if (!value) return { valid: false, error: 'Expressão vazia' };

  if (value.startsWith('@')) {
    return CRON_SHORTCUTS.includes(value.toLowerCase())
      ? { valid: true }
      : { valid: false, error: `Atalho desconhecido. Use: ${CRON_SHORTCUTS.join(', ')}` };
  }

  const parts = value.split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: `Esperados 5 campos (minuto hora dia mês dia-da-semana), recebidos ${parts.length}` };
  }

  const labels = ['minuto', 'hora', 'dia do mês', 'mês', 'dia da semana'];
  for (let i = 0; i < 5; i++) {
    if (!validateField(parts[i], FIELDS[i])) {
      return { valid: false, error: `Campo inválido (${labels[i]}): "${parts[i]}"` };
    }
  }

  return { valid: true };
}

/* ------------------------------------------------------------------ */
/*  Próximas execuções                                                 */
/* ------------------------------------------------------------------ */

function expandField(field: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;

    let from = spec.min;
    let to = spec.max;

    if (range !== '*') {
      if (range.includes('-')) {
        const [a, b] = range.split('-');
        from = resolveValue(a, spec) ?? spec.min;
        to = resolveValue(b, spec) ?? spec.max;
      } else {
        from = to = resolveValue(range, spec) ?? spec.min;
      }
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values;
}

/**
 * Próximas execuções, para o usuário conferir antes de salvar — que é o que
 * ele realmente quer saber ao digitar uma expressão.
 */
export function nextRuns(expression: string, count = 3): string[] {
  const value = String(expression ?? '').trim();
  if (value.startsWith('@')) {
    const map: Record<string, string> = {
      '@reboot': 'a cada inicialização do servidor',
      '@hourly': 'toda hora, no minuto 0',
      '@daily': 'todo dia à meia-noite',
      '@midnight': 'todo dia à meia-noite',
      '@weekly': 'todo domingo à meia-noite',
      '@monthly': 'todo dia 1 à meia-noite',
      '@yearly': 'todo 1º de janeiro',
      '@annually': 'todo 1º de janeiro',
    };
    return [map[value.toLowerCase()] ?? value];
  }

  if (!validateCronExpression(value).valid) return [];

  const parts = value.split(/\s+/);
  const minutes = expandField(parts[0], FIELDS[0]);
  const hours = expandField(parts[1], FIELDS[1]);
  const doms = expandField(parts[2], FIELDS[2]);
  const months = expandField(parts[3], FIELDS[3]);
  const dows = expandField(parts[4], FIELDS[4]);
  if (dows.has(7)) dows.add(0);

  const domRestricted = parts[2] !== '*';
  const dowRestricted = parts[4] !== '*';

  const results: string[] = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Um ano de minutos é o teto: além disso a expressão é rara o bastante
  // para não valer o custo da busca.
  for (let i = 0; i < 527_040 && results.length < count; i++) {
    const matchesDate =
      months.has(cursor.getMonth() + 1) &&
      // O cron usa OU entre dia-do-mês e dia-da-semana quando os dois são restritos.
      (domRestricted && dowRestricted
        ? doms.has(cursor.getDate()) || dows.has(cursor.getDay())
        : doms.has(cursor.getDate()) && dows.has(cursor.getDay()));

    if (matchesDate && hours.has(cursor.getHours()) && minutes.has(cursor.getMinutes())) {
      results.push(cursor.toISOString());
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Leitura do sistema                                                 */
/* ------------------------------------------------------------------ */

let systemEntryCounter = 0;

function systemEntry(
  source: string,
  kind: SystemCronEntry['kind'],
  expression: string,
  command: string,
  user?: string,
): SystemCronEntry {
  return {
    id: `sys-${kind}-${systemEntryCounter++}`,
    source,
    kind,
    type: 'system',
    expression,
    command,
    description: describeSource(source, kind),
    user,
  };
}

function describeSource(source: string, kind: SystemCronEntry['kind']): string {
  if (kind === 'timer') return 'Timer do systemd';
  if (source === 'crontab') return 'crontab do root';
  return `/etc/cron.d/${source}`;
}

function parseCronDFile(file: string, content: string): SystemCronEntry[] {
  const entries: SystemCronEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || /^[A-Z_]+=/.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    // Em /etc/cron.d o usuário vem depois dos 5 campos de tempo.
    if (parts[0].startsWith('@')) {
      entries.push(systemEntry(file, 'cron.d', parts[0], parts.slice(2).join(' '), parts[1]));
    } else if (parts.length >= 7) {
      entries.push(systemEntry(file, 'cron.d', parts.slice(0, 5).join(' '), parts.slice(6).join(' '), parts[5]));
    }
  }

  return entries;
}

export async function readSystemCron(): Promise<SystemCronEntry[]> {
  const entries: SystemCronEntry[] = [];

  try {
    for (const file of fs.readdirSync(CRON_D_DIR)) {
      if (/\.(dpkg-\w+|bak|save)$|~$/.test(file)) continue;
      const full = path.join(CRON_D_DIR, file);
      try {
        entries.push(...parseCronDFile(file, fs.readFileSync(full, 'utf-8')));
      } catch {}
    }
  } catch {}

  const crontab = await executeCommand('crontab_list');
  if (crontab.code === 0) {
    for (const line of crontab.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || /^[A-Z_]+=/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+/);
      if (parts[0].startsWith('@')) {
        entries.push(systemEntry('crontab', 'crontab', parts[0], parts.slice(1).join(' ')));
      } else if (parts.length >= 6) {
        entries.push(systemEntry('crontab', 'crontab', parts.slice(0, 5).join(' '), parts.slice(5).join(' ')));
      }
    }
  }

  // Timers do systemd fazem parte do agendamento real da máquina — o
  // certbot.timer, por exemplo, é quem de fato renova os certificados.
  const timers = await execFileSafe(
    needsSudo() ? 'sudo' : 'systemctl',
    needsSudo()
      ? ['-n', 'systemctl', 'list-timers', '--all', '--no-pager', '--plain']
      : ['list-timers', '--all', '--no-pager', '--plain'],
    { timeout: 10000 },
  );

  if (timers.code === 0) {
    for (const line of timers.stdout.split('\n').slice(1)) {
      const match = line.match(/(\S+\.timer)\s+(\S+\.service)?/);
      if (!match) continue;
      entries.push(systemEntry('systemd', 'timer', line.trim().split(/\s{2,}/)[0] ?? '', match[2] ?? match[1]));
    }
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/*  Jobs do painel                                                     */
/* ------------------------------------------------------------------ */

/**
 * Jobs criados antes da versão que passou a gravar em /etc/cron.d não tinham
 * campo `user`. Sem normalizar, a linha renderizada sairia como
 * `0 3 * * * undefined comando` — sintaxe inválida que o cron descarta inteira.
 */
function normalizeJob(job: Partial<CronJob>): CronJob {
  return {
    id: job.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    expression: job.expression ?? '',
    command: job.command ?? '',
    description: job.description ?? '',
    user: job.user && /^[a-z_][a-z0-9_-]*$/.test(job.user) ? job.user : 'root',
    active: job.active !== false,
    createdAt: job.createdAt ?? new Date().toISOString(),
    updatedAt: job.updatedAt,
  };
}

export function readCustomJobs(): CronJob[] {
  ensureDir(CRON_DATA_DIR);
  const stored = readJson<{ jobs: Partial<CronJob>[] }>(CUSTOM_FILE, { jobs: [] }).jobs || [];
  return stored.map(normalizeJob);
}

function persistCustomJobs(jobs: CronJob[]): void {
  ensureDir(CRON_DATA_DIR);
  writeJson(CUSTOM_FILE, { jobs });
}

/** Um comando com quebra de linha viraria uma segunda entrada no cron.d. */
export function isValidCommand(command: string): boolean {
  return Boolean(command) && !/[\n\r]/.test(command) && command.trim().length > 0 && command.length < 2000;
}

function renderCronD(jobs: CronJob[]): string {
  const lines = [
    '# Duart Panel — tarefas agendadas pelo painel',
    '# Arquivo gerenciado automaticamente. Edições manuais são sobrescritas.',
    '',
    'SHELL=/bin/bash',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '',
  ];

  for (const job of jobs) {
    if (!job.active) {
      lines.push(`# (desativado) ${job.description || job.id}`);
      lines.push(`# ${job.expression} ${job.user} ${job.command}`);
      lines.push('');
      continue;
    }
    if (!job.expression || !job.command) continue;
    if (job.description) lines.push(`# ${job.description}`);
    lines.push(`${job.expression} ${job.user || 'root'} ${job.command}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** Grava o arquivo real do cron a partir dos jobs registrados. */
export function syncCronD(jobs: CronJob[]): { ok: boolean; error?: string } {
  try {
    fs.writeFileSync(CRON_D_FILE, renderCronD(jobs), { mode: 0o644 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function saveCustomJobs(jobs: CronJob[]): { ok: boolean; error?: string } {
  persistCustomJobs(jobs);
  return syncCronD(jobs);
}

export function updateCustomJobs(mutate: (jobs: CronJob[]) => CronJob[]): Promise<CronJob[]> {
  return withFileLock(CUSTOM_FILE, async () => {
    const updated = mutate(readCustomJobs());
    persistCustomJobs(updated);
    syncCronD(updated);
    return updated;
  });
}
