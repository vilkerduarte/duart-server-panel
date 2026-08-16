import { useState, useEffect, useCallback } from 'react';
import {
  HiOutlineCube, HiOutlineArrowPath, HiOutlineArrowDownTray,
  HiOutlineCheckCircle, HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/lib/contexts/ToastContext';

interface PhpVersion {
  version: string;
  fpmInstalled: boolean;
  fpmActive: boolean;
  cliInstalled: boolean;
  isCliDefault: boolean;
  defaultSocket: string | null;
  extensions: string[];
  pools: string[];
  sites: string[];
}

/** Versões que fazem sentido oferecer hoje; o que está instalado vem do servidor. */
const INSTALLABLE = ['8.5', '8.4', '8.3', '8.2', '8.1'];

export default function PhpPage() {
  const { showToast } = useToast();
  const [versions, setVersions] = useState<PhpVersion[]>([]);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState('8.4');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/php');
      const json = await res.json();
      if (json.success) {
        setVersions(json.data.versions);
        setPreferred(json.data.preferred);
      } else {
        showToast(json.error || 'Erro ao carregar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const act = async (version: string, action: string) => {
    setBusy(`${version}:${action}`);
    try {
      const res = await fetch('/api/php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(
          action === 'install' ? `PHP ${version} instalado` : `${action} concluído em PHP ${version}`,
          'success',
        );
        await load();
      } else {
        showToast(json.error || 'Falha na operação', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setBusy(null);
    }
  };

  const installed = versions.filter(v => v.fpmInstalled);
  const missing = INSTALLABLE.filter(v => !versions.some(inst => inst.version === v));

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <HiOutlineCube className="w-5 h-5 text-blue-400" />
              PHP
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Versões instaladas, estado do FPM e pools dedicados por site.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <HiOutlineArrowPath className="w-4 h-4" /> Atualizar
          </Button>
        </header>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : (
          <>
            {installed.length === 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <div className="flex items-start gap-3">
                  <HiOutlineExclamationTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">Nenhuma versão de PHP-FPM instalada</p>
                    <p className="text-[var(--text-muted)] mt-1">
                      Sites do tipo PHP não vão funcionar até que exista uma versão instalada e ativa.
                      Instale abaixo — o painel cuida das extensões comuns e ativa o serviço.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {installed.map(version => (
                <Card key={version.version}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold">PHP {version.version}</h2>
                        {version.fpmActive
                          ? <Badge variant="success">FPM ativo</Badge>
                          : <Badge variant="danger">FPM parado</Badge>}
                        {version.isCliDefault && <Badge variant="info">CLI padrão</Badge>}
                        {preferred === version.version && <Badge variant="default">preferida</Badge>}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                        {version.defaultSocket ?? 'socket padrão indisponível'}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-3 gap-3 mt-4 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">Extensões</dt>
                      <dd className="font-medium tabular-nums">{version.extensions.length}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">Pools</dt>
                      <dd className="font-medium tabular-nums">{version.pools.length}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">Sites</dt>
                      <dd className="font-medium tabular-nums">{version.sites.length}</dd>
                    </div>
                  </dl>

                  {version.sites.length > 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-3 break-words">
                      {version.sites.join(' · ')}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `${version.version}:test`}
                      onClick={() => act(version.version, 'test')}
                    >
                      Testar config
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `${version.version}:reload`}
                      onClick={() => act(version.version, 'reload')}
                    >
                      Recarregar
                    </Button>
                    <Button
                      size="sm"
                      variant="warning"
                      loading={busy === `${version.version}:restart`}
                      onClick={() => act(version.version, 'restart')}
                    >
                      Reiniciar
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            <Card>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <HiOutlineArrowDownTray className="w-4 h-4" />
                Instalar versão
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Instala o FPM, a CLI e as extensões mais usadas
                (<span className="font-mono text-xs">gd curl mbstring intl zip xml bcmath opcache mysql pgsql redis</span>),
                e ativa o serviço.
              </p>

              <div className="flex flex-wrap items-end gap-3 mt-4">
                <Select
                  label="Versão"
                  value={installTarget}
                  onChange={e => setInstallTarget(e.target.value)}
                  options={INSTALLABLE.map(v => ({
                    value: v,
                    label: missing.includes(v) ? `PHP ${v}` : `PHP ${v} (já instalada)`,
                  }))}
                />
                <Button
                  loading={busy === `${installTarget}:install`}
                  onClick={() => act(installTarget, 'install')}
                >
                  Instalar PHP {installTarget}
                </Button>
              </div>

              <p className="text-xs text-[var(--text-muted)] mt-3">
                Versões fora do repositório do Ubuntu exigem o PPA <span className="font-mono">ondrej/php</span>.
                Sem ele, a instalação falha com &quot;pacote não encontrado&quot;.
              </p>
            </Card>

            <Card>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <HiOutlineCheckCircle className="w-4 h-4 text-green-400" />
                Isolamento por site
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Cada site PHP criado pelo painel recebe um pool FPM próprio: usuário de sistema
                dedicado, socket dedicado, <span className="font-mono text-xs">open_basedir</span> restrito
                à raiz do site e limites independentes. Sem isso, todos os sites rodariam
                como <span className="font-mono text-xs">www-data</span>, dividindo workers e
                conseguindo ler os arquivos uns dos outros.
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-2">
                Os limites de upload do PHP acompanham o <span className="font-mono text-xs">client_max_body_size</span> do
                NGINX automaticamente — os dois deixam de divergir.
              </p>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
