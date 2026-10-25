import { db } from '../db.js';

export const NAV_CONTRACT_VERSION = '2026-07-16.1';

export type NavNodeType =
  | 'DB_ROOT'
  | 'DB_ROOT_RELABEL'
  | 'DB_NODE_PROMOTED'
  | 'NAV_CLUSTER'
  | 'SITE_SECTION'
  | 'NAV_EXTRACT_PLACEHOLDER'
  | 'HIDDEN_OR_PLACEHOLDER';

export type ComposedNavNode = {
  node_key: string;
  sort_order: number;
  label_ru: string;
  label_en: string;
  node_type: NavNodeType;
  href: string;
  id: number | string;
  slug: string;
  name_ru: string;
  name_en?: string;
  name_hy?: string;
  image_url?: string;
  primary_category_id: number | null;
  member_category_ids: number[];
  engineering_role_focus: string;
  productsCount: number;
  childrenCount: number;
  children: ComposedNavNode[];
  /** Compatibility aliases used by existing frontend menu nodes */
  path_ru?: string;
  has_children?: boolean;
};

type TopLevelSpec = {
  node_key: string;
  sort_order: number;
  label_ru: string;
  label_en: string;
  node_type: NavNodeType;
  primary_category_id: number | null;
  member_category_ids: number[];
  include_in_top_menu: boolean;
  hide_if_empty: boolean;
  engineering_role_focus: string;
  fixed_href?: string;
};

/** Approved contract top-level composition (do not redesign). */
const TOP_LEVEL_SPECS: TopLevelSpec[] = [
  {
    node_key: 'electrical',
    sort_order: 10,
    label_ru: 'Розетки и выключатели',
    label_en: 'Sockets and switches',
    node_type: 'DB_ROOT_RELABEL',
    primary_category_id: 910005,
    member_category_ids: [910005],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Installation',
  },
  {
    node_key: 'automation',
    sort_order: 20,
    label_ru: 'Автоматика и управление',
    label_en: 'Automation',
    node_type: 'DB_ROOT',
    primary_category_id: 910002,
    member_category_ids: [910002],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Automation + Control',
  },
  {
    node_key: 'switchboards',
    sort_order: 30,
    label_ru: 'Щиты, шкафы и боксы',
    label_en: 'Switchboards',
    node_type: 'DB_NODE_PROMOTED',
    primary_category_id: 910056,
    member_category_ids: [910056],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Installation component',
  },
  {
    node_key: 'protection',
    sort_order: 40,
    label_ru: 'Автоматы и защита',
    label_en: 'Protection',
    node_type: 'DB_NODE_PROMOTED',
    primary_category_id: 910051,
    member_category_ids: [910051],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Protection',
  },
  {
    node_key: 'cable_management',
    sort_order: 50,
    label_ru: 'Кабели, кабель-каналы и монтаж',
    label_en: 'Cables & Cable Management',
    node_type: 'DB_ROOT_RELABEL',
    primary_category_id: 910003,
    member_category_ids: [910003],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Cable + Installation component + Connection',
  },
  {
    node_key: 'industrial_electrical',
    sort_order: 70,
    label_ru: 'Промышленная электрика',
    label_en: 'Industrial Electrical',
    node_type: 'NAV_CLUSTER',
    primary_category_id: 910054,
    member_category_ids: [910054, 910053, 910103, 910123, 910117],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Protection + Automation (industrial)',
  },
  {
    node_key: 'hvac',
    sort_order: 80,
    label_ru: 'HVAC и теплоснабжение',
    label_en: 'HVAC',
    node_type: 'DB_ROOT',
    primary_category_id: 910001,
    member_category_ids: [910001],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Control + Accessory',
  },
  {
    node_key: 'heating',
    sort_order: 90,
    label_ru: 'Электрическое отопление',
    label_en: 'Heating',
    node_type: 'DB_ROOT',
    primary_category_id: 910008,
    member_category_ids: [910008],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Control',
  },
  {
    node_key: 'water_supply',
    sort_order: 100,
    label_ru: 'Насосы и водоснабжение',
    label_en: 'Water Supply',
    node_type: 'DB_NODE_PROMOTED',
    primary_category_id: 910014,
    member_category_ids: [910014],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment',
  },
  {
    node_key: 'plumbing',
    sort_order: 110,
    label_ru: 'Трубопроводная арматура и гидравлика',
    label_en: 'Plumbing',
    node_type: 'DB_ROOT',
    primary_category_id: 910006,
    member_category_ids: [910006],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Connection + Control + Accessory',
  },
  {
    node_key: 'tools',
    sort_order: 130,
    label_ru: 'Инструменты',
    label_en: 'Tools',
    node_type: 'SITE_SECTION',
    primary_category_id: null,
    member_category_ids: [],
    // Keep /tools in site header (publicHeaderItems); hide from catalog/home category menus.
    include_in_top_menu: false,
    hide_if_empty: false,
    engineering_role_focus: 'Tool',
    fixed_href: '/tools',
  },
  {
    node_key: 'fasteners',
    sort_order: 120,
    label_ru: 'Крепёж',
    label_en: 'Fasteners',
    node_type: 'NAV_EXTRACT_PLACEHOLDER',
    primary_category_id: 910027,
    member_category_ids: [910027],
    include_in_top_menu: true,
    hide_if_empty: true,
    engineering_role_focus: 'Fastener',
  },
  {
    node_key: 'lighting',
    sort_order: 150,
    label_ru: 'Освещение',
    label_en: 'Lighting',
    node_type: 'DB_ROOT',
    primary_category_id: 910004,
    member_category_ids: [910004],
    include_in_top_menu: true,
    hide_if_empty: false,
    engineering_role_focus: 'Main equipment + Consumable',
  },
];

