import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/lib/contexts/ToastContext';
import {
  HiOutlineShieldCheck, HiOutlineKey, HiOutlineGlobeAlt,
  HiOutlineCloudArrowUp, HiOutlineDocumentText,
} from 'react-icons/hi2';

interface SslConfigModalProps {
  open: boolean;
  onClose: () => void;
  site: any;
  onConfigured: (updatedSite: any) => void;
}

type SslMethod = 'letsencrypt' | 'existing' | 'manual';

interface ExistingCert {
  id: string;
  domains: string[];
  type: string;
  issuer: string;
  validUntil: string;
  status: string;
  certPath: string;
  keyPath: string;
  chainPath: string | null;
}

const SSL_PROGRESS_STEPS = [
  { key: 'validating', label: 'Validando domínio e configurações...' },
  { key: 'issuing', label: 'Emitindo certificado SSL (isso pode levar até 2 minutos)...' },
  { key: 'configuring', label: 'Aplicando certificado na configuração NGINX...' },
  { key: 'testing', label: 'Testando configuração NGINX...' },
  { key: 'reloading', label: 'Recarregando NGINX...' },
];

export default function SslConfigModal({ open, onClose, site, onConfigured }: SslConfigModalProps) {
  const { showToast } = useToast();
  const [method, setMethod] = useState<SslMethod>('letsencrypt');
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  // Let's Encrypt
  const [email, setEmail] = useState('');

  // Existing certificates
  const [certificates, setCertificates] = useState<ExistingCert[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [selectedCertId, setSelectedCertId] = useState('');

  // Manual
  const [certPath, setCertPath] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [chainPath, setChainPath] = useState('');

  useEffect(() => {
    if (open && method === 'existing') {
      fetchCertificates();
    }
  }, [open, method]);

  const fetchCertificates = async () => {
    setLoadingCerts(true);
    try {
      const res = await fetch('/api/ssl/certificates');
      const json = await res.json();
      if (json.success) {
        setCertificates(json.data || []);
      }
    } catch {} finally {
      setLoadingCerts(false);
    }
  };

  const handleIssueLetsEncrypt = async () => {
    if (!email) {
      showToast('Email é obrigatório para Let\'s Encrypt', 'error');
      return;
    }

    setLoading(true);
    setCompletedSteps([]);
    setProgressStep('validating');

    try {
      setProgressStep('issuing');
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          action: 'ssl_issue',
          email,
        }),
      });

      setProgressStep('configuring');
      setCompletedSteps(prev => [...prev, 'issuing']);

      const json = await res.json();
      if (json.success) {
        setProgressStep('testing');
        setCompletedSteps(prev => [...prev, 'configuring']);

        // Brief pause to show progress
        await new Promise(r => setTimeout(r, 400));

        setProgressStep('reloading');
        setCompletedSteps(prev => [...prev, 'testing']);

        await new Promise(r => setTimeout(r, 300));
        setCompletedSteps(prev => [...prev, 'reloading']);

        showToast('Certificado SSL emitido com sucesso!', 'success');
        onConfigured(json.data.site);
        onClose();
      } else {
        showToast(json.error || 'Erro ao emitir certificado', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
      setProgressStep('');
    }
  };

  const handleUseExistingCert = async () => {
    if (!selectedCertId) {
      showToast('Selecione um certificado', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          action: 'ssl_issue',
          certId: selectedCertId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('Certificado SSL aplicado com sucesso!', 'success');
        onConfigured(json.data.site);
        onClose();
      } else {
        showToast(json.error || 'Erro ao aplicar certificado', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManualCert = async () => {
    if (!certPath || !keyPath) {
      showToast('Caminho do certificado e chave são obrigatórios', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/nginx/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          action: 'ssl_issue',
          certPath,
          keyPath,
          chainPath: chainPath || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('Certificado SSL aplicado com sucesso!', 'success');
        onConfigured(json.data.site);
        onClose();
      } else {
        showToast(json.error || 'Erro ao aplicar certificado', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    switch (method) {
      case 'letsencrypt':
        handleIssueLetsEncrypt();
        break;
      case 'existing':
        handleUseExistingCert();
        break;
      case 'manual':
        handleManualCert();
        break;
    }
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('pt-BR');
  };

  const getStatusBadge = (cert: ExistingCert) => {
    switch (cert.status) {
      case 'valid':
        return <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Válido</span>;
      case 'expiring_soon':
        return <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">Expirando</span>;
      case 'expired':
        return <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Expirado</span>;
      default:
        return null;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Configurar SSL" size="lg">
      <div className="space-y-4">
        {/* Method Selection */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setMethod('letsencrypt')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-colors ${
              method === 'letsencrypt'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-blue-500/50'
            }`}
          >
            <HiOutlineShieldCheck className="w-5 h-5" />
            Let's Encrypt
          </button>
          <button
            onClick={() => setMethod('existing')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-colors ${
              method === 'existing'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-blue-500/50'
            }`}
          >
            <HiOutlineKey className="w-5 h-5" />
            Certificado Salvo
          </button>
          <button
            onClick={() => setMethod('manual')}
            className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-colors ${
              method === 'manual'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-blue-500/50'
            }`}
          >
            <HiOutlineDocumentText className="w-5 h-5" />
            Caminho Manual
          </button>
        </div>

        {/* Let's Encrypt */}
        {method === 'letsencrypt' && (
          <div className="space-y-3">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-[var(--text-secondary)]">
              <p className="flex items-center gap-1 mb-1">
                <HiOutlineGlobeAlt className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-blue-400">Let's Encrypt</span>
              </p>
              <p>Emitir certificado SSL gratuito automaticamente via Certbot.</p>
              <p className="mt-1">Domínio: <strong>{site?.domain}</strong></p>
              {site?.aliases?.length > 0 && (
                <p>Aliases: <strong>{site.aliases.join(', ')}</strong></p>
              )}
            </div>
            <Input
              label="Email para Notificações"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@meusite.com"
            />
            <div className="text-xs text-[var(--text-muted)]">
              O certificado será renovado automaticamente a cada 60 dias.
            </div>
          </div>
        )}

        {/* Existing Certificate */}
        {method === 'existing' && (
          <div className="space-y-3">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-[var(--text-secondary)]">
              <p className="flex items-center gap-1 mb-1">
                <HiOutlineKey className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-blue-400">Certificado Salvo</span>
              </p>
              <p>Selecione um certificado já registrado no painel.</p>
            </div>

            {loadingCerts ? (
              <div className="text-center py-6 text-[var(--text-muted)] text-sm">Carregando certificados...</div>
            ) : certificates.length === 0 ? (
              <div className="text-center py-6 bg-[var(--bg-secondary)] rounded-lg">
                <HiOutlineCloudArrowUp className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 opacity-50" />
                <p className="text-[var(--text-muted)] text-sm mb-2">Nenhum certificado salvo</p>
                <p className="text-xs text-[var(--text-muted)] opacity-70">
                  Cadastre certificados na página SSL para usá-los aqui.
                </p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-2">
                {certificates.map(cert => (
                  <label
                    key={cert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedCertId === cert.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-[var(--border-color)] hover:border-blue-500/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="cert"
                      checked={selectedCertId === cert.id}
                      onChange={() => setSelectedCertId(cert.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {cert.domains[0]}
                        </span>
                        {getStatusBadge(cert)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] space-x-2">
                        <span>{cert.issuer}</span>
                        <span>·</span>
                        <span>Válido até {formatDate(cert.validUntil)}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Manual Path */}
        {method === 'manual' && (
          <div className="space-y-3">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-[var(--text-secondary)]">
              <p className="flex items-center gap-1 mb-1">
                <HiOutlineDocumentText className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-blue-400">Caminho Manual</span>
              </p>
              <p>Informe o caminho absoluto para arquivos de certificado já existentes no servidor.</p>
            </div>
            <Input
              label="Caminho do Certificado (.crt/.pem)"
              value={certPath}
              onChange={e => setCertPath(e.target.value)}
              placeholder="/etc/ssl/certs/meusite.crt"
            />
            <Input
              label="Caminho da Chave Privada (.key)"
              value={keyPath}
              onChange={e => setKeyPath(e.target.value)}
              placeholder="/etc/ssl/private/meusite.key"
            />
            <Input
              label="Caminho do Chain/CA Bundle (opcional)"
              value={chainPath}
              onChange={e => setChainPath(e.target.value)}
              placeholder="/etc/ssl/certs/ca-bundle.crt"
            />
          </div>
        )}

        {/* Footer */}
        <div className="space-y-3 pt-4 border-t border-[var(--border-color)]">
          {/* Progress indicator (Let's Encrypt only) */}
          {loading && method === 'letsencrypt' && progressStep && (
            <div className="space-y-2">
              {SSL_PROGRESS_STEPS.map((step, idx) => {
                const isDone = completedSteps.includes(step.key);
                const isActive = progressStep === step.key;
                return (
                  <div key={step.key} className="flex items-center gap-2 text-xs">
                    <span className={`w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-bold ${
                      isDone ? 'bg-green-500 text-white' :
                      isActive ? 'bg-blue-500 text-white animate-pulse' :
                      'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                    }`}>
                      {isDone ? '✓' : idx + 1}
                    </span>
                    <span className={isDone ? 'text-green-400' : isActive ? 'text-blue-400' : 'text-[var(--text-muted)]'}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {loading && method !== 'letsencrypt' && (
            <div className="text-center text-sm text-[var(--text-muted)] py-2">
              Aplicando certificado...
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button onClick={handleSubmit} loading={loading}>
              {method === 'letsencrypt' ? 'Emitir Certificado' : 'Aplicar Certificado'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
