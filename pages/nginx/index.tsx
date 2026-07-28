import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';

interface NginxSite {
  id: string;
  domain: string;
  type: 'static' | 'php' | 'proxy';
  root?: string;
  proxyPort?: number;
  websocket: boolean;
  ssl: boolean;
  enabled: boolean;
}

export default function NginxPage() {
  const [sites, setSites] = useState<NginxSite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/nginx/sites')
      .then(res => res.json())
      .then(json => { if (json.success) setSites(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, domain: string) {
    if (!confirm(`Remover site ${domain}?`)) return;
    await fetch(`/api/nginx/sites?id=${id}`, { method: 'DELETE' });
    setSites(prev => prev.filter(s => s.id !== id));
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">NGINX Manager</h1>
          <Button><HiOutlinePlus className="w-4 h-4" /> Novo Site</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <div className="grid gap-4">
            {sites.map(site => (
              <Card key={site.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{site.domain}</h3>
                      <Badge variant={site.enabled ? 'success' : 'danger'}>
                        {site.enabled ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <Badge variant={site.type === 'php' ? 'info' : site.type === 'proxy' ? 'warning' : 'default'}>
                        {site.type === 'static' ? 'Estático' : site.type === 'php' ? 'PHP' : 'Proxy'}
                      </Badge>
                    </div>
                    <div className="text-sm text-[var(--text-muted)] space-x-4">
                      {site.root && <span>Root: {site.root}</span>}
                      {site.proxyPort && <span>Porta: {site.proxyPort}</span>}
                      {site.websocket && <span>WebSocket</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm">Editar</Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(site.id, site.domain)}>
                      <HiOutlineTrash className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {sites.length === 0 && (
              <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum site configurado</p></Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
