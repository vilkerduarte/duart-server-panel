/**
 * Persistência de estado em arquivo — escrita atômica e serializada.
 *
 * O painel usa JSON em disco como banco de dados. Escrever direto no arquivo
 * final com writeFileSync deixa duas janelas de corrupção: duas requisições
 * simultâneas se sobrescrevem, e um crash no meio da escrita trunca o arquivo.
 *
 * Aqui toda escrita vai para um temporário no mesmo diretório e entra no lugar
 * via rename (atômico dentro do mesmo filesystem), e todas as operações sobre
 * um mesmo caminho são serializadas por uma fila de promessas.
 */

import fs from 'fs';
import path from 'path';

/** Fila por arquivo: garante que duas escritas no mesmo caminho não se cruzem. */
const queues = new Map<string, Promise<unknown>>();

let tmpCounter = 0;

export function withFileLock<T>(file: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  // O .then duplo faz a fila avançar mesmo quando a operação anterior rejeitou.
  const next = previous.then(() => fn(), () => fn());
  queues.set(file, next.then(() => undefined, () => undefined));
  return next;
}

export function ensureDir(dir: string, mode: number = 0o750): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode });
  }
}

/**
 * Escreve substituindo o arquivo de forma atômica.
 * O fsync antes do rename evita que um corte de energia deixe o conteúdo novo
 * pela metade com o rename já aplicado.
 */
export function writeFileAtomic(file: string, data: string, mode: number = 0o640): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;

  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, data, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

/**
 * Lê JSON tolerando arquivo ausente ou corrompido.
 * Quando o arquivo principal não parseia, tenta o .bak antes de desistir —
 * é o que impede um JSON truncado de derrubar uma página inteira do painel.
 */
export function readJson<T>(file: string, fallback: T): T {
  for (const candidate of [file, `${file}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf-8');
      if (!raw.trim()) continue;
      return JSON.parse(raw) as T;
    } catch {
      // Tenta o próximo candidato.
    }
  }
  return fallback;
}

/** Grava JSON preservando a última versão íntegra em .bak. */
export function writeJson(file: string, data: unknown, mode: number = 0o640): void {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    try {
      const current = fs.readFileSync(file, 'utf-8');
      JSON.parse(current); // só faz backup do que está íntegro
      writeFileAtomic(`${file}.bak`, current, mode);
    } catch {
      // Arquivo atual já estava corrompido: não sobrescreve um .bak possivelmente bom.
    }
  }
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n', mode);
}

/** Ler → modificar → gravar sob lock, para leitura e escrita não se cruzarem. */
export function updateJson<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
  mode: number = 0o640,
): Promise<T> {
  return withFileLock(file, async () => {
    const current = readJson<T>(file, fallback);
    const updated = await mutate(current);
    writeJson(file, updated, mode);
    return updated;
  });
}
