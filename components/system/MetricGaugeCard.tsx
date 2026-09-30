import { HiOutlineChevronRight } from 'react-icons/hi2';
import Link from 'next/link';
import CpuGauge from './CpuGauge';

interface MetricGaugeCardProps {
  title: string;
  percent: number;
  detail?: string;
  href?: string;
  detailsLabel?: string;
}

/** Cartão com anel de uso (CPU/RAM/Disco) e legenda de detalhe. */
export default function MetricGaugeCard({ title, percent, detail, href, detailsLabel }: MetricGaugeCardProps) {
  return (
    <div className="glass-card glow-border rounded-2xl p-4 flex items-center gap-4 min-w-0">
      <CpuGauge percent={percent} label={title} />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="my-1.5 h-0.5 w-5 rounded bg-blue-500" />
        {detail && <div className="text-sm text-[var(--text-muted)] truncate">{detail}</div>}
      </div>
      {href && (
        <Link href={href} aria-label={detailsLabel ?? title} className="self-start text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <HiOutlineChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
