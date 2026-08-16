import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest, isSecureRequest } from '@/lib/middleware/auth';
import {
  readUsers, writeUsers, hashPassword, verifyPassword,
  generateToken, buildSessionCookie,
} from '@/lib/auth';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Senha atual e nova senha são obrigatórias' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 8 caracteres' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, error: 'A nova senha deve ser diferente da atual' });
  }

  try {
    const users = readUsers();
    const username = req.user?.username;
    if (!username) return res.status(401).json({ success: false, error: 'Usuário não autenticado' });

    const index = users.users.findIndex(u => u.username === username);
    if (index === -1) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });

    const user = users.users[index];
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(400).json({ success: false, error: 'Senha atual incorreta' });
    }

    user.passwordHash = await hashPassword(newPassword);
    // Derruba todas as outras sessões abertas com a senha antiga.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    users.users[index] = user;
    writeUsers(users);

    // A sessão atual recebe um token novo para não cair junto.
    const token = generateToken(user);
    const sessionHours = users.settings.sessionDurationHours || 24;
    res.setHeader('Set-Cookie', buildSessionCookie(token, isSecureRequest(req), sessionHours * 3600));

    return res.status(200).json({
      success: true,
      data: { changed: true, token, otherSessionsRevoked: true },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
