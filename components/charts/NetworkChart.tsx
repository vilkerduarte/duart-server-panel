import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

interface NetworkChartProps {
  data: { time: string; rx: number; tx: number }[];
}

export default function NetworkChart({ data }: NetworkChartProps) {
  if (!data || data.length === 0) {
    return <p className="text-center text-[var(--text-muted)] py-8">Sem dados de rede</p>;
  }

  const formatSpeed = (mbps: number) => `${mbps.toFixed(1)} Mbps`;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="rxGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="txGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={formatSpeed} />
        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#rxGradient)" strokeWidth={2} name="Download" />
        <Area type="monotone" dataKey="tx" stroke="#22c55e" fill="url(#txGradient)" strokeWidth={2} name="Upload" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
