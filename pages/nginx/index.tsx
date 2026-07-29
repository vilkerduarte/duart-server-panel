import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import SiteForm from '@/components/nginx/SiteForm';
import SiteEditModal from '@/components/nginx/SiteEditModal';
import { useToast } from '@/lib/contexts/ToastContext';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineMagnifyingGlass,
  HiOutlineArrowDownTray, HiOutlineGlobeAlt, HiOutlineServer,
  HiOutlinePencilSquare, HiOutlineShieldCheck, HiOutlineWrench,
  HiOutlinePower, HiOutlinePlay,
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

  // Edit modal
  const [editingSite, setEditingSite] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Action loading states
  const [togglingSite, setTogglingSite] = useState<string | null>(null);
  const [maintenanceSite, setMaintenanceSite] = useState<string | null>(null);

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

  const handleToggle = async (site: any) => {
    setTogglingSite(site.id);
    try {
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, action: 'toggle' }),
      });
      const json = await res.json();
      if (json.success) {
        setSites(prev => prev.map(s => s.id === site.id ? json.data.site : s));
        showToast(json.data.enabled ? `${site.domain} ativado` : `${site.domain} desativado`, 'success');
      } else {
        showToast(json.error || 'Erro ao alternar status', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setTogglingSite(null);
    }
  };

  const handleToggleMaintenance = async (site: any) => {
    setMaintenanceSite(site.id);
    try {
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, action: 'maintenance' }),
      });
      const json = await res.json();
      if (json.success) {
        setSites(prev => prev.map(s => s.id === site.id ? json.data.site : s));
        showToast(
          json.data.maintenance
            ? `Modo manutenção ativado para ${site.domain}`
            : `Modo manutenção desativado para ${site.domain}`,
          'success'
        );
      } else {
        showToast(json.error || 'Erro ao alternar manutenção', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setMaintenanceSite(null);
    }
  };

  const handleEdit = (site: any) => {
    setEditingSite(site);
    setShowEditModal(true);
  };

  const handleEditSubmit = async (data: any) => {
    const res = await fetch('/api/nginx/sites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      setSites(prev => prev.map(s => s.id === json.data.site.id ? json.data.site : s));
      showToast(`${data.domain} atualizado com sucesso`, 'success');
      setShowEditModal(false);
    } else {
      showToast(json.error || 'Erro ao atualizar site', 'error');
    }
  };

  const handleSslUpdate = (updatedSite: any) => {
    setSites(prev => prev.map(s => s.id === updatedSite.id ? updatedSite : s));
  };

  const handleImport = async (vhost: ExternalVhost) => {
    setImportingFile(vhost.fileName);
    try {
      const domain = vhost.domains[0] || vhost.fileName;

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

        {/* Tabs */}
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
                    <div className="space-y-3">
                      {/* Top row: info + actions */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{site.domain}</h3>
                            <Badge variant={site.enabled ? 'success' : 'danger'}>
                              {site.enabled ? 'Ativo' : 'Inativo'}
                            </Badge>
                            {renderTypeBadge(site.type)}
                            {site.ssl && <Badge variant="info">SSL</Badge>}
                            {site.maintenance && <Badge variant="warning">Manutenção</Badge>}
                          </div>
                          <div className="text-sm text-[var(--text-muted)] space-x-4">
                            {site.root && <span>Root: {site.root}</span>}
                            {site.proxyPort && <span>Porta: {site.proxyPort}</span>}
                            {site.websocket && <Badge variant="warning">WS</Badge>}
                            {site.phpVersion && <span>PHP {site.phpVersion}</span>}
                            {site.fileName && <span className="text-xs opacity-60">Arquivo: {site.fileName}</span>}
                          </div>
                          {site.aliases?.length > 0 && (
                            <div className="text-xs text-[var(--text-muted)] mt-1">
                              Aliases: {site.aliases.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons row */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Edit */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(site)}
                          title="Editar configurações"
                        >
                          <HiOutlinePencilSquare className="w-3.5 h-3.5" />
                          Editar
                        </Button>

                        {/* Toggle enable/disable */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(site)}
                          disabled={togglingSite === site.id}
                          title={site.enabled ? 'Desabilitar site' : 'Habilitar site'}
                        >
                          {togglingSite === site.id ? (
                            <Spinner size="sm" />
                          ) : site.enabled ? (
                            <HiOutlinePower className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <HiOutlinePlay className="w-3.5 h-3.5 text-green-400" />
                          )}
                          {site.enabled ? 'Desabilitar' : 'Habilitar'}
                        </Button>

                        {/* Maintenance */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleMaintenance(site)}
                          disabled={maintenanceSite === site.id}
                          title={site.maintenance ? 'Desativar modo manutenção' : 'Ativar modo manutenção'}
                        >
                          {maintenanceSite === site.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <HiOutlineWrench className={`w-3.5 h-3.5 ${site.maintenance ? 'text-amber-400' : ''}`} />
                          )}
                          {site.maintenance ? 'Manutenção ON' : 'Manutenção'}
                        </Button>

                        {/* SSL */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingSite(site);
                            setShowEditModal(true);
                            // Focus SSL tab will happen via SiteEditModal
                          }}
                          title={site.ssl ? 'Gerenciar SSL' : 'Configurar SSL'}
                        >
                          <HiOutlineShieldCheck className={`w-3.5 h-3.5 ${site.ssl ? 'text-green-400' : ''}`} />
                          SSL
                        </Button>

                        {/* Delete */}
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(site.id, site.domain)}
                          title="Remover site"
                        >
                          <HiOutlineTrash className="w-3.5 h-3.5" />
                        </Button>
                      </div>
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

        {editingSite && (
          <SiteEditModal
            open={showEditModal}
            onClose={() => { setShowEditModal(false); setEditingSite(null); }}
            onSubmit={handleEditSubmit}
            site={editingSite}
            onSslUpdate={handleSslUpdate}
          />
        )}
      </div>
    </AppLayout>
  );
}
