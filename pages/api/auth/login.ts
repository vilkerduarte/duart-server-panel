import type { NextApiRequest, NextApiResponse } from 'next';
import { readUsers, verifyPassword, generateToken, checkLoginAttempts, recordLoginAttempt } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
  }

  // Check if setup is needed
  const users = readUsers();
  if (users.users.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Nenhum usuário configurado. Execute o setup inicial.',
      code: 'SETUP_REQUIRED',
    });
  }

  // Check brute force protection
  const attemptCheck = checkLoginAttempts(username);
  if (!attemptCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Conta bloqueada. Aguarde ${attemptCheck.waitMinutes} minutos.`,
    });
  }

  // Find user
  const user = users.users.find(u => u.username === username);
  if (!user) {
    recordLoginAttempt(username, false);
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    recordLoginAttempt(username, false);
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  // Generate token
  recordLoginAttempt(username, true);
  const token = generateToken(user);

  // Set cookie
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
}
