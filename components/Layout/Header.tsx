import { useRouter } from 'next/router';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { HiOutlineSun, HiOutlineMoon, HiOutlineArrowRightOnRectangle, HiOutlineCommandLine } from 'react-icons/hi2';

interface HeaderProps {
  sidebarCollapsed: boolean;
}

export default function Header({ sidebarCollapsed }: HeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = async () => {
    await logout();
    window.location.reload();
  };

  const pathParts = router.pathname.split('/').filter(Boolean);
  const breadcrumb = pathParts.map((part, index) => ({
    label: part.charAt(0).toUpperCase() + part.slice(1),
    href: '/' + pathParts.slice(0, index + 1).join('/'),
  }));

  return (
    <header
      className="fixed top-0 right-0 h-14 bg-[var(--header-bg)] border-b border-[var(--border-color)] flex items-center justify-between px-4 z-30 transition-theme"
      style={{ left: sidebarCollapsed ? '4rem' : '15rem' }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--text-muted)]">/</span>
        {breadcrumb.length === 0 ? (
          <span className="text-[var(--text-primary)] font-medium">Dashboard</span>
        ) : (
          breadcrumb.map((item, index) => (
            <span key={item.href} className="flex items-center gap-2">
              {index > 0 && <span className="text-[var(--text-muted)]">/</span>}
              <span className={index === breadcrumb.length - 1 ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'}>
                {item.label}
              </span>
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)] hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)]">
          <HiOutlineCommandLine className="w-3 h-3" />
          Ctrl+5
        </span>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === 'dark' ? <HiOutlineSun className="w-5 h-5" /> : <HiOutlineMoon className="w-5 h-5" />}
        </button>

        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-[var(--border-color)]">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-[var(--text-secondary)] hidden md:block">{user.username}</span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Logout"
        >
          <HiOutlineArrowRightOnRectangle className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
