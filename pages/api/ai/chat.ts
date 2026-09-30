import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readConfig } from '@/lib/data/config';
import { createAiClient, buildSystemPrompt, gatherServerContext, PROVIDER_PRESETS } from '@/lib/ai/client';
import {
  TOOL_MAP, toolsForMode, toOpenAiTools, requiresApproval, buildPreview, describeCall, isUnrestricted,
  ToolContext, ToolDefinition,
} from '@/lib/ai/tools';
import { AiMode, isAiMode, normalizeAiMode, canWrite } from '@/lib/ai/modes';
import { tr, normalizeLocale, Locale } from '@/lib/ai/messages';
import { appendJournal } from '@/lib/ai/journal';
import {
  createSession, loadSession, saveSession, deriveTitle,
  sanitizeConversation, trimConversation,
  AiSession, ChatMessage, PendingApproval, ToolCallRecord,
} from '@/lib/ai/sessions';

/**
 * Laço de conversa com ferramentas.
 *
 * O desenho anterior devolvia o resultado da execução para a tela e nunca para
 * o modelo, então a IA só conseguia dar um passo com informação incompleta.
 * Aqui o resultado de cada ferramenta volta para a conversa e o laço continua
 * até o modelo parar de chamar ferramentas — que é o que permite tarefa
 * composta de vários passos.
 *
 * A aprovação humana acontece sem quebrar esse laço: quando uma chamada exige
 * decisão, o estado é persistido na sessão, o stream informa o que está
 * pendente e termina. A próxima requisição com as decisões retoma exatamente
 * de onde parou.
 */

/** Passos por mensagem, por modo. Executar com Acesso Total monta projetos inteiros. */
const MAX_ITERATIONS: Record<AiMode, number> = { chat: 16, analyze: 24, learn: 16, generate: 30, execute: 24 };
const MAX_ITERATIONS_FULL_ACCESS = 60;
const MAX_TOOL_RESULT_CHARS = 24000;
/** Quanto da saída de cada ferramenta vai para o painel de saída da interface. */
const MAX_OUTPUT_PREVIEW_CHARS = 6000;

/** Teto do histórico enviado por requisição, deixando folga para prompt e resposta. */
const MAX_CONTEXT_CHARS = 240_000;

/** Escrever arquivos inteiros numa chamada precisa de bem mais que 4096 tokens. */
const MAX_TOKENS_DEFAULT = 4096;
const MAX_TOKENS_WRITING = 8192;

/**
 * Como o resultado de uma ferramenta aparece na interface. A tela traduz pelo
 * código; `detail` só carrega texto quando é o erro devolvido pela ferramenta.
 */
type ToolOutcome = 'done' | 'error' | 'rejected' | 'truncated' | 'unavailable';

interface PlanStep { title: string; status: 'pending' | 'running' | 'done' | 'failed' }

type SseEvent =
  | { type: 'session'; sessionId: string; title: string; mode: AiMode; fullAccess: boolean }
  | { type: 'chunk'; content: string }
  | { type: 'notice'; code: string; params?: Record<string, string | number>; content: string }
  | { type: 'tool_start'; id: string; name: string; detail: string }
  | {
      type: 'tool_result'; id: string; name: string; ok: boolean; code: ToolOutcome;
      detail?: string; durationMs: number; output?: string;
    }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'approval_required'; pending: PendingApproval[] }
  | { type: 'done'; sessionId: string; title: string; iterations: number }
  | { type: 'error'; code: string; params?: Record<string, string | number>; content: string };

