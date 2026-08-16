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

/**
 * Teto de caracteres do histórico gravado.
 *
 * No modo laboratório o resultado de cada ferramenta chega a 12 mil caracteres
 * e uma sessão passa de 50 chamadas — o contexto do modelo estoura bem antes de
 * 200 mensagens, e o sintoma é o modelo devolver um turno vazio em vez de erro.
 */
const MAX_HISTORY_CHARS = 300_000;

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

    // Saneia na leitura: conversas que já travaram voltam a funcionar sem que
    // o usuário precise descartá-las.
    return { ...session, messages: sanitizeConversation(normalizeMessages(session.messages)) };
  } catch {
    return null;
  }
}

export function saveSession(session: AiSession): void {
  ensureDir(SESSIONS_DIR, 0o750);

  // O corte antigo era por `slice`, que partia grupos ao meio e deixava a
  // sessão gravada num estado que a API recusa.
  const messages = session.messages.length > MAX_MESSAGES
    ? trimConversation(session.messages, MAX_HISTORY_CHARS).messages
    : session.messages;

  writeJson(sessionPath(session.id), { ...session, updatedAt: new Date().toISOString(), messages }, 0o640);
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
 * Deixa o histórico num estado que a API aceita.
 *
 * Três defeitos tornam uma sessão permanentemente inutilizável, porque ficam
 * gravados e são reenviados a cada mensagem seguinte:
 *
 * 1. mensagem de assistente sem `content` e sem `tool_calls` — a API responde
 *    "Invalid assistant message: content or tool_calls must be set". Aparece
 *    quando o modelo devolve um turno vazio (contexto estourado, corte por
 *    max_tokens, resposta filtrada);
 * 2. `tool_call` sem a mensagem `tool` correspondente, deixado por um stream
 *    interrompido no meio do turno;
 * 3. mensagem `tool` órfã, cuja mensagem de assistente foi removida — inclusive
 *    pela poda das outras duas, ou por corte de histórico.
 *
 * Rodar isto na leitura da sessão conserta conversas já travadas.
 */
export function sanitizeConversation(messages: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  const answered = new Set(
    messages.filter(m => m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id as string),
  );

  // Ids que sobreviveram: só as respostas destes podem ficar.
  const validCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      const hasContent = typeof message.content === 'string' && message.content.trim().length > 0;
      const calls = message.tool_calls ?? [];

      // Turno vazio: não existe forma válida de reenviá-lo.
      if (!hasContent && calls.length === 0) continue;

      // Chamadas sem resposta invalidam a mensagem inteira. Se ela também trazia
      // texto, o texto é preservado sozinho — o raciocínio do modelo continua
      // útil como contexto mesmo sem a chamada.
      if (calls.length > 0 && !calls.every(call => answered.has(call.id))) {
        if (hasContent) kept.push({ role: 'assistant', content: message.content });
        continue;
      }

      for (const call of calls) validCallIds.add(call.id);
      kept.push(message);
      continue;
    }

    if (message.role === 'tool') {
      if (message.tool_call_id && validCallIds.has(message.tool_call_id)) kept.push(message);
      continue;
    }

    kept.push(message);
  }

  return kept;
}

/** Mantido por compatibilidade; `sanitizeConversation` cobre este caso e mais. */
export function pruneUnansweredCalls(messages: ChatMessage[]): ChatMessage[] {
  return sanitizeConversation(messages);
}

/**
 * Corta o histórico por tamanho, respeitando os grupos.
 *
 * O corte por contagem de mensagens (`slice`) parte grupos ao meio: separa uma
 * mensagem de assistente das respostas `tool` dela, ou deixa a resposta sem a
 * chamada — os dois casos derrubam a conversa inteira com erro 400.
 *
 * Aqui a unidade de corte é a troca completa (mensagem do usuário e tudo que
 * veio depois dela até a próxima), e a primeira troca é preservada sempre,
 * porque é onde está a tarefa.
 */
export function trimConversation(messages: ChatMessage[], maxChars: number): {
  messages: ChatMessage[];
  dropped: number;
} {
  const size = (list: ChatMessage[]) =>
    list.reduce((total, m) => total + (m.content?.length ?? 0)
      + (m.tool_calls?.reduce((t, c) => t + c.function.arguments.length + c.function.name.length, 0) ?? 0), 0);

  if (size(messages) <= maxChars) return { messages, dropped: 0 };

  // Agrupa: cada bloco começa numa mensagem do usuário.
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || groups.length === 0) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }

  const first = groups[0] ?? [];
  const rest = groups.slice(1);
  let dropped = 0;

  while (rest.length > 1 && size([...first, ...rest.flat()]) > maxChars) {
    rest.shift();
    dropped++;
  }

  return { messages: sanitizeConversation([...first, ...rest.flat()]), dropped };
}
