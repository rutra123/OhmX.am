import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

type HeroAction = { label: string; to: string; variant?: 'primary' | 'secondary' | 'ghost' };
type HeroSlide = {
  eyebrow: string;
  headline: string;
  headlineWords: string[];
  description: string;
  actions: HeroAction[];
  chips: string[];
  visual: { kicker: string; title: string; metric: string; meta: string; progress: number; rows: string[]; nodes: string[] };
};

type HeroSlideDefinition = {
  key: string;
  eyebrowKey: string;
  headlineKey: string;
  headlineWordsKey: string;
  descriptionKey: string;
  actionLabelsKey: string;
  actions: Array<Omit<HeroAction, 'label'>>;
  chipsKey: string;
  visual: {
    kickerKey: string;
    titleKey: string;
    metricKey: string;
    metaKey: string;
    progress: number;
    rowsKey: string;
    nodes: string[];
  };
};

const AUTOPLAY_INTERVAL_MS = 7600;

const heroSlideDefinitions = [
  {
    key: 'selection',
    eyebrowKey: 'home.hero.slides.selection.eyebrow',
    headlineKey: 'home.hero.slides.selection.headline',
    headlineWordsKey: 'home.hero.slides.selection.headlineWords',
    descriptionKey: 'home.hero.slides.selection.description',
    actionLabelsKey: 'home.hero.slides.selection.actionLabels',
    actions: [
      { to: '/contacts?intent=selection', variant: 'primary' },
      { to: '/tools', variant: 'secondary' },
      { to: '/contacts?intent=engineer', variant: 'ghost' },
    ],
    chipsKey: 'home.hero.slides.selection.chips',
    visual: {
      kickerKey: 'home.hero.slides.selection.visual.kicker',
      titleKey: 'home.hero.slides.selection.visual.title',
      metricKey: 'home.hero.slides.selection.visual.metric',
      metaKey: 'home.hero.slides.selection.visual.meta',
      progress: 78,
      rowsKey: 'home.hero.slides.selection.visual.rows',
      nodes: ['SKU', 'PDF', 'BOM'],
    },
  },
  {
    key: 'catalog',
    eyebrowKey: 'home.hero.slides.catalog.eyebrow',
    headlineKey: 'home.hero.slides.catalog.headline',
    headlineWordsKey: 'home.hero.slides.catalog.headlineWords',
    descriptionKey: 'home.hero.slides.catalog.description',
    actionLabelsKey: 'home.hero.slides.catalog.actionLabels',
    actions: [
      { to: '/catalog', variant: 'primary' },
      { to: '/catalog/rozetki-i-vyklyuchateli', variant: 'secondary' },
      { to: '/catalog/elektrika-i-schitovoe-oborudovanie', variant: 'ghost' },
    ],
    chipsKey: 'home.hero.slides.catalog.chips',
    visual: {
      kickerKey: 'home.hero.slides.catalog.visual.kicker',
      titleKey: 'home.hero.slides.catalog.visual.title',
      metricKey: 'home.hero.slides.catalog.visual.metric',
      metaKey: 'home.hero.slides.catalog.visual.meta',
      progress: 64,
      rowsKey: 'home.hero.slides.catalog.visual.rows',
      nodes: ['CAT', 'TASK', 'FILTER'],
    },
  },
  {
    key: 'documents',
    eyebrowKey: 'home.hero.slides.documents.eyebrow',
    headlineKey: 'home.hero.slides.documents.headline',
    headlineWordsKey: 'home.hero.slides.documents.headlineWords',
    descriptionKey: 'home.hero.slides.documents.description',
    actionLabelsKey: 'home.hero.slides.documents.actionLabels',
    actions: [
      { to: '/documentation', variant: 'primary' },
      { to: '/search', variant: 'secondary' },
      { to: '/documentation', variant: 'ghost' },
    ],
    chipsKey: 'home.hero.slides.documents.chips',
    visual: {
      kickerKey: 'home.hero.slides.documents.visual.kicker',
      titleKey: 'home.hero.slides.documents.visual.title',
      metricKey: 'home.hero.slides.documents.visual.metric',
      metaKey: 'home.hero.slides.documents.visual.meta',
      progress: 86,
      rowsKey: 'home.hero.slides.documents.visual.rows',
      nodes: ['SKU', 'DOC', 'CERT'],
    },
  },
  {
    key: 'supply',
    eyebrowKey: 'home.hero.slides.supply.eyebrow',
    headlineKey: 'home.hero.slides.supply.headline',
    headlineWordsKey: 'home.hero.slides.supply.headlineWords',
    descriptionKey: 'home.hero.slides.supply.description',
    actionLabelsKey: 'home.hero.slides.supply.actionLabels',
    actions: [
      { to: '/contacts?intent=project-supply', variant: 'primary' },
      { to: '/contacts?intent=analog-selection', variant: 'secondary' },
      { to: '/catalog', variant: 'ghost' },
    ],
    chipsKey: 'home.hero.slides.supply.chips',
    visual: {
      kickerKey: 'home.hero.slides.supply.visual.kicker',
      titleKey: 'home.hero.slides.supply.visual.title',
      metricKey: 'home.hero.slides.supply.visual.metric',
      metaKey: 'home.hero.slides.supply.visual.meta',
      progress: 72,
      rowsKey: 'home.hero.slides.supply.visual.rows',
      nodes: ['BOM', 'ALT', 'ORDER'],
    },
  },
] satisfies HeroSlideDefinition[];

function nextIndex(index: number, step: 1 | -1) {
  return (index + step + heroSlideDefinitions.length) % heroSlideDefinitions.length;
}

