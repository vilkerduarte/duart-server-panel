import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  if (!['mysql', 'postgresql'].includes(type as string)) {
    return res.status(400).json({ success: false, error: 'Apenas MySQL e PostgreSQL suportam console SQL' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return res.status(400).json({ success: false, error: 'SQL é obrigatório' });
    }

    const trimmedSql = sql.trim();

    // Block dangerous commands that could compromise the system
    const dangerousPatterns = [
      /;\s*\\!\s*/i,           // shell escape via \!
      /INTO\s+OUTFILE/i,       // write files
      /INTO\s+DUMPFILE/i,      // write files
      /LOAD_FILE\s*\(/i,       // read files
      /COPY\s+.*\s+(FROM|TO)\s+['"]\/.*PROGRAM/i,  // PostgreSQL PROGRAM
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedSql)) {
        return res.status(400).json({
          success: false,
          error: 'Comando bloqueado por segurança. Operações de leitura/escrita de arquivos do sistema não são permitidas.',
        });
      }
    }

    let cmd: string;
    let timeout: number;

    if (type === 'mysql') {
      // Execute as root via sudo mysql -e
      // Escape single quotes in SQL for bash
      const escaped = trimmedSql.replace(/'/g, "'\\''");
      cmd = `sudo mysql -e '${escaped}' 2>&1`;
      timeout = 30000;
    } else {
      // PostgreSQL - execute as postgres user
      const escaped = trimmedSql.replace(/'/g, "'\\''");
      cmd = `sudo -u postgres psql -c '${escaped}' 2>&1`;
      timeout = 30000;
    }

    const result = await executeRaw(cmd, timeout);

    if (result.code !== 0) {
      const errorMsg = result.stderr || result.stdout || 'Erro desconhecido';
      return res.status(200).json({
        success: false,
        error: errorMsg,
        output: result.stdout || '',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        output: result.stdout || 'Comando executado com sucesso (sem saída).',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