function send(res: NextApiResponse, event: SseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function truncateForModel(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (resultado truncado; refine a consulta se precisar do resto)`;
}

function parseArgs(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/** O que vale mostrar no painel de saída: stdout/stderr quando houver, senão o resultado compacto. */
function outputForUi(result: { ok: boolean; data?: unknown; error?: string }): string | undefined {
  const data = result.data as { stdout?: string; stderr?: string } | undefined;
  let text = '';

  if (data && typeof data === 'object' && ('stdout' in data || 'stderr' in data)) {
    text = [data.stdout, data.stderr].filter(Boolean).join('\n');
  } else if (result.data !== undefined) {
    try { text = JSON.stringify(result.data, null, 2); } catch { text = String(result.data); }
  }
  if (!result.ok && result.error) text = [text, result.error].filter(Boolean).join('\n');

  text = text.trim();
  if (!text) return undefined;
  return text.length > MAX_OUTPUT_PREVIEW_CHARS ? `${text.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}\n…` : text;
}

interface ToolRun {
  ok: boolean;
  payload: string;
  detail?: string;
  durationMs: number;
  output?: string;
  data?: unknown;
}

/** Executa uma ferramenta, registra no journal e devolve o texto para o modelo. */
async function runTool(
  tool: ToolDefinition,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolRun> {
  const startedAt = Date.now();

  try {
    const result = await tool.execute(args, ctx);
    const durationMs = Date.now() - startedAt;

    appendJournal({
      sessionId: ctx.sessionId,
      user: ctx.user,
      mode: `${ctx.mode}${ctx.fullAccess ? '+full' : ''}`,
      tool: tool.name,
      args,
      outcome: result.ok ? 'ok' : 'error',
      durationMs,
      stdout: result.ok ? JSON.stringify(result.data).slice(0, 4000) : undefined,
      stderr: result.error,
      diff: result.diff,
      rollbackHint: result.rollbackHint,
    });

    const payload = result.ok
      ? JSON.stringify({ ok: true, ...(result.data as object ?? {}) })
      : JSON.stringify({ ok: false, error: result.error });

    return {
      ok: result.ok,
      payload: truncateForModel(payload),
      detail: result.ok ? undefined : (result.error ?? '').substring(0, 200),
      durationMs,
      output: outputForUi(result),
      data: result.data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;

    appendJournal({
      sessionId: ctx.sessionId,
      user: ctx.user,
      mode: `${ctx.mode}${ctx.fullAccess ? '+full' : ''}`,
      tool: tool.name,
      args,
      outcome: 'error',
      durationMs,
      stderr: message,
    });

    return {
      ok: false, payload: JSON.stringify({ ok: false, error: message }),
      detail: message.substring(0, 200), durationMs, output: message.substring(0, MAX_OUTPUT_PREVIEW_CHARS),
    };
  }
}

/** Emite start + result de uma chamada que já foi executada. */
function reportTool(res: NextApiResponse, id: string, tool: ToolDefinition, run: ToolRun): void {
  // O plano aparece como lista própria na interface, não como passo executado.
  if (tool.name === 'update_plan') {
    const steps = (run.data as { steps?: PlanStep[] } | undefined)?.steps;
    if (run.ok && steps?.length) send(res, { type: 'plan', steps });
    return;
  }

  send(res, { type: 'tool_result', id, name: tool.name, ok: run.ok, code: run.ok ? 'done' : 'error', detail: run.detail, durationMs: run.durationMs, output: run.output });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
    responseLimit: false,
  },
};

/** Classifica o erro do provedor num código que a interface traduz. */
function classifyError(message: string, model: string): {
  code: string; params?: Record<string, string | number>; historyWasInvalid: boolean;
} {
  // A ordem importa: os padrões específicos vêm antes dos genéricos. Testar
  // /tool|function.?call/ cedo demais captura "content or tool_calls must be
  // set" — um bug de histórico — e diagnostica como "modelo sem function calling".
  if (/401|403|authentication|invalid_api_key|no permission/i.test(message)) {
    return { code: 'auth', historyWasInvalid: false };
  }
  if (/429|rate.?limit|quota|insufficient.?balance/i.test(message)) {
    return { code: 'rateLimit', historyWasInvalid: false };
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)) {
    return { code: 'timeout', historyWasInvalid: false };
  }
  if (/content or tool_calls must be set|invalid assistant message/i.test(message)) {
    return { code: 'badHistory', historyWasInvalid: true };
  }
  if (/tool.?call.*not.*support|does not support tools|unsupported.*function.?call/i.test(message)) {
    return { code: 'noFunctionCalling', params: { model }, historyWasInvalid: false };
  }
  if (/maximum context length|context_length_exceeded|too long/i.test(message)) {
    return { code: 'context', historyWasInvalid: true };
  }
  if (/model.*(not found|does not exist)|invalid model/i.test(message)) {
    return { code: 'modelNotFound', params: { model }, historyWasInvalid: false };
  }
  return { code: 'generic', historyWasInvalid: false };
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const locale: Locale = normalizeLocale(req.body?.locale);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: tr(locale, 'error.methodNotAllowed') });
  }

  const appConfig = readConfig();
  if (!appConfig.aiApiKey) {
    return res.status(400).json({
      success: false,
      code: 'noApiKey',
      error: tr(locale, 'error.noApiKey'),
    });
  }

  const { sessionId, message, mode: requestedMode, approvals } = req.body ?? {};

  let session: AiSession | null = sessionId ? loadSession(String(sessionId)) : null;
  if (!session) {
    session = createSession({
      mode: isAiMode(requestedMode) ? requestedMode : normalizeAiMode(appConfig.aiDefaultMode),
      model: appConfig.aiModel,
    });
  }
  if (requestedMode !== undefined) {
    session.mode = normalizeAiMode(requestedMode, session.mode);
  }

  // Lido a cada requisição: desligar o Acesso Total na configuração vale já na
  // próxima mensagem, inclusive para conversas antigas.
  const fullAccess = Boolean(appConfig.aiFullAccess);
  const policy = { mode: session.mode, fullAccess };
  const unrestricted = isUnrestricted(policy);

  const userMessage = typeof message === 'string' ? message.trim() : '';
  if (userMessage) {
    if (!session.messages.some(m => m.role === 'user')) {
      session.title = deriveTitle(userMessage);
    }
    session.messages.push({ role: 'user', content: userMessage });
  }

  if (!userMessage && !approvals?.length && !session.pending?.length) {
    return res.status(400).json({ success: false, error: tr(locale, 'error.needInput') });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const ctx: ToolContext = {
    user: req.user?.username ?? 'desconhecido',
    sessionId: session.id,
    mode: session.mode,
    fullAccess,
    unrestricted,
    locale,
  };

  const maxIterations = unrestricted && session.mode === 'execute'
    ? MAX_ITERATIONS_FULL_ACCESS
    : MAX_ITERATIONS[session.mode];
  // Configurações manda: zero (o padrão) mantém o teto por modo.
  const maxTokens = appConfig.aiMaxTokens > 0
    ? appConfig.aiMaxTokens
    : canWrite(session.mode) ? MAX_TOKENS_WRITING : MAX_TOKENS_DEFAULT;

  send(res, { type: 'session', sessionId: session.id, title: session.title, mode: session.mode, fullAccess });

  // "Parar" na interface fecha a conexão; o laço precisa notar e não seguir
  // executando ferramentas que ninguém está mais acompanhando.
  let clientGone = false;
  res.on('close', () => { if (!res.writableEnded) clientGone = true; });

  const model = appConfig.aiModel || PROVIDER_PRESETS.deepseek.defaultModel;

  try {
    const serverContext = await gatherServerContext();
    const systemPrompt = buildSystemPrompt(serverContext, { mode: session.mode, fullAccess, locale });

    const tools = toolsForMode(session.mode, fullAccess);
    const availableTools = new Set(tools.map(t => t.name));
    const client = createAiClient({
      apiKey: appConfig.aiApiKey,
      baseUrl: appConfig.aiBaseUrl || PROVIDER_PRESETS.deepseek.baseUrl,
      model: appConfig.aiModel,
    });

    /* ---------- Resolve aprovações pendentes antes de retomar ---------- */

    if (session.pending?.length) {
      const decisions = new Map<string, boolean>(
        (Array.isArray(approvals) ? approvals : []).map((a: any) => [String(a.toolCallId), Boolean(a.approved)]),
      );

      // A API recusa a conversa inteira se um tool_call ficar sem a mensagem
      // `tool` correspondente. Então, se faltar decisão para alguma chamada,
      // nada é executado e a pendência é reemitida — em vez de seguir com o
      // histórico inválido.
      const undecided = session.pending.filter(p => !decisions.has(p.toolCallId));
      if (undecided.length) {
        session.pending = undecided;
        saveSession(session);
        send(res, { type: 'approval_required', pending: undecided });
        send(res, { type: 'done', sessionId: session.id, title: session.title, iterations: 0 });
        res.end();
        return;
      }

      for (const pending of session.pending) {
        const approved = decisions.get(pending.toolCallId);
        const tool = TOOL_MAP.get(pending.tool);

        if (!approved) {
          appendJournal({
            sessionId: session.id, user: ctx.user, mode: session.mode,
            tool: pending.tool, args: pending.args,
            outcome: 'rejected', durationMs: 0,
          });
          session.messages.push({
            role: 'tool',
            tool_call_id: pending.toolCallId,
            name: pending.tool,
            content: JSON.stringify({ ok: false, error: 'The user declined this operation. Do not retry it without proposing an alternative.' }),
          });
          send(res, { type: 'tool_result', id: pending.toolCallId, name: pending.tool, ok: false, code: 'rejected', durationMs: 0 });
          continue;
        }

        // Uma aprovação guardada só vale se a ferramenta ainda estiver ao
        // alcance do modo atual: o Acesso Total pode ter sido desligado ou a
        // conversa trocada de aba enquanto a decisão esperava.
        if (!tool || !availableTools.has(tool.name)) {
          session.messages.push({
            role: 'tool', tool_call_id: pending.toolCallId, name: pending.tool,
            content: JSON.stringify({ ok: false, error: 'Tool not available in the current mode.' }),
          });
          send(res, { type: 'tool_result', id: pending.toolCallId, name: pending.tool, ok: false, code: 'unavailable', durationMs: 0 });
          continue;
        }

        send(res, { type: 'tool_start', id: pending.toolCallId, name: tool.name, detail: describeCall(tool, pending.args) });
        const run = await runTool(tool, pending.args, ctx);
        reportTool(res, pending.toolCallId, tool, run);

        session.messages.push({
          role: 'tool', tool_call_id: pending.toolCallId, name: tool.name, content: run.payload,
        });
      }

      session.pending = null;
      saveSession(session);
    }

    /* ---------- Laço principal ---------- */

    let iterations = 0;

    while (iterations < maxIterations && !clientGone) {
      iterations++;

      // Saneia e corta antes de enviar: um turno vazio, uma chamada sem resposta
      // ou uma resposta órfã derrubam a requisição inteira com erro 400.
      const trimmed = trimConversation(sanitizeConversation(session.messages), MAX_CONTEXT_CHARS);
      if (trimmed.dropped > 0) {
        send(res, {
          type: 'notice', code: 'trimmed', params: { n: trimmed.dropped },
          content: tr(locale, 'error.trimmed', { n: trimmed.dropped }),
        });
      }

      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...trimmed.messages] as any,
        tools: tools.length ? toOpenAiTools(tools) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
        // Escrever arquivos inteiros numa chamada de ferramenta estoura 4096
        // com facilidade — e o corte no meio produz JSON de argumentos inválido.
        max_tokens: maxTokens,
        // Operação de servidor não se beneficia de variabilidade.
        temperature: 0.2,
      });

      let assistantText = '';
      let reasoningSeen = false;
      let finishReason: string | null = null;
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0] as any;
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta as any;
        if (!delta) continue;

        // Modelos de raciocínio emitem a cadeia de pensamento em campo separado.
        // Ela não pode voltar para a API no histórico, mas serve para saber que
        // o modelo respondeu — em vez de tratar o turno como vazio.
        if (delta.reasoning_content) reasoningSeen = true;

        if (delta.content) {
          assistantText += delta.content;
          send(res, { type: 'chunk', content: delta.content });
        }

        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const current = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.name += call.function.name;
          if (call.function?.arguments) current.arguments += call.function.arguments;
          toolCalls.set(index, current);
        }
      }

      const calls: ToolCallRecord[] = Array.from(toolCalls.values())
        .filter(c => c.name)
        .map(c => ({
          id: c.id || `call_${Math.random().toString(36).slice(2, 12)}`,
          type: 'function' as const,
          function: {
            name: c.name,
            // Argumento vazio precisa virar objeto vazio válido, não string vazia.
            arguments: c.arguments || '{}',
          },
        }));

      /* ---------- Turno vazio: não pode ser gravado ---------- */

      // Um assistente sem `content` e sem `tool_calls` é recusado pela API — e
      // como fica salvo na sessão, envenena toda mensagem seguinte.
      if (!assistantText.trim() && calls.length === 0) {
        const kind = finishReason === 'length' ? 'emptyLength'
          : finishReason === 'content_filter' ? 'emptyFiltered'
          : reasoningSeen ? 'emptyReasoning'
          : 'emptyGeneric';
        const params = { reason: finishReason ?? 'unknown' };
        const text = tr(locale, `error.${kind}`, params);

        appendJournal({
          sessionId: session.id, user: ctx.user, mode: session.mode,
          tool: '(empty turn)', args: { finishReason, reasoningSeen, iterations },
          outcome: 'error', durationMs: 0, stderr: text,
        });

        // A sessão é salva sem a mensagem inválida: ela continua utilizável.
        saveSession(session);
        send(res, { type: 'error', code: kind, params, content: text });
        send(res, { type: 'done', sessionId: session.id, title: session.title, iterations });
        res.end();
        return;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantText || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      };
      session.messages.push(assistantMessage);

      // Chamada cortada no meio tem JSON de argumentos truncado; executar com
      // argumentos pela metade é pior do que avisar.
      if (finishReason === 'length' && calls.length > 0) {
        for (const call of calls) {
          session.messages.push({
            role: 'tool', tool_call_id: call.id, name: call.function.name,
            content: JSON.stringify({
              ok: false,
              error: 'The call was cut by the token limit and its arguments arrived incomplete. '
                + 'Redo it in smaller pieces (fewer files per call, or apply_patch instead of rewriting).',
            }),
          });
          send(res, { type: 'tool_result', id: call.id, name: call.function.name, ok: false, code: 'truncated', durationMs: 0 });
        }
        saveSession(session);
        continue;
      }

      if (!calls.length) {
        saveSession(session);
        break;
      }

      /* ---------- Executa ou enfileira para aprovação ---------- */

      const pending: PendingApproval[] = [];

      for (const call of calls) {
        // Chamadas que sobram sem resposta são podadas por sanitizeConversation.
        if (clientGone) break;

        const toolName = call.function.name;
        const tool = TOOL_MAP.get(toolName);
        const args = parseArgs(call.function.arguments);

        // Só vale o que o modo atual oferece. Uma chamada fora dele (o modelo
        // lembrou de uma ferramenta de outra aba) recebe a explicação, em vez
        // de cair na regra de aprovação.
        if (!tool || !availableTools.has(toolName)) {
          session.messages.push({
            role: 'tool', tool_call_id: call.id, name: toolName,
            content: JSON.stringify({
              ok: false,
              error: tool
                ? `Tool ${toolName} is not available in "${session.mode}" mode. Tell the user which tab or setting enables it.`
                : `Unknown tool: ${toolName}`,
            }),
          });
          send(res, { type: 'tool_result', id: call.id, name: toolName, ok: false, code: 'unavailable', durationMs: 0 });
          continue;
        }

        if (requiresApproval(tool, args, policy)) {
          const preview = await buildPreview(tool, args, locale);
          pending.push({
            toolCallId: call.id,
            tool: tool.name,
            args,
            preview: preview.content,
            previewType: preview.type,
            risk: tool.risk === 'irreversible' ? 'irreversible' : 'write',
            summary: preview.summary,
          });
          continue;
        }

        if (tool.name !== 'update_plan') {
          send(res, { type: 'tool_start', id: call.id, name: tool.name, detail: describeCall(tool, args) });
        }
        const run = await runTool(tool, args, ctx);
        reportTool(res, call.id, tool, run);

        session.messages.push({
          role: 'tool', tool_call_id: call.id, name: tool.name, content: run.payload,
        });
      }

      if (pending.length) {
        // A conversa pausa aqui. O estado fica salvo; a próxima requisição
        // com as decisões continua o laço de onde parou.
        session.pending = pending;
        saveSession(session);
        send(res, { type: 'approval_required', pending });
        send(res, { type: 'done', sessionId: session.id, title: session.title, iterations });
        res.end();
        return;
      }

      saveSession(session);
    }

    if (clientGone) {
      saveSession(session);
      res.end();
      return;
    }

    if (iterations >= maxIterations) {
      send(res, {
        type: 'notice', code: 'iterationLimit', params: { n: maxIterations },
        content: tr(locale, 'error.iterationLimit', { n: maxIterations }),
      });
    }

    send(res, { type: 'done', sessionId: session.id, title: session.title, iterations });
    res.end();
  } catch (err: any) {
    const raw = err?.message ?? 'AI communication error';
    const { code, params, historyWasInvalid } = classifyError(raw, model);
    const friendly = code === 'generic' ? `${tr(locale, 'error.generic')} ${raw}`.trim() : tr(locale, `error.${code}`, params);

    try {
      if (session) {
        session.pending = null;
        // Grava já saneada, para o próximo envio não repetir o mesmo erro.
        if (historyWasInvalid) session.messages = sanitizeConversation(session.messages);
        saveSession(session);
      }
      send(res, { type: 'error', code, params, content: friendly });
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: friendly });
      }
    }
  }
});
