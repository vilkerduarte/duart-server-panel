/**
 * Ferramentas que a IA pode executar no servidor.
 *
 * O desenho anterior era: o modelo escrevia um bloco ```command, o cliente
 * extraía com regex (só o último de cada resposta), mostrava um modal, e o
 * resultado da execução ia para a tela — nunca de volta para o modelo. Sem esse
 * retorno não existe tarefa complexa, porque toda tarefa administrativa real é
 * ver → decidir → agir → verificar.
 *
 * Aqui cada capacidade é uma ferramenta tipada com nível de risco declarado. O
 * risco decide quando parar para pedir aprovação; ele não bloqueia nada por
 * conta própria. A proteção contra o irreversível vem de mecanismo (rollback do
 * nginx, reversão agendada de firewall/SSH) e de visibilidade (diff antes de
 * gravar), não de uma lista de comandos proibidos.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSafe, executeCommand, executeRaw } from '../system';
import { resolveSafePath, PathAccessError } from '../paths';
import { unifiedDiff, describeDiff } from '../diff';
import { readConfig } from '../data/config';
import {
  getSiteByDomain, createSite, updateSite, deleteSite,
  setMaintenance, toggleSite, scanVhosts, readRawConfig, renderSiteConfig,
  attachCertificate, SiteError, ManagedSite,
} from '../sites';
import { nginxTest } from '../nginx-ops';
import { readCertMetadata, listCertbotLineages, issueCertificate, getCertStatus, daysUntil } from '../ssl';
import { detectPhpVersions, installPhp, diagnosePhpSite, readSlowLog, poolSocketPath, preferredPhpVersion } from '../php';
import { readApps, appStatus, appLogs, restartApp, reloadApp, detectPythonVersions } from '../python';
import { assessCommandRisk, needsRollbackGuard, armRollback, disarmRollback } from './safety';
import { applySelfUpdate, listSnapshots, restoreSnapshot, snapshotPanel, projectRoot } from './selfupdate';
import type { ApprovalMode } from './sessions';

export type ToolRisk = 'read' | 'write' | 'irreversible';

/**
 * Argumentos de ferramenta vêm do modelo como JSON arbitrário: o schema é
 * validado pelo provedor, mas o tipo em tempo de compilação é genuinamente
 * dinâmico. Cada ferramenta valida o que usa.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolArgs = Record<string, any>;

export interface ToolContext {
  user: string;
  sessionId: string;
  mode: ApprovalMode;
  /**
   * Modo laboratório: sem jaula de caminho, sem aprovação, timeouts longos.
   * Só é ligado quando o operador habilita explicitamente na configuração.
   */
  unrestricted?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Vai serializado de volta para o modelo. Mantenha compacto. */
  data?: unknown;
  error?: string;
  /** Guardado no journal, não enviado ao modelo. */
  diff?: string;
  rollbackHint?: string;
}

export interface ToolPreview {
  type: 'command' | 'diff' | 'text';
  content: string;
  summary: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
  preview?: (args: ToolArgs) => Promise<ToolPreview>;
  execute: (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>;
}

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, error });

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/* ------------------------------------------------------------------ */
/*  Ferramentas de leitura                                             */
/* ------------------------------------------------------------------ */

