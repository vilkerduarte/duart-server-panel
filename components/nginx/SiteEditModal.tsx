import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import SslConfigModal from './SslConfigModal';

interface SiteEditModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  site: any;
  onSslUpdate?: (site: any) => void;
}

type TabKey = 'general' | 'php' | 'ssl' | 'security' | 'advanced';

export default function SiteEditModal({ open, onClose, onSubmit, site, onSslUpdate }: SiteEditModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [showSslModal, setShowSslModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // General
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('static');
  const [root, setRoot] = useState('');
  const [proxyPort, setProxyPort] = useState(3000);
  const [proxyUrl, setProxyUrl] = useState('');
  const [websocket, setWebsocket] = useState(false);
  const [aliases, setAliases] = useState('');
  const [listenPort, setListenPort] = useState('');

  // PHP
  const [phpVersion, setPhpVersion] = useState('8.3');

  // SSL
  const [hasSsl, setHasSsl] = useState(false);
  const [sslCertId, setSslCertId] = useState('');

  // Security
  const [hstsMaxAge, setHstsMaxAge] = useState('');
  const [authBasicFile, setAuthBasicFile] = useState('');
  const [authBasicRealm, setAuthBasicRealm] = useState('');
  const [allowIps, setAllowIps] = useState('');
  const [denyIps, setDenyIps] = useState('');

  // Advanced
  const [clientMaxBodySize, setClientMaxBodySize] = useState('');
  const [gzip, setGzip] = useState(true);
  const [cacheStaticDuration, setCacheStaticDuration] = useState('');
  const [customDirectives, setCustomDirectives] = useState('');

  useEffect(() => {
    if (site && open) {
      setDomain(site.domain || '');
      setType(site.type || 'static');
      setRoot(site.root || '');
      setProxyPort(site.proxyPort || 3000);
      setProxyUrl(site.proxyUrl || '');
      setWebsocket(site.websocket || false);
      setAliases((site.aliases || []).join(', '));
      setListenPort(site.listenPort || '');
      setPhpVersion(site.phpVersion || '8.3');
      setHasSsl(site.ssl || false);
      setSslCertId(site.sslCertId || '');
      setHstsMaxAge(site.hstsMaxAge ? String(site.hstsMaxAge) : '');
      setAuthBasicFile(site.authBasicFile || '');
      setAuthBasicRealm(site.authBasicRealm || '');
      setAllowIps((site.allowIps || []).join(', '));
      setDenyIps((site.denyIps || []).join(', '));
      setClientMaxBodySize(site.clientMaxBodySize || '');
      setGzip(site.gzip !== false);
      setCacheStaticDuration(site.cacheStaticDuration || '');
      setCustomDirectives(site.customDirectives || '');
    }
  }, [site, open]);

  const handleSubmit = async () => {
    setSaving(true);
    const data: any = {
      id: site.id,
      domain,
      type,
      websocket: type === 'proxy' ? websocket : undefined,
      phpVersion: type === 'php' ? phpVersion : undefined,
      gzip,
    };

    if (type === 'static' || type === 'php') {
      data.root = root;
    }

    if (type === 'proxy') {
      data.proxyPort = proxyPort;
      if (proxyUrl) data.proxyUrl = proxyUrl;
    }

    // Aliases
    if (aliases.trim()) {
      data.aliases = aliases.split(',').map((a: string) => a.trim()).filter(Boolean);
    } else {
      data.aliases = [];
    }

    // Listen port
    if (listenPort) data.listenPort = Number(listenPort);

    // SSL
    data.ssl = hasSsl;

    // Security
    if (hstsMaxAge) data.hstsMaxAge = Number(hstsMaxAge);
    if (authBasicFile) data.authBasicFile = authBasicFile;
    if (authBasicRealm) data.authBasicRealm = authBasicRealm;
    if (allowIps.trim()) data.allowIps = allowIps.split(',').map((a: string) => a.trim()).filter(Boolean);
    if (denyIps.trim()) data.denyIps = denyIps.split(',').map((a: string) => a.trim()).filter(Boolean);

    // Advanced
    if (clientMaxBodySize) data.clientMaxBodySize = clientMaxBodySize;
    if (cacheStaticDuration) data.cacheStaticDuration = cacheStaticDuration;
    if (customDirectives) data.customDirectives = customDirectives;

    await onSubmit(data);
    setSaving(false);
  };

  const handleSslConfigured = (updatedSite: any) => {
    setHasSsl(true);
    setSslCertId(updatedSite.sslCertId || '');
    setShowSslModal(false);
    if (onSslUpdate) onSslUpdate(updatedSite);
  };

  const handleRemoveSsl = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, action: 'ssl_remove' }),
      });
      const json = await res.json();
      if (json.success) {
        setHasSsl(false);
        setSslCertId('');
        if (onSslUpdate) onSslUpdate(json.data.site);
      }
    } catch {} finally {
      setSaving(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'general', label: 'Geral' },
    { key: 'php', label: 'PHP' },
    { key: 'ssl', label: 'SSL' },
    { key: 'security', label: 'Segurança' },
    { key: 'advanced', label: 'Avançado' },
  ];

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Editar: ${site?.domain || ''}`} size="xl">
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-[var(--bg-secondary)] rounded-lg p-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="space-y-3">
              <Input label="Domínio" value={domain} onChange={e => setDomain(e.target.value)} placeholder="meusite.com" />
              <Select label="Tipo" value={type} onChange={e => setType(e.target.value)}
                options={[
                  { value: 'static', label: 'Estático' },
                  { value: 'php', label: 'PHP' },
                  { value: 'proxy', label: 'Proxy Reverso' },
                ]} />

              {(type === 'static' || type === 'php') && (
                <Input label="Document Root" value={root} onChange={e => setRoot(e.target.value)} placeholder="/var/www/meusite" />
              )}

              {type === 'proxy' && (
                <>
                  <Input label="Porta do Proxy" type="number" value={String(proxyPort)} onChange={e => setProxyPort(Number(e.target.value))} />
                  <Input label="URL do Proxy (opcional)" value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="http://localhost:3000" />
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={websocket} onChange={e => setWebsocket(e.target.checked)} className="rounded" />
                    <span className="text-[var(--text-secondary)]">Suporte a WebSocket</span>
                  </label>
                </>
              )}

              <Input label="Porta de Escuta (padrão: 80 ou 443 SSL)" type="number" value={listenPort} onChange={e => setListenPort(e.target.value)} placeholder="80" />
              <Input label="Aliases (separados por vírgula)" value={aliases} onChange={e => setAliases(e.target.value)} placeholder="www.meusite.com, meusite.net" />
            </div>
          )}

          {/* PHP Tab */}
          {activeTab === 'php' && (
            <div className="space-y-3">
              {type !== 'php' ? (
                <div className="text-center py-8 text-[var(--text-muted)]">
                  <p>Altere o tipo do site para "PHP" na aba Geral para configurar opções PHP.</p>
                </div>
              ) : (
                <>
                  <Select label="Versão do PHP" value={phpVersion} onChange={e => setPhpVersion(e.target.value)}
                    options={[
                      { value: '5.6', label: 'PHP 5.6' },
                      { value: '7.0', label: 'PHP 7.0' },
                      { value: '7.1', label: 'PHP 7.1' },
                      { value: '7.2', label: 'PHP 7.2' },
                      { value: '7.3', label: 'PHP 7.3' },
                      { value: '7.4', label: 'PHP 7.4' },
                      { value: '8.0', label: 'PHP 8.0' },
                      { value: '8.1', label: 'PHP 8.1' },
                      { value: '8.2', label: 'PHP 8.2' },
                      { value: '8.3', label: 'PHP 8.3' },
                    ]} />
                  <div className="text-xs text-[var(--text-muted)] bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                    Certifique-se de que a versão PHP selecionada está instalada no servidor e o socket PHP-FPM correspondente existe em /var/run/php/.
                  </div>
                </>
              )}
            </div>
          )}

          {/* SSL Tab */}
          {activeTab === 'ssl' && (
            <div className="space-y-3">
              {hasSsl ? (
                <div className="space-y-3">
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full bg-green-500" />
                      <span className="text-sm font-medium text-green-500">SSL Ativo</span>
                    </div>
                    {site?.sslCertPath && (
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        Certificado: {site.sslCertPath}
                      </p>
                    )}
                    {site?.sslKeyPath && (
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        Chave: {site.sslKeyPath}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setShowSslModal(true)}>
                      Trocar Certificado
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleRemoveSsl} loading={saving}>
                      Remover SSL
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-center py-6 bg-[var(--bg-secondary)] rounded-lg">
                    <p className="text-[var(--text-muted)] mb-3">Nenhum certificado SSL configurado</p>
                    <Button size="sm" onClick={() => setShowSslModal(true)}>
                      Configurar SSL
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-3">
              <Input label="HSTS Max Age (segundos, 0 = desabilitado)" type="number" value={hstsMaxAge} onChange={e => setHstsMaxAge(e.target.value)} placeholder="31536000" />
              <div className="text-xs text-[var(--text-muted)]">Recomendado: 31536000 (1 ano). Requer SSL ativo.</div>

              <div className="border-t border-[var(--border-color)] pt-3" />

              <Input label="Arquivo de Autenticação Básica (.htpasswd)" value={authBasicFile} onChange={e => setAuthBasicFile(e.target.value)} placeholder="/etc/nginx/.htpasswd-meusite" />
              <Input label="Mensagem do Realm" value={authBasicRealm} onChange={e => setAuthBasicRealm(e.target.value)} placeholder="Área Restrita" />
              <div className="text-xs text-[var(--text-muted)]">Use htpasswd -c /path/.htpasswd usuario para criar o arquivo.</div>

              <div className="border-t border-[var(--border-color)] pt-3" />

              <Input label="IPs Permitidos (separados por vírgula)" value={allowIps} onChange={e => setAllowIps(e.target.value)} placeholder="192.168.1.0/24, 10.0.0.1" />
              <Input label="IPs Bloqueados (separados por vírgula)" value={denyIps} onChange={e => setDenyIps(e.target.value)} placeholder="1.2.3.4" />
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && (
            <div className="space-y-3">
              <Input label="Client Max Body Size" value={clientMaxBodySize} onChange={e => setClientMaxBodySize(e.target.value)} placeholder="50m" />
              <div className="text-xs text-[var(--text-muted)]">Ex: 10m, 50m, 1g. Limite para upload de arquivos.</div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={gzip} onChange={e => setGzip(e.target.checked)} className="rounded" />
                <span className="text-[var(--text-secondary)]">Ativar Gzip Compression</span>
              </label>

              <Input label="Cache de Assets Estáticos (duração)" value={cacheStaticDuration} onChange={e => setCacheStaticDuration(e.target.value)} placeholder="30d" />
              <div className="text-xs text-[var(--text-muted)]">Ex: 7d, 30d. Aplica expires header para arquivos estáticos.</div>

              <div className="border-t border-[var(--border-color)] pt-3" />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--text-secondary)]">Diretivas NGINX Customizadas</label>
                <textarea
                  value={customDirectives}
                  onChange={e => setCustomDirectives(e.target.value)}
                  placeholder={`location /api/ {\n    proxy_pass http://localhost:4000;\n}`}
                  rows={6}
                  className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono resize-y"
                />
              </div>
              <div className="text-xs text-[var(--text-muted)]">Estas diretivas serão inseridas dentro do bloco server {'{ }'}.</div>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSubmit} loading={saving}>Salvar Alterações</Button>
          </div>
        </div>
      </Modal>

      <SslConfigModal
        open={showSslModal}
        onClose={() => setShowSslModal(false)}
        site={site}
        onConfigured={handleSslConfigured}
      />
    </>
  );
}
