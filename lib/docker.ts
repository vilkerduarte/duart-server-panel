/**
 * Docker helper utilities.
 * Parsers for Docker CLI JSON output and formatting helpers.
 */

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'paused' | 'unknown';
  status: string;
  ports: string;
  cpu: number;
  memory: number;
  networkIO: string;
  created: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: number;
  created: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface DockerNetwork {
  name: string;
  driver: string;
  scope: string;
}

/**
 * Parses raw `docker ps -a --format json` output into typed containers.
 */
export function parseContainers(rawOutput: string): DockerContainer[] {
  const lines = rawOutput.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const raw = JSON.parse(line);
      return {
        id: raw.ID || '',
        name: raw.Names || raw.Name || '',
        image: raw.Image || '',
        state: normalizeState(raw.State || raw.state || 'unknown'),
        status: raw.Status || raw.status || '',
        ports: raw.Ports || raw.ports || '',
        cpu: parseFloat(raw.CPU || raw.cpu || '0'),
        memory: parseFloat(raw.Memory || raw.memory || '0'),
        networkIO: raw.NetIO || raw.NetworkIO || '',
        created: raw.CreatedAt || raw.created || '',
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as DockerContainer[];
}

/**
 * Parses raw `docker images --format json` output.
 */
export function parseImages(rawOutput: string): DockerImage[] {
  const lines = rawOutput.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const raw = JSON.parse(line);
      return {
        id: raw.ID || '',
        repository: raw.Repository || '',
        tag: raw.Tag || 'latest',
        size: parseSize(raw.Size || '0'),
        created: raw.CreatedAt || raw.CreatedSince || '',
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as DockerImage[];
}

/**
 * Parses raw `docker volume ls --format json` output.
 */
export function parseVolumes(rawOutput: string): DockerVolume[] {
  const lines = rawOutput.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const raw = JSON.parse(line);
      return {
        name: raw.Name || '',
        driver: raw.Driver || 'local',
        mountpoint: raw.Mountpoint || '',
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as DockerVolume[];
}

/**
 * Parses raw `docker network ls --format json` output.
 */
export function parseNetworks(rawOutput: string): DockerNetwork[] {
  const lines = rawOutput.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const raw = JSON.parse(line);
      return {
        name: raw.Name || '',
        driver: raw.Driver || 'bridge',
        scope: raw.Scope || 'local',
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as DockerNetwork[];
}

function normalizeState(state: string): DockerContainer['state'] {
  const s = state.toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'exited') return 'exited';
  if (s === 'paused') return 'paused';
  return 'unknown';
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return Math.round(value * (multipliers[unit] || 1));
}
