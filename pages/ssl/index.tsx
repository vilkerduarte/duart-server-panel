import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import CertificateCard from '@/components/ssl/CertificateCard';
import { HiOutlinePlus } from 'react-icons/hi2';

export default function SslPage() {
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCerts = () => {
    fetch('/api/ssl/certificates').then(r => r.json()).then(j => { if (j.success) setCerts(j.data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchCerts(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remover certificado?')) return;
    await fetch(`/api/ssl/certificates/${id}`, { method: 'DELETE' });
    setCerts(prev => prev.filter(c => c.id !== id));
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">SSL/TLS</h1>
          <Button><HiOutlinePlus className="w-4 h-4" /> Novo Certificado</Button>
        </div>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <div className="grid gap-3">
            {certs.map((c, i) => <CertificateCard key={i} cert={c} onDelete={handleDelete} />)}
            {certs.length === 0 && <Card><p className="text-center text-[var(--text-muted)] py-8">Nenhum certificado configurado</p></Card>}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
