import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';

interface StartAppFormProps {
  open: boolean;
  onClose: () => void;
  manager: string;
  onSuccess: () => void;
}

export default function StartAppForm({ open, onClose, manager, onSuccess }: StartAppFormProps) {
  const [script, setScript] = useState('');
  const [name, setName] = useState('');
  const [interpreter, setInterpreter] = useState('node');
  const [cwd, setCwd] = useState('');
  const [maxMemory, setMaxMemory] = useState('');
  const [instances, setInstances] = useState('');
  const [env, setEnv] = useState('production');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/pm2/start-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          name: name || undefined,
          interpreter: manager === 'pm2' ? interpreter : undefined,
          cwd: cwd || undefined,
          maxMemory: maxMemory || undefined,
          instances: instances ? Number(instances) : undefined,
          env: env || undefined,
          manager,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
        setScript('');
        setName('');
        setCwd('');
        setMaxMemory('');
        setInstances('');
      } else {
        setError(data.error || 'Erro ao iniciar aplicação');
      }
    } catch {
      setError('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Nova Aplicação (${manager.toUpperCase()})`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Script / Arquivo"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="/caminho/para/app.js ou npm start"
          required
        />

        <Input
          label="Nome da Aplicação"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="meu-app (opcional)"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Diretório (cwd)"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/caminho/do/projeto"
          />

          {manager === 'pm2' && (
            <Select
              label="Interpretador"
              value={interpreter}
              onChange={(e) => setInterpreter(e.target.value)}
              options={[
                { value: 'node', label: 'Node.js' },
                { value: 'python3', label: 'Python 3' },
                { value: 'python', label: 'Python' },
                { value: 'bash', label: 'Bash' },
                { value: 'ruby', label: 'Ruby' },
              ]}
            />
          )}
        </div>

        {manager === 'pm2' && (
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Max Memory"
              value={maxMemory}
              onChange={(e) => setMaxMemory(e.target.value)}
              placeholder="ex: 512M"
            />
            <Input
              label="Instâncias"
              value={instances}
              onChange={(e) => setInstances(e.target.value)}
              placeholder="ex: 2"
              type="number"
            />
            <Select
              label="Ambiente"
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              options={[
                { value: 'production', label: 'Production' },
                { value: 'development', label: 'Development' },
                { value: 'staging', label: 'Staging' },
              ]}
            />
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading || !script}>
            {loading ? 'Iniciando...' : 'Iniciar Aplicação'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
