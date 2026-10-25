import { Router } from 'express';
import { db } from '../db.js';
import { toPublicCategoryDto, toPublicProductCardDto } from '../utils/productDtos.js';
import { appendSalesModeWhere } from '../utils/salesMode.js';
import { composeCanonicalMenuTree } from '../utils/navigationComposer.js';
import { resolveCategoryAlias } from '../utils/categoryAliases.js';

const router = Router();

function getActiveCategories() {
  return db.prepare('SELECT id, parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru, icon, image_url, menu_type, sort_order, is_public, is_public_card FROM categories WHERE is_active = 1 ORDER BY sort_order, name_ru').all() as any[];
}

function collectDescendantIds(categoryId: number, categories: any[]) {
  const childrenByParent = new Map<number, any[]>();
  for (const item of categories) {
    const parentId = Number(item.parent_id || 0);
    const list = childrenByParent.get(parentId) || [];
    list.push(item);
    childrenByParent.set(parentId, list);
  }

  const ids = [categoryId];
  const queue = [categoryId];
  const seen = new Set<number>(ids);

  while (queue.length) {
    const currentId = queue.shift() as number;
    const children = childrenByParent.get(currentId) || [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
      queue.push(child.id);
    }
  }

  return ids;
}

function categoryDepth(category: any, byId: Map<number, any>) {
  let depth = 0;
  let current = category?.parent_id ? byId.get(category.parent_id) : null;
  while (current) {
    depth += 1;
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return depth;
}

function buildCategoryBranchCondition(alias: string, ids: number[]) {
  const placeholders = ids.map(() => '?').join(',');
  return `(
    ${alias}.category_id IN (${placeholders})
    OR COALESCE(${alias}.primary_category_id, 0) IN (${placeholders})
    OR EXISTS (
      SELECT 1 FROM product_categories pc
      WHERE pc.product_id = ${alias}.id AND pc.category_id IN (${placeholders})
    )
  )`;
}

const DEFAULT_CATEGORY_PRODUCT_LIMIT = 36;
const MAX_CATEGORY_PRODUCT_LIMIT = 100;

function parsePositiveInteger(value: unknown, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function normalizeCategoryPagination(query: any) {
  const page = parsePositiveInteger(query.page, 1);
  const requestedLimit = parsePositiveInteger(query.limit, DEFAULT_CATEGORY_PRODUCT_LIMIT);
  return {
    page,
    limit: Math.min(requestedLimit, MAX_CATEGORY_PRODUCT_LIMIT),
  };
}

function countCategoryProducts(whereSql: string, params: any[]) {
  return Number((db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE ${whereSql}
  `).get(...params) as any)?.count || 0);
}

function selectCategoryProducts(whereSql: string, params: any[], limit: number, offset: number) {
  return db.prepare(`
    SELECT
      p.id,
      p.sku,
      p.name_ru,
      p.name_hy,
      p.name_en,
      p.slug,
      p.brand_id,
      p.series_id,
      p.primary_category_id,
      p.category_id,
      p.short_description_ru,
      p.description_ru,
      p.price_amd,
      p.currency,
      p.unit,
      p.show_price,
      p.availability_status,
      b.name as brand_name,
      b.slug as brand_slug,
      c.name_ru as category_name,
      c.slug as category_slug,
      s.name as series_name,
      s.slug as series_slug,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id AND i.is_cover = 1 ORDER BY i.sort_order LIMIT 1) AS cover_image,
      (SELECT COUNT(*) FROM product_documents d WHERE d.product_id = p.id AND d.is_public = 1 AND COALESCE(d.is_active, 1) = 1) AS documents_count,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity,
      COALESCE((SELECT GROUP_CONCAT(pc.category_id) FROM product_categories pc WHERE pc.product_id = p.id), '') AS category_ids_csv
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE ${whereSql}
    ORDER BY p.is_featured DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];
}

function countProductsForBranch(categoryId: number, categories: any[], whereSql: string, params: any[]) {
  const branchIds = collectDescendantIds(categoryId, categories);
  return countCategoryProducts(`${whereSql} AND ${buildCategoryBranchCondition('p', branchIds)}`, [
    ...params,
    ...branchIds,
    ...branchIds,
    ...branchIds,
  ]);
}

const SERIES_WRAPPER_RE = /^(электроустановочные изделия|электротехнические изделия|главная|разное|action)$/iu;
const SERIES_PREFIX_RE = /^legrand серия\s+/iu;
const SERIES_COLOR_SUFFIX_RE = /\s+(белый|слоновая кость|графит|титан|антрацит|алюминий|серый|черный|чёрный|champagne|шампань)$/iu;
const SERIES_FUNCTION_RE = /^(лицевые панели|механизмы|рамки|универсальные суппорты)\s+(.+)$/iu;

function getSeriesPublicSlug(value: string) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizeSeriesDisplayName(value: string) {
  let series = String(value || '').trim();
  if (!series || SERIES_WRAPPER_RE.test(series)) return '';
  series = series.replace(SERIES_PREFIX_RE, '').trim();

  const functional = series.match(SERIES_FUNCTION_RE);
  if (functional) series = functional[2].trim();

  series = series.replace(SERIES_COLOR_SUFFIX_RE, '').trim();
  if (SERIES_WRAPPER_RE.test(series)) return '';
  return series;
}

/** "Valena Allure/Life" -> ["Valena Allure", "Valena Life"]; "Niloe/Etika" -> ["Niloe", "Etika"]; drops "IP 66" parts. */
function splitSeriesFamilies(displayName: string) {
  const result: string[] = [];
  for (const part of String(displayName || '').split('/').map((item) => item.trim()).filter(Boolean)) {
    if (/^ip\s*\d/i.test(part)) continue;
    if (!/\s/.test(part) && result.length && /\s/.test(result[0])) result.push(`${result[0].split(/\s+/)[0]} ${part}`);
    else result.push(part);
  }
  return result;
}

/** Public family keys of a series row: "Механизмы Valena Allure/Life" -> valena-allurelife, valena-allure, valena-life. */
function seriesFamilyKeys(name: string) {
  const displayName = normalizeSeriesDisplayName(name);
  if (!displayName) return [];
  return [getSeriesPublicSlug(displayName), ...splitSeriesFamilies(displayName).map(getSeriesPublicSlug)].filter(Boolean);
}

/**
 * Series rows of the same family as the seeds (single pass, not transitive): colour splits ("Celiane белый"),
 * function splits ("Рамки Celiane") and shared ranges ("Рамки Niloe/Etika", "Механизмы Valena Allure/Life").
 */
function expandSeriesFamily(rows: { id: number; name: string }[], seedIds: Set<number>, extraKeys: string[] = []) {
  const keys = new Set(extraKeys.filter(Boolean));
  for (const row of rows) if (seedIds.has(Number(row.id))) seriesFamilyKeys(row.name).forEach((key) => keys.add(key));
  const ids = new Set(seedIds);
  if (!keys.size) return ids;
  for (const row of rows) if (seriesFamilyKeys(row.name).some((key) => keys.has(key))) ids.add(Number(row.id));
  return ids;
}

function resolveSeriesFilterIds(seriesQuery: string, seriesIdQuery?: string) {
  const ids = new Set<number>();

  if (seriesIdQuery) {
    seriesIdQuery.split(',').forEach((val) => {
      const id = Number(val.trim());
      if (!isNaN(id)) ids.add(id);
    });
  }

  const query = String(seriesQuery || '').trim();
  let queryAlias = '';
  if (query) {
    if (/^\d+$/.test(query)) {
      ids.add(Number(query));
    } else {
      const exactRows = db.prepare(`
        SELECT id
        FROM series
        WHERE is_active = 1
          AND deleted_at IS NULL
          AND (slug = ? OR LOWER(name) = LOWER(?))
      `).all(query, query) as { id: number }[];

      exactRows.forEach((row) => ids.add(Number(row.id)));
      queryAlias = getSeriesPublicSlug(query);
    }
  }

  if (!ids.size && !queryAlias) return [];
  const rows = db.prepare('SELECT id, name FROM series WHERE is_active = 1 AND deleted_at IS NULL').all() as { id: number; name: string }[];
  return [...expandSeriesFamily(rows, ids, [queryAlias])].filter(Boolean);
}

const SUPPORTED_TECH_FILTERS = [
  'rated_current_a',
  'poles',
  'curve',
  'breaking_capacity_ka',
  'device_type',
  'rcd_type',
  'leakage_current_ma',
  'color',
  'material',
  'module_count',
  'extra_module_count',
  'rows_count',
  'ip_rating',
  'mounting_type',
  'door_type',
  'height_mm',
  'width_mm',
  'depth_mm',
  'product_type',
];

// Exposed only when every active product in the branch is classified and both values occur;
// otherwise "equipment" would silently hide unclassified products.
const COMPLETE_COVERAGE_FILTERS = ['product_type'];

function resolveTechnicalFilters(query: any) {
  const where: string[] = [];
  const params: any[] = [];

  for (const key of SUPPORTED_TECH_FILTERS) {
    if (query[key]) {
      const vals = String(query[key]).split(',').map(v => v.trim()).filter(Boolean);
      if (vals.length === 0) continue;

      const subWhere: string[] = [];
      for (const val of vals) {
        const isNum = !isNaN(Number(val)) && val !== '';
        const col = isNum ? 'value_number' : 'value_text';
        subWhere.push(`pa.${col} = ?`);
        params.push(isNum ? Number(val) : val);
      }

      where.push(`EXISTS (
        SELECT 1 FROM product_attributes pa 
        WHERE pa.product_id = p.id 
          AND pa.attribute_key = ? 
          AND (${subWhere.join(' OR ')})
      )`);
      params.splice(params.length - vals.length, 0, key);
    }
  }

  return { where, params };
}

function collectTechnicalFilterMetadata(branchIds: number[]) {
  if (!branchIds.length) return {};

  const placeholders = branchIds.map(() => '?').join(',');
  const query = `
    SELECT pa.attribute_key, pa.value_text, pa.value_number, pa.value_unit, COUNT(DISTINCT p.id) as count
    FROM product_attributes pa
    JOIN products p ON pa.product_id = p.id
    WHERE pa.attribute_key IN (${SUPPORTED_TECH_FILTERS.map(() => '?').join(',')})
      AND (
        p.category_id IN (${placeholders})
        OR COALESCE(p.primary_category_id, 0) IN (${placeholders})
        OR EXISTS (
          SELECT 1 FROM product_categories pc
          WHERE pc.product_id = p.id AND pc.category_id IN (${placeholders})
        )
      )
    GROUP BY pa.attribute_key, pa.value_text, pa.value_number
    ORDER BY pa.attribute_key, pa.value_number, pa.value_text
  `;

  const rows = db.prepare(query).all(...SUPPORTED_TECH_FILTERS, ...branchIds, ...branchIds, ...branchIds) as any[];

  const grouped: Record<string, any[]> = {};
  for (const row of rows) {
    const key = row.attribute_key;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      value: row.value_text !== null ? row.value_text : row.value_number,
      unit: row.value_unit || '',
      count: row.count,
    });
  }

  for (const key of COMPLETE_COVERAGE_FILTERS) {
    if (!grouped[key]) continue;
    const coverage = db.prepare(`
      SELECT COUNT(DISTINCT p.id) AS total,
        COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id AND pa.attribute_key = ?) THEN p.id END) AS covered
      FROM products p
      WHERE p.is_active = 1 AND ${buildCategoryBranchCondition('p', branchIds)}
    `).get(key, ...branchIds, ...branchIds, ...branchIds) as any;
    if (grouped[key].length < 2 || Number(coverage?.covered || 0) < Number(coverage?.total || 0)) delete grouped[key];
  }

  // Custom sorting
  const MOUNTING_ORDER = ['surface', 'recessed', 'flush', 'wall', 'floor'];
  const DOOR_ORDER = ['transparent', 'white', 'smoked', 'metal', 'without_door'];

  Object.keys(grouped).forEach((key) => {
    if (key === 'ip_rating') {
      grouped[key].sort((a, b) => {
        const aNum = parseInt(String(a.value).replace(/\D/g, ''), 10) || 0;
        const bNum = parseInt(String(b.value).replace(/\D/g, ''), 10) || 0;
        return aNum - bNum;
      });
    } else if (key === 'mounting_type') {
      grouped[key].sort((a, b) => {
        const aIdx = MOUNTING_ORDER.indexOf(a.value);
        const bIdx = MOUNTING_ORDER.indexOf(b.value);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return String(a.value).localeCompare(String(b.value));
      });
    } else if (key === 'door_type') {
      grouped[key].sort((a, b) => {
        const aIdx = DOOR_ORDER.indexOf(a.value);
        const bIdx = DOOR_ORDER.indexOf(b.value);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return String(a.value).localeCompare(String(b.value));
      });
    }
  });

  return grouped;
}

