import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const installed = await checkInstalled('fail2ban');

    if (!installed) {
      return res.status(200).json({
        success: true,
        data: { installed: false, running: false, jails: [] },
      });
    }

    // Check if running
    const statusResult = await executeCommand('systemctl_status', ['fail2ban']);
    const running = statusResult.code === 0;

    // Get jails
    let jails: any[] = [];
    try {
      const jailResult = await executeRaw('sudo fail2ban-client status', 5000);
      const lines = jailResult.stdout.split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^`-\s+(\w+)/);
        if (match) {
          // Get details for each jail
          try {
            const detailResult = await executeRaw(`sudo fail2ban-client status ${match[1]}`, 5000);
            const detailLines = detailResult.stdout.split('\n');
            const bannedMatch = detailLines.find(l => l.includes('Currently banned:'))?.match(/(\d+)/);
            const foundMatch = detailLines.find(l => l.includes('Total failed:'))?.match(/(\d+)/);
            jails.push({
              name: match[1],
              enabled: true,
              banned: bannedMatch ? parseInt(bannedMatch[1]) : 0,
              found: foundMatch ? parseInt(foundMatch[1]) : 0,
            });
          } catch {
            jails.push({ name: match[1], enabled: true, banned: 0, found: 0 });
          }
        }
      }
    } catch {}

    return res.status(200).json({
      success: true,
      data: { installed: true, running, jails },
    });
  } catch (err: any) {
    return res.status(200).json({
      success: true,
      data: { installed: false, running: false, jails: [] },
    });
  }
});

async function checkInstalled(name: string): Promise<boolean> {
  try {
    const result = await executeRaw(`which ${name}`, 5000);
    return result.code === 0 && result.stdout.length > 0;
  } catch {
    return false;
  }
}
