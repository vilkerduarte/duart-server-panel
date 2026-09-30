import { useTheme } from '@/lib/contexts/ThemeContext';
import { useI18n } from '@/lib/contexts/I18nContext';
import { HiOutlineSun, HiOutlineMoon } from 'react-icons/hi2';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const isDark = theme === 'dark';
  const label = isDark ? t('common.header.themeLight') : t('common.header.themeDark');

  return (
    <button
      onClick={toggleTheme}
      aria-label={label}
      className="glass-card flex items-center gap-3 px-4 py-3 rounded-2xl hover:border-[var(--glow-blue)] transition-colors w-full text-left"
    >
      {isDark ? <HiOutlineSun className="w-5 h-5 text-amber-400" /> : <HiOutlineMoon className="w-5 h-5 text-blue-500" />}
      <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
    </button>
  );
}
