import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import ContainerCard from '@/components/docker/ContainerCard';
import ContainerDetailModal from '@/components/docker/ContainerDetailModal';
import { HiOutlineCommandLine } from 'react-icons/hi2';

export default function DockerPage() {
  const [containers, setContainers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchContainers = () => {
    fetch('/api/docker/containers').then(r => r.json()).then(j => {
      if (j.success) setContainers(j.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchContainers(); }, []);

  async function handleAction(id: string, action: string) {
    await fetch('/api/docker/container', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    fetchContainers();
  }

  const runningCount = containers.filter(c => (c.State || c.state) === 'running').length;
  const selectedContainer = containers.find(c => (c.ID || c.id) === selectedId);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
          <HiOutlineCommandLine className="w-6 h-6" /> Docker Manager
        </h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{containers.length}</div>
            <div className="text-xs text-[var(--text-muted)]">Total</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-green-400">{runningCount}</div>
            <div className="text-xs text-[var(--text-muted)]">Running</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-red-400">{containers.length - runningCount}</div>
            <div className="text-xs text-[var(--text-muted)]">Stopped</div>
          </Card>
          <Card>
            <div className="text-2xl font-bold text-blue-400">
              {containers.filter(c => (c.State || c.state) === 'paused').length}
            </div>
            <div className="text-xs text-[var(--text-muted)]">Paused</div>
          </Card>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <div className="grid gap-3">
            {containers.map((c, i) => (
              <div key={i} onClick={() => setSelectedId(c.ID || c.id)} className="cursor-pointer">
                <ContainerCard container={c} onAction={handleAction} />
              </div>
            ))}
            {containers.length === 0 && (
              <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum container encontrado</p></Card>
            )}
          </div>
        )}

        {selectedContainer && (
          <ContainerDetailModal
            containerId={selectedContainer.ID || selectedContainer.id}
            containerName={selectedContainer.Names || selectedContainer.name || ''}
            containerState={(selectedContainer.State || selectedContainer.state || 'unknown')}
            open={!!selectedId}
            onClose={() => setSelectedId(null)}
            onAction={handleAction}
          />
        )}
      </div>
    </AppLayout>
  );
}
