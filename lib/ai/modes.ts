/**
 * Modos do assistente.
 *
 * Cada modo é uma intenção de uso, não um nível de aprovação: o que muda entre
 * eles é quais ferramentas o modelo recebe e como ele deve responder. O quanto
 * a IA pode fazer sem pedir permissão vem de um único interruptor em
 * Configurações — o "Acesso Total" — que amplia os modos capazes de alterar o
 * servidor (Executar e Gerar).
 *
 * Este arquivo não importa nada do Node de propósito: o cliente também o usa.
 */

export const AI_MODES = ['chat', 'analyze', 'execute', 'generate', 'learn'] as const;

export type AiMode = (typeof AI_MODES)[number];

export const DEFAULT_AI_MODE: AiMode = 'chat';

/** Modos que podem alterar o servidor (com aprovação, ou sem ela no Acesso Total). */
export const WRITABLE_MODES: readonly AiMode[] = ['execute', 'generate'];

export function isAiMode(value: unknown): value is AiMode {
  return typeof value === 'string' && (AI_MODES as readonly string[]).includes(value);
}

/**
 * Aceita também os valores do desenho anterior (`read`, `assisted`,
 * `autonomous`, `full`) para que conversas e configurações antigas continuem
 * abrindo: o que antes escrevia no servidor agora é o modo Executar.
 */
export function normalizeAiMode(value: unknown, fallback: AiMode = DEFAULT_AI_MODE): AiMode {
  if (isAiMode(value)) return value;
  switch (value) {
    case 'read': return 'chat';
    case 'assisted':
    case 'autonomous':
    case 'full': return 'execute';
    default: return fallback;
  }
}

export function canWrite(mode: AiMode): boolean {
  return WRITABLE_MODES.includes(mode);
}
