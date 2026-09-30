import { useRouter } from 'next/router';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { useI18n } from '@/lib/contexts/I18nContext';
import {
  HiOutlineSun, HiOutlineMoon, HiOutlineArrowRightOnRectangle, HiOutlineMagnifyingGlass,
  HiOutlineBell, HiOutlineChevronDown, HiOutlineHome, HiOutlineBars3,
} from 'react-icons/hi2';

interface HeaderProps {
  sidebarCollapsed: boolean;
  /** Margem esquerda calculada pelo AppLayout (0 em telas pequenas). */
  marginLeft?: string;
  onOpenMenu?: () => void;
}

const NAV_KEYS = ['dashboard', 'monitor', 'files', 'tasks', 'nginx', 'php', 'python', 'firewall', 'docker', 'databases', 'security', 'ssl', 'cron', 'backup', 'logs', 'pm2', 'network', 'settings'];

export default function Header({ sidebarCollapsed, marginLeft, onOpenMenu }: HeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  const openAi = () => window.dispatchEvent(new CustomEvent('duart:open-ai'));

  const labelFor = (part: string) =>
    NAV_KEYS.includes(part) ? t(`common.nav.${part}`) : part.charAt(0).toUpperCase() + part.slice(1);

  const pathParts = router.pathname.split('/').filter(Boolean);
  const breadcrumb = pathParts.map((part, index) => ({
    label: labelFor(part),
    href: '/' + pathParts.slice(0, index + 1).join('/'),
  }));

  const iconButton = 'p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors';

  return (
    <header
      className="fixed top-0 right-0 h-16 flex items-center justify-between gap-3 px-3 sm:px-4 z-30 transition-all duration-300"
      style={{
        left: marginLeft ?? (sidebarCollapsed ? '4rem' : '15rem'),
        // O conteúdo rola por baixo do cabeçalho; sem fundo o texto aparece através dele.
        background: 'color-mix(in srgb, var(--bg-primary) 82%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 text-sm min-w-0">
        {onOpenMenu && (
          <button onClick={onOpenMenu} aria-label={t('common.nav.openMenu')} className={iconButton}>
            <HiOutlineBars3 className="w-5 h-5" />
          </button>
        )}
        <nav aria-label={t('common.header.breadcrumb')} className="flex items-center gap-2 min-w-0">
          <HiOutlineHome className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" aria-label={t('common.header.home')} />
          {(breadcrumb.length === 0 ? [{ label: t('common.nav.dashboard'), href: '/' }] : breadcrumb).map((item, index, arr) => (
            <span key={item.href} className="flex items-center gap-2 min-w-0">
              <span className="text-[var(--text-muted)]">/</span>
              <span className={`truncate ${index === arr.length - 1 ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'}`}>
                {item.label}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <button
        onClick={openAi}
        aria-label={t('common.header.searchAria')}
        className="glass-card hidden md:flex flex-1 max-w-xl items-center gap-3 rounded-full px-4 py-2 text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--glow-blue)]"
      >
        <HiOutlineMagnifyingGlass className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 truncate">{t('common.header.search')}</span>
        <kbd className="rounded-md border border-[var(--glass-border)] bg-transparent px-2 py-0.5 text-[10px] font-sans text-[var(--text-muted)]">Ctrl+K</kbd>
      </button>

      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        <button onClick={openAi} aria-label={t('common.header.askAi')} className={`${iconButton} md:hidden`}>
          <HiOutlineMagnifyingGlass className="w-5 h-5" />
        </button>

        <button
          onClick={toggleTheme}
          className={iconButton}
          aria-label={theme === 'dark' ? t('common.header.themeLight') : t('common.header.themeDark')}
          title={theme === 'dark' ? t('common.header.themeLight') : t('common.header.themeDark')}
        >
          {theme === 'dark' ? <HiOutlineSun className="w-5 h-5" /> : <HiOutlineMoon className="w-5 h-5" />}
        </button>

        <button className={`${iconButton} relative hidden sm:block`} aria-label={t('common.header.notifications')}>
          <HiOutlineBell className="w-5 h-5" />
        </button>

        {user && (
          <div
            className="glass-card flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
            aria-label={t('common.header.userMenu')}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-b from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-medium">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-[var(--text-secondary)] hidden md:block max-w-[8rem] truncate">{user.username}</span>
            <HiOutlineChevronDown className="w-4 h-4 text-[var(--text-muted)] hidden md:block" />
          </div>
        )}

        <button
          onClick={handleLogout}
          className={`${iconButton} hover:!text-red-400 hover:!bg-red-400/10`}
          aria-label={t('common.header.logout')}
          title={t('common.header.logout')}
        >
          <HiOutlineArrowRightOnRectangle className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