const readTools: ToolDefinition[] = [
  {
    name: 'system_overview',
    description: 'Estado geral do servidor: CPU, memória, disco, carga, uptime e sistema operacional.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const [statA] = await Promise.all([executeCommand('cpu_info')]);
      await new Promise(r => setTimeout(r, 200));
      const statB = await executeCommand('cpu_info');

      const cpuPercent = cpuDelta(statA.stdout, statB.stdout);

      const mem = await executeCommand('mem_info');
      const memValues = parseMeminfo(mem.stdout);
      const total = memValues.MemTotal ?? 0;
      const available = memValues.MemAvailable ?? ((memValues.MemFree ?? 0) + (memValues.Cached ?? 0));

      const disk = await executeCommand('disk_info');
      const load = await executeCommand('load_info');
      const osRelease = await executeRaw('cat /etc/os-release', 3000);

      return ok({
        cpu: { percent: cpuPercent, cores: os.cpus().length, model: os.cpus()[0]?.model },
        memory: {
          totalMb: Math.round(total / 1024 / 1024),
          usedMb: Math.round((total - available) / 1024 / 1024),
          percent: total ? Math.round(((total - available) / total) * 100) : 0,
        },
        disk: disk.stdout.split('\n').slice(1, 12),
        load: load.stdout.split(/\s+/).slice(0, 3),
        uptimeHours: Math.round(os.uptime() / 3600),
        kernel: os.release(),
        distro: osRelease.stdout.match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? 'Linux',
        hostname: os.hostname(),
      });
    },
  },

  {
    name: 'list_sites',
    description: 'Lista os sites NGINX gerenciados pelo painel e os vhosts externos encontrados no disco.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const { managed, external } = scanVhosts();
      return ok({
        managed: managed.map(s => ({
          id: s.id, domain: s.domain, type: s.type, enabled: s.enabled,
          ssl: s.ssl, maintenance: s.maintenance, root: s.root,
          phpVersion: s.phpVersion, proxyPort: s.proxyPort, aliases: s.aliases,
        })),
        external: external.map(v => ({
          file: v.fileName, domains: v.domains, type: v.detectedType,
          enabled: v.enabled, ssl: v.ssl, root: v.root,
        })),
      });
    },
  },

  {
    name: 'read_site_config',
    description: 'Lê a configuração NGINX completa de um site gerenciado.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Domínio do site' } },
      required: ['domain'],
      additionalProperties: false,
    },
    async execute(args) {
      const site = getSiteByDomain(str(args.domain));
      if (!site) return fail(`Site não encontrado: ${args.domain}`);
      return ok({ domain: site.domain, configPath: site.configPath, config: readRawConfig(site.id) });
    },
  },

  {
    name: 'nginx_test',
    description: 'Executa nginx -t e devolve o resultado da validação de sintaxe.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const result = await nginxTest();
      return ok({ valid: result.ok, output: result.output });
    },
  },

  {
    name: 'list_certificates',
    description: 'Lista os certificados TLS com validade real lida do disco e dias restantes.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const lineages = await listCertbotLineages();
      const certs = await Promise.all(
        lineages.map(async l => {
          const meta = await readCertMetadata(l.certPath);
          return {
            name: l.name,
            domains: l.domains,
            certPath: l.certPath,
            validUntil: meta?.validUntil ?? l.expiryDate,
            daysRemaining: meta ? meta.daysRemaining : (l.expiryDate ? daysUntil(l.expiryDate) : null),
            status: getCertStatus(meta?.validUntil ?? l.expiryDate),
            issuer: meta?.issuer,
          };
        }),
      );
      return ok({ certificates: certs });
    },
  },

  {
    name: 'list_php_versions',
    description: 'Versões de PHP instaladas, quais têm FPM ativo e qual é a padrão da CLI.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const versions = await detectPhpVersions();
      return ok({
        versions: versions.map(v => ({
          version: v.version, fpmInstalled: v.fpmInstalled, fpmActive: v.fpmActive,
          isCliDefault: v.isCliDefault, socket: v.defaultSocket,
          extensionCount: v.extensions.length,
        })),
        preferred: await preferredPhpVersion(),
      });
    },
  },

  {
    name: 'list_python_apps',
    description: 'Aplicações Python gerenciadas pelo painel, com estado do serviço systemd.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const apps = readApps();
      const withStatus = await Promise.all(
        apps.map(async app => ({
          name: app.name, directory: app.directory, module: app.module,
          framework: app.framework, workers: app.workers,
          status: await appStatus(app),
        })),
      );
      return ok({ apps: withStatus, pythonVersions: await detectPythonVersions() });
    },
  },

  {
    name: 'list_directory',
    description: 'Lista o conteúdo de um diretório permitido.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, showHidden: { type: 'boolean' } },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      try {
        const target = resolvePath(str(args.path), ctx);
        const entries = fs.readdirSync(target, { withFileTypes: true })
          .filter(e => args.showHidden || !e.name.startsWith('.'))
          .slice(0, 500)
          .map(e => {
            let size = 0;
            try { size = fs.statSync(path.join(target, e.name)).size; } catch {}
            return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size };
          });
        return ok({ path: target, entries });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'read_file',
    description: 'Lê um arquivo de texto dentro dos diretórios permitidos.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        maxLines: { type: 'number', description: 'Padrão 400' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      try {
        const target = resolvePath(str(args.path), ctx);
        const stat = fs.statSync(target);
        if (stat.isDirectory()) return fail('O caminho é um diretório');
        if (stat.size > 5 * 1024 * 1024) return fail('Arquivo maior que 5MB');

        const maxLines = int(args.maxLines, 400);
        const lines = fs.readFileSync(target, 'utf-8').split('\n');
        const truncated = lines.length > maxLines;

        return ok({
          path: target,
          content: lines.slice(0, maxLines).join('\n'),
          totalLines: lines.length,
          truncated,
        });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'read_log',
    description: 'Lê as últimas linhas de um log do sistema, do NGINX, do painel ou de uma unit do systemd.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'nginx-error, nginx-access, panel, ufw, fail2ban, ssl-renewal, journal, php-slow',
        },
        unit: { type: 'string', description: 'Unit do systemd quando source=journal' },
        domain: { type: 'string', description: 'Domínio, para logs por site' },
        lines: { type: 'number' },
        filter: { type: 'string', description: 'Só devolve linhas contendo este texto' },
      },
      required: ['source'],
      additionalProperties: false,
    },
    async execute(args) {
      const lines = Math.min(int(args.lines, 200), 2000);
      const source = str(args.source);
      let content = '';

      if (source === 'journal') {
        const unit = str(args.unit);
        if (!/^[a-zA-Z0-9_.@-]+$/.test(unit)) return fail('Unit inválida');
        const result = await executeCommand('journalctl', ['-u', unit, '-n', String(lines)]);
        content = result.stdout || result.stderr;
      } else if (source === 'php-slow') {
        content = readSlowLog(str(args.domain), lines);
      } else {
        const file = logPathFor(source, str(args.domain));
        if (!file) return fail(`Fonte de log desconhecida: ${source}`);
        content = await tailFile(file, lines);
      }

      const filter = str(args.filter);
      if (filter) {
        content = content.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase())).join('\n');
      }

      return ok({ source, lines: content.split('\n').slice(-lines).join('\n') });
    },
  },

  {
    name: 'service_status',
    description: 'Estado de um serviço do systemd (ativo, habilitado) e as últimas linhas do journal.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { unit: { type: 'string' } },
      required: ['unit'],
      additionalProperties: false,
    },
    async execute(args) {
      const unit = str(args.unit);
      if (!/^[a-zA-Z0-9_.@-]+$/.test(unit)) return fail('Unit inválida');

      const [active, enabled, logs] = await Promise.all([
        executeCommand('systemctl_is_active', [unit]),
        executeCommand('systemctl_is_enabled', [unit]),
        executeCommand('journalctl', ['-u', unit, '-n', '30']),
      ]);

      return ok({
        unit,
        active: active.stdout.trim(),
        enabled: enabled.stdout.trim(),
        recentLogs: logs.stdout.split('\n').slice(-30).join('\n'),
      });
    },
  },

  {
    name: 'list_processes',
    description: 'Processos ordenados por consumo de CPU.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number' } },
      additionalProperties: false,
    },
    async execute(args) {
      const result = await executeCommand('process_list');
      const limit = Math.min(int(args.limit, 20), 100);
      return ok({ processes: result.stdout.split('\n').slice(0, limit + 1) });
    },
  },

  {
    name: 'list_ports',
    description: 'Portas em escuta e os processos que as ocupam.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const result = await executeCommand('listening_ports');
      return ok({ ports: result.stdout.split('\n').slice(0, 100) });
    },
  },

  {
    name: 'firewall_status',
    description: 'Regras e estado atual do UFW.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const result = await executeCommand('ufw_status');
      return ok({ status: result.stdout });
    },
  },

  {
    name: 'diagnose_site',
    description:
      'Playbook de diagnóstico de um site: verifica vhost, certificado, PHP-FPM, socket, root e erros recentes. ' +
      'Use isto antes de sugerir correções para 502, 404 ou erro de SSL.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
      additionalProperties: false,
    },
    async execute(args) {
      const domain = str(args.domain);
      const site = getSiteByDomain(domain);
      if (!site) return fail(`Site não gerenciado pelo painel: ${domain}`);

      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

      const configExists = fs.existsSync(site.configPath);
      checks.push({ name: 'Arquivo de vhost', ok: configExists, detail: site.configPath });
      checks.push({ name: 'Site habilitado', ok: site.enabled, detail: site.enabled ? 'symlink presente' : 'sem symlink em sites-enabled' });

      const test = await nginxTest();
      checks.push({ name: 'nginx -t', ok: test.ok, detail: test.output.substring(0, 300) || 'sintaxe válida' });

      if (site.root) {
        checks.push({ name: 'Diretório raiz', ok: fs.existsSync(site.root), detail: site.root });
      }

      if (site.ssl && site.sslCertPath) {
        const meta = await readCertMetadata(site.sslCertPath);
        checks.push({
          name: 'Certificado TLS',
          ok: Boolean(meta && meta.daysRemaining > 0),
          detail: meta ? `expira em ${meta.daysRemaining} dias (${meta.issuer})` : 'não foi possível ler o certificado',
        });
        if (meta && !meta.domains.some(d => d === domain || d === `*.${domain.split('.').slice(1).join('.')}`)) {
          checks.push({ name: 'Domínio no certificado', ok: false, detail: `certificado cobre ${meta.domains.join(', ')}` });
        }
      }

      let php = null;
      if (site.type === 'php') {
        const socket = site.phpSocket || poolSocketPath(site.domain);
        php = await diagnosePhpSite(site.phpVersion || '8.4', socket, site.root || '');
        for (const check of php.checks) checks.push(check);
      }

      const errorLog = await tailFile(`/var/log/nginx/${domain}.error.log`, 30);

      return ok({
        domain,
        type: site.type,
        healthy: checks.every(c => c.ok),
        checks,
        recentErrors: errorLog.split('\n').filter(Boolean).slice(-15),
      });
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Ferramentas de escrita                                             */
/* ------------------------------------------------------------------ */

const writeTools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Grava conteúdo num arquivo dentro dos diretórios permitidos. Mostra o diff antes de aplicar.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async preview(args) {
      const target = path.resolve('/', str(args.path));
      const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
      const diff = unifiedDiff(before, str(args.content), { fromLabel: target, toLabel: `${target} (novo)` });

      return {
        type: 'diff',
        content: diff.identical ? '(sem alterações)' : diff.text,
        summary: `${fs.existsSync(target) ? 'Alterar' : 'Criar'} ${target} (${describeDiff(diff)})`,
      };
    },
    async execute(args, ctx) {
      try {
        const target = resolvePath(str(args.path), ctx);
        const content = str(args.content);
        const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');

        const diff = unifiedDiff(before, content, { fromLabel: target, toLabel: target });
        return {
          ok: true,
          data: { path: target, bytes: Buffer.byteLength(content), changes: describeDiff(diff) },
          diff: diff.text,
          rollbackHint: before ? 'Conteúdo anterior preservado no journal' : `rm ${target}`,
        };
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'create_site',
    description:
      'Cria um site NGINX. Para type=php o painel cria automaticamente usuário do sistema, pool FPM dedicado e diretório raiz.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        type: { type: 'string', enum: ['static', 'php', 'proxy', 'python', 'node'] },
        root: { type: 'string' },
        proxyPort: { type: 'number' },
        phpVersion: { type: 'string' },
        phpPreset: { type: 'string', enum: ['padrao', 'wordpress', 'laravel', 'upload_pesado'] },
        aliases: { type: 'array', items: { type: 'string' } },
        websocket: { type: 'boolean' },
        clientMaxBodySize: { type: 'string' },
      },
      required: ['domain', 'type'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'text',
        content:
          `Domínio: ${args.domain}\nTipo: ${args.type}\n` +
          `Raiz: ${args.root ?? `/var/www/${args.domain}`}\n` +
          (args.proxyPort ? `Porta do upstream: ${args.proxyPort}\n` : '') +
          (args.type === 'php' ? `PHP: ${args.phpVersion ?? 'versão detectada'} · pool dedicado\n` : '') +
          (args.aliases?.length ? `Aliases: ${args.aliases.join(', ')}\n` : ''),
        summary: `Criar site ${args.domain} (${args.type})`,
      };
    },
    async execute(args) {
      try {
        const site = await createSite({
          domain: str(args.domain),
          type: args.type,
          root: args.root,
          proxyPort: args.proxyPort,
          phpVersion: args.phpVersion,
          phpPreset: args.phpPreset,
          aliases: args.aliases,
          websocket: args.websocket,
          clientMaxBodySize: args.clientMaxBodySize,
        });
        return {
          ok: true,
          data: { id: site.id, domain: site.domain, configPath: site.configPath, phpSocket: site.phpSocket },
          rollbackHint: `remove_site com domain=${site.domain}`,
        };
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'update_site',
    description: 'Altera um site existente. Se o NGINX rejeitar a configuração, ela é revertida automaticamente.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        changes: {
          type: 'object',
          description: 'Campos a alterar: root, proxyPort, phpVersion, clientMaxBodySize, customDirectives, allowIps, denyIps, hstsMaxAge, cacheStaticDuration, rateLimitZone, rateLimitRate',
        },
      },
      required: ['domain', 'changes'],
      additionalProperties: false,
    },
    async preview(args) {
      const site = getSiteByDomain(str(args.domain));
      if (!site) throw new Error(`Site não encontrado: ${args.domain}`);

      const before = readRawConfig(site.id);
      const after = renderSiteConfig({ ...site, ...(args.changes || {}) } as ManagedSite);
      const diff = unifiedDiff(before, after, { fromLabel: site.configPath, toLabel: `${site.configPath} (novo)` });

      return {
        type: 'diff',
        content: diff.identical ? '(sem alterações no arquivo)' : diff.text,
        summary: `Atualizar ${site.domain} (${describeDiff(diff)})`,
      };
    },
    async execute(args) {
      try {
        const site = getSiteByDomain(str(args.domain));
        if (!site) return fail(`Site não encontrado: ${args.domain}`);
        const updated = await updateSite(site.id, args.changes || {});
        return ok({ domain: updated.domain, updatedAt: updated.updatedAt });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'set_maintenance',
    description: 'Liga ou desliga o modo de manutenção de um site.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        enabled: { type: 'boolean' },
        bypassIps: { type: 'array', items: { type: 'string' }, description: 'IPs que continuam vendo o site normalmente' },
      },
      required: ['domain', 'enabled'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'text',
        content: `${args.enabled ? 'Ativar' : 'Desativar'} manutenção em ${args.domain}` +
          (args.bypassIps?.length ? `\nIPs liberados: ${args.bypassIps.join(', ')}` : ''),
        summary: `Manutenção ${args.enabled ? 'ON' : 'OFF'} em ${args.domain}`,
      };
    },
    async execute(args) {
      try {
        const site = getSiteByDomain(str(args.domain));
        if (!site) return fail(`Site não encontrado: ${args.domain}`);
        const updated = await setMaintenance(site.id, Boolean(args.enabled), { bypassIps: args.bypassIps });
        return ok({ domain: updated.domain, maintenance: updated.maintenance });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'toggle_site',
    description: 'Habilita ou desabilita um site (cria ou remove o symlink em sites-enabled).',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
      additionalProperties: false,
    },
    async preview(args) {
      const site = getSiteByDomain(str(args.domain));
      return {
        type: 'text',
        content: `${site?.enabled ? 'Desabilitar' : 'Habilitar'} o site ${args.domain}`,
        summary: `${site?.enabled ? 'Desabilitar' : 'Habilitar'} ${args.domain}`,
      };
    },
    async execute(args) {
      try {
        const site = getSiteByDomain(str(args.domain));
        if (!site) return fail(`Site não encontrado: ${args.domain}`);
        const updated = await toggleSite(site.id);
        return ok({ domain: updated.domain, enabled: updated.enabled });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'service_action',
    description: 'Inicia, para, reinicia ou recarrega um serviço do systemd.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        unit: { type: 'string' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'reload'] },
      },
      required: ['unit', 'action'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'command',
        content: `systemctl ${args.action} ${args.unit}`,
        summary: `${args.action} no serviço ${args.unit}`,
      };
    },
    async execute(args) {
      const unit = str(args.unit);
      const action = str(args.action);
      const keyMap: Record<string, string> = {
        start: 'systemctl_start', stop: 'systemctl_stop',
        restart: 'systemctl_restart', reload: 'systemctl_reload',
      };
      if (!keyMap[action]) return fail(`Ação inválida: ${action}`);

      // Parar o SSH remotamente é o caminho mais curto para perder o servidor.
      if (/^ssh(d)?(\.service)?$/.test(unit) && (action === 'stop' || action === 'restart')) {
        const token = `ssh-${Date.now().toString(36)}`;
        await armRollback(token, ['systemctl', 'start', 'ssh'], 300);
        const result = await executeCommand(keyMap[action], [unit]);
        return {
          ok: result.code === 0,
          data: { unit, action, output: result.stderr || result.stdout || 'ok', rollbackToken: token },
          error: result.code === 0 ? undefined : result.stderr,
          rollbackHint: `Reversão automática em 5 minutos. Confirme o acesso para cancelar (token ${token}).`,
        };
      }

      const result = await executeCommand(keyMap[action], [unit]);
      return result.code === 0
        ? ok({ unit, action, output: result.stdout || 'ok' })
        : fail(result.stderr || result.stdout || `Falha ao executar ${action} em ${unit}`);
    },
  },

  {
    name: 'install_php',
    description: 'Instala uma versão de PHP com as extensões mais comuns e ativa o FPM.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'string', description: 'Ex.: 8.4' },
        extensions: { type: 'array', items: { type: 'string' } },
      },
      required: ['version'],
      additionalProperties: false,
    },
    async preview(args) {
      const { packagesFor } = await import('../php');
      const packages = packagesFor(str(args.version), args.extensions);
      return {
        type: 'command',
        content: `apt-get install -y ${packages.join(' ')}`,
        summary: `Instalar PHP ${args.version} (${packages.length} pacotes)`,
      };
    },
    async execute(args) {
      const result = await installPhp(str(args.version), args.extensions);
      return result.ok
        ? ok({ version: args.version, installed: true })
        : fail(result.output.substring(0, 800));
    },
  },

  {
    name: 'issue_certificate',
    description:
      'Emite um certificado Let\'s Encrypt por webroot e o associa ao site. ' +
      'Para wildcard é necessário desafio DNS com plugin e credenciais configurados.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        domains: { type: 'array', items: { type: 'string' } },
        email: { type: 'string' },
        attachToDomain: { type: 'string', description: 'Site do painel que passará a usar o certificado' },
        dryRun: { type: 'boolean' },
      },
      required: ['domains'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'command',
        content:
          `certbot certonly --webroot -w /var/www/acme \\\n` +
          (args.domains || []).map((d: string) => `  -d ${d}`).join(' \\\n') +
          (args.email ? ` \\\n  --email ${args.email}` : ''),
        summary: `Emitir certificado para ${(args.domains || []).join(', ')}`,
      };
    },
    async execute(args) {
      const result = await issueCertificate({
        domains: args.domains || [],
        email: args.email,
        dryRun: args.dryRun,
      });

      if (!result.ok) return fail(result.error || 'Falha na emissão');

      if (args.attachToDomain && result.certPath && result.keyPath) {
        const site = getSiteByDomain(str(args.attachToDomain));
        if (site) {
          await attachCertificate(site.id, { certPath: result.certPath, keyPath: result.keyPath });
        }
      }

      return ok({
        certName: result.certName,
        certPath: result.certPath,
        validUntil: result.metadata?.validUntil,
        daysRemaining: result.metadata?.daysRemaining,
      });
    },
  },

  {
    name: 'python_app_action',
    description: 'Reinicia, recarrega (graceful) ou consulta os logs de uma aplicação Python gerenciada.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        action: { type: 'string', enum: ['restart', 'reload', 'logs'] },
      },
      required: ['name', 'action'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'command',
        content: `systemctl ${args.action === 'logs' ? 'status' : args.action} duart-${args.name}.service`,
        summary: `${args.action} na aplicação ${args.name}`,
      };
    },
    async execute(args) {
      const app = readApps().find(a => a.name === str(args.name));
      if (!app) return fail(`Aplicação não encontrada: ${args.name}`);

      if (args.action === 'logs') return ok({ logs: await appLogs(app, 150) });
      const result = args.action === 'reload' ? await reloadApp(app) : await restartApp(app);
      return result.ok ? ok({ name: app.name, action: args.action }) : fail(result.output);
    },
  },

  {
    name: 'run_command',
    description:
      'Executa um comando de shell no servidor. Use quando nenhuma ferramenta específica servir. ' +
      'Prefira sempre as ferramentas dedicadas: elas validam, revertem em caso de erro e produzem saída estruturada.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        reason: { type: 'string', description: 'Por que este comando é necessário' },
        cwd: { type: 'string', description: 'Diretório de trabalho' },
        timeoutSeconds: { type: 'number', description: 'Padrão 60; até 1800 no modo laboratório' },
      },
      required: ['command', 'reason'],
      additionalProperties: false,
    },
    async preview(args) {
      const risk = assessCommandRisk(str(args.command));
      return {
        type: 'command',
        content: str(args.command),
        summary: risk.irreversible
          ? `⚠ Comando irreversível: ${risk.reasons.join('; ')}`
          : str(args.reason, 'Executar comando'),
      };
    },
    async execute(args, ctx) {
      const command = str(args.command);
      // Builds e `npm install` de projeto grande estouram 10 minutos com
      // facilidade; no laboratório o teto sobe para 30.
      const maxSeconds = ctx?.unrestricted ? 1800 : 600;
      const timeout = Math.min(int(args.timeoutSeconds, 60), maxSeconds) * 1000;
      const cwd = args.cwd ? path.resolve('/', str(args.cwd)) : undefined;

      let rollbackToken: string | null = null;
      if (needsRollbackGuard(command)) {
        rollbackToken = `net-${Date.now().toString(36)}`;
        // Se o comando cortar o acesso remoto, o firewall volta sozinho.
        await armRollback(rollbackToken, ['ufw', '--force', 'enable'], 300);
      }

      const result = cwd
        ? await execFileSafe('bash', ['-lc', command], { timeout, cwd })
        : await executeRaw(command, timeout);

      return {
        ok: result.code === 0,
        data: {
          exitCode: result.code,
          cwd: cwd ?? process.cwd(),
          stdout: result.stdout.substring(0, 8000),
          stderr: result.stderr.substring(0, 3000),
          rollbackToken,
        },
        error: result.code === 0 ? undefined : `Comando saiu com código ${result.code}`,
        rollbackHint: rollbackToken
          ? `Reversão de rede agendada para 5 minutos (token ${rollbackToken}). Confirme o acesso para cancelar.`
          : undefined,
      };
    },
  },

  {
    name: 'confirm_access',
    description:
      'Cancela uma reversão automática agendada. Chame depois de o usuário confirmar que ainda tem acesso ao servidor.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'text',
        content: `Cancelar a reversão automática agendada (token ${args.token}).`,
        summary: 'Confirmar acesso e cancelar reversão',
      };
    },
    async execute(args) {
      const cancelled = await disarmRollback(str(args.token));
      return ok({ cancelled });
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Ferramentas irreversíveis                                          */
/* ------------------------------------------------------------------ */

const irreversibleTools: ToolDefinition[] = [
  {
    name: 'delete_file',
    description: 'Remove um arquivo dentro dos diretórios permitidos.',
    risk: 'irreversible',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    async preview(args) {
      const target = path.resolve('/', str(args.path));
      let size = 0;
      try { size = fs.statSync(target).size; } catch {}
      return {
        type: 'text',
        content: `Remover ${target} (${size} bytes). Esta operação não tem desfazer.`,
        summary: `Apagar ${target}`,
      };
    },
    async execute(args, ctx) {
      try {
        const target = resolvePath(str(args.path), ctx);
        const stat = fs.statSync(target);
        if (stat.isDirectory() && !ctx?.unrestricted) {
          return fail('Use run_command para remover diretórios, com confirmação explícita.');
        }
        fs.rmSync(target, { recursive: stat.isDirectory(), force: true });
        return ok({ deleted: target });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'remove_site',
    description: 'Remove um site do NGINX, seu pool PHP e o symlink. Os arquivos do site são preservados.',
    risk: 'irreversible',
    parameters: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
      additionalProperties: false,
    },
    async preview(args) {
      const site = getSiteByDomain(str(args.domain));
      return {
        type: 'text',
        content: site
          ? `Remover o vhost ${site.configPath}, o symlink e o pool PHP de ${site.domain}.\nOs arquivos em ${site.root ?? '(sem root)'} são preservados.`
          : `Site ${args.domain} não encontrado.`,
        summary: `Remover site ${args.domain}`,
      };
    },
    async execute(args) {
      try {
        const site = getSiteByDomain(str(args.domain));
        if (!site) return fail(`Site não encontrado: ${args.domain}`);
        await deleteSite(site.id, { removeFiles: false });
        return ok({ removed: site.domain });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  },

  {
    name: 'firewall_rule',
    description:
      'Adiciona ou remove uma regra do UFW. Toda alteração agenda uma reversão automática em 5 minutos, ' +
      'cancelada por confirm_access — é o que impede o painel de se trancar para fora.',
    risk: 'irreversible',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['allow', 'delete'] },
        rule: { type: 'string', description: 'Ex.: 8080/tcp' },
      },
      required: ['action', 'rule'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'command',
        content: `ufw ${args.action} ${args.rule}`,
        summary: `Firewall: ${args.action} ${args.rule} (reversão automática em 5 min)`,
      };
    },
    async execute(args) {
      const token = `ufw-${Date.now().toString(36)}`;
      const statusBefore = await executeCommand('ufw_status');

      // Se a regra cortar o acesso, o SSH volta sozinho antes de virar incidente.
      await armRollback(token, ['ufw', 'allow', '22/tcp'], 300);

      const key = args.action === 'allow' ? 'ufw_allow' : 'ufw_delete';
      const result = await executeCommand(key, [str(args.rule)]);

      return {
        ok: result.code === 0,
        data: { output: result.stdout || result.stderr, rollbackToken: token, statusBefore: statusBefore.stdout.substring(0, 500) },
        error: result.code === 0 ? undefined : result.stderr,
        rollbackHint: `Liberação da porta 22 agendada para 5 minutos (token ${token}).`,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Ferramentas de laboratório (modo irrestrito)                       */
/* ------------------------------------------------------------------ */

/**
 * Só entram no catálogo quando o modo laboratório está ligado.
 *
 * São as ferramentas que tornam viável construir um projeto inteiro numa
 * sessão: escrita em lote, aplicação de patch, busca em código e alteração do
 * próprio painel. Fora do laboratório elas nem são oferecidas ao modelo — não
 * por serem proibidas, mas porque sem a jaula desligada produziriam apenas
 * chamadas que falhariam na validação de caminho.
 */
const labTools: ToolDefinition[] = [
  {
    name: 'write_files',
    description:
      'Grava vários arquivos de uma vez, criando os diretórios necessários. ' +
      'Use para montar a estrutura de um projeto: é uma chamada em vez de uma por arquivo.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Arquivos a gravar',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              mode: { type: 'string', description: 'Permissão octal, ex.: "755" para executáveis' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
    async preview(args) {
      const files = Array.isArray(args.files) ? args.files : [];
      const lines = files.map((file: { path: string; content?: string }) => {
        const exists = fs.existsSync(path.resolve('/', String(file.path)));
        const bytes = Buffer.byteLength(String(file.content ?? ''));
        return `${exists ? 'altera' : ' cria '}  ${file.path}  (${bytes} bytes)`;
      });
      return {
        type: 'text',
        content: lines.join('\n') || '(nenhum arquivo)',
        summary: `Gravar ${files.length} arquivo(s)`,
      };
    },
    async execute(args, ctx) {
      const files = Array.isArray(args.files) ? args.files : [];
      if (!files.length) return fail('Nenhum arquivo informado');

      const written: string[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          const target = resolvePath(String(file.path), ctx);
          const content = String(file.content ?? '');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf-8');

          if (file.mode && /^[0-7]{3,4}$/.test(String(file.mode))) {
            fs.chmodSync(target, parseInt(String(file.mode), 8));
          }
          written.push(target);
        } catch (err) {
          errors.push(`${file.path}: ${errorMessage(err)}`);
        }
      }

      return {
        ok: errors.length === 0,
        data: { written: written.length, files: written, errors },
        error: errors.length ? errors.join('; ') : undefined,
      };
    },
  },

  {
    name: 'apply_patch',
    description:
      'Aplica um diff unificado a arquivos existentes. Prefira isto a reescrever o arquivo inteiro ' +
      'quando a mudança é pontual — o diff é menor e não arrisca perder o resto do arquivo.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Diff unificado, no formato de git diff' },
        cwd: { type: 'string', description: 'Diretório base dos caminhos do diff' },
        strip: { type: 'number', description: 'Componentes a remover dos caminhos (-p). Padrão 1' },
      },
      required: ['patch'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'diff',
        content: str(args.patch).slice(0, 20000),
        summary: `Aplicar patch em ${args.cwd ?? 'diretório do painel'}`,
      };
    },
    async execute(args, ctx) {
      const patch = str(args.patch);
      if (!patch.trim()) return fail('Patch vazio');

      const cwd = args.cwd ? resolvePath(str(args.cwd), ctx) : projectRoot();
      const strip = String(int(args.strip, 1));

      // git apply dá mensagem de erro muito melhor; patch(1) é o plano B para
      // diretórios que não são repositório git.
      const viaGit = await execFileSafe(
        'git', ['apply', '--verbose', `-p${strip}`, '--whitespace=nowarn', '-'],
        { cwd, timeout: 60000, input: patch },
      );
      if (viaGit.code === 0) {
        return ok({ applied: true, via: 'git apply', output: viaGit.stderr.slice(0, 2000) });
      }

      const viaPatch = await execFileSafe(
        'patch', [`-p${strip}`, '--batch', '--forward'],
        { cwd, timeout: 60000, input: patch },
      );
      if (viaPatch.code === 0) {
        return ok({ applied: true, via: 'patch', output: viaPatch.stdout.slice(0, 2000) });
      }

      return fail(
        `O patch não aplicou.\ngit apply: ${viaGit.stderr.slice(0, 1200)}\n` +
        `patch: ${(viaPatch.stderr || viaPatch.stdout).slice(0, 1200)}\n` +
        `Releia o arquivo com read_file e refaça o diff a partir do conteúdo atual.`,
      );
    },
  },

  {
    name: 'search_code',
    description: 'Busca um padrão nos arquivos de um diretório. Use para se localizar num projeto antes de editar.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular estendida' },
        directory: { type: 'string' },
        glob: { type: 'string', description: 'Filtro de nome, ex.: "*.ts"' },
        maxResults: { type: 'number' },
      },
      required: ['pattern', 'directory'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const directory = resolvePath(str(args.directory), ctx);
      const limit = Math.min(int(args.maxResults, 80), 400);

      const grepArgs = [
        '-rnE', str(args.pattern), directory,
        '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.next',
        '--exclude-dir=.venv', '--exclude-dir=__pycache__', '--exclude-dir=vendor',
        '-I',
      ];
      if (args.glob) grepArgs.push(`--include=${str(args.glob)}`);

      const result = await execFileSafe('grep', grepArgs, { timeout: 60000 });
      const lines = result.stdout.split('\n').filter(Boolean);

      return ok({ matches: lines.slice(0, limit), total: lines.length, truncated: lines.length > limit });
    },
  },

  {
    name: 'install_packages',
    description:
      'Instala pacotes do sistema via apt. No modo laboratório qualquer pacote é aceito; ' +
      'fora dele vale apenas a lista que o painel suporta.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        packages: { type: 'array', items: { type: 'string' } },
        update: { type: 'boolean', description: 'Rodar apt-get update antes. Padrão true' },
      },
      required: ['packages'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'command',
        content: `apt-get install -y ${(args.packages ?? []).join(' ')}`,
        summary: `Instalar ${(args.packages ?? []).length} pacote(s)`,
      };
    },
    async execute(args) {
      const packages = (Array.isArray(args.packages) ? args.packages : [])
        .map(String)
        .filter(name => /^[a-z0-9][a-z0-9+.-]*$/i.test(name));

      if (!packages.length) return fail('Nenhum pacote com nome válido');

      if (args.update !== false) {
        await execFileSafe('apt-get', ['update', '-qq'], { timeout: 180000 });
      }

      const result = await execFileSafe(
        'apt-get', ['install', '-y', '-qq', ...packages],
        { timeout: 900000, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } },
      );

      return result.code === 0
        ? ok({ installed: packages })
        : fail((result.stderr || result.stdout).slice(0, 2000));
    },
  },

  {
    name: 'panel_self_update',
    description:
      'Valida alterações que você fez no código do PRÓPRIO Duart Panel e reinicia o serviço. ' +
      'Faz snapshot antes, roda typecheck e build, e agenda uma reversão automática que restaura ' +
      'o snapshot caso o painel não volte. Chame DEPOIS de gravar os arquivos. ' +
      'Se o build falhar, nada reinicia e o painel segue no ar com o código anterior.',
    risk: 'irreversible',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'O que foi alterado, para o registro' },
        restart: { type: 'boolean', description: 'Reiniciar após validar. Padrão true' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'text',
        content:
          `Alteração no código do painel: ${args.summary}\n\n` +
          'Sequência: snapshot → tsc --noEmit → next build → reinício agendado → verificação em 25s.\n' +
          'Se o painel não responder depois do reinício, o snapshot é restaurado automaticamente.',
        summary: `Auto-atualizar o painel: ${args.summary}`,
      };
    },
    async execute(args) {
      const result = await applySelfUpdate({ restart: args.restart !== false, label: 'ia' });

      if (!result.ok) {
        return { ok: false, error: result.error, rollbackHint: result.snapshot };
      }

      return {
        ok: true,
        data: {
          snapshot: result.snapshot,
          validation: result.validation?.output,
          restartScheduled: result.restartScheduled,
          aviso: result.restartScheduled
            ? 'O painel reinicia em alguns segundos. A conversa fica salva; recarregue a página se ela parar de responder.'
            : 'Build validado; reinício não solicitado.',
        },
        rollbackHint: `panel_snapshots action=restore file=${result.snapshot}`,
      };
    },
  },

  {
    name: 'panel_snapshots',
    description: 'Lista, cria ou restaura snapshots do código do painel.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'restore'] },
        file: { type: 'string', description: 'Caminho do snapshot, para action=restore' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async preview(args) {
      return {
        type: 'text',
        content: args.action === 'restore'
          ? `Restaurar o código do painel a partir de ${args.file} e recompilar.`
          : `Ação "${args.action}" sobre os snapshots do painel.`,
        summary: `Snapshots do painel: ${args.action}`,
      };
    },
    async execute(args) {
      if (args.action === 'list') {
        return ok({ snapshots: listSnapshots() });
      }
      if (args.action === 'create') {
        const result = await snapshotPanel('manual');
        return result.ok ? ok({ snapshot: result.file }) : fail(result.error ?? 'falhou');
      }
      if (args.action === 'restore') {
        const file = str(args.file);
        if (!file) return fail('Informe o snapshot a restaurar');

        const restored = await restoreSnapshot(file);
        if (!restored.ok) return fail(restored.error ?? 'falhou');

        const update = await applySelfUpdate({ restart: true, label: 'restore' });
        return update.ok
          ? ok({ restored: file, restartScheduled: update.restartScheduled })
          : fail(update.error ?? 'Restaurado, mas o build falhou');
      }
      return fail(`Ação desconhecida: ${args.action}`);
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Registro                                                           */
/* ------------------------------------------------------------------ */

export const ALL_TOOLS: ToolDefinition[] = [...readTools, ...writeTools, ...irreversibleTools, ...labTools];

export const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.name, t]));