function collectChildrenWithProducts(children: any[], categories: any[], whereSql: string, params: any[]) {
  if (!children.length) return [];
  return children
    .map((child) => ({ ...child, productsCount: countProductsForBranch(child.id, categories, whereSql, params) }))
    .filter((child) => Number(child.productsCount || 0) > 0);
}

function isSwitchesDisplayNoise(category: any) {
  const name = String(category?.name_ru || '').trim().toLowerCase();
  const colorWords = ['white', 'black', 'gold', 'bronze', 'silver', 'graphite', 'aluminium', 'aluminum', 'magnesium', 'слоновая кость', 'бел', 'черн', 'сер', 'бронз', 'золот', 'графит', 'алюмин'];
  const explicitNoise = [
    'arteor soft aluminum',
    'mallia brushed aluminium',
    'mosaic eliocad',
    'celiane титан',
    'plexo ip 55',
  ];
  if (!name) return true;
  if (name === 'главная' || name === 'action') return true;
  if (name === 'электроустановочные изделия') return true;
  if (name.startsWith('электротехнические изделия ')) return true;
  if (name.includes(' серия ')) return true;
  if (explicitNoise.includes(name)) return true;
  if (colorWords.some((word) => name.includes(word))) return true;
  return false;
}

function normalizeSwitchesDisplayName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function resolveVisibleChildren(category: any, categories: any[], whereSql: string, params: any[]) {
  const sortCategories = (items: any[]) => [...items].sort((a, b) =>
    Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru')
  );
  const directChildren = sortCategories(categories.filter((item) => Number(item.parent_id) === category.id && Number(item.is_public ?? 1) !== 0));
  const directWithProducts = collectChildrenWithProducts(directChildren, categories, whereSql, params);
  return directWithProducts.length ? sortCategories(directWithProducts) : directChildren;
}

