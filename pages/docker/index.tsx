import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import ContainerCard from '@/components/docker/ContainerCard';
import ContainerLogs from '@/components/docker/ContainerLogs';

export default function DockerPage() {
  const [containers, setContainers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [logId, setLogId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/docker/containers').then(r => r.json()).then(j => { if (j.success) setContainers(j.data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleAction(id: string, action: string) {
    await fetch('/api/docker/container', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
    const res = await fetch('/api/docker/containers');
    const json = await res.json();
    if (json.success) setContainers(json.data);
  }

  const runningCount = containers.filter(c => (c.State || c.state) === 'running').length;

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Docker Manager</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><div className="text-2xl font-bold text-[var(--text-primary)]">{containers.length}</div><div className="text-xs text-[var(--text-muted)]">Total</div></Card>
          <Card><div className="text-2xl font-bold text-green-400">{runningCount}</div><div className="text-xs text-[var(--text-muted)]">Running</div></Card>
          <Card><div className="text-2xl font-bold text-red-400">{containers.length - runningCount}</div><div className="text-xs text-[var(--text-muted)]">Stopped</div></Card>
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <div className="grid gap-3">
            {containers.map((c, i) => (
              <div key={i} onClick={() => setLogId(c.ID || c.id)} className="cursor-pointer">
                <ContainerCard container={c} onAction={handleAction} />
              </div>
            ))}
            {containers.length === 0 && <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum container</p></Card>}
          </div>
        )}
        <ContainerLogs containerId={logId || ''} containerName={containers.find(c => (c.ID || c.id) === logId)?.Names || ''} open={!!logId} onClose={() => setLogId(null)} />
      </div>
    </AppLayout>
  );
}
