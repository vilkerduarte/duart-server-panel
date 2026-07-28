import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function CronPage() {
  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Tarefas Cron</h1>
          <Button>Novo Job</Button>
        </div>

        <Card>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">0 3 * * *</p>
                <p className="text-xs text-[var(--text-muted)]">node scripts/renew-ssl.js</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="info">Sistema</Badge>
                <Badge variant="success">Ativo</Badge>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">0 0 * * *</p>
                <p className="text-xs text-[var(--text-muted)]">find /var/lib/duart-panel/cpu-history/ -mtime +30 -delete</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="info">Sistema</Badge>
                <Badge variant="success">Ativo</Badge>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">0 0 * * 0</p>
                <p className="text-xs text-[var(--text-muted)]">node scripts/rotate-logs.js</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="warning">Painel</Badge>
                <Badge variant="success">Ativo</Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
