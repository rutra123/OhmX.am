import { useTranslation } from 'react-i18next';
import { Moon, Sun } from './Icons';
import { useTheme } from './ThemeContext';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? t('header.theme.switchToLight') : t('header.theme.switchToDark');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={compact ? 'theme-toggle-btn theme-toggle-btn--compact' : 'theme-toggle-btn'}
      aria-label={label}
      title={label}
    >
      <Icon className="h-5 w-5" />
      {!compact ? <span>{label}</span> : null}
    </button>
  );
}
