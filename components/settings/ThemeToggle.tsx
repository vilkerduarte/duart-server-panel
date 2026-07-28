import { useTheme } from '@/lib/contexts/ThemeContext';
import { HiOutlineSun, HiOutlineMoon } from 'react-icons/hi2';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors w-full text-left"
    >
      {theme === 'dark' ? (
        <>
          <HiOutlineSun className="w-5 h-5 text-amber-400" />
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Modo Claro</div>
            <div className="text-xs text-[var(--text-muted)]">Alternar para tema claro</div>
          </div>
        </>
      ) : (
        <>
          <HiOutlineMoon className="w-5 h-5 text-blue-400" />
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Modo Escuro</div>
            <div className="text-xs text-[var(--text-muted)]">Alternar para tema escuro</div>
          </div>
        </>
      )}
    </button>
  );
}
