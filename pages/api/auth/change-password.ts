import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readUsers, writeUsers, hashPassword, verifyPassword } from '@/lib/auth';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Senha atual e nova senha são obrigatórias' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Nova senha deve ter no mínimo 8 caracteres' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, error: 'A nova senha deve ser diferente da atual' });
  }

  try {
    const users = readUsers();
    const username = req.user?.username;

    if (!username) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    const userIndex = users.users.findIndex(u => u.username === username);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const user = users.users[userIndex];

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Senha atual incorreta' });
    }

    // Hash new password and update
    user.passwordHash = await hashPassword(newPassword);
    users.users[userIndex] = user;
    writeUsers(users);

    return res.status(200).json({ success: true, data: { changed: true } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
