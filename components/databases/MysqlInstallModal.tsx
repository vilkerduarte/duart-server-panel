import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import { HiOutlineExclamationTriangle, HiOutlineCheck } from 'react-icons/hi2';
import { useInstallJob } from './useInstallJob';

interface VariantOption {
  id: string;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
}

interface MysqlInstallModalProps {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}

export default function MysqlInstallModal({ open, onClose, onInstalled }: MysqlInstallModalProps) {
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [osName, setOsName] = useState('');
  const [variant, setVariant] = useState('');
  const [withPhpMyAdmin, setWithPhpMyAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const { job, track, reset } = useInstallJob(finished => {
    if (finished.status === 'completed') onInstalled();
  });

  useEffect(() => {
    if (!open || loaded) return;
    fetch('/api/databases/mysql/install')
      .then(r => r.json())
      .then(data => {
        if (!data.success) { setError(data.error || 'Erro ao consultar versões'); return; }
        setVariants(data.data.variants);
        setOsName(data.data.os?.prettyName || '');
        const first = data.data.variants.find((v: VariantOption) => v.available);
        setVariant(current => current || first?.id || '');
        if (data.data.runningJob) track(data.data.runningJob);
      })
      .catch(() => setError('Erro ao consultar versões'))
      .finally(() => setLoaded(true));
  }, [open, loaded, track]);

  const loading = open && !loaded;

  const selected = variants.find(v => v.id === variant);
  const running = job?.status === 'running';

  const handleStart = async () => {
    setStarting(true);
    setError('');
    try {
      const resp = await fetch('/api/databases/mysql/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant, phpMyAdmin: withPhpMyAdmin }),
      });
      const data = await resp.json();
      if (data.success) track(data.data.jobId);
      else setError(data.error || 'Erro ao iniciar a instalação');
    } catch {
      setError('Erro de conexão');
    }
    setStarting(false);
  };

  const handleClose = () => {
    // Fechar não cancela: a instalação segue no servidor.
    if (!running) reset();
    setError('');
    setLoaded(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Instalar MySQL" size="lg">
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : job ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {running && <Spinner size="sm" />}
            {job.status === 'completed' && <HiOutlineCheck className="w-5 h-5 text-green-400" />}
            {job.status === 'error' && <HiOutlineExclamationTriangle className="w-5 h-5 text-red-400" />}
            <span className="text-[var(--text-primary)]">
              {running ? 'Instalando… pode levar alguns minutos.' : job.status === 'completed' ? 'Instalação concluída' : 'A instalação falhou'}
            </span>
          </div>
          <pre className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-xs font-mono max-h-72 overflow-auto whitespace-pre-wrap text-[var(--text-secondary)]">
            {job.log.join('\n') || '…'}
          </pre>
          {job.error && <p className="text-sm text-red-400">{job.error}</p>}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleClose}>{running ? 'Fechar (continua em segundo plano)' : 'Fechar'}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {osName && <p className="text-xs text-[var(--text-muted)]">Servidor: {osName}</p>}

          <Select
            label="Versão"
            value={variant}
            onChange={e => setVariant(e.target.value)}
            options={variants.map(v => ({
              value: v.id,
              label: v.available ? v.label : `${v.label} — indisponível`,
            }))}
          />

          {selected && (
            <p className={`text-xs ${selected.available ? 'text-[var(--text-muted)]' : 'text-amber-300'}`}>
              {selected.available ? selected.description : selected.reason}
            </p>
          )}

          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={withPhpMyAdmin}
              onChange={e => setWithPhpMyAdmin(e.target.checked)}
            />
            <span>
              Instalar phpMyAdmin
              <span className="block text-xs text-[var(--text-muted)]">
                Instala o PHP-FPM se faltar e publica em um caminho aleatório no domínio do painel.
              </span>
            </span>
          </label>

          <p className="text-xs text-[var(--text-muted)]">
            O painel define uma senha root aleatória e a guarda com segurança — ela fica visível na aba Root.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancelar</Button>
            <Button onClick={handleStart} loading={starting} disabled={!selected?.available}>Instalar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
