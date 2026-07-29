import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import { HiOutlineXMark, HiOutlinePlay, HiOutlineStop, HiOutlineArrowPath, HiOutlineInformationCircle, HiOutlineGlobeAlt, HiOutlineCircleStack, HiOutlineDocumentText, HiOutlineArchiveBox } from 'react-icons/hi2';
import { SiDocker } from 'react-icons/si';

interface ContainerDetailModalProps {
  containerId: string;
  containerName: string;
  containerState: string;
  open: boolean;
  onClose: () => void;
  onAction: (id: string, action: string) => void;
}

export default function ContainerDetailModal({
  containerId,
  containerName,
  containerState,
  open,
  onClose,
  onAction,
}: ContainerDetailModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'network' | 'volumes' | 'compose' | 'logs'>('info');

  useEffect(() => {
    if (!open || !containerId) return;
    setLoading(true);
    fetch(`/api/docker/inspect?id=${encodeURIComponent(containerId)}`)
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, containerId]);

  if (!open) return null;

  const inspect = data?.inspect;
  const composeFile = data?.composeFile;
  const logs = data?.logs;

  const tabs = [
    { key: 'info' as const, icon: <HiOutlineInformationCircle className="w-4 h-4" />, label: 'Informações' },
    { key: 'network' as const, icon: <HiOutlineGlobeAlt className="w-4 h-4" />, label: 'Rede' },
    { key: 'volumes' as const, icon: <HiOutlineCircleStack className="w-4 h-4" />, label: 'Volumes' },
    { key: 'compose' as const, icon: <SiDocker className="w-4 h-4" />, label: 'Compose' },
    { key: 'logs' as const, icon: <HiOutlineDocumentText className="w-4 h-4" />, label: 'Logs' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-[85vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{containerName}</h2>
            <Badge variant={containerState === 'running' ? 'success' : containerState === 'paused' ? 'warning' : 'danger'}>
              {containerState}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {containerState !== 'running' && (
              <button onClick={() => onAction(containerId, 'start')} className="p-2 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30" title="Start">
                <HiOutlinePlay className="w-4 h-4" />
              </button>
            )}
            {containerState === 'running' && (
              <button onClick={() => onAction(containerId, 'stop')} className="p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30" title="Stop">
                <HiOutlineStop className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => onAction(containerId, 'restart')} className="p-2 rounded-lg bg-amber-600/20 text-amber-400 hover:bg-amber-600/30" title="Restart">
              <HiOutlineArrowPath className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-color)] shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.icon}
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : !data ? (
            <p className="text-center text-[var(--text-muted)] py-12">Erro ao carregar detalhes</p>
          ) : (
            <>
              {activeTab === 'info' && inspect && (
                <div className="space-y-4">
                  <DetailSection title="Informações Básicas">
                    <DetailRow label="ID" value={inspect.Id?.slice(0, 12)} mono />
                    <DetailRow label="Nome" value={inspect.Name?.replace(/^\//, '')} />
                    <DetailRow label="Imagem" value={inspect.Config?.Image} />
                    <DetailRow label="Comando" value={(inspect.Config?.Cmd || []).join(' ') || inspect.Path} mono />
                    <DetailRow label="Criado em" value={new Date(inspect.Created).toLocaleString()} />
                    <DetailRow label="Plataforma" value={`${inspect.Platform || ''} ${inspect.Architecture || ''}`} />
                    <DetailRow label="Driver" value={inspect.Driver} />
                  </DetailSection>

                  <DetailSection title="Estado">
                    <DetailRow label="Status" value={inspect.State?.Status} />
                    <DetailRow label="Running" value={inspect.State?.Running ? 'Sim' : 'Não'} />
                    <DetailRow label="Pid" value={String(inspect.State?.Pid || 0)} />
                    <DetailRow label="Started At" value={inspect.State?.StartedAt ? new Date(inspect.State.StartedAt).toLocaleString() : 'N/A'} />
                    <DetailRow label="Exit Code" value={String(inspect.State?.ExitCode ?? '-')} />
                    {inspect.State?.Error && <DetailRow label="Error" value={inspect.State.Error} />}
                  </DetailSection>

                  <DetailSection title="Configurações">
                    <DetailRow label="Hostname" value={inspect.Config?.Hostname} />
                    <DetailRow label="WorkingDir" value={inspect.Config?.WorkingDir} mono />
                    <DetailRow label="Entrypoint" value={(inspect.Config?.Entrypoint || []).join(' ') || 'N/A'} mono />
                    <DetailRow label="Env" value={`${(inspect.Config?.Env || []).length} variáveis`} />
                    <DetailRow label="Tty" value={inspect.Config?.Tty ? 'Sim' : 'Não'} />
                    <DetailRow label="OpenStdin" value={inspect.Config?.OpenStdin ? 'Sim' : 'Não'} />
                  </DetailSection>

                  <DetailSection title="Resources">
                    <DetailRow label="CPU Shares" value={String(inspect.HostConfig?.CpuShares || 0)} />
                    <DetailRow label="Memory Limit" value={inspect.HostConfig?.Memory ? `${(inspect.HostConfig.Memory / 1024 / 1024).toFixed(0)} MB` : 'Ilimitado'} />
                    <DetailRow label="Restart Policy" value={inspect.HostConfig?.RestartPolicy?.Name || 'no'} />
                    <DetailRow label="Privileged" value={inspect.HostConfig?.Privileged ? 'Sim' : 'Não'} />
                  </DetailSection>

                  <DetailSection title="Variáveis de Ambiente">
                    <pre className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-3 rounded max-h-48 overflow-y-auto">
                      {(inspect.Config?.Env || []).join('\n')}
                    </pre>
                  </DetailSection>
                </div>
              )}

              {activeTab === 'network' && inspect && (
                <div className="space-y-4">
                  {Object.entries(inspect.NetworkSettings?.Networks || {}).map(([name, net]: [string, any]) => (
                    <DetailSection key={name} title={`Rede: ${name}`}>
                      <DetailRow label="IP Address" value={net.IPAddress} mono />
                      <DetailRow label="Gateway" value={net.Gateway} mono />
                      <DetailRow label="Mac Address" value={net.MacAddress} mono />
                      <DetailRow label="Network ID" value={net.NetworkID?.slice(0, 12)} mono />
                    </DetailSection>
                  ))}
                  <DetailSection title="Portas">
                    {Object.entries(inspect.HostConfig?.PortBindings || {}).length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">Nenhuma porta mapeada</p>
                    )}
                    {Object.entries(inspect.HostConfig?.PortBindings || {}).map(([containerPort, bindings]: [string, any]) => (
                      <DetailRow
                        key={containerPort}
                        label={containerPort}
                        value={(bindings || []).map((b: any) => `${b.HostIp || '0.0.0.0'}:${b.HostPort}`).join(', ')}
                        mono
                      />
                    ))}
                  </DetailSection>
                  <DetailSection title="DNS / Hosts">
                    <DetailRow label="DNS" value={(inspect.HostConfig?.Dns || []).join(', ') || 'Padrão'} mono />
                    <DetailRow label="Extra Hosts" value={(inspect.HostConfig?.ExtraHosts || []).join(', ') || 'Nenhum'} mono />
                  </DetailSection>
                </div>
              )}

              {activeTab === 'volumes' && inspect && (
                <div className="space-y-4">
                  <DetailSection title="Mounts">
                    {(inspect.Mounts || []).length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">Nenhum volume montado</p>
                    )}
                    {(inspect.Mounts || []).map((mount: any, i: number) => (
                      <div key={i} className="p-3 bg-[var(--bg-secondary)] rounded-lg mb-2">
                        <DetailRow label="Tipo" value={mount.Type} />
                        <DetailRow label="Origem" value={mount.Source || mount.Name} mono />
                        <DetailRow label="Destino" value={mount.Destination} mono />
                        <DetailRow label="Modo" value={mount.Mode || 'default'} />
                        <DetailRow label="RW" value={mount.RW ? 'Sim' : 'Não'} />
                      </div>
                    ))}
                  </DetailSection>
                  <DetailSection title="Volumes (legado)">
                    {(inspect.HostConfig?.Binds || []).length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">Nenhum bind mount</p>
                    )}
                    {(inspect.HostConfig?.Binds || []).map((bind: string, i: number) => (
                      <DetailRow key={i} label={`Bind ${i + 1}`} value={bind} mono />
                    ))}
                  </DetailSection>
                </div>
              )}

              {activeTab === 'compose' && (
                <div>
                  {composeFile ? (
                    <div>
                      <p className="text-sm text-[var(--text-muted)] mb-3">
                        Arquivo docker-compose detectado para este container:
                      </p>
                      <pre className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-4 rounded-lg overflow-auto max-h-[50vh]">
                        {composeFile}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <HiOutlineArchiveBox className="w-12 h-12 mx-auto mb-2 text-[var(--text-muted)]" />
                      <p className="text-[var(--text-muted)]">
                        Nenhum arquivo docker-compose.yml encontrado para este container.
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        O container pode ter sido criado manualmente com <code className="text-blue-400">docker run</code>.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'logs' && (
                <div>
                  {logs !== null && logs !== undefined ? (
                    logs.length > 0 ? (
                      <pre className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-4 rounded-lg overflow-auto max-h-[50vh] whitespace-pre-wrap">
                        {logs}
                      </pre>
                    ) : (
                      <div className="text-center py-12">
                        <HiOutlineDocumentText className="w-12 h-12 mx-auto mb-2 text-[var(--text-muted)]" />
                        <p className="text-[var(--text-muted)]">Nenhum log disponível para este container.</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">O container pode não ter gerado logs ainda.</p>
                      </div>
                    )
                  ) : (
                    <div className="text-center py-12">
                      <HiOutlineDocumentText className="w-12 h-12 mx-auto mb-2 text-red-400/50" />
                      <p className="text-[var(--text-muted)]">Falha ao carregar logs.</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">Verifique se o Docker está rodando e se o container existe.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-[var(--border-color)] shrink-0">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2 pb-1 border-b border-[var(--border-color)]">
        {title}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <span className="text-[var(--text-muted)] min-w-[120px]">{label}:</span>
      <span className={`text-[var(--text-primary)] ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '-'}
      </span>
    </div>
  );
}
