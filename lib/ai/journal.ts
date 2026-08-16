/**
 * Trilha de auditoria das ações da IA.
 *
 * A IA executa comandos com privilégio total no servidor. Sem registro do que
 * foi executado, por quem e com que resultado, não há como responder "o que
 * mudou aqui ontem?" — que é a primeira pergunta depois de qualquer incidente.
 *
 * Um arquivo JSONL por dia: append-only, barato de escrever, fácil de ler com
 * ferramentas de linha de comando quando o painel estiver fora do ar.
 */

import fs from 'fs';
import path from 'path';
import { ensureDir } from '../fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
export const JOURNAL_DIR = path.join(DATA_DIR, 'ai', 'journal');

export type JournalOutcome = 'ok' | 'error' | 'rejected' | 'blocked';

export interface JournalEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  user: string;
  mode: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: JournalOutcome;
  durationMs: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  diff?: string;
  /** Como desfazer, quando a operação for reversível. */
  rollbackHint?: string;
}

const MAX_CAPTURE = 8000;

function truncate(value: string | undefined, limit = MAX_CAPTURE): string | undefined {
  if (value === undefined) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… (${value.length - limit} caracteres omitidos)`;
}

function fileForDate(date = new Date()): string {
  return path.join(JOURNAL_DIR, `${date.toISOString().slice(0, 10)}.jsonl`);
}

/** Segredos não entram no journal — ele é lido pela UI e pode ser exportado. */
function redact(args: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /(password|senha|secret|token|apikey|api_key|credential|private_key)/i;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args || {})) {
    if (sensitive.test(key)) {
      out[key] = '[oculto]';
    } else if (typeof value === 'string' && value.length > 2000) {
      out[key] = `${value.slice(0, 2000)}… (${value.length} caracteres)`;
    } else {
      out[key] = value;
    }
  }

  return out;
}

export function appendJournal(entry: Omit<JournalEntry, 'id' | 'timestamp'>): JournalEntry {
  const full: JournalEntry = {
    ...entry,
    args: redact(entry.args),
    stdout: truncate(entry.stdout),
    stderr: truncate(entry.stderr),
    diff: truncate(entry.diff, 20000),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };

  try {
    ensureDir(JOURNAL_DIR, 0o750);
    fs.appendFileSync(fileForDate(), JSON.stringify(full) + '\n', { mode: 0o640 });
  } catch {
    // Falha de auditoria não pode derrubar a operação em si.
  }

  return full;
}

export function readJournal(options: { date?: string; limit?: number; sessionId?: string } = {}): JournalEntry[] {
  const target = options.date
    ? path.join(JOURNAL_DIR, `${options.date}.jsonl`)
    : fileForDate();

  if (!fs.existsSync(target)) return [];

  try {
    const entries = fs.readFileSync(target, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as JournalEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is JournalEntry => e !== null);

    const filtered = options.sessionId
      ? entries.filter(e => e.sessionId === options.sessionId)
      : entries;

    return filtered.slice(-(options.limit ?? 200)).reverse();
  } catch {
    return [];
  }
}

export function listJournalDates(): string[] {
  try {
    return fs.readdirSync(JOURNAL_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
