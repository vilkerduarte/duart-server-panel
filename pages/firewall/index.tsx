import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import RuleForm from '@/components/firewall/RuleForm';
import { HiOutlinePlus } from 'react-icons/hi2';

export default function FirewallPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchRules = () => {
    fetch('/api/firewall/rules').then(r => r.json()).then(j => { if (j.success) setData(j.data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchRules(); }, []);

  const handleAddRule = async (rule: any) => {
    await fetch('/api/firewall/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) });
    fetchRules();
  };

  const handleToggle = async (enable: boolean) => {
    if (!confirm(`${enable ? 'Ativar' : 'Desativar'} o firewall?`)) return;
    await fetch('/api/firewall/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enable }) });
    fetchRules();
  };

  const getActionBadge = (a: string) => {
    switch (a) { case 'allow': return <Badge variant="success">ALLOW</Badge>; case 'deny': return <Badge variant="danger">DENY</Badge>; case 'reject': return <Badge variant="warning">REJECT</Badge>; case 'limit': return <Badge variant="info">LIMIT</Badge>; default: return <Badge>{a}</Badge>; }
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Firewall (UFW)</h1>
          <div className="flex gap-2">
            {data && <Badge variant={data.status === 'active' ? 'success' : 'danger'}>{data.status === 'active' ? 'ATIVO' : 'INATIVO'}</Badge>}
            {data && <Button size="sm" variant={data.status === 'active' ? 'danger' : 'success'} onClick={() => handleToggle(data.status !== 'active')}>{data.status === 'active' ? 'Desativar' : 'Ativar'}</Button>}
            <Button size="sm" onClick={() => setShowForm(true)}><HiOutlinePlus className="w-4 h-4" /> Regra</Button>
          </div>
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : data ? (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-[var(--text-muted)]">Entrada padrão: </span><span className="text-[var(--text-primary)] uppercase">{data.defaultIncoming}</span></div>
                <div><span className="text-[var(--text-muted)]">Saída padrão: </span><span className="text-[var(--text-primary)] uppercase">{data.defaultOutgoing}</span></div>
              </div>
            </Card>
            <Card padding={false}>
              <table className="w-full">
                <thead><tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]"><th className="p-3">#</th><th className="p-3">Ação</th><th className="p-3">Detalhes</th></tr></thead>
                <tbody>
                  {data.rules?.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-sm">
                      <td className="p-3 text-[var(--text-muted)]">{r.number}</td><td className="p-3">{getActionBadge(r.action)}</td><td className="p-3 text-[var(--text-secondary)] font-mono text-xs">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        ) : <Card><p className="text-center text-[var(--text-muted)] py-8">Erro ao carregar</p></Card>}
        <RuleForm open={showForm} onClose={() => setShowForm(false)} onSubmit={handleAddRule} />
      </div>
    </AppLayout>
  );
}
