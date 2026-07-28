import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

// Max file size for reading: 5MB
const MAX_READ_SIZE = 5 * 1024 * 1024;

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.json', '.xml', '.yml', '.yaml', '.md', '.csv',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.html', '.htm',
  '.conf', '.cfg', '.ini', '.env', '.sh', '.bash', '.zsh',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp',
  '.sql', '.graphql', '.vue', '.svelte',
]);

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const filePath = (req.query.path as string) || '';
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Caminho é obrigatório' });
    }

    const resolvedPath = path.resolve('/', filePath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'O caminho é um diretório' });
    }

    // Check file size
    if (stat.size > MAX_READ_SIZE) {
      return res.status(400).json({ success: false, error: 'Arquivo muito grande (máx. 5MB)' });
    }

    // Check if it's a text file
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      return res.status(400).json({ success: false, error: 'Tipo de arquivo não suportado para leitura' });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');

    return res.status(200).json({
      success: true,
      data: {
        path: resolvedPath,
        content,
        size: stat.size,
        encoding: 'utf-8',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
