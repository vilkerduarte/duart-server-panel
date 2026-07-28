import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Spinner from '@/components/ui/Spinner';
import Card from '@/components/ui/Card';
import CpuGauge from '@/components/system/CpuGauge';
import UptimeDisplay from '@/components/system/UptimeDisplay';
import CpuChart from '@/components/charts/CpuChart';
import MemoryChart from '@/components/charts/MemoryChart';
import DiskChart from '@/components/charts/DiskChart';
import { HiOutlineCpuChip, HiOutlineServer, HiOutlineCircleStack, HiOutlineClock } from 'react-icons/hi2';

interface SystemStats {
  cpu: { percent: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; percent: number };
  disk: { mount: string; used: number; free: number; percent: number }[];
  uptime: number;
  load: { '1m': number; '5m': number; '15m': number };
  os: { hostname: string; distro: string; kernel: string; arch: string };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function fetchStats() {
      fetch('/api/system/stats')
        .then(res => res.json())
        .then(json => { if (json.success) setStats(json.data); else setError(json.error); })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/system/cpu-history')
      .then(r => r.json()).then(j => { if (j.success) setCpuHistory(j.data.slice(-60)); }).catch(() => {});
  }, []);

  function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + ['B','KB','MB','GB','TB'][i];
  }

  if (loading) return <AppLayout><div className="flex justify-center py-20"><Spinner size="lg" /></div></AppLayout>;
  if (error) return <AppLayout><Card><p className="text-red-500">{error}</p></Card></AppLayout>;
  if (!stats) return null;

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="flex flex-col items-center"><CpuGauge percent={stats.cpu.percent} label="CPU" /></Card>
          <Card className="flex flex-col items-center"><CpuGauge percent={stats.memory.percent} label="RAM" /></Card>
          <Card className="flex flex-col items-center"><CpuGauge percent={stats.disk[0]?.percent || 0} label="Disco" /></Card>
          <Card className="flex items-center justify-center"><UptimeDisplay seconds={stats.uptime} /></Card>
        </div>

        {/* CPU Chart */}
        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Histórico de CPU</h3>
          <CpuChart data={cpuHistory} />
        </Card>

        {/* Memory and Disk */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Memória</h3>
            <MemoryChart total={stats.memory.total} used={stats.memory.used} free={stats.memory.free} percent={stats.memory.percent} />
            <p className="text-xs text-[var(--text-muted)] mt-2 text-center">{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Armazenamento</h3>
            <DiskChart disks={stats.disk} />
          </Card>
        </div>

        {/* System Info */}
        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Informações do Sistema</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-[var(--text-muted)]">Hostname: </span><span className="text-[var(--text-primary)]">{stats.os.hostname}</span></div>
            <div><span className="text-[var(--text-muted)]">Distro: </span><span className="text-[var(--text-primary)]">{stats.os.distro}</span></div>
            <div><span className="text-[var(--text-muted)]">Kernel: </span><span className="text-[var(--text-primary)]">{stats.os.kernel}</span></div>
            <div><span className="text-[var(--text-muted)]">Arch: </span><span className="text-[var(--text-primary)]">{stats.os.arch}</span></div>
            <div><span className="text-[var(--text-muted)]">Load: </span><span className="text-[var(--text-primary)]">{stats.load['1m'].toFixed(2)} / {stats.load['5m'].toFixed(2)} / {stats.load['15m'].toFixed(2)}</span></div>
            <div><span className="text-[var(--text-muted)]">CPU: </span><span className="text-[var(--text-primary)]">{stats.cpu.model} ({stats.cpu.cores} cores)</span></div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
