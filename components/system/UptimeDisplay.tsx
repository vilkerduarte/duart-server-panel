import { HiOutlineClock } from 'react-icons/hi2';
import { useI18n } from '@/lib/contexts/I18nContext';

interface UptimeDisplayProps {
  seconds: number;
  /** Exibe o ícone de relógio e a legenda "Uptime do sistema". */
  showCaption?: boolean;
}

export function splitUptime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return {
    d: Math.floor(safe / 86400),
    h: Math.floor((safe % 86400) / 3600),
    m: Math.floor((safe % 3600) / 60),
  };
}

export default function UptimeDisplay({ seconds, showCaption = true }: UptimeDisplayProps) {
  const { t } = useI18n();
  const { d, h, m } = splitUptime(seconds);
  const cells = [
    { value: d, label: t('dashboard.days') },
    { value: h, label: t('dashboard.hours') },
    { value: m, label: t('dashboard.minutes') },
  ];

  return (
    <div className="flex items-center gap-4 sm:gap-5">
      {showCaption && (
        <div className="flex h-14 w-14 sm:h-16 sm:w-16 flex-shrink-0 items-center justify-center rounded-full border border-[var(--glow-blue)] bg-blue-500/10 text-blue-400 shadow-[0_0_18px_var(--glow-blue)]">
          <HiOutlineClock className="w-7 h-7" />
        </div>
      )}
      <div>
        <div className="flex items-start gap-5">
          {cells.map(cell => (
            <div key={cell.label} className="text-center">
              <div className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{cell.value}</div>
              <div className="text-xs text-[var(--text-muted)]">{cell.label}</div>
            </div>
          ))}
        </div>
        {showCaption && <div className="mt-2 text-xs text-[var(--text-secondary)]">{t('dashboard.uptimeSystem')}</div>}
      </div>
    </div>
  );
}
