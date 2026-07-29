import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import RuleForm from '@/components/firewall/RuleForm';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineShieldCheck, HiOutlineShieldExclamation } from 'react-icons/hi2';

interface IptablesRule {
  number: string;
  chain: string;
  target: string;
  prot: string;
  opt: string;
  source: string;
  destination: string;
  extra: string;
}

export default function FirewallPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ chain: string; number: string } | null>(null);
  const [activeChain, setActiveChain] = useState('INPUT');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRules = () => {
    setLoading(true);
    fetch('/api/firewall/rules').then(r => r.json()).then(j => {
      if (j.success) setData(j.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchRules(); }, []);

  const handleAddRule = async (rule: any) => {
    await fetch('/api/firewall/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    fetchRules();
  };

  const handleToggle = async (enable: boolean) => {
    if (!confirm(`${enable ? 'Ativar' : 'Desativar'} o firewall (iptables)?\n\n${enable ? 'Isso definirá políticas DROP para INPUT e adicionará regras básicas (SSH, HTTP, HTTPS).' : 'Isso limpará TODAS as regras e definirá ACCEPT como padrão.'}`)) return;
    setActionLoading(true);
    await fetch('/api/firewall/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable }),
    });
    fetchRules();
    setActionLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch('/api/firewall/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: deleteTarget.chain, ruleNumber: deleteTarget.number }),
    });
    setDeleteTarget(null);
    fetchRules();
  };

  const getTargetBadge = (target: string) => {
    switch (target) {
      case 'ACCEPT': return <Badge variant="success">ACCEPT</Badge>;
      case 'DROP': return <Badge variant="danger">DROP</Badge>;
      case 'REJECT': return <Badge variant="warning">REJECT</Badge>;
      case 'LOG': return <Badge variant="info">LOG</Badge>;
      default: return <Badge>{target}</Badge>;
    }
  };

  const currentRules = data?.rulesByChain?.[activeChain] || [];

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Firewall (iptables)</h1>
          <div className="flex gap-2">
            {data && (
              <Badge variant={data.status === 'active' ? 'success' : 'danger'}>
                {data.status === 'active' ? (
                  <span className="flex items-center gap-1"><HiOutlineShieldCheck className="w-4 h-4" /> ATIVO</span>
                ) : (
                  <span className="flex items-center gap-1"><HiOutlineShieldExclamation className="w-4 h-4" /> INATIVO</span>
                )}
              </Badge>
            )}
            {data && (
              <Button
                size="sm"
                variant={data.status === 'active' ? 'danger' : 'success'}
                onClick={() => handleToggle(data.status !== 'active')}
                loading={actionLoading}
              >
                {data.status === 'active' ? 'Desativar' : 'Ativar'}
              </Button>
            )}
            <Button size="sm" onClick={() => setShowForm(true)}>
              <HiOutlinePlus className="w-4 h-4" /> Regra
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : data ? (
          <>
            {/* Default Policies */}
            <Card>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Políticas Padrão</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {data.chains.map((chain: string) => (
                  <div key={chain} className="flex items-center gap-2">
                    <span className="text-[var(--text-muted)] font-mono">{chain}:</span>
                    <Badge variant={data.defaultPolicies[chain] === 'DROP' ? 'danger' : data.defaultPolicies[chain] === 'ACCEPT' ? 'success' : 'warning'}>
                      {data.defaultPolicies[chain] || '?'}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>

            {/* Chain Tabs */}
            <div className="flex gap-1">
              {data.chains.map((chain: string) => (
                <button
                  key={chain}
                  onClick={() => setActiveChain(chain)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                    activeChain === chain
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border-t border-x border-[var(--border-color)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {chain}
                  <span className="ml-2 text-xs opacity-60">({data.rulesByChain?.[chain]?.length || 0})</span>
                </button>
              ))}
            </div>

            {/* Rules Table */}
            <Card padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                      <th className="p-3 w-10">#</th>
                      <th className="p-3">Alvo</th>
                      <th className="p-3">Protocolo</th>
                      <th className="p-3">Origem</th>
                      <th className="p-3">Destino</th>
                      <th className="p-3">Detalhes</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRules.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-[var(--text-muted)] text-sm">
                          Nenhuma regra na chain {activeChain}
                        </td>
                      </tr>
                    )}
                    {currentRules.map((rule: IptablesRule) => (
                      <tr key={`${rule.chain}-${rule.number}`} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-sm">
                        <td className="p-3 text-[var(--text-muted)] font-mono">{rule.number}</td>
                        <td className="p-3">{getTargetBadge(rule.target)}</td>
                        <td className="p-3 text-[var(--text-secondary)]">{rule.prot}</td>
                        <td className="p-3 text-[var(--text-secondary)] font-mono text-xs">{rule.source}</td>
                        <td className="p-3 text-[var(--text-secondary)] font-mono text-xs">{rule.destination}</td>
                        <td className="p-3 text-[var(--text-muted)] font-mono text-xs">{rule.extra}</td>
                        <td className="p-3">
                          <button
                            onClick={() => setDeleteTarget({ chain: rule.chain, number: rule.number })}
                            className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                            title="Remover regra"
                          >
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Quick Info */}
            <Card>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                <strong>iptables</strong> é o firewall nativo do kernel Linux. As regras são organizadas em chains:
                <strong> INPUT</strong> (tráfego de entrada), <strong>OUTPUT</strong> (tráfego de saída) e <strong>FORWARD</strong> (tráfego roteado).
                Cada chain tem uma política padrão (ACCEPT ou DROP) e regras avaliadas em ordem.
                Para salvar permanentemente as regras, execute: <code className="text-blue-400">sudo iptables-save</code> ou instale <code className="text-blue-400">iptables-persistent</code>.
              </p>
            </Card>
          </>
        ) : (
          <Card><p className="text-center text-[var(--text-muted)] py-8">Erro ao carregar regras do iptables</p></Card>
        )}

        <RuleForm open={showForm} onClose={() => setShowForm(false)} onSubmit={handleAddRule} />

        <ConfirmDialog
          open={!!deleteTarget}
          title="Remover Regra"
          message={`Deseja remover a regra #${deleteTarget?.number} da chain ${deleteTarget?.chain}?`}
          confirmLabel="Remover"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      </div>
    </AppLayout>
  );
}
