import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';

interface CronJobFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

export default function CronJobForm({ open, onClose, onSubmit }: CronJobFormProps) {
  const [expression, setExpression] = useState('* * * * *');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    onSubmit({ expression, command, description });
    setExpression('* * * * *'); setCommand(''); setDescription('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo Cron Job" size="md">
      <div className="space-y-4">
        <Input label="Expressão Cron" value={expression} onChange={e => setExpression(e.target.value)} placeholder="* * * * *" />
        <Input label="Comando" value={command} onChange={e => setCommand(e.target.value)} placeholder="/caminho/do/comando" />
        <Input label="Descrição" value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição do job" />
        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>Criar</Button>
        </div>
      </div>
    </Modal>
  );
}
