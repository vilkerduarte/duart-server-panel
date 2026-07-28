import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const SSH_CONFIG_PATH = '/etc/ssh/sshd_config';
const ALLOWED_KEYS = ['Port', 'PermitRootLogin', 'PasswordAuthentication', 'PubkeyAuthentication'];

function parseConfig(content: string): Record<string, string> {
  const lines = content.split('\n');
  const config: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        config[parts[0]] = parts.slice(1).join(' ');
      }
    }
  }

  return config;
}

function updateConfig(content: string, updates: Record<string, string>): string {
  const lines = content.split('\n');
  const updatedKeys = new Set(Object.keys(updates));

  const result = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2 && updatedKeys.has(parts[0])) {
        return `${parts[0]} ${updates[parts[0]]}`;
      }
    }
    return line;
  });

  // If key doesn't exist in config, append it
  for (const [key, value] of Object.entries(updates)) {
    if (!content.includes(key)) {
      result.push(`${key} ${value}`);
    }
  }

  return result.join('\n');
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    // GET - Read SSH config
    if (req.method === 'GET') {
      if (!fs.existsSync(SSH_CONFIG_PATH)) {
        return res.status(200).json({ success: true, data: {} });
      }

      const content = fs.readFileSync(SSH_CONFIG_PATH, 'utf-8');
      const config = parseConfig(content);

      return res.status(200).json({ success: true, data: config });
    }

    // PUT - Update SSH config
    if (req.method === 'PUT') {
      const updates: Record<string, string> = {};

      // Only allow known keys
      for (const key of ALLOWED_KEYS) {
        if (req.body[key] !== undefined) {
          const value = String(req.body[key]).trim();
          if (!value) continue;

          // Validate values
          if (key === 'Port') {
            const port = parseInt(value);
            if (isNaN(port) || port < 1 || port > 65535) {
              return res.status(400).json({ success: false, error: 'Porta inválida (1-65535)' });
            }
          }
          if (key === 'PermitRootLogin' && !['yes', 'no', 'prohibit-password', 'without-password'].includes(value)) {
            return res.status(400).json({ success: false, error: 'PermitRootLogin inválido' });
          }
          if (key === 'PasswordAuthentication' && !['yes', 'no'].includes(value)) {
            return res.status(400).json({ success: false, error: 'PasswordAuthentication inválido' });
          }
          if (key === 'PubkeyAuthentication' && !['yes', 'no'].includes(value)) {
            return res.status(400).json({ success: false, error: 'PubkeyAuthentication inválido' });
          }

          updates[key] = value;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhuma configuração válida fornecida' });
      }

      // Read current config
      if (!fs.existsSync(SSH_CONFIG_PATH)) {
        return res.status(404).json({ success: false, error: 'Arquivo sshd_config não encontrado' });
      }

      // Backup original
      const backupPath = `${SSH_CONFIG_PATH}.duart-backup`;
      const originalContent = fs.readFileSync(SSH_CONFIG_PATH, 'utf-8');
      fs.writeFileSync(backupPath, originalContent);

      // Apply updates
      const newContent = updateConfig(originalContent, updates);
      fs.writeFileSync(SSH_CONFIG_PATH, newContent);

      // Validate with sshd -t
      const testResult = await executeRaw('sshd -t 2>&1', 10000);

      if (testResult.code !== 0) {
        // Rollback
        fs.writeFileSync(SSH_CONFIG_PATH, originalContent);
        fs.unlinkSync(backupPath);
        return res.status(400).json({
          success: false,
          error: 'Configuração SSH inválida: ' + (testResult.stderr || testResult.stdout),
        });
      }

      // Reload SSH
      await executeRaw('systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true', 10000);

      // Remove backup on success
      fs.unlinkSync(backupPath);

      return res.status(200).json({ success: true, data: { updated: true, config: parseConfig(newContent) } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
