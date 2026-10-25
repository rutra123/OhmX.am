import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { publicHeaderItems, contactCards } from '../data/publicMenu';
import { getLocalizedCategoryName } from '../data/catalogExperience';
import { OhmxLogo } from './OhmxLogo';
import { ThemeToggle } from './ThemeToggle';
import { SearchBar } from './SearchBar';
import { ChevronRight, Globe, Search, ShoppingCart } from './Icons';
import { cartBadgeCount, useStore } from '../store/useStore';
import { useSearchSuggestions } from '../hooks/useSearchSuggestions';
import { useNavigation } from '../hooks/useNavigation';
import type { SearchSuggestion } from './SearchBar';
import { LANGUAGE_LABEL_KEYS, SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage, setLanguage, type SupportedLanguage } from '../i18n';

const CATALOG_WORKSPACE_STORAGE_KEY = 'ohmx:catalog:last-workspace';
const CATALOG_WORKSPACE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HEADER_NAV_LABEL_KEYS = {
  '/': 'header.navigation.home',
  '/catalog': 'header.navigation.catalog',
  '/brands': 'header.navigation.brands',
  '/tools': 'header.navigation.tools',
  '/promotions': 'header.navigation.promotions',
  '/documentation': 'header.navigation.documentation',
  '/contacts': 'header.navigation.contacts',
} as const satisfies Record<(typeof publicHeaderItems)[number]['to'], string>;

type LanguageSelectorProps = {
  variant: 'desktop' | 'mobile';
  activeLanguage: SupportedLanguage;
  items: Array<{ code: SupportedLanguage; label: string }>;
  label: string;
  onSelect: (language: SupportedLanguage) => void;
};

