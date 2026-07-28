import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const sort = (req.query.sort as string) || 'cpu';
    const limit = parseInt((req.query.limit as string) || '50');
    const search = (req.query.search as string) || '';

    const result = await executeCommand('process_list');
    const lines = result.stdout.split('\n');

    // Skip header line
    const processes = lines.slice(1).filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) return null;

      return {
        pid: parseInt(parts[1]) || 0,
        user: parts[0],
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        vsz: parts[4],
        rss: parts[5],
        tty: parts[6],
        state: parts[7],
        start: parts[8],
        time: parts[9],
        command: parts.slice(10).join(' '),
      };
    }).filter(Boolean) as any[];

    // Filter by search
    let filtered = processes;
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = processes.filter(p =>
        p.command.toLowerCase().includes(searchLower) ||
        p.user.toLowerCase().includes(searchLower) ||
        String(p.pid).includes(searchLower)
      );
    }

    // Sort
    if (sort === 'cpu') filtered.sort((a: any, b: any) => b.cpu - a.cpu);
    else if (sort === 'mem') filtered.sort((a: any, b: any) => b.mem - a.mem);
    else if (sort === 'pid') filtered.sort((a: any, b: any) => a.pid - b.pid);

    // Limit
    const limited = filtered.slice(0, limit);

    return res.status(200).json({ success: true, data: limited });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
