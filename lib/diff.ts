/**
 * Diff unificado sem dependências.
 *
 * Existe para que toda escrita em arquivo feita pela IA possa ser mostrada ao
 * usuário antes de acontecer. É isso que substitui a antiga lista de regex de
 * "comandos perigosos": em vez de tentar adivinhar o que é destrutivo, mostra-se
 * exatamente o que vai mudar.
 */

export interface DiffStats {
  added: number;
  removed: number;
}

export interface UnifiedDiff {
  text: string;
  stats: DiffStats;
  identical: boolean;
}

type Op = { type: 'equal' | 'add' | 'remove'; line: string };

/** LCS clássico. Suficiente para arquivos de configuração. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  // Guarda contra arquivos grandes: acima disso o diff vira substituição total.
  if (n * m > 4_000_000) {
    return [
      ...a.map(line => ({ type: 'remove' as const, line })),
      ...b.map(line => ({ type: 'add' as const, line })),
    ];
  }

  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i] });
      i++; j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ type: 'remove', line: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', line: a[i++] });
  while (j < m) ops.push({ type: 'add', line: b[j++] });

  return ops;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

/**
 * Monta o diff unificado com `context` linhas de contexto ao redor de cada
 * trecho alterado, no formato que qualquer pessoa já reconhece de `git diff`.
 */
export function unifiedDiff(
  before: string,
  after: string,
  options: { fromLabel?: string; toLabel?: string; context?: number } = {},
): UnifiedDiff {
  const context = options.context ?? 3;
  const fromLabel = options.fromLabel ?? 'antes';
  const toLabel = options.toLabel ?? 'depois';

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const ops = diffLines(beforeLines, afterLines);

  const stats: DiffStats = {
    added: ops.filter(o => o.type === 'add').length,
    removed: ops.filter(o => o.type === 'remove').length,
  };

  if (stats.added === 0 && stats.removed === 0) {
    return { text: '', stats, identical: true };
  }

  // Marca quais operações ficam visíveis: as alteradas e o contexto ao redor.
  const visible = new Array(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.type === 'equal') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) {
      visible[k] = true;
    }
  });

  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];

  let oldLine = 1;
  let newLine = 1;
  let index = 0;

  while (index < ops.length) {
    if (!visible[index]) {
      if (ops[index].type !== 'add') oldLine++;
      if (ops[index].type !== 'remove') newLine++;
      index++;
      continue;
    }

    const hunkStart = index;
    const hunkOldStart = oldLine;
    const hunkNewStart = newLine;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;

    while (index < ops.length && visible[index]) {
      const op = ops[index];
      if (op.type === 'equal') {
        body.push(` ${op.line}`);
        oldCount++; newCount++; oldLine++; newLine++;
      } else if (op.type === 'remove') {
        body.push(`-${op.line}`);
        oldCount++; oldLine++;
      } else {
        body.push(`+${op.line}`);
        newCount++; newLine++;
      }
      index++;
    }

    if (index > hunkStart) {
      lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
      lines.push(...body);
    }
  }

  return { text: lines.join('\n'), stats, identical: false };
}

/** Resumo de uma linha, para listagens e mensagens de aprovação. */
export function describeDiff(diff: UnifiedDiff): string {
  if (diff.identical) return 'sem alterações';
  return `+${diff.stats.added} −${diff.stats.removed}`;
}