function LanguageSelector({ variant, activeLanguage, items, label, onSelect }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `language-selector-${variant}-${useId().replace(/:/g, '')}`;

  const focusOption = (index: number) => {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const openWithFocus = (index: number) => {
    setOpen(true);
    focusOption(index);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const activeIndex = Math.max(0, items.findIndex((item) => item.code === activeLanguage));
      openWithFocus(event.key === 'ArrowDown' ? activeIndex : items.length - 1);
    }
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = optionRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusOption((Math.max(0, currentIndex) + step + items.length) % items.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOption(event.key === 'Home' ? 0 : items.length - 1);
    }
  };

  const selectLanguage = (language: SupportedLanguage) => {
    onSelect(language);
    closeAndRestoreFocus();
  };

  return (
    <div ref={rootRef} className={`language-selector language-selector--${variant}`} data-language-selector={variant}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        className={variant === 'desktop' ? 'desktop-language-selector__trigger' : 'icon-btn-sm language-selector__trigger'}
        aria-label={`${label}: ${activeLanguage.toUpperCase()}`}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <Globe className="h-5 w-5" />
        {variant === 'desktop' ? (
          <>
            <span>{activeLanguage.toUpperCase()}</span>
            <ChevronRight className="language-selector__chevron h-4 w-4" aria-hidden="true" />
          </>
        ) : null}
      </button>
      {open ? (
        <div
          id={listboxId}
          className={`language-selector__popover ${variant === 'desktop' ? 'desktop-language-selector__popover' : 'mobile-header-popover'}`}
          role="listbox"
          aria-label={label}
          onKeyDown={handleListboxKeyDown}
        >
          {items.map((item, index) => (
            <button
              ref={(node) => { optionRefs.current[index] = node; }}
              key={item.code}
              type="button"
              role="option"
              aria-selected={activeLanguage === item.code}
              className={`language-selector__option ${activeLanguage === item.code ? 'active' : ''}`}
              onClick={() => selectLanguage(item.code)}
            >
              <span className="language-selector__code">{item.code.toUpperCase()}</span>
              <span>{item.label}</span>
              <span className="language-selector__check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

export function SiteHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [desktopCatalogOpen, setDesktopCatalogOpen] = useState(false);
  const { items: catalogRoots, loading: catalogLoading, error: catalogError, isEmpty: catalogEmpty } = useNavigation();
  const searchSuggestions = useSearchSuggestions(search);
  const cartCount = useStore((s) => cartBadgeCount(s.cart));
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const currentUser = useStore((s) => s.currentUser);
  const { t, i18n } = useTranslation();

  const catalogFallbackLabel = catalogLoading ? t('header.catalog.loading') : t('header.catalog.open');
  const catalogNavItems = useMemo(() => catalogRoots.map((item) => ({
    id: item.node_key || item.slug,
    title: getLocalizedCategoryName(item, i18n.resolvedLanguage ?? i18n.language),
    description: item.engineering_role_focus || item.description || '',
    href: item.href || (item.slug?.startsWith('__') ? '/tools' : `/catalog/${item.slug}`),
  })), [catalogRoots, i18n.language, i18n.resolvedLanguage]);
  const showCatalogFallback = catalogNavItems.length === 0 && (catalogLoading || catalogEmpty || Boolean(catalogError));
  const activeLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const languageItems = useMemo(
    () =>
      SUPPORTED_LANGUAGES.map((code) => ({
        code,
        label: t(`language.${LANGUAGE_LABEL_KEYS[code]}`),
      })),
    [activeLanguage, t],
  );
  const headerSearchSuggestionTypeLabels = useMemo(
    () => ({
      product: t('header.search.suggestionTypes.product'),
      category: t('header.search.suggestionTypes.category'),
      brand: t('header.search.suggestionTypes.brand'),
      document: t('header.search.suggestionTypes.document'),
    }),
    [activeLanguage, t],
  );
  const headerContactCards = useMemo(
    () => [
      {
        id: 'phone',
        title: t('header.contactCards.phone.title'),
        value: contactCards[0].value,
        hint: t('header.contactCards.phone.hint'),
      },
      {
        id: 'messaging',
        title: contactCards[1].title,
        value: contactCards[1].value,
        hint: t('header.contactCards.messaging.hint'),
      },
      {
        id: 'address',
        title: t('header.contactCards.address.title'),
        value: t('header.contactCards.address.value'),
        hint: t('header.contactCards.address.hint'),
      },
    ],
    [activeLanguage, t],
  );

  useEffect(() => {
    setMenuOpen(false);
    setCatalogOpen(false);
    setDesktopCatalogOpen(false);
  }, [location.pathname]);

  const handleLanguageSelect = (nextLanguage: SupportedLanguage) => {
    if (!isSupportedLanguage(nextLanguage)) return;
    void setLanguage(nextLanguage);
  };


  const currentSearch = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('q') || '';
  }, [location.search]);

  useEffect(() => {
    setSearch(currentSearch);
  }, [currentSearch]);

  if (location.pathname.startsWith('/admin')) return null;

  const submitSearch = () => {
    const q = search.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  const openSearch = () => {
    const q = search.trim() || currentSearch.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  const selectSearchSuggestion = (suggestion: SearchSuggestion) => {
    setSearch(suggestion.value || suggestion.label);
    setSearchFocused(false);
    navigate(suggestion.url || `/search?q=${encodeURIComponent(suggestion.value || suggestion.label)}`);
  };

  const accountHref = isAuthenticated ? '/profile' : '/auth';
  const accountLabel = t('header.account.profile');
  const accountTitle = currentUser?.name
    ? t('header.account.titleWithName', { name: currentUser.name })
    : t('header.account.title');
  const accountActive = location.pathname.startsWith('/profile') || location.pathname.startsWith('/auth') || location.pathname.startsWith('/register');
  const isCatalogSection = location.pathname.startsWith('/catalog') || location.pathname.startsWith('/category');
  const catalogHref = getCatalogWorkspaceHref(location.pathname);

  return (
    <>
      <header className="site-header z-40 border-b border-line backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-3 md:px-6 lg:py-3">
          <div className="desktop-header-row hidden lg:grid">
            <Link to="/" className="desktop-header-brand min-w-0" aria-label={t('header.logo.ariaLabel')}>
              <OhmxLogo className="inline-flex" showMeta={false} />
            </Link>

            <LanguageSelector
              variant="desktop"
              activeLanguage={activeLanguage}
              items={languageItems}
              label={t('language.selectorLabel')}
              onSelect={handleLanguageSelect}
            />

            <div className="desktop-header-search min-w-0">
              <div onFocus={() => setSearchFocused(true)} onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}>
                <SearchBar
                  value={search}
                  onChange={setSearch}
                  onSubmit={submitSearch}
                  compact
                  placeholder={t('header.search.placeholder')}
                  inputAriaLabel={t('header.search.inputLabel')}
                  submitLabel={t('header.search.submit')}
                  suggestions={searchSuggestions}
                  suggestionsOpen={searchFocused && search.trim().length >= 2}
                  onSuggestionSelect={selectSearchSuggestion}
                  productFallbackLabel={t('header.search.productFallback')}
                  suggestionTypeLabels={headerSearchSuggestionTypeLabels}
                  genericSuggestionLabel={t('header.search.genericSuggestion')}
                />
              </div>
            </div>

            <div className="desktop-header-actions">
              <div className="header-contact-stack text-right text-xs leading-5 text-slate-500">
                <div className="font-semibold text-slate-800">+374 (00) 00-00-00</div>
                <div>Telegram / WhatsApp</div>
                <div>@ohmxam</div>
              </div>
              <Link to="/contacts" className="header-primary-action btn-secondary whitespace-nowrap">{t('header.actions.contact')}</Link>
              <Link to="/cart" className="header-cart-link whitespace-nowrap">
                <ShoppingCart className="h-5 w-5" />
                <span>{t('header.actions.cart')}</span>
                {cartCount > 0 ? <span className="header-cart-badge">{cartCount}</span> : null}
              </Link>
              <ThemeToggle compact />
            </div>
          </div>

          <div className="desktop-header-nav-row hidden lg:flex lg:items-center lg:justify-between lg:gap-4 relative">
            <nav className="desktop-nav-scroll flex min-w-0 flex-1 items-center gap-1 xl:gap-2">
              {publicHeaderItems.map((item) => {
                const to = item.to === '/catalog' ? catalogHref : item.to;
                const active = item.to === '/catalog' ? isCatalogSection : location.pathname === item.to;
                return (
                  <Link key={item.to} to={to} className={`desktop-nav-link ${active ? 'active' : ''}`}>
                    {t(HEADER_NAV_LABEL_KEYS[item.to])}
                  </Link>
                );
              })}
              <button
                type="button"
                className={`desktop-nav-link ${desktopCatalogOpen ? 'active' : ''}`}
                onClick={() => setDesktopCatalogOpen((value) => !value)}
                aria-expanded={desktopCatalogOpen}
              >
                {t('header.navigation.categories')}
              </button>
              <Link to={accountHref} title={accountTitle} className={`desktop-nav-link ${accountActive ? 'active' : ''}`}>
                {accountLabel}
              </Link>
            </nav>
            {desktopCatalogOpen ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-3 max-h-[calc(100vh-220px)] overflow-y-auto rounded-[28px] border border-line bg-surface p-4 shadow-2xl overscroll-contain">
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  {showCatalogFallback ? (
                    <Link to={catalogHref} className="rounded-2xl border border-line bg-card p-4 text-base font-semibold text-fg-strong hover:text-primary">
                      {catalogFallbackLabel}
                    </Link>
                  ) : catalogNavItems.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href || catalogHref}
                      className="rounded-2xl border border-line bg-card p-4 text-base font-semibold leading-tight text-fg-strong hover:text-primary"
                    >
                      <span>{item.title}</span>
                      {item.description ? <span className="mt-2 block text-sm font-normal leading-5 text-fg-muted">{item.description}</span> : null}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mobile-header-bar flex items-center gap-3 lg:hidden rounded-[24px] border px-3 py-2 shadow-[0_16px_40px_rgba(2,6,23,0.24)]">
            <Link to="/" className="mobile-header-brand min-w-0 flex-1">
              <OhmxLogo className="mobile-header-logo inline-flex" />
            </Link>
            <div className="mobile-header-actions ml-auto flex items-center gap-2">
              <LanguageSelector
                variant="mobile"
                activeLanguage={activeLanguage}
                items={languageItems}
                label={t('language.selectorLabel')}
                onSelect={handleLanguageSelect}
              />
              <button onClick={openSearch} className="icon-btn-sm" aria-label={t('header.search.open')}>
                <Search className="h-5 w-5" />
              </button>
              <ThemeToggle compact />
              <button onClick={() => setMenuOpen((v) => !v)} className="icon-btn-sm" aria-label={t('header.actions.openMenu')}>
                <span className="space-y-1.5">
                  <span className="block h-0.5 w-5 bg-current" />
                  <span className="block h-0.5 w-5 bg-current" />
                  <span className="block h-0.5 w-5 bg-current" />
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/35" onClick={() => setMenuOpen(false)} aria-label={t('header.actions.closeMenu')} />
          <div className="absolute right-0 top-0 h-full w-[88%] max-w-sm overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <OhmxLogo className="inline-flex" />
              <div className="flex items-center gap-2">
                <ThemeToggle compact />
                <button onClick={() => setMenuOpen(false)} className="rounded-xl border border-line px-3 py-2 text-sm text-slate-300">{t('header.actions.close')}</button>
              </div>
            </div>

            <div className="mobile-menu-grid">
              {publicHeaderItems.map((item) => (
                <Link key={item.to} to={item.to} className="mobile-menu-link">
                  {t(HEADER_NAV_LABEL_KEYS[item.to])}
                </Link>
              ))}
            </div>

            <div className="mt-2 space-y-2">
              <button onClick={() => setCatalogOpen((v) => !v)} className="mobile-menu-link flex w-full items-center justify-between text-left">
                <span>{t('header.catalog.categories')}</span>
                <span>{catalogOpen ? '−' : '+'}</span>
              </button>

              {catalogOpen ? (
                <div className="space-y-2 pl-2">
                  {showCatalogFallback ? (
                    <Link to={catalogHref} className="mobile-menu-link block">
                      {catalogFallbackLabel}
                    </Link>
                  ) : catalogNavItems.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href || catalogHref}
                      className="mobile-menu-link block rounded-2xl border border-line bg-card text-sm font-medium leading-tight text-fg-strong"
                    >
                      <span>{item.title}</span>
                      {item.description ? <span className="mt-1 block text-xs font-normal leading-5 text-fg-muted">{item.description}</span> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <Link to={accountHref} title={accountTitle} className="mobile-menu-link mt-2 flex items-center justify-between">
              <span>{accountLabel}</span>
              <span className="text-xs text-fg-muted">
                {isAuthenticated ? t('header.account.profileAndMemory') : t('header.account.register')}
              </span>
            </Link>

            <div className="mt-6 grid gap-3">
              {headerContactCards.map((item) => (
                <div key={item.id} className="rounded-2xl border border-line bg-card px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.title}</div>
                  <div className="mt-2 font-semibold text-slate-950">{item.value}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
