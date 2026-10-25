import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Bolt, Bell, Document, Pin } from '../components/Icons';
import { useStore } from '../store/useStore';
import { featuredBrands, contactCards, getCategoryPresentation } from '../data/publicMenu';
import { categoryDescriptionKeyBySlug, getLocalizedCategoryName } from '../data/catalogExperience';
import { useNavigation } from '../hooks/useNavigation';
import { EngineeringHeroSlider } from '../components/home/EngineeringHeroSlider';
import { RootCategoryMedia } from '../components/RootCategoryMedia';

const quickActionDefinitions = [
  { key: 'catalog', titleKey: 'home.quickActions.catalog.title', textKey: 'home.quickActions.catalog.text', to: '/catalog', icon: Bolt },
  { key: 'selection', titleKey: 'home.quickActions.selection.title', textKey: 'home.quickActions.selection.text', to: '/tools', icon: Bell },
  { key: 'documents', titleKey: 'home.quickActions.documents.title', textKey: 'home.quickActions.documents.text', to: '/documentation', icon: Document },
  { key: 'contacts', titleKey: 'home.quickActions.contacts.title', textKey: 'home.quickActions.contacts.text', to: '/contacts', icon: Pin },
] as const;

const HOME_INTRO_STORAGE_KEY = 'ohmx.homeIntroTrainingSkipped.v1';

const homeIntroFeatureDefinitions = [
  {
    key: 'calculators',
    titleKey: 'home.intro.features.calculators.title',
    textKey: 'home.intro.features.calculators.text',
    to: '/tools',
  },
  {
    key: 'assistant',
    titleKey: 'home.intro.features.assistant.title',
    textKey: 'home.intro.features.assistant.text',
    to: '/tools/ai-engineering-selector',
  },
  {
    key: 'categories',
    titleKey: 'home.intro.features.categories.title',
    textKey: 'home.intro.features.categories.text',
    to: '/catalog#catalog-directions',
  },
  {
    key: 'documents',
    titleKey: 'home.intro.features.documents.title',
    textKey: 'home.intro.features.documents.text',
    to: '/documentation',
  },
] as const;

type HomeIntroPopupProps = {
  onClose: () => void;
  onSkip: () => void;
};

