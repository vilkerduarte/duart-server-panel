import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

const DB_PACKAGES: Record<string, string> = { mysql: 'mysql-server', postgresql: 'postgresql', mongodb: 'mongod' };

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });

  const { type } = req.query;
  const pkg = DB_PACKAGES[type as string];
  if (!pkg) return res.status(400).json({ success: false, error: 'Tipo inválido' });

  try {
    // Check if already installed
    const checkResult = await executeCommand('systemctl_status', [type as string]);
    if (checkResult.code !== 4) {
      return res.status(409).json({ success: false, error: 'Já está instalado' });
    }

    const result = await executeCommand('apt_install', [pkg]);

    if (result.code !== 0) {
      return res.status(500).json({ success: false, error: result.stderr || 'Erro na instalação' });
    }

    // Start service
    await executeCommand('systemctl_start', [type as string]);
    await executeCommand('systemctl_enable', [type as string]);

    return res.status(200).json({ success: true, data: { installed: true, serviceStarted: true } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
