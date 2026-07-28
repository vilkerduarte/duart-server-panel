import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import Card from '@/components/ui/Card';

interface CpuChartProps {
  data: { timestamp: string; cpu: number; load1: number; load5: number; load15: number }[];
}

export default function CpuChart({ data }: CpuChartProps) {
  if (!data || data.length === 0) {
    return <Card><p className="text-center text-[var(--text-muted)] py-8">Sem dados de CPU</p></Card>;
  }

  const chartData = data.map(d => ({
    time: d.timestamp?.slice(11, 19) || '',
    cpu: Math.round(d.cpu * 10) / 10,
    load: Math.round(d.load1 * 100) / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={[0, 100]} />
        <Tooltip
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-muted)' }}
        />
        <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="url(#cpuGradient)" strokeWidth={2} name="CPU %" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
