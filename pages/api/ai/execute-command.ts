import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { command, approved } = req.body;

  if (!approved) {
    return res.status(403).json({ success: false, error: 'Comando não aprovado pelo usuário' });
  }

  if (!command || typeof command !== 'string') {
    return res.status(400).json({ success: false, error: 'Comando é obrigatório' });
  }

  // Basic security check
  const blockedPatterns = [
    /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, />\s*\/dev\/sd/,
    /chmod\s+777\s+\//, /chown\s+-R/,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(command)) {
      return res.status(403).json({ success: false, error: 'Comando bloqueado por segurança' });
    }
  }

  try {
    const startTime = Date.now();
    const result = await executeRaw(command, 30000);
    const duration = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        duration,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
