import { describe, it, expect } from 'vitest';
import { parseCommandLine, validateReadonlyCommand, runPipeline } from '../lib/ai/readonly';
import { normalizeAiMode } from '../lib/ai/modes';
import { TOOL_MAP } from '../lib/ai/tools';

const ok = (command: string) => validateReadonlyCommand(command).ok;
const reason = (command: string) => {
  const result = validateReadonlyCommand(command);
  return result.ok ? null : result.error;
};

describe('consulta somente leitura: análise da linha', () => {
  it('separa pipes e respeita aspas', () => {
    const parsed = parseCommandLine(`grep -E "a|b" /var/log/x | head -n 5`);
    expect(parsed).toEqual({ ok: true, stages: [['grep', '-E', 'a|b', '/var/log/x'], ['head', '-n', '5']] });
  });

  it('recusa encadeamento, redirecionamento e substituição fora de aspas', () => {
    for (const command of [
      'ls; rm -rf /', 'ls && id', 'ls & id', 'cat /etc/passwd > /tmp/x', 'cat < /etc/passwd',
      'echo `id`', 'ls $(id)', 'ls $HOME', 'ls || id', 'ls\nid',
    ]) {
      expect(ok(command), command).toBe(false);
    }
  });

  it('trata metacaracteres dentro de aspas como texto', () => {
    expect(parseCommandLine(`grep 'a;b$(x)' file`)).toEqual({ ok: true, stages: [['grep', 'a;b$(x)', 'file']] });
  });

  it('recusa aspas abertas e etapas vazias', () => {
    expect(ok(`grep "abc`)).toBe(false);
    expect(ok('| ls')).toBe(false);
    expect(ok('ls |')).toBe(false);
    expect(ok('')).toBe(false);
  });
});

describe('consulta somente leitura: lista de programas', () => {
  it('aceita consultas comuns do dia a dia', () => {
    for (const command of [
      'ls -la /var/log', 'df -h', 'du -sh /var/www', 'ps aux --sort=-%mem | head -n 15', 'ss -tlnp',
      'docker ps -a', 'docker inspect meu-app', 'docker logs --tail 100 meu-app', 'docker stats --no-stream',
      'journalctl -u nginx -n 100 --no-pager', 'systemctl status nginx', 'systemctl is-active ssh',
      'nginx -T', 'ufw status verbose', 'crontab -l', 'curl -sI https://exemplo.com', 'cat /etc/os-release',
      'find /var/log -name "*.log" -mtime +30', 'tail -n 200 /var/log/syslog | grep -i error',
      'ip addr', 'pm2 jlist', 'dpkg -l | grep nginx', 'iptables -L -n', 'top -b -n 1 | head -n 15',
    ]) {
      expect(reason(command), command).toBeNull();
    }
  });

  it('recusa programas fora da lista, com o motivo', () => {
    expect(reason('rm -rf /tmp/x')).toMatch(/lista de programas/);
    expect(reason('bash -c id')).toMatch(/lista de programas/);
    expect(reason('/bin/ls')).toMatch(/sem caminho/);
    expect(reason('sed -i s/a/b/ file')).toMatch(/lista de programas/);
  });

  it('recusa opções que escrevem, executam ou ficam pendentes', () => {
    for (const command of [
      'find / -delete', 'find . -exec rm {}', 'sort -o out.txt in.txt', 'tail -f /var/log/syslog',
      'tail -fn 10 /var/log/syslog', 'journalctl -f', 'journalctl --vacuum-size=1M', 'docker logs -f app',
      'docker stats', 'docker rm app', 'docker exec app id', 'docker run alpine', 'docker compose up',
      'systemctl restart nginx', 'systemctl stop ssh', 'ufw disable', 'ufw allow 22', 'iptables -F',
      'iptables -A INPUT -j DROP', 'nft flush ruleset', 'crontab -r', 'crontab file', 'nginx -s reload',
      'php -r "echo 1;"', 'curl -o /tmp/x https://a.com', 'curl -sSO https://a.com/x', 'curl -X POST https://a.com',
      'curl -d a=b https://a.com', 'curl --output x https://a.com', 'dmesg -c', 'sysctl -w vm.swappiness=1',
      'sysctl vm.swappiness=1', 'hostname novo', 'date -s 2020-01-01', 'date 010100002020', 'ip link set eth0 down',
      'ip addr add 1.2.3.4/24 dev eth0', 'openssl x509 -in a -out b', 'openssl genrsa', 'uniq a b', 'apt install x',
      'dpkg -i x.deb', 'pm2 restart all', 'pm2 logs', 'ping 1.1.1.1', 'top', 'timedatectl set-time 12:00',
    ]) {
      expect(ok(command), command).toBe(false);
    }
  });

  it('valida cada etapa do pipe, não só a primeira', () => {
    expect(ok('ls | sort -o /tmp/x')).toBe(false);
    expect(ok('ls | rm')).toBe(false);
  });
});

describe('consulta somente leitura: execução', () => {
  it('encadeia processos por pipe sem shell', async () => {
    const parsed = validateReadonlyCommand('ls / | head -n 2');
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await runPipeline(parsed.stages, 10_000);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toHaveLength(2);
  });

  it('não interpreta metacaracteres que chegam como argumento', async () => {
    const parsed = validateReadonlyCommand(`grep 'a;id' /etc/hosts`);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = await runPipeline(parsed.stages, 10_000);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(/uid=/);
  });

  it('interrompe o que passa do tempo', async () => {
    // O runPipeline não valida: aqui só interessa o corte por tempo.
    const result = await runPipeline([['tail', '-f', '/dev/null']], 300);
    expect(result.timedOut).toBe(true);
  });
});

describe('ferramentas de consulta são livres de jaula', () => {
  it('read_file lê fora das raízes do gerenciador de arquivos', async () => {
    const result = await TOOL_MAP.get('read_file')!.execute({ path: '/etc/hosts' }, { user: 't', sessionId: 't', mode: 'chat' });
    expect(result.ok).toBe(true);
  });

  it('list_directory e file_info aceitam qualquer caminho', async () => {
    const ctx = { user: 't', sessionId: 't', mode: 'learn' as const };
    expect((await TOOL_MAP.get('list_directory')!.execute({ path: '/etc' }, ctx)).ok).toBe(true);
    expect((await TOOL_MAP.get('file_info')!.execute({ path: '/etc' }, ctx)).ok).toBe(true);
  });
});

describe('modos', () => {
  it('converte os valores do desenho anterior', () => {
    expect(normalizeAiMode('read')).toBe('chat');
    expect(normalizeAiMode('assisted')).toBe('execute');
    expect(normalizeAiMode('autonomous')).toBe('execute');
    expect(normalizeAiMode('full')).toBe('execute');
    expect(normalizeAiMode('analyze')).toBe('analyze');
    expect(normalizeAiMode('lixo')).toBe('chat');
    expect(normalizeAiMode(undefined, 'learn')).toBe('learn');
  });
});
