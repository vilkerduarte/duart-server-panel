/**
 * Persistência de conversas da IA.
 *
 * As conversas viviam apenas no state do React: um refresh apagava tudo, não
 * havia retomada e não havia registro do que a IA fez. Além da usabilidade,
 * persistir é o que torna possível o ciclo de aprovação — o servidor precisa
 * guardar o estado da chamada de ferramenta enquanto espera o usuário decidir.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { readJson, writeJson, ensureDir, withFileLock } from '../fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
export const SESSIONS_DIR = path.join(DATA_DIR, 'ai', 'sessions');

/**
 * Modos de aprovação.
 *
 * `full` é o modo laboratório: sem portão nenhum, jaula de caminho desligada e
 * ferramentas extras (escrita em lote, patch, auto-atualização do painel). Só
 * fica disponível quando `aiUnrestrictedEnabled` está ligado na configuração —
 * a intenção é que ele exija uma decisão consciente do operador, não um clique.
 */
export type ApprovalMode = 'read' | 'assisted' | 'autonomous' | 'full';

/**
 * Formato exato que a API espera de volta no histórico.
 *
 * Precisa ser o envelope aninhado com `type: 'function'` — a versão achatada
 * (`{id, name, arguments}`) é recusada com "field type missing", porque o
 * provedor valida a mensagem do assistente contra o schema de tool_calls.
 */
export interface ToolCallRecord {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallRecord[];
  tool_call_id?: string;
  name?: string;
}

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  /** O que o usuário vê antes de decidir: comando exato ou diff. */
  preview: string;
  previewType: 'command' | 'diff' | 'text';
  risk: 'write' | 'irreversible';
  summary: string;
}

export interface AiSession {
  id: string;
  title: string;
  mode: ApprovalMode;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  /** Chamadas aguardando decisão do usuário; a conversa retoma daqui. */
  pending: PendingApproval[] | null;
  /** Resultados já resolvidos das pendências, para reinjetar no loop. */
  resolved: Record<string, string>;
}

const MAX_MESSAGES = 200;

function sessionPath(id: string): string {
  if (!/^[a-zA-Z0-9-]{6,64}$/.test(id)) throw new Error('ID de sessão inválido');
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function createSession(options: { mode?: ApprovalMode; model?: string } = {}): AiSession {
  const now = new Date().toISOString();
  const session: AiSession = {
    id: randomUUID(),
    title: 'Nova conversa',
    mode: options.mode ?? 'assisted',
    model: options.model ?? '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    pending: null,
    resolved: {},
  };
  saveSession(session);
  return session;
}

/**
 * Converte tool_calls gravados no formato achatado antigo.
 * Sem isso, retomar uma conversa salva antes da correção reenviaria o histórico
 * inválido para a API e a sessão ficaria permanentemente quebrada.
 */
function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return (messages ?? []).map(message => {
    if (!message.tool_calls?.length) return message;

    return {
      ...message,
      tool_calls: message.tool_calls.map(call => {
        const legacy = call as unknown as { id: string; name?: string; arguments?: string };
        if (call.function?.name) return call;
        return {
          id: legacy.id,
          type: 'function' as const,
          function: { name: legacy.name ?? '', arguments: legacy.arguments ?? '{}' },
        };
      }),
    };
  });
}

export function loadSession(id: string): AiSession | null {
  try {
    const file = sessionPath(id);
    if (!fs.existsSync(file)) return null;

    const session = readJson<AiSession | null>(file, null);
    if (!session) return null;

    return { ...session, messages: normalizeMessages(session.messages) };
  } catch {
    return null;
  }
}

export function saveSession(session: AiSession): void {
  ensureDir(SESSIONS_DIR, 0o750);
  const trimmed: AiSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    // Mantém o início da conversa (onde está a tarefa) e a cauda recente.
    messages: session.messages.length > MAX_MESSAGES
      ? [...session.messages.slice(0, 10), ...session.messages.slice(-(MAX_MESSAGES - 10))]
      : session.messages,
  };
  writeJson(sessionPath(session.id), trimmed, 0o640);
}

export function updateSession(id: string, mutate: (session: AiSession) => AiSession): Promise<AiSession> {
  const file = sessionPath(id);
  return withFileLock(file, async () => {
    const current = loadSession(id);
    if (!current) throw new Error('Sessão não encontrada');
    const updated = mutate(current);
    saveSession(updated);
    return updated;
  });
}

export interface SessionSummary {
  id: string;
  title: string;
  mode: ApprovalMode;
  updatedAt: string;
  messageCount: number;
  hasPending: boolean;
}

export function listSessions(limit = 50): SessionSummary[] {
  ensureDir(SESSIONS_DIR, 0o750);
  try {
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.bak'))
      .map(f => {
        const session = readJson<AiSession | null>(path.join(SESSIONS_DIR, f), null);
        if (!session) return null;
        return {
          id: session.id,
          title: session.title,
          mode: session.mode,
          updatedAt: session.updatedAt,
          messageCount: session.messages.filter(m => m.role === 'user' || m.role === 'assistant').length,
          hasPending: Boolean(session.pending?.length),
        };
      })
      .filter((s): s is SessionSummary => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function deleteSession(id: string): void {
  try {
    const file = sessionPath(id);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.bak`, { force: true });
  } catch {}
}

/** Título derivado da primeira pergunta — evita uma chamada extra ao modelo. */
export function deriveTitle(firstUserMessage: string): string {
  const clean = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Nova conversa';
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/**
 * Confere o histórico antes de enviá-lo ao provedor.
 *
 * Duas invariantes que, quando quebradas, fazem a API recusar a conversa
 * inteira — e o erro que ela devolve não diz qual mensagem está errada:
 *
 * 1. todo `tool_call` precisa do envelope `type: 'function'`;
 * 2. todo `tool_call` precisa de uma mensagem `tool` respondendo ao seu id.
 */
export function validateConversation(messages: ChatMessage[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const answered = new Set(
    messages.filter(m => m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id as string),
  );

  messages.forEach((message, index) => {
    for (const call of message.tool_calls ?? []) {
      if (call.type !== 'function') {
        errors.push(`mensagem ${index}: tool_call ${call.id} sem type:'function'`);
      }
      if (!call.function?.name) {
        errors.push(`mensagem ${index}: tool_call ${call.id} sem function.name`);
      }
      if (!answered.has(call.id)) {
        errors.push(`tool_call ${call.id} (${call.function?.name ?? '?'}) ficou sem resposta`);
      }
    }

    if (message.role === 'tool' && !message.tool_call_id) {
      errors.push(`mensagem ${index}: role 'tool' sem tool_call_id`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Remove do fim do histórico as chamadas que ficaram sem resposta.
 * Acontece quando o stream é interrompido no meio de um turno; sem a poda, a
 * sessão fica permanentemente inutilizável.
 */
export function pruneUnansweredCalls(messages: ChatMessage[]): ChatMessage[] {
  const answered = new Set(
    messages.filter(m => m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id as string),
  );

  return messages.filter(message => {
    if (!message.tool_calls?.length) return true;
    return message.tool_calls.every(call => answered.has(call.id));
  });
}
