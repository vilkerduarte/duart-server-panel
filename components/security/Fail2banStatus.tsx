import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

interface Fail2banProps {
  data: any;
  onInstall: () => void;
}

export default function Fail2banStatus({ data, onInstall }: Fail2banProps) {
  if (!data.installed) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">fail2ban</h3>
            <p className="text-sm text-[var(--text-muted)]">Proteção contra brute-force não instalada</p>
          </div>
          <Button onClick={onInstall}>Instalar fail2ban</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="success">Instalado</Badge>
        <Badge variant={data.running ? 'success' : 'danger'}>{data.running ? 'Rodando' : 'Parado'}</Badge>
      </div>
      {data.jails?.map((jail: any, i: number) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)]">{jail.name}</span>
              <span className="text-xs text-[var(--text-muted)] ml-3">Banidos: {jail.banned} | Encontrados: {jail.found}</span>
            </div>
            <div className="flex gap-1">
              <Badge variant={jail.enabled ? 'success' : 'default'}>{jail.enabled ? 'Ativo' : 'Inativo'}</Badge>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
