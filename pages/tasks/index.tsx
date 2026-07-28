import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';

interface Process {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  state: string;
  time: string;
  command: string;
}

export default function TasksPage() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    function fetchProcs() {
      fetch('/api/system/processes')
        .then(res => res.json())
        .then(json => {
          if (json.success) setProcesses(json.data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }

    fetchProcs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchProcs, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  function handleKill(pid: number) {
    setSelectedPid(pid);
    setShowConfirm(true);
  }

  function confirmKill() {
    if (!selectedPid) return;
    fetch('/api/system/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: selectedPid, signal: 'SIGTERM' }),
    });
    setShowConfirm(false);
    setSelectedPid(null);
  }

  const filtered = filter
    ? processes.filter(p => p.command.toLowerCase().includes(filter.toLowerCase()) ||
        p.user.toLowerCase().includes(filter.toLowerCase()) ||
        String(p.pid).includes(filter))
    : processes;

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Gerenciador de Tarefas</h1>
          <Button variant="ghost" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? 'Pausar' : 'Retomar'} Refresh
          </Button>
        </div>

        <Input
          placeholder="Filtrar por nome, usuário ou PID..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <Card padding={false}>
            <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-[var(--bg-card)] z-10">
                  <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="p-3">PID</th>
                    <th className="p-3">Usuário</th>
                    <th className="p-3">CPU %</th>
                    <th className="p-3">MEM %</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Tempo</th>
                    <th className="p-3">Comando</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((proc, i) => (
                    <tr
                      key={i}
                      className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors text-sm ${
                        selectedPid === proc.pid ? 'bg-blue-600/20' : ''
                      }`}
                      onClick={() => setSelectedPid(proc.pid)}
                    >
                      <td className="p-3 font-mono text-[var(--text-primary)]">{proc.pid}</td>
                      <td className="p-3 text-[var(--text-secondary)]">{proc.user}</td>
                      <td className={`p-3 ${proc.cpu > 50 ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
                        {proc.cpu.toFixed(1)}
                      </td>
                      <td className="p-3 text-[var(--text-secondary)]">{proc.mem.toFixed(1)}</td>
                      <td className="p-3 text-[var(--text-muted)]">{proc.state}</td>
                      <td className="p-3 text-[var(--text-muted)]">{proc.time}</td>
                      <td className="p-3 text-[var(--text-secondary)] truncate max-w-[300px]">{proc.command}</td>
                      <td className="p-3">
                        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleKill(proc.pid); }}>
                          Kill
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <ConfirmDialog
          open={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={confirmKill}
          title="Finalizar Processo"
          message={`Deseja finalizar o processo PID ${selectedPid}?`}
          confirmLabel="Finalizar"
          variant="danger"
        />
      </div>
    </AppLayout>
  );
}
