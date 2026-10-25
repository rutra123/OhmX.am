import { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { BrandCard } from '../components/BrandCard';
import { CategoryCard } from '../components/CategoryCard';
import { CategoryCompositionCard } from '../components/CategoryCompositionCard';
import { getCategoryComposition, isCategoryCompositionEnabled } from '../config/categoryCompositions';
import { ManagedImage } from '../components/ManagedImage';
import { ProductCard } from '../components/ProductCard';
import { SeriesCard } from '../components/SeriesCard';
import { PinnedCollection } from '../components/PinnedCollection';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { ArrowLeft, ChevronRight, Compare, Filter, Pin } from '../components/Icons';
import { getDisplaySeriesName, getSeriesSlug } from '../lib/series';
import { useStore } from '../store/useStore';
import { BRANDLESS_SLUG, branchBrandFirst, getCategoryDescription, getCategoryTitle, rootBrandFirst, rootBrandMatrix, switchesSeriesShowcase } from '../data/catalogExperience';
import { getSeriesCoverImage } from '../data/seriesImages';
import { getCategoryPresentation } from '../data/publicMenu';
import { useNavigation } from '../hooks/useNavigation';
import { normalizeLanguage } from '../i18n/types';
import { buildSearchMatch } from '../lib/search';
import '../styles/categoryRootHero.css';

const decodePathSlug = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const CATALOG_WORKSPACE_STORAGE_KEY = 'ohmx:catalog:last-workspace';
const CATALOG_WORKSPACE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_SCROLL_SESSION_PREFIX = 'ohmx:catalog:scroll:';

type CatalogWorkspaceSnapshot = {
  pathname: string;
  search: string;
  scrollY: number;
  viewMode: 'grid' | 'list';
  updatedAt: number;
};

const isCatalogPath = (pathname: string) => pathname.startsWith('/catalog') || pathname.startsWith('/category');

const catalogScrollKey = (pathname: string, search: string) => `${CATALOG_SCROLL_SESSION_PREFIX}${pathname}${search}`;

function readCatalogWorkspace(): CatalogWorkspaceSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CATALOG_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<CatalogWorkspaceSnapshot> | null;
    if (!snapshot || typeof snapshot.pathname !== 'string' || !isCatalogPath(snapshot.pathname)) return null;
    if (typeof snapshot.search !== 'string' || typeof snapshot.updatedAt !== 'number') return null;
    if (Date.now() - snapshot.updatedAt > CATALOG_WORKSPACE_TTL_MS) return null;
    return {
      pathname: snapshot.pathname,
      search: snapshot.search,
      scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : 0,
      viewMode: snapshot.viewMode === 'list' ? 'list' : 'grid',
      updatedAt: snapshot.updatedAt,
    };
  } catch {
    return null;
  }
}

function writeCatalogWorkspace(snapshot: CatalogWorkspaceSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CATALOG_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    window.sessionStorage.setItem(catalogScrollKey(snapshot.pathname, snapshot.search), JSON.stringify({ scrollY: snapshot.scrollY, updatedAt: snapshot.updatedAt }));
  } catch {
    // Ignore storage failures.
  }
}

function readCatalogScroll(pathname: string, search: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(catalogScrollKey(pathname, search));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scrollY?: unknown } | number | null;
    if (typeof parsed === 'number') return Number.isFinite(parsed) ? parsed : null;
    const scrollY = Number(parsed?.scrollY);
    return Number.isFinite(scrollY) ? Math.max(0, scrollY) : null;
  } catch {
    return null;
  }
}

function getCatalogScrollTarget() {
  if (typeof window === 'undefined') return null;
  return document.querySelector<HTMLElement>('main.mobile-scroll-content.public-scroll-content');
}

function getCatalogScrollY() {
  if (typeof window === 'undefined') return 0;
  const element = getCatalogScrollTarget();
  if (element) return Math.max(0, Math.round(element.scrollTop || 0));
  return Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0));
}

function setCatalogScrollY(scrollY: number) {
  if (typeof window === 'undefined') return;
  const element = getCatalogScrollTarget();
  if (element) {
    element.scrollTo({ top: scrollY, behavior: 'auto' });
    return;
  }
  window.scrollTo({ top: scrollY, behavior: 'auto' });
}

function isDescendantCategory(categoryId: number, targetCategoryId: number, parentById: Map<number, number | null>) {
  let current: number | null | undefined = categoryId;
  while (current) {
    if (current === targetCategoryId) return true;
    current = parentById.get(current) ?? null;
  }
  return false;
}

function getProductCategoryIds(product: any) {
  const ids = new Set<number>();
  String(product.category_ids_csv || '')
    .split(',')
    .map((value) => Number(value))
    .filter(Boolean)
    .forEach((id) => ids.add(id));
  [product.category_id, product.primary_category_id]
    .map((value) => Number(value || 0))
    .filter(Boolean)
    .forEach((id) => ids.add(id));
  return [...ids];
}

const PRODUCT_PAGE_SIZE = 36;

function extractProductColorLabel(product: any) {
  void product;
  return ''; // Deprecated in favor of technical filters
}

function flattenCategoryTree(nodes: any[]): any[] {
  const flattened: any[] = [];
  const visit = (items: any[]) => {
    for (const item of items || []) {
      flattened.push(item);
      visit(item.children || []);
    }
  };
  visit(nodes);
  return flattened;
}

const TECH_FILTER_LABEL_KEYS: Record<string, string> = {
  rated_current_a: 'catalog.category.filters.tech.ratedCurrent',
  poles: 'catalog.category.filters.tech.poles',
  curve: 'catalog.category.filters.tech.curve',
  breaking_capacity_ka: 'catalog.category.filters.tech.breakingCapacity',
  device_type: 'catalog.category.filters.tech.deviceType',
  leakage_current_ma: 'catalog.category.filters.tech.leakageCurrent',
  color: 'catalog.category.filters.tech.color',
  material: 'catalog.category.filters.tech.material',
  module_count: 'catalog.category.filters.tech.moduleCount',
  rows_count: 'catalog.category.filters.tech.rowsCount',
  ip_rating: 'catalog.category.filters.tech.ipRating',
  mounting_type: 'catalog.category.filters.tech.mountingType',
  door_type: 'catalog.category.filters.tech.doorType',
  brandId: 'catalog.category.filters.tech.manufacturer',
  seriesId: 'catalog.category.filters.tech.series',
  product_type: 'catalog.category.filters.tech.productType',
};

const PRODUCT_TYPE_LABEL_KEYS: Record<string, string> = {
  equipment: 'catalog.category.filters.values.productType.equipment',
  accessory: 'catalog.category.filters.values.productType.accessory',
};

const DEVICE_TYPE_LABEL_KEYS: Record<string, string> = {
  MCB: 'catalog.category.filters.values.deviceType.mcb',
  RCD: 'catalog.category.filters.values.deviceType.rcd',
  RCBO: 'catalog.category.filters.values.deviceType.rcbo',
  'Switch-disconnector': 'catalog.category.filters.values.deviceType.switchDisconnector',
};

const MOUNTING_TYPE_LABEL_KEYS: Record<string, string> = {
  surface: 'catalog.category.filters.values.mountingType.surface',
  recessed: 'catalog.category.filters.values.mountingType.recessed',
  flush: 'catalog.category.filters.values.mountingType.flush',
  floor: 'catalog.category.filters.values.mountingType.floor',
  wall: 'catalog.category.filters.values.mountingType.wall',
};

const DOOR_TYPE_LABEL_KEYS: Record<string, string> = {
  transparent: 'catalog.category.filters.values.doorType.transparent',
  white: 'catalog.category.filters.values.doorType.white',
  smoked: 'catalog.category.filters.values.doorType.smoked',
  metal: 'catalog.category.filters.values.doorType.metal',
  opaque: 'catalog.category.filters.values.doorType.opaque',
  without_door: 'catalog.category.filters.values.doorType.withoutDoor',
};

