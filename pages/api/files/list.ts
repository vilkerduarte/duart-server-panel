import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath, listAccessibleRoots } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const roots = configuredRoots();
    const requested = (req.query.path as string) || '';

    // Sem caminho, a navegação começa nas raízes permitidas em vez de em /.
    if (!requested || requested === '/') {
      return res.status(200).json({
        success: true,
        data: {
          currentPath: '/',
          parentPath: null,
          isRootListing: true,
          items: listAccessibleRoots(roots).map(root => ({
            name: root,
            path: root,
            type: 'directory' as const,
            size: 0,
            permissions: 'drwxr-xr-x',
            owner: '0',
            group: '0',
            modifiedAt: new Date().toISOString(),
          })),
        },
      });
    }

    const resolved = resolveSafePath(requested, { allowedRoots: roots });
    const showHidden = req.query.showHidden === 'true';

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'O caminho não é um diretório' });
    }

    interface Entry {
      name: string;
      /** Caminho absoluto: a navegação usa este campo, não concatenação. */
      path: string;
      type: 'directory' | 'symlink' | 'file';
      size: number;
      permissions: string;
      owner: string;
      group: string;
      modifiedAt: string;
    }

    const items: Entry[] = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(entry => showHidden || !entry.name.startsWith('.'))
      .map(entry => {
        const fullPath = path.join(resolved, entry.name);
        let entryStat;
        try {
          entryStat = fs.lstatSync(fullPath);
        } catch {
          return null;
        }
        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: entryStat.size,
          permissions: permissionsString(entryStat.mode),
          owner: String(entryStat.uid),
          group: String(entryStat.gid),
          modifiedAt: entryStat.mtime.toISOString(),
        };
      })
      .filter((entry): entry is Entry => entry !== null)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // O pai só é oferecido quando ele também está dentro da jaula.
    const parent = path.dirname(resolved);
    let parentPath: string | null = null;
    try {
      resolveSafePath(parent, { allowedRoots: roots });
      parentPath = parent === resolved ? null : parent;
    } catch {
      parentPath = '/';
    }

    return res.status(200).json({
      success: true,
      data: { currentPath: resolved, parentPath, isRootListing: false, items },
    });
  } catch (err) {
    return respondWithError(res, err);
  }
});

function permissionsString(mode: number): string {
  const chars = '----------'.split('');
  if (mode & 0o40000) chars[0] = 'd';
  if (mode & 0o120000) chars[0] = 'l';
  const bits = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1];
  const letters = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x'];
  bits.forEach((bit, index) => {
    if (mode & bit) chars[index + 1] = letters[index];
  });
  return chars.join('');
}
