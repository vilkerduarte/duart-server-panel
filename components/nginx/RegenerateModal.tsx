import { useState, useCallback } from 'react';
import { HiOutlineArrowPath, HiOutlineExclamationTriangle, HiOutlineCheck } from 'react-icons/hi2';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/lib/contexts/ToastContext';

type SiteStatus =
  | 'atualizado' | 'desatualizado' | 'editado-manualmente'
  | 'arquivo-ausente' | 'aplicado' | 'falhou';

interface SiteReport {
  id: string;
  domain: string;
  configPath: string;
  status: SiteStatus;
  changes?: string;
  diff?: string;
  error?: string;
}

interface RegenerateModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const STATUS_LABEL: Record<SiteStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  'atualizado': { label: 'já atualizado', variant: 'success' },
  'desatualizado': { label: 'formato antigo', variant: 'warning' },
  'editado-manualmente': { label: 'editado à mão', variant: 'danger' },
  'arquivo-ausente': { label: 'arquivo ausente', variant: 'danger' },
  'aplicado': { label: 'regenerado', variant: 'success' },
  'falhou': { label: 'falhou', variant: 'danger' },
};

/**
 * Regeneração de vhosts para instalações vindas da versão anterior.
 *
 * Os arquivos antigos continuam servindo tráfego, mas não têm IPv6, o snippet
 * ACME nem o modo manutenção funcional — só passam a ter quando reescritos.
 * Como reescrever apaga edições manuais, a tela mostra o diff de cada site
 * antes de qualquer gravação, e arquivos editados à mão exigem confirmação
 * separada.
 */
export default function RegenerateModal({ open, onClose, onDone }: RegenerateModalProps) {
  const { showToast } = useToast();
  const [reports, setReports] = useState<SiteReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [includeHandEdited, setIncludeHandEdited] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setReports(null);
    try {
      const res = await fetch('/api/nginx/sites/regenerate');
      const json = await res.json();
      if (json.success) setReports(json.data.sites);
      else showToast(json.error || 'Falha ao analisar', 'error');
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const apply = async () => {
    setApplying(true);
    try {
      const res = await fetch('/api/nginx/sites/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true, includeHandEdited }),
      });
      const json = await res.json();
      setReports(json.data?.sites ?? null);
      showToast(json.data?.message ?? (json.success ? 'Concluído' : 'Falhou'), json.success ? 'success' : 'error');
      onDone();
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setApplying(false);
    }
  };

  const outdated = reports?.filter(r => r.status === 'desatualizado') ?? [];
  const handEdited = reports?.filter(r => r.status === 'editado-manualmente') ?? [];
  const actionable = outdated.length + (includeHandEdited ? handEdited.length : 0);

  return (
    <Modal open={open} onClose={onClose} title="Regenerar configurações do NGINX" size="xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-muted)]">
          Reescreve o arquivo de vhost dos sites gerenciados no formato atual: escuta em IPv6,
          snippet de desafio ACME, modo manutenção funcional e parâmetros TLS compartilhados.
          Cada site é validado com <span className="font-mono text-xs">nginx -t</span> e revertido
          individualmente se a configuração for rejeitada.
        </p>

        {!reports && !loading && (
          <Button onClick={analyze}>
            <HiOutlineArrowPath className="w-4 h-4" /> Analisar sites
          </Button>
        )}

        {loading && <div className="flex justify-center py-8"><Spinner /></div>}

        {reports && (
          <>
            <div className="flex flex-col gap-1 max-h-[45vh] overflow-y-auto">
              {reports.map(report => {
                const meta = STATUS_LABEL[report.status];
                const hasDiff = Boolean(report.diff);

                return (
                  <div key={report.id} className="border border-[var(--border-color)] rounded-lg">
                    <button
                      onClick={() => hasDiff && setExpanded(expanded === report.id ? null : report.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
                      disabled={!hasDiff}
                    >
                      <span className="text-sm font-medium truncate flex-1">{report.domain}</span>
                      {report.changes && (
                        <span className="text-xs font-mono text-[var(--text-muted)]">{report.changes}</span>
                      )}
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </button>

                    {report.error && (
                      <p className="px-3 pb-2 text-xs text-red-400">{report.error}</p>
                    )}

                    {expanded === report.id && report.diff && (
                      <pre className="text-[11px] font-mono p-3 border-t border-[var(--border-color)] overflow-x-auto max-h-64 leading-tight">
                        {report.diff.split('\n').map((line, i) => (
                          <div key={i} className={
                            line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400'
                              : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
                              : line.startsWith('@@') ? 'text-blue-400'
                              : ''
                          }>{line || ' '}</div>
                        ))}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>

            {handEdited.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-red-600/40 bg-red-600/5">
                <HiOutlineExclamationTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs flex flex-col gap-2">
                  <p>
                    <strong>{handEdited.length} arquivo(s) sem o cabeçalho do painel</strong> — provavelmente
                    editados à mão. Regenerar sobrescreve essas customizações. Abra o diff acima e copie
                    o que precisar manter antes de marcar a caixa.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeHandEdited}
                      onChange={e => setIncludeHandEdited(e.target.checked)}
                      className="rounded"
                    />
                    <span>Sobrescrever também os arquivos editados à mão</span>
                  </label>
                </div>
              </div>
            )}

            {actionable === 0 ? (
              <p className="flex items-center gap-2 text-sm text-green-400">
                <HiOutlineCheck className="w-4 h-4" /> Nada a regenerar.
              </p>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={analyze}>Reanalisar</Button>
                <Button loading={applying} onClick={apply}>
                  Regenerar {actionable} site(s)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
