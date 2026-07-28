import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, readUsers } from '@/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const token = req.cookies.token || req.headers.authorization?.slice(7);

  if (!token) {
    const users = readUsers();
    if (users.users.length === 0) {
      return res.status(200).json({ success: false, code: 'SETUP_REQUIRED' });
    }
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  }

  return res.status(200).json({
    success: true,
    data: {
      token,
      user: {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      },
    },
  });
}
