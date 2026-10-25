import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const publicScrollRef = useRef<HTMLElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const scrollNode = publicScrollRef.current;
    if (!scrollNode) return undefined;

    const updateScrollTopVisibility = () => {
      setShowScrollTop(scrollNode.scrollTop > 420);
    };

    updateScrollTopVisibility();
    scrollNode.addEventListener('scroll', updateScrollTopVisibility, { passive: true });
    return () => scrollNode.removeEventListener('scroll', updateScrollTopVisibility);
  }, [location.key]);

  const scrollSiteToTop = () => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    const scrollNode = publicScrollRef.current;
    if (scrollNode) {
      scrollNode.scrollTo({ top: 0, behavior });
      return;
    }

    window.scrollTo({ top: 0, behavior });
  };

  return (
    <div className="mobile-app-shell public-app-shell">
      <SiteHeader />
      <main key={location.key} ref={publicScrollRef} className="mobile-scroll-content public-scroll-content">
        {children}
        <SiteFooter />
      </main>
      <button
        type="button"
        className={`site-scroll-top ${showScrollTop ? 'is-visible' : ''}`}
        onClick={scrollSiteToTop}
        aria-label={t('navigation.scrollTop.ariaLabel')}
        title={t('navigation.scrollTop.title')}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <BottomNav />
    </div>
  );
}
