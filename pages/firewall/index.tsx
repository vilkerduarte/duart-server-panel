import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

interface FirewallRule {
  number: string;
  action: string;
  details: string;
}

export default function FirewallPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/firewall/rules')
      .then(res => res.json())
      .then(json => { if (json.success) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getActionBadge(action: string) {
    switch (action) {
      case 'allow': return <Badge variant="success">ALLOW</Badge>;
      case 'deny': return <Badge variant="danger">DENY</Badge>;
      case 'reject': return <Badge variant="warning">REJECT</Badge>;
      case 'limit': return <Badge variant="info">LIMIT</Badge>;
      default: return <Badge>{action}</Badge>;
    }
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Firewall (UFW)</h1>
          {data && (
            <Badge variant={data.status === 'active' ? 'success' : 'danger'}>
              {data.status === 'active' ? 'ATIVO' : 'INATIVO'}
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : data ? (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[var(--text-muted)]">Entrada padrão: </span>
                  <span className="text-[var(--text-primary)] uppercase">{data.defaultIncoming}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Saída padrão: </span>
                  <span className="text-[var(--text-primary)] uppercase">{data.defaultOutgoing}</span>
                </div>
              </div>
            </Card>

            <Card padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                      <th className="p-3">#</th>
                      <th className="p-3">Ação</th>
                      <th className="p-3">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rules.map((rule: FirewallRule, i: number) => (
                      <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors text-sm">
                        <td className="p-3 text-[var(--text-muted)]">{rule.number}</td>
                        <td className="p-3">{getActionBadge(rule.action)}</td>
                        <td className="p-3 text-[var(--text-secondary)] font-mono text-xs">{rule.details}</td>
                      </tr>
                    ))}
                    {data.rules.length === 0 && (
                      <tr><td colSpan={3} className="p-8 text-center text-[var(--text-muted)]">Nenhuma regra configurada</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <Card><p className="text-center text-[var(--text-muted)] py-8">Erro ao carregar regras</p></Card>
        )}
      </div>
    </AppLayout>
  );
}
