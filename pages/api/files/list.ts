import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import fs from 'fs';
import path from 'path';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const dirPath = (req.query.path as string) || '/';
    const showHidden = req.query.showHidden === 'true';

    // Security: resolve and validate path
    const resolvedPath = path.resolve('/', dirPath);

    // Check if exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Diretório não encontrado' });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'O caminho não é um diretório' });
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const items = entries
      .filter(entry => showHidden || !entry.name.startsWith('.'))
      .map(entry => {
        const fullPath = path.join(resolvedPath, entry.name);
        let entryStat;
        try {
          entryStat = fs.statSync(fullPath);
        } catch {
          return null;
        }

        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: entryStat.size,
          permissions: getPermissionsString(entryStat.mode),
          owner: entryStat.uid.toString(),
          group: entryStat.gid.toString(),
          modifiedAt: entryStat.mtime.toISOString(),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return res.status(200).json({
      success: true,
      data: {
        currentPath: resolvedPath,
        parentPath: resolvedPath === '/' ? null : path.dirname(resolvedPath),
        items,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function getPermissionsString(mode: number): string {
  const type = '----------';
  const chars = type.split('');
  if (mode & 0o40000) chars[0] = 'd';
  if (mode & 0o400) chars[1] = 'r';
  if (mode & 0o200) chars[2] = 'w';
  if (mode & 0o100) chars[3] = 'x';
  if (mode & 0o40) chars[4] = 'r';
  if (mode & 0o20) chars[5] = 'w';
  if (mode & 0o10) chars[6] = 'x';
  if (mode & 0o4) chars[7] = 'r';
  if (mode & 0o2) chars[8] = 'w';
  if (mode & 0o1) chars[9] = 'x';
  return chars.join('');
}
