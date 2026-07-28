import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  HiOutlineHome, HiOutlineChartBar, HiOutlineFolder, HiOutlineCpuChip,
  HiOutlineGlobeAlt, HiOutlineShieldCheck, HiOutlineCube,
  HiOutlineCircleStack, HiOutlineLockClosed, HiOutlineKey,
  HiOutlineClock, HiOutlineArchiveBox, HiOutlineDocumentText,
  HiOutlineServer, HiOutlineCog, HiOutlineChevronLeft,
  HiOutlineChevronRight,
} from 'react-icons/hi2';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const menuItems = [
  { href: '/', icon: HiOutlineHome, label: 'Dashboard' },
  { href: '/monitor', icon: HiOutlineChartBar, label: 'Monitor' },
  { href: '/files', icon: HiOutlineFolder, label: 'Arquivos' },
  { href: '/tasks', icon: HiOutlineCpuChip, label: 'Tarefas' },
  { href: '/nginx', icon: HiOutlineGlobeAlt, label: 'NGINX' },
  { href: '/firewall', icon: HiOutlineShieldCheck, label: 'Firewall' },
  { href: '/docker', icon: HiOutlineCube, label: 'Docker' },
  { href: '/databases', icon: HiOutlineCircleStack, label: 'Bancos' },
  { href: '/security', icon: HiOutlineLockClosed, label: 'Segurança' },
  { href: '/ssl', icon: HiOutlineKey, label: 'SSL/TLS' },
  { href: '/cron', icon: HiOutlineClock, label: 'Cron' },
  { href: '/backup', icon: HiOutlineArchiveBox, label: 'Backup' },
  { href: '/logs', icon: HiOutlineDocumentText, label: 'Logs' },
  { href: '/network', icon: HiOutlineServer, label: 'Rede' },
  { href: '/settings', icon: HiOutlineCog, label: 'Config.' },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const router = useRouter();

  return (
    <aside
      className={`fixed top-0 left-0 h-screen bg-[var(--sidebar-bg)] border-r border-[var(--border-color)] transition-all duration-300 z-40 flex flex-col ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex items-center h-14 px-4 border-b border-[var(--border-color)]">
        {!collapsed && (
          <span className="text-lg font-bold text-[var(--accent)] truncate">Duart Panel</span>
        )}
        {collapsed && (
          <span className="text-lg font-bold text-[var(--accent)] mx-auto">D</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {menuItems.map(item => {
          const isActive = router.pathname === item.href ||
            (item.href !== '/' && router.pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm transition-all duration-200 group ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-blue-400' : ''}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={onToggle}
        className="flex items-center justify-center h-10 border-t border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        {collapsed ? (
          <HiOutlineChevronRight className="w-4 h-4" />
        ) : (
          <HiOutlineChevronLeft className="w-4 h-4" />
        )}
      </button>
    </aside>
  );
}
