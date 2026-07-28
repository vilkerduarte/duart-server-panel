import { useState, useEffect, useRef } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface ContainerLogsProps {
  containerId: string;
  containerName: string;
  open: boolean;
  onClose: () => void;
}

export default function ContainerLogs({ containerId, containerName, open, onClose }: ContainerLogsProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open || !containerId) return;
    setLoading(true);
    fetch(`/api/docker/container`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: containerId, action: 'logs' }),
    }).then(r => r.json()).then(data => {
      if (data.success) setLogs(data.data?.result || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open, containerId]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold">Logs: {containerName}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl">&times;</button>
        </div>
        <pre ref={ref} className="p-4 overflow-y-auto font-mono text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] flex-1" style={{ maxHeight: '60vh' }}>
          {loading ? 'Carregando...' : logs || 'Nenhum log disponível'}
        </pre>
        <div className="flex justify-end p-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}
