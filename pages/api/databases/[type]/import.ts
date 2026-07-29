import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface ImportJob {
  id: string;
  database: string;
  type: string;
  filePath: string;
  fileSize: number;
  status: 'running' | 'completed' | 'error';
  progress: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  output: string;
}

const jobs: Map<string, ImportJob> = new Map();

function generateJobId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function hasPv(): boolean {
  try {
    const r = spawnSync('which', ['pv'], { timeout: 3000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function startImportJob(job: ImportJob): void {
  if (hasPv() && job.type !== 'mongodb') {
    runImportWithPv(job);
  } else {
    runImportDirect(job);
  }
}

function runImportWithPv(job: ImportJob): void {
  const { database, type, filePath, fileSize } = job;

  let dbCmd: string;
  if (type === 'mysql') {
    dbCmd = `sudo mysql \`${database}\``;
  } else if (type === 'postgresql') {
    dbCmd = `sudo -u postgres psql "${database}"`;
  } else {
    runImportDirect(job);
    return;
  }

  // pv -n outputs progress % to stderr; we redirect to stdout to capture
  // Database errors come via the db command's stderr
  const bashCmd = `pv -n -s ${fileSize} "${filePath}" 2>&1 | ${dbCmd}`;

  const child = spawn('bash', ['-c', bashCmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let dbError = '';

  child.stdout.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      const num = parseInt(line, 10);
      if (!isNaN(num) && num >= 0 && num <= 100) {
        job.progress = num;
      }
    }
  });

  child.stderr.on('data', (data: Buffer) => {
    dbError += data.toString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      job.status = 'completed';
      job.progress = 100;
      job.output = dbError || 'Importação concluída com sucesso';
      job.completedAt = Date.now();
    } else {
      job.status = 'error';
      job.error = dbError || `Processo finalizou com código ${code}`;
      job.completedAt = Date.now();
    }
  });

  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    job.completedAt = Date.now();
  });
}

function runImportDirect(job: ImportJob): void {
  const { database, type, filePath, fileSize } = job;

  let cmd: string;
  let args: string[];

  if (type === 'mysql') {
    cmd = 'sudo';
    args = ['mysql', database];
  } else if (type === 'postgresql') {
    cmd = 'sudo';
    args = ['-u', 'postgres', 'psql', database];
  } else {
    // mongodb uses mongorestore which doesn't read from stdin
    cmd = 'sudo';
    args = ['mongorestore', '--db', database, filePath];
  }

  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let errorOutput = '';

  child.stderr.on('data', (data: Buffer) => {
    errorOutput += data.toString();
  });

  // For mysql/postgresql, pipe file to stdin
  if (type !== 'mongodb') {
    const fileStream = fs.createReadStream(filePath);
    let bytesRead = 0;

    fileStream.on('data', (chunk: string | Buffer) => {
      bytesRead += chunk.length;
      child.stdin.write(chunk);
      if (fileSize > 0) {
        job.progress = Math.min(99, Math.round((bytesRead / fileSize) * 100));
      }
    });

    fileStream.on('end', () => {
      child.stdin.end();
    });

    fileStream.on('error', (err) => {
      job.status = 'error';
      job.error = `Erro ao ler arquivo: ${err.message}`;
      job.completedAt = Date.now();
      child.kill();
    });
  }

  child.on('close', (code) => {
    if (code === 0) {
      job.status = 'completed';
      job.progress = 100;
      job.output = errorOutput || 'Importação concluída com sucesso';
      job.completedAt = Date.now();
    } else {
      job.status = 'error';
      job.error = errorOutput || `Processo finalizou com código ${code}`;
      job.completedAt = Date.now();
    }
  });

  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    job.completedAt = Date.now();
  });
}

// Cleanup old jobs periodically (keep last 30)
function cleanupJobs(): void {
  if (jobs.size > 30) {
    const keys = Array.from(jobs.keys());
    const toDelete = keys.slice(0, jobs.size - 30);
    toDelete.forEach(k => jobs.delete(k));
  }
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (!['mysql', 'postgresql', 'mongodb'].includes(type as string)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }

  try {
    // GET - Check import job status
    if (req.method === 'GET') {
      const jobId = req.query.job as string;
      if (!jobId) {
        return res.status(400).json({ success: false, error: 'Job ID é obrigatório' });
      }

      const job = jobs.get(jobId);
      if (!job) {
        return res.status(404).json({ success: false, error: 'Job não encontrado' });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: job.id,
          database: job.database,
          filePath: job.filePath,
          fileSize: job.fileSize,
          status: job.status,
          progress: job.progress,
          error: job.error,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          output: job.output,
        },
      });
    }

    // POST - Start import job
    if (req.method === 'POST') {
      const { database, sqlFilePath } = req.body;

      if (!database || !sqlFilePath) {
        return res.status(400).json({ success: false, error: 'Banco de dados e caminho do SQL são obrigatórios' });
      }

      const safeDb = (database as string).replace(/[^a-zA-Z0-9_-]/g, '');
      const resolvedPath = path.resolve('/', sqlFilePath as string);

      // Validate path
      const allowedDirs = ['/tmp/', '/home/', '/var/', '/opt/', '/srv/', '/root/'];
      const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));
      if (!isAllowed) {
        return res.status(400).json({
          success: false,
          error: 'Caminho não permitido. Use /tmp, /home, /var, /opt, /srv ou /root.',
        });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ success: false, error: `Arquivo não encontrado: ${resolvedPath}` });
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return res.status(400).json({ success: false, error: 'O caminho não é um arquivo' });
      }

      const fileSize = stat.size;

      const jobId = generateJobId();
      const job: ImportJob = {
        id: jobId,
        database: safeDb,
        type: type as string,
        filePath: resolvedPath,
        fileSize,
        status: 'running',
        progress: 0,
        error: null,
        startedAt: Date.now(),
        completedAt: null,
        output: '',
      };

      jobs.set(jobId, job);
      cleanupJobs();

      // Start import asynchronously
      startImportJob(job);

      return res.status(200).json({
        success: true,
        data: {
          jobId,
          database: safeDb,
          filePath: resolvedPath,
          fileSize,
        },
      });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
