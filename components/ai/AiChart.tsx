import { useI18n } from '@/lib/contexts/I18nContext';

/**
 * Gráfico desenhado a partir de um bloco ```chart escrito pelo modelo.
 * Sem biblioteca: barras em CSS e SVG simples bastam para o que a IA produz
 * (comparação de valores, participação no total, evolução) e não trazem
 * dependência nem injetam HTML do modelo na página.
 */

export interface ChartSpec {
  type: 'bar' | 'donut' | 'line';
  title?: string;
  unit?: string;
  series: string[];
  data: Array<{ label: string; values: number[] }>;
}

const PALETTE = ['#3b82f6', '#a855f7', '#22c55e', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#94a3b8'];
const MAX_ITEMS = 12;
const MAX_SERIES = 4;

/** Valida o JSON do modelo; devolve null se não der para desenhar. */
export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const json = JSON.parse(raw);
    const type = json?.type;
    if (type !== 'bar' && type !== 'donut' && type !== 'line') return null;
    if (!Array.isArray(json.data) || json.data.length === 0) return null;

    const data = json.data.slice(0, MAX_ITEMS).map((row: { label?: unknown; values?: unknown; value?: unknown }) => {
      const values = Array.isArray(row?.values) ? row.values : [row?.value];
      return {
        label: String(row?.label ?? ''),
        values: values.slice(0, MAX_SERIES).map((v: unknown) => Number(v)).map((v: number) => (Number.isFinite(v) ? v : 0)),
      };
    });

    const width = Math.max(...data.map((d: { values: number[] }) => d.values.length));
    const names: string[] = Array.isArray(json.series) ? json.series.map(String).slice(0, MAX_SERIES) : [];
    const series = Array.from({ length: width }, (_, i) => names[i] ?? '');

    return {
      type,
      title: typeof json.title === 'string' ? json.title : undefined,
      unit: typeof json.unit === 'string' ? json.unit : undefined,
      series,
      data,
    };
  } catch {
    return null;
  }
}

export default function AiChart({ spec }: { spec: ChartSpec }) {
  const { locale, t } = useI18n();

  const number = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const withUnit = (n: number) => `${number(n)}${spec.unit ? ` ${spec.unit}` : ''}`;
  const showLegend = spec.series.some(Boolean) && spec.type !== 'donut';

  return (
    <figure className="my-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--bg-secondary)]/60 p-4">
      {spec.title && (
        <figcaption className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{spec.title}</figcaption>
      )}

      {showLegend && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          {spec.series.map((name, i) => name && (
            <span key={i} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              {name}
            </span>
          ))}
        </div>
      )}

      {spec.type === 'bar' && <Bars spec={spec} withUnit={withUnit} />}
      {spec.type === 'donut' && <Donut spec={spec} withUnit={withUnit} number={number} totalLabel={t('ai.chartTotal')} />}
      {spec.type === 'line' && <Lines spec={spec} number={number} withUnit={withUnit} />}
    </figure>
  );
}

function Bars({ spec, withUnit }: { spec: ChartSpec; withUnit: (n: number) => string }) {
  const max = Math.max(1e-9, ...spec.data.flatMap(d => d.values));

  return (
    <div className="flex flex-col gap-2.5">
      {spec.data.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(4rem,9rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate font-mono text-[var(--text-secondary)]" title={row.label}>{row.label}</span>

          <div className="flex flex-col gap-1">
            {row.values.map((value, i) => (
              <div key={i} className="h-2.5 rounded-full bg-[var(--gauge-track)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max((value / max) * 100, value > 0 ? 1.5 : 0)}%`, background: PALETTE[i % PALETTE.length] }}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col items-end gap-1 tabular-nums text-[var(--text-muted)]">
            {row.values.map((value, i) => (
              <span key={i} className="leading-[10px]" style={i === 0 ? { color: 'var(--text-primary)' } : undefined}>
                {withUnit(value)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Donut({
  spec, withUnit, number, totalLabel,
}: {
  spec: ChartSpec;
  withUnit: (n: number) => string;
  number: (n: number) => string;
  totalLabel: string;
}) {
  const items = spec.data.map(d => ({ label: d.label, value: Math.max(d.values[0] ?? 0, 0) }));
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  // Onde cada fatia começa: soma acumulada dos comprimentos anteriores.
  const starts = items.reduce<number[]>((acc, item, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (items[i - 1].value / total) * circumference);
    return acc;
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--gauge-track)" strokeWidth="18" />
          {items.map((item, i) => {
            const length = (item.value / total) * circumference;
            return (
              <circle
                key={i} cx="70" cy="70" r={radius} fill="none" strokeWidth="18"
                stroke={PALETTE[i % PALETTE.length]}
                strokeDasharray={`${Math.max(length - 1.5, 0)} ${circumference}`}
                strokeDashoffset={-starts[i]}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{withUnit(total === 1 && items.every(i => i.value === 0) ? 0 : total)}</span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{totalLabel}</span>
        </div>
      </div>

      <ul className="m-0 flex min-w-[12rem] flex-1 list-none flex-col gap-1.5 p-0 text-xs">
        {items.map((item, i) => (
          <li key={i} className="m-0 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate font-mono text-[var(--text-secondary)]" title={item.label}>{item.label}</span>
            <span className="tabular-nums text-[var(--text-primary)]">{withUnit(item.value)}</span>
            <span className="w-12 text-right tabular-nums text-[var(--text-muted)]">{number((item.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Lines({
  spec, number, withUnit,
}: {
  spec: ChartSpec;
  number: (n: number) => string;
  withUnit: (n: number) => string;
}) {
  const width = 560;
  const height = 180;
  const pad = { left: 40, right: 12, top: 10, bottom: 24 };
  const all = spec.data.flatMap(d => d.values);
  const min = Math.min(0, ...all);
  const max = Math.max(1e-9, ...all);
  const span = max - min || 1;

  const x = (i: number) => pad.left + (spec.data.length === 1 ? 0.5 : i / (spec.data.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - min) / span) * (height - pad.top - pad.bottom);

  const seriesCount = Math.max(1, spec.series.length);
  const labelEvery = Math.ceil(spec.data.length / 7);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={spec.title}>
      {[0, 0.5, 1].map(f => {
        const value = min + span * f;
        return (
          <g key={f}>
            <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} stroke="var(--grid-line)" strokeDasharray="3 4" />
            <text x={pad.left - 6} y={y(value) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{number(value)}</text>
          </g>
        );
      })}

      {spec.data.map((row, i) => i % labelEvery === 0 && (
        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{row.label}</text>
      ))}

      {Array.from({ length: seriesCount }, (_, s) => {
        const points = spec.data.map((row, i) => `${x(i)},${y(row.values[s] ?? 0)}`).join(' ');
        return (
          <g key={s}>
            <polyline points={points} fill="none" stroke={PALETTE[s % PALETTE.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {spec.data.map((row, i) => (
              <circle key={i} cx={x(i)} cy={y(row.values[s] ?? 0)} r="2.5" fill={PALETTE[s % PALETTE.length]}>
                <title>{`${row.label}: ${withUnit(row.values[s] ?? 0)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