function HomeIntroPopup({ onClose, onSkip }: HomeIntroPopupProps) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="home-intro-modal" role="presentation" onClick={onClose}>
      <div
        className="home-intro-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-intro-title"
        aria-describedby="home-intro-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className="home-intro-modal__close" onClick={onClose} aria-label={t('home.intro.closeAria')}>
          ×
        </button>
        <div className="section-caption">{t('home.intro.caption')}</div>
        <h2 id="home-intro-title" className="home-intro-modal__title">{t('home.intro.title')}</h2>
        <p id="home-intro-description" className="home-intro-modal__lead">
          {t('home.intro.description')}
        </p>
        <div className="home-intro-modal__grid">
          {homeIntroFeatureDefinitions.map((feature, index) => (
            <Link key={feature.key} to={feature.to} className="home-intro-modal__feature" onClick={onSkip}>
              <span className="home-intro-modal__step">{index + 1}</span>
              <span>
                <span className="home-intro-modal__feature-title">{t(feature.titleKey)}</span>
                <span className="home-intro-modal__feature-text">{t(feature.textKey)}</span>
              </span>
            </Link>
          ))}
        </div>
        <div className="home-intro-modal__actions">
          <button type="button" className="home-intro-modal__skip" onClick={onSkip}>{t('home.intro.skip')}</button>
          <button type="button" className="btn-primary" onClick={onSkip}>{t('home.intro.start')}</button>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const { items: navItems, loading: navLoading } = useNavigation();
  const [products, setProducts] = useState<any[]>([]);
  const [showIntro, setShowIntro] = useState(false);
  const recent = useStore((s) => s.recent);
  const favorites = useStore((s) => s.favorites);
  const translatedTrustBlocks = t('home.trust.items', { returnObjects: true });
  const trustBlocks = Array.isArray(translatedTrustBlocks) ? translatedTrustBlocks.map(String) : [];
  const quickActions = quickActionDefinitions.map((item) => ({
    ...item,
    title: t(item.titleKey),
    text: t(item.textKey),
  }));
  const homeContactCards = [
    {
      key: 'phone',
      title: t('header.contactCards.phone.title'),
      value: contactCards[0].value,
      hint: t('header.contactCards.phone.hint'),
    },
    {
      key: 'messaging',
      title: contactCards[1].title,
      value: contactCards[1].value,
      hint: t('header.contactCards.messaging.hint'),
    },
    {
      key: 'address',
      title: t('header.contactCards.address.title'),
      value: t('header.contactCards.address.value'),
      hint: t('header.contactCards.address.hint'),
    },
  ];

  const closeHomeIntro = useCallback((rememberChoice = false) => {
    if (rememberChoice && typeof window !== 'undefined') {
      window.localStorage.setItem(HOME_INTRO_STORAGE_KEY, 'skipped');
    }
    setShowIntro(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.localStorage.getItem(HOME_INTRO_STORAGE_KEY)) return undefined;

    const introTimer = window.setTimeout(() => setShowIntro(true), 1200);
    return () => window.clearTimeout(introTimer);
  }, []);

  useEffect(() => {
    if (!showIntro) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeHomeIntro(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeHomeIntro, showIntro]);

  useEffect(() => {
    api<any[]>('/products?limit=12').then(setProducts).catch(() => setProducts([]));
  }, []);

  const featuredProducts = useMemo(() => products.slice(0, 4), [products]);
  const recentProducts = useMemo(() => recent.map((slug) => products.find((p) => p.slug === slug)).filter(Boolean).slice(0, 3), [recent, products]);
  const favoriteProducts = useMemo(() => products.filter((product) => favorites.includes(product.id)).slice(0, 3), [favorites, products]);

  const homeCategoryCards = useMemo(() => navItems.map((item) => {
    const presentation = getCategoryPresentation(item.slug);
    const childLabels = (item.children || []).slice(0, 3).map((child) => getLocalizedCategoryName(child, i18n.resolvedLanguage)).filter(Boolean);
    const categoryDescriptionKey = categoryDescriptionKeyBySlug[item.slug];
    return {
      key: item.node_key || item.slug,
      title: getLocalizedCategoryName(item, i18n.resolvedLanguage),
      slug: item.slug,
      to: item.href || (item.slug?.startsWith('__') ? '/tools' : `/catalog/${item.slug}`),
      description: categoryDescriptionKey ? t(categoryDescriptionKey) : presentation?.description || item.engineering_role_focus || item.description || '',
      imageUrl: presentation?.imageUrl || item.image_url,
      accent: presentation?.accent || 'from-slate-700/90 to-white/10',
      groupLabel: item.engineering_role_focus || t('home.categories.groupFallback'),
      relatedLabels: childLabels,
      actionLabel: childLabels.length ? t('home.categories.viewCategory') : t('home.categories.openSection'),
      icon: '▣',
    };
  }), [i18n.resolvedLanguage, navItems, t]);

  return (
    <div className="page home-page">
      {showIntro ? <HomeIntroPopup onClose={() => closeHomeIntro(false)} onSkip={() => closeHomeIntro(true)} /> : null}
      <EngineeringHeroSlider />

      <section className="home-category-section w-full max-w-full">
        <div className="home-section-heading flex items-end justify-between gap-3">
          <div>
            <div className="section-caption">{t('home.categories.caption')}</div>
            <h2 className="home-section-title">{t('home.categories.title')}</h2>
            <p className="mt-2 max-w-3xl text-slate-600">{t('home.categories.description')}</p>
          </div>
          <Link to="/catalog" className="hidden text-sm font-semibold text-primary sm:inline-flex">{t('home.categories.openAll')}</Link>
        </div>
        <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {navLoading && !homeCategoryCards.length ? (
            <div className="catalog-empty-state col-span-full">{t('home.categories.loading')}</div>
          ) : null}
          {homeCategoryCards.map((category) => (
            <Link
              key={category.key}
              to={category.to}
              className="catalog-home-card group"
            >
              <RootCategoryMedia imageUrl={category.imageUrl} fallback={category.icon} />
              <div className="catalog-home-card__copy">
                <div className="catalog-home-card__eyebrow">{category.groupLabel}</div>
                <h3 className="catalog-home-card__title">{category.title}</h3>
                {category.description ? <p className="catalog-home-card__description">{category.description}</p> : null}
                {category.relatedLabels.length ? (
                  <div className="catalog-home-card__chips">
                    {category.relatedLabels.map((label) => (
                      <span key={label} className="catalog-home-card__chip">{label}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              <span className="catalog-home-card__cta">{category.actionLabel} →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel p-6">
          <div className="section-caption">{t('home.trust.caption')}</div>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('home.trust.title')}</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {trustBlocks.map((item) => (
              <div key={item} className="trust-tile">{item}</div>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          {quickActions.map((item) => (
            <Link key={item.key} to={item.to} className="panel p-5 transition hover:border-primary/40">
              <item.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-lg font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-caption">{t('home.brands.caption')}</div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('home.brands.title')}</h2>
          </div>
          <Link to="/brands" className="text-sm font-semibold text-primary">{t('home.brands.openAll')}</Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {featuredBrands.slice(0, 18).map((brand) => (
            <Link key={brand} to={`/search?q=${encodeURIComponent(brand)}`} className="chip bg-card">
              {brand}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-6 lg:col-span-2">
          <div className="section-caption">{t('home.service.caption')}</div>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('home.service.title')}</h2>
          <p className="mt-3 max-w-2xl text-slate-600">{t('home.service.description')}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/contacts?intent=specification" className="btn-primary">{t('home.service.selectionCta')}</Link>
            <Link to="/search" className="btn-secondary">{t('home.service.searchCta')}</Link>
          </div>
        </div>
        <div className="panel p-6">
          <div className="section-caption">{t('home.documents.caption')}</div>
          <h2 className="mt-2 text-xl font-bold text-slate-950">{t('home.documents.title')}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">{t('home.documents.description')}</p>
          <Link to="/documentation" className="btn-secondary mt-5">{t('home.documents.openCta')}</Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {homeContactCards.map((item) => (
          <div key={item.key} className="panel p-5">
            <div className="section-caption">{item.title}</div>
            <div className="mt-2 text-lg font-semibold text-slate-950">{item.value}</div>
            <div className="mt-2 text-sm leading-6 text-slate-600">{item.hint}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="panel p-5">
          <h3 className="text-lg font-semibold text-slate-950">{t('home.products.popular.title')}</h3>
          {featuredProducts.length ? (
            <div className="mt-4 space-y-3">
              {featuredProducts.map((item: any) => <Link key={item.slug} to={`/product/${item.slug}`} className="catalog-mini-link">{item.name_ru}</Link>)}
            </div>
          ) : <div className="catalog-empty-state">{t('home.products.popular.empty')}</div>}
        </div>
        <div className="panel p-5">
          <h3 className="text-lg font-semibold text-slate-950">{t('home.products.recent.title')}</h3>
          {recentProducts.length ? (
            <div className="mt-4 space-y-3">
              {recentProducts.map((item: any) => item ? <Link key={item.slug} to={`/product/${item.slug}`} className="catalog-mini-link">{item.name_ru}</Link> : null)}
            </div>
          ) : <div className="catalog-empty-state">{t('home.products.recent.empty')}</div>}
        </div>
        <div className="panel p-5">
          <h3 className="text-lg font-semibold text-slate-950">{t('home.products.favorites.title')}</h3>
          {favoriteProducts.length ? (
            <div className="mt-4 space-y-3">
              {favoriteProducts.map((item: any) => item ? <Link key={item.slug} to={`/product/${item.slug}`} className="catalog-mini-link">{item.name_ru}</Link> : null)}
            </div>
          ) : <div className="catalog-empty-state">{t('home.products.favorites.empty')}</div>}
        </div>
      </section>

    </div>
  );
}