function collectFilterCategories(category: any, categories: any[], parentById: Map<number, number | null>, whereSql: string, params: any[]) {
  const descendants = categories.filter((item) => (
    item.id !== category.id
    && Number(item.is_public ?? 1) !== 0
    && isDescendantCategory(item.id, category.id, parentById)
  ));

  return descendants
    .map((item) => ({ ...item, productsCount: countProductsForBranch(item.id, categories, whereSql, params) }))
    .filter((item) => Number(item.productsCount || 0) > 0)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru'));
}

function isDescendantCategory(categoryId: number, targetCategoryId: number, parentById: Map<number, number | null>) {
  let current: number | null | undefined = categoryId;
  while (current) {
    if (current === targetCategoryId) return true;
    current = parentById.get(current) ?? null;
  }
  return false;
}

type CategoryMenuNode = {
  id: number;
  parent_id: number | null;
  level: number;
  name_ru: string;
  name_en: string;
  slug: string;
  sort_order?: number;
  image_url: string;
  path_ru: string;
  path_en: string;
  productsCount: number;
  childrenCount: number;
  has_children: boolean;
  children: CategoryMenuNode[];
};

function getBranchProductsCount(categoryId: number, categories: any[]) {
  const branchIds = collectDescendantIds(categoryId, categories);
  return Number((db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM products p
    WHERE p.is_active = 1 AND (
      p.category_id IN (${branchIds.map(() => '?').join(',')})
      OR COALESCE(p.primary_category_id, 0) IN (${branchIds.map(() => '?').join(',')})
      OR EXISTS (
        SELECT 1 FROM product_categories pc
        WHERE pc.product_id = p.id AND pc.category_id IN (${branchIds.map(() => '?').join(',')})
      )
    )
  `).get(...branchIds, ...branchIds, ...branchIds) as any)?.count || 0);
}

function buildMenuNode(category: any, childrenByParent: Map<number, any[]>, categories: any[], trail: any[] = [], maxLevel = Infinity): CategoryMenuNode {
  const nextLevel = trail.length;
  const childCategories = (childrenByParent.get(category.id) || [])
    .filter((item) => Number(item.is_public ?? 1) !== 0 && getBranchProductsCount(item.id, categories) > 0);

  const nestedChildren = nextLevel >= maxLevel
    ? []
    : childCategories
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru'))
        .map((child) => buildMenuNode(child, childrenByParent, categories, [...trail, category], maxLevel));

  return {
    id: category.id,
    parent_id: category.parent_id,
    level: nextLevel,
    name_ru: category.name_ru,
    name_en: category.name_en || '',
    slug: category.slug,
    image_url: category.image_url || '',
    path_ru: [...trail.map((item) => item.name_ru), category.name_ru].join(' > '),
    path_en: [...trail.map((item) => item.name_en || item.name_ru), category.name_en || category.name_ru].join(' > '),
    productsCount: getBranchProductsCount(category.id, categories),
    childrenCount: childCategories.length,
    has_children: childCategories.length > 0,
    children: nestedChildren,
  };
}

/** Live category by slug; a merged (archived) slug resolves to the category that absorbed it, so the client can replace its URL. */
function findActiveCategory(slug: string) {
  const statement = db.prepare('SELECT id, parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru, icon, image_url, menu_type, sort_order, is_public, is_public_card FROM categories WHERE slug = ? AND is_active = 1');
  return (statement.get(slug) ?? statement.get(resolveCategoryAlias(slug)?.slug ?? '')) as any;
}

router.get('/', (_req, res) => {
  const roots = getActiveCategories()
    .filter((item) => item.parent_id === null && Number(item.is_public ?? 1) !== 0 && Number(item.is_public_card ?? 0) === 1)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru'));
  res.json(roots.map(toPublicCategoryDto));
});

router.get('/public-roots', (_req, res) => {
  const roots = getActiveCategories()
    .filter((item) => item.parent_id === null && Number(item.is_public ?? 1) !== 0 && Number(item.is_public_card ?? 0) === 1)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru'));
  res.json(roots.map(toPublicCategoryDto));
});

router.get('/tree', (_req, res) => {
  // Single canonical navigation source (contract 2026-07-12.1)
  res.json(composeCanonicalMenuTree());
});

router.get('/public-cards', (_req, res) => {
  // Top-level cards from the same composed navigation (not historical DB root order)
  const items = composeCanonicalMenuTree().filter((item) => item.node_type !== 'SITE_SECTION' || item.node_key === 'tools');
  const enriched = items.map((item) => ({
    id: item.id,
    parent_id: null,
    name_ru: item.name_ru,
    name_en: item.name_en || '',
    slug: item.slug,
    description_ru: '',
    short_description_ru: item.engineering_role_focus || '',
    icon: '',
    image_url: item.image_url || '',
    menu_type: 'category',
    sort_order: item.sort_order,
    is_public: 1,
    is_public_card: 1,
    childrenCount: item.childrenCount,
    productsCount: item.productsCount,
    node_key: item.node_key,
    href: item.href,
  }));
  res.json(enriched.map((card) => toPublicCategoryDto(card)));
});

router.get('/menu', (_req, res) => {
  // Single canonical navigation source (contract 2026-07-12.1)
  res.json(composeCanonicalMenuTree());
});

router.get('/menu/:slug', (req, res) => {
  const categories = getActiveCategories().filter((item) => Number(item.is_public ?? 1) !== 0);
  const aliasTarget = resolveCategoryAlias(req.params.slug);
  const target = categories.find((item) => item.slug === (aliasTarget?.slug || req.params.slug));
  if (!target) return res.status(404).json({ error: 'Not found' });
  const childrenByParent = new Map<number, any[]>();
  const byId = new Map<number, any>();
  for (const item of categories) {
    byId.set(item.id, item);
    const parentId = Number(item.parent_id || 0);
    const list = childrenByParent.get(parentId) || [];
    list.push(item);
    childrenByParent.set(parentId, list);
  }
  const trail: any[] = [];
  let current: any = target;
  while (current) {
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  const node = buildMenuNode(target, childrenByParent, categories, trail.slice(0, -1), 2);
  const breadcrumbs = trail.map((item, index) => ({
    id: item.id,
    parent_id: item.parent_id,
    level: index,
    name_ru: item.name_ru,
    name_en: item.name_en || '',
    slug: item.slug,
    image_url: item.image_url || '',
    path_ru: trail.slice(0, index + 1).map((part) => part.name_ru).join(' > '),
    path_en: trail.slice(0, index + 1).map((part) => part.name_en || part.name_ru).join(' > '),
    has_children: (childrenByParent.get(item.id) || []).some((child) => Number(child.is_public ?? 1) !== 0),
    children: [],
  }));
  res.json({ category: node, children: node.children, breadcrumbs });
});

router.get('/:slug/filters', (req, res) => {
  const category = findActiveCategory(req.params.slug);
  if (!category) return res.status(404).json({ error: 'Not found' });
  
  const categories = getActiveCategories();
  const branchIds = collectDescendantIds(category.id, categories);
  const placeholders = branchIds.map(() => '?').join(',');

  const technicalFilters = collectTechnicalFilterMetadata(branchIds);

  // Collect Brand filters
  const brands = db.prepare(`
    SELECT b.id, b.name, b.slug, COUNT(DISTINCT p.id) as count
    FROM brands b
    JOIN products p ON p.brand_id = b.id
    WHERE p.is_active = 1 AND (
      p.category_id IN (${placeholders})
      OR COALESCE(p.primary_category_id, 0) IN (${placeholders})
      OR EXISTS (
        SELECT 1 FROM product_categories pc
        WHERE pc.product_id = p.id AND pc.category_id IN (${placeholders})
      )
    )
    GROUP BY b.id
    ORDER BY b.name
  `).all(...branchIds, ...branchIds, ...branchIds) as any[];

  // Collect Series filters
  const series = db.prepare(`
    SELECT s.id, s.name, s.slug, COUNT(DISTINCT p.id) as count
    FROM series s
    JOIN products p ON p.series_id = s.id
    WHERE p.is_active = 1 AND (
      p.category_id IN (${placeholders})
      OR COALESCE(p.primary_category_id, 0) IN (${placeholders})
      OR EXISTS (
        SELECT 1 FROM product_categories pc
        WHERE pc.product_id = p.id AND pc.category_id IN (${placeholders})
      )
    )
    GROUP BY s.id
    ORDER BY s.name
  `).all(...branchIds, ...branchIds, ...branchIds) as any[];

  res.json({
    brandId: brands.map(b => ({ value: b.id, label: b.name, slug: b.slug, count: b.count })),
    // count = the whole family in this branch (what the series filter returns), not only this series row
    seriesId: series.map(s => ({
      value: s.id,
      label: s.name,
      slug: s.slug,
      count: [...expandSeriesFamily(series, new Set([Number(s.id)]))].reduce((sum, id) => sum + Number(series.find((row) => Number(row.id) === id)?.count || 0), 0),
    })),
    ...technicalFilters
  });
});

router.get('/:slug', (req, res) => {
  const category = findActiveCategory(req.params.slug);
  if (!category) return res.status(404).json({ error: 'Not found' });
  const categories = getActiveCategories();
  const byId = new Map(categories.map((item) => [item.id, item]));
  const parentById = new Map(categories.map((item) => [item.id, item.parent_id ?? null]));
  const depth = categoryDepth(category, byId);
  const branchIds = collectDescendantIds(category.id, categories);
  const selectedCategorySlug = String(req.query.category || '');
  let filteredIds = branchIds;
  if (selectedCategorySlug) {
    const selected = categories.find((item) => item.slug === selectedCategorySlug && branchIds.includes(item.id));
    if (selected) filteredIds = collectDescendantIds(selected.id, categories);
  }
  const where = ['p.is_active = 1'];
  const params: any[] = [];
  where.push(buildCategoryBranchCondition('p', filteredIds));
  params.push(...filteredIds, ...filteredIds, ...filteredIds);

  if (req.query.brand || req.query.brandId) {
    const bVals = String(req.query.brand || req.query.brandId).split(',').map(v => v.trim()).filter(Boolean);
    if (bVals.length) {
      const bWhere: string[] = [];
      for (const val of bVals) {
        if (/^\d+$/.test(val)) {
          bWhere.push('p.brand_id = ?');
          params.push(Number(val));
        } else {
          bWhere.push('b.slug = ?');
          params.push(val);
        }
      }
      where.push(`(${bWhere.join(' OR ')})`);
    }
  }

  if (req.query.series || req.query.seriesId) {
    const seriesIds = resolveSeriesFilterIds(String(req.query.series || ''), String(req.query.seriesId || ''));
    if (seriesIds.length) {
      where.push(`p.series_id IN (${seriesIds.map(() => '?').join(',')})`);
      params.push(...seriesIds);
    } else {
      where.push('0 = 1');
    }
  }
  const techFilters = resolveTechnicalFilters(req.query);
  if (techFilters.where.length) {
    where.push(...techFilters.where);
    params.push(...techFilters.params);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    const searchLike = `%${q}%`;
    where.push('(p.sku LIKE ? OR p.name_ru LIKE ? OR p.name_hy LIKE ? OR p.name_en LIKE ? OR p.short_description_ru LIKE ? OR b.name LIKE ? OR s.name LIKE ?)');
    params.push(searchLike, searchLike, searchLike, searchLike, searchLike, searchLike, searchLike);
  }
  if (String(req.query.inStock || '') === 'true') where.push('COALESCE((SELECT SUM(s.available_quantity) FROM stock s WHERE s.product_id = p.id), 0) > 0');
  if (String(req.query.hasDocs || '') === 'true') where.push('(SELECT COUNT(*) FROM product_documents d WHERE d.product_id = p.id AND d.is_public = 1) > 0');
  appendSalesModeWhere(where, params, req.query.saleMode);
  if (req.query.minPrice) {
    where.push('p.price_amd >= ?');
    params.push(Number(req.query.minPrice));
  }
  if (req.query.maxPrice) {
    where.push('p.price_amd <= ?');
    params.push(Number(req.query.maxPrice));
  }
  const { page: requestedPage, limit } = normalizeCategoryPagination(req.query);
  const whereSql = where.join(' AND ');
  const total = countCategoryProducts(whereSql, params);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * limit;
  const products = selectCategoryProducts(whereSql, params, limit, offset);
  const publicProducts = products.map(toPublicProductCardDto);
  const children = depth < 2 ? resolveVisibleChildren(category, categories, whereSql, params) : [];
  const filterCategories = depth >= 2 ? collectFilterCategories(category, categories, parentById, whereSql, params) : [];
  const technicalFiltersMetadata = collectTechnicalFilterMetadata(filteredIds);
  res.json({
    category: toPublicCategoryDto({ ...category, level: depth }),
    children: children.map(toPublicCategoryDto),
    filterCategories: filterCategories.map(toPublicCategoryDto),
    products: publicProducts,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: { category: selectedCategorySlug || null },
    technicalFilters: technicalFiltersMetadata,
  });
});

export default router;