/** Ferramentas expostas ao modelo em cada modo de aprovação. */
export function toolsForMode(mode: ApprovalMode): ToolDefinition[] {
  if (mode === 'read') return readTools;
  if (mode === 'full') return ALL_TOOLS;
  return [...readTools, ...writeTools, ...irreversibleTools];
}

/** Formato de function calling da API OpenAI, que o DeepSeek também aceita. */
export function toOpenAiTools(tools: ToolDefinition[]) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Decide se uma chamada precisa parar para aprovação.
 *
 * Leitura nunca para. Escrita para no modo assistido. O irreversível para em
 * qualquer modo — é o único ponto em que o modo autônomo ainda pede confirmação,
 * e é de propósito.
 */
export function requiresApproval(tool: ToolDefinition, args: ToolArgs, mode: ApprovalMode): boolean {
  if (tool.risk === 'read') return false;
  if (mode === 'read') return true;

  // Laboratório não tem portão nenhum — é o propósito declarado do modo. O que
  // resta é proteção mecânica: journal de tudo, snapshot antes de mexer no
  // painel, rollback do nginx, reversão agendada de firewall e SSH.
  if (mode === 'full') return false;

  if (tool.risk === 'irreversible') return true;

  if (tool.name === 'run_command' && assessCommandRisk(str(args.command)).irreversible) {
    return true;
  }

  return mode === 'assisted';
}

