import { useState, ReactNode } from 'react';
import { HiOutlineClipboard, HiOutlineCheck } from 'react-icons/hi2';
import { useI18n } from '@/lib/contexts/I18nContext';
import AiChart, { parseChartSpec } from './AiChart';

/**
 * Renderizador de markdown para as respostas do assistente.
 *
 * Cobre o que o modelo usa de fato — títulos, listas, tabelas, citações, blocos
 * de código, negrito, itálico, código inline e links — mais o bloco ```chart
 * que vira gráfico. É escrito à mão para não trazer dependência nem deixar o
 * modelo injetar HTML na página: tudo vira elemento React, nunca innerHTML.
 */

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; ordered: boolean; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][]; align: Array<'left' | 'right' | 'center'> }
  | { t: 'quote'; text: string }
  | { t: 'hr' }
  | { t: 'code'; lang: string; code: string; closed: boolean };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const startsBlock = (line: string, next?: string) =>
    FENCE.test(line) || /^\s{0,3}#{1,4}\s/.test(line) || BULLET.test(line) || ORDERED.test(line) ||
    /^\s*>/.test(line) || /^\s*([-*_])\1{2,}\s*$/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_RULE.test(next));

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const fence = line.match(FENCE);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      const closed = i < lines.length;
      if (closed) i++;
      blocks.push({ t: 'code', lang: fence[1].toLowerCase(), code: code.join('\n'), closed });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') });
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(cell =>
        cell.startsWith(':') && cell.endsWith(':') ? 'center' as const
          : cell.endsWith(':') ? 'right' as const
          : 'left' as const);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ t: 'table', head, rows, align });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ t: 'quote', text: quote.join('\n') });
      continue;
    }

    const bullet = BULLET.test(line);
    if (bullet || ORDERED.test(line)) {
      const pattern = bullet ? BULLET : ORDERED;
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(pattern);
        if (match) {
          items.push(match[1]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          // continuação indentada do item anterior
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ t: 'list', ordered: !bullet, items });
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) paragraph.push(lines[i++]);
    blocks.push({ t: 'p', text: paragraph.join('\n') });
  }

  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (!part) return null;

    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded-md bg-[var(--bg-hover)]/70 px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--text-primary)]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length > 4 && ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')))) {
      return <strong key={index} className="font-semibold text-[var(--text-primary)]">{inline(part.slice(2, -2))}</strong>;
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{inline(part.slice(1, -1))}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline-offset-2 hover:underline">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-black/25">
      <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        <span>{lang || 'text'}</span>
        <button onClick={copy} className="flex items-center gap-1 normal-case tracking-normal hover:text-[var(--text-primary)]">
          {copied ? <HiOutlineCheck className="h-3 w-3 text-emerald-400" /> : <HiOutlineClipboard className="h-3 w-3" />}
          {copied ? t('ai.copied') : t('ai.copy')}
        </button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">{code}</pre>
    </div>
  );
}

function ChartBlock({ code, closed }: { code: string; closed: boolean }) {
  const { t } = useI18n();
  const spec = closed ? parseChartSpec(code) : null;

  if (spec) return <AiChart spec={spec} />;

  // Enquanto o JSON ainda está chegando pelo stream, mostra um espaço reservado.
  if (!closed) {
    return <div className="my-3 h-24 animate-pulse rounded-2xl border border-[var(--glass-border)] bg-[var(--bg-secondary)]/50" />;
  }
  return <CodeBlock lang={t('ai.chartInvalid')} code={code} />;
}

export default function AiMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);

  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-[var(--text-secondary)] [&_ol]:m-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5">
      {blocks.map((block, index) => {
        switch (block.t) {
          case 'h': {
            const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm';
            return <p key={index} className={`m-0 mt-1 font-semibold text-[var(--text-primary)] ${size}`}>{inline(block.text)}</p>;
          }
          case 'p':
            return <p key={index} className="m-0 whitespace-pre-wrap">{inline(block.text)}</p>;
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return <List key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</List>;
          }
          case 'quote':
            return (
              <blockquote key={index} className="m-0 border-l-2 border-blue-500/60 bg-blue-500/5 py-1 pl-3 text-[var(--text-secondary)]">
                {inline(block.text)}
              </blockquote>
            );
          case 'hr':
            return <hr key={index} />;
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-[var(--bg-hover)]/50">
                    <tr>
                      {block.head.map((cell, i) => (
                        <th key={i} style={{ textAlign: block.align[i] ?? 'left' }} className="border-b border-[var(--glass-border)] px-3 py-2 font-semibold text-[var(--text-primary)]">
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-[var(--glass-border)]/60 last:border-0 hover:bg-[var(--bg-hover)]/30">
                        {block.head.map((_, c) => (
                          <td key={c} style={{ textAlign: block.align[c] ?? 'left' }} className="px-3 py-1.5 align-top">
                            {inline(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return block.lang === 'chart'
              ? <ChartBlock key={index} code={block.code} closed={block.closed} />
              : <CodeBlock key={index} lang={block.lang} code={block.code} />;
        }
      })}
    </div>
  );
}
