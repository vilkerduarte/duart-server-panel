import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { useApi } from '@/lib/hooks/useApi';

export default function MonitorPage() {
  const { data: cpuHistory, loading, error } = useApi<any[]>('/api/system/cpu-history', { interval: 5000 });
  const { data: stats } = useApi<any>('/api/system/stats', { interval: 5000 });

  if (loading && !stats) {
    return <AppLayout><div className="flex justify-center py-12"><Spinner size="lg" /></div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Monitor de Recursos</h1>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CPU Section */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">CPU</h3>
              <div className="text-3xl font-bold text-blue-400 mb-2">{stats.cpu.percent}%</div>
              <div className="w-full bg-[var(--bg-secondary)] rounded-full h-3 mb-4">
                <div className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(stats.cpu.percent, 100)}%` }} />
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Load: {stats.load['1m'].toFixed(2)} / {stats.load['5m'].toFixed(2)} / {stats.load['15m'].toFixed(2)}
              </p>
              <p className="text-sm text-[var(--text-muted)]">Cores: {stats.cpu.cores} | Modelo: {stats.cpu.model}</p>
            </Card>

            {/* Memory Section */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Memória</h3>
              <div className="text-3xl font-bold text-purple-400 mb-2">{stats.memory.percent}%</div>
              <div className="w-full bg-[var(--bg-secondary)] rounded-full h-3 mb-4">
                <div className="bg-purple-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(stats.memory.percent, 100)}%` }} />
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Usado: {formatBytes(stats.memory.used)} / Total: {formatBytes(stats.memory.total)}
              </p>
              <p className="text-sm text-[var(--text-muted)]">Livre: {formatBytes(stats.memory.free)}</p>
            </Card>
          </div>
        )}

        {/* CPU History */}
        {cpuHistory && cpuHistory.length > 0 && (
          <Card>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Histórico de CPU (Hoje)</h3>
            <div className="flex items-end gap-[2px] h-40 overflow-hidden">
              {cpuHistory.map((point: any, i: number) => (
                <div
                  key={i}
                  className="flex-1 bg-blue-500/50 hover:bg-blue-500 rounded-t transition-all"
                  style={{ height: `${Math.min(point.cpu, 100)}%` }}
                  title={`${point.cpu}% at ${point.timestamp?.slice(11, 19)}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2">
              <span>{cpuHistory[0]?.timestamp?.slice(11, 19) || '--:--:--'}</span>
              <span>{cpuHistory[cpuHistory.length - 1]?.timestamp?.slice(11, 19) || '--:--:--'}</span>
            </div>
          </Card>
        )}

        {/* Disk Usage */}
        {stats?.disk && (
          <Card>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Armazenamento</h3>
            <div className="space-y-3">
              {stats.disk.map((d: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-primary)]">{d.mount}</span>
                    <span className="text-[var(--text-muted)]">{formatBytes(d.used)} / {formatBytes(d.total)}</span>
                  </div>
                  <div className="w-full bg-[var(--bg-secondary)] rounded-full h-2">
                    <div className={`h-2 rounded-full ${d.percent > 90 ? 'bg-red-500' : d.percent > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(d.percent, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
