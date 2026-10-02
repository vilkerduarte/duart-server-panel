import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  HiOutlineHome, HiOutlineChartBar, HiOutlineFolder, HiOutlineCpuChip,
  HiOutlineGlobeAlt, HiOutlineShieldCheck, HiOutlineCube,
  HiOutlineCircleStack, HiOutlineLockClosed, HiOutlineKey,
  HiOutlineClock, HiOutlineArchiveBox, HiOutlineDocumentText,
  HiOutlineServer, HiOutlineCog, HiOutlineChevronLeft,
  HiOutlineChevronRight, HiOutlineCommandLine, HiOutlineBeaker,
  HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineXMark,
} from 'react-icons/hi2';
import { useI18n } from '@/lib/contexts/I18nContext';
import pkg from '@/package.json';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const menuItems = [
  { href: '/', icon: HiOutlineHome, key: 'dashboard' },
  { href: '/monitor', icon: HiOutlineChartBar, key: 'monitor' },
  { href: '/files', icon: HiOutlineFolder, key: 'files' },
  { href: '/tasks', icon: HiOutlineCpuChip, key: 'tasks' },
  { href: '/nginx', icon: HiOutlineGlobeAlt, key: 'nginx' },
  { href: '/php', icon: HiOutlineCube, key: 'php' },
  { href: '/python', icon: HiOutlineBeaker, key: 'python' },
  { href: '/firewall', icon: HiOutlineShieldCheck, key: 'firewall' },
  { href: '/docker', icon: HiOutlineCube, key: 'docker' },
  { href: '/databases', icon: HiOutlineCircleStack, key: 'databases' },
  { href: '/security', icon: HiOutlineLockClosed, key: 'security' },
  { href: '/ssl', icon: HiOutlineKey, key: 'ssl' },
  { href: '/cron', icon: HiOutlineClock, key: 'cron' },
  { href: '/backup', icon: HiOutlineArchiveBox, key: 'backup' },
  { href: '/logs', icon: HiOutlineDocumentText, key: 'logs' },
  { href: '/pm2', icon: HiOutlineCommandLine, key: 'pm2' },
  { href: '/network', icon: HiOutlineServer, key: 'network' },
  { href: '/settings', icon: HiOutlineCog, key: 'settings' },
];

export default function Sidebar({ collapsed, onToggle, isMobile = false, mobileOpen = false, onMobileClose }: SidebarProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [inactiveCount, setInactiveCount] = useState<number | null>(null);

  // Fecha a gaveta ao navegar em telas pequenas.
  useEffect(() => {
    if (isMobile && mobileOpen) onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.pathname]);

  // Saúde geral dos serviços monitorados, para a pílula do rodapé.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/system/services')
        .then(r => r.json())
        .then(json => {
          if (cancelled || !json.success || !Array.isArray(json.data)) return;
          setInactiveCount(json.data.filter((s: { active: boolean }) => !s.active).length);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const hidden = isMobile && !mobileOpen;
  const healthy = inactiveCount === 0;

  return (
    <>
      {isMobile && mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/70" onClick={onMobileClose} aria-hidden="true" />
      )}
      <aside
        aria-label={t('common.nav.main')}
        aria-hidden={hidden}
        className={`fixed top-0 left-0 h-screen bg-[var(--sidebar-bg)] transition-all duration-300 z-40 flex flex-col border-r border-[var(--glass-border)] ${
          collapsed ? 'w-16' : 'w-60'
        } ${hidden ? '-translate-x-full' : 'translate-x-0'}`}
      >
        <div className="flex items-center justify-between h-16 px-4">
          {!collapsed && (
            <span className="text-xl font-bold truncate bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
              Duart Panel
            </span>
          )}
          {collapsed && <span className="text-xl font-bold text-[var(--accent)] mx-auto">D</span>}
          {isMobile && (
            <button
              onClick={onMobileClose}
              aria-label={t('common.nav.closeMenu')}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {menuItems.map(item => {
            const isActive = router.pathname === item.href ||
              (item.href !== '/' && router.pathname.startsWith(item.href));
            const Icon = item.icon;
            const label = t(`common.nav.${item.key}`);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-full text-sm border border-transparent transition-all duration-200 ${
                  collapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? 'nav-pill-active font-medium'
                    : 'text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-[var(--amber)]' : ''}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-2 space-y-2">
          {inactiveCount !== null && (
            <div
              role="status"
              title={healthy ? t('dashboard.allOnline') : t('dashboard.someOffline', { count: inactiveCount })}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${collapsed ? 'justify-center px-0' : ''} ${
                healthy
                  ? 'border-green-500/40 text-green-400 bg-green-500/5'
                  : 'border-amber-500/40 text-amber-400 bg-amber-500/5'
              }`}
            >
              {healthy
                ? <HiOutlineCheckCircle className="w-4 h-4 flex-shrink-0" />
                : <HiOutlineExclamationTriangle className="w-4 h-4 flex-shrink-0" />}
              {!collapsed && (
                <span className="truncate">
                  {healthy ? t('dashboard.allOnline') : t('dashboard.someOffline', { count: inactiveCount })}
                </span>
              )}
            </div>
          )}
          {!collapsed && (
            <div className="px-1 text-[11px] text-[var(--text-muted)]">{t('dashboard.version', { version: pkg.version })}</div>
          )}
        </div>

        {!isMobile && (
          <button
            onClick={onToggle}
            aria-label={collapsed ? t('common.nav.expand') : t('common.nav.collapse')}
            className="flex items-center justify-center h-10 border-t border-[var(--glass-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {collapsed ? <HiOutlineChevronRight className="w-4 h-4" /> : <HiOutlineChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </aside>
    </>
  );
}