/** Category IDs promoted to top-level; hide from parent structural children to avoid duplicates. */
const PROMOTED_AWAY_FROM_PARENT = new Set<number>([910056, 910051, 910014, 910027]);

/** Display label overrides for structural breadcrumbs / search (contract labels). */
const DISPLAY_LABEL_OVERRIDES: Record<number, string> = {
  910005: 'Розетки и выключатели',
  910003: 'Кабели, кабель-каналы и монтаж',
  910056: 'Щиты, шкафы и боксы',
  910051: 'Автоматы и защита',
  910025: 'Кабели и провода',
  910014: 'Насосы и водоснабжение',
  910027: 'Крепёж',
};

type CategoryRow = {
  id: number;
  parent_id: number | null;
  name_ru: string;
  name_en: string;
  name_hy: string;
  slug: string;
  image_url: string;
  sort_order: number;
  is_public: number;
  is_public_card: number;
  short_description_ru?: string;
};

function loadCategories(): CategoryRow[] {
  return db
    .prepare(
      `SELECT id, parent_id, name_ru, name_en, name_hy, slug, image_url, sort_order,
              COALESCE(is_public, 1) AS is_public,
              COALESCE(is_public_card, 0) AS is_public_card,
              short_description_ru
       FROM categories
       WHERE is_active = 1`,
    )
    .all() as CategoryRow[];
}

function loadDirectProductCounts(): Map<number, number> {
  const rows = db
    // only active products: inactive links kept empty sections (e.g. "Запчасти для котлов") in the menu
    .prepare('SELECT pc.category_id, COUNT(DISTINCT pc.product_id) AS c FROM product_categories pc JOIN products p ON p.id = pc.product_id AND p.is_active = 1 GROUP BY pc.category_id')
    .all() as Array<{ category_id: number; c: number }>;
  return new Map(rows.map((row) => [Number(row.category_id), Number(row.c)]));
}

function sortCategories(a: CategoryRow, b: CategoryRow) {
  return Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru');
}

