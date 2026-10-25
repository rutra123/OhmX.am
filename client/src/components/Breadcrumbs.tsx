import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

type Crumb = { label: string; to?: string };

const BREADCRUMB_ROUTE_KEYS: Record<string, string> = {
  '/': 'navigation.breadcrumbs.home',
  '/catalog': 'navigation.breadcrumbs.catalog',
  '/brands': 'navigation.breadcrumbs.brands',
  '/tools': 'navigation.breadcrumbs.tools',
  '/documentation': 'navigation.breadcrumbs.documentation',
  '/docs': 'navigation.breadcrumbs.documentation',
  '/contacts': 'navigation.breadcrumbs.contacts',
  '/compare': 'navigation.breadcrumbs.compare',
  '/profile': 'navigation.breadcrumbs.account',
  '/promotions': 'navigation.breadcrumbs.promotions',
  '/register': 'navigation.breadcrumbs.register',
  '/tools/power-calculator': 'navigation.breadcrumbs.powerCalculator',
  '/tools/warm-floor': 'navigation.breadcrumbs.warmFloorCalculator',
};

const AUTH_BREADCRUMB_LABEL_KEYS: Record<string, string> = {
  'Личный кабинет': 'navigation.breadcrumbs.account',
  'Регистрация': 'navigation.breadcrumbs.register',
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <nav aria-label={t('navigation.breadcrumbs.ariaLabel')} className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 md:flex">
      {items.map((item, index) => {
        const route = item.to || (index === items.length - 1 ? location.pathname : '');
        const translationKey = AUTH_BREADCRUMB_LABEL_KEYS[item.label] || BREADCRUMB_ROUTE_KEYS[route];
        const label = translationKey ? t(translationKey) : item.label;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-2">
            {item.to ? <Link to={item.to} className="transition hover:text-white">{label}</Link> : <span className="text-slate-400">{label}</span>}
            {index < items.length - 1 && <span className="text-slate-700" aria-hidden="true">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