function actionClassName(action: HeroAction) {
  if (action.variant === 'primary') return 'btn-primary engineering-hero-slider__action';
  if (action.variant === 'ghost') return 'btn-secondary engineering-hero-slider__action engineering-hero-slider__action--ghost';
  return 'btn-secondary engineering-hero-slider__action';
}

export function EngineeringHeroSlider() {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const translatedList = (key: string) => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? value.map(String) : [];
  };
  const engineeringHeroSlides: HeroSlide[] = heroSlideDefinitions.map((slide) => {
    const actionLabels = translatedList(slide.actionLabelsKey);
    return {
      eyebrow: t(slide.eyebrowKey),
      headline: t(slide.headlineKey),
      headlineWords: translatedList(slide.headlineWordsKey),
      description: t(slide.descriptionKey),
      actions: slide.actions.map((action, index) => ({ ...action, label: actionLabels[index] || '' })),
      chips: translatedList(slide.chipsKey),
      visual: {
        kicker: t(slide.visual.kickerKey),
        title: t(slide.visual.titleKey),
        metric: t(slide.visual.metricKey),
        meta: t(slide.visual.metaKey),
        progress: slide.visual.progress,
        rows: translatedList(slide.visual.rowsKey),
        nodes: slide.visual.nodes,
      },
    };
  });
  const activeSlide = engineeringHeroSlides[activeIndex];
  const liveRegionMode = isPaused || reducedMotion ? 'polite' : 'off';

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }
    mediaQuery.addListener?.(update);
    return () => mediaQuery.removeListener?.(update);
  }, []);

  useEffect(() => {
    if (isPaused || reducedMotion) return undefined;
    const timer = window.setInterval(() => setActiveIndex((current) => nextIndex(current, 1)), AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isPaused, reducedMotion]);

  const selectSlide = useCallback((index: number) => {
    setActiveIndex(index);
    setIsPaused(true);
  }, []);

  const goToSlide = useCallback((step: 1 | -1) => {
    setActiveIndex((current) => nextIndex(current, step));
    setIsPaused(true);
  }, []);

  return (
    <section
      className="engineering-hero-slider"
      aria-label={t('home.hero.ariaLabel')}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
    >
      <div className="engineering-hero-slider__glow" aria-hidden="true" />
      <div className="engineering-hero-slider__content" aria-live={liveRegionMode}>
        <div className="engineering-hero-slider__eyebrow">{activeSlide.eyebrow}</div>
        <h1 key={`hero-title-${activeIndex}`} className="engineering-hero-slider__title" aria-label={activeSlide.headline}>
          {activeSlide.headlineWords.map((word, index) => (
            <span
              key={`${activeSlide.eyebrow}-${word}`}
              className="engineering-hero-slider__title-word"
              style={{ '--word-index': index } as CSSProperties}
              aria-hidden="true"
            >
              {word}
            </span>
          ))}
        </h1>
        <p className="engineering-hero-slider__description">{activeSlide.description}</p>
        <div className="engineering-hero-slider__actions" aria-label={t('home.hero.quickActionsAria')}>
          {activeSlide.actions.map((action, index) => (
            <Link key={`${activeSlide.eyebrow}-${action.to}-${index}`} to={action.to} className={actionClassName(action)}>{action.label}</Link>
          ))}
        </div>
        <div className="engineering-hero-slider__chips" aria-label={t('home.hero.chipsAria')}>
          {activeSlide.chips.map((chip) => <span key={`${activeSlide.eyebrow}-${chip}`} className="engineering-hero-slider__chip">{chip}</span>)}
        </div>
        <div className="engineering-hero-slider__tabs" role="tablist" aria-label={t('home.hero.tabsAria')}>
          {engineeringHeroSlides.map((slide, index) => (
            <button
              key={heroSlideDefinitions[index].key}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={t('home.hero.showSlide', { headline: slide.headline })}
              className={`engineering-hero-slider__tab ${index === activeIndex ? 'is-active' : ''}`}
              onClick={() => selectSlide(index)}
            >
              <span className="engineering-hero-slider__tab-index">0{index + 1}</span>
              <span className="engineering-hero-slider__tab-label">{slide.eyebrow.split(' · ')[0]}</span>
              <span className="engineering-hero-slider__tab-progress" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="engineering-hero-slider__visual" aria-hidden="true">
        <div className="engineering-hero-slider__visual-card">
          <div className="engineering-hero-slider__visual-topline"><span>{activeSlide.visual.kicker}</span><span className="engineering-hero-slider__pulse">●</span></div>
          <div className="engineering-hero-slider__metric-row">
            <div><div className="engineering-hero-slider__metric">{activeSlide.visual.metric}</div><div className="engineering-hero-slider__meta">{activeSlide.visual.meta}</div></div>
            <div className="engineering-hero-slider__radar">{activeSlide.visual.nodes.map((node) => <span key={node}>{node}</span>)}</div>
          </div>
          <h2 className="engineering-hero-slider__visual-title">{activeSlide.visual.title}</h2>
          <div className="engineering-hero-slider__progress" style={{ '--hero-progress': `${activeSlide.visual.progress}%` } as CSSProperties}><span /></div>
          <div className="engineering-hero-slider__visual-list">
            {activeSlide.visual.rows.map((row, index) => <div key={row} className="engineering-hero-slider__visual-row"><span>0{index + 1}</span><strong>{row}</strong></div>)}
          </div>
        </div>
      </div>
      <div className="engineering-hero-slider__controls" aria-label={t('home.hero.controlsAria')}>
        <button type="button" className="engineering-hero-slider__control" onClick={() => goToSlide(-1)} aria-label={t('home.hero.previousSlide')}>←</button>
        <button type="button" className="engineering-hero-slider__control" onClick={() => goToSlide(1)} aria-label={t('home.hero.nextSlide')}>→</button>
      </div>
    </section>
  );
}
