import type { NextApiResponse } from 'next';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';
import { cpuDelta } from '@/lib/ai/tools';
import { ensureDir } from '@/lib/fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const CPU_HISTORY_DIR = path.join(DATA_DIR, 'cpu-history');

/**
 * Amostra anterior de /proc/stat.
 *
 * O cálculo antigo usava os totais acumulados desde o boot, que devolvem a
 * média histórica da máquina — um número praticamente constante que não reage a
 * carga. Percentual de CPU só existe entre duas amostras; guardar a anterior em
 * memória evita bloquear a requisição esperando a segunda.
 */
let previousSample: { raw: string; at: number } | null = null;

/** O histórico é gravado no máximo uma vez por minuto, não a cada page load. */
let lastHistoryWrite = 0;
const HISTORY_INTERVAL_MS = 60_000;

async function sampleCpu(): Promise<number> {
  const current = await executeCommand('cpu_info');
  const now = Date.now();

  // Sem amostra anterior recente, tira uma segunda leitura curta.
  if (!previousSample || now - previousSample.at > 120_000) {
    await new Promise(resolve => setTimeout(resolve, 150));
    const second = await executeCommand('cpu_info');
    previousSample = { raw: second.stdout, at: Date.now() };
    return cpuDelta(current.stdout, second.stdout);
  }

  const percent = cpuDelta(previousSample.raw, current.stdout);
  previousSample = { raw: current.stdout, at: now };
  return percent;
}

function parseMeminfo(raw: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const [key, rest] = line.split(':');
    if (!rest) continue;
    const value = parseInt(rest.trim().replace(/\s*kB$/, ''), 10);
    if (!Number.isNaN(value)) values[key.trim()] = value * 1024;
  }
  return values;
}

function parseSize(value: string): number {
  if (!value) return 0;
  const text = value.trim().toUpperCase();
  const num = parseFloat(text);
  if (Number.isNaN(num)) return 0;
  if (text.endsWith('T')) return num * 1024 ** 4;
  if (text.endsWith('G')) return num * 1024 ** 3;
  if (text.endsWith('M')) return num * 1024 ** 2;
  if (text.endsWith('K')) return num * 1024;
  return num;
}

function writeHistory(cpuPercent: number, load: number[]): void {
  const now = Date.now();
  if (now - lastHistoryWrite < HISTORY_INTERVAL_MS) return;
  lastHistoryWrite = now;

  try {
    ensureDir(CPU_HISTORY_DIR);
    const today = new Date().toISOString().slice(0, 10);
    const line = `${new Date().toISOString()},${cpuPercent},${load[0]},${load[1]},${load[2]}\n`;
    fs.appendFileSync(path.join(CPU_HISTORY_DIR, `${today}.txt`), line);
    pruneHistory();
  } catch {
    // Histórico é acessório; falhar aqui não pode derrubar o dashboard.
  }
}

/** A limpeza anunciada na tela de Cron não existia; agora acontece de fato. */
function pruneHistory(): void {
  try {
    const cutoff = Date.now() - 30 * 86400_000;
    for (const file of fs.readdirSync(CPU_HISTORY_DIR)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.txt$/);
      if (!match) continue;
      if (new Date(match[1]).getTime() < cutoff) {
        fs.rmSync(path.join(CPU_HISTORY_DIR, file), { force: true });
      }
    }
  } catch {}
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    const [cpuPercent, memResult, diskResult, loadResult, hostnameResult] = await Promise.all([
      sampleCpu(),
      executeCommand('mem_info'),
      executeCommand('disk_info'),
      executeCommand('load_info'),
      executeCommand('hostname_get'),
    ]);

    const mem = parseMeminfo(memResult.stdout);
    const memTotal = mem.MemTotal ?? 0;
    // MemAvailable é a estimativa do próprio kernel do que dá para alocar sem
    // swap. A soma antiga (MemFree + Buffers + Cached) superestima o livre,
    // porque parte do cache não é recuperável.
    const memAvailable = mem.MemAvailable ?? ((mem.MemFree ?? 0) + (mem.Buffers ?? 0) + (mem.Cached ?? 0));
    const memUsed = Math.max(0, memTotal - memAvailable);

    const disks = diskResult.stdout.split('\n').slice(1).filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        device: parts[0] ?? '',
        fstype: parts[1] ?? '',
        total: parseSize(parts[2] ?? '0'),
        used: parseSize(parts[3] ?? '0'),
        free: parseSize(parts[4] ?? '0'),
        percent: parseInt((parts[5] ?? '0').replace('%', ''), 10) || 0,
        mount: parts[6] ?? '',
      };
    }).filter(d => d.total > 0 && !/^(tmpfs|devtmpfs|squashfs|overlay)$/.test(d.fstype));

    const loadParts = loadResult.stdout.split(/\s+/);
    const load = [
      parseFloat(loadParts[0]) || 0,
      parseFloat(loadParts[1]) || 0,
      parseFloat(loadParts[2]) || 0,
    ];

    const distroResult = await executeRaw('cat /etc/os-release', 3000);

    writeHistory(cpuPercent, load);

    return res.status(200).json({
      success: true,
      data: {
        cpu: { percent: cpuPercent, cores: os.cpus().length, model: os.cpus()[0]?.model ?? 'Desconhecido' },
        memory: {
          total: memTotal,
          used: memUsed,
          free: memAvailable,
          available: memAvailable,
          percent: memTotal ? Math.round((memUsed / memTotal) * 100) : 0,
          swapTotal: mem.SwapTotal ?? 0,
          swapUsed: Math.max(0, (mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0)),
        },
        disk: disks,
        uptime: os.uptime(),
        load: { '1m': load[0], '5m': load[1], '15m': load[2] },
        os: {
          hostname: hostnameResult.stdout || os.hostname(),
          distro: distroResult.stdout.match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? 'Linux',
          kernel: os.release(),
          arch: os.arch(),
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
