import { useEffect, useState, useRef } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';

const SOURCES = [
  { key: 'panel', label: 'Painel' },
  { key: 'nginx-access', label: 'NGINX Access' },
  { key: 'nginx-error', label: 'NGINX Error' },
  { key: 'ufw', label: 'UFW' },
  { key: 'fail2ban', label: 'fail2ban' },
];

export default function LogsPage() {
  const [source, setSource] = useState('panel');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/logs/view?source=${source}&lines=200`)
      .then(res => res.json())
      .then(json => { if (json.success) setLogs(json.data.lines); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [source]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const filtered = filter
    ? logs.filter((l: any) => l.message.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Visualizador de Logs</h1>

        <div className="flex gap-2 flex-wrap">
          {SOURCES.map(s => (
            <Button
              key={s.key}
              variant={source === s.key ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setSource(s.key)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Input
          placeholder="Filtrar logs..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <Card padding={false}>
            <div
              ref={logContainerRef}
              className="max-h-[calc(100vh-320px)] overflow-y-auto font-mono text-xs p-4 rounded-lg"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {filtered.map((log: any, i: number) => (
                <div key={i} className="py-0.5 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                  {log.message}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-[var(--text-muted)] py-8">Nenhum log encontrado</div>
              )}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
