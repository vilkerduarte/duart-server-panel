import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

interface DbStatusCardProps {
  name: string;
  installed: boolean;
  running: boolean;
  version?: string;
  port?: number;
  onInstall: () => void;
}

export default function DbStatusCard({ name, installed, running, version, port, onInstall }: DbStatusCardProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-[var(--text-primary)]">{name}</h3>
        <div className="flex gap-2">
          {installed ? (
            <>
              <Badge variant="success">Instalado</Badge>
              {running ? <Badge variant="success">Rodando</Badge> : <Badge variant="danger">Parado</Badge>}
            </>
          ) : (
            <Badge variant="warning">Não Instalado</Badge>
          )}
        </div>
      </div>
      {installed ? (
        <div className="text-sm space-y-1 mb-4">
          {version && <p><span className="text-[var(--text-muted)]">Versão:</span> <span className="text-[var(--text-primary)]">{version}</span></p>}
          {port && <p><span className="text-[var(--text-muted)]">Porta:</span> <span className="text-[var(--text-primary)]">{port}</span></p>}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] mb-4">{name} não está instalado neste servidor.</p>
      )}
      {!installed && (
        <Button onClick={onInstall}>Instalar {name}</Button>
      )}
    </div>
  );
}