function buildSubtreeCounts(categories: CategoryRow[], direct: Map<number, number>) {
  const children = new Map<number, number[]>();
  for (const category of categories) {
    if (category.parent_id == null) continue;
    const parentId = Number(category.parent_id);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(Number(category.id));
  }

  const memo = new Map<number, number>();
  const visiting = new Set<number>();

  const walk = (id: number): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return direct.get(id) || 0;
    visiting.add(id);
    let total = direct.get(id) || 0;
    for (const childId of children.get(id) || []) total += walk(childId);
    visiting.delete(id);
    memo.set(id, total);
    return total;
  };

  for (const category of categories) walk(Number(category.id));
  return { children, subtree: memo };
}

function catalogHrefForSlug(slug: string) {
  return `/catalog/${slug}`;
}

function toChildNode(category: CategoryRow, subtree: Map<number, number>, childrenByParent: Map<number, number[]>, byId: Map<number, CategoryRow>, depthLeft: number): ComposedNavNode {
  const id = Number(category.id);
  const childIds = (childrenByParent.get(id) || [])
    .map((childId) => byId.get(childId))
    .filter((item): item is CategoryRow => item != null && Number(item.is_public) !== 0)
    .filter((item) => (subtree.get(Number(item.id)) || 0) > 0)
    .sort(sortCategories);

  const children =
    depthLeft > 0
      ? childIds.map((child) => toChildNode(child, subtree, childrenByParent, byId, depthLeft - 1))
      : [];

  const label = DISPLAY_LABEL_OVERRIDES[id] || category.name_ru;
  return {
    node_key: `category_${id}`,
    sort_order: Number(category.sort_order || 0),
    label_ru: label,
    label_en: category.name_en || '',
    node_type: 'DB_ROOT',
    href: catalogHrefForSlug(category.slug),
    id,
    slug: category.slug,
    name_ru: label,
    name_en: category.name_en || '',
    name_hy: category.name_hy || '',
    image_url: category.image_url || '',
    primary_category_id: id,
    member_category_ids: [id],
    engineering_role_focus: '',
    productsCount: subtree.get(id) || 0,
    childrenCount: children.length,
    children,
    path_ru: label,
    has_children: children.length > 0,
  };
}

export function getNavigationLabelMap() {
  const categories = loadCategories();
  const labels: Record<string, string> = {};
  for (const category of categories) {
    const id = Number(category.id);
    const label = DISPLAY_LABEL_OVERRIDES[id] || category.name_ru;
    labels[`id:${id}`] = label;
    if (category.slug) labels[`slug:${category.slug}`] = label;
  }
  // Contract top-level keys
  for (const spec of TOP_LEVEL_SPECS) {
    labels[`node:${spec.node_key}`] = spec.label_ru;
  }
  return labels;
}

