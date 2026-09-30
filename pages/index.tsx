import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/Layout/AppLayout';
import Spinner from '@/components/ui/Spinner';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import MetricGaugeCard from '@/components/system/MetricGaugeCard';
import UptimeDisplay, { splitUptime } from '@/components/system/UptimeDisplay';
import CpuChart from '@/components/charts/CpuChart';
import { useI18n } from '@/lib/contexts/I18nContext';
import {
  HiOutlineCpuChip, HiOutlineCircleStack, HiOutlineServerStack, HiOutlineCog6Tooth,
  HiOutlineCube, HiOutlineChevronRight, HiOutlineChevronDown,
} from 'react-icons/hi2';

interface DiskInfo { mount: string; used: number; free: number; total?: number; percent: number; inodePercent?: number | null }

interface SystemStats {
  cpu: { percent: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; percent: number; buffers?: number; cached?: number };
  disk: DiskInfo[];
  uptime: number;
  load: { '1m': number; '5m': number; '15m': number };
  os: { hostname: string; distro: string; kernel: string; arch: string };
}

interface ProcessInfo { pid: number; user: string; cpu: number; mem: number; command: string }
interface ServiceInfo { id: string; name: string; active: boolean; cpu: number | null; mem: number | null; ram: number | null }
interface CpuPoint { timestamp: string; cpu: number; load1: number; load5: number; load15: number }

const RANGE_OPTIONS = [15, 30, 60, 120];

