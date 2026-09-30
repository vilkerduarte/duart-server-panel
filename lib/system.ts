import { exec, execFile, ExecOptions, ExecFileOptions } from 'child_process';

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

/* ------------------------------------------------------------------ */
/*  Padrões de argumento reutilizáveis                                 */
/* ------------------------------------------------------------------ */

const RE_UNIT = /^[a-zA-Z0-9_.@\\-]+(\.(service|socket|timer|target))?$/;
const RE_DOMAIN = /^\*?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
const RE_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const RE_PATH = /^\/[a-zA-Z0-9_./@+-]*$/;
const RE_NAME = /^[a-zA-Z0-9_.-]+$/;
const RE_INT = /^\d+$/;
const RE_PHP_PKG = /^php\d\.\d+(-[a-z0-9]+)?$/;
const RE_PY_PKG = /^python3(\.\d+)?(-[a-z0-9]+)?$/;
const RE_TIMESPEC = /^[a-zA-Z0-9 :+-]+$/;

/* ------------------------------------------------------------------ */
/*  Whitelist                                                          */
/* ------------------------------------------------------------------ */

export const COMMAND_WHITELIST: Record<string, CommandDefinition> = {
  cpu_info: { bin: 'cat', baseArgs: ['/proc/stat'], allowedArgs: [], sudo: false, timeout: 5000 },
  mem_info: { bin: 'cat', baseArgs: ['/proc/meminfo'], allowedArgs: [], sudo: false, timeout: 5000 },
  load_info: { bin: 'cat', baseArgs: ['/proc/loadavg'], allowedArgs: [], sudo: false, timeout: 5000 },
  disk_info: { bin: 'df', baseArgs: ['-h', '--output=source,fstype,size,used,avail,pcent,target'], allowedArgs: [], sudo: false, timeout: 10000 },
  disk_inodes: { bin: 'df', baseArgs: ['-i', '--output=target,ipcent'], allowedArgs: [], sudo: false, timeout: 10000 },
  ps_pid_stats: { bin: 'ps', baseArgs: ['-o', 'pcpu=,pmem=,rss=', '-p'], allowedArgs: [RE_INT], sudo: false, timeout: 5000 },
  network_info: { bin: 'cat', baseArgs: ['/proc/net/dev'], allowedArgs: [], sudo: false, timeout: 5000 },
  connections: { bin: 'ss', baseArgs: ['-s'], allowedArgs: [], sudo: false, timeout: 5000 },
  process_list: { bin: 'ps', baseArgs: ['aux', '--sort=-%cpu'], allowedArgs: [], sudo: false, timeout: 10000 },
  os_info: { bin: 'uname', baseArgs: ['-a'], allowedArgs: [], sudo: false, timeout: 5000 },
  hostname_get: { bin: 'hostname', baseArgs: [], allowedArgs: [], sudo: false, timeout: 5000 },
  uptime_info: { bin: 'cat', baseArgs: ['/proc/uptime'], allowedArgs: [], sudo: false, timeout: 5000 },
  listening_ports: { bin: 'ss', baseArgs: ['-tlnp'], allowedArgs: [], sudo: false, timeout: 5000 },
  sockstat: { bin: 'cat', baseArgs: ['/proc/net/sockstat'], allowedArgs: [], sudo: false, timeout: 5000 },

  // Processos
  kill_process: { bin: 'kill', baseArgs: [], allowedArgs: [/^-\d+$/, RE_INT], sudo: true, timeout: 5000 },

  // NGINX
  nginx_test: { bin: 'nginx', baseArgs: ['-t'], allowedArgs: [], sudo: true, timeout: 15000 },
  nginx_reload: { bin: 'nginx', baseArgs: ['-s', 'reload'], allowedArgs: [], sudo: true, timeout: 15000 },
  nginx_status: { bin: 'curl', baseArgs: ['-s', 'http://127.0.0.1:8081/nginx_status'], allowedArgs: [], sudo: false, timeout: 5000 },
  nginx_version: { bin: 'nginx', baseArgs: ['-v'], allowedArgs: [], sudo: false, timeout: 5000 },

  // UFW
  ufw_status: { bin: 'ufw', baseArgs: ['status', 'verbose'], allowedArgs: [], sudo: true, timeout: 10000 },
  ufw_allow: { bin: 'ufw', baseArgs: ['allow'], allowedArgs: [/^\d{1,5}(\/\w+)?$/, /^\d{1,5}:\d{1,5}\/\w+$/, /^from$/, /^to$/, /^any$/, /^comment$/, /^[a-zA-Z0-9_.:/ -]+$/], sudo: true, timeout: 10000 },
  ufw_delete: { bin: 'ufw', baseArgs: ['delete'], allowedArgs: [RE_INT], sudo: true, timeout: 10000 },
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

  // Systemd
  systemctl_status: { bin: 'systemctl', baseArgs: ['status', '--no-pager'], allowedArgs: [RE_UNIT], sudo: true, timeout: 10000 },
  systemctl_is_active: { bin: 'systemctl', baseArgs: ['is-active'], allowedArgs: [RE_UNIT], sudo: false, timeout: 5000 },
  systemctl_is_enabled: { bin: 'systemctl', baseArgs: ['is-enabled'], allowedArgs: [RE_UNIT], sudo: false, timeout: 5000 },
  systemctl_start: { bin: 'systemctl', baseArgs: ['start'], allowedArgs: [RE_UNIT], sudo: true, timeout: 30000 },
  systemctl_stop: { bin: 'systemctl', baseArgs: ['stop'], allowedArgs: [RE_UNIT], sudo: true, timeout: 30000 },
  systemctl_restart: { bin: 'systemctl', baseArgs: ['restart'], allowedArgs: [RE_UNIT], sudo: true, timeout: 30000 },
  systemctl_reload: { bin: 'systemctl', baseArgs: ['reload'], allowedArgs: [RE_UNIT], sudo: true, timeout: 10000 },
  systemctl_enable: { bin: 'systemctl', baseArgs: ['enable'], allowedArgs: [RE_UNIT, /^--now$/], sudo: true, timeout: 15000 },
  systemctl_disable: { bin: 'systemctl', baseArgs: ['disable'], allowedArgs: [RE_UNIT, /^--now$/], sudo: true, timeout: 15000 },
  systemctl_daemon_reload: { bin: 'systemctl', baseArgs: ['daemon-reload'], allowedArgs: [], sudo: true, timeout: 15000 },
  systemctl_list_unit_files: { bin: 'systemctl', baseArgs: ['list-unit-files', '--type=service', '--no-pager', '--plain', '--no-legend'], allowedArgs: [/^[a-zA-Z0-9*_.@-]+$/], sudo: false, timeout: 8000 },
  systemctl_show_props: { bin: 'systemctl', baseArgs: ['show', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'MemoryCurrent'], allowedArgs: [RE_UNIT], sudo: false, timeout: 5000 },
  systemctl_list_timers: { bin: 'systemctl', baseArgs: ['list-timers', '--all', '--no-pager', '--output=json'], allowedArgs: [], sudo: false, timeout: 10000 },

  // Hostname
  hostnamectl_set: { bin: 'hostnamectl', baseArgs: ['set-hostname'], allowedArgs: [/^[a-zA-Z0-9_.-]+$/], sudo: true, timeout: 10000 },

  // Certbot / SSL
  certbot_certonly: {
    bin: 'certbot',
    baseArgs: ['certonly'],
    allowedArgs: [
      /^--webroot$/, /^-w$/, /^--agree-tos$/, /^--non-interactive$/, /^--quiet$/,
      /^--email$/, RE_EMAIL, /^--register-unsafely-without-email$/,
      /^-d$/, RE_DOMAIN,
      /^--cert-name$/, RE_NAME,
      /^--key-type$/, /^(ecdsa|rsa)$/,
      /^--preferred-challenges$/, /^(http|dns)$/,
      /^--dns-cloudflare$/, /^--dns-cloudflare-credentials$/,
      /^--dns-route53$/, /^--dns-digitalocean$/, /^--dns-digitalocean-credentials$/,
      /^--dns-cloudflare-propagation-seconds$/, RE_INT,
      /^--expand$/, /^--force-renewal$/, /^--dry-run$/,
      RE_PATH,
    ],
    sudo: true,
    timeout: 180000,
  },
  certbot_renew: { bin: 'certbot', baseArgs: ['renew'], allowedArgs: [/^--quiet$/, /^--dry-run$/, /^--cert-name$/, RE_NAME, /^--force-renewal$/], sudo: true, timeout: 180000 },
  certbot_certificates: { bin: 'certbot', baseArgs: ['certificates'], allowedArgs: [/^--cert-name$/, RE_NAME], sudo: true, timeout: 30000 },
  certbot_delete: { bin: 'certbot', baseArgs: ['delete', '--non-interactive'], allowedArgs: [/^--cert-name$/, RE_NAME], sudo: true, timeout: 30000 },

  // OpenSSL
  openssl_x509: { bin: 'openssl', baseArgs: ['x509', '-noout'], allowedArgs: [/^-in$/, RE_PATH, /^-enddate$/, /^-startdate$/, /^-issuer$/, /^-subject$/, /^-ext$/, /^subjectAltName$/, /^-fingerprint$/, /^-sha256$/], sudo: true, timeout: 10000 },

  // APT
  apt_install: {
    bin: 'apt-get',
    baseArgs: ['install', '-y'],
    allowedArgs: [
      /^-qq$/, /^--no-install-recommends$/,
      /^mysql-server$/, /^postgresql$/, /^mongodb-org$/, /^mongod$/,
      /^fail2ban$/, /^certbot$/, /^python3-certbot-nginx$/, /^python3-certbot-dns-cloudflare$/,
      RE_PHP_PKG, RE_PY_PKG,
    ],
    sudo: true,
    timeout: 600000,
  },
  apt_remove: { bin: 'apt-get', baseArgs: ['remove', '-y'], allowedArgs: [/^-qq$/, RE_PHP_PKG, RE_PY_PKG], sudo: true, timeout: 300000 },
  apt_update: { bin: 'apt-get', baseArgs: ['update'], allowedArgs: [/^-qq$/], sudo: true, timeout: 120000 },
  dpkg_query_php: { bin: 'dpkg-query', baseArgs: ['-W', '-f=${Package} ${Status}\n'], allowedArgs: [/^php\*$/, /^php\*-fpm$/, /^python3\*$/], sudo: false, timeout: 15000 },

  // PHP
  php_version: { bin: 'php', baseArgs: ['-v'], allowedArgs: [], sudo: false, timeout: 5000 },
  php_fpm_test: { bin: 'php-fpm', baseArgs: ['-t'], allowedArgs: [], sudo: true, timeout: 15000 },
  php_modules: { bin: 'php', baseArgs: ['-m'], allowedArgs: [], sudo: false, timeout: 10000 },

  // Journalctl
  journalctl: {
    bin: 'journalctl',
    baseArgs: ['--no-pager'],
    allowedArgs: [/^-n$/, RE_INT, /^--since$/, RE_TIMESPEC, /^-u$/, RE_UNIT, /^-o$/, /^(json|short|cat|short-iso)$/, /^--reverse$/, /^-r$/],
    sudo: true,
    timeout: 15000,
  },

  // Crontab
  crontab_list: { bin: 'crontab', baseArgs: ['-l'], allowedArgs: [], sudo: false, timeout: 5000 },

  // Usuários do sistema (isolamento de pool PHP / apps Python)
  useradd_system: { bin: 'useradd', baseArgs: ['--system', '--no-create-home', '--shell', '/usr/sbin/nologin'], allowedArgs: [/^--home-dir$/, RE_PATH, RE_NAME], sudo: true, timeout: 10000 },
  userdel_system: { bin: 'userdel', baseArgs: [], allowedArgs: [RE_NAME], sudo: true, timeout: 10000 },
  id_user: { bin: 'id', baseArgs: [], allowedArgs: [RE_NAME], sudo: false, timeout: 5000 },
  chown_path: { bin: 'chown', baseArgs: [], allowedArgs: [/^-R$/, /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/, RE_PATH], sudo: true, timeout: 60000 },

  // PM2
  pm2_jlist: { bin: 'pm2', baseArgs: ['jlist'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_start: { bin: 'pm2', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_stop: { bin: 'pm2', baseArgs: ['stop'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_restart: { bin: 'pm2', baseArgs: ['restart'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_reload: { bin: 'pm2', baseArgs: ['reload'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  pm2_delete: { bin: 'pm2', baseArgs: ['delete'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
  pm2_save: { bin: 'pm2', baseArgs: ['save'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_startup: { bin: 'pm2', baseArgs: ['startup'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_flush: { bin: 'pm2', baseArgs: ['flush'], allowedArgs: [], sudo: false, timeout: 10000 },
  pm2_describe: { bin: 'pm2', baseArgs: ['describe'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
  pm2_logs: { bin: 'pm2', baseArgs: ['logs'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/, /^--lines$/, /^\d{1,4}$/, /^--nostream$/], sudo: false, timeout: 10000 },
  pm2_start_app: { bin: 'pm2', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/, /^--name$/, /^[a-zA-Z0-9_\-]+$/, /^--interpreter$/, /^--cwd$/, /^--max-memory-restart$/, /^\d+[MG]$/, /^--instances$/, RE_INT, /^--env$/], sudo: false, timeout: 30000 },
  pm2_ping: { bin: 'pm2', baseArgs: ['ping'], allowedArgs: [], sudo: false, timeout: 5000 },

  // Forever
  forever_list: { bin: 'forever', baseArgs: ['list', '--plain'], allowedArgs: [], sudo: false, timeout: 10000 },
  forever_start: { bin: 'forever', baseArgs: ['start'], allowedArgs: [/^[a-zA-Z0-9_\-./]+$/, /^--uid$/, /^[a-zA-Z0-9_\-]+$/, /^--sourceDir$/, /^--workingDir$/, /^--minUptime$/, RE_INT, /^--spinSleepTime$/], sudo: false, timeout: 30000 },
  forever_stop: { bin: 'forever', baseArgs: ['stop'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  forever_restart: { bin: 'forever', baseArgs: ['restart'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 30000 },
  forever_logs: { bin: 'forever', baseArgs: ['logs'], allowedArgs: [RE_INT, /^[a-zA-Z0-9_\-./]+$/], sudo: false, timeout: 10000 },
};

/* ------------------------------------------------------------------ */
/*  Execução                                                           */
/* ------------------------------------------------------------------ */

const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * O painel pode rodar como root (instalação padrão) ou como usuário dedicado
 * com sudoers. Prefixar `sudo` quando já se é root só adiciona um processo e
 * quebra em sistemas sem sudo instalado.
 */
export function needsSudo(): boolean {
  return typeof process.getuid === 'function' ? process.getuid() !== 0 : false;
}

export function buildCommand(key: string, extraArgs: string[] = []): { command: string; sudo: boolean; timeout: number } {
  const { bin, args, sudo, timeout } = buildArgv(key, extraArgs);
  return { command: [bin, ...args].join(' '), sudo, timeout };
}

/** Resolve uma entrada da whitelist em binário + array de argumentos validados. */
export function buildArgv(key: string, extraArgs: string[] = []): { bin: string; args: string[]; sudo: boolean; timeout: number } {
  const entry = COMMAND_WHITELIST[key];
  if (!entry) throw new Error(`Comando não permitido: ${key}`);

  if (entry.allowedArgs.length > 0) {
    for (const arg of extraArgs) {
      if (typeof arg !== 'string') {
        throw new Error('Argumento inválido');
      }
      if (!entry.allowedArgs.some(regex => regex.test(arg))) {
        throw new Error(`Argumento não permitido: ${arg}`);
      }
    }
  } else if (extraArgs.length > 0) {
    throw new Error(`Comando ${key} não aceita argumentos extras`);
  }

  const args = [...entry.baseArgs, ...extraArgs];
  const useSudo = entry.sudo && needsSudo();

  return {
    bin: useSudo ? 'sudo' : entry.bin,
    args: useSudo ? ['-n', entry.bin, ...args] : args,
    sudo: entry.sudo,
    timeout: entry.timeout,
  };
}

/**
 * Executa um binário sem passar por shell.
 * Sem shell, um argumento contendo `;` ou `$(...)` é apenas texto — é isto que
 * elimina a classe inteira de injeção de comando, não a validação por regex.
 */
export function execFileSafe(
  bin: string,
  args: string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv; cwd?: string; input?: string } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const execOptions: ExecFileOptions = {
      timeout: options.timeout ?? 10000,
      maxBuffer: MAX_BUFFER,
      env: options.env ?? process.env,
      cwd: options.cwd,
    };

    const child = execFile(bin, args, execOptions, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim(),
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });

    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}

/** Executa uma entrada da whitelist. Sem shell. */
export function executeCommand(commandKey: string, extraArgs: string[] = []): Promise<CommandResult> {
  let resolved;
  try {
    resolved = buildArgv(commandKey, extraArgs);
  } catch (err) {
    return Promise.reject(err);
  }
  return execFileSafe(resolved.bin, resolved.args, { timeout: resolved.timeout });
}

/** Como executeCommand, mas rejeita quando o comando retorna código diferente de zero. */
export async function executeCommandOrThrow(commandKey: string, extraArgs: string[] = []): Promise<CommandResult> {
  const result = await executeCommand(commandKey, extraArgs);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `Falha ao executar ${commandKey}`);
  }
  return result;
}

/**
 * Executa uma linha de comando através do shell.
 *
 * Só use quando o shell for realmente necessário (pipes, redirecionamentos) e
 * a string for construída inteiramente por código do painel. Nunca interpole
 * dados vindos do request aqui — use execFileSafe.
 */
export function executeRaw(command: string, timeout: number = 10000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const options: ExecOptions = { timeout, maxBuffer: MAX_BUFFER };
    exec(command, options, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim(),
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });
  });
}

/** Aspas para shell — para os poucos casos em que executeRaw é inevitável. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
