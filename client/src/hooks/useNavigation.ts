import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

export type NavigationNode = {
  node_key: string;
  sort_order: number;
  label_ru: string;
  label_en?: string;
  node_type?: string;
  href: string;
  id: number | string;
  slug: string;
  name_ru: string;
  name_en?: string;
  name_hy?: string;
  image_url?: string;
  primary_category_id?: number | null;
  member_category_ids?: number[];
  engineering_role_focus?: string;
  productsCount?: number;
  childrenCount?: number;
  children: NavigationNode[];
  description?: string;
};

export type NavigationPayload = {
  nav_contract_version: string;
  items: NavigationNode[];
  labels: Record<string, string>;
};

type NavigationState = {
  version: string;
  items: NavigationNode[];
  labels: Record<string, string>;
  loading: boolean;
  error: Error | null;
};

function normalizeNode(value: unknown): NavigationNode | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
  const nameRu = typeof item.name_ru === 'string'
    ? item.name_ru.trim()
    : typeof item.label_ru === 'string'
      ? item.label_ru.trim()
      : '';
  if (!nameRu) return null;

  const children = (Array.isArray(item.children) ? item.children : [])
    .map(normalizeNode)
    .filter((child): child is NavigationNode => Boolean(child));

  const href = typeof item.href === 'string' && item.href
    ? item.href
    : slug
      ? (slug.startsWith('__') ? (item.node_key === 'tools' ? '/tools' : '/catalog') : `/catalog/${slug}`)
      : '/catalog';

  return {
    node_key: typeof item.node_key === 'string' ? item.node_key : slug || nameRu,
    sort_order: typeof item.sort_order === 'number' ? item.sort_order : 0,
    label_ru: typeof item.label_ru === 'string' ? item.label_ru : nameRu,
    label_en: typeof item.label_en === 'string' ? item.label_en : undefined,
    node_type: typeof item.node_type === 'string' ? item.node_type : undefined,
    href,
    id: typeof item.id === 'number' || typeof item.id === 'string' ? item.id : slug || nameRu,
    slug: slug || `__${nameRu}__`,
    name_ru: nameRu,
    name_en: typeof item.name_en === 'string' ? item.name_en : undefined,
    name_hy: typeof item.name_hy === 'string' ? item.name_hy : undefined,
    image_url: typeof item.image_url === 'string' ? item.image_url : undefined,
    primary_category_id: typeof item.primary_category_id === 'number' ? item.primary_category_id : null,
    member_category_ids: Array.isArray(item.member_category_ids)
      ? item.member_category_ids.map(Number).filter((n) => Number.isFinite(n))
      : [],
    engineering_role_focus: typeof item.engineering_role_focus === 'string' ? item.engineering_role_focus : '',
    productsCount: typeof item.productsCount === 'number' ? item.productsCount : undefined,
    childrenCount: typeof item.childrenCount === 'number' ? item.childrenCount : children.length,
    children,
    description: typeof item.engineering_role_focus === 'string' ? item.engineering_role_focus : '',
  };
}

function normalizePayload(value: unknown): NavigationPayload {
  if (Array.isArray(value)) {
    return {
      nav_contract_version: 'legacy-array',
      items: value.map(normalizeNode).filter((item): item is NavigationNode => Boolean(item)),
      labels: {},
    };
  }
  if (!value || typeof value !== 'object') {
    return { nav_contract_version: '', items: [], labels: {} };
  }
  const raw = value as Record<string, unknown>;
  const itemsSource = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.categories) ? raw.categories : [];
  return {
    nav_contract_version: typeof raw.nav_contract_version === 'string' ? raw.nav_contract_version : '',
    items: itemsSource.map(normalizeNode).filter((item): item is NavigationNode => Boolean(item)),
    labels: raw.labels && typeof raw.labels === 'object' ? (raw.labels as Record<string, string>) : {},
  };
}

/** Single frontend consumer for the canonical navigation contract. */
export function useNavigation() {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<NavigationState>({
    version: '',
    items: [],
    labels: {},
    loading: true,
    error: null,
  });

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    api<unknown>('/navigation')
      .then((response) => {
        if (cancelled) return;
        const payload = normalizePayload(response);
        setState({
          version: payload.nav_contract_version,
          items: payload.items,
          labels: payload.labels,
          loading: false,
          error: null,
        });
      })
      .catch(async (error) => {
        // Fallback to /categories/menu which is also composed from the same contract.
        try {
          const menu = await api<unknown>('/categories/menu');
          if (cancelled) return;
          const payload = normalizePayload(menu);
          setState({
            version: payload.nav_contract_version || 'categories-menu',
            items: payload.items,
            labels: payload.labels,
            loading: false,
            error: null,
          });
        } catch {
          if (cancelled) return;
          setState({
            version: '',
            items: [],
            labels: {},
            loading: false,
            error: error instanceof Error ? error : new Error('Failed to load navigation'),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const topLevel = useMemo(
    () => state.items.slice().sort((a, b) => a.sort_order - b.sort_order),
    [state.items],
  );

  const displayName = useCallback((slugOrId?: string | number | null, fallback = '') => {
    if (slugOrId == null || slugOrId === '') return fallback;
    if (typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))) {
      return state.labels[`id:${slugOrId}`] || fallback;
    }
    return state.labels[`slug:${slugOrId}`] || fallback;
  }, [state.labels]);

  const hrefForSlug = useCallback((slug?: string | null) => {
    if (!slug) return '/catalog';
    const found = topLevel.find((item) => item.slug === slug);
    if (found?.href) return found.href;
    if (slug.startsWith('__')) return '/catalog';
    return `/catalog/${slug}`;
  }, [topLevel]);

  return {
    version: state.version,
    items: topLevel,
    /** Alias used by older call sites expecting categories */
    categories: topLevel,
    labels: state.labels,
    loading: state.loading,
    error: state.error,
    isEmpty: !state.loading && !state.error && topLevel.length === 0,
    reload,
    displayName,
    hrefForSlug,
  };
}

/** Back-compat export: true canonical menu is useNavigation. */
export function useCanonicalCategoryMenu() {
  const navigation = useNavigation();
  return {
    categories: navigation.items,
    loading: navigation.loading,
    error: navigation.error,
    isEmpty: navigation.isEmpty,
    reload: navigation.reload,
    version: navigation.version,
    labels: navigation.labels,
    displayName: navigation.displayName,
    hrefForSlug: navigation.hrefForSlug,
  };
}
