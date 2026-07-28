import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';
import { IncomingForm } from 'formidable';

export const config = { api: { bodyParser: false } };

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const form = new IncomingForm({ uploadDir: '/tmp', keepExtensions: true, maxFileSize: 100 * 1024 * 1024 });

    const [fields, files] = await new Promise<[any, any]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const destPath = (fields.path as string) || '/tmp';
    const uploadedFile = files.file?.[0] || files.file;

    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }

    const resolvedDest = path.resolve('/', destPath);
    const destFilePath = path.join(resolvedDest, uploadedFile.originalFilename || 'uploaded-file');

    fs.copyFileSync(uploadedFile.filepath, destFilePath);
    fs.unlinkSync(uploadedFile.filepath);

    const stat = fs.statSync(destFilePath);
    return res.status(200).json({ success: true, data: { uploaded: true, path: destFilePath, size: stat.size } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
