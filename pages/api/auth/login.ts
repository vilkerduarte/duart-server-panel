import type { NextApiRequest, NextApiResponse } from 'next';
import {
  readUsers, verifyPassword, generateToken,
  checkLoginAttempts, recordLoginAttempt, buildSessionCookie,
} from '@/lib/auth';
import { isSecureRequest } from '@/lib/middleware/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
  }

  const users = readUsers();
  if (users.users.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Nenhum usuário configurado. Execute o setup inicial.',
      code: 'SETUP_REQUIRED',
    });
  }

  const attemptCheck = checkLoginAttempts(username, req.socket.remoteAddress);
  if (!attemptCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Muitas tentativas. Aguarde ${attemptCheck.waitMinutes} minutos.`,
    });
  }

  const user = users.users.find(u => u.username === username);

  // Mesmo sem usuário, roda a comparação: o tempo de resposta deixa de revelar
  // quais nomes de usuário existem.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    recordLoginAttempt(username, false, req.socket.remoteAddress);
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  recordLoginAttempt(username, true, req.socket.remoteAddress);
  const token = generateToken(user);
  const sessionHours = users.settings.sessionDurationHours || 24;

  res.setHeader('Set-Cookie', buildSessionCookie(token, isSecureRequest(req), sessionHours * 3600));

  return res.status(200).json({
    success: true,
    data: {
      token,
      user: { id: user.id, username: user.username, role: user.role },
    },
  });
}
