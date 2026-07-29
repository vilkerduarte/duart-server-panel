import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const containerId = req.query.id as string;
  if (!containerId) {
    return res.status(400).json({ success: false, error: 'ID do container é obrigatório' });
  }

  // Validate containerId (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(containerId)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  try {
    // Get docker inspect
    const inspectResult = await executeRaw(`docker inspect ${containerId}`, 10000);
    let inspect: any = null;
    try {
      const parsed = JSON.parse(inspectResult.stdout);
      inspect = parsed[0] || null;
    } catch {
      return res.status(400).json({ success: false, error: 'Container não encontrado' });
    }

    // Get docker compose file location (if exists)
    let composeFile: string | null = null;
    try {
      const composeLabel = inspect?.Config?.Labels?.['com.docker.compose.project.config_files'];
      const composeProject = inspect?.Config?.Labels?.['com.docker.compose.project.working_dir'];
      if (composeLabel && composeProject) {
        const composeResult = await executeRaw(`cat ${composeProject}/docker-compose.yml 2>/dev/null || cat ${composeProject}/compose.yaml 2>/dev/null`, 5000);
        if (composeResult.stdout) {
          composeFile = composeResult.stdout;
        }
      }
      // Also check common locations
      if (!composeFile) {
        const name = (inspect?.Name || '').replace(/^\//, '');
        const composePaths = [
          `/opt/${name}/docker-compose.yml`,
          `/srv/${name}/docker-compose.yml`,
          `/home/*/${name}/docker-compose.yml`,
        ];
        for (const p of composePaths) {
          try {
            const result = await executeRaw(`cat ${p} 2>/dev/null`, 3000);
            if (result.stdout && result.code === 0) {
              composeFile = result.stdout;
              break;
            }
          } catch {}
        }
      }
    } catch {}

    // Get container logs
    let logs = '';
    try {
      const logsResult = await executeRaw(`docker logs --tail 500 ${containerId} 2>&1`, 10000);
      logs = logsResult.stdout || logsResult.stderr || '';
    } catch {}

    return res.status(200).json({
      success: true,
      data: {
        inspect,
        composeFile,
        logs,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