export async function buildPreview(tool: ToolDefinition, args: ToolArgs): Promise<ToolPreview> {
  if (tool.preview) {
    try {
      return await tool.preview(args);
    } catch (err) {
      return { type: 'text', content: errorMessage(err), summary: `${tool.name} (pré-visualização indisponível)` };
    }
  }
  return {
    type: 'text',
    content: JSON.stringify(args, null, 2),
    summary: `Executar ${tool.name}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Utilitários                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve caminho respeitando (ou não) a jaula.
 * No modo laboratório a jaula sai do caminho: o objetivo declarado é montar
 * projetos e editar o próprio painel, o que exige escrever em qualquer lugar.
 */
function resolvePath(input: string, ctx?: ToolContext): string {
  if (ctx?.unrestricted) {
    const resolved = path.resolve('/', input);
    if (!resolved || resolved.includes('\0')) throw new Error('Caminho inválido');
    return resolved;
  }
  return resolveSafePath(input, { allowedRoots: allowedRoots() });
}

function allowedRoots(): string[] | undefined {
  const config = readConfig() as { fileManagerRoots?: string[] };
  return config.fileManagerRoots?.length ? config.fileManagerRoots : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof PathAccessError) return err.message;
  if (err instanceof SiteError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function logPathFor(source: string, domain?: string): string | null {
  const map: Record<string, string> = {
    panel: '/var/lib/duart-panel/logs/panel.log',
    'nginx-access': domain ? `/var/log/nginx/${domain}.access.log` : '/var/log/nginx/access.log',
    'nginx-error': domain ? `/var/log/nginx/${domain}.error.log` : '/var/log/nginx/error.log',
    ufw: '/var/log/ufw.log',
    fail2ban: '/var/log/fail2ban.log',
    'ssl-renewal': '/var/lib/duart-panel/logs/ssl-renewal.log',
    'letsencrypt': '/var/log/letsencrypt/letsencrypt.log',
  };
  return map[source] ?? null;
}

async function tailFile(file: string, lines: number): Promise<string> {
  const result = await execFileSafe('tail', ['-n', String(lines), file], { timeout: 10000 });
  return result.code === 0 ? result.stdout : '';
}

function parseMeminfo(raw: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const [key, rest] = line.split(':');
    if (!rest) continue;
    const value = parseInt(rest.trim().replace(/\s*kB$/, ''), 10);
    if (!Number.isNaN(value)) values[key.trim()] = value * 1024;
  }
  return values;
}

/**
 * Percentual de CPU a partir de duas amostras de /proc/stat.
 * A conta antiga usava os totais acumulados desde o boot, que devolvem a média
 * histórica da máquina — um número praticamente constante que não reage a carga.
 */
export function cpuDelta(first: string, second: string): number {
  const parse = (raw: string) => {
    const line = raw.split('\n').find(l => l.startsWith('cpu '));
    if (!line) return null;
    const values = line.split(/\s+/).slice(1).map(Number).filter(n => !Number.isNaN(n));
    if (values.length < 4) return null;
    const idle = values[3] + (values[4] ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    return { idle, total };
  };

  const a = parse(first);
  const b = parse(second);
  if (!a || !b) return 0;

  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  if (totalDelta <= 0) return 0;

  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}
