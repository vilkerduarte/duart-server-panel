import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, Line, ComposedChart } from 'recharts';
import { useI18n } from '@/lib/contexts/I18nContext';

interface CpuChartProps {
  data: { timestamp: string; cpu: number; load1: number; load5: number; load15: number }[];
  height?: number;
}

const AVG_WINDOW = 5;

export default function CpuChart({ data, height = 190 }: CpuChartProps) {
  const { t, locale } = useI18n();

  if (!data || data.length === 0) {
    return <p className="text-center text-[var(--text-muted)] py-8 text-sm">{t('dashboard.noData')}</p>;
  }

  const chartData = data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - AVG_WINDOW + 1), i + 1);
    const avg = slice.reduce((sum, p) => sum + (p.cpu || 0), 0) / slice.length;
    const date = new Date(d.timestamp);
    return {
      time: Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      cpu: Math.round((d.cpu || 0) * 10) / 10,
      avg: Math.round(avg * 10) / 10,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="var(--grid-line)" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval="preserveStartEnd" axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: 12, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-muted)' }}
        />
        <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="url(#cpuGradient)" strokeWidth={2} name={t('dashboard.cpuTotal')} dot={false} />
        <Line type="monotone" dataKey="avg" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} name={t('dashboard.avg5m')} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
