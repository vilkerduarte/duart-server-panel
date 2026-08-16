import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { loadSession, deleteSession } from '@/lib/ai/sessions';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const id = String(req.query.id ?? '');
  if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

  if (req.method === 'GET') {
    const session = loadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    // As mensagens de ferramenta não interessam à UI: ela mostra os eventos.
    return res.status(200).json({
      success: true,
      data: {
        ...session,
        messages: session.messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)),
      },
    });
  }

  if (req.method === 'DELETE') {
    deleteSession(id);
    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
