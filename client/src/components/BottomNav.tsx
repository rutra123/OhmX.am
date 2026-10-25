import { Calculator, Home, LayoutGrid, ShoppingCart, User } from './Icons';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { cartBadgeCount, useStore } from '../store/useStore';

const CATALOG_WORKSPACE_STORAGE_KEY = 'ohmx:catalog:last-workspace';
const CATALOG_WORKSPACE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getCatalogWorkspaceHref(currentPathname: string) {
  if (currentPathname.startsWith('/catalog') || currentPathname.startsWith('/category')) return '/catalog';
  if (typeof window === 'undefined') return '/catalog';
  try {
    const raw = window.localStorage.getItem(CATALOG_WORKSPACE_STORAGE_KEY);
    if (!raw) return '/catalog';
    const snapshot = JSON.parse(raw) as { pathname?: unknown; search?: unknown; updatedAt?: unknown } | null;
    if (!snapshot || typeof snapshot.pathname !== 'string' || typeof snapshot.search !== 'string' || typeof snapshot.updatedAt !== 'number') return '/catalog';
    if (!snapshot.pathname.startsWith('/catalog') && !snapshot.pathname.startsWith('/category')) return '/catalog';
    if (Date.now() - snapshot.updatedAt > CATALOG_WORKSPACE_TTL_MS) return '/catalog';
    return `${snapshot.pathname}${snapshot.search}`;
  } catch {
    return '/catalog';
  }
}

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const cartCount = useStore((s) => cartBadgeCount(s.cart));
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const catalogHref = getCatalogWorkspaceHref(location.pathname);
  const isCatalogSection = location.pathname.startsWith('/catalog') || location.pathname.startsWith('/category');
  const items = [
    { id: 'home', to: '/', label: t('navigation.bottom.home'), Icon: Home },
    { id: 'catalog', to: '/catalog', label: t('navigation.bottom.catalog'), Icon: LayoutGrid },
    { id: 'tools', to: '/tools', label: t('navigation.bottom.tools'), Icon: Calculator },
    { id: 'cart', to: '/cart', label: t('navigation.bottom.cart'), Icon: ShoppingCart },
    { id: 'profile', to: isAuthenticated ? '/profile' : '/auth', label: t('navigation.bottom.profile'), Icon: User },
  ] as const;
  return (
    <nav className="mobile-bottom-nav lg:hidden" aria-label={t('navigation.bottom.ariaLabel')}>
      <div className="mobile-bottom-nav__inner mx-auto grid max-w-3xl grid-cols-5 rounded-[28px] border border-line shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl">
        {items.map(({ id, to, label, Icon }) => {
          const resolvedTo = id === 'catalog' ? catalogHref : to;
          const isActive = id === 'catalog' ? isCatalogSection : false;
          return (
            <NavLink key={id} to={resolvedTo} className={({ isActive: navActive }) => `bottom-nav-link relative flex flex-col items-center gap-1 px-2 py-3 text-[11px] ${(navActive || isActive) ? 'active' : ''}`}>
              <Icon className="h-5 w-5" />
              <span>{label}</span>
              {id === 'cart' && cartCount > 0 ? <span className="header-cart-badge mobile bottom-nav-badge">{cartCount}</span> : null}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
