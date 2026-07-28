interface CpuGaugeProps {
  percent: number;
  label?: string;
}

export default function CpuGauge({ percent, label = 'CPU' }: CpuGaugeProps) {
  const getColor = () => {
    if (percent > 80) return '#ef4444';
    if (percent > 60) return '#f59e0b';
    return '#22c55e';
  };

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" className="transform -rotate-90">
        <circle cx="50" cy="50" r={radius} stroke="var(--bg-hover)" strokeWidth="8" fill="none" />
        <circle cx="50" cy="50" r={radius} stroke={getColor()} strokeWidth="8" fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute text-center" style={{ marginTop: -70 }}>
        <div className="text-xl font-bold" style={{ color: getColor() }}>{Math.round(percent)}%</div>
        <div className="text-xs text-[var(--text-muted)]">{label}</div>
      </div>
    </div>
  );
}
