import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import Fail2banStatus from '@/components/security/Fail2banStatus';
import SshConfigForm from '@/components/security/SshConfigForm';

export default function SecurityPage() {
  const [fail2ban, setFail2ban] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/security/fail2ban').then(r => r.json()).then(j => { if (j.success) setFail2ban(j.data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleInstallFail2ban = async () => {
    if (!confirm('Instalar fail2ban?')) return;
    await fetch('/api/security/fail2ban/install', { method: 'POST' });
    const r = await fetch('/api/security/fail2ban');
    const j = await r.json();
    if (j.success) setFail2ban(j.data);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Segurança</h1>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <>
            {fail2ban ? <Fail2banStatus data={fail2ban} onInstall={handleInstallFail2ban} /> : <Card><p className="text-[var(--text-muted)]">Carregando fail2ban...</p></Card>}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Configuração SSH</h3>
              <SshConfigForm />
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