export function composeCanonicalNavigation(): {
  nav_contract_version: string;
  items: ComposedNavNode[];
  labels: Record<string, string>;
} {
  const categories = loadCategories().filter((item) => Number(item.is_public) !== 0);
  const byId = new Map(categories.map((item) => [Number(item.id), item]));
  const direct = loadDirectProductCounts();
  const { children: childrenByParent, subtree } = buildSubtreeCounts(categories, direct);
  const labels = getNavigationLabelMap();

  const items: ComposedNavNode[] = [];

  for (const spec of TOP_LEVEL_SPECS) {
    if (!spec.include_in_top_menu) continue;

    if (spec.node_type === 'SITE_SECTION') {
      items.push({
        node_key: spec.node_key,
        sort_order: spec.sort_order,
        label_ru: spec.label_ru,
        label_en: spec.label_en,
        node_type: spec.node_type,
        href: spec.fixed_href || '/tools',
        id: `site:${spec.node_key}`,
        slug: `__${spec.node_key}__`,
        name_ru: spec.label_ru,
        name_en: spec.label_en,
        image_url: '',
        primary_category_id: null,
        member_category_ids: [],
        engineering_role_focus: spec.engineering_role_focus,
        productsCount: 0,
        childrenCount: 0,
        children: [],
        path_ru: spec.label_ru,
        has_children: false,
      });
      continue;
    }

    if (spec.node_type === 'NAV_CLUSTER') {
      // Never include lighting
      const memberIds = spec.member_category_ids.filter((id) => id !== 910004);
      const memberNodes = memberIds
        .map((id) => byId.get(id))
        .filter((item): item is CategoryRow => Boolean(item))
        .filter((item) => (subtree.get(Number(item.id)) || 0) > 0 || !spec.hide_if_empty)
        .map((item) => toChildNode(item, subtree, childrenByParent, byId, 1));

      const totalProducts = memberIds.reduce((sum, id) => sum + (subtree.get(id) || 0), 0);
      if (spec.hide_if_empty && totalProducts === 0) continue;

      const primary = byId.get(spec.primary_category_id || memberIds[0]);
      const primaryWithProducts =
        memberIds.map((id) => byId.get(id)).find((item) => item && (subtree.get(Number(item.id)) || 0) > 0) || primary;
      const href = primaryWithProducts ? catalogHrefForSlug(primaryWithProducts.slug) : '/catalog';

      items.push({
        node_key: spec.node_key,
        sort_order: spec.sort_order,
        label_ru: spec.label_ru,
        label_en: spec.label_en,
        node_type: spec.node_type,
        href,
        id: spec.primary_category_id || `cluster:${spec.node_key}`,
        slug: primaryWithProducts?.slug || `__${spec.node_key}__`,
        name_ru: spec.label_ru,
        name_en: spec.label_en,
        image_url: primaryWithProducts?.image_url || '',
        primary_category_id: spec.primary_category_id,
        member_category_ids: memberIds,
        engineering_role_focus: spec.engineering_role_focus,
        productsCount: totalProducts,
        childrenCount: memberNodes.length,
        children: memberNodes,
        path_ru: spec.label_ru,
        has_children: memberNodes.length > 0,
      });
      continue;
    }

    const primaryId = spec.primary_category_id;
    if (!primaryId) continue;
    const category = byId.get(primaryId);
    if (!category) continue;
    const count = subtree.get(primaryId) || 0;
    if (spec.hide_if_empty && count === 0) continue;

    const childCategories = (childrenByParent.get(primaryId) || [])
      .map((childId) => byId.get(childId))
      .filter((item): item is CategoryRow => item != null && Number(item.is_public) !== 0)
      .filter((item) => (subtree.get(Number(item.id)) || 0) > 0)
      .filter((item) => {
        // Avoid duplicate top-level promotions under their structural parent
        if (PROMOTED_AWAY_FROM_PARENT.has(Number(item.id))) return false;
        return true;
      })
      .sort(sortCategories)
      .map((item) => toChildNode(item, subtree, childrenByParent, byId, 1));

    items.push({
      node_key: spec.node_key,
      sort_order: spec.sort_order,
      label_ru: spec.label_ru,
      label_en: spec.label_en,
      node_type: spec.node_type,
      href: catalogHrefForSlug(category.slug),
      id: primaryId,
      slug: category.slug,
      name_ru: spec.label_ru,
      name_en: spec.label_en || category.name_en || '',
      name_hy: category.name_hy || '',
      image_url: category.image_url || '',
      primary_category_id: primaryId,
      member_category_ids: [primaryId],
      engineering_role_focus: spec.engineering_role_focus,
      productsCount: count,
      childrenCount: childCategories.length,
      children: childCategories,
      path_ru: spec.label_ru,
      has_children: childCategories.length > 0,
    });
  }

  items.sort((a, b) => a.sort_order - b.sort_order);

  return {
    nav_contract_version: NAV_CONTRACT_VERSION,
    items,
    labels,
  };
}

/** Menu-shaped array for existing /categories/menu consumers. */
export function composeCanonicalMenuTree() {
  return composeCanonicalNavigation().items;
}

export function canonicalHrefForCategoryId(categoryId: number, categoriesById: Map<number, { id: number; parent_id: number | null; slug: string }>) {
  // Prefer direct catalog slug href (works with SPA category routes)
  const category = categoriesById.get(categoryId);
  if (!category?.slug) return '/catalog';
  return catalogHrefForSlug(category.slug);
}

export function canonicalLabelForCategory(categoryId: number, fallback = '') {
  return DISPLAY_LABEL_OVERRIDES[categoryId] || fallback;
}
