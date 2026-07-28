import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function BackupPage() {
  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Backup & Restore</h1>
          <Button>Criar Backup</Button>
        </div>

        <Card>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Criar Backup</h3>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                O backup inclui: configurações, usuários, NGINX, SSL, cron jobs e histórico.
              </p>
              <Button>Criar Backup Agora</Button>
            </div>

            <hr className="border-[var(--border-color)]" />

            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Restaurar Backup</h3>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Envie um arquivo .tar.gz para restaurar as configurações do painel.
              </p>
              <Button variant="ghost">Selecionar Arquivo</Button>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Backups Anteriores</h3>
          <p className="text-sm text-[var(--text-muted)] text-center py-8">Nenhum backup encontrado</p>
        </Card>
      </div>
    </AppLayout>
  );
}
