import { exec, ExecOptions } from 'child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandDefinition {
  bin: string;
  baseArgs: string[];
  allowedArgs: RegExp[];
  sudo: boolean;
  timeout: number;
}

export const COMMAND_WHITELIST: Record<string, CommandDefinition> = {
  cpu_info: { bin: 'cat', baseArgs: ['/proc/stat'], allowedArgs: [], sudo: false, timeout: 5000 },
  mem_info: { bin: 'cat', baseArgs: ['/proc/meminfo'], allowedArgs: [], sudo: false, timeout: 5000 },
  load_info: { bin: 'cat', baseArgs: ['/proc/loadavg'], allowedArgs: [], sudo: false, timeout: 5000 },
  disk_info: { bin: 'df', baseArgs: ['-h', '--output=source,fstype,size,used,avail,pcent,target'], allowedArgs: [], sudo: false, timeout: 10000 },
  network_info: { bin: 'cat', baseArgs: ['/proc/net/dev'], allowedArgs: [], sudo: false, timeout: 5000 },
  connections: { bin: 'ss', baseArgs: ['-s'], allowedArgs: [], sudo: false, timeout: 5000 },
  process_list: { bin: 'ps', baseArgs: ['aux', '--sort=-%cpu'], allowedArgs: [], sudo: false, timeout: 10000 },
  os_info: { bin: 'uname', baseArgs: ['-a'], allowedArgs: [], sudo: false, timeout: 5000 },
  hostname_get: { bin: 'hostname', baseArgs: [], allowedArgs: [], sudo: false, timeout: 5000 },
  uptime_info: { bin: 'cat', baseArgs: ['/proc/uptime'], allowedArgs: [], sudo: false, timeout: 5000 },
  listening_ports: { bin: 'ss', baseArgs: ['-tlnp'], allowedArgs: [], sudo: false, timeout: 5000 },
  sockstat: { bin: 'cat', baseArgs: ['/proc/net/sockstat'], allowedArgs: [], sudo: false, timeout: 5000 },

  // Process management
  kill_process: { bin: 'kill', baseArgs: [], allowedArgs: [/^-\d+$/, /^\d+$/], sudo: true, timeout: 5000 },

  // NGINX
  nginx_test: { bin: 'nginx', baseArgs: ['-t'], allowedArgs: [], sudo: true, timeout: 10000 },
  nginx_reload: { bin: 'nginx', baseArgs: ['-s', 'reload'], allowedArgs: [], sudo: true, timeout: 10000 },
  nginx_status: { bin: 'curl', baseArgs: ['-s', 'http://127.0.0.1:8081/nginx_status'], allowedArgs: [], sudo: false, timeout: 5000 },
  nginx_version: { bin: 'nginx', baseArgs: ['-v'], allowedArgs: [], sudo: false, timeout: 5000 },

  // UFW
  ufw_status: { bin: 'ufw', baseArgs: ['status', 'verbose'], allowedArgs: [], sudo: true, timeout: 10000 },
  ufw_allow: { bin: 'ufw', baseArgs: ['allow'], allowedArgs: [/^\d{1,5}(\/\w+)?$/, /^\d{1,5}:\d{1,5}\/\w+$/, /^from\s+\S+$/, /^to\s+\S+$/, /^any$/, /^comment\s+.+$/], sudo: true, timeout: 10000 },
  ufw_delete: { bin: 'ufw', baseArgs: ['delete'], allowedArgs: [/^\d+$/], sudo: true, timeout: 10000 },
  ufw_enable: { bin: 'ufw', baseArgs: ['--force', 'enable'], allowedArgs: [], sudo: true, timeout: 10000 },
  ufw_disable: { bin: 'ufw', baseArgs: ['--force', 'disable'], allowedArgs: [], sudo: true, timeout: 10000 },
  ufw_app_list: { bin: 'ufw', baseArgs: ['app', 'list'], allowedArgs: [], sudo: true, timeout: 5000 },

  // Docker
  docker_ps: { bin: 'docker', baseArgs: ['ps', '-a', '--format', 'json'], allowedArgs: [], sudo: false, timeout: 10000 },
  docker_start: { bin: 'docker', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 30000 },
  docker_stop: { bin: 'docker', baseArgs: ['stop'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 30000 },
  docker_restart: { bin: 'docker', baseArgs: ['restart'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 30000 },
  docker_pause: { bin: 'docker', baseArgs: ['pause'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_unpause: { bin: 'docker', baseArgs: ['unpause'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_remove: { bin: 'docker', baseArgs: ['rm'], allowedArgs: [/^-f$/, /^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_images: { bin: 'docker', baseArgs: ['images', '--format', 'json'], allowedArgs: [], sudo: false, timeout: 10000 },
  docker_pull: { bin: 'docker', baseArgs: ['pull'], allowedArgs: [/^[a-zA-Z0-9_\/\-:.]+$/], sudo: false, timeout: 180000 },
  docker_rmi: { bin: 'docker', baseArgs: ['rmi'], allowedArgs: [/^-f$/, /^[a-zA-Z0-9_\/\-:.]+$/], sudo: false, timeout: 30000 },
  docker_volume_ls: { bin: 'docker', baseArgs: ['volume', 'ls', '--format', 'json'], allowedArgs: [], sudo: false, timeout: 10000 },
  docker_volume_create: { bin: 'docker', baseArgs: ['volume', 'create'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_volume_rm: { bin: 'docker', baseArgs: ['volume', 'rm'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_network_ls: { bin: 'docker', baseArgs: ['network', 'ls', '--format', 'json'], allowedArgs: [], sudo: false, timeout: 10000 },
  docker_network_create: { bin: 'docker', baseArgs: ['network', 'create'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_network_rm: { bin: 'docker', baseArgs: ['network', 'rm'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_logs: { bin: 'docker', baseArgs: ['logs', '--tail', '200'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: false, timeout: 10000 },
  docker_compose_ps: { bin: 'docker', baseArgs: ['compose', 'ps', '--format', 'json'], allowedArgs: [], sudo: false, timeout: 10000 },
  docker_compose_ls: { bin: 'docker', baseArgs: ['compose', 'ls'], allowedArgs: [], sudo: false, timeout: 10000 },

  // Systemctl
  systemctl_status: { bin: 'systemctl', baseArgs: ['status'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 10000 },
  systemctl_start: { bin: 'systemctl', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 30000 },
  systemctl_stop: { bin: 'systemctl', baseArgs: ['stop'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 30000 },
  systemctl_restart: { bin: 'systemctl', baseArgs: ['restart'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 30000 },
  systemctl_reload: { bin: 'systemctl', baseArgs: ['reload'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 10000 },
  systemctl_enable: { bin: 'systemctl', baseArgs: ['enable'], allowedArgs: [/^[a-zA-Z0-9_-]+$/], sudo: true, timeout: 10000 },

  // Hostname
  hostnamectl_set: { bin: 'hostnamectl', baseArgs: ['set-hostname'], allowedArgs: [/^[a-zA-Z0-9_.-]+$/], sudo: true, timeout: 10000 },

  // Certbot / SSL
  certbot_certonly: { bin: 'certbot', baseArgs: ['certonly'], allowedArgs: [/^--webroot$/, /^--nginx$/, /^--manual$/, /^--preferred-challenges$/, /^dns$/, /^http$/, /^--agree-tos$/, /^--non-interactive$/, /^--email$/, /^.+$/, /^-d$/, /^[a-zA-Z0-9*_.-]+$/], sudo: true, timeout: 120000 },
  certbot_renew: { bin: 'certbot', baseArgs: ['renew'], allowedArgs: [/^--quiet$/, /^--dry-run$/], sudo: true, timeout: 120000 },

  // APT
  apt_install: { bin: 'apt-get', baseArgs: ['install', '-y'], allowedArgs: [/^-qq$/, /^mysql-server$/, /^postgresql$/, /^mongod$/, /^fail2ban$/, /^certbot$/, /^python3-certbot-nginx$/], sudo: true, timeout: 300000 },
  apt_update: { bin: 'apt-get', baseArgs: ['update'], allowedArgs: [/^-qq$/], sudo: true, timeout: 60000 },

  // Journalctl
  journalctl: { bin: 'journalctl', baseArgs: [], allowedArgs: [/^-n$/, /^\d+$/, /^--since$/, /^.+$/, /^--no-pager$/], sudo: true, timeout: 10000 },

  // Crontab
  crontab_list: { bin: 'crontab', baseArgs: ['-l'], allowedArgs: [], sudo: false, timeout: 5000 },

  // PM2
  pm2_jlist: { bin: 'pm2', baseArgs: ['jlist'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_start: { bin: 'pm2', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_stop: { bin: 'pm2', baseArgs: ['stop'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_restart: { bin: 'pm2', baseArgs: ['restart'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_reload: { bin: 'pm2', baseArgs: ['reload'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_delete: { bin: 'pm2', baseArgs: ['delete'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
  pm2_save: { bin: 'pm2', baseArgs: ['save'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_startup: { bin: 'pm2', baseArgs: ['startup'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_flush: { bin: 'pm2', baseArgs: ['flush'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_describe: { bin: 'pm2', baseArgs: ['describe'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
  pm2_logs: { bin: 'pm2', baseArgs: ['logs'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/, /^--lines$/, /^\d{1,4}$/, /^--nostream$/], sudo: false, timeout: 10000 },
  pm2_start_app: { bin: 'pm2', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/, /^--name$/, /^[a-zA-Z0-9_\-]+$/, /^--interpreter$/, /^[a-zA-Z0-9_\-./]+$/, /^--cwd$/, /^[a-zA-Z0-9_\-./]+$/, /^--max-memory-restart$/, /^\d+[MG]$/, /^--instances$/, /^\d+$/, /^--env$/, /^[a-zA-Z0-9_\-]+$/], sudo: false, timeout: 30000 },
  pm2_ping: { bin: 'pm2', baseArgs: ['ping'], allowedArgs: [], sudo: false, timeout: 5000 },

  // Forever
  forever_list: { bin: 'forever', baseArgs: ['list', '--plain'], allowedArgs: [], sudo: false, timeout: 10000 },
  forever_start: { bin: 'forever', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/, /^--uid$/, /^[a-zA-Z0-9_\-]+$/, /^--sourceDir$/, /^[a-zA-Z0-9_\-./]+$/, /^--workingDir$/, /^[a-zA-Z0-9_\-./]+$/, /^--minUptime$/, /^\d+$/, /^--spinSleepTime$/, /^\d+$/], sudo: false, timeout: 30000 },
  forever_stop: { bin: 'forever', baseArgs: ['stop'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  forever_restart: { bin: 'forever', baseArgs: ['restart'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  forever_logs: { bin: 'forever', baseArgs: ['logs'], allowedArgs: [/^\d+$/, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
};

export function buildCommand(key: string, extraArgs: string[] = []): { command: string; sudo: boolean; timeout: number } {
  const entry = COMMAND_WHITELIST[key];
  if (!entry) throw new Error(`Comando não permitido: ${key}`);

  for (const arg of extraArgs) {
    const allowed = entry.allowedArgs.some(regex => regex.test(arg));
    if (!allowed && entry.allowedArgs.length > 0) {
      throw new Error(`Argumento não permitido: ${arg}`);
    }
  }

  const args = [...entry.baseArgs, ...extraArgs];
  const cmd = [entry.bin, ...args].join(' ');

  return {
    command: entry.sudo ? `sudo ${cmd}` : cmd,
    sudo: entry.sudo,
    timeout: entry.timeout,
  };
}

export function executeCommand(commandKey: string, extraArgs: string[] = []): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    try {
      const { command, timeout } = buildCommand(commandKey, extraArgs);
      const options: ExecOptions = { timeout, maxBuffer: 10 * 1024 * 1024 };

      exec(command, options, (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
          code: error?.code || 0,
        });
      });
    } catch (err: any) {
      reject(err);
    }
  });
}

export function executeRaw(command: string, timeout: number = 10000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const options: ExecOptions = { timeout, maxBuffer: 10 * 1024 * 1024 };
    exec(command, options, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout).trim(),
        stderr: String(stderr).trim(),
        code: error?.code || 0,
      });
    });
  });
}
