import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';

export default function DatabasesPage() {
  const [selected, setSelected] = useState<'mysql' | 'postgresql' | 'mongodb'>('mysql');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/databases/${selected}`)
      .then(res => res.json())
      .then(json => { if (json.success) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Bancos de Dados</h1>

        <div className="flex gap-2">
          {(['mysql', 'postgresql', 'mongodb'] as const).map(db => (
            <Button
              key={db}
              variant={selected === db ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setSelected(db)}
            >
              {db === 'mysql' ? 'MySQL' : db === 'postgresql' ? 'PostgreSQL' : 'MongoDB'}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : data ? (
          <Card>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-muted)]">Status:</span>
                <Badge variant={data.installed ? 'success' : 'warning'}>
                  {data.installed ? 'Instalado' : 'Não Instalado'}
                </Badge>
                {data.running && <Badge variant="success">Rodando</Badge>}
              </div>
              {data.version && (
                <p className="text-sm"><span className="text-[var(--text-muted)]">Versão:</span> <span className="text-[var(--text-primary)]">{data.version}</span></p>
              )}
              {data.port && (
                <p className="text-sm"><span className="text-[var(--text-muted)]">Porta:</span> <span className="text-[var(--text-primary)]">{data.port}</span></p>
              )}
            </div>
          </Card>
        ) : (
          <Card><p className="text-center text-[var(--text-muted)] py-8">Não foi possível obter informações</p></Card>
        )}
      </div>
    </AppLayout>
  );
}
