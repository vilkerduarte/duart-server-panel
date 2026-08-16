/**
 * Rede de segurança para operações que podem trancar o operador para fora.
 *
 * Mexer em firewall ou SSH é a única classe de erro realmente cara num painel
 * remoto: quando dá errado, você perde justamente o acesso que usaria para
 * consertar. A proteção correta não é uma lista de regex de comandos proibidos
 * — é agendar a reversão antes de aplicar a mudança, e cancelá-la só depois de
 * o usuário confirmar que ainda tem acesso.
 *
 * Usa timers transitórios do systemd, que existem em qualquer Ubuntu, em vez
 * do `at`, que nem sempre está instalado.
 */

import { execFileSafe, needsSudo } from '../system';

export const ROLLBACK_PREFIX = 'duart-rollback-';

function systemdRun(args: string[]) {
  return needsSudo()
    ? { bin: 'sudo', args: ['-n', 'systemd-run', ...args] }
    : { bin: 'systemd-run', args };
}

function systemctl(args: string[]) {
  return needsSudo()
    ? { bin: 'sudo', args: ['-n', 'systemctl', ...args] }
    : { bin: 'systemctl', args };
}

function unitFor(token: string): string {
  return `${ROLLBACK_PREFIX}${token}`;
}

export function isValidToken(token: string): boolean {
  return /^[a-z0-9-]{4,40}$/.test(token);
}

export interface ArmResult {
  ok: boolean;
  token: string;
  seconds: number;
  error?: string;
}

/**
 * Agenda um comando de reversão para daqui a `seconds`.
 * Retorna o token usado para cancelar quando o usuário confirmar que a mudança
 * ficou boa.
 */
export async function armRollback(
  token: string,
  argv: string[],
  seconds = 300,
): Promise<ArmResult> {
  if (!isValidToken(token)) {
    return { ok: false, token, seconds, error: 'Token inválido' };
  }
  if (!argv.length) {
    return { ok: false, token, seconds, error: 'Comando de reversão vazio' };
  }

  await disarmRollback(token);

  const { bin, args } = systemdRun([
    `--unit=${unitFor(token)}`,
    `--on-active=${seconds}`,
    '--timer-property=AccuracySec=1s',
    '--description=Duart Panel: reversão automática agendada',
    '--collect',
    '--',
    ...argv,
  ]);

  const result = await execFileSafe(bin, args, { timeout: 15000 });

  return {
    ok: result.code === 0,
    token,
    seconds,
    error: result.code === 0 ? undefined : (result.stderr || result.stdout),
  };
}

/** Cancela a reversão agendada — chamado quando o usuário confirma o acesso. */
export async function disarmRollback(token: string): Promise<boolean> {
  if (!isValidToken(token)) return false;

  const unit = unitFor(token);
  const timer = systemctl(['stop', `${unit}.timer`]);
  const service = systemctl(['stop', `${unit}.service`]);

  const results = await Promise.all([
    execFileSafe(timer.bin, timer.args, { timeout: 10000 }),
    execFileSafe(service.bin, service.args, { timeout: 10000 }),
  ]);

  return results.some(r => r.code === 0);
}

export async function listArmedRollbacks(): Promise<string[]> {
  const { bin, args } = systemctl(['list-timers', '--all', '--no-pager', '--plain']);
  const result = await execFileSafe(bin, args, { timeout: 10000 });
  if (result.code !== 0) return [];

  return result.stdout
    .split('\n')
    .map(line => line.match(new RegExp(`${ROLLBACK_PREFIX}([a-z0-9-]+)\\.timer`))?.[1])
    .filter((t): t is string => Boolean(t));
}

/* ------------------------------------------------------------------ */
/*  Classificação de risco de comandos livres                          */
/* ------------------------------------------------------------------ */

/**
 * Operações sem volta. Isto não é um filtro de bloqueio — a lista antiga de
 * regex era contornável com um espaço a mais e ainda barrava comandos
 * legítimos como `chown -R www-data /var/www/site`. Aqui o papel é só decidir
 * se o comando exige aprovação mesmo no modo autônomo.
 */
const IRREVERSIBLE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bmkfs(\.\w+)?\b/, reason: 'formata um sistema de arquivos' },
  { pattern: /\bdd\b[^|]*\bof=\/dev\//, reason: 'escreve direto em dispositivo de bloco' },
  { pattern: /\brm\b[^|;&]*\s-[a-zA-Z]*[rR][a-zA-Z]*f?[a-zA-Z]*\s+\/(\s|$)/, reason: 'remove recursivamente a partir da raiz' },
  { pattern: /\b(shutdown|poweroff|halt|reboot)\b/, reason: 'desliga ou reinicia o servidor' },
  { pattern: /\bufw\b.*\b(disable|reset|deny\s+22|delete)\b/, reason: 'altera o firewall e pode cortar seu acesso' },
  { pattern: /\biptables\b.*\b(-F|--flush|-P\s+INPUT\s+DROP)\b/, reason: 'limpa regras de firewall' },
  { pattern: /\/etc\/ssh\/sshd_config/, reason: 'altera a configuração do SSH' },
  { pattern: /\b(userdel|groupdel)\b/, reason: 'remove usuário ou grupo do sistema' },
  { pattern: /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i, reason: 'apaga dados de banco' },
  { pattern: /\b(certbot|letsencrypt)\b.*\bdelete\b/, reason: 'apaga certificados' },
  { pattern: /\/etc\/(passwd|shadow|sudoers)/, reason: 'altera arquivos de autenticação do sistema' },
  { pattern: /\bchmod\b\s+(-R\s+)?777\s+\//, reason: 'abre permissões da raiz do sistema' },
];

export interface RiskAssessment {
  irreversible: boolean;
  reasons: string[];
}

export function assessCommandRisk(command: string): RiskAssessment {
  const reasons = IRREVERSIBLE_PATTERNS
    .filter(({ pattern }) => pattern.test(command))
    .map(({ reason }) => reason);

  return { irreversible: reasons.length > 0, reasons };
}

/** Comandos que tocam acesso remoto merecem reversão agendada. */
export function needsRollbackGuard(command: string): boolean {
  return /\b(ufw|iptables|nft|sshd?|systemctl\s+(stop|disable|restart)\s+ssh)/.test(command);
}
