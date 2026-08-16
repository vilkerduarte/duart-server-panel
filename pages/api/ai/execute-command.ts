import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';
import { assessCommandRisk, needsRollbackGuard, armRollback } from '@/lib/ai/safety';
import { appendJournal } from '@/lib/ai/journal';

/**
 * Execução avulsa de comando, com aprovação explícita do usuário.
 *
 * A versão anterior era protegida por seis regex (`rm -rf /`, `mkfs`, `dd if=`,
 * `chown -R`…). Elas eram contornáveis com um espaço a mais e ao mesmo tempo
 * barravam operações legítimas — `chown -R www-data:www-data /var/www/site` é o
 * comando mais normal do mundo ao criar um site PHP.
 *
 * Aqui a análise de risco não bloqueia: ela informa. O que protege de verdade é
 * o usuário ver o comando exato antes de aprovar, o registro em journal, e a
 * reversão agendada quando o comando toca acesso remoto.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { command, approved, sessionId, acknowledgeRisk } = req.body ?? {};

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ success: false, error: 'Comando é obrigatório' });
  }
  if (!approved) {
    return res.status(403).json({ success: false, error: 'Comando não aprovado pelo usuário' });
  }

  const risk = assessCommandRisk(command);

  // Irreversível exige um segundo "sim" — e o motivo aparece na tela.
  if (risk.irreversible && !acknowledgeRisk) {
    return res.status(409).json({
      success: false,
      error: 'Este comando é irreversível e precisa de confirmação adicional.',
      data: { requiresAcknowledgement: true, reasons: risk.reasons },
    });
  }

  const startedAt = Date.now();
  let rollbackToken: string | null = null;

  if (needsRollbackGuard(command)) {
    rollbackToken = `cmd-${Date.now().toString(36)}`;
    await armRollback(rollbackToken, ['ufw', 'allow', '22/tcp'], 300);
  }

  try {
    const result = await executeRaw(command, 60000);
    const duration = Date.now() - startedAt;

    appendJournal({
      sessionId: typeof sessionId === 'string' ? sessionId : 'avulso',
      user: req.user?.username ?? 'desconhecido',
      mode: 'manual',
      tool: 'execute-command',
      args: { command },
      outcome: result.code === 0 ? 'ok' : 'error',
      durationMs: duration,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      rollbackHint: rollbackToken ? `Reversão de rede agendada (token ${rollbackToken})` : undefined,
    });

    return res.status(200).json({
      success: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        duration,
        rollbackToken,
        riskReasons: risk.reasons,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});
