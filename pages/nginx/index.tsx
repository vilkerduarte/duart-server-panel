import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import SiteForm from '@/components/nginx/SiteForm';
import { useToast } from '@/lib/contexts/ToastContext';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineMagnifyingGlass,
  HiOutlineArrowDownTray, HiOutlineGlobeAlt, HiOutlineServer,
} from 'react-icons/hi2';

interface ExternalVhost {
  fileName: string;
  configPath: string;
  enabled: boolean;
  domains: string[];
  root: string | null;
  proxyPass: string | null;
  websocket: boolean;
  phpFpmSocket: string | null;
  detectedType: 'static' | 'php' | 'proxy' | 'unknown';
  managed: boolean;
  panelId: string | null;
  listenPorts: string[];
  ssl: boolean;
  rawConfigPreview: string;
}

export default function NginxPage() {
  const { showToast } = useToast();
  const [sites, setSites] = useState<any[]>([]);
  const [externalVhosts, setExternalVhosts] = useState<ExternalVhost[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showExternal, setShowExternal] = useState(false);
  const [activeTab, setActiveTab] = useState<'managed' | 'external'>('managed');
  const [importingFile, setImportingFile] = useState<string | null>(null);

  const fetchSites = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/nginx/sites');
      const json = await res.json();
      if (json.success) {
        setSites(json.data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setShowExternal(true);
    try {
      const res = await fetch('/api/nginx/sites?scan=true');
      const json = await res.json();
      if (json.success) {
        setSites(json.data.managed || []);
        setExternalVhosts(json.data.external || []);
        showToast(`${json.data.totalExternal} vhost(s) externo(s) encontrado(s)`, 'info');
      }
    } catch {
      showToast('Erro ao escanear vhosts', 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleCreate = async (data: any) => {
    const res = await fetch('/api/nginx/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      setSites(prev => [...prev, json.data.site]);
      showToast('Site criado com sucesso', 'success');
    } else {
      showToast(json.error || 'Erro ao criar site', 'error');
    }
  };

  const handleDelete = async (id: string, domain: string) => {
    if (!confirm(`Remover ${domain}?`)) return;
    await fetch(`/api/nginx/sites?id=${id}`, { method: 'DELETE' });
    setSites(prev => prev.filter(s => s.id !== id));
    showToast(`${domain} removido`, 'success');
  };

  const handleImport = async (vhost: ExternalVhost) => {
    setImportingFile(vhost.fileName);
    try {
      const domain = vhost.domains[0] || vhost.fileName;

      // Try to extract proxy port if applicable
      let proxyPort: number | undefined;
      if (vhost.proxyPass) {
        const match = vhost.proxyPass.match(/:(\d+)/);
        if (match) proxyPort = parseInt(match[1]);
      }

      const body: any = {
        fileName: vhost.fileName,
        domain,
        type: vhost.detectedType !== 'unknown' ? vhost.detectedType : undefined,
        root: vhost.root,
        proxyPort,
        websocket: vhost.websocket,
      };

      const res = await fetch('/api/nginx/sites/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        setSites(prev => [...prev, json.data.site]);
        setExternalVhosts(prev => prev.filter(v => v.fileName !== vhost.fileName));
        showToast(`${vhost.fileName} importado com sucesso`, 'success');
      } else {
        showToast(json.error || 'Erro ao importar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setImportingFile(null);
    }
  };

  const renderTypeLabel = (type: string) => {
    switch (type) {
      case 'static': return 'Estático';
      case 'php': return 'PHP';
      case 'proxy': return 'Proxy';
      default: return type;
    }
  };

  const renderTypeBadge = (type: string) => {
    switch (type) {
      case 'static': return <Badge variant="default">{renderTypeLabel(type)}</Badge>;
      case 'php': return <Badge variant="info">{renderTypeLabel(type)}</Badge>;
      case 'proxy': return <Badge variant="warning">{renderTypeLabel(type)}</Badge>;
      default: return <Badge>{renderTypeLabel(type)}</Badge>;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">NGINX Manager</h1>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleScan} disabled={scanning}>
              <HiOutlineMagnifyingGlass className="w-4 h-4" />
              {scanning ? 'Escaneando...' : 'Escanear Vhosts'}
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <HiOutlinePlus className="w-4 h-4" /> Novo Site
            </Button>
          </div>
        </div>

        {/* Tabs (only show when external vhosts exist) */}
        {externalVhosts.length > 0 && (
          <div className="flex gap-1 bg-[var(--bg-secondary)] rounded-lg p-1 w-fit">
            <button
              onClick={() => setActiveTab('managed')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === 'managed'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Gerenciados ({sites.length})
            </button>
            <button
              onClick={() => setActiveTab('external')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'external'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Externos ({externalVhosts.length})
              {externalVhosts.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Managed Sites */}
            {activeTab === 'managed' && (
              <div className="grid gap-4">
                {sites.map(site => (
                  <Card key={site.id}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{site.domain}</h3>
                          <Badge variant={site.enabled ? 'success' : 'danger'}>{site.enabled ? 'Ativo' : 'Inativo'}</Badge>
                          {renderTypeBadge(site.type)}
                          {site.ssl && <Badge variant="info">SSL</Badge>}
                        </div>
                        <div className="text-sm text-[var(--text-muted)] space-x-4">
                          {site.root && <span>Root: {site.root}</span>}
                          {site.proxyPort && <span>Porta: {site.proxyPort}</span>}
                          {site.websocket && <Badge variant="warning">WS</Badge>}
                          {site.fileName && <span className="text-xs opacity-60">Arquivo: {site.fileName}</span>}
                        </div>
                      </div>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(site.id, site.domain)}>
                        <HiOutlineTrash className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
                {sites.length === 0 && (
                  <Card>
                    <div className="text-center py-12">
                      <HiOutlineGlobeAlt className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                      <p className="text-[var(--text-muted)] mb-2">Nenhum site gerenciado</p>
                      <p className="text-xs text-[var(--text-muted)] opacity-70 mb-4">
                        Clique em "Escanear Vhosts" para encontrar sites existentes ou crie um novo.
                      </p>
                      <Button size="sm" variant="ghost" onClick={handleScan} disabled={scanning}>
                        <HiOutlineMagnifyingGlass className="w-4 h-4" />
                        Escanear Vhosts
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* External Vhosts */}
            {activeTab === 'external' && (
              <div className="grid gap-4">
                {externalVhosts.map(vhost => (
                  <Card key={vhost.fileName}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <HiOutlineServer className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          <h3 className="text-lg font-semibold text-[var(--text-primary)] truncate">
                            {vhost.domains.length > 0 ? vhost.domains.join(', ') : vhost.fileName}
                          </h3>
                          <Badge variant={vhost.enabled ? 'success' : 'danger'}>
                            {vhost.enabled ? 'Ativo' : 'Inativo'}
                          </Badge>
                          {renderTypeBadge(vhost.detectedType)}
                          {vhost.ssl && <Badge variant="info">SSL</Badge>}
                          <span className="text-[10px] text-amber-400/70 bg-amber-400/10 px-1.5 py-0.5 rounded">
                            não gerenciado
                          </span>
                        </div>
                        <div className="text-sm text-[var(--text-muted)] space-x-4">
                          {vhost.root && <span>Root: {vhost.root}</span>}
                          {vhost.proxyPass && <span>Proxy: {vhost.proxyPass}</span>}
                          {vhost.phpFpmSocket && <span>PHP-FPM: {vhost.phpFpmSocket}</span>}
                          <span className="text-xs opacity-60">Arquivo: {vhost.fileName}</span>
                          {vhost.listenPorts.length > 0 && (
                            <span className="text-xs">Portas: {vhost.listenPorts.join(', ')}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleImport(vhost)}
                        disabled={importingFile === vhost.fileName}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 ml-3 flex-shrink-0 transition-colors"
                      >
                        <HiOutlineArrowDownTray className="w-3.5 h-3.5" />
                        {importingFile === vhost.fileName ? 'Importando...' : 'Importar'}
                      </button>
                    </div>
                  </Card>
                ))}
                {externalVhosts.length === 0 && (
                  <Card>
                    <div className="text-center py-12">
                      <HiOutlineServer className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                      <p className="text-[var(--text-muted)]">
                        Nenhum vhost externo encontrado em /etc/nginx/sites-available/
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            )}
          </>
        )}

        <SiteForm open={showForm} onClose={() => setShowForm(false)} onSubmit={handleCreate} />
      </div>
    </AppLayout>
  );
}
