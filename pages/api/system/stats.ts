import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';
import os from 'os';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CPU_HISTORY_DIR = path.join(DATA_DIR, 'cpu-history');

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  try {
    // Get CPU info from /proc/stat
    const cpuResult = await executeCommand('cpu_info');
    const cpuLines = cpuResult.stdout.split('\n').filter(l => l.startsWith('cpu'));
    const cpuStats = cpuLines[0]?.split(/\s+/).slice(1).map(Number) || [];

    // Calculate CPU percentage (approximate)
    const totalCpu = cpuStats.reduce((a: number, b: number) => a + b, 0);
    const idleCpu = cpuStats[3] || 0;
    const cpuPercent = totalCpu > 0 ? Math.round((1 - idleCpu / totalCpu) * 100) : 0;

    // Memory info
    const memResult = await executeCommand('mem_info');
    const memLines = memResult.stdout.split('\n');
    const memValues: Record<string, number> = {};
    memLines.forEach(line => {
      const parts = line.split(':');
      if (parts.length === 2) {
        const key = parts[0].trim();
        const val = parseInt(parts[1].trim().replace(/\s*kB$/, ''));
        if (!isNaN(val)) memValues[key] = val * 1024; // Convert to bytes
      }
    });

    const memTotal = memValues['MemTotal'] || 0;
    const memFree = (memValues['MemFree'] || 0) + (memValues['Buffers'] || 0) + (memValues['Cached'] || 0);
    const memUsed = memTotal - memFree;
    const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

    // Disk info
    const diskResult = await executeCommand('disk_info');
    const diskLines = diskResult.stdout.split('\n').slice(1); // Skip header
    const disks = diskLines.filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        mount: parts[5] || parts[0] || '',
        total: parseSize(parts[2] || '0'),
        used: parseSize(parts[3] || '0'),
        free: parseSize(parts[4] || '0'),
        percent: parseInt(parts[5] || '0'),
      };
    }).filter(d => d.total > 0);

    // Load average
    const loadResult = await executeCommand('load_info');
    const loadParts = loadResult.stdout.split(/\s+/);
    const load1m = parseFloat(loadParts[0]) || 0;
    const load5m = parseFloat(loadParts[1]) || 0;
    const load15m = parseFloat(loadParts[2]) || 0;

    // Uptime
    const uptimeResult = await executeCommand('uptime_info');
    const uptimeSeconds = parseFloat(uptimeResult.stdout.split(/\s+/)[0]) || 0;

    // Hostname
    const hostnameResult = await executeCommand('hostname_get');

    // OS info
    const osInfo = {
      hostname: hostnameResult.stdout || os.hostname(),
      distro: 'Linux',
      kernel: os.release(),
      arch: os.arch(),
    };

    // Try to get distro info
    try {
      const distroResult = await executeRaw('cat /etc/os-release | head -1', 3000);
      const match = distroResult.stdout.match(/PRETTY_NAME="(.+)"/);
      if (match) osInfo.distro = match[1];
    } catch {}

    // CPU model
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    const cores = os.cpus().length;

    // Write CPU history
    try {
      if (!fs.existsSync(CPU_HISTORY_DIR)) {
        fs.mkdirSync(CPU_HISTORY_DIR, { recursive: true });
      }
      const today = new Date().toISOString().slice(0, 10);
      const historyFile = path.join(CPU_HISTORY_DIR, `${today}.txt`);
      const timestamp = new Date().toISOString();
      const historyLine = `${timestamp},${cpuPercent},${load1m},${load5m},${load15m}\n`;
      fs.appendFileSync(historyFile, historyLine);
    } catch {}

    return res.status(200).json({
      success: true,
      data: {
        cpu: { percent: cpuPercent, cores, model: cpuModel },
        memory: { total: memTotal, used: memUsed, free: memFree, percent: memPercent },
        disk: disks,
        uptime: uptimeSeconds,
        load: { '1m': load1m, '5m': load5m, '15m': load15m },
        os: osInfo,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseSize(str: string): number {
  if (!str) return 0;
  str = str.trim().toUpperCase();
  const num = parseFloat(str);
  if (str.endsWith('T')) return num * 1024 * 1024 * 1024 * 1024;
  if (str.endsWith('G')) return num * 1024 * 1024 * 1024;
  if (str.endsWith('M')) return num * 1024 * 1024;
  if (str.endsWith('K')) return num * 1024;
  return num;
}
