import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';

interface RuleFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

export default function RuleForm({ open, onClose, onSubmit }: RuleFormProps) {
  const [action, setAction] = useState('allow');
  const [port, setPort] = useState('');
  const [proto, setProto] = useState('tcp');
  const [from, setFrom] = useState('any');

  const handleSubmit = () => {
    onSubmit({ action, port, proto, from });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Adicionar Regra" size="md">
      <div className="space-y-4">
        <Select label="Ação" value={action} onChange={e => setAction(e.target.value)}
          options={[{ value: 'allow', label: 'Permitir' }, { value: 'deny', label: 'Negar' }, { value: 'reject', label: 'Rejeitar' }, { value: 'limit', label: 'Limitar' }]} />
        <Input label="Porta" value={port} onChange={e => setPort(e.target.value)} placeholder="80 ou 8080:8085" />
        <Select label="Protocolo" value={proto} onChange={e => setProto(e.target.value)}
          options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'any', label: 'Any' }]} />
        <Input label="Origem (IP/Range)" value={from} onChange={e => setFrom(e.target.value)} placeholder="any" />
        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>Adicionar</Button>
        </div>
      </div>
    </Modal>
  );
}
