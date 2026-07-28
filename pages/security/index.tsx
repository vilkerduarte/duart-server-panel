import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

export default function SecurityPage() {
  const [fail2ban, setFail2ban] = useState<any>(null);
  const [sshConfig, setSshConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/security/fail2ban').then(r => r.json()),
      fetch('/api/security/ssh-config').then(r => r.json()),
    ]).then(([fb, ssh]) => {
      if (fb.success) setFail2ban(fb.data);
      if (ssh.success) setSshConfig(ssh.data);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Segurança</h1>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* fail2ban */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">fail2ban</h3>
              {fail2ban ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={fail2ban.installed ? 'success' : 'warning'}>
                      {fail2ban.installed ? 'Instalado' : 'Não Instalado'}
                    </Badge>
                    {fail2ban.running && <Badge variant="success">Rodando</Badge>}
                  </div>
                  {fail2ban.jails?.map((jail: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-[var(--bg-secondary)] rounded p-3">
                      <div>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{jail.name}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-3">
                          Banidos: {jail.banned} | Encontrados: {jail.found}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar informações do fail2ban</p>
              )}
            </Card>

            {/* SSH Config */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Configuração SSH</h3>
              {sshConfig ? (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-[var(--text-muted)]">Porta:</span> <span className="text-[var(--text-primary)]">{sshConfig.Port || '22'}</span></div>
                  <div><span className="text-[var(--text-muted)]">PermitRootLogin:</span> <span className="text-[var(--text-primary)]">{sshConfig.PermitRootLogin || 'N/A'}</span></div>
                  <div><span className="text-[var(--text-muted)]">PasswordAuth:</span> <span className="text-[var(--text-primary)]">{sshConfig.PasswordAuthentication || 'N/A'}</span></div>
                  <div><span className="text-[var(--text-muted)]">PubkeyAuth:</span> <span className="text-[var(--text-primary)]">{sshConfig.PubkeyAuthentication || 'N/A'}</span></div>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar configuração SSH</p>
              )}
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
