import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

export default function SslPage() {
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ssl/certificates')
      .then(res => res.json())
      .then(json => { if (json.success) setCerts(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getStatusBadge(status: string) {
    switch (status) {
      case 'valid': return <Badge variant="success">Válido</Badge>;
      case 'expiring_soon': return <Badge variant="warning">Expirando</Badge>;
      case 'expired': return <Badge variant="danger">Expirado</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">SSL/TLS</h1>
          <Button>Novo Certificado</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <div className="grid gap-4">
            {certs.map((cert, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-[var(--text-primary)]">
                        {cert.domains?.join(', ')}
                      </h3>
                      {getStatusBadge(cert.status || 'valid')}
                      <Badge variant="info">{cert.type}</Badge>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Emissor: {cert.issuer} | Válido até: {cert.validUntil ? new Date(cert.validUntil).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm">Renovar</Button>
                    <Button variant="danger" size="sm">Remover</Button>
                  </div>
                </div>
              </Card>
            ))}
            {certs.length === 0 && (
              <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum certificado configurado</p></Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