/** Consulta periódica; ignora falhas após o primeiro sucesso e pausa com a aba oculta. */
function usePolled<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(url)
        .then(res => res.json())
        .then(json => {
          if (cancelled) return;
          if (json.success) { setData(json.data as T); setError(null); }
          else setError(json.error || 'error');
        })
        .catch(err => { if (!cancelled) setError(err.message || 'error'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [url, intervalMs, tick]);

  const reload = useCallback(() => { setLoading(true); setTick(v => v + 1); }, []);
  return { data, error, loading, reload };
}

function CardHeader({ icon: Icon, title, href, detailsLabel, children }: {
  icon: React.ElementType; title: string; href?: string; detailsLabel?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="flex items-center gap-3 text-base font-semibold text-[var(--text-primary)]">
        <Icon className="w-6 h-6 text-[var(--text-secondary)]" />
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {children}
        {href && (
          <Link href={href} aria-label={detailsLabel} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <HiOutlineChevronRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

const selectClass = 'appearance-none rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] py-1.5 pl-3 pr-8 text-xs text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { data: stats, error, loading, reload } = usePolled<SystemStats>('/api/system/stats', 5000);
  const { data: processes } = usePolled<ProcessInfo[]>('/api/system/processes?limit=5&sort=cpu', 5000);
  const { data: services } = usePolled<ServiceInfo[]>('/api/system/services', 15000);

  const [range, setRange] = useState(30);
  const [cpuHistory, setCpuHistory] = useState<CpuPoint[]>([]);
  const [mount, setMount] = useState<string>('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      const today = new Date();
      const dates = [today.toISOString().slice(0, 10)];
      // O histórico é um arquivo por dia (UTC); perto da meia-noite a janela cruza dois arquivos.
      const from = new Date(today.getTime() - range * 60000);
      if (from.toISOString().slice(0, 10) !== dates[0]) dates.unshift(from.toISOString().slice(0, 10));
      try {
        const chunks = await Promise.all(dates.map(d => fetch(`/api/system/cpu-history?date=${d}`).then(r => r.json())));
        if (cancelled) return;
        const all: CpuPoint[] = chunks.flatMap(j => (j.success && Array.isArray(j.data) ? j.data : []));
        const cutoff = today.getTime() - range * 60000;
        setCpuHistory(all.filter(p => new Date(p.timestamp).getTime() >= cutoff));
      } catch {
        // mantém o gráfico anterior
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [range]);

  const num = (value: number, digits = 1) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const formatBytes = (bytes: number | null | undefined): string => {
    if (!bytes || bytes < 0) return '0 B';
    const i = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${num(bytes / Math.pow(1024, i))} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
  };
  const formatMb = (bytes: number | null | undefined) =>
    bytes == null ? '—' : `${num(bytes / (1024 * 1024), 0)} MB`;
  const formatPct = (value: number | null | undefined) => (value == null ? '—' : `${num(value)}%`);

  if (loading && !stats) {
    return <AppLayout><div className="flex justify-center py-20"><Spinner size="lg" /></div></AppLayout>;
  }

  if (!stats) {
    return (
      <AppLayout>
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-red-400">{t('dashboard.statsUnavailable')}</p>
          {error && <p className="text-xs text-[var(--text-muted)]">{error}</p>}
          <Button variant="ghost" size="sm" onClick={reload}>{t('dashboard.retry')}</Button>
        </Card>
      </AppLayout>
    );
  }

  const disks = stats.disk ?? [];
  const disk = disks.find(d => d.mount === mount) ?? disks.find(d => d.mount === '/') ?? disks[0];
  const diskTotal = disk ? (disk.total ?? disk.used + disk.free) : 0;
  const up = splitUptime(stats.uptime);
  const inactive = (services ?? []).filter(s => !s.active).length;
  const mountLabel = (m: string) => (m === '/' ? t('dashboard.mountRoot') : m);

  const memory = stats.memory;
  const memStats = [
    { label: t('dashboard.used'), value: formatBytes(memory.used), color: 'bg-blue-500' },
    { label: t('dashboard.free'), value: formatBytes(memory.free), color: 'bg-slate-400' },
    { label: t('dashboard.buffers'), value: memory.buffers != null ? formatBytes(memory.buffers) : '—', color: 'bg-cyan-400' },
    { label: t('dashboard.cache'), value: memory.cached != null ? formatBytes(memory.cached) : '—', color: 'bg-amber-400' },
  ];
  const diskStats = [
    { label: t('dashboard.used'), value: disk ? formatBytes(disk.used) : '—', color: 'bg-blue-500' },
    { label: t('dashboard.free'), value: disk ? formatBytes(disk.free) : '—', color: 'bg-slate-300' },
    { label: t('dashboard.inodes'), value: formatPct(disk?.inodePercent), color: 'bg-amber-400' },
  ];

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Título e pílula de status */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">{t('dashboard.title')}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('dashboard.subtitle')}</p>
          </div>
          <div
            role="status"
            className="glass-card glow-border flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl px-5 py-3 text-sm"
          >
            <span className="flex items-center gap-2 text-[var(--text-primary)]">
              <span className="status-dot" />
              {t('dashboard.online')}
            </span>
            <span className="text-[var(--text-secondary)]">
              {t('dashboard.uptimeShort')}{' '}
              <span className="font-semibold text-[var(--text-primary)]">{up.d}d {up.h}h {up.m}m</span>
            </span>
            <span className="text-[var(--text-secondary)] sm:ml-auto">
              {now.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' })}
              <span className="ml-3 text-[var(--text-primary)]">
                {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </span>
          </div>
        </div>

        {/* Anéis de uso */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricGaugeCard
            title={t('dashboard.cpu')}
            percent={stats.cpu.percent}
            detail={t('dashboard.cores', { used: num((stats.cpu.percent / 100) * stats.cpu.cores, 1), total: stats.cpu.cores })}
            href="/monitor"
            detailsLabel={t('dashboard.details')}
          />
          <MetricGaugeCard
            title="RAM"
            percent={memory.percent}
            detail={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`}
            href="/monitor"
            detailsLabel={t('dashboard.details')}
          />
          <MetricGaugeCard
            title={t('dashboard.disk')}
            percent={disk?.percent ?? 0}
            detail={disk ? `${formatBytes(disk.used)} / ${formatBytes(diskTotal)}` : undefined}
            href="/monitor"
            detailsLabel={t('dashboard.details')}
          />
          <div className="glass-card glow-border rounded-2xl p-4 flex items-center justify-center">
            <UptimeDisplay seconds={stats.uptime} />
          </div>
        </div>

        {/* Histórico de CPU */}
        <Card glow="amber">
          <CardHeader icon={HiOutlineCpuChip} title={t('dashboard.cpuHistory')}>
            <div className="relative">
              <select
                value={range}
                onChange={e => setRange(Number(e.target.value))}
                aria-label={t('dashboard.range')}
                className={selectClass}
              >
                {RANGE_OPTIONS.map(n => (
                  <option key={n} value={n}>{t('dashboard.lastMinutes', { n })}</option>
                ))}
              </select>
              <HiOutlineChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            </div>
          </CardHeader>
          <div className="mb-1 flex items-center justify-end gap-4 text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />{t('dashboard.cpuTotal')}</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-slate-400" />{t('dashboard.avg5m')}</span>
          </div>
          <CpuChart data={cpuHistory} />
        </Card>

        {/* Memória e armazenamento */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card glow="amber">
            <CardHeader icon={HiOutlineServerStack} title={t('dashboard.memoryCard')} href="/monitor" detailsLabel={t('dashboard.details')} />
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <div><span className="text-xl font-semibold text-[var(--text-primary)]">{formatBytes(memory.used)}</span> <span className="text-[var(--text-secondary)]">/ {formatBytes(memory.total)}</span></div>
              <div className="text-[var(--text-secondary)]">{t('dashboard.usedPercent', { percent: memory.percent })}</div>
            </div>
            <div className="metric-bar mt-3" role="progressbar" aria-valuenow={memory.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('dashboard.memoryCard')}>
              <span style={{ width: `${Math.min(100, memory.percent)}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {memStats.map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className={`h-7 w-1.5 rounded-full ${item.color}`} />
                  <div><dt className="text-[var(--text-muted)]">{item.label}</dt><dd className="text-sm text-[var(--text-primary)]">{item.value}</dd></div>
                </div>
              ))}
            </dl>
          </Card>

          <Card glow="amber">
            <CardHeader icon={HiOutlineCircleStack} title={t('dashboard.storage')}>
              {disks.length > 1 && (
                <div className="relative">
                  <select value={disk?.mount ?? ''} onChange={e => setMount(e.target.value)} aria-label={t('dashboard.storage')} className={selectClass}>
                    {disks.map(d => <option key={d.mount} value={d.mount}>{mountLabel(d.mount)}</option>)}
                  </select>
                  <HiOutlineChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>
              )}
            </CardHeader>
            {disk ? (
              <>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <div><span className="text-xl font-semibold text-[var(--text-primary)]">{formatBytes(disk.used)}</span> <span className="text-[var(--text-secondary)]">/ {formatBytes(diskTotal)}</span></div>
                  <div className="text-[var(--text-secondary)]">{t('dashboard.usedPercent', { percent: disk.percent })}</div>
                </div>
                <div className="metric-bar mt-3" role="progressbar" aria-valuenow={disk.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('dashboard.storage')}>
                  <span style={{ width: `${Math.min(100, disk.percent)}%` }} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  {diskStats.map(item => (
                    <div key={item.label} className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full ${item.color}`} />
                      <div><dt className="text-[var(--text-muted)]">{item.label}</dt><dd className="text-sm text-[var(--text-primary)]">{item.value}</dd></div>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">{t('dashboard.noData')}</p>
            )}
          </Card>
        </div>

        {/* Processos e serviços */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card glow="amber">
            <CardHeader icon={HiOutlineCog6Tooth} title={t('dashboard.topProcessesCpu')} href="/tasks" detailsLabel={t('dashboard.details')} />
            <div className="overflow-x-auto">
              <table className="glass-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.pid')}</th><th>{t('dashboard.user')}</th><th>{t('dashboard.processName')}</th>
                    <th>{t('dashboard.cpuPct')}</th><th>{t('dashboard.memPct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(processes ?? []).map(p => (
                    <tr key={p.pid}>
                      <td>{p.pid}</td>
                      <td>{p.user}</td>
                      <td className="max-w-[10rem] truncate" title={p.command}>{p.command.split(' ')[0].split('/').pop()}</td>
                      <td>{num(p.cpu)}</td>
                      <td>{num(p.mem)}</td>
                    </tr>
                  ))}
                  {(!processes || processes.length === 0) && (
                    <tr><td colSpan={5} className="py-6 text-center text-[var(--text-muted)]">{t('dashboard.noProcesses')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card glow="amber">
            <CardHeader icon={HiOutlineCube} title={t('dashboard.servicesTitle')} href="/monitor" detailsLabel={t('dashboard.details')}>
              {inactive > 0 && <span className="text-xs text-amber-400">{t('dashboard.someOffline', { count: inactive })}</span>}
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="glass-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th><th>{t('common.status')}</th>
                    <th>{t('dashboard.cpuPct')}</th><th>{t('dashboard.memPct')}</th><th>{t('dashboard.ram')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(services ?? []).map(s => (
                    <tr key={s.id}>
                      <td>
                        <span className="flex items-center gap-2 text-[var(--text-primary)]">
                          <span className={`h-2.5 w-2.5 rounded-full ${s.active ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`} />
                          {s.name}
                        </span>
                      </td>
                      <td className={s.active ? 'text-green-400' : 'text-red-400'}>{s.active ? t('dashboard.active') : t('dashboard.inactive')}</td>
                      <td>{formatPct(s.cpu)}</td>
                      <td>{formatPct(s.mem)}</td>
                      <td>{formatMb(s.ram)}</td>
                    </tr>
                  ))}
                  {(!services || services.length === 0) && (
                    <tr><td colSpan={5} className="py-6 text-center text-[var(--text-muted)]">{t('dashboard.noServices')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
