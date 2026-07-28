interface UptimeDisplayProps {
  seconds: number;
}

export default function UptimeDisplay({ seconds }: UptimeDisplayProps) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  return (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <div className="text-2xl font-bold text-[var(--text-primary)]">{d}</div>
        <div className="text-xs text-[var(--text-muted)]">dias</div>
      </div>
      <div className="text-[var(--text-muted)]">:</div>
      <div className="text-center">
        <div className="text-2xl font-bold text-[var(--text-primary)]">{h}</div>
        <div className="text-xs text-[var(--text-muted)]">horas</div>
      </div>
      <div className="text-[var(--text-muted)]">:</div>
      <div className="text-center">
        <div className="text-2xl font-bold text-[var(--text-primary)]">{m}</div>
        <div className="text-xs text-[var(--text-muted)]">min</div>
      </div>
    </div>
  );
}
