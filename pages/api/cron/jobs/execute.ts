import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CRON_DIR = path.join(DATA_DIR, 'cron');
const CUSTOM_FILE = path.join(CRON_DIR, 'custom.json');

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: 'ID do job é obrigatório' });
  }

  try {
    // Find the job
    let job: any = null;

    // Check system jobs
    const systemJobs: Record<string, any> = {
      'ssl-renewal': { command: 'node scripts/renew-ssl.js', description: 'Renovação SSL' },
      'cpu-cleanup': { command: 'find /var/lib/duart-panel/cpu-history/ -mtime +30 -delete', description: 'Limpeza histórico CPU' },
      'log-rotation': { command: 'node scripts/rotate-logs.js', description: 'Rotação de logs' },
    };

    if (systemJobs[id]) {
      job = systemJobs[id];
    } else {
      // Check custom jobs
      if (fs.existsSync(CUSTOM_FILE)) {
        try {
          const data = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf-8'));
          job = (data.jobs || []).find((j: any) => j.id === id);
        } catch {}
      }
    }

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job não encontrado' });
    }

    // Execute the command
    const startTime = Date.now();
    const result = await executeRaw(job.command, 60000);
    const duration = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      data: {
        jobId: id,
        description: job.description || '',
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        duration,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
