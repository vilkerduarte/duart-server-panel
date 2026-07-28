import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Card from '@/components/ui/Card';

interface MemoryChartProps {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export default function MemoryChart({ total, used, free, percent }: MemoryChartProps) {
  const formatBytes = (b: number) => {
    if (!b) return '0 GB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const data = [
    { name: 'Usado', value: used, color: percent > 80 ? '#ef4444' : percent > 60 ? '#f59e0b' : '#8b5cf6' },
    { name: 'Livre', value: free, color: '#334155' },
  ];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={formatBytes} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={50} />
        <Tooltip
          formatter={(value: number) => [formatBytes(value), '']}
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
