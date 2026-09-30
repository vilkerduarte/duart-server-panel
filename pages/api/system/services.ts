import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';

interface Pm2Proc { pm2_env?: { status?: string }; monit?: { cpu?: number; memory?: number } }

interface ServiceInfo {
  id: string;
  name: string;
  active: boolean;
  state: string;
  cpu: number | null;
  mem: number | null;
  ram: number | null;
}

const UNIT_PATTERNS = [
  'nginx.service',
  'php*-fpm.service',
  'mysql.service',
  'mysqld.service',
  'mariadb.service',
  'postgresql.service',
  'docker.service',
  'ufw.service',
  'firewalld.service',
  'pm2-*.service',
];

const NOT_SET = '18446744073709551615';
const EMPTY = { stdout: '', stderr: '', code: 1 };

function labelFor(unit: string): string {
  const id = unit.replace(/\.service$/, '');
  const php = id.match(/^php(\d+\.\d+)-fpm$/);
  if (php) return `PHP-FPM ${php[1]}`;
  if (id === 'nginx') return 'NGINX';
  if (id === 'mysql' || id === 'mysqld' || id === 'mariadb') return id === 'mariadb' ? 'MariaDB' : 'MySQL';
  if (id === 'postgresql') return 'PostgreSQL';
  if (id === 'docker') return 'Docker';
  if (id === 'ufw') return 'Firewall (UFW)';
  if (id === 'firewalld') return 'Firewall';
  if (id.startsWith('pm2')) return 'PM2';
  return id;
}

async function inspectUnit(unit: string): Promise<ServiceInfo> {
  const base: ServiceInfo = {
    id: unit.replace(/\.service$/, ''),
    name: labelFor(unit),
    active: false,
    state: 'unknown',
    cpu: null,
    mem: null,
    ram: null,
  };

  try {
    const show = await executeCommand('systemctl_show_props', [unit]).catch(() => EMPTY);
    const props: Record<string, string> = {};
    for (const line of show.stdout.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }

    base.state = props.ActiveState || 'unknown';
    base.active = base.state === 'active';
    if (!base.active) return base;

    let ramBytes: number | null = null;
    if (props.MemoryCurrent && /^\d+$/.test(props.MemoryCurrent)) {
      if (props.MemoryCurrent !== NOT_SET) ramBytes = Number(props.MemoryCurrent);
    }

    const pid = parseInt(props.MainPID || '0', 10);
    if (pid > 0) {
      const ps = await executeCommand('ps_pid_stats', [String(pid)]).catch(() => EMPTY);
      const [cpu, mem, rss] = ps.stdout.trim().split(/\s+/).map(Number);
      if (ps.code === 0 && !Number.isNaN(cpu)) {
        base.cpu = cpu;
        base.mem = Number.isNaN(mem) ? null : mem;
        if (ramBytes === null && !Number.isNaN(rss)) ramBytes = rss * 1024;
      }
    }
    base.ram = ramBytes;
  } catch {
    // Degrada para "estado desconhecido" em vez de derrubar a rota.
  }
  return base;
}

/** PM2 fora do systemd: agrega os processos do `pm2 jlist`, se o binário existir. */
async function pm2Fallback(): Promise<ServiceInfo | null> {
  try {
    const result = await executeCommand('pm2_jlist').catch(() => EMPTY);
    if (result.code !== 0) return null;
    const start = result.stdout.indexOf('[');
    if (start < 0) return null;
    const list = JSON.parse(result.stdout.slice(start));
    if (!Array.isArray(list)) return null;
    const online = (list as Pm2Proc[]).filter(p => p?.pm2_env?.status === 'online');
    return {
      id: 'pm2',
      name: 'PM2',
      active: online.length > 0,
      state: online.length > 0 ? 'active' : 'inactive',
      cpu: online.reduce((sum: number, p) => sum + (Number(p?.monit?.cpu) || 0), 0),
      mem: null,
      ram: online.reduce((sum: number, p) => sum + (Number(p?.monit?.memory) || 0), 0),
    };
  } catch {
    return null;
  }
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const listed = await executeCommand('systemctl_list_unit_files', UNIT_PATTERNS).catch(() => EMPTY);
    const units = listed.code === 0 || listed.stdout
      ? Array.from(new Set(
          listed.stdout
            .split('\n')
            .map(line => line.trim().split(/\s+/)[0])
            .filter(name => name && name.endsWith('.service') && !name.includes('@')),
        ))
      : [];

    const services = await Promise.all(units.map(inspectUnit));

    if (!services.some(s => s.id.startsWith('pm2'))) {
      const pm2 = await pm2Fallback();
      if (pm2) services.push(pm2);
    }

    return res.status(200).json({ success: true, data: services });
  } catch {
    return res.status(200).json({ success: true, data: [] });
  }
});
