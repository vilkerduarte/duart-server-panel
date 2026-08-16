import type { NextApiRequest, NextApiResponse } from 'next';
import { verifySession, readUsers } from '@/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const token = req.cookies.token
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);

  if (!token) {
    if (readUsers().users.length === 0) {
      return res.status(200).json({ success: false, code: 'SETUP_REQUIRED' });
    }
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }

  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada' });
  }

  return res.status(200).json({
    success: true,
    data: {
      token,
      user: {
        id: session.user.id,
        username: session.user.username,
        role: session.user.role,
      },
    },
  });
}
