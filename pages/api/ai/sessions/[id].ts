import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { loadSession, deleteSession, ChatMessage } from '@/lib/ai/sessions';
import { TOOL_MAP, describeCall } from '@/lib/ai/tools';

/**
 * Reconstrói o que a tela mostrou durante a conversa: mensagens, passos de
 * ferramenta (com o resultado gravado) e o último plano. As mensagens `tool`
 * brutas não vão para a UI; os passos saem delas.
 */
function buildTimeline(messages: ChatMessage[]) {
  const results = new Map<string, { ok: boolean; output?: string }>();
  for (const message of messages) {
    if (message.role !== 'tool' || !message.tool_call_id) continue;
    try {
      const parsed = JSON.parse(message.content ?? '{}');
      results.set(message.tool_call_id, { ok: parsed.ok !== false, output: String(message.content ?? '').slice(0, 2000) });
    } catch {
      results.set(message.tool_call_id, { ok: true });
    }
  }

  type Step = { title: string; status: string };
  const entries: Array<Record<string, unknown>> = [];
  let plan: Step[] | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      entries.push({ kind: 'user', text: message.content ?? '' });
      continue;
    }
    if (message.role !== 'assistant') continue;

    if (message.content) entries.push({ kind: 'assistant', text: message.content });

    for (const call of message.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch {}

      if (call.function.name === 'update_plan' && Array.isArray(args.steps)) {
        plan = args.steps as Step[];
        continue;
      }

      const tool = TOOL_MAP.get(call.function.name);
      const result = results.get(call.id);
      entries.push({
        kind: 'tool',
        id: call.id,
        name: call.function.name,
        detail: tool ? describeCall(tool, args) : call.function.name,
        ok: result ? result.ok : null,
        output: result?.output,
      });
    }
  }

  return { entries, plan };
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const id = String(req.query.id ?? '');
  if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

  if (req.method === 'GET') {
    const session = loadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    const { entries, plan } = buildTimeline(session.messages);

    return res.status(200).json({
      success: true,
      data: {
        id: session.id,
        title: session.title,
        mode: session.mode,
        updatedAt: session.updatedAt,
        pending: session.pending,
        entries,
        plan,
      },
    });
  }

  if (req.method === 'DELETE') {
    deleteSession(id);
    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
