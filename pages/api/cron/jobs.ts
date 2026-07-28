import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CRON_DIR = path.join(DATA_DIR, 'cron');
const CUSTOM_FILE = path.join(CRON_DIR, 'custom.json');

function ensureDir() { if (!fs.existsSync(CRON_DIR)) fs.mkdirSync(CRON_DIR, { recursive: true }); }

function readCustomJobs(): any[] {
  if (!fs.existsSync(CUSTOM_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf-8'));
    return data.jobs || [];
  } catch {
    return [];
  }
}

function writeCustomJobs(jobs: any[]) {
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify({ jobs }, null, 2));
}

function validateCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every(p => {
    if (p === '*') return true;
    if (/^\d+$/.test(p)) return true;
    if (/^\d+-\d+$/.test(p)) return true;
    if (/^\*\/(\d+)$/.test(p)) return true;
    if (/^(\d+,)+\d+$/.test(p)) return true;
    return false;
  });
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  ensureDir();

  // GET - List all jobs
  if (req.method === 'GET') {
    const custom = readCustomJobs();

    return res.status(200).json({
      success: true,
      data: {
        system: [
          { id: 'ssl-renewal', expression: '0 3 * * *', command: 'node scripts/renew-ssl.js', description: 'Renovação SSL', type: 'system' },
          { id: 'cpu-cleanup', expression: '0 0 * * *', command: 'find data/cpu-history/ -mtime +30 -delete', description: 'Limpeza histórico CPU', type: 'system' },
          { id: 'log-rotation', expression: '0 0 * * 0', command: 'node scripts/rotate-logs.js', description: 'Rotação de logs', type: 'managed' },
        ],
        managed: [],
        custom,
      },
    });
  }

  // POST - Create new job
  if (req.method === 'POST') {
    const { expression, command, description } = req.body;
    if (!expression || !command) {
      return res.status(400).json({ success: false, error: 'Expressão e comando são obrigatórios' });
    }

    if (!validateCronExpression(expression)) {
      return res.status(400).json({ success: false, error: 'Expressão cron inválida' });
    }

    const jobs = readCustomJobs();
    const job = {
      id: Date.now().toString(),
      expression,
      command,
      description: description || '',
      active: true,
      createdAt: new Date().toISOString(),
    };
    jobs.push(job);
    writeCustomJobs(jobs);

    return res.status(200).json({ success: true, data: { job } });
  }

  // PUT - Update existing job
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

    const jobs = readCustomJobs();
    const index = jobs.findIndex((j: any) => j.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Job não encontrado' });
    }

    const { expression, command, description, active } = req.body;

    if (expression !== undefined) {
      if (!validateCronExpression(expression)) {
        return res.status(400).json({ success: false, error: 'Expressão cron inválida' });
      }
      jobs[index].expression = expression;
    }
    if (command !== undefined) jobs[index].command = command;
    if (description !== undefined) jobs[index].description = description;
    if (active !== undefined) jobs[index].active = !!active;

    jobs[index].updatedAt = new Date().toISOString();
    writeCustomJobs(jobs);

    return res.status(200).json({ success: true, data: { job: jobs[index] } });
  }

  // DELETE - Remove job
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'ID é obrigatório' });

    let jobs = readCustomJobs();
    const before = jobs.length;
    jobs = jobs.filter((j: any) => j.id !== id);

    if (jobs.length === before) {
      return res.status(404).json({ success: false, error: 'Job não encontrado' });
    }

    writeCustomJobs(jobs);
    return res.status(200).json({ success: true, data: { deleted: true } });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
