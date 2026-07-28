import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import BackupList from '@/components/backup/BackupList';

export default function BackupPage() {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchBackups = () => {
    fetch('/api/backup').then(r => r.json()).then(j => { if (j.success) setBackups(j.data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchBackups(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    const res = await fetch('/api/backup', { method: 'POST' });
    const json = await res.json();
    if (json.success) setBackups(prev => [json.data, ...prev]);
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir backup?')) return;
    await fetch(`/api/backup/${id}`, { method: 'DELETE' });
    setBackups(prev => prev.filter(b => b.id !== id));
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Backup & Restore</h1>
          <Button onClick={handleCreate} loading={creating}>Criar Backup</Button>
        </div>
        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Criar Backup</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">O backup inclui: configurações, usuários, NGINX, SSL, cron jobs e histórico de CPU.</p>
          <Button onClick={handleCreate} loading={creating}>Gerar Backup Agora</Button>
        </Card>
        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Backups Anteriores</h3>
          {loading ? <Spinner size="md" /> : <BackupList backups={backups} onDelete={handleDelete} />}
        </Card>
      </div>
    </AppLayout>
  );
}
