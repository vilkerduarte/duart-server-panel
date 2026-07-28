import { useState, useEffect, useCallback } from 'react';
import { HiOutlineCommandLine, HiOutlinePlay, HiOutlineBookmark, HiOutlineTrash } from 'react-icons/hi2';
import ProcessCard from '@/components/pm2/ProcessCard';
import ProcessLogs from '@/components/pm2/ProcessLogs';
import StartAppForm from '@/components/pm2/StartAppForm';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/lib/contexts/ToastContext';

export default function Pm2Page() {
  const { showToast } = useToast();
  const [processes, setProcesses] = useState<any[]>([]);
  const [manager, setManager] = useState<string>('pm2');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Logs modal
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsProcessId, setLogsProcessId] = useState<string | number>('');
  const [logsProcessName, setLogsProcessName] = useState('');

  // Start app modal
  const [startOpen, setStartOpen] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: string | number; action: string } | null>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/pm2/list');
      const data = await res.json();
      if (data.success) {
        setProcesses(data.data || []);
        setManager(data.manager || 'none');
      } else {
        setError(data.error || 'Erro ao carregar processos');
      }
    } catch {
      setError('Erro de conexão');
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  const handleAction = async (id: string | number, action: string) => {
    if (action === 'delete') {
      setConfirmAction({ id, action });
      setConfirmOpen(true);
      return;
    }

    try {
      const res = await fetch('/api/pm2/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, manager }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${action} executado com sucesso`, 'success');
        fetchProcesses();
      } else {
        showToast(data.error || 'Erro ao executar ação', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    try {
      const res = await fetch('/api/pm2/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: confirmAction.action, id: confirmAction.id, manager }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Processo removido com sucesso', 'success');
        fetchProcesses();
      } else {
        showToast(data.error || 'Erro ao remover processo', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setConfirmOpen(false);
      setConfirmAction(null);
    }
  };

  const handleLogs = (id: string | number, name: string) => {
    setLogsProcessId(id);
    setLogsProcessName(name);
    setLogsOpen(true);
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/pm2/save', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Configuração PM2 salva', 'success');
      } else {
        showToast(data.error || 'Erro ao salvar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    }
  };

  const handleFlush = async () => {
    try {
      const res = await fetch('/api/pm2/flush', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Logs limpos com sucesso', 'success');
      } else {
        showToast(data.error || 'Erro ao limpar logs', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    }
  };

  const handleStartup = async () => {
    try {
      const res = await fetch('/api/pm2/startup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Startup configurado com sucesso', 'success');
      } else {
        showToast(data.error || 'Erro ao configurar startup', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    }
  };

  const stats = {
    total: processes.length,
    online: processes.filter(p => {
      const status = manager === 'pm2' ? p.pm2_env?.status : p.status;
      return status === 'online' || status === 'running';
    }).length,
    stopped: processes.filter(p => {
      const status = manager === 'pm2' ? p.pm2_env?.status : p.status;
      return status === 'stopped';
    }).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">PM2 / Forever</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Gerenciamento de processos Node.js
            {manager !== 'none' && (
              <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-blue-600/20 text-blue-400">
                {manager.toUpperCase()}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {manager === 'pm2' && (
            <>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <HiOutlineBookmark className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={handleStartup}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <HiOutlineCommandLine className="w-4 h-4" />
                Startup
              </button>
              <button
                onClick={handleFlush}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <HiOutlineTrash className="w-4 h-4" />
                Flush Logs
              </button>
            </>
          )}
          <button
            onClick={() => setStartOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <HiOutlinePlay className="w-4 h-4" />
            Nova App
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--text-primary)]">{stats.total}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Total</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{stats.online}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Online</div>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-400">{stats.stopped}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Parados</div>
          </div>
        </Card>
      </div>

      {/* Process List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <Card>
          <div className="text-center py-8 text-[var(--text-muted)]">
            <p>{error}</p>
            <button
              onClick={fetchProcesses}
              className="mt-2 text-blue-400 hover:underline text-sm"
            >
              Tentar novamente
            </button>
          </div>
        </Card>
      ) : manager === 'none' ? (
        <Card>
          <div className="text-center py-12">
            <HiOutlineCommandLine className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
            <p className="text-[var(--text-muted)] mb-1">
              Nem PM2 nem Forever foram detectados no sistema.
            </p>
            <p className="text-xs text-[var(--text-muted)] opacity-70">
              Instale com: <code className="bg-[var(--bg-secondary)] px-1 py-0.5 rounded">npm install -g pm2</code> ou <code className="bg-[var(--bg-secondary)] px-1 py-0.5 rounded">npm install -g forever</code>
            </p>
          </div>
        </Card>
      ) : processes.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <HiOutlineCommandLine className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
            <p className="text-[var(--text-muted)] mb-3">
              Nenhum processo gerenciado encontrado.
            </p>
            <button
              onClick={() => setStartOpen(true)}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Iniciar nova aplicação
            </button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {processes.map((proc, index) => (
            <ProcessCard
              key={manager === 'pm2' ? (proc.pm_id ?? index) : (proc.id ?? index)}
              process={proc}
              manager={manager}
              onAction={handleAction}
              onLogs={handleLogs}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <ProcessLogs
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        processId={logsProcessId}
        processName={logsProcessName}
        manager={manager}
      />

      <StartAppForm
        open={startOpen}
        onClose={() => setStartOpen(false)}
        manager={manager}
        onSuccess={fetchProcesses}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmAction(null); }}
        onConfirm={handleConfirmAction}
        title="Remover Processo"
        message={`Tem certeza que deseja remover este processo? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="danger"
      />
    </div>
  );
}
