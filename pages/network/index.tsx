import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';

export default function NetworkPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/system/network')
      .then(res => res.json())
      .then(json => { if (json.success) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Métricas de Rede</h1>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : data ? (
          <>
            {/* Interfaces */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Interfaces</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-[var(--text-muted)]">
                      <th className="p-2">Interface</th>
                      <th className="p-2">RX</th>
                      <th className="p-2">TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.interfaces?.map((iface: any, i: number) => (
                      <tr key={i} className="border-t border-[var(--border-color)]">
                        <td className="p-2 text-[var(--text-primary)] font-medium">{iface.name}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatBytes(iface.rxBytes)}</td>
                        <td className="p-2 text-[var(--text-secondary)]">{formatBytes(iface.txBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Connections */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Conexões</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><div className="text-xl font-bold text-[var(--text-primary)]">{data.connections?.total || 0}</div><div className="text-xs text-[var(--text-muted)]">Total</div></div>
                <div><div className="text-xl font-bold text-blue-400">{data.connections?.tcp || 0}</div><div className="text-xs text-[var(--text-muted)]">TCP</div></div>
                <div><div className="text-xl font-bold text-purple-400">{data.connections?.udp || 0}</div><div className="text-xs text-[var(--text-muted)]">UDP</div></div>
              </div>
            </Card>

            {/* NGINX Metrics */}
            {data.nginx?.active !== undefined && (
              <Card>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">NGINX Metrics</h3>
                <div className="text-xl font-bold text-green-400">{data.nginx.active} conexões ativas</div>
              </Card>
            )}
          </>
        ) : (
          <Card><p className="text-center text-[var(--text-muted)] py-8">Erro ao carregar métricas</p></Card>
        )}
      </div>
    </AppLayout>
  );
}
