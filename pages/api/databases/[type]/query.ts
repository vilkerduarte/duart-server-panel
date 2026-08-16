import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { DbType, DbInputError, assertIdentifier, mysqlExec, psqlExec, friendlyDbError } from '@/lib/db';

/**
 * Console SQL.
 *
 * O SQL do usuário é entregue ao cliente por stdin (MySQL) ou como argumento
 * único de execFile (Postgres). Sem shell, aspas e ponto-e-vírgula no texto não
 * têm efeito fora do banco — a antiga tentativa de escapar aspas para o bash
 * deixava de ser necessária e era, ela mesma, incompleta.
 *
 * O bloqueio abaixo continua fazendo sentido: são as funções que permitem ao
 * processo do banco ler e escrever arquivos do sistema, o que escaparia do
 * escopo de "console SQL".
 */
const FILE_ACCESS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\\!\s*\S/, label: 'escape para shell (\\!)' },
  { pattern: /INTO\s+(OUT|DUMP)FILE/i, label: 'escrita de arquivo (INTO OUTFILE/DUMPFILE)' },
  { pattern: /LOAD_FILE\s*\(/i, label: 'leitura de arquivo (LOAD_FILE)' },
  { pattern: /LOAD\s+DATA\s+(LOCAL\s+)?INFILE/i, label: 'importação de arquivo (LOAD DATA INFILE)' },
  { pattern: /COPY\s+.+\s+(FROM|TO)\s+PROGRAM/i, label: 'execução de programa (COPY … PROGRAM)' },
  { pattern: /pg_read_file|pg_ls_dir|pg_read_binary_file/i, label: 'leitura de arquivo do servidor' },
  { pattern: /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*\bLANGUAGE\s+(c|plsh)\b/i, label: 'função em linguagem nativa' },
];

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const type = req.query.type as DbType;

  if (!['mysql', 'postgresql'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Apenas MySQL e PostgreSQL têm console SQL' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { sql, database } = req.body ?? {};
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    return res.status(400).json({ success: false, error: 'SQL é obrigatório' });
  }

  const statement = sql.trim();
  if (statement.length > 100_000) {
    return res.status(413).json({ success: false, error: 'Consulta longa demais (máx. 100.000 caracteres)' });
  }

  const blocked = FILE_ACCESS_PATTERNS.find(({ pattern }) => pattern.test(statement));
  if (blocked) {
    return res.status(400).json({
      success: false,
      error: `Bloqueado: ${blocked.label}. O console SQL não pode ler nem escrever arquivos do servidor. Use o gerenciador de arquivos ou a importação de dumps.`,
    });
  }

  try {
    const target = database ? assertIdentifier(database, 'Nome do banco') : undefined;

    const result = type === 'mysql'
      ? await mysqlExec(statement, { database: target, timeout: 60000, tabular: true })
      : await psqlExec(statement, { database: target, timeout: 60000, tabular: true });

    if (result.code !== 0) {
      return res.status(200).json({
        success: false,
        error: friendlyDbError(type, result.stderr || result.stdout),
        output: result.stdout || '',
      });
    }

    return res.status(200).json({
      success: true,
      data: { output: result.stdout || 'Comando executado com sucesso (sem saída).' },
    });
  } catch (err: any) {
    if (err instanceof DbInputError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
