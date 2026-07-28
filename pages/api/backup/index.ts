import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureDir() { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

export const config = {
  api: {
    bodyParser: false,
  },
};

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  ensureDir();

  // GET - List backups or download
  if (req.method === 'GET') {
    const { download } = req.query;

    // Download mode
    if (download && typeof download === 'string') {
      const filename = path.basename(download); // Prevent path traversal
      const filepath = path.join(BACKUP_DIR, filename);

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ success: false, error: 'Backup não encontrado' });
      }

      const stat = fs.statSync(filepath);
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', stat.size);

      const readStream = fs.createReadStream(filepath);
      readStream.pipe(res);
      return;
    }

    // List mode
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz')).map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { id: f, name: f, path: path.join(BACKUP_DIR, f), size: stat.size, createdAt: stat.mtime.toISOString() };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json({ success: true, data: files });
  }

  // POST - Create backup or restore
  if (req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';

    // Restore mode (multipart upload)
    if (contentType.includes('multipart/form-data')) {
      return handleRestore(req, res);
    }

    // Create backup mode (JSON body)
    const { includeCpuHistory, includeSslCerts } = req.body || {};

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `duart-panel-${timestamp}.tar.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    try {
      execSync(`tar -czf "${filepath}" -C /var/lib duart-panel 2>/dev/null || tar -czf "${filepath}" -C "${DATA_DIR}" .`, { timeout: 60000 });
      const stat = fs.statSync(filepath);
      return res.status(200).json({ success: true, data: { id: filename, name: filename, path: filepath, size: stat.size, createdAt: new Date().toISOString() } });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // DELETE
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const filepath = path.join(BACKUP_DIR, id as string);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return res.status(200).json({ success: true, data: { deleted: true } });
    }
    return res.status(404).json({ success: false, error: 'Backup não encontrado' });
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
});

async function handleRestore(req: AuthenticatedRequest, res: NextApiResponse) {
  try {
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve());
      req.on('error', (err: Error) => reject(err));
    });

    const rawBody = Buffer.concat(chunks);
    const boundary = req.headers['content-type']?.split('boundary=')[1];

    if (!boundary) {
      return res.status(400).json({ success: false, error: 'Formato multipart inválido' });
    }

    // Parse multipart manually
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const parts = splitBuffer(rawBody, boundaryBuffer);

    let fileBuffer: Buffer | null = null;
    let overwriteSettings = true;
    let keepAdminUser = true;

    for (const part of parts) {
      if (part.length === 0) continue;

      const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) continue;

      const headerStr = part.slice(0, headerEnd).toString('utf-8');
      const body = part.slice(headerEnd + 4, part.length - 2); // Remove trailing \r\n

      if (headerStr.includes('name="file"')) {
        fileBuffer = body;
      } else if (headerStr.includes('name="overwriteSettings"')) {
        overwriteSettings = body.toString('utf-8').trim() === 'true';
      } else if (headerStr.includes('name="keepAdminUser"')) {
        keepAdminUser = body.toString('utf-8').trim() === 'true';
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Arquivo de backup não encontrado' });
    }

    // Save temp file and extract
    const tempFile = path.join(BACKUP_DIR, `restore-${Date.now()}.tar.gz`);
    fs.writeFileSync(tempFile, fileBuffer);

    // Extract to temp directory first
    const tempExtractDir = path.join(BACKUP_DIR, `restore-temp-${Date.now()}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });

    try {
      execSync(`tar -xzf "${tempFile}" -C "${tempExtractDir}"`, { timeout: 120000 });
    } catch (err: any) {
      fs.unlinkSync(tempFile);
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
      return res.status(400).json({ success: false, error: 'Arquivo de backup inválido ou corrompido' });
    }

    // Read the backup manifest to count items
    const countItems = (dir: string): number => {
      let count = 0;
      if (!fs.existsSync(dir)) return 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += countItems(fullPath);
        } else {
          count++;
        }
      }
      return count;
    };
    const itemCount = countItems(tempExtractDir);

    // Copy files to data directory
    const targetDir = DATA_DIR;

    // Backup current auth if keeping admin user
    let currentUsers: Buffer | null = null;
    if (keepAdminUser) {
      const authFile = path.join(targetDir, 'auth', 'users.json');
      if (fs.existsSync(authFile)) {
        currentUsers = fs.readFileSync(authFile);
      }
    }

    // Simple copy (skip auth if keeping admin)
    const copyDir = (src: string, dest: string) => {
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          copyDir(srcPath, destPath);
        } else {
          // Skip auth files if keeping admin
          if (keepAdminUser && destPath.includes('/auth/users.json')) continue;
          if (keepAdminUser && destPath.includes('/auth/.secret')) continue;
          if (keepAdminUser && destPath.includes('/auth/login_attempts.json')) continue;

          if (!overwriteSettings && destPath.includes('/settings/')) continue;

          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    copyDir(tempExtractDir, targetDir);

    // Restore auth if needed
    if (currentUsers && keepAdminUser) {
      fs.mkdirSync(path.join(targetDir, 'auth'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'auth', 'users.json'), currentUsers);
    }

    // Cleanup
    fs.unlinkSync(tempFile);
    fs.rmSync(tempExtractDir, { recursive: true, force: true });

    return res.status(200).json({
      success: true,
      data: { restored: true, items: itemCount },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

function splitBuffer(buffer: Buffer, separator: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = separator.length; // Skip first boundary
  let pos = start;

  while (pos < buffer.length) {
    const idx = buffer.indexOf(separator, pos);
    if (idx === -1) break;
    parts.push(buffer.slice(pos, idx));
    pos = idx + separator.length + 2; // Skip \r\n after boundary
  }

  return parts;
}
