import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SearchBar } from '../components/SearchBar';
import type { SearchSuggestion } from '../components/SearchBar';
import { getCategoryPresentation } from '../data/publicMenu';
import { categoryDescriptionKeyBySlug, getLocalizedCategoryName } from '../data/catalogExperience';
import { normalizeLanguage } from '../i18n/types';
import { PinnedCollection } from '../components/PinnedCollection';
import { useSearchSuggestions } from '../hooks/useSearchSuggestions';
import { useNavigation, type NavigationNode } from '../hooks/useNavigation';
import { useStore } from '../store/useStore';
import { RootCategoryMedia } from '../components/RootCategoryMedia';
import '../styles/catalogDirectionCards.css';

const CATALOG_CONTEXT_ID = 'catalog-root';
const CATALOG_CONTEXT_TYPE = 'catalog';

const searchExamples = [
  { id: 'legrand-socket', value: 'Legrand розетка', labelKey: 'catalog.root.examples.legrandSocket' },
  { id: 'abb-breaker', value: 'ABB автомат', labelKey: 'catalog.root.examples.abbBreaker' },
  { id: 'cable', value: 'кабель 3x2.5', labelKey: 'catalog.root.examples.cable' },
  { id: 'danfoss-valve', value: 'Danfoss клапан', labelKey: 'catalog.root.examples.danfossValve' },
] as const;

const catalogBenefits = [
  { id: 'specification', labelKey: 'catalog.root.benefits.specification', to: '/contacts?intent=specification' },
  { id: 'analogs', labelKey: 'catalog.root.benefits.analogs', to: '/contacts?intent=analog-selection' },
  { id: 'documents', labelKey: 'catalog.root.benefits.documents', to: '/documentation' },
  { id: 'b2b', labelKey: 'catalog.root.benefits.b2b', to: '/contacts?intent=b2b' },
  { id: 'preorder', labelKey: 'catalog.root.benefits.preorder', to: '/contacts?intent=order' },
  { id: 'delivery', labelKey: 'catalog.root.benefits.delivery', to: '/contacts?intent=delivery' },
] as const;

type MenuNode = NavigationNode;

function nodeHref(node: MenuNode, parent?: MenuNode, grand?: MenuNode) {
  if (grand?.href) return grand.href;
  if (childHref(node, parent)) return childHref(node, parent)!;
  if (node.href) return node.href;
  if (node.slug?.startsWith('__')) return node.node_key === 'tools' ? '/tools' : '/catalog';
  return `/catalog/${node.slug}`;
}

function childHref(root: MenuNode, child?: MenuNode) {
  if (!child) return root.href || (root.slug?.startsWith('__') ? '/tools' : `/catalog/${root.slug}`);
  if (child.href) return child.href;
  if (child.slug?.startsWith('__')) return '/catalog';
  // Prefer single-slug canonical hrefs
  return `/catalog/${child.slug}`;
}

function categoryPath(root: MenuNode, child?: MenuNode, grand?: MenuNode) {
  if (grand) return grand.href || `/catalog/${grand.slug}`;
  if (child) return childHref(root, child);
  return nodeHref(root);
}

function formatCategoryMeta(node: MenuNode, t: TFunction) {
  const childrenCount = Number(node.childrenCount ?? node.children?.length ?? 0);
  const productsCount = Number(node.productsCount ?? 0);
  const parts: string[] = [];
  if (childrenCount > 0) parts.push(t('catalog.shared.counts.subcategories', { count: childrenCount }));
  if (productsCount > 0) parts.push(t('catalog.shared.counts.products', { count: productsCount }));
  return parts.join(' · ');
}

