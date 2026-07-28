import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { script, name, interpreter, cwd, maxMemory, instances, env, manager } = req.body;

  if (!script) {
    return res.status(400).json({ success: false, error: 'script é obrigatório' });
  }

  try {
    if (manager === 'forever') {
      const args = [script];
      if (name) args.push('--uid', name);
      if (cwd) args.push('--sourceDir', cwd);

      await executeCommand('forever_start', args);
      return res.status(200).json({ success: true, message: 'Aplicação iniciada com Forever' });
    } else {
      const args = [script];
      if (name) args.push('--name', name);
      if (interpreter) args.push('--interpreter', interpreter);
      if (cwd) args.push('--cwd', cwd);
      if (maxMemory) args.push('--max-memory-restart', maxMemory);
      if (instances) args.push('--instances', String(instances));
      if (env) args.push('--env', env);

      await executeCommand('pm2_start_app', args);
      return res.status(200).json({ success: true, message: 'Aplicação iniciada com PM2' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
