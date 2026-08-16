import type { NextApiRequest, NextApiResponse } from 'next';
import { readUsers, createInitialAdmin, buildSessionCookie } from '@/lib/auth';
import { isSecureRequest } from '@/lib/middleware/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({
      success: false,
      error: 'Nome de usuário deve ter de 3 a 32 caracteres (letras, números, ponto, hífen e underscore)',
    });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 8 caracteres' });
  }

  if (readUsers().users.length > 0) {
    return res.status(400).json({ success: false, error: 'Usuário admin já existe' });
  }

  try {
    const { user, token } = createInitialAdmin(username, password);
    res.setHeader('Set-Cookie', buildSessionCookie(token, isSecureRequest(req)));

    return res.status(200).json({
      success: true,
      data: { token, user: { id: user.id, username: user.username, role: user.role } },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
