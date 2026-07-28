import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import DbStatusCard from '@/components/databases/DbStatusCard';

const DB_TYPES = ['mysql', 'postgresql', 'mongodb'] as const;
const DB_NAMES: Record<string, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', mongodb: 'MongoDB' };

export default function DatabasesPage() {
  const [selected, setSelected] = useState<string>('mysql');
  const [dbData, setDbData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const db = selected;
    fetch(`/api/databases/${db}`).then(r => r.json()).then(j => {
      if (j.success) setDbData(prev => ({ ...prev, [db]: j.data }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [selected]);

  const handleInstall = async (db: string) => {
    if (!confirm(`Instalar ${DB_NAMES[db]}? Pode levar alguns minutos.`)) return;
    await fetch(`/api/databases/${db}/install`, { method: 'POST' });
    // Refresh
    const res = await fetch(`/api/databases/${db}`);
    const json = await res.json();
    if (json.success) setDbData(prev => ({ ...prev, [db]: json.data }));
  };

  const currentData = dbData[selected];

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Bancos de Dados</h1>
        <div className="flex gap-2">
          {DB_TYPES.map(db => (
            <Button key={db} variant={selected === db ? 'primary' : 'ghost'} size="sm" onClick={() => setSelected(db)}>{DB_NAMES[db]}</Button>
          ))}
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : currentData ? (
          <DbStatusCard name={DB_NAMES[selected]} installed={currentData.installed} running={currentData.running} version={currentData.version} port={currentData.port} onInstall={() => handleInstall(selected)} />
        ) : <DbStatusCard name={DB_NAMES[selected]} installed={false} running={false} onInstall={() => handleInstall(selected)} />}
      </div>
    </AppLayout>
  );
}
