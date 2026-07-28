import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AppLayout from '@/components/Layout/AppLayout';
import Spinner from '@/components/ui/Spinner';
import Card from '@/components/ui/Card';
import { useAuth } from '@/lib/contexts/AuthContext';
import { HiOutlineCpuChip, HiOutlineServer, HiOutlineCircleStack, HiOutlineClock } from 'react-icons/hi2';

interface SystemStats {
  cpu: { percent: number; cores: number; model: string };
  memory: { total: number; used: number; free: number; percent: number };
  disk: { mount: string; total: number; used: number; free: number; percent: number }[];
  uptime: number;
  load: { '1m': number; '5m': number; '15m': number };
  os: { hostname: string; distro: string; kernel: string; arch: string };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function fetchStats() {
      fetch('/api/system/stats')
        .then(res => res.json())
        .then(json => {
          if (json.success) setStats(json.data);
          else setError(json.error);
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }

  function getPercentColor(percent: number): string {
    if (percent > 80) return 'text-red-500';
    if (percent > 60) return 'text-amber-500';
    return 'text-green-500';
  }

  function getBarColor(percent: number): string {
    if (percent > 80) return 'bg-red-500';
    if (percent > 60) return 'bg-amber-500';
    return 'bg-green-500';
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-64">
          <Spinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <Card><p className="text-red-500">Erro: {error}</p></Card>
      </AppLayout>
    );
  }

  if (!stats) return null;

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* CPU Card */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--text-muted)]">CPU</span>
              <HiOutlineCpuChip className="w-5 h-5 text-blue-400" />
            </div>
            <div className={`text-2xl font-bold ${getPercentColor(stats.cpu.percent)}`}>
              {stats.cpu.percent}%
            </div>
            <div className="mt-2 w-full bg-[var(--bg-secondary)] rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-500 ${getBarColor(stats.cpu.percent)}`}
                style={{ width: `${Math.min(stats.cpu.percent, 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">{stats.cpu.cores} cores</p>
          </Card>

          {/* Memory Card */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--text-muted)]">RAM</span>
              <HiOutlineServer className="w-5 h-5 text-purple-400" />
            </div>
            <div className={`text-2xl font-bold ${getPercentColor(stats.memory.percent)}`}>
              {stats.memory.percent}%
            </div>
            <div className="mt-2 w-full bg-[var(--bg-secondary)] rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-500 ${getBarColor(stats.memory.percent)}`}
                style={{ width: `${Math.min(stats.memory.percent, 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
            </p>
          </Card>

          {/* Disk Card */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--text-muted)]">Disco</span>
              <HiOutlineCircleStack className="w-5 h-5 text-amber-400" />
            </div>
            <div className={`text-2xl font-bold ${getPercentColor(stats.disk[0]?.percent || 0)}`}>
              {stats.disk[0]?.percent || 0}%
            </div>
            <div className="mt-2 w-full bg-[var(--bg-secondary)] rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-500 ${getBarColor(stats.disk[0]?.percent || 0)}`}
                style={{ width: `${Math.min(stats.disk[0]?.percent || 0, 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {stats.disk[0] ? `${formatBytes(stats.disk[0].free)} livre` : 'N/A'}
            </p>
          </Card>

          {/* Uptime Card */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--text-muted)]">Uptime</span>
              <HiOutlineClock className="w-5 h-5 text-green-400" />
            </div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {formatUptime(stats.uptime)}
            </div>
            <div className="mt-2">
              <span className="text-xs text-[var(--text-muted)]">
                Load: {stats.load['1m'].toFixed(2)} / {stats.load['5m'].toFixed(2)} / {stats.load['15m'].toFixed(2)}
              </span>
            </div>
          </Card>
        </div>

        {/* System Info */}
        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Informações do Sistema</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-[var(--text-muted)]">Hostname: </span>
              <span className="text-[var(--text-primary)]">{stats.os.hostname}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Distro: </span>
              <span className="text-[var(--text-primary)]">{stats.os.distro}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Kernel: </span>
              <span className="text-[var(--text-primary)]">{stats.os.kernel}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Arch: </span>
              <span className="text-[var(--text-primary)]">{stats.os.arch}</span>
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
