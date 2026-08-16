import type { NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  readCustomJobs, updateCustomJobs, readSystemCron,
  validateCronExpression, nextRuns, isValidCommand, CronJob, CRON_D_FILE,
} from '@/lib/cron';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    /* ---------------------------- GET ---------------------------- */

    if (req.method === 'GET') {
      const custom = readCustomJobs();
      const system = await readSystemCron();

      return res.status(200).json({
        success: true,
        data: {
          // Só o que existe de fato no servidor. A lista antiga era hardcoded
          // e descrevia manutenção que nunca era executada.
          system: system.filter(e => !e.source.startsWith('duart-panel')),
          custom: custom.map(job => ({ ...job, nextRuns: nextRuns(job.expression, 3) })),
          managedFile: CRON_D_FILE,
        },
      });
    }

    /* ---------------------------- POST --------------------------- */

    if (req.method === 'POST') {
      const { expression, command, description, user } = req.body ?? {};

      if (!expression || !command) {
        return res.status(400).json({ success: false, error: 'Expressão e comando são obrigatórios' });
      }

      const check = validateCronExpression(expression);
      if (!check.valid) {
        return res.status(400).json({ success: false, error: `Expressão cron inválida: ${check.error}` });
      }
      if (!isValidCommand(command)) {
        return res.status(400).json({ success: false, error: 'Comando inválido (uma linha, até 2000 caracteres)' });
      }

      const jobUser = String(user || 'root');
      if (!/^[a-z_][a-z0-9_-]*$/.test(jobUser)) {
        return res.status(400).json({ success: false, error: 'Usuário inválido' });
      }

      const job: CronJob = {
        id: randomUUID(),
        expression: String(expression).trim(),
        command: String(command).trim(),
        description: String(description ?? ''),
        user: jobUser,
        active: true,
        createdAt: new Date().toISOString(),
      };

      await updateCustomJobs(jobs => [...jobs, job]);

      return res.status(200).json({
        success: true,
        data: { job: { ...job, nextRuns: nextRuns(job.expression, 3) } },
      });
    }

    /* ---------------------------- PUT ---------------------------- */

    if (req.method === 'PUT') {
      const id = String(req.query.id ?? req.body?.id ?? '');
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      const { expression, command, description, active } = req.body ?? {};

      if (expression !== undefined) {
        const check = validateCronExpression(expression);
        if (!check.valid) {
          return res.status(400).json({ success: false, error: `Expressão cron inválida: ${check.error}` });
        }
      }
      if (command !== undefined && !isValidCommand(command)) {
        return res.status(400).json({ success: false, error: 'Comando inválido' });
      }

      let found = false;
      const updated = await updateCustomJobs(jobs =>
        jobs.map(job => {
          if (job.id !== id) return job;
          found = true;
          return {
            ...job,
            expression: expression !== undefined ? String(expression).trim() : job.expression,
            command: command !== undefined ? String(command).trim() : job.command,
            description: description !== undefined ? String(description) : job.description,
            active: active !== undefined ? Boolean(active) : job.active,
            updatedAt: new Date().toISOString(),
          };
        }),
      );

      if (!found) return res.status(404).json({ success: false, error: 'Job não encontrado' });

      const job = updated.find(j => j.id === id)!;
      return res.status(200).json({ success: true, data: { job: { ...job, nextRuns: nextRuns(job.expression, 3) } } });
    }

    /* --------------------------- DELETE -------------------------- */

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '');
      if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

      const before = readCustomJobs().length;
      const after = await updateCustomJobs(jobs => jobs.filter(job => job.id !== id));

      if (after.length === before) {
        return res.status(404).json({ success: false, error: 'Job não encontrado' });
      }

      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
