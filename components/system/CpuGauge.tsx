interface CpuGaugeProps {
  percent: number;
  /** Texto pequeno sob o percentual (opcional). */
  label?: string;
  size?: number;
}

export function gaugeColor(percent: number): string {
  if (percent > 80) return '#ef4444';
  if (percent > 60) return '#f59e0b';
  return '#22c55e';
}

/** Anel circular com arco colorido e percentual no centro. */
export default function CpuGauge({ percent, label, size = 96 }: CpuGaugeProps) {
  const safe = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : 0;
  const color = gaugeColor(safe);
  const stroke = 8;
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safe / 100) * circumference;

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? ''} ${Math.round(safe)}%`.trim()}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--gauge-track)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="gauge-arc" style={{ color }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-xl font-bold leading-none" style={{ color }}>{Math.round(safe)}%</div>
        {label && <div className="mt-1 text-[10px] text-[var(--text-muted)]">{label}</div>}
      </div>
    </div>
  );
}
