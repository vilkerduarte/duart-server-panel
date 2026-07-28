import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

export default function DockerPage() {
  const [containers, setContainers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/docker/containers')
      .then(res => res.json())
      .then(json => { if (json.success) setContainers(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(id: string, action: string) {
    await fetch('/api/docker/container', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    // Refresh
    const res = await fetch('/api/docker/containers');
    const json = await res.json();
    if (json.success) setContainers(json.data);
  }

  function getStateBadge(state: string) {
    if (state === 'running') return <Badge variant="success">Running</Badge>;
    if (state === 'exited') return <Badge variant="danger">Exited</Badge>;
    if (state === 'paused') return <Badge variant="warning">Paused</Badge>;
    return <Badge>{state}</Badge>;
  }

  const runningCount = containers.filter(c => c.State === 'running' || c.state === 'running').length;

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Docker Manager</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{containers.length}</div>
            <div className="text-xs text-[var(--text-muted)]">Total Containers</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-green-400">{runningCount}</div>
            <div className="text-xs text-[var(--text-muted)]">Running</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-red-400">{containers.length - runningCount}</div>
            <div className="text-xs text-[var(--text-muted)]">Stopped</div>
          </Card>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <div className="grid gap-4">
            {containers.map((container, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-[var(--text-primary)]">{container.Names || container.name}</h3>
                      {getStateBadge(container.State || container.state || 'unknown')}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] space-x-3">
                      <span>Image: {container.Image || container.image}</span>
                      {container.Ports && <span>Ports: {container.Ports}</span>}
                      <span>Status: {container.Status || container.status}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleAction(container.ID || container.id, 'start')}>Start</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleAction(container.ID || container.id, 'stop')}>Stop</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleAction(container.ID || container.id, 'restart')}>Restart</Button>
                  </div>
                </div>
              </Card>
            ))}
            {containers.length === 0 && (
              <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum container encontrado</p></Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
