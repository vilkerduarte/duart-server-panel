import { describe, it, expect } from 'vitest';
import {
  parseOsRelease, planMysqlInstall, variantAvailability, parseReleaseComponents, rootPasswordSql,
  isMariaDbVersion, OsInfo,
} from '../lib/mysql';
import { optionFileValue, renderClientCnf, generateDbPassword } from '../lib/db-credentials';
import { buildArgv } from '../lib/system';

const NOBLE = parseOsRelease(`PRETTY_NAME="Ubuntu 24.04.3 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
UBUNTU_CODENAME=noble`);

const BOOKWORM = parseOsRelease(`PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION_CODENAME=bookworm
ID=debian`);

describe('parseOsRelease', () => {
  it('lê id, codinome e nome', () => {
    expect(NOBLE).toEqual({ id: 'ubuntu', codename: 'noble', versionId: '24.04', prettyName: 'Ubuntu 24.04.3 LTS' });
    expect(BOOKWORM.codename).toBe('bookworm');
  });
});

describe('planMysqlInstall', () => {
  it('MySQL da distro no Ubuntu usa o mysql-server do apt, sem repositório extra', () => {
    const plan = planMysqlInstall('distro', NOBLE);
    expect(plan.packages).toEqual(['mysql-server']);
    expect(plan.repo).toBeUndefined();
  });

  it('Debian não tem MySQL na distro', () => {
    expect(() => planMysqlInstall('distro', BOOKWORM)).toThrow(/Debian/);
  });

  it('8.4 LTS aponta para o componente certo do repositório oficial', () => {
    const plan = planMysqlInstall('mysql-8.4', NOBLE);
    expect(plan.repo?.component).toBe('mysql-8.4-lts');
    expect(plan.repo?.sourcesList).toContain('https://repo.mysql.com/apt/ubuntu/ noble mysql-8.4-lts');
    expect(plan.repo?.sourcesList).toContain('signed-by=');
    expect(plan.repo?.releaseUrl).toBe('https://repo.mysql.com/apt/ubuntu/dists/noble/Release');
    expect(plan.repo?.pin).toContain('Pin: origin repo.mysql.com');
  });

  it('8.0 no Debian usa o caminho debian do repositório', () => {
    const plan = planMysqlInstall('mysql-8.0', BOOKWORM);
    expect(plan.repo?.sourcesList).toContain('/apt/debian/ bookworm mysql-8.0');
  });

  it('MariaDB serve nas duas famílias', () => {
    expect(planMysqlInstall('mariadb', BOOKWORM).packages).toEqual(['mariadb-server']);
    expect(planMysqlInstall('mariadb', NOBLE).service).toBe('mariadb');
  });

  it('recusa distro fora de Ubuntu/Debian', () => {
    const fedora: OsInfo = { id: 'fedora', codename: '', versionId: '41', prettyName: 'Fedora' };
    expect(() => planMysqlInstall('mariadb', fedora)).toThrow(/não suportada/);
  });

  it('pacotes do plano passam pela whitelist de instalação', () => {
    for (const variant of ['distro', 'mysql-8.4', 'mysql-8.0', 'mariadb'] as const) {
      const plan = planMysqlInstall(variant, NOBLE);
      expect(() => buildArgv('apt_install_noninteractive', ['-qq', ...plan.packages])).not.toThrow();
    }
    expect(() => buildArgv('apt_install_noninteractive', ['-qq', '--no-install-recommends', 'phpmyadmin'])).not.toThrow();
    expect(() => buildArgv('apt_install_noninteractive', ['apache2'])).toThrow(/não permitido/);
  });

  it('marca indisponível o que não existe na distro', () => {
    const debian = variantAvailability(BOOKWORM);
    expect(debian.find(v => v.id === 'distro')?.available).toBe(false);
    expect(debian.find(v => v.id === 'mariadb')?.available).toBe(true);
  });
});

describe('parseReleaseComponents', () => {
  it('lê os componentes do arquivo Release', () => {
    const release = 'Origin: MySQL\nLabel: MySQL\nCodename: noble\nComponents: mysql-8.0 mysql-8.4-lts mysql-tools\nDate: x\n';
    expect(parseReleaseComponents(release)).toEqual(['mysql-8.0', 'mysql-8.4-lts', 'mysql-tools']);
    expect(parseReleaseComponents('Origin: x\n')).toEqual([]);
  });
});

describe('senha root', () => {
  it('MySQL troca o plugin explicitamente (IDENTIFIED BY sozinho manteria o auth_socket)', () => {
    const sql = rootPasswordSql("a'b", false);
    expect(sql).toContain("IDENTIFIED WITH caching_sha2_password BY 'a\\'b'");
  });

  it('MariaDB mantém o socket e acrescenta a senha', () => {
    const sql = rootPasswordSql('segredo123', true);
    expect(sql).toContain('IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD(');
  });

  it('detecta MariaDB pela versão', () => {
    expect(isMariaDbVersion('10.11.6-MariaDB-0+deb12u1')).toBe(true);
    expect(isMariaDbVersion('8.4.6')).toBe(false);
  });

  it('escreve o option file com aspas e barra invertida escapada', () => {
    expect(optionFileValue('a#b"c')).toBe('"a#b"c"');
    expect(optionFileValue('a\\b')).toBe('"a\\\\b"');
    expect(() => optionFileValue('a\nb')).toThrow();
    expect(renderClientCnf('x')).toContain('[client]\nuser=root\npassword="x"');
  });

  it('gera senhas longas, sem caracteres que exijam escape', () => {
    const password = generateDbPassword();
    expect(password).toHaveLength(24);
    expect(password).toMatch(/^[A-Za-z0-9]+$/);
    expect(generateDbPassword()).not.toBe(password);
  });
});
