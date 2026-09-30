/**
 * Consulta por linha de comando, somente leitura.
 *
 * A IA precisa poder olhar qualquer coisa no servidor — `docker inspect`,
 * `journalctl`, `ss`, `find`, `du` — em qualquer modo, sem passar por
 * aprovação. Para isso ser seguro, o comando nunca passa por um shell: ele é
 * separado em palavras aqui, cada etapa do pipe vira um processo próprio, e um
 * `;`, `$(...)` ou `>` fora de aspas é recusado em vez de interpretado.
 *
 * Cada binário tem uma lista de subcomandos e opções que escrevem ou ficam
 * pendurados (`find -delete`, `sort -o`, `tail -f`, `systemctl restart`). O que
 * não está na lista não roda — a IA cai para `run_command` no modo Executar.
 */

import { spawn, ChildProcess } from 'child_process';

export type ParseResult =
  | { ok: true; stages: string[][] }
  | { ok: false; error: string };

/** Metacaracteres de shell que, fora de aspas, indicariam encadeamento, redirecionamento ou substituição. */
const FORBIDDEN_UNQUOTED = new Set([';', '&', '<', '>', '`', '$', '(', ')', '\n', '\r']);

/**
 * Separa a linha em etapas de pipe e palavras, respeitando aspas.
 * Nada é expandido: sem shell, `*` e `$VAR` chegam ao programa como texto.
 */
