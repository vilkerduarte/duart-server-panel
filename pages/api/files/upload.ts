import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

// Parse multipart form data manually to handle chunks
async function parseMultipart(req: NextApiRequest): Promise<{ fields: Record<string, string>; files: Record<string, { filepath: string; originalFilename: string; size: number }[]> }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const str = buffer.toString('binary');
      const boundary = req.headers['content-type']?.match(/boundary=(.+?)(;|$)/)?.[1];
      if (!boundary) { reject(new Error('No boundary')); return; }

      const fields: Record<string, string> = {};
      const files: Record<string, { filepath: string; originalFilename: string; size: number }[]> = {};

      const parts = str.split('--' + boundary);
      for (const part of parts) {
        if (part === '--\r\n' || part === '--' || part.trim() === '') continue;

        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const header = part.substring(0, headerEnd);
        const body = part.substring(headerEnd + 4, part.endsWith('\r\n') ? part.length - 2 : part.length);

        const nameMatch = header.match(/name="([^"]+)"/);
        const filenameMatch = header.match(/filename="([^"]+)"/);

        if (filenameMatch) {
          // It's a file
          const fieldName = nameMatch?.[1] || 'file';
          const filename = filenameMatch[1];
          const tmpPath = `/tmp/upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;

          // Write binary body
          const binaryBody = Buffer.from(body, 'binary');
          fs.writeFileSync(tmpPath, binaryBody);

          if (!files[fieldName]) files[fieldName] = [];
          files[fieldName].push({
            filepath: tmpPath,
            originalFilename: filename,
            size: binaryBody.length,
          });
        } else if (nameMatch) {
          // It's a field
          fields[nameMatch[1]] = body.trim();
        }
      }

      resolve({ fields, files });
    });
    req.on('error', reject);
  });
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { fields, files } = await parseMultipart(req);

    const destDir = fields.destPath || '/tmp';
    // relativePath is for maintaining directory structure
    const relativePath = fields.relativePath || '';

    const resolvedDest = path.resolve('/', destDir);
    if (!fs.existsSync(resolvedDest)) {
      fs.mkdirSync(resolvedDest, { recursive: true });
    }

    const uploadedFiles: any[] = [];

    // Handle all file fields
    for (const [fieldName, fileArray] of Object.entries(files)) {
      for (const file of fileArray) {
        // Build destination with relative path preserved
        const fileRelativePath = relativePath ? relativePath.replace(/^\//, '') : '';
        const targetDir = fileRelativePath ? path.join(resolvedDest, fileRelativePath) : resolvedDest;

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const destFilePath = path.join(targetDir, file.originalFilename);

        // Copy from tmp to destination
        fs.copyFileSync(file.filepath, destFilePath);
        fs.unlinkSync(file.filepath); // Clean up temp

        const stat = fs.statSync(destFilePath);
        uploadedFiles.push({
          name: file.originalFilename,
          path: destFilePath,
          size: stat.size,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        uploaded: true,
        files: uploadedFiles,
        count: uploadedFiles.length,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
