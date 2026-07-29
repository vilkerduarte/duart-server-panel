import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import DbStatusCard from '@/components/databases/DbStatusCard';
import { HiOutlineServerStack } from 'react-icons/hi2';

const DB_TYPES = ['mysql', 'postgresql', 'mongodb'] as const;
const DB_NAMES: Record<string, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
};
const DB_ICONS: Record<string, string> = {
  mysql: '🐬',
  postgresql: '🐘',
  mongodb: '🍃',
};

export default function DatabasesPage() {
  const [selected, setSelected] = useState<string>('mysql');
  const [dbData, setDbData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const fetchDb = (db: string) => {
    setLoading(true);
    fetch(`/api/databases/${db}`)
      .then(r => r.json())
      .then(j => {
        if (j.success) setDbData(prev => ({ ...prev, [db]: j.data }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDb(selected);
  }, [selected]);

  const handleInstall = async (db: string) => {
    if (!confirm(`Instalar ${DB_NAMES[db]}? Pode levar alguns minutos.`)) return;
    await fetch(`/api/databases/${db}/install`, { method: 'POST' });
    fetchDb(db);
  };

  const currentData = dbData[selected];

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
          <HiOutlineServerStack className="w-6 h-6" /> Bancos de Dados
        </h1>

        {/* DB Type Selector */}
        <div className="flex gap-2">
          {DB_TYPES.map(db => (
            <button
              key={db}
              onClick={() => setSelected(db)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                selected === db
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-color)] hover:text-[var(--text-primary)] hover:border-blue-500/50'
              }`}
            >
              <span className="text-lg">{DB_ICONS[db]}</span>
              {DB_NAMES[db]}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : currentData ? (
          <DbStatusCard
            name={DB_NAMES[selected]}
            type={selected}
            installed={currentData.installed}
            running={currentData.running}
            version={currentData.version || ''}
            port={currentData.port || 0}
            databases={currentData.databases || []}
            users={currentData.users || []}
            onInstall={() => handleInstall(selected)}
            onRefresh={() => fetchDb(selected)}
          />
        ) : (
          <DbStatusCard
            name={DB_NAMES[selected]}
            type={selected}
            installed={false}
            running={false}
            version=""
            port={0}
            databases={[]}
            users={[]}
            onInstall={() => handleInstall(selected)}
            onRefresh={() => fetchDb(selected)}
          />
        )}
      </div>
    </AppLayout>
  );
}
