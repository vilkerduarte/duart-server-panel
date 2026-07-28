import fs from 'fs';
import path from 'path';

// Usar caminho absoluto para evitar que Turbopack resolva symlink data/ -> /var/lib/duart-panel/
const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');
const CONFIG_FILE = path.join(SETTINGS_DIR, 'config.json');

export interface AppConfig {
  serverName: string;
  hostname: string;
  language: string;
  aiApiKey: string;
  aiModel: string;
  theme: 'dark' | 'light';
  port: number;
  domain: string;
  nginxStubStatus: boolean;
  sslAutoRenew: boolean;
  sslRenewDaysBefore: number;
  backupRetentionCount: number;
  installedAt?: string;
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
  theme: 'dark',
  port: 0,
  domain: '',
  nginxStubStatus: true,
  sslAutoRenew: true,
  sslRenewDaysBefore: 5,
  backupRetentionCount: 10,
  installedModules: {
    mysql: false,
    postgresql: false,
    mongodb: false,
    docker: false,
    fail2ban: false,
    certbot: false,
  },
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
}

export function readConfig(): AppConfig {
  ensureDir(SETTINGS_DIR);

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o640 });
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function writeConfig(config: Partial<AppConfig>): AppConfig {
  ensureDir(SETTINGS_DIR);

  const current = readConfig();
  const merged = { ...current, ...config };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o640 });
  return merged;
}

export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key || '';
  const last4 = key.slice(-4);
  const masked = '•'.repeat(Math.min(key.length - 4, 20));
  return masked + last4;
}
