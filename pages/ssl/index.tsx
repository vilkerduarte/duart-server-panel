import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/lib/contexts/ToastContext';
import CertificateCard from '@/components/ssl/CertificateCard';
import { HiOutlinePlus, HiOutlineShieldCheck } from 'react-icons/hi2';

type CertType = 'letsencrypt' | 'manual' | 'cloudflare';

export default function SslPage() {
  const { showToast } = useToast();
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formType, setFormType] = useState<CertType>('letsencrypt');
  const [formDomains, setFormDomains] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formMethod, setFormMethod] = useState<'http' | 'dns'>('http');
  const [formCert, setFormCert] = useState('');
  const [formKey, setFormKey] = useState('');
  const [formChain, setFormChain] = useState('');
  const [formCertPath, setFormCertPath] = useState('');
  const [formKeyPath, setFormKeyPath] = useState('');
  const [formChainPath, setFormChainPath] = useState('');

  const fetchCerts = () => {
    setLoading(true);
    fetch('/api/ssl/certificates')
      .then(r => r.json())
      .then(j => { if (j.success) setCerts(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCerts(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remover certificado?')) return;
    try {
      const res = await fetch(`/api/ssl/certificates?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setCerts(prev => prev.filter(c => c.id !== id));
        showToast('Certificado removido', 'success');
      } else {
        showToast(json.error || 'Erro ao remover', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    }
  };

  const handleCreate = async () => {
    const domains = formDomains.split(',').map(d => d.trim()).filter(Boolean);
    if (domains.length === 0) {
      showToast('Informe pelo menos um domínio', 'error');
      return;
    }

    setSaving(true);
    try {
      const body: any = {
        type: formType,
        domains,
      };

      if (formType === 'letsencrypt') {
        if (!formEmail) {
          showToast('Email é obrigatório para Let\'s Encrypt', 'error');
          setSaving(false);
          return;
        }
        body.email = formEmail;
        body.method = formMethod;
      } else if (formType === 'manual') {
        if (!formCert || !formKey) {
          showToast('Certificado e chave são obrigatórios', 'error');
          setSaving(false);
          return;
        }
        body.cert = formCert;
        body.key = formKey;
        if (formChain) body.chain = formChain;
      } else if (formType === 'cloudflare') {
        if (!formCertPath || !formKeyPath) {
          showToast('Caminhos do certificado e chave são obrigatórios', 'error');
          setSaving(false);
          return;
        }
        body.certPath = formCertPath;
        body.keyPath = formKeyPath;
        if (formChainPath) body.chainPath = formChainPath;
      }

      const res = await fetch('/api/ssl/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        setCerts(prev => [...prev, json.data.certificate]);
        showToast('Certificado criado com sucesso!', 'success');
        setShowForm(false);
        resetForm();
      } else {
        showToast(json.error || 'Erro ao criar certificado', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormType('letsencrypt');
    setFormDomains('');
    setFormEmail('');
    setFormMethod('http');
    setFormCert('');
    setFormKey('');
    setFormChain('');
    setFormCertPath('');
    setFormKeyPath('');
    setFormChainPath('');
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">SSL/TLS</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            <HiOutlinePlus className="w-4 h-4" /> Novo Certificado
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <div className="grid gap-3">
            {certs.map((c, i) => <CertificateCard key={i} cert={c} onDelete={handleDelete} />)}
            {certs.length === 0 && (
              <Card>
                <div className="text-center py-12">
                  <HiOutlineShieldCheck className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                  <p className="text-[var(--text-muted)] mb-2">Nenhum certificado configurado</p>
                  <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
                    <HiOutlinePlus className="w-4 h-4" /> Novo Certificado
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* New Certificate Modal */}
        <Modal open={showForm} onClose={() => setShowForm(false)} title="Novo Certificado" size="lg">
          <div className="space-y-4">
            <Select label="Tipo de Certificado" value={formType} onChange={e => setFormType(e.target.value as CertType)}
              options={[
                { value: 'letsencrypt', label: "Let's Encrypt" },
                { value: 'manual', label: 'Manual (Colar CRT/KEY)' },
                { value: 'cloudflare', label: 'Cloudflare Origin' },
              ]} />

            <Input label="Domínios (separados por vírgula)" value={formDomains} onChange={e => setFormDomains(e.target.value)} placeholder="meusite.com, www.meusite.com" />

            {formType === 'letsencrypt' && (
              <>
                <Input label="Email para Notificações" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="admin@meusite.com" />
                <Select label="Método de Verificação" value={formMethod} onChange={e => setFormMethod(e.target.value as 'http' | 'dns')}
                  options={[
                    { value: 'http', label: 'HTTP-01 (Arquivo via webroot)' },
                    { value: 'dns', label: 'DNS-01 (Registro TXT)' },
                  ]} />
                {formMethod === 'dns' && (
                  <div className="text-xs text-[var(--text-muted)] bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                    O desafio DNS requer configuração manual do registro TXT. Você precisará adicionar o registro no seu provedor DNS durante o processo.
                  </div>
                )}
              </>
            )}

            {formType === 'manual' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">Certificado (CRT/PEM)</label>
                  <textarea value={formCert} onChange={e => setFormCert(e.target.value)} rows={6}
                    className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="-----BEGIN CERTIFICATE-----&#10;..." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">Chave Privada (KEY)</label>
                  <textarea value={formKey} onChange={e => setFormKey(e.target.value)} rows={6}
                    className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="-----BEGIN PRIVATE KEY-----&#10;..." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">Chain/CA Bundle (opcional)</label>
                  <textarea value={formChain} onChange={e => setFormChain(e.target.value)} rows={4}
                    className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder="-----BEGIN CERTIFICATE-----&#10;..." />
                </div>
              </>
            )}

            {formType === 'cloudflare' && (
              <>
                <Input label="Caminho do Certificado" value={formCertPath} onChange={e => setFormCertPath(e.target.value)} placeholder="/etc/ssl/certs/cloudflare.pem" />
                <Input label="Caminho da Chave Privada" value={formKeyPath} onChange={e => setFormKeyPath(e.target.value)} placeholder="/etc/ssl/private/cloudflare.key" />
                <Input label="Caminho do Chain (opcional)" value={formChainPath} onChange={e => setFormChainPath(e.target.value)} placeholder="/etc/ssl/certs/cloudflare-chain.pem" />
              </>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleCreate} loading={saving}>
                {formType === 'letsencrypt' ? 'Emitir Certificado' : 'Registrar Certificado'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </AppLayout>
  );
}
