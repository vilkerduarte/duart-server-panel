import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import SiteForm from '@/components/nginx/SiteForm';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';

export default function NginxPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetch('/api/nginx/sites').then(r => r.json()).then(j => { if (j.success) setSites(j.data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (data: any) => {
    const res = await fetch('/api/nginx/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const json = await res.json();
    if (json.success) setSites(prev => [...prev, json.data.site]);
  };

  const handleDelete = async (id: string, domain: string) => {
    if (!confirm(`Remover ${domain}?`)) return;
    await fetch(`/api/nginx/sites?id=${id}`, { method: 'DELETE' });
    setSites(prev => prev.filter(s => s.id !== id));
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">NGINX Manager</h1>
          <Button onClick={() => setShowForm(true)}><HiOutlinePlus className="w-4 h-4" /> Novo Site</Button>
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <div className="grid gap-4">
            {sites.map(site => (
              <Card key={site.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{site.domain}</h3>
                      <Badge variant={site.enabled ? 'success' : 'danger'}>{site.enabled ? 'Ativo' : 'Inativo'}</Badge>
                      <Badge variant="info">{site.type === 'static' ? 'Estático' : site.type === 'php' ? 'PHP' : 'Proxy'}</Badge>
                    </div>
                    <div className="text-sm text-[var(--text-muted)] space-x-4">
                      {site.root && <span>Root: {site.root}</span>}
                      {site.proxyPort && <span>Porta: {site.proxyPort}</span>}
                      {site.websocket && <Badge variant="warning">WS</Badge>}
                    </div>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(site.id, site.domain)}><HiOutlineTrash className="w-4 h-4" /></Button>
                </div>
              </Card>
            ))}
            {sites.length === 0 && <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum site configurado</p></Card>}
          </div>
        )}
        <SiteForm open={showForm} onClose={() => setShowForm(false)} onSubmit={handleCreate} />
      </div>
    </AppLayout>
  );
}
