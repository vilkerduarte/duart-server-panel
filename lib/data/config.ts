import path from 'path';
import { readJson, writeJson, ensureDir } from '../fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const CONFIG_FILE = path.join(SETTINGS_DIR, 'config.json');

export type AiApprovalMode = 'read' | 'assisted' | 'autonomous';

export interface AppConfig {
  serverName: string;
  hostname: string;
  language: string;
  aiApiKey: string;
  aiModel: string;
  /** Endpoint compatível com a API OpenAI. Vazio usa o preset do DeepSeek. */
  aiBaseUrl: string;
  aiProvider: string;
  /** Modo de aprovação inicial de cada nova conversa. */
  aiDefaultMode: AiApprovalMode;
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
  aiModel: 'deepseek-chat',
  aiBaseUrl: '',
  aiProvider: 'deepseek',
  aiDefaultMode: 'assisted',
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

/** Campos que a UI nunca deve conseguir sobrescrever por PUT genérico. */
const PROTECTED_FIELDS: Array<keyof AppConfig> = ['installedAt', 'port'];

export function readConfig(): AppConfig {
  ensureDir(SETTINGS_DIR);
  const stored = readJson<Partial<AppConfig>>(CONFIG_FILE, {});
  return {
    ...DEFAULT_CONFIG,
    ...stored,
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
