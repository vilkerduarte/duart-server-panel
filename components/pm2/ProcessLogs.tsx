import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

interface ProcessLogsProps {
  open: boolean;
  onClose: () => void;
  processId: string | number;
  processName: string;
  manager: string;
}

export default function ProcessLogs({ open, onClose, processId, processName, manager }: ProcessLogsProps) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pm2/logs?id=${processId}&lines=${lines}&manager=${manager}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data || '');
      }
    } catch {
      setLogs('Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchLogs();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, processId, lines]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh]);

  return (
    <Modal open={open} onClose={onClose} title={`Logs: ${processName}`} size="xl">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
          >
            <option value={50}>50 linhas</option>
            <option value={100}>100 linhas</option>
            <option value={200}>200 linhas</option>
            <option value={500}>500 linhas</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>

          <button
            onClick={fetchLogs}
            className="px-3 py-1 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
          >
            Atualizar
          </button>
        </div>

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/50 z-10">
              <Spinner />
            </div>
          )}
          <pre className="bg-black/40 rounded-lg p-4 text-xs text-green-400 font-mono h-96 overflow-auto whitespace-pre-wrap break-all border border-[var(--border-color)]">
            {logs || 'Nenhum log disponível'}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
