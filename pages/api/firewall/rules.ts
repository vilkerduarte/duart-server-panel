import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      const result = await executeCommand('ufw_status');
      const lines = result.stdout.split('\n');

      let status = 'inactive';
      let defaultIncoming = 'deny';
      let defaultOutgoing = 'allow';
      const rules: any[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Status:')) {
          status = trimmed.includes('active') ? 'active' : 'inactive';
        }
        if (trimmed.startsWith('Default:')) {
          const parts = trimmed.split(/\s+/);
          if (parts[1] === 'deny' || parts[1] === 'allow' || parts[1] === 'reject') {
            if (trimmed.includes('incoming')) defaultIncoming = parts[1];
            if (trimmed.includes('outgoing')) defaultOutgoing = parts[1];
          }
        }
        // Parse rules
        const ruleMatch = trimmed.match(/^(\[?\d+\]?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(.+)$/i);
        if (ruleMatch) {
          rules.push({
            number: ruleMatch[1].replace(/[\[\]]/g, ''),
            action: ruleMatch[2].toLowerCase(),
            details: ruleMatch[3],
          });
        }
      }

      return res.status(200).json({
        success: true,
        data: { status, defaultIncoming, defaultOutgoing, rules },
      });
    }

    if (req.method === 'POST') {
      const { action, port, from, proto } = req.body;

      if (!action || !port) {
        return res.status(400).json({ success: false, error: 'Ação e porta são obrigatórios' });
      }

      const args = [action];
      if (from && from !== 'any') args.push('from', from);
      args.push(proto ? `${port}/${proto}` : port);

      // Execute with sudo
      const cmd = `sudo ufw ${args.join(' ')}`;
      const { exec } = require('child_process');
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        exec(cmd, { timeout: 10000 }, (error: any, stdout: string, stderr: string) => {
          resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim(), code: error?.code || 0 });
        });
      });

      if (result.code !== 0) {
        return res.status(400).json({ success: false, error: result.stderr || 'Erro ao adicionar regra' });
      }

      return res.status(200).json({ success: true, data: { added: true } });
    }

    if (req.method === 'DELETE') {
      const { ruleNumber } = req.body;

      if (!ruleNumber) {
        return res.status(400).json({ success: false, error: 'Número da regra é obrigatório' });
      }

      const result = await executeCommand('ufw_delete', [String(ruleNumber)]);

      if (result.code !== 0) {
        return res.status(400).json({ success: false, error: result.stderr || 'Erro ao remover regra' });
      }

      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
