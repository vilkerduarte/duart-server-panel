import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

interface CertificateCardProps {
  cert: any;
  onDelete: (id: string) => void;
}

export default function CertificateCard({ cert, onDelete }: CertificateCardProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid': return <Badge variant="success">Válido</Badge>;
      case 'expiring_soon': return <Badge variant="warning">Expirando</Badge>;
      case 'expired': return <Badge variant="danger">Expirado</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    if (type === 'letsencrypt') return <Badge variant="info">Let's Encrypt</Badge>;
    if (type === 'manual') return <Badge variant="warning">Manual</Badge>;
    return <Badge>{type}</Badge>;
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-[var(--text-primary)]">{cert.domains?.join(', ') || cert.id}</h3>
            {getStatusBadge(cert.status || 'valid')}
            {getTypeBadge(cert.type)}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Emissor: {cert.issuer || 'N/A'} | Válido até: {cert.validUntil ? new Date(cert.validUntil).toLocaleDateString() : 'N/A'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm">Renovar</Button>
          <Button variant="danger" size="sm" onClick={() => onDelete(cert.id)}>Remover</Button>
        </div>
      </div>
    </Card>
  );
}
