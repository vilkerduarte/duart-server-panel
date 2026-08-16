import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readConfig } from '@/lib/data/config';
import { createAiClient, buildSystemPrompt, gatherServerContext, PROVIDER_PRESETS } from '@/lib/ai/client';
import {
  TOOL_MAP, toolsForMode, toOpenAiTools, requiresApproval, buildPreview,
  ToolContext, ToolDefinition,
} from '@/lib/ai/tools';
import { appendJournal } from '@/lib/ai/journal';
import {
  createSession, loadSession, saveSession, deriveTitle,
  AiSession, ChatMessage, PendingApproval, ApprovalMode, ToolCallRecord,
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

const MAX_ITERATIONS = 12;
const MAX_TOOL_RESULT_CHARS = 12000;

type SseEvent =
  | { type: 'session'; sessionId: string; title: string; mode: ApprovalMode }
  | { type: 'chunk'; content: string }
  | { type: 'tool_start'; name: string; summary: string }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'approval_required'; pending: PendingApproval[] }
  | { type: 'done'; sessionId: string; title: string; iterations: number }
  | { type: 'error'; content: string };

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

/** Executa uma ferramenta, registra no journal e devolve o texto para o modelo. */
async function runTool(
  tool: ToolDefinition,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<{ ok: boolean; payload: string; summary: string }> {
  const startedAt = Date.now();

  try {
    const result = await tool.execute(args, ctx);

    appendJournal({
      sessionId: ctx.sessionId,
      user: ctx.user,
      mode: ctx.mode,
      tool: tool.name,
      args,
      outcome: result.ok ? 'ok' : 'error',
      durationMs: Date.now() - startedAt,
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
      summary: result.ok ? 'concluído' : (result.error ?? 'falhou').substring(0, 160),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    appendJournal({
      sessionId: ctx.sessionId,
      user: ctx.user,
      mode: ctx.mode,
      tool: tool.name,
      args,
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      stderr: message,
    });

    return { ok: false, payload: JSON.stringify({ ok: false, error: message }), summary: message.substring(0, 160) };
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
    responseLimit: false,
  },
};

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const appConfig = readConfig();
  if (!appConfig.aiApiKey) {
    return res.status(400).json({
      success: false,
      error: 'Chave de API não configurada. Defina-a em Configurações.',
    });
  }

  const { sessionId, message, mode: requestedMode, approvals } = req.body ?? {};

  let session: AiSession | null = sessionId ? loadSession(String(sessionId)) : null;
  if (!session) {
    session = createSession({
      mode: (requestedMode as ApprovalMode) ?? (appConfig.aiDefaultMode as ApprovalMode) ?? 'assisted',
      model: appConfig.aiModel,
    });
  }
  if (requestedMode && ['read', 'assisted', 'autonomous'].includes(requestedMode)) {
    session.mode = requestedMode;
  }

  const userMessage = typeof message === 'string' ? message.trim() : '';
  if (userMessage) {
    if (!session.messages.some(m => m.role === 'user')) {
      session.title = deriveTitle(userMessage);
    }
    session.messages.push({ role: 'user', content: userMessage });
  }

  if (!userMessage && !approvals?.length && !session.pending?.length) {
    return res.status(400).json({ success: false, error: 'Envie uma mensagem ou uma decisão de aprovação' });
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
  };

  send(res, { type: 'session', sessionId: session.id, title: session.title, mode: session.mode });

  try {
    const serverContext = await gatherServerContext();
    const systemPrompt = buildSystemPrompt(serverContext, session.mode);

    const tools = toolsForMode(session.mode);
    const client = createAiClient({
      apiKey: appConfig.aiApiKey,
      baseUrl: appConfig.aiBaseUrl || PROVIDER_PRESETS.deepseek.baseUrl,
      model: appConfig.aiModel,
    });
    const model = appConfig.aiModel || PROVIDER_PRESETS.deepseek.defaultModel;

    /* ---------- Resolve aprovações pendentes antes de retomar ---------- */

    if (session.pending?.length) {
      const decisions = new Map<string, boolean>(
        (Array.isArray(approvals) ? approvals : []).map((a: any) => [String(a.toolCallId), Boolean(a.approved)]),
      );

      for (const pending of session.pending) {
        const approved = decisions.get(pending.toolCallId);

        if (approved === undefined) {
          // Sem decisão para esta chamada: mantém o restante pendente.
          continue;
        }

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
            content: JSON.stringify({ ok: false, error: 'O usuário recusou esta operação. Não tente novamente sem propor uma alternativa.' }),
          });
          send(res, { type: 'tool_result', name: pending.tool, ok: false, summary: 'recusado pelo usuário' });
          continue;
        }

        const tool = TOOL_MAP.get(pending.tool);
        if (!tool) {
          session.messages.push({
            role: 'tool', tool_call_id: pending.toolCallId, name: pending.tool,
            content: JSON.stringify({ ok: false, error: 'Ferramenta desconhecida' }),
          });
          continue;
        }

        send(res, { type: 'tool_start', name: tool.name, summary: pending.summary });
        const result = await runTool(tool, pending.args, ctx);
        send(res, { type: 'tool_result', name: tool.name, ok: result.ok, summary: result.summary });

        session.messages.push({
          role: 'tool', tool_call_id: pending.toolCallId, name: tool.name, content: result.payload,
        });
      }

      session.pending = null;
      saveSession(session);
    }

    /* ---------- Laço principal ---------- */

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...session.messages] as any,
        tools: tools.length ? toOpenAiTools(tools) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
        max_tokens: 4096,
        // Operação de servidor não se beneficia de variabilidade.
        temperature: 0.2,
      });

      let assistantText = '';
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as any;
        if (!delta) continue;

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
          name: c.name,
          arguments: c.arguments || '{}',
        }));

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantText || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      };
      session.messages.push(assistantMessage);

      if (!calls.length) {
        saveSession(session);
        break;
      }

      /* ---------- Executa ou enfileira para aprovação ---------- */

      const pending: PendingApproval[] = [];

      for (const call of calls) {
        const tool = TOOL_MAP.get(call.name);
        const args = parseArgs(call.arguments);

        if (!tool) {
          session.messages.push({
            role: 'tool', tool_call_id: call.id, name: call.name,
            content: JSON.stringify({ ok: false, error: `Ferramenta desconhecida: ${call.name}` }),
          });
          continue;
        }

        if (requiresApproval(tool, args, session.mode)) {
          const preview = await buildPreview(tool, args);
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

        send(res, { type: 'tool_start', name: tool.name, summary: tool.description.slice(0, 80) });
        const result = await runTool(tool, args, ctx);
        send(res, { type: 'tool_result', name: tool.name, ok: result.ok, summary: result.summary });

        session.messages.push({
          role: 'tool', tool_call_id: call.id, name: tool.name, content: result.payload,
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

    if (iterations >= MAX_ITERATIONS) {
      send(res, {
        type: 'chunk',
        content: `\n\n_Limite de ${MAX_ITERATIONS} passos atingido. Peça para continuar se a tarefa não terminou._`,
      });
    }

    send(res, { type: 'done', sessionId: session.id, title: session.title, iterations });
    res.end();
  } catch (err: any) {
    const message = err?.message ?? 'Erro na comunicação com a IA';

    let friendly = message;
    if (/401|403|authentication|invalid_api_key/i.test(message)) {
      friendly = 'Chave de API inválida ou sem permissão. Verifique em Configurações.';
    } else if (/429|rate.?limit/i.test(message)) {
      friendly = 'Limite de requisições do provedor atingido. Aguarde alguns segundos.';
    } else if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
      friendly = 'Timeout na conexão com o provedor de IA. Tente novamente.';
    } else if (/tool|function.?call/i.test(message)) {
      friendly = `O modelo configurado (${readConfig().aiModel}) parece não suportar function calling. Escolha um modelo com suporte a ferramentas em Configurações. Detalhe: ${message}`;
    }

    try {
      if (session) {
        session.pending = null;
        saveSession(session);
      }
      send(res, { type: 'error', content: friendly });
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: friendly });
      }
    }
  }
});