const MATERIAL_LABEL_KEYS: Record<string, string> = {
  metal: 'catalog.category.filters.values.material.metal',
  steel: 'catalog.category.filters.values.material.steel',
  plastic: 'catalog.category.filters.values.material.plastic',
  polycarbonate: 'catalog.category.filters.values.material.polycarbonate',
  abs: 'catalog.category.filters.values.material.abs',
  pvc: 'catalog.category.filters.values.material.pvc',
  glass: 'catalog.category.filters.values.material.glass',
};

function formatTechValue(key: string, value: any, unit: string, t: TFunction) {
  const translationKey = key === 'device_type'
    ? DEVICE_TYPE_LABEL_KEYS[value]
    : key === 'mounting_type'
      ? MOUNTING_TYPE_LABEL_KEYS[value]
      : key === 'door_type'
        ? DOOR_TYPE_LABEL_KEYS[value]
        : key === 'material'
          ? MATERIAL_LABEL_KEYS[value]
          : key === 'product_type'
            ? PRODUCT_TYPE_LABEL_KEYS[value]
            : '';
  if (translationKey) return t(translationKey);
  return `${value}${unit ? ` ${unit}` : ''}`;
}

export function CategoryPage() {
  const { t, i18n } = useTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allBrands, setAllBrands] = useState<any[]>([]);
  const [branchData, setBranchData] = useState<any>(null);
  const [relatedSeriesData, setRelatedSeriesData] = useState<any>(null);
  const [branchLoading, setBranchLoading] = useState(true);
  const [branchError, setBranchError] = useState('');
  const [technicalFiltersMetadata, setTechnicalFiltersMetadata] = useState<Record<string, any[]> | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [productView, setProductView] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('ohmx-product-view') === 'list' ? 'list' : 'grid';
  });
  const restoredScrollRef = useRef(false);
  const scrollSaveRafRef = useRef<number | null>(null);
  const pendingSavedScrollRef = useRef<number | null>(null);
  const hasScrolledRef = useRef(false);
  const pinnedItems = useStore((state) => state.pinnedItems);
  const togglePinnedItem = useStore((state) => state.togglePinnedItem);
  const reorderPinnedItems = useStore((state) => state.reorderPinnedItems);
  const compare = useStore((state) => state.compare);

  const pathParts = location.pathname.split('/').filter(Boolean).map(decodePathSlug);
  const rootSlug = decodePathSlug(slug);
  const nestedSlugs = pathParts.slice(2);
  const currentSlug = nestedSlugs[nestedSlugs.length - 1] || rootSlug;
  const { displayName, hrefForSlug, items: navItems } = useNavigation();
  const rootCard = useMemo(() => {
    const presentation = getCategoryPresentation(rootSlug);
    const fromNav = navItems.find((item) => item.slug === rootSlug);
    if (!presentation && !fromNav) return undefined;
    return {
      title: fromNav?.name_ru || displayName(rootSlug, presentation?.title || rootSlug),
      slug: rootSlug,
      to: fromNav?.href || hrefForSlug(rootSlug) || presentation?.to || `/catalog/${rootSlug}`,
      description: presentation?.description || fromNav?.engineering_role_focus || '',
      imageUrl: presentation?.imageUrl || fromNav?.image_url,
      accent: presentation?.accent || 'from-slate-700/90 to-white/10',
    };
  }, [displayName, hrefForSlug, navItems, rootSlug]);
  const isSwitchesRoot = rootSlug === 'rozetki-i-vyklyuchateli';

  const selectedBrand = params.get('brand') || '';
  const selectedSeries = params.get('series') || '';
  const selectedCategoryFilter = params.get('category') || '';
  const searchQuery = params.get('q') || '';
  const saleMode = params.get('saleMode') || '';
  const inStock = params.get('inStock') || '';
  const hasDocs = params.get('hasDocs') || '';
  const selectedColor = params.get('color') || '';
  const minPrice = params.get('minPrice') || '';
  const maxPrice = params.get('maxPrice') || '';
  const productType = params.get('product_type') || '';
  const currentPage = Math.max(1, Number(params.get('page') || '1') || 1);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ohmx-product-view', productView);
  }, [productView]);

  useEffect(() => {
    restoredScrollRef.current = false;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncSnapshot = (preferPending = false) => {
      const measuredScrollY = getCatalogScrollY();
      const scrollY = preferPending && pendingSavedScrollRef.current != null
        ? pendingSavedScrollRef.current
        : measuredScrollY;
      if (scrollY <= 0 && !hasScrolledRef.current) return;
      if (scrollY === 0 && pendingSavedScrollRef.current != null && pendingSavedScrollRef.current > 0) return;
      pendingSavedScrollRef.current = scrollY;
      writeCatalogWorkspace({
        pathname: location.pathname,
        search: location.search,
        scrollY,
        viewMode: productView,
        updatedAt: Date.now(),
      });
    };

    const onScroll = () => {
      hasScrolledRef.current = true;
      if (scrollSaveRafRef.current != null) window.cancelAnimationFrame(scrollSaveRafRef.current);
      scrollSaveRafRef.current = window.requestAnimationFrame(() => {
        scrollSaveRafRef.current = null;
        syncSnapshot();
      });
    };

    const onPageHide = () => syncSnapshot();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') syncSnapshot();
    };

    const attachTarget = () => getCatalogScrollTarget() || window;
    let target = attachTarget();

    target.addEventListener('scroll', onScroll, { passive: true } as AddEventListenerOptions);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      target.removeEventListener('scroll', onScroll as EventListener);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (scrollSaveRafRef.current != null) window.cancelAnimationFrame(scrollSaveRafRef.current);
      syncSnapshot(true);
    };
  }, [location.pathname, location.search, productView]);

  useEffect(() => {
    if (typeof window === 'undefined' || branchLoading || !branchData || restoredScrollRef.current) return;
    const scrollY = readCatalogScroll(location.pathname, location.search);
    if (scrollY == null || scrollY <= 0) {
      const resetFrame = window.requestAnimationFrame(() => setCatalogScrollY(0));
      restoredScrollRef.current = true;
      return () => window.cancelAnimationFrame(resetFrame);
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;
    const retryDelayMs = 100;

    const restore = () => {
      if (cancelled || restoredScrollRef.current) return;
      setCatalogScrollY(scrollY);
      window.setTimeout(() => {
        if (cancelled || restoredScrollRef.current) return;
        const applied = getCatalogScrollY();
        if (Math.abs(applied - scrollY) <= 4 || applied > 500) {
          restoredScrollRef.current = true;
          return;
        }
        if (attempts < maxAttempts) {
          attempts += 1;
          window.setTimeout(restore, retryDelayMs);
        }
      }, 50);
    };

    const initialRaf = window.requestAnimationFrame(() => {
      if (!cancelled) restore();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(initialRaf);
    };
  }, [branchLoading, location.pathname, location.search, branchData?.products?.length, branchData?.children?.length]);

  useEffect(() => {
    api<any[]>('/categories/menu').then((tree) => setAllCategories(flattenCategoryTree(tree))).catch(() => setAllCategories([]));
    api<any[]>('/brands').then(setAllBrands);
  }, []);

  useEffect(() => {
    setTechnicalFiltersMetadata(null);
    api<any>(`/categories/${encodeURIComponent(currentSlug)}/filters`)
      .then(setTechnicalFiltersMetadata)
      .catch(() => setTechnicalFiltersMetadata(null));
  }, [currentSlug]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (selectedBrand) query.set('brand', selectedBrand);
    const selectedSeriesId = params.get('seriesId');
    if (selectedSeries) query.set('series', selectedSeries);
    if (selectedSeriesId) query.set('seriesId', selectedSeriesId);
    if (selectedCategoryFilter) query.set('category', selectedCategoryFilter);
    if (searchQuery) query.set('q', searchQuery);
    if (saleMode) query.set('saleMode', saleMode);
    if (inStock) query.set('inStock', inStock);
    if (hasDocs) query.set('hasDocs', hasDocs);
    if (minPrice) query.set('minPrice', minPrice);
    if (maxPrice) query.set('maxPrice', maxPrice);

    // Tech filters
    const techKeys = ['rated_current_a', 'poles', 'curve', 'breaking_capacity_ka', 'device_type', 'rcd_type', 'leakage_current_ma', 'product_type'];
    techKeys.forEach(key => {
      const val = params.get(key);
      if (val) query.set(key, val);
    });

    query.set('page', String(currentPage));
    // When a series filter is applied, limit page size to 24 to match UI pagination expectations (smoke test expects <=24)
    const pageLimit = selectedSeries ? '24' : String(PRODUCT_PAGE_SIZE);
    query.set('limit', pageLimit);

    setBranchLoading(true);
    setBranchError('');

    api(`/categories/${encodeURIComponent(currentSlug)}${query.toString() ? `?${query.toString()}` : ''}`)
      .then((data) => {
        setBranchData(data);
        setBranchError('');
      })
      .catch((error) => {
        setBranchData(null);
        setBranchError(error instanceof Error ? error.message : 'catalog.category.errors.loadFallback');
      })
      .finally(() => setBranchLoading(false));
  }, [currentSlug, selectedBrand, selectedSeries, selectedCategoryFilter, searchQuery, saleMode, inStock, hasDocs, minPrice, maxPrice, productType, currentPage]);

  useEffect(() => {
    if (rootSlug !== 'rozetki-i-vyklyuchateli' || !selectedSeries) {
      setRelatedSeriesData(null);
      return;
    }

    const query = new URLSearchParams();
    const selectedSeriesId = params.get('seriesId');
    query.set('series', selectedSeries);
    if (selectedSeriesId) query.set('seriesId', selectedSeriesId);
    if (selectedBrand) query.set('brand', selectedBrand);
    query.set('page', '1');
    query.set('limit', '100');

    api(`/categories/${encodeURIComponent(rootSlug)}?${query.toString()}`)
      .then(setRelatedSeriesData)
      .catch(() => setRelatedSeriesData(null));
  }, [rootSlug, selectedSeries, selectedBrand]);

  const categoriesBySlug = useMemo(() => new Map(allCategories.map((item) => [item.slug, item])), [allCategories]);
  const categoriesByName = useMemo(() => new Map(allCategories.map((item) => [item.name_ru, item])), [allCategories]);
  const parentById = useMemo(() => new Map(allCategories.map((item) => [item.id, item.parent_id ?? null])), [allCategories]);
  const currentCategory = branchData?.category || categoriesBySlug.get(currentSlug);
  const currentDepth = Number(currentCategory?.level ?? nestedSlugs.length);
  const currentChildren = (branchData?.children || []).filter((item: any) => item.is_active !== 0);
  const serverFilterCategories = (branchData?.filterCategories || []).filter((item: any) => item.is_active !== 0);
  const branchProducts = branchData?.products || [];
  const pagination = branchData?.pagination || null;
  const products = branchProducts;
  const switchSeriesDefinitions = useMemo(() => switchesSeriesShowcase
    .map((item, index) => {
      const category = categoriesByName.get(item.categoryName);
      if (!category) return null;
      return {
        ...category,
        displayTitle: item.title,
        showcaseOrder: index,
      };
    })
    .filter(Boolean) as any[], [categoriesByName]);
  const switchSeriesSlugs = useMemo(() => new Set(switchSeriesDefinitions.map((item: any) => item.slug)), [switchSeriesDefinitions]);
  const currentSwitchSeriesLanding = Boolean(isSwitchesRoot && currentCategory?.slug && currentCategory.slug !== rootSlug && switchSeriesSlugs.has(currentCategory.slug));
  const switchSeriesCards = useMemo(() => {
    if (!isSwitchesRoot || currentSlug !== rootSlug) return [];
    return switchSeriesDefinitions
      .map((category: any) => {
        const productsCount = products.filter((product: any) => (
          getProductCategoryIds(product).some((categoryId) => isDescendantCategory(categoryId, category.id, parentById))
        )).length;
        return { ...category, productsCount };
      })
      .filter((item: any) => item.productsCount > 0)
      .sort((a: any, b: any) => a.showcaseOrder - b.showcaseOrder);
  }, [currentSlug, isSwitchesRoot, parentById, products, rootSlug, switchSeriesDefinitions]);

  const switchSeriesLanding = Boolean(isSwitchesRoot && currentSlug === rootSlug);
  const isMechanismsRoot = rootSlug === 'rozetki-i-vyklyuchateli-mehanizmy';
  const isMechanismsRootLanding = Boolean(isMechanismsRoot && currentSlug === rootSlug);
  // For rozetki-i-vyklyuchateli root, present series/models (Arteor, Niloe, Niloe Step, Suno, ...) as primary navigation
  // instead of functional subcategories (Механизмы, Рамки, etc). Only after selecting a series, products of that model are shown.
  // For rozetki-i-vyklyuchateli-mehanizmy, reuse the same behavior but keep the scope limited to that slug.
  const isSwitchesRootLanding = switchSeriesLanding || Boolean(isMechanismsRoot && currentSlug === rootSlug);
  const useVisualCompositions = isCategoryCompositionEnabled(
    currentCategory?.slug,
    import.meta.env.VITE_VISUAL_CATALOG_PILOT === 'true',
    import.meta.env.DEV,
    params.get('visualCatalog'),
  );
  const currentTitle = currentCategory ? getCategoryTitle(currentCategory) : rootCard?.title || t('catalog.category.fallbackTitle');
  const pinnedLabel = t('catalog.shared.pinned');
  const allLabel = t('catalog.shared.all');

  useEffect(() => {
    if (currentSwitchSeriesLanding) setShowFilters(true);
  }, [currentSwitchSeriesLanding]);

  const categoryContext = useMemo(() => {
    const isRootLevelCategory = currentCategory?.slug === rootSlug;
    return {
      type: isRootLevelCategory ? 'category' as const : 'subcategory' as const,
      contextId: isRootLevelCategory ? 'catalog-root' : (nestedSlugs.length > 1 ? nestedSlugs[nestedSlugs.length - 2] : rootSlug),
      contextType: isRootLevelCategory ? 'catalog' : 'category',
      url: nestedSlugs.length ? `/catalog/${rootSlug}/${nestedSlugs.join('/')}` : `/catalog/${rootSlug}`,
    };
  }, [currentCategory?.slug, nestedSlugs, rootSlug]);

  const seriesContext = useMemo(() => ({
    type: 'series' as const,
    contextId: `${currentCategory?.slug || currentSlug}:${selectedBrand || 'all'}`,
    contextType: 'category-series',
  }), [currentCategory?.slug, currentSlug, selectedBrand]);

  const brandContext = useMemo(() => ({
    type: 'brand' as const,
    contextId: `${currentCategory?.slug || currentSlug}:brands`,
    contextType: 'category-brands',
  }), [currentCategory?.slug, currentSlug]);

  const productContext = useMemo(() => ({
    type: 'product' as const,
    contextId: `${currentCategory?.slug || currentSlug}:${selectedBrand || 'all'}:${selectedSeries || 'all'}`,
    contextType: 'category-products',
  }), [currentCategory?.slug, currentSlug, selectedBrand, selectedSeries]);

  const rootBrandOrder = rootBrandMatrix[rootSlug] || [];
  const brandsByName = useMemo(() => new Map(allBrands.map((item) => [item.name, item])), [allBrands]);
  const brandsBySlug = useMemo(() => new Map(allBrands.map((item) => [item.slug, item])), [allBrands]);

  const serverBrandOptions = useMemo(() => {
    const options = Array.isArray(technicalFiltersMetadata?.brandId) ? technicalFiltersMetadata.brandId : [];
    return options
      .map((item: any) => ({ slug: item.slug || BRANDLESS_SLUG, count: Number(item.count || 0) }))
      .filter((item: any) => item.slug);
  }, [technicalFiltersMetadata]);

  const productBrandCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (serverBrandOptions.length) {
      for (const option of serverBrandOptions) counts.set(option.slug, option.count);
      return counts;
    }
    for (const product of branchProducts) {
      const key = product.brand_slug || BRANDLESS_SLUG;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [branchProducts, serverBrandOptions]);

  const availableBrandSlugs = useMemo(() => {
    if (serverBrandOptions.length) return new Set(serverBrandOptions.map((item) => item.slug));
    const slugs = new Set<string>();
    for (const product of branchProducts) slugs.add(product.brand_slug || BRANDLESS_SLUG);
    return slugs;
  }, [branchProducts, serverBrandOptions]);

  const orderedBrands = useMemo(() => {
    const configured = rootBrandOrder
      .map((name) => brandsByName.get(name))
      .filter(Boolean)
      .map((brand) => ({ ...brand, productsCount: productBrandCounts.get(brand.slug) || 0 }));

    const extras = Array.from(availableBrandSlugs)
      .filter((brandSlug) => !configured.some((item) => item.slug === brandSlug))
      .map((brandSlug) => brandsBySlug.get(brandSlug))
      .filter(Boolean)
      .map((brand) => ({ ...brand, productsCount: productBrandCounts.get(brand.slug) || 0 }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, 'ru'));

    const merged = [...configured, ...extras];
    const deduped = merged.filter((brand, index, arr) => arr.findIndex((item) => item.slug === brand.slug) === index);
    return deduped.filter((brand) => currentSlug === rootSlug || brand.productsCount > 0);
  }, [availableBrandSlugs, brandsByName, brandsBySlug, currentSlug, productBrandCounts, rootBrandOrder, rootSlug]);

  const visibleChildren = useMemo(() => {
    if (currentSwitchSeriesLanding || isSwitchesRootLanding) return [];
    if (currentDepth >= 2) return [];
    if (!currentChildren.length) return [];
    return currentChildren;
  }, [currentChildren, currentDepth, currentSwitchSeriesLanding, isSwitchesRootLanding]);

  const visibleChildrenWithCounts = useMemo(() => visibleChildren.map((child: any) => {
    const fallbackProductsCount = products.filter((product: any) => (
      getProductCategoryIds(product).some((categoryId) => isDescendantCategory(categoryId, child.id, parentById))
    )).length;
    const directChildren = allCategories.filter((item: any) => Number(item.parent_id) === child.id && Number(item.is_active ?? 1) !== 0 && Number(item.is_public ?? 1) !== 0);
    const fallbackChildrenCount = directChildren.filter((directChild: any) => products.some((product: any) => (
      getProductCategoryIds(product).some((categoryId) => isDescendantCategory(categoryId, directChild.id, parentById))
    ))).length;
    const countFromApi = child.productsCount ?? child.products_count;
    // A pilot card advertises an API total, never a count from this page's subset.
    const productsCount = useVisualCompositions ? countFromApi : Number(countFromApi ?? fallbackProductsCount);
    const childrenCount = Number(child.childrenCount ?? child.children_count ?? fallbackChildrenCount);
    return { ...child, productsCount, childrenCount };
  }), [allCategories, parentById, products, visibleChildren, useVisualCompositions]);

  const descendantCategoryFilters = useMemo(() => {
    if (!currentCategory) return [];
    const allowCategoryFilters = currentDepth >= 2 || currentSwitchSeriesLanding;
    if (!allowCategoryFilters) return [];
    const descendants: any[] = serverFilterCategories.length
      ? serverFilterCategories
      : allCategories.filter((item: any) => item.id !== currentCategory.id && isDescendantCategory(item.id, currentCategory.id, parentById));
    const relevant = serverFilterCategories.length
      ? descendants
      : descendants.filter((item: any) => products.some((product: any) => {
        return getProductCategoryIds(product).some((categoryId) => isDescendantCategory(categoryId, item.id, parentById));
      }));
    const seen = new Set<string>();
    return relevant
      .map((item: any) => {
        const trail: string[] = [];
        let current: any = item;
        while (current && current.id !== currentCategory.id) {
          trail.unshift(getCategoryTitle(current));
          current = current.parent_id ? allCategories.find((candidate) => candidate.id === current.parent_id) : null;
        }
        return {
          slug: item.slug,
          label: trail.join(' > ') || getCategoryTitle(item),
        };
      })
      .filter((item: { slug: string; label: string }) => {
        if (!item.slug || seen.has(item.slug)) return false;
        seen.add(item.slug);
        return true;
      })
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'ru'));
  }, [allCategories, currentCategory, currentDepth, currentSwitchSeriesLanding, parentById, products, serverFilterCategories]);

  const searchableChildren = useMemo(() => {
    const items = searchQuery
      ? visibleChildrenWithCounts.filter((child: any) => buildSearchMatch(searchQuery, [getCategoryTitle(child), child.name_en || '', getCategoryDescription(child)]))
      : visibleChildrenWithCounts;

    return [...items].sort((a, b) => {
      const aName = getCategoryTitle(a);
      const bName = getCategoryTitle(b);
      const aToEnd = aName === 'Монтажные коробки';
      const bToEnd = bName === 'Монтажные коробки';
      if (aToEnd && !bToEnd) return 1;
      if (!aToEnd && bToEnd) return -1;
      const aSort = Number(a.sort_order ?? a.sortOrder ?? 0);
      const bSort = Number(b.sort_order ?? b.sortOrder ?? 0);
      if (Number.isFinite(aSort) && Number.isFinite(bSort) && aSort !== bSort) return aSort - bSort;
      return aName.localeCompare(bName, 'ru');
    });
  }, [searchQuery, visibleChildrenWithCounts]);

  const brandFirstHere = useMemo(() => {
    if (isSwitchesRoot && currentSlug === rootSlug) return false;
    if (currentSlug === rootSlug && rootBrandFirst.has(rootSlug)) return true;
    return branchBrandFirst.has(currentSlug);
  }, [currentSlug, isSwitchesRoot, rootSlug]);

  const serverSeriesOptions = useMemo(() => {
    const options = Array.isArray(technicalFiltersMetadata?.seriesId) ? technicalFiltersMetadata.seriesId : [];
    return options
      .map((item: any) => {
        const name = String(item.label || item.name || '').trim();
        const id = Number(item.value || 0);
        return { name, slug: item.slug || getSeriesSlug(name), image: '', count: Number(item.count || 0), ids: new Set<number>(id ? [id] : []) };
      })
      .filter((item: any) => item.name && item.slug && item.count > 0);
  }, [technicalFiltersMetadata]);

  const seriesOptions = useMemo(() => {
    if (serverSeriesOptions.length) return serverSeriesOptions;
    const map = new Map<string, { name: string; slug: string; image: string; count: number; ids: Set<number> }>();
    for (const product of products) {
      const name = getDisplaySeriesName(product).trim();
      if (!name) continue;
      const slugValue = getSeriesSlug(name);
      const prev = map.get(slugValue);
      if (prev) {
        prev.count += 1;
        if (product.series_id) prev.ids.add(product.series_id);
      } else {
        map.set(slugValue, { name, slug: slugValue, image: product.cover_image || '', count: 1, ids: new Set(product.series_id ? [product.series_id] : []) });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const seriesToEnd = ['Специальные предложения', 'Удлинители и многорозеточные блоки'];
      const aToEnd = seriesToEnd.includes(a.name);
      const bToEnd = seriesToEnd.includes(b.name);
      if (aToEnd && !bToEnd) return 1;
      if (!aToEnd && bToEnd) return -1;
      if (aToEnd && bToEnd) return seriesToEnd.indexOf(a.name) - seriesToEnd.indexOf(b.name);
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [products, serverSeriesOptions]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (searchQuery) {
      list = list.filter((product: any) => buildSearchMatch(searchQuery, [product.name_ru, product.sku, product.brand_name || '', product.category_name || '', getDisplaySeriesName(product), product.short_description_ru || '']));
    }
    if (selectedColor) {
      list = list.filter((product: any) => getSeriesSlug(extractProductColorLabel(product)) === selectedColor);
    }
    return list;
  }, [products, searchQuery, selectedColor]);
  const fallbackTotalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const productPagination = pagination ? {
    page: Number(pagination.page || 1),
    limit: Number(pagination.limit || PRODUCT_PAGE_SIZE),
    total: Number(pagination.total || 0),
    totalPages: Number(pagination.totalPages || 1),
    hasPrevPage: Boolean(pagination.hasPrevPage),
    hasNextPage: Boolean(pagination.hasNextPage),
  } : {
    page: Math.min(currentPage, fallbackTotalPages),
    limit: PRODUCT_PAGE_SIZE,
    total: filteredProducts.length,
    totalPages: fallbackTotalPages,
    hasPrevPage: currentPage > 1,
    hasNextPage: currentPage < fallbackTotalPages,
  };
  const safeProductPage = productPagination.page;
  const visibleProducts = useMemo(() => {
    if (pagination) return filteredProducts;
    const start = (safeProductPage - 1) * PRODUCT_PAGE_SIZE;
    return filteredProducts.slice(start, start + PRODUCT_PAGE_SIZE);
  }, [filteredProducts, pagination, safeProductPage]);

  const breadcrumbs = useMemo(() => {
    const items: { label: string; to?: string }[] = [
      { label: t('navigation.breadcrumbs.home'), to: '/' },
      { label: t('navigation.breadcrumbs.catalog'), to: '/catalog' },
    ];
    // Russian keeps the canonical navigation labels; other languages use the category's own translation (RU fallback).
    const rootCategory = categoriesBySlug.get(rootSlug);
    const rootLabel = language !== 'ru' && rootCategory ? getCategoryTitle(rootCategory, language) : rootCard?.title || displayName(rootSlug, rootSlug);
    const rootTo = rootCard?.to || hrefForSlug(rootSlug);
    if (rootSlug) items.push({ label: rootLabel, to: rootTo });
    nestedSlugs.forEach((nestedSlug, index) => {
      const category = categoriesBySlug.get(nestedSlug);
      const fallbackTitle = category ? getCategoryTitle(category) : nestedSlug;
      const label = language !== 'ru' ? fallbackTitle : displayName(nestedSlug, fallbackTitle);
      items.push({ label, to: `/catalog/${nestedSlug}` });
    });
    if (selectedBrand) {
      const brand = brandsBySlug.get(selectedBrand);
      if (brand) items.push({ label: brand.name });
    }
    if (selectedSeries) {
      const series = seriesOptions.find((item) => item.slug === selectedSeries);
      if (series) items.push({ label: series.name });
    }
    return items;
  }, [brandsBySlug, categoriesBySlug, displayName, hrefForSlug, language, nestedSlugs, rootCard, rootSlug, selectedBrand, selectedSeries, seriesOptions, t]);

  const buildSearch = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    if (!Object.prototype.hasOwnProperty.call(updates, 'page')) next.delete('page');
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    const queryString = next.toString();
    return queryString ? `?${queryString}` : '';
  };

  const back = () => {
    if (selectedSeries) {
      navigate(`${location.pathname}${buildSearch({ series: null })}`);
      return;
    }
    if (selectedBrand && brandFirstHere) {
      navigate(`${location.pathname}${buildSearch({ brand: null })}`);
      return;
    }
    if (nestedSlugs.length) {
      const nextPath = nestedSlugs.length === 1 ? `/catalog/${rootSlug}` : `/catalog/${rootSlug}/${nestedSlugs.slice(0, -1).join('/')}`;
      navigate(`${nextPath}${buildSearch({ category: null, series: null, q: null })}`);
      return;
    }
    if (selectedBrand || searchQuery || selectedCategoryFilter || selectedColor) {
      navigate(`${location.pathname}${buildSearch({ brand: null, q: null, series: null, category: null, color: null })}`);
      return;
    }
    navigate('/catalog');
  };

  const showSwitchSeriesShowcase = false;
  const showBrandCards = !showSwitchSeriesShowcase && !selectedBrand && brandFirstHere && orderedBrands.length > 1;

  const mergedSwitchSeriesOptions = useMemo(() => {
    if (!switchSeriesLanding) return seriesOptions;

    const merged: Array<{ name: string; slug: string; image: string; count: number; ids: Set<number> }> = [];
    const seen = new Set<string>();

    const getStableKey = (item: { name: string; slug: string; ids?: Set<number> }) => {
      const ids = item.ids ? Array.from(item.ids).filter(Boolean).sort((a, b) => a - b) : [];
      if (ids.length) return `id:${ids.join(',')}`;
      if (item.slug) return `slug:${item.slug}`;
      return `name:${getSeriesSlug(String(item.name || '').toLocaleLowerCase('ru'))}`;
    };

    const getRepresentativeSeriesImage = (ids?: Set<number>) => {
      if (!ids?.size) return '';
      const product = products.find((item: any) => item.cover_image && item.series_id && ids.has(Number(item.series_id)));
      return product?.cover_image || '';
    };

    for (const curated of switchSeriesCards) {
      const normalizedName = String(curated.displayTitle || curated.name_ru || '').trim();
      if (!normalizedName) continue;
      const normalizedSlug = getSeriesSlug(normalizedName);
      const fromSeriesOptions = seriesOptions.find((series) => series.slug === normalizedSlug || series.name === normalizedName) || null;
      const curatedIds = fromSeriesOptions?.ids && fromSeriesOptions.ids.size
        ? new Set(fromSeriesOptions.ids)
        : new Set<number>();
      const item = {
        name: normalizedName,
        slug: fromSeriesOptions?.slug || normalizedSlug,
        image: getSeriesCoverImage(normalizedName) || fromSeriesOptions?.image || getRepresentativeSeriesImage(curatedIds) || curated.image_url || '',
        count: Number(fromSeriesOptions?.count || curated.productsCount || 0),
        ids: curatedIds,
      };
      if (!item.slug || item.count <= 0) continue;
      const key = getStableKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }

    for (const series of seriesOptions) {
      if (!series.slug || Number(series.count || 0) <= 0) continue;
      const key = getStableKey(series);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...series, image: getSeriesCoverImage(series.name) || series.image || getRepresentativeSeriesImage(series.ids) });
    }

    return merged;
  }, [products, seriesOptions, switchSeriesCards, switchSeriesLanding]);

  const isRootSwitchModelSeries = (item: { name: string }) => {
    const name = String(item.name || '').trim().toLocaleLowerCase('ru');
    if (!name) return false;

    const noiseNames = new Set([
      'action',
      'главная',
      'разное',
      'электроустановочные изделия',
      'электротехнические изделия',
      'специальные предложения',
    ]);
    if (noiseNames.has(name)) return false;

    const functionalPrefixes = [
      'рамки',
      'механизмы',
      'лицевые панели',
      'универсальные суппорты',
      'удлинители',
    ];
    if (functionalPrefixes.some((prefix) => name.startsWith(prefix))) return false;
    if (name.includes('общие механизмы и аксессуары')) return false;

    const finishSuffixes = [
      'белый',
      'слоновая кость',
      'графит',
      'титан',
      'алюминий',
      'антрацит',
      'серый',
      'черный',
      'чёрный',
    ];
    if (finishSuffixes.some((suffix) => name.endsWith(` ${suffix}`))) return false;

    return true;
  };

  const rootSwitchSeriesCards = useMemo(() => {
    if (!switchSeriesLanding) return mergedSwitchSeriesOptions;
    return mergedSwitchSeriesOptions.filter(isRootSwitchModelSeries);
  }, [mergedSwitchSeriesOptions, switchSeriesLanding]);

  const visibleRootSwitchSeriesCards = useMemo(() => (
    rootSwitchSeriesCards.filter((series) => !searchQuery || buildSearchMatch(searchQuery, [series.name]))
  ), [rootSwitchSeriesCards, searchQuery]);

  const mechanismsRootSeriesCards = useMemo(() => {
    if (!isMechanismsRootLanding) return [];

    const mechanismNoise = new Set([
      'главная',
      'разное',
      'прочие',
      'специальные предложения',
      'электроустановочные изделия',
      'электротехнические изделия',
    ]);
    const mechanismPrefixes = [
      'рамки',
      'механизмы',
      'лицевые панели',
      'универсальные суппорты',
      'удлинители',
      'монтажные коробки',
      'аксессуары',
      'общие механизмы',
    ];
    const finishSuffixes = ['белый', 'слоновая кость', 'графит', 'титан', 'алюминий', 'антрацит', 'серый', 'черный', 'чёрный'];
    const visibleNames = new Set([
      'legrand серия arteor',
      'arteor',
      'legrand серия valena allure',
      'valena allure',
      'legrand серия valena life',
      'valena life',
      'legrand серия suno',
      'suno',
      'legrand серия niloe step',
      'niloe step',
      'legrand серия mosaic',
      'mosaic',
      'legrand серия mallia senses',
      'mallia senses',
      'legrand серия niloe',
      'niloe',
      'legrand серия inspiria',
      'inspiria',
      'legrand серия celiane',
      'celiane',
      'legrand серия quteo/forix',
      'quteo/forix',
      'legrand серия plexo ip 55/ ip 66',
      'plexo ip 55/ ip 66',
      'legrand серия cariva',
      'cariva',
      'legrand серия valena classic',
      'valena classic',
    ]);

    return visibleRootSwitchSeriesCards.filter((series) => {
      const normalized = String(series.name || '').trim().toLocaleLowerCase('ru');
      if (!normalized) return false;
      if (mechanismNoise.has(normalized)) return false;
      if (mechanismPrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
      if (finishSuffixes.some((suffix) => normalized.endsWith(` ${suffix}`))) return false;
      return visibleNames.has(normalized) || series.count > 0;
    });
  }, [isMechanismsRootLanding, visibleRootSwitchSeriesCards]);

  const mechanismsLandingCards = useMemo(() => {
    if (!isMechanismsRootLanding) return visibleRootSwitchSeriesCards;
    return mechanismsRootSeriesCards.length ? mechanismsRootSeriesCards : visibleRootSwitchSeriesCards;
  }, [isMechanismsRootLanding, mechanismsRootSeriesCards, visibleRootSwitchSeriesCards]);

  // Series-card landing must stay explicit: do not use "series count > 1" as a generic
  // fallback for leaf/product-type categories. Leaves keep products first and expose series
  // through filters/metadata instead of primary landing cards.
  const allowSeriesCardLanding = switchSeriesLanding || isMechanismsRootLanding;
  const showSeriesCards = allowSeriesCardLanding && !currentSwitchSeriesLanding && !showBrandCards && !visibleChildren.length && !selectedSeries && visibleRootSwitchSeriesCards.length > 1;
  const isProductSelectionView = currentSwitchSeriesLanding || isMechanismsRootLanding || (!showBrandCards && !searchableChildren.length && !showSeriesCards && !showSwitchSeriesShowcase);
  const stageLabel = showSwitchSeriesShowcase
    ? t('catalog.category.sections.subcategories')
    : showBrandCards
      ? t('catalog.category.sections.brands')
      : visibleChildren.length
        ? t('catalog.category.sections.subcategories')
        : showSeriesCards
          ? t('catalog.category.sections.series')
          : t('catalog.category.sections.products');

  const switchesRootChildren = useMemo(() => {
    const rootCategory = categoriesBySlug.get(rootSlug);
    if (!rootCategory) return [];
    return allCategories.filter((item) => Number(item.parent_id) === rootCategory.id);
  }, [allCategories, categoriesBySlug, rootSlug]);

  const currentSwitchesTopCategoryId = useMemo(() => {
    if (rootSlug !== 'rozetki-i-vyklyuchateli' || !currentCategory) return null;
    if (currentCategory.slug === rootSlug) return currentCategory.id;

    let currentId: number | null | undefined = currentCategory.id;
    while (currentId) {
      const parentId = parentById.get(currentId) ?? null;
      if (!parentId) return currentId;
      const parent = allCategories.find((item) => item.id === parentId);
      if (parent?.slug === rootSlug) return currentId;
      currentId = parentId;
    }
    return null;
  }, [allCategories, currentCategory, parentById, rootSlug]);

  const relatedSwitchesLinks = useMemo(() => {
    if (rootSlug !== 'rozetki-i-vyklyuchateli' || !selectedSeries || !relatedSeriesData?.products?.length) return [];

    const rootCategory = categoriesBySlug.get(rootSlug);
    if (!rootCategory) return [];

    const counts = new Map<number, number>();
    for (const product of relatedSeriesData.products) {
      let currentId: number | null | undefined = product.category_id;
      while (currentId) {
        const parentId = parentById.get(currentId) ?? null;
        if (parentId === rootCategory.id) {
          counts.set(currentId, (counts.get(currentId) || 0) + 1);
          break;
        }
        currentId = parentId;
      }
    }

    return switchesRootChildren
      .map((category) => ({
        ...category,
        count: counts.get(category.id) || 0,
      }))
      .filter((category) => category.count > 0 && category.id !== currentSwitchesTopCategoryId)
      .sort((a, b) => b.count - a.count || getCategoryTitle(a).localeCompare(getCategoryTitle(b), 'ru'));
  }, [categoriesBySlug, currentSwitchesTopCategoryId, parentById, relatedSeriesData, rootSlug, selectedSeries, switchesRootChildren]);

  const childCategoryPins = useMemo(() => pinnedItems
    .filter((item) => item.type === 'subcategory' && item.contextId === currentCategory?.slug && item.contextType === 'category')
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)), [currentCategory?.slug, pinnedItems]);

  const seriesPins = useMemo(() => pinnedItems
    .filter((item) => item.type === 'series' && item.contextId === seriesContext.contextId && item.contextType === seriesContext.contextType)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)), [pinnedItems, seriesContext.contextId, seriesContext.contextType]);

  const brandPins = useMemo(() => pinnedItems
    .filter((item) => item.type === 'brand' && item.contextId === brandContext.contextId && item.contextType === brandContext.contextType)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)), [brandContext.contextId, brandContext.contextType, pinnedItems]);

  const productPins = useMemo(() => pinnedItems
    .filter((item) => item.type === 'product' && item.contextId === productContext.contextId && item.contextType === productContext.contextType)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)), [pinnedItems, productContext.contextId, productContext.contextType]);

  const currentCategoryPin = useMemo(() => pinnedItems.find((item) => (
    item.id === currentCategory?.slug
    && item.type === categoryContext.type
    && item.contextId === categoryContext.contextId
    && item.contextType === categoryContext.contextType
  )), [categoryContext.contextId, categoryContext.contextType, categoryContext.type, currentCategory?.slug, pinnedItems]);

  const pinned = Boolean(currentCategoryPin);

  if (branchLoading && !branchData) return <div className="page">{t('catalog.category.states.loading')}</div>;

  if (branchError && !branchData) {
    return (
      <div className="page space-y-4">
        <div className="panel p-5 text-slate-200" role="alert">
          <div className="text-lg font-semibold text-white">{t('catalog.category.errors.title')}</div>
          <div className="mt-2 text-sm text-slate-400">
            {branchError.startsWith('catalog.') ? t(branchError) : branchError}
          </div>
          <button
            className="btn-primary mt-4"
            onClick={() => window.location.reload()}
          >
            {t('catalog.category.errors.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!currentCategory || !branchData) return <div className="page">{t('catalog.category.states.loading')}</div>;

  return (
    <div className="page space-y-4">
      <div className="category-mobile-heading">
        <h1 className="mobile-page-title">{currentTitle}</h1>
      </div>
      <div className="category-mobile-actions">
        <button className="circle-icon-btn category-mobile-actions__back" onClick={back} aria-label={t('catalog.category.actions.back')} title={t('catalog.category.actions.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          className="btn-secondary category-action-btn"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
          aria-controls="catalog-category-filters"
        >
          <span>{t('catalog.category.actions.filters')}</span>
          <Filter className="ml-2 h-5 w-5" />
        </button>
        <Link to="/compare" className="btn-secondary category-action-btn">
          <Compare className="h-5 w-5" />
          <span className="ml-2">{t('catalog.category.actions.compare')}{compare.length ? ` (${compare.length})` : ''}</span>
        </Link>
        <button
          className={`circle-icon-btn category-pin-floating ${pinned ? 'bg-primary text-white' : ''}`}
          onClick={() => currentCategory && togglePinnedItem({
            id: currentCategory.slug,
            type: categoryContext.type,
            title: getCategoryTitle(currentCategory),
            imageUrl: currentCategory.image_url,
            url: categoryContext.url,
            contextId: categoryContext.contextId,
            contextType: categoryContext.contextType,
            subtitle: getCategoryDescription(currentCategory),
          })}
          aria-label={pinned ? t('catalog.shared.pin.unpinCategory') : t('catalog.shared.pin.pinCategory')}
          title={pinned ? t('catalog.shared.pin.unpin') : t('catalog.shared.pin.pin')}
        >
          <Pin className="h-5 w-5" />
        </button>
      </div>

      <div className="hidden md:block space-y-3">
        <Breadcrumbs items={breadcrumbs} />
        {!isProductSelectionView ? <div className="text-sm text-slate-500">{getCategoryDescription(currentCategory) || (language === 'ru' ? t('catalog.category.descriptionFallback') : t('catalog.category.descriptionForCategory', { title: currentTitle }))}</div> : null}
      </div>

      {currentCategory.slug === rootSlug && rootCard?.imageUrl ? (
        <section className="category-root-hero" aria-label={t('catalog.category.imageAria', { title: currentTitle })}>
          <img src={rootCard.imageUrl} alt="" className="category-root-hero__image" />
        </section>
      ) : null}

      {isProductSelectionView ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">{t('catalog.shared.counts.products', { count: productPagination.total })}</div>
          <ViewModeToggle value={productView} onChange={setProductView} />
        </div>
      ) : null}

      {showFilters ? (
        <div id="catalog-category-filters" className="panel space-y-4 p-4" aria-label={t('catalog.category.filters.panelAria')}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {descendantCategoryFilters.length ? (
              <select className="field" aria-label={t('catalog.category.filters.categoryAria')} value={selectedCategoryFilter} onChange={(e) => setParams(new URLSearchParams(buildSearch({ category: e.target.value || null }).replace(/^\?/, '')))}>
                <option value="">{t('catalog.category.filters.allSubcategories')}</option>
                {descendantCategoryFilters.map((item) => (
                  <option key={item.slug} value={item.slug}>{item.label}</option>
                ))}
              </select>
            ) : null}
            <select className="field" aria-label={t('catalog.category.filters.brandAria')} value={selectedBrand} onChange={(e) => setParams(new URLSearchParams(buildSearch({ brand: e.target.value || null, series: null }).replace(/^\?/, '')))}>
              <option value="">{t('catalog.category.filters.allBrands')}</option>
              {orderedBrands.map((brand: any) => (
                <option key={brand.slug} value={brand.slug}>{brand.name}</option>
              ))}
            </select>
            
            {/* Technical Filters */}
            {technicalFiltersMetadata && Object.entries(technicalFiltersMetadata).map(([key, options]) => {
              if (['brandId', 'seriesId', 'extra_module_count', 'height_mm', 'width_mm', 'depth_mm'].includes(key)) return null;
              if (!options || options.length === 0) return null;
              const labelKey = TECH_FILTER_LABEL_KEYS[key];
              const label = labelKey ? t(labelKey) : key;
              return (
                <select 
                  key={key} 
                  className="field"
                  aria-label={label}
                  value={params.get(key) || ''} 
                  onChange={(e) => setParams(new URLSearchParams(buildSearch({ [key]: e.target.value || null }).replace(/^\?/, '')))}
                >
                  <option value="">{t('catalog.category.filters.allOption', { label })}</option>
                  {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {formatTechValue(key, opt.value, opt.unit, t)} ({opt.count})
                    </option>
                  ))}
                </select>
              );
            })}

            <select className="field" aria-label={t('catalog.category.filters.saleModeAria')} value={saleMode} onChange={(e) => setParams(new URLSearchParams(buildSearch({ saleMode: e.target.value || null }).replace(/^\?/, '')))}>
              <option value="">{t('catalog.category.filters.saleMode.any')}</option>
              <option value="buy_now">{t('catalog.category.filters.saleMode.buyNow')}</option>
              <option value="price_request">{t('catalog.category.filters.saleMode.priceRequest')}</option>
              <option value="preorder">{t('catalog.category.filters.saleMode.preorder')}</option>
              <option value="price_eta_request">{t('catalog.category.filters.saleMode.priceEtaRequest')}</option>
            </select>
            <select className="field" aria-label={t('catalog.category.filters.stockAria')} value={inStock} onChange={(e) => setParams(new URLSearchParams(buildSearch({ inStock: e.target.value || null }).replace(/^\?/, '')))}>
              <option value="">{t('catalog.category.filters.stock.any')}</option>
              <option value="true">{t('catalog.category.filters.stock.inStock')}</option>
            </select>
            <select className="field" aria-label={t('catalog.category.filters.documentsAria')} value={hasDocs} onChange={(e) => setParams(new URLSearchParams(buildSearch({ hasDocs: e.target.value || null }).replace(/^\?/, '')))}>
              <option value="">{t('catalog.category.filters.documents.any')}</option>
              <option value="true">{t('catalog.category.filters.documents.withDocuments')}</option>
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input className="field" placeholder={t('catalog.category.filters.priceFrom')} aria-label={t('catalog.category.filters.priceFrom')} value={minPrice} onChange={(e) => setParams(new URLSearchParams(buildSearch({ minPrice: e.target.value || null }).replace(/^\?/, '')))} />
              <input className="field" placeholder={t('catalog.category.filters.priceTo')} aria-label={t('catalog.category.filters.priceTo')} value={maxPrice} onChange={(e) => setParams(new URLSearchParams(buildSearch({ maxPrice: e.target.value || null }).replace(/^\?/, '')))} />
            </div>
            <button
              className="btn-secondary"
              onClick={() => {
                const next = new URLSearchParams();
                if (searchQuery) next.set('q', searchQuery);
                setParams(next);
              }}
            >
              {t('catalog.category.filters.reset')}
            </button>
          </div>
        </div>
      ) : null}

      {relatedSwitchesLinks.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">{t('catalog.category.related.title')}</h2>
            <p className="mt-1 text-sm text-slate-400">{t('catalog.category.related.description')}</p>
          </div>
          <div className="catalog-list catalog-list--vertical">
            {relatedSwitchesLinks.map((category: any) => (
              <Link
                key={category.id}
                to={`/catalog/${rootSlug}/${category.slug}${buildSearch({ category: null, brand: selectedBrand || null, series: selectedSeries, q: null })}`}
                className="catalog-list-card catalog-list-card--copy-fluid group"
              >
                <div className="catalog-list-card__thumb flex items-center justify-center bg-white text-center p-3 text-sm font-semibold text-slate-700">
                  {getCategoryTitle(category).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="catalog-list-card__title">{getCategoryTitle(category)}</div>
                  <div className="catalog-list-card__subtitle">{t('catalog.category.related.products', { count: category.count })}</div>
                </div>
                <div className="catalog-list-card__arrow">
                  <ChevronRight className="h-6 w-6" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        {!isProductSelectionView ? (
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{stageLabel}</h2>
            {!showBrandCards && !showSwitchSeriesShowcase && !visibleChildren.length ? <div className="text-sm text-slate-500">{t('catalog.category.counts.found', { count: showSeriesCards ? visibleRootSwitchSeriesCards.length : filteredProducts.length })}</div> : null}
          </div>
        ) : null}

        {showSwitchSeriesShowcase ? (
          <div className="switch-series-grid">
            {switchSeriesCards
              .filter((card: any) => !searchQuery || buildSearchMatch(searchQuery, [card.displayTitle, card.name_ru || '']))
              .map((card: any) => (
                <Link
                  key={card.slug}
                  to={`/catalog/${rootSlug}/${card.slug}`}
                  className="switch-series-card group"
                >
                  <div className="switch-series-card__thumb">
                    <ManagedImage
                      src={card.image_url}
                      thumb
                      alt={card.displayTitle}
                      placeholderTitle={card.displayTitle}
                      className="switch-series-card__image"
                    />
                  </div>
                  <div className="switch-series-card__title">{card.displayTitle}</div>
                </Link>
              ))}
          </div>
        ) : null}

        {showBrandCards ? (
          <PinnedCollection
            items={orderedBrands.filter((brand: any) => !searchQuery || buildSearchMatch(searchQuery, [brand.name]))}
            pinnedIds={brandPins.map((item) => item.id)}
            getId={(brand: any) => brand.slug}
            onReorder={(orderedIds) => reorderPinnedItems({ type: 'brand', contextId: brandContext.contextId, contextType: brandContext.contextType, orderedIds })}
            listClassName="catalog-list catalog-list--vertical"
            pinnedTitle={pinnedLabel}
            allTitle={allLabel}
            renderItem={(brand: any, meta) => (
              <BrandCard
                key={brand.slug}
                brand={brand}
                to={`${location.pathname}${buildSearch({ brand: brand.slug, series: null })}`}
                pinned={meta.isPinned}
                dragHandle={meta.dragHandle}
                onTogglePin={() => togglePinnedItem({
                  id: brand.slug,
                  type: 'brand',
                  title: brand.name,
                  imageUrl: brand.logo_url,
                  url: `${location.pathname}${buildSearch({ brand: brand.slug, series: null })}`,
                  contextId: brandContext.contextId,
                  contextType: brandContext.contextType,
                  subtitle: brand.productsCount
                    ? t('catalog.category.cards.brandProducts', { count: brand.productsCount })
                    : t('catalog.category.cards.brandConnected'),
                })}
              />
            )}
          />
        ) : null}

        {/* The pilot changes presentation only; the original pin/order pipeline remains shared. */}
        {!showSwitchSeriesShowcase && !showBrandCards && searchableChildren.length ? (
          <PinnedCollection
            items={searchableChildren}
            pinnedIds={childCategoryPins.map((item) => item.id)}
            getId={(child: any) => child.slug}
            onReorder={(orderedIds) => reorderPinnedItems({ type: 'subcategory', contextId: currentCategory.slug, contextType: 'category', orderedIds })}
            listClassName={useVisualCompositions ? 'category-composition-grid' : 'catalog-list catalog-list--vertical'}
            pinnedTitle={pinnedLabel}
            allTitle={allLabel}
            renderItem={(child: any, meta) => useVisualCompositions && getCategoryComposition(child.slug) ? (
              <CategoryCompositionCard
                key={child.id}
                category={child}
                composition={getCategoryComposition(child.slug)!}
                to={`/catalog/${rootSlug}/${[...nestedSlugs, child.slug].join('/')}${buildSearch({ category: null, series: null })}`}
                pinned={meta.isPinned}
                dragHandle={meta.dragHandle}
                pinLabel={meta.isPinned ? t('catalog.shared.pin.unpinSubcategory') : t('catalog.shared.pin.pinSubcategory')}
                onTogglePin={() => togglePinnedItem({
                  id: child.slug,
                  type: 'subcategory',
                  title: getCategoryTitle(child),
                  imageUrl: child.image_url,
                  url: `/catalog/${rootSlug}/${[...nestedSlugs, child.slug].join('/')}${buildSearch({ category: null, series: null })}`,
                  contextId: currentCategory.slug,
                  contextType: 'category',
                  subtitle: getCategoryDescription(child),
                })}
              />
            ) : (
              <CategoryCard
                key={child.id}
                category={child}
                to={`/catalog/${rootSlug}/${[...nestedSlugs, child.slug].join('/')}${buildSearch({ category: null, series: null })}`}
                pinned={meta.isPinned}
                dragHandle={meta.dragHandle}
                pinLabel={meta.isPinned ? t('catalog.shared.pin.unpinSubcategory') : t('catalog.shared.pin.pinSubcategory')}
                onTogglePin={() => togglePinnedItem({
                  id: child.slug,
                  type: 'subcategory',
                  title: getCategoryTitle(child),
                  imageUrl: child.image_url,
                  url: `/catalog/${rootSlug}/${[...nestedSlugs, child.slug].join('/')}${buildSearch({ category: null, series: null })}`,
                  contextId: currentCategory.slug,
                  contextType: 'category',
                  subtitle: getCategoryDescription(child),
                })}
              />
            )}
          />
        ) : null}

        {!showSwitchSeriesShowcase && !showBrandCards && !searchableChildren.length && (showSeriesCards || isMechanismsRootLanding) ? (
          <PinnedCollection
            items={isMechanismsRootLanding ? mechanismsLandingCards : visibleRootSwitchSeriesCards}
            pinnedIds={seriesPins.map((item) => item.id)}
            getId={(series) => series.slug}
            onReorder={(orderedIds) => reorderPinnedItems({ type: 'series', contextId: seriesContext.contextId, contextType: seriesContext.contextType, orderedIds })}
            listClassName="catalog-list catalog-list--vertical catalog-list--series-root"
            pinnedTitle={pinnedLabel}
            allTitle={allLabel}
            renderItem={(series, meta) => (
              <SeriesCard
                key={series.slug}
                title={series.name}
                subtitle={t('catalog.shared.counts.products', { count: series.count })}
                imageUrl={series.image}
                to={`${location.pathname}${buildSearch({ series: series.slug, seriesId: Array.from(series.ids).join(',') })}`}
                pinned={meta.isPinned}
                dragHandle={meta.dragHandle}
                onTogglePin={() => togglePinnedItem({
                  id: series.slug,
                  type: 'series',
                  title: series.name,
                  imageUrl: series.image,
                  url: `${location.pathname}${buildSearch({ series: series.slug, seriesId: Array.from(series.ids).join(',') })}`,
                  contextId: seriesContext.contextId,
                  contextType: seriesContext.contextType,
                  subtitle: t('catalog.shared.counts.products', { count: series.count }),
                })}
              />
            )}

          />
        ) : null}

        {!showSwitchSeriesShowcase && !showBrandCards && !showSeriesCards ? (
          branchLoading && !filteredProducts.length ? (
            <div className="panel p-5 text-slate-300">{t('catalog.category.states.productsLoading')}</div>
          ) : filteredProducts.length ? (
            <>
              {!isProductSelectionView ? (
                <div className="mt-6 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{t('catalog.category.sections.products')}</h2>
                    <div className="mt-1 text-sm text-slate-500">{t('catalog.category.counts.found', { count: productPagination.total })}</div>
                  </div>
                  <ViewModeToggle value={productView} onChange={setProductView} />
                </div>
              ) : null}
              {branchLoading ? <div className="panel p-3 text-sm text-slate-400">{t('catalog.category.states.productsRefreshing')}</div> : null}
              <PinnedCollection
                items={visibleProducts}
                pinnedIds={productPins.map((item) => item.id)}
                getId={(product: any) => String(product.id)}
                onReorder={(orderedIds) => reorderPinnedItems({ type: 'product', contextId: productContext.contextId, contextType: productContext.contextType, orderedIds })}
                listClassName={productView === 'grid' ? 'product-grid' : 'space-y-4'}
                pinnedTitle={pinnedLabel}
                allTitle={allLabel}
                renderItem={(product: any, meta) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    view={productView}
                    pinned={meta.isPinned}
                    dragHandle={meta.dragHandle}
                    onTogglePin={() => togglePinnedItem({
                      id: String(product.id),
                      type: 'product',
                      title: product.name_ru,
                      imageUrl: product.cover_image,
                      url: `/product/${product.slug}`,
                      contextId: productContext.contextId,
                      contextType: productContext.contextType,
                      subtitle: product.sku,
                    })}
                  />
                )}
              />
              {productPagination.totalPages > 1 ? (
                <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-300">
                  <div>
                    {t('catalog.category.pagination.summary', {
                      page: productPagination.page,
                      totalPages: productPagination.totalPages,
                      total: productPagination.total,
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary" disabled={!productPagination.hasPrevPage} onClick={() => setParams(new URLSearchParams(buildSearch({ page: String(Math.max(1, Number(productPagination.page) - 1)) }).replace(/^\?/, '')))}>
                      {t('catalog.category.pagination.previous')}
                    </button>
                    <button className="btn-secondary" disabled={!productPagination.hasNextPage} onClick={() => setParams(new URLSearchParams(buildSearch({ page: String(Number(productPagination.page) + 1) }).replace(/^\?/, '')))}>
                      {t('catalog.category.pagination.next')}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="panel p-5 text-slate-300">{t('catalog.category.states.noResults')}</div>
          )
        ) : null}
      </section>
    </div>
  );
}
