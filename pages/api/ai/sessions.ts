import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { listSessions, createSession, deleteSession } from '@/lib/ai/sessions';
import { readConfig } from '@/lib/data/config';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: listSessions(Number(req.query.limit) || 50) });
  }

  if (req.method === 'POST') {
    const config = readConfig();
    const session = createSession({
      mode: req.body?.mode ?? config.aiDefaultMode,
      model: config.aiModel,
    });
    return res.status(200).json({ success: true, data: session });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id ?? '');
    if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });
    deleteSession(id);
    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