export function CatalogPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const navigate = useNavigate();
  const {
    items: tree,
    loading: navLoading,
    error: navError,
    isEmpty: navEmpty,
    reload: reloadNavigation,
  } = useNavigation();
  const [searchValue, setSearchValue] = useState('');
  const [suggestionsFocused, setSuggestionsFocused] = useState(false);
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<string[]>([]);
  const searchSuggestions = useSearchSuggestions(searchValue, 10, true);
  const pinnedItems = useStore((s) => s.pinnedItems);
  const togglePinnedItem = useStore((s) => s.togglePinnedItem);
  const reorderPinnedItems = useStore((s) => s.reorderPinnedItems);

  const directionCards = useMemo(() => tree.map((item) => {
    const presentation = getCategoryPresentation(item.slug);
    return {
      title: getLocalizedCategoryName(item, language),
      slug: item.slug,
      to: item.href || categoryPath(item),
      // Section copy is Russian; other languages use the translated home-page descriptions.
      description: normalizeLanguage(language) !== 'ru'
        ? (categoryDescriptionKeyBySlug[item.slug] ? t(categoryDescriptionKeyBySlug[item.slug]) : '')
        : presentation?.description || item.engineering_role_focus || '',
      imageUrl: presentation?.imageUrl || item.image_url,
      accent: presentation?.accent || 'from-slate-700/90 to-white/10',
      childrenCount: item.childrenCount,
      productsCount: item.productsCount,
      node_key: item.node_key,
    };
  }), [language, t, tree]);

  const allTreeAccordionKeys = useMemo(() => tree.flatMap((root) => [
    root.slug,
    ...(root.children || [])
      .filter((child) => (child.children || []).length > 0)
      .map((child) => `${root.slug}/${child.slug}`),
  ]), [tree]);

  const expandedTreeSet = useMemo(() => new Set(expandedTreeKeys), [expandedTreeKeys]);

  const categoryPins = useMemo(() => pinnedItems
    .filter((item) => item.type === 'category' && item.contextId === CATALOG_CONTEXT_ID && item.contextType === CATALOG_CONTEXT_TYPE)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)), [pinnedItems]);

  const pinnedIds = categoryPins.map((item) => item.id);

  const submitSearch = () => {
    const query = searchValue.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  const openExampleSearch = (example: string) => {
    setSearchValue(example);
    navigate(`/search?q=${encodeURIComponent(example)}`);
  };

  const selectSuggestion = (suggestion: SearchSuggestion) => {
    const value = suggestion.value || suggestion.label;
    setSearchValue(value);
    setSuggestionsFocused(false);
    if (suggestion.url) {
      navigate(suggestion.url);
      return;
    }
    navigate(`/search?q=${encodeURIComponent(value)}`);
  };

  const toggleTreeKey = (key: string) => {
    setExpandedTreeKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  };

  const expandAllTree = () => setExpandedTreeKeys(allTreeAccordionKeys);
  const collapseAllTree = () => setExpandedTreeKeys([]);

  useEffect(() => {
    // Keep expanded keys valid when tree reloads
    setExpandedTreeKeys((current) => current.filter((key) => allTreeAccordionKeys.includes(key) || tree.some((item) => item.slug === key)));
  }, [allTreeAccordionKeys, tree]);

  return (
    <div className="page space-y-7">
      <Breadcrumbs items={[{ label: t('navigation.breadcrumbs.home'), to: '/' }, { label: t('navigation.breadcrumbs.catalog') }]} />

      <section className="panel overflow-visible p-5 sm:p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-start">
          <div className="min-w-0">
            <div className="section-caption">{t('catalog.root.hero.caption')}</div>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold text-fg-strong sm:text-4xl lg:text-5xl">
              {t('catalog.root.hero.title')}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-fg-muted sm:text-lg">
              {t('catalog.root.hero.description')}
            </p>

            <div className="relative z-50 mt-6" onFocus={() => setSuggestionsFocused(true)} onBlur={() => window.setTimeout(() => setSuggestionsFocused(false), 120)}>
              <SearchBar
                value={searchValue}
                onChange={setSearchValue}
                onSubmit={submitSearch}
                placeholder={t('catalog.root.search.placeholder')}
                inputAriaLabel={t('catalog.root.search.ariaLabel')}
                submitLabel={t('catalog.root.search.submit')}
                suggestions={searchSuggestions}
                suggestionsOpen={suggestionsFocused && searchValue.trim().length >= 2}
                onSuggestionSelect={selectSuggestion}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-fg-muted">
              <span className="mr-1 font-medium text-fg-soft">{t('catalog.root.examples.label')}</span>
              {searchExamples.map((example) => (
                <button key={example.id} type="button" className="chip bg-card" onClick={() => openExampleSearch(example.value)}>
                  {t(example.labelKey)}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/contacts?intent=specification" className="btn-primary">{t('catalog.root.actions.sendSpecification')}</Link>
              <Link to="/contacts?intent=analog-selection" className="btn-secondary">{t('catalog.root.actions.selectAnalogs')}</Link>
              <Link to="/contacts?intent=whatsapp" className="btn-secondary">{t('catalog.root.actions.whatsapp')}</Link>
              <a href="#full-catalog-tree" className="btn-secondary bg-transparent">{t('catalog.root.actions.openCatalog')}</a>
            </div>
          </div>

          <div className="rounded-[28px] border border-line bg-card/70 p-4 sm:p-5">
            <div className="section-caption">{t('catalog.root.benefits.caption')}</div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {catalogBenefits.map((benefit) => (
                <Link
                  key={benefit.id}
                  to={benefit.to}
                  className="group flex min-h-[3.25rem] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-fg-soft transition hover:border-primary/50 hover:bg-card hover:text-fg-strong focus-visible:border-primary focus-visible:outline-none"
                >
                  <span>{t(benefit.labelKey)}</span>
                  <span className="shrink-0 text-primary transition group-hover:translate-x-0.5" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="catalog-directions" className="space-y-4 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-caption">{t('catalog.root.directions.caption')}</div>
            <h2 className="mt-2 text-2xl font-bold text-fg-strong">{t('catalog.root.directions.title')}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
              {t('catalog.root.directions.description')}
            </p>
          </div>
          <a href="#full-catalog-tree" className="text-sm font-semibold text-primary">{t('catalog.root.directions.fullTreeLink')}</a>
        </div>

        {navLoading && !directionCards.length ? <div className="catalog-empty-state">{t('catalog.root.directions.loading')}</div> : null}
        {navError && !directionCards.length ? (
          <div className="catalog-empty-state space-y-3" role="alert">
            <div>{t('catalog.root.directions.error')}</div>
            <button type="button" className="btn-primary" onClick={reloadNavigation}>{t('catalog.root.directions.retry')}</button>
          </div>
        ) : null}
        {navEmpty ? <div className="catalog-empty-state">{t('catalog.root.directions.empty')}</div> : null}

        <PinnedCollection
          items={directionCards}
          pinnedIds={pinnedIds}
          getId={(item) => item.slug}
          onReorder={(orderedIds) => reorderPinnedItems({ type: 'category', contextId: CATALOG_CONTEXT_ID, contextType: CATALOG_CONTEXT_TYPE, orderedIds })}
          listClassName="grid w-full gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          pinnedTitle={t('catalog.root.directions.pinned')}
          allTitle={t('catalog.root.directions.all')}
          renderItem={(item, meta) => (
            <div key={item.slug} className="catalog-direction-card-wrap">
              {meta.dragHandle ? <div className="catalog-direction-card__drag">{meta.dragHandle}</div> : null}
              <Link
                to={item.to}
                className={`catalog-direction-card group ${meta.isPinned ? 'is-pinned' : ''}`}
              >
                <RootCategoryMedia imageUrl={item.imageUrl} fallback={item.title.slice(0, 1)} />
                <div className="catalog-direction-card__copy">
                  <h3 className="catalog-direction-card__title">{item.title}</h3>
                  <p className="catalog-direction-card__description">{item.description}</p>
                </div>
                <span className="catalog-direction-card__cta">
                  {t('catalog.root.directions.openSection')} →
                </span>
              </Link>
              <button
                type="button"
                className="catalog-direction-card__favorite"
                onClick={() => togglePinnedItem({
                  id: item.slug,
                  type: 'category',
                  title: item.title,
                  imageUrl: item.imageUrl,
                  url: item.to,
                  contextId: CATALOG_CONTEXT_ID,
                  contextType: CATALOG_CONTEXT_TYPE,
                  subtitle: item.description,
                })}
                aria-label={meta.isPinned ? t('catalog.shared.pin.unpinCategory') : t('catalog.shared.pin.pinCategory')}
                title={meta.isPinned ? t('catalog.shared.pin.unpin') : t('catalog.shared.pin.pin')}
              >
                {meta.isPinned ? '★' : '☆'}
              </button>
            </div>
          )}
        />
      </section>

      {tree.length ? (
        <section id="full-catalog-tree" className="space-y-4 scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="section-caption">{t('catalog.root.tree.caption')}</div>
              <h2 className="mt-2 text-2xl font-bold text-fg-strong">{t('catalog.root.tree.title')}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">
                {t('catalog.root.tree.description')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={expandAllTree}>{t('catalog.root.tree.expandAll')}</button>
              <button type="button" className="btn-secondary bg-transparent" onClick={collapseAllTree}>{t('catalog.root.tree.collapseAll')}</button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {tree.map((root) => {
              const rootMeta = formatCategoryMeta(root, t);
              const rootOpen = expandedTreeSet.has(root.slug);
              const rootChildren = root.children || [];
              return (
                <div key={root.node_key || root.slug} className={`panel overflow-hidden p-0 transition ${rootOpen ? 'border-primary/40' : ''}`}>
                  <div className={`flex items-start gap-3 px-4 py-4 transition ${rootOpen ? 'bg-card/80' : 'bg-surface'}`}>
                    <button
                      type="button"
                      className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-sm text-fg-soft transition hover:border-primary/50 hover:text-primary"
                      onClick={() => toggleTreeKey(root.slug)}
                      aria-expanded={rootOpen}
                      aria-controls={`catalog-root-${root.slug}`}
                      title={rootOpen ? t('catalog.root.tree.collapseSection') : t('catalog.root.tree.expandSection')}
                    >
                      {rootOpen ? '⌄' : '›'}
                    </button>
                    <div className="min-w-0 flex-1">
                      <Link to={categoryPath(root)} className="block text-lg font-semibold leading-tight text-fg-strong hover:text-primary">
                        {getLocalizedCategoryName(root, language)}
                      </Link>
                      {rootMeta ? <div className="mt-1 text-xs text-fg-muted">{rootMeta}</div> : null}
                    </div>
                  </div>

                  {rootOpen ? (
                    <div id={`catalog-root-${root.slug}`} className="space-y-2 border-t border-line bg-card/40 p-3">
                      {rootChildren.map((child) => {
                        const childMeta = formatCategoryMeta(child, t);
                        const childChildren = child.children || [];
                        const childKey = `${root.slug}/${child.slug}`;
                        const childOpen = expandedTreeSet.has(childKey);

                        if (!childChildren.length) {
                          return (
                            <Link
                              key={child.node_key || child.slug}
                              to={categoryPath(root, child)}
                              className="block rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg-soft transition hover:border-primary hover:text-primary"
                            >
                              <span>{getLocalizedCategoryName(child, language)}</span>
                              {childMeta ? <span className="ml-2 text-xs font-normal text-fg-muted">{childMeta}</span> : null}
                            </Link>
                          );
                        }

                        return (
                          <div key={child.node_key || child.slug} className={`rounded-2xl border border-line bg-surface transition ${childOpen ? 'border-primary/30' : ''}`}>
                            <div className="flex items-start gap-2 px-3 py-3">
                              <button
                                type="button"
                                className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-card text-xs text-fg-soft transition hover:border-primary/50 hover:text-primary"
                                onClick={() => toggleTreeKey(childKey)}
                                aria-expanded={childOpen}
                                aria-controls={`catalog-child-${root.slug}-${child.slug}`}
                                title={childOpen ? t('catalog.root.tree.collapseSubcategory') : t('catalog.root.tree.expandSubcategory')}
                              >
                                {childOpen ? '⌄' : '›'}
                              </button>
                              <div className="min-w-0 flex-1">
                                <Link to={categoryPath(root, child)} className="font-medium text-fg-soft hover:text-primary">
                                  {getLocalizedCategoryName(child, language)}
                                </Link>
                                {childMeta ? <div className="mt-1 text-xs text-fg-muted">{childMeta}</div> : null}
                              </div>
                            </div>

                            {childOpen ? (
                              <div id={`catalog-child-${root.slug}-${child.slug}`} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
                                {childChildren.map((grand) => (
                                  <Link
                                    key={grand.node_key || grand.slug}
                                    to={categoryPath(root, child, grand)}
                                    className="rounded-xl border border-line bg-card px-3 py-2 text-sm text-fg-soft transition hover:border-primary hover:text-primary"
                                  >
                                    <span className="block font-medium">{getLocalizedCategoryName(grand, language)}</span>
                                    {grand.productsCount ? <span className="text-xs text-fg-muted">{t('catalog.shared.counts.products', { count: grand.productsCount })}</span> : null}
                                  </Link>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
