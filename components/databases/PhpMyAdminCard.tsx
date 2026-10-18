import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import {
  HiOutlineArrowTopRightOnSquare, HiOutlineLockClosed, HiOutlineLockOpen, HiOutlineArrowDownTray,
} from 'react-icons/hi2';
import { useInstallJob } from './useInstallJob';

interface PhpMyAdminStatus {
  installed: boolean;
  enabled: boolean;
  path: string;
  url: string | null;
  phpVersion?: string;
  packagePresent: boolean;
}

/** phpMyAdmin no domínio do painel: instalar, abrir e ligar/desligar o acesso público. */
export default function PhpMyAdminCard() {
  const [status, setStatus] = useState<PhpMyAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(() => {
    fetch('/api/databases/mysql/phpmyadmin')
      .then(r => r.json())
      .then(data => {
        if (data.success) setStatus(data.data);
        else setError(data.error || 'Erro ao consultar o phpMyAdmin');
      })
      .catch(() => setError('Erro ao consultar o phpMyAdmin'))
      .finally(() => setLoading(false));
  }, []);

  const { job, track } = useInstallJob(finished => {
    if (finished.status === 'error') setError(finished.error || 'A instalação falhou');
    fetchStatus();
  });

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const post = async (action: 'install' | 'enable' | 'disable') => {
    setError('');
    const resp = await fetch('/api/databases/mysql/phpmyadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    return resp.json();
  };

  const handleInstall = async () => {
    if (!confirm('Instalar o phpMyAdmin? Se o PHP-FPM não estiver instalado, ele também será instalado.')) return;
    try {
      const data = await post('install');
      if (data.success) track(data.data.jobId);
      else setError(data.error || 'Erro ao iniciar a instalação');
    } catch {
      setError('Erro de conexão');
    }
  };

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    try {
      const data = await post(status.enabled ? 'disable' : 'enable');
      if (data.success) setStatus(data.data);
      else setError(data.error || 'Erro ao alterar o acesso');
    } catch {
      setError('Erro de conexão');
    }
    setToggling(false);
  };

  // Mesmo esquema da página atual: o painel e o phpMyAdmin dividem o vhost.
  const href = status ? `${window.location.protocol}${status.url ?? `//${window.location.host}${status.path}`}` : '';
  const installing = job?.status === 'running';

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-[var(--text-primary)]">phpMyAdmin</h4>
            {status?.installed
              ? (status.enabled ? <Badge variant="success">Público</Badge> : <Badge variant="warning">Desativado</Badge>)
              : <Badge variant="warning">Não instalado</Badge>}
          </div>
          {status?.installed && (
            <p className="text-xs text-[var(--text-muted)] font-mono break-all">
              {status.path}{status.phpVersion ? ` · PHP ${status.phpVersion}` : ''}
            </p>
          )}
        </div>

        {loading ? <Spinner size="sm" /> : status && (
          <div className="flex gap-2 flex-wrap">
            {!status.installed ? (
              <Button size="sm" onClick={handleInstall} loading={installing}>
                <HiOutlineArrowDownTray className="w-4 h-4" /> Instalar phpMyAdmin
              </Button>
            ) : (
              <>
                <a
                  href={status.enabled ? href : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!status.enabled}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                    status.enabled
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed'
                  }`}
                >
                  <HiOutlineArrowTopRightOnSquare className="w-4 h-4" /> Abrir phpMyAdmin
                </a>
                <Button size="sm" variant={status.enabled ? 'warning' : 'success'} onClick={handleToggle} loading={toggling}>
                  {status.enabled
                    ? <><HiOutlineLockClosed className="w-4 h-4" /> Desativar acesso público</>
                    : <><HiOutlineLockOpen className="w-4 h-4" /> Ativar acesso público</>}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {job && (job.status === 'running' || job.status === 'error') && (
        <pre className="mt-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 text-xs font-mono max-h-56 overflow-auto whitespace-pre-wrap text-[var(--text-secondary)]">
          {job.log.join('\n') || '…'}
        </pre>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {status?.installed && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Entre com o usuário <span className="font-mono">root</span> e a senha da aba Root, ou com um usuário criado na aba Usuários.
        </p>
      )}
    </Card>
  );
}
