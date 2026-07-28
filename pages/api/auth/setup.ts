import type { NextApiRequest, NextApiResponse } from 'next';
import { readUsers, createInitialAdmin } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 8 caracteres' });
  }

  // Check if admin already exists
  const users = readUsers();
  if (users.users.length > 0) {
    return res.status(400).json({ success: false, error: 'Usuário admin já existe' });
  }

  try {
    const { user, token } = createInitialAdmin(username, password);

    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
