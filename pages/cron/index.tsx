import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import CronJobForm from '@/components/cron/CronJobForm';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';

export default function CronPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchJobs = () => {
    fetch('/api/cron/jobs').then(r => r.json()).then(j => { if (j.success) setData(j.data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchJobs(); }, []);

  const handleCreate = async (job: any) => {
    await fetch('/api/cron/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
    fetchJobs();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover job?')) return;
    await fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' });
    fetchJobs();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Tarefas Cron</h1>
          <Button onClick={() => setShowForm(true)}><HiOutlinePlus className="w-4 h-4" /> Novo Job</Button>
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : data ? (
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]"><th className="p-3">Expressão</th><th className="p-3">Comando</th><th className="p-3">Descrição</th><th className="p-3">Tipo</th><th className="p-3"></th></tr></thead>
                <tbody>
                  {[...(data.system || []), ...(data.custom || [])].map((job: any, i: number) => (
                    <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className="p-3 font-mono text-[var(--text-primary)]">{job.expression}</td>
                      <td className="p-3 text-[var(--text-secondary)] font-mono text-xs">{job.command}</td>
                      <td className="p-3 text-[var(--text-muted)]">{job.description}</td>
                      <td className="p-3"><Badge variant={job.type === 'system' ? 'info' : 'warning'}>{job.type === 'system' ? 'Sistema' : job.type || 'Custom'}</Badge></td>
                      <td className="p-3">
                        {job.type !== 'system' && <Button variant="danger" size="sm" onClick={() => handleDelete(job.id)}><HiOutlineTrash className="w-3 h-3" /></Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
        <CronJobForm open={showForm} onClose={() => setShowForm(false)} onSubmit={handleCreate} />
      </div>
    </AppLayout>
  );
}
