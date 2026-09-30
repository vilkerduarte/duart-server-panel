import { useState, useEffect, ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

interface AppLayoutProps {
  children: ReactNode;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

export default function AppLayout({ children }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Em telas pequenas a sidebar vira uma gaveta sobreposta ao conteúdo.
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const sync = () => {
      setIsDesktop(media.matches);
      if (media.matches) setMobileOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const margin = isDesktop ? (sidebarCollapsed ? '4rem' : '15rem') : '0';

  return (
    <div className="app-shell-bg min-h-screen transition-theme">
      <Sidebar
        collapsed={isDesktop ? sidebarCollapsed : false}
        onToggle={() => (isDesktop ? setSidebarCollapsed(!sidebarCollapsed) : setMobileOpen(false))}
        isMobile={!isDesktop}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <Header
        sidebarCollapsed={isDesktop ? sidebarCollapsed : true}
        marginLeft={margin}
        onOpenMenu={isDesktop ? undefined : () => setMobileOpen(true)}
      />
      <main className="pt-16 transition-all duration-300" style={{ marginLeft: margin }}>
        <div className="glow-panel mx-2 mb-3 sm:mx-3 p-4 sm:p-6 min-h-[calc(100vh-5rem)]">
          <div className="relative">{children}</div>
        </div>
      </main>
    </div>
  );
}
