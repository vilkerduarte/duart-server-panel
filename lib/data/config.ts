import path from 'path';
import { readJson, writeJson, ensureDir } from '../fsx';
import { AiMode, DEFAULT_AI_MODE, normalizeAiMode } from '../ai/modes';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const CONFIG_FILE = path.join(SETTINGS_DIR, 'config.json');

export interface AppConfig {
  serverName: string;
  hostname: string;
  language: string;
  aiApiKey: string;
  aiModel: string;
  /** Endpoint compatível com a API OpenAI. Vazio usa o preset do DeepSeek. */
  aiBaseUrl: string;
  aiProvider: string;
  /** Modo do assistente ao iniciar uma nova conversa. */
  aiDefaultMode: AiMode;
  /**
   * Teto de tokens da resposta do modelo por chamada. Zero mantém o padrão do
   * painel (mais alto quando a IA escreve arquivos inteiros).
   */
  aiMaxTokens: number;
  /**
   * Acesso Total. Ligado, os modos Executar e Gerar deixam de pedir aprovação,
   * escrevem em qualquer caminho e (no Executar) ganham as ferramentas de
   * instalação de pacotes e alteração do próprio painel. A consulta de
   * arquivos e comandos de leitura nunca depende disto: é livre sempre.
   * Desligado por padrão.
   */
  aiFullAccess: boolean;
  theme: 'dark' | 'light';
  port: number;
  domain: string;
  nginxStubStatus: boolean;
  sslAutoRenew: boolean;
  /** Alerta de expiração. O Let's Encrypt recomenda renovar aos 30 dias. */
  sslRenewDaysBefore: number;
  sslContactEmail: string;
  backupRetentionCount: number;
  /** Raízes que o gerenciador de arquivos pode acessar. */
  fileManagerRoots: string[];
  installedAt?: string;
  updatedAt?: string;
  installedModules: {
    mysql: boolean;
    postgresql: boolean;
    mongodb: boolean;
    docker: boolean;
    fail2ban: boolean;
    certbot: boolean;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  serverName: 'Duart Panel',
  hostname: 'localhost',
  language: 'pt-BR',
  aiApiKey: '',
  aiModel: 'deepseek-v4-pro',
  aiBaseUrl: '',
  aiProvider: 'deepseek',
  aiDefaultMode: DEFAULT_AI_MODE,
  aiMaxTokens: 0,
  aiFullAccess: false,
  theme: 'dark',
  port: 0,
  domain: '',
  nginxStubStatus: true,
  sslAutoRenew: true,
  sslRenewDaysBefore: 30,
  sslContactEmail: '',
  backupRetentionCount: 10,
  fileManagerRoots: [],
  installedModules: {
    mysql: false,
    postgresql: false,
    mongodb: false,
    docker: false,
    fail2ban: false,
    certbot: false,
  },
};

/** Limites aceitos para `aiMaxTokens`; fora disso o valor é ajustado. */
export const MIN_AI_MAX_TOKENS = 256;
export const MAX_AI_MAX_TOKENS = 65536;

/** Campos que a UI nunca deve conseguir sobrescrever por PUT genérico. */
const PROTECTED_FIELDS: Array<keyof AppConfig> = ['installedAt', 'port'];

export function readConfig(): AppConfig {
  ensureDir(SETTINGS_DIR);
  const stored = readJson<Partial<AppConfig> & { aiUnrestrictedEnabled?: boolean }>(CONFIG_FILE, {});
  // `aiUnrestrictedEnabled` era o "modo laboratório"; virou o Acesso Total.
  const legacyFullAccess = stored.aiFullAccess === undefined && stored.aiUnrestrictedEnabled === true;
  delete stored.aiUnrestrictedEnabled;
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    aiFullAccess: legacyFullAccess ? true : Boolean(stored.aiFullAccess),
    aiDefaultMode: normalizeAiMode(stored.aiDefaultMode),
    installedModules: { ...DEFAULT_CONFIG.installedModules, ...(stored.installedModules ?? {}) },
  };
}

export function writeConfig(updates: Partial<AppConfig>): AppConfig {
  ensureDir(SETTINGS_DIR);
  const current = readConfig();

  const sanitized: Partial<AppConfig> = { ...updates };
  for (const field of PROTECTED_FIELDS) {
    if (current[field] !== undefined && current[field] !== '' && current[field] !== 0) {
      delete sanitized[field];
    }
  }

  // O campo chega como string do formulário, e um valor absurdo faz a API
  // recusar a chamada inteira — então normaliza aqui, não na borda.
  if (sanitized.aiMaxTokens !== undefined) {
    const parsed = Number(sanitized.aiMaxTokens);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      sanitized.aiMaxTokens = 0;
    } else {
      sanitized.aiMaxTokens = Math.min(Math.max(Math.trunc(parsed), MIN_AI_MAX_TOKENS), MAX_AI_MAX_TOKENS);
    }
  }

  if (sanitized.aiDefaultMode !== undefined) {
    sanitized.aiDefaultMode = normalizeAiMode(sanitized.aiDefaultMode);
  }
  if (sanitized.aiFullAccess !== undefined) {
    sanitized.aiFullAccess = Boolean(sanitized.aiFullAccess);
  }

  // Uma chave mascarada chegando de volta significa "não mexer".
  if (typeof sanitized.aiApiKey === 'string' && sanitized.aiApiKey.includes('•')) {
    delete sanitized.aiApiKey;
  }

  const merged: AppConfig = {
    ...current,
    ...sanitized,
    installedModules: { ...current.installedModules, ...(updates.installedModules ?? {}) },
    updatedAt: new Date().toISOString(),
  };

  writeJson(CONFIG_FILE, merged, 0o640);
  return merged;
}

export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key || '';
  const last4 = key.slice(-4);
  const masked = '•'.repeat(Math.min(key.length - 4, 20));
  return masked + last4;
}
