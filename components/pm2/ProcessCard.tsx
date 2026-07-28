import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';

interface ProcessCardProps {
  process: any;
  manager: string;
  onAction: (id: string | number, action: string) => void;
  onLogs: (id: string | number, name: string) => void;
}

export default function ProcessCard({ process, manager, onAction, onLogs }: ProcessCardProps) {
  const isPM2 = manager === 'pm2';

  // PM2 fields
  const id = isPM2 ? (process.pm_id ?? process.pm2_env?.pm_id) : process.id;
  const name = isPM2
    ? (process.name || `app-${id}`)
    : (process.name || process.uid || `forever-${id}`);
  const status = isPM2
    ? (process.pm2_env?.status || 'unknown')
    : (process.status || 'unknown');
  const pid = isPM2 ? (process.pid || 0) : (process.pid || 0);
  const cpu = isPM2 ? (process.monit?.cpu || 0) : 0;
  const memory = isPM2
    ? (process.monit?.memory || 0)
    : 0;
  const uptime = isPM2
    ? (process.pm2_env?.pm_uptime ? formatUptime(Date.now() - process.pm2_env.pm_uptime) : '')
    : (process.uptime || '');
  const restarts = isPM2 ? (process.pm2_env?.restart_time || 0) : 0;
  const execMode = isPM2 ? (process.pm2_env?.exec_mode || 'fork') : '';
  const script = isPM2 ? (process.pm2_env?.pm_exec_path || '') : (process.script || '');

  const getStatusBadge = (s: string) => {
    if (s === 'online') return <Badge variant="success">Online</Badge>;
    if (s === 'stopped') return <Badge variant="danger">Stopped</Badge>;
    if (s === 'stopping') return <Badge variant="warning">Stopping</Badge>;
    if (s === 'launching') return <Badge variant="info">Launching</Badge>;
    if (s === 'errored') return <Badge variant="danger">Errored</Badge>;
    if (s === 'running') return <Badge variant="success">Running</Badge>;
    return <Badge>{s}</Badge>;
  };

  const formatMemory = (bytes: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(1)} ${units[i]}`;
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-[var(--text-muted)] font-mono bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">
              #{id}
            </span>
            <h3 className="font-semibold text-[var(--text-primary)] truncate">{name}</h3>
            {getStatusBadge(status)}
            {execMode && (
              <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded uppercase">
                {execMode}
              </span>
            )}
          </div>

          <div className="text-xs text-[var(--text-muted)] space-x-3">
            <span>PID: {pid || '-'}</span>
            {isPM2 && (
              <>
                <span>CPU: {cpu}%</span>
                <span>MEM: {formatMemory(memory)}</span>
              </>
            )}
            <span>Restarts: {restarts}</span>
            {uptime && <span>Uptime: {uptime}</span>}
          </div>

          {script && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1 truncate font-mono opacity-70">
              {script}
            </div>
          )}
        </div>

        <div className="flex gap-1 ml-3 flex-shrink-0">
          <button
            onClick={() => onLogs(id, name)}
            className="px-2 py-1 text-xs rounded bg-slate-600/20 text-slate-400 hover:bg-slate-600/30"
            title="Logs"
          >
            Logs
          </button>
          {status === 'online' || status === 'running' ? (
            <>
              <button
                onClick={() => onAction(id, 'stop')}
                className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
              >
                Stop
              </button>
              <button
                onClick={() => onAction(id, 'restart')}
                className="px-2 py-1 text-xs rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
              >
                Restart
              </button>
              {isPM2 && (
                <button
                  onClick={() => onAction(id, 'reload')}
                  className="px-2 py-1 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                >
                  Reload
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => onAction(id, 'start')}
                className="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30"
              >
                Start
              </button>
            </>
          )}
          <button
            onClick={() => onAction(id, 'delete')}
            className="px-2 py-1 text-xs rounded bg-red-700/20 text-red-500 hover:bg-red-700/30"
            title="Delete"
          >
            Del
          </button>
        </div>
      </div>
    </Card>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
