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
  const [chain, setChain] = useState('INPUT');
  const [action, setAction] = useState('ACCEPT');
  const [protocol, setProtocol] = useState('tcp');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [dport, setDport] = useState('');

  const handleSubmit = () => {
    onSubmit({
      chain,
      action: action.toLowerCase(),
      protocol: protocol === 'any' ? 'all' : protocol,
      source: source || '0.0.0.0/0',
      destination: destination || '0.0.0.0/0',
      dport: dport || undefined,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Adicionar Regra iptables" size="md">
      <div className="space-y-4">
        <Select
          label="Chain"
          value={chain}
          onChange={e => setChain(e.target.value)}
          options={[
            { value: 'INPUT', label: 'INPUT (Entrada)' },
            { value: 'OUTPUT', label: 'OUTPUT (Saída)' },
            { value: 'FORWARD', label: 'FORWARD (Roteamento)' },
          ]}
        />

        <Select
          label="Ação"
          value={action}
          onChange={e => setAction(e.target.value)}
          options={[
            { value: 'ACCEPT', label: 'ACCEPT (Permitir)' },
            { value: 'DROP', label: 'DROP (Descartar)' },
            { value: 'REJECT', label: 'REJECT (Rejeitar)' },
          ]}
        />

        <Select
          label="Protocolo"
          value={protocol}
          onChange={e => setProtocol(e.target.value)}
          options={[
            { value: 'tcp', label: 'TCP' },
            { value: 'udp', label: 'UDP' },
            { value: 'icmp', label: 'ICMP' },
            { value: 'any', label: 'Qualquer' },
          ]}
        />

        <Input
          label="Porta de Destino"
          value={dport}
          onChange={e => setDport(e.target.value)}
          placeholder="80, 443 ou 3000:4000"
        />

        <Input
          label="Origem (IP/CIDR)"
          value={source}
          onChange={e => setSource(e.target.value)}
          placeholder="0.0.0.0/0 (qualquer)"
        />

        <Input
          label="Destino (IP/CIDR)"
          value={destination}
          onChange={e => setDestination(e.target.value)}
          placeholder="0.0.0.0/0 (qualquer)"
        />

        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>Adicionar Regra</Button>
        </div>
      </div>
    </Modal>
  );
}
