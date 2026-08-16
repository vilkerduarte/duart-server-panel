import { useState, useEffect, useCallback } from 'react';
import {
  HiOutlineBeaker, HiOutlineArrowPath, HiOutlinePlus,
  HiOutlinePlay, HiOutlineStop, HiOutlineTrash, HiOutlineDocumentText,
} from 'react-icons/hi2';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/lib/contexts/ToastContext';

interface AppStatus {
  active: boolean;
  enabled: boolean;
  state: string;
  socketExists: boolean;
}

interface PythonApp {
  id: string;
  name: string;
  directory: string;
  module: string;
  framework: 'wsgi' | 'asgi';
  workers: number;
  socket: string;
  unit: string;
  status: AppStatus;
}

interface PythonVersion {
  version: string;
  bin: string;
}

export default function PythonPage() {
  const { showToast } = useToast();
  const [apps, setApps] = useState<PythonApp[]>([]);
  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [suggested, setSuggested] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', directory: '', module: '', framework: 'wsgi', pythonBin: '', workers: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/python/apps');
      const json = await res.json();
      if (json.success) {
        setApps(json.data.apps);
        setVersions(json.data.pythonVersions);
        setSuggested(json.data.suggestedWorkers);
        if (!form.pythonBin && json.data.pythonVersions.length) {
          setForm(f => ({ ...f, pythonBin: json.data.pythonVersions.at(-1).bin }));
        }
      } else {
        showToast(json.error || 'Erro ao carregar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const act = async (name: string, action: string) => {
    setBusy(`${name}:${action}`);
    try {
      const res = await fetch('/api/python/apps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${action} concluído em ${name}`, 'success');
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

  const create = async () => {
    setBusy('create');
    try {
      const res = await fetch('/api/python/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          workers: form.workers ? Number(form.workers) : undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`Aplicação ${form.name} criada e iniciada`, 'success');
        setFormOpen(false);
        setForm({ name: '', directory: '', module: '', framework: 'wsgi', pythonBin: form.pythonBin, workers: '' });
        await load();
      } else {
        showToast(json.error || 'Falha ao criar', 'error');
      }
    } catch {
      showToast('Erro de conexão', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openLogs = async (name: string) => {
    setLogsFor(name);
    setLogs('Carregando…');
    const res = await fetch(`/api/python/apps?name=${encodeURIComponent(name)}`);
    const json = await res.json();
    setLogs(json.success ? (json.data.logs || '(sem entradas)') : (json.error || 'Erro'));
  };

  const remove = async () => {
    if (!removeTarget) return;
    const res = await fetch(`/api/python/apps?name=${encodeURIComponent(removeTarget)}`, { method: 'DELETE' });
    const json = await res.json();
    showToast(json.success ? `${removeTarget} removida` : (json.error || 'Falha'), json.success ? 'success' : 'error');
    setRemoveTarget(null);
    await load();
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <HiOutlineBeaker className="w-5 h-5 text-blue-400" />
              Python
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Aplicações com venv próprio, gunicorn e supervisão pelo systemd.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <HiOutlineArrowPath className="w-4 h-4" /> Atualizar
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={!versions.length}>
              <HiOutlinePlus className="w-4 h-4" /> Nova aplicação
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : apps.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Nenhuma aplicação Python ainda. Cada uma recebe ambiente virtual próprio, unidade
              systemd dedicada e socket unix em <span className="font-mono text-xs">/run/duart/</span> —
              basta criar um site do tipo <strong>python</strong> no NGINX apontando para esse socket.
            </p>
            {versions.length === 0 && (
              <p className="text-sm text-amber-400 mt-3">
                Nenhum Python 3 encontrado neste servidor.
              </p>
            )}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {apps.map(app => (
              <Card key={app.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-semibold truncate">{app.name}</h2>
                      {app.status.active
                        ? <Badge variant="success">ativa</Badge>
                        : <Badge variant="danger">{app.status.state}</Badge>}
                      <Badge variant="info">{app.framework.toUpperCase()}</Badge>
                      {!app.status.socketExists && <Badge variant="warning">sem socket</Badge>}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1 font-mono truncate">{app.directory}</p>
                    <p className="text-xs text-[var(--text-muted)] font-mono truncate">{app.module}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Workers</dt>
                    <dd className="font-medium tabular-nums">{app.workers}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--text-muted)]">Socket</dt>
                    <dd className="font-mono text-xs truncate">{app.socket}</dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2 mt-4">
                  <Button
                    size="sm" variant="ghost"
                    loading={busy === `${app.name}:reload`}
                    onClick={() => act(app.name, 'reload')}
                    title="Troca os workers sem derrubar conexões"
                  >
                    Reload gracioso
                  </Button>
                  <Button size="sm" variant="warning" loading={busy === `${app.name}:restart`} onClick={() => act(app.name, 'restart')}>
                    <HiOutlinePlay className="w-3.5 h-3.5" /> Reiniciar
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy === `${app.name}:stop`} onClick={() => act(app.name, 'stop')}>
                    <HiOutlineStop className="w-3.5 h-3.5" /> Parar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openLogs(app.name)}>
                    <HiOutlineDocumentText className="w-3.5 h-3.5" /> Logs
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRemoveTarget(app.name)}>
                    <HiOutlineTrash className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nova aplicação Python">
        <div className="flex flex-col gap-4">
          <Input
            label="Nome"
            placeholder="minha-api"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Diretório da aplicação"
            placeholder="/var/www/minha-api"
            value={form.directory}
            onChange={e => setForm({ ...form, directory: e.target.value })}
          />
          <Input
            label="Módulo WSGI/ASGI"
            placeholder="app:app  ou  meuprojeto.wsgi:application"
            value={form.module}
            onChange={e => setForm({ ...form, module: e.target.value })}
          />
          <Select
            label="Tipo"
            value={form.framework}
            onChange={e => setForm({ ...form, framework: e.target.value })}
            options={[
              { value: 'wsgi', label: 'WSGI — Django, Flask' },
              { value: 'asgi', label: 'ASGI — FastAPI, Django async' },
            ]}
          />
          <Select
            label="Interpretador"
            value={form.pythonBin}
            onChange={e => setForm({ ...form, pythonBin: e.target.value })}
            options={versions.map(v => ({ value: v.bin, label: `Python ${v.version} (${v.bin})` }))}
          />
          <Input
            label={`Workers (sugerido: ${suggested})`}
            type="number"
            placeholder={String(suggested)}
            value={form.workers}
            onChange={e => setForm({ ...form, workers: e.target.value })}
          />

          <p className="text-xs text-[var(--text-muted)]">
            O painel cria o ambiente virtual, instala
            o <span className="font-mono">requirements.txt</span> (ou <span className="font-mono">pyproject.toml</span>),
            adiciona o gunicorn e gera a unidade systemd. Depois, crie um site NGINX
            do tipo <strong>python</strong> apontando para o socket da aplicação.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button loading={busy === 'create'} onClick={create}>Criar e iniciar</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(logsFor)} onClose={() => setLogsFor(null)} title={`Logs — ${logsFor ?? ''}`} size="xl">
        <pre className="text-xs font-mono whitespace-pre-wrap overflow-auto max-h-[60vh] bg-[var(--bg-hover)] p-3 rounded-lg">
          {logs}
        </pre>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remover aplicação"
        message={`A unidade systemd de "${removeTarget}" será desabilitada e removida. Os arquivos da aplicação e o ambiente virtual são preservados.`}
        confirmLabel="Remover"
        onConfirm={remove}
        onClose={() => setRemoveTarget(null)}
      />
    </AppLayout>
  );
}
