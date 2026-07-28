import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import Modal from '@/components/ui/Modal';

interface SiteFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  site?: any;
}

export default function SiteForm({ open, onClose, onSubmit, site }: SiteFormProps) {
  const [domain, setDomain] = useState(site?.domain || '');
  const [type, setType] = useState(site?.type || 'static');
  const [root, setRoot] = useState(site?.root || '');
  const [proxyPort, setProxyPort] = useState(site?.proxyPort || 3000);
  const [websocket, setWebsocket] = useState(site?.websocket || false);

  const handleSubmit = () => {
    onSubmit({ domain, type, root: type !== 'proxy' ? root : undefined, proxyPort: type === 'proxy' ? proxyPort : undefined, websocket: type === 'proxy' ? websocket : undefined });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={site ? 'Editar Site' : 'Novo Site'} size="lg">
      <div className="space-y-4">
        <Input label="Domínio" value={domain} onChange={e => setDomain(e.target.value)} placeholder="meusite.com" />
        <Select label="Tipo" value={type} onChange={e => setType(e.target.value)}
          options={[{ value: 'static', label: 'Estático' }, { value: 'php', label: 'PHP' }, { value: 'proxy', label: 'Proxy Reverso' }]} />
        {(type === 'static' || type === 'php') && (
          <Input label="Root Path" value={root} onChange={e => setRoot(e.target.value)} placeholder="/var/www/meusite" />
        )}
        {type === 'proxy' && (
          <>
            <Input label="Porta do Proxy" type="number" value={String(proxyPort)} onChange={e => setProxyPort(Number(e.target.value))} />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={websocket} onChange={e => setWebsocket(e.target.checked)} className="rounded" />
              <span className="text-[var(--text-secondary)]">WebSocket Support</span>
            </label>
          </>
        )}
        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>{site ? 'Atualizar' : 'Criar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