export function parseCommandLine(input: string): ParseResult {
  const stages: string[][] = [];
  let tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  const endToken = () => {
    if (hasToken) tokens.push(current);
    current = '';
    hasToken = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[++i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= input.length) return { ok: false, error: 'Barra invertida no fim do comando' };
      current += input[++i];
      hasToken = true;
      continue;
    }

    if (ch === '|') {
      if (input[i + 1] === '|') return { ok: false, error: '"||" não é permitido; use um único "|"' };
      endToken();
      if (!tokens.length) return { ok: false, error: 'Etapa vazia antes do "|"' };
      stages.push(tokens);
      tokens = [];
      continue;
    }

    if (FORBIDDEN_UNQUOTED.has(ch)) {
      return {
        ok: false,
        error: `Caractere "${ch === '\n' ? '\\n' : ch}" não é permitido fora de aspas. ` +
          'Consulta só aceita programas de leitura ligados por "|"; sem redirecionamento, ";", "&&" ou substituição de comando.',
      };
    }

    if (/\s/.test(ch)) {
      endToken();
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (quote) return { ok: false, error: 'Aspas não fechadas' };

  endToken();
  if (!tokens.length) return { ok: false, error: stages.length ? 'Etapa vazia depois do "|"' : 'Comando vazio' };
  stages.push(tokens);

  return { ok: true, stages };
}

/* ------------------------------------------------------------------ */
/*  Regras por binário                                                 */
/* ------------------------------------------------------------------ */

type Rule = (args: string[]) => string | null;

const allow: Rule = () => null;

const has = (args: string[], ...flags: string[]) => args.some(a => flags.includes(a));

/** Verdadeiro se algum argumento é uma das opções curtas `letters` (inclusive agrupadas, como -sSo). */
const hasShort = (args: string[], letters: string) =>
  args.some(a => /^-[A-Za-z]+$/.test(a) && [...a.slice(1)].some(c => letters.includes(c)));

const deny = (args: string[], flags: string[], why: string): string | null =>
  args.some(a => flags.some(f => a === f || a.startsWith(`${f}=`))) ? why : null;

const firstPositional = (args: string[]) => args.find(a => !a.startsWith('-'));

/** Primeiro argumento não-opção tem de estar na lista. */
const subcommands = (allowed: string[], optional = false): Rule => args => {
  const sub = firstPositional(args);
  if (!sub) return optional ? null : `Informe um subcomando (${allowed.join(', ')})`;
  return allowed.includes(sub) ? null : `Subcomando "${sub}" não é de leitura (permitidos: ${allowed.join(', ')})`;
};

const combine = (...rules: Rule[]): Rule => args => {
  for (const rule of rules) {
    const error = rule(args);
    if (error) return error;
  }
  return null;
};

const FIREWALL_MUTATIONS = ['-A', '-I', '-D', '-R', '-N', '-X', '-F', '-Z', '-P', '-E', '--append', '--insert', '--delete', '--replace', '--new-chain', '--delete-chain', '--flush', '--zero', '--policy', '--rename-chain'];

const RULES: Record<string, Rule> = {
  /* Arquivos e texto */
  ls: allow, cat: allow, head: allow, wc: allow, cut: allow, tr: allow, nl: allow, tac: allow, rev: allow,
  fold: allow, column: allow, strings: allow, basename: allow, dirname: allow, realpath: allow,
  readlink: allow, stat: allow, file: allow, tree: allow, du: allow, df: allow, diff: allow, base64: allow,
  sha1sum: allow, sha256sum: allow, sha512sum: allow, md5sum: allow, zcat: allow, zgrep: allow,
  grep: allow, egrep: allow, fgrep: allow, jq: allow,

  tail: args => hasShort(args, 'fF') || has(args, '--follow') ? 'tail em modo follow nunca termina; use -n' : null,
  sort: args => deny(args, ['-o', '--output', '--compress-program'], 'sort não pode gravar arquivo'),
  uniq: args => args.filter(a => !a.startsWith('-')).length > 1 ? 'uniq com dois arquivos grava o segundo' : null,

  find: args => deny(
    args,
    ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'],
    'find não pode executar nem gravar; use a saída padrão',
  ),

  /* Sistema */
  uname: allow, whoami: allow, id: allow, nproc: allow, uptime: allow, free: allow, lsblk: allow,
  lscpu: allow, lsmod: allow, lsof: allow, w: allow, who: allow, last: allow, lastlog: allow,
  getent: allow, vmstat: allow, iostat: allow, mpstat: allow, netstat: allow, ss: allow,
  ps: allow, pgrep: allow,

  top: args => hasShort(args, 'b') && hasShort(args, 'n') ? null : 'top precisa de -b e -n (ex.: top -b -n 1)',

  hostname: args => args.every(a => /^(-[fsiIdA]|--(fqdn|short|ip-address|all-ip-addresses|domain|long|alias|all-fqdns))$/.test(a))
    ? null : 'hostname só pode ser consultado, não alterado',

  date: args => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (['-d', '--date', '-r', '--reference'].includes(a)) { i++; continue; }
      if (a === '-s' || a.startsWith('--set')) return 'date não pode acertar o relógio';
      if (!a.startsWith('-') && !a.startsWith('+')) return 'date só aceita formato +FORMATO';
    }
    return null;
  },

  dmesg: args => deny(args, ['-c', '-C', '--clear', '--read-clear', '-w', '-W', '--follow', '--follow-new'], 'dmesg só leitura'),

  sysctl: args => args.some(a => a.includes('=') || a === '-w' || a === '--write' || a === '-p' || a === '--load')
    ? 'sysctl só consulta valores' : null,

  timedatectl: subcommands(['status', 'show', 'list-timezones', 'timesync-status'], true),
  hostnamectl: subcommands(['status'], true),

  ip: args => {
    const mutations = ['add', 'del', 'delete', 'set', 'flush', 'change', 'replace', 'append', 'prepend', 'exec', 'netns'];
    return args.some(a => mutations.includes(a)) ? 'ip só pode listar' : null;
  },

  journalctl: args => hasShort(args, 'f') ? 'journalctl sem follow' : deny(
    args,
    ['--vacuum-size', '--vacuum-time', '--vacuum-files', '--rotate', '--flush', '--sync', '--setup-keys', '--update-catalog', '--follow', '--relinquish-var', '--smart-relinquish-var'],
    'journalctl só leitura e sem follow',
  ),

  systemctl: subcommands([
    'status', 'show', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-unit-files',
    'list-timers', 'list-sockets', 'list-dependencies', 'cat', 'list-jobs',
  ]),

  /* Rede e segurança */
  ufw: args => args[0] === 'status' ? null : 'ufw só permite "status"',

  iptables: combine(args => deny(args, FIREWALL_MUTATIONS, 'iptables só lista regras'), args => has(args, '-L', '-S', '--list', '--list-rules') ? null : 'use -L ou -S'),
  ip6tables: combine(args => deny(args, FIREWALL_MUTATIONS, 'ip6tables só lista regras'), args => has(args, '-L', '-S', '--list', '--list-rules') ? null : 'use -L ou -S'),
  nft: args => args[0] === 'list' ? null : 'nft só permite "list"',

  crontab: args => (args.length === 1 && args[0] === '-l') || (args.length === 3 && args[0] === '-u' && args[2] === '-l')
    ? null : 'crontab só permite -l',

  nginx: args => args.length > 0 && args.every(a => ['-t', '-T', '-v', '-V', '-q'].includes(a))
    ? null : 'nginx só permite -t, -T, -v e -V',

  php: args => args.length > 0 && args.every(a => ['-v', '-m', '-i', '--version', '--ini', '--modules', '--info'].includes(a))
    ? null : 'php só permite -v, -m, -i e --ini',

  node: args => args.length === 1 && ['-v', '--version'].includes(args[0]) ? null : 'node só permite --version',
  python3: args => args.length === 1 && ['-V', '--version'].includes(args[0]) ? null : 'python3 só permite --version',

  openssl: combine(
    subcommands(['x509', 'version', 'verify']),
    args => deny(args, ['-out', '-writerand', '-CAcreateserial', '-signkey', '-CA', '-CAkey', '-new'], 'openssl só leitura'),
  ),

  ping: args => {
    const idx = args.indexOf('-c');
    if (idx === -1 || !/^\d{1,2}$/.test(args[idx + 1] ?? '')) return 'ping precisa de -c N (N ≤ 99)';
    return deny(args, ['-f', '--flood'], 'ping flood não é permitido');
  },
  dig: allow, nslookup: allow, host: allow,

  curl: args => {
    if (hasShort(args, 'oOTdFKDcJX')) return 'curl só pode ler: sem -o/-O/-T/-d/-F/-K/-D/-c/-X';
    return deny(
      args,
      ['--output', '--output-dir', '--remote-name', '--remote-name-all', '--upload-file', '--data', '--data-raw',
        '--data-binary', '--data-urlencode', '--form', '--config', '--dump-header', '--cookie-jar', '--request',
        '--trace', '--trace-ascii', '--stderr', '--libcurl'],
      'curl só pode ler: sem gravar arquivo, enviar corpo ou mudar o método',
    );
  },

  /* Pacotes */
  dpkg: args => ['-l', '--list', '-L', '--listfiles', '-s', '--status', '-S', '--search'].includes(args[0] ?? '')
    ? null : 'dpkg só permite -l, -L, -s e -S',
  apt: subcommands(['list', 'show', 'policy', 'search']),
  'apt-cache': allow,

  /* Contêineres e processos gerenciados */
  docker: args => {
    const sub = firstPositional(args);
    const plain = ['ps', 'images', 'inspect', 'logs', 'top', 'info', 'version', 'port', 'diff', 'history'];
    if (sub && plain.includes(sub)) {
      return sub === 'logs' && (hasShort(args, 'f') || has(args, '--follow')) ? 'docker logs sem follow' : null;
    }
    if (sub === 'stats') return has(args, '--no-stream') ? null : 'docker stats precisa de --no-stream';
    if (sub === 'system') return args.includes('df') ? null : 'docker system só permite "df"';
    if (sub === 'network' || sub === 'volume') {
      const action = args[args.indexOf(sub) + 1];
      return ['ls', 'inspect'].includes(action) ? null : `docker ${sub} só permite ls e inspect`;
    }
    if (sub === 'compose') {
      const action = args[args.indexOf('compose') + 1];
      if (action === 'logs') return hasShort(args, 'f') || has(args, '--follow') ? 'docker compose logs sem follow' : null;
      return ['ps', 'ls', 'config', 'images', 'top'].includes(action) ? null : 'docker compose só permite ps, ls, config, images, top e logs';
    }
    return `docker ${sub ?? ''} não é de leitura`;
  },

  pm2: args => {
    const sub = firstPositional(args);
    if (sub && ['jlist', 'list', 'ls', 'status', 'describe', 'show', 'prettylist'].includes(sub)) return null;
    if (sub === 'logs') return has(args, '--nostream') ? null : 'pm2 logs precisa de --nostream';
    return `pm2 ${sub ?? ''} não é de leitura`;
  },
};

