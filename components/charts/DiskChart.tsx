import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DiskChartProps {
  disks: { mount: string; used: number; free: number; percent: number }[];
}

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4'];

export default function DiskChart({ disks }: DiskChartProps) {
  const formatBytes = (b: number) => {
    if (!b) return '0 GB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const pieData = disks.map((d, i) => ({
    name: d.mount,
    value: d.used,
    percent: d.percent,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
          {pieData.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [formatBytes(value), 'Usado']}
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
