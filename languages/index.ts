/**
 * Carregadores dos bundles de tradução.
 *
 * Cada `import()` tem o caminho escrito por extenso de propósito: um import
 * dinâmico com `${locale}/${namespace}` no meio funciona no `next dev`, mas o
 * build de produção não resolve o alias por template e nenhum bundle carregava
 * — a interface inteira ficava com as chaves cruas. Com literais, o bundler
 * gera um chunk por arquivo e continua carregando só o idioma em uso.
 */

export const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'monitor',
  'files',
  'tasks',
  'nginx',
  'firewall',
  'docker',
  'databases',
  'security',
  'settings',
  'ai',
  'ssl',
  'cron',
  'backup',
  'logs',
  'network',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

type Bundle = Record<string, unknown>;
type Loader = () => Promise<{ default?: Bundle } & Bundle>;

const LOADERS: Record<string, Record<Namespace, Loader>> = {
  'pt-BR': {
    common: () => import('./pt-BR/common.js'),
    auth: () => import('./pt-BR/auth.js'),
    dashboard: () => import('./pt-BR/dashboard.js'),
    monitor: () => import('./pt-BR/monitor.js'),
    files: () => import('./pt-BR/files.js'),
    tasks: () => import('./pt-BR/tasks.js'),
    nginx: () => import('./pt-BR/nginx.js'),
    firewall: () => import('./pt-BR/firewall.js'),
    docker: () => import('./pt-BR/docker.js'),
    databases: () => import('./pt-BR/databases.js'),
    security: () => import('./pt-BR/security.js'),
    settings: () => import('./pt-BR/settings.js'),
    ai: () => import('./pt-BR/ai.js'),
    ssl: () => import('./pt-BR/ssl.js'),
    cron: () => import('./pt-BR/cron.js'),
    backup: () => import('./pt-BR/backup.js'),
    logs: () => import('./pt-BR/logs.js'),
    network: () => import('./pt-BR/network.js'),
  },
  'en-US': {
    common: () => import('./en-US/common.js'),
    auth: () => import('./en-US/auth.js'),
    dashboard: () => import('./en-US/dashboard.js'),
    monitor: () => import('./en-US/monitor.js'),
    files: () => import('./en-US/files.js'),
    tasks: () => import('./en-US/tasks.js'),
    nginx: () => import('./en-US/nginx.js'),
    firewall: () => import('./en-US/firewall.js'),
    docker: () => import('./en-US/docker.js'),
    databases: () => import('./en-US/databases.js'),
    security: () => import('./en-US/security.js'),
    settings: () => import('./en-US/settings.js'),
    ai: () => import('./en-US/ai.js'),
    ssl: () => import('./en-US/ssl.js'),
    cron: () => import('./en-US/cron.js'),
    backup: () => import('./en-US/backup.js'),
    logs: () => import('./en-US/logs.js'),
    network: () => import('./en-US/network.js'),
  },
  'es-ES': {
    common: () => import('./es-ES/common.js'),
    auth: () => import('./es-ES/auth.js'),
    dashboard: () => import('./es-ES/dashboard.js'),
    monitor: () => import('./es-ES/monitor.js'),
    files: () => import('./es-ES/files.js'),
    tasks: () => import('./es-ES/tasks.js'),
    nginx: () => import('./es-ES/nginx.js'),
    firewall: () => import('./es-ES/firewall.js'),
    docker: () => import('./es-ES/docker.js'),
    databases: () => import('./es-ES/databases.js'),
    security: () => import('./es-ES/security.js'),
    settings: () => import('./es-ES/settings.js'),
    ai: () => import('./es-ES/ai.js'),
    ssl: () => import('./es-ES/ssl.js'),
    cron: () => import('./es-ES/cron.js'),
    backup: () => import('./es-ES/backup.js'),
    logs: () => import('./es-ES/logs.js'),
    network: () => import('./es-ES/network.js'),
  },
};

export async function loadNamespace(locale: string, namespace: Namespace): Promise<Bundle | null> {
  const loader = LOADERS[locale]?.[namespace];
  if (!loader) return null;

  const mod = await loader();
  return (mod.default ?? mod) as Bundle;
}