export const READONLY_BINARIES = Object.keys(RULES).sort();

export function validateStage(stage: string[]): string | null {
  const [bin, ...args] = stage;
  if (!bin) return 'Comando vazio';
  if (bin.includes('/')) return `Use o nome do programa sem caminho (${bin})`;

  const rule = RULES[bin];
  if (!rule) return `"${bin}" não está na lista de programas de consulta. Programas aceitos: ${READONLY_BINARIES.join(', ')}`;

  return rule(args);
}

export function validateReadonlyCommand(command: string): ParseResult {
  const parsed = parseCommandLine(command);
  if (!parsed.ok) return parsed;

  for (const stage of parsed.stages) {
    const error = validateStage(stage);
    if (error) return { ok: false, error };
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/*  Execução                                                           */
/* ------------------------------------------------------------------ */

export interface PipelineResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/** Encadeia os processos de cada etapa por pipe, sem shell. */
export function runPipeline(stages: string[][], timeoutMs: number, cwd?: string): Promise<PipelineResult> {
  return new Promise(resolve => {
    const children: ChildProcess[] = [];
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let lastCode = 0;
    let remaining = stages.length;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: lastCode, stdout: stdout.trim(), stderr: stderr.trim(), timedOut, truncated });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      lastCode = 124;
      for (const child of children) child.kill('SIGKILL');
      finish();
    }, timeoutMs);

    const append = (target: 'out' | 'err', chunk: Buffer) => {
      const current = target === 'out' ? stdout : stderr;
      if (current.length >= MAX_CAPTURE_BYTES) {
        truncated = true;
        return;
      }
      const text = chunk.toString('utf-8');
      if (target === 'out') stdout += text; else stderr += text;
    };

    stages.forEach(([bin, ...args], index) => {
      const isFirst = index === 0;
      const isLast = index === stages.length - 1;

      const child = spawn(bin, args, {
        cwd,
        env: { ...process.env, LC_ALL: 'C.UTF-8', PAGER: 'cat', SYSTEMD_PAGER: '', GIT_PAGER: 'cat' },
        stdio: [isFirst ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      children.push(child);

      child.stderr?.on('data', (chunk: Buffer) => append('err', chunk));

      if (isLast) {
        child.stdout?.on('data', (chunk: Buffer) => append('out', chunk));
      }

      child.on('error', error => {
        stderr += `${bin}: ${error.message}\n`;
        if (isLast) lastCode = 127;
        if (--remaining === 0) finish();
      });

      child.on('close', code => {
        if (isLast) lastCode = code ?? 1;
        if (--remaining === 0) finish();
      });
    });

    // Liga cada saída à entrada da etapa seguinte. O processo seguinte pode
    // terminar antes (ex.: `head`), então o EPIPE é esperado e ignorado.
    for (let i = 0; i < children.length - 1; i++) {
      const to = children[i + 1].stdin;
      to?.on('error', () => {});
      children[i].stdout?.on('error', () => {});
      if (to) children[i].stdout?.pipe(to);
    }
  });
}
