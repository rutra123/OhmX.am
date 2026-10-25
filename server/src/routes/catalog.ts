import { Router } from 'express';
import { db } from '../db.js';
import { toPublicCategoryDto, toPublicProductCardDto } from '../utils/productDtos.js';

const router = Router();
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

// Series page size policy: only allow these sizes when ?series is present
const SERIES_ALLOWED_LIMITS = [24, 48, 72, 100] as const;
const SERIES_DEFAULT_LIMIT = 24;

function getActiveCategories() {
  return db.prepare('SELECT id, parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru, icon, image_url, menu_type, sort_order, is_public, is_public_card FROM categories WHERE is_active = 1 ORDER BY sort_order, name_ru').all() as any[];
}

function collectDescendantIds(categoryId: number, categories: any[]) {
  const ids = [categoryId];
  const queue = [categoryId];
  while (queue.length) {
    const currentId = queue.shift() as number;
    const children = categories.filter((item) => Number(item.parent_id) === currentId);
    children.forEach((child) => {
      ids.push(child.id);
      queue.push(child.id);
    });
  }
  return [...new Set(ids)];
}

function parsePage(value: unknown) {
  const page = Number(value || 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseLimit(value: unknown) {
  const limit = Number(value || DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function buildBranchCondition(alias: string, ids: number[]) {
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

function getBreadcrumbs(category: any, categories: any[]) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const chain: any[] = [];
  let current = category;
  while (current) {
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return chain;
}

function productCardSelect(where = '1=1', params: any[] = [], limit: number, offset: number) {
  const rows = db.prepare(`
    SELECT p.id, p.sku, p.slug, p.name_ru, p.price_amd, p.show_price, p.availability_status,
      b.name as brand_name,
      b.slug as brand_slug,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id AND i.is_cover = 1 ORDER BY i.sort_order LIMIT 1) AS cover_image,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${where}
    ORDER BY p.is_featured DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return rows.map(toPublicProductCardDto);
}

router.get('/roots', (_req, res) => {
  const roots = db.prepare(`
    SELECT id, parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru, icon, image_url, menu_type, sort_order, is_public, is_public_card FROM categories
    WHERE is_active = 1 AND is_public_card = 1 AND parent_id IS NULL
    ORDER BY sort_order, name_ru
  `).all();
  res.json((roots as any[]).map(toPublicCategoryDto));
});

router.get('/category/:slug', (req, res) => {
  const categories = getActiveCategories();
  const category = categories.find((item) => item.slug === req.params.slug);
  if (!category) return res.status(404).json({ error: 'Not found' });

  const page = parsePage(req.query.page);
  let limit = parseLimit(req.query.limit);
  if (req.query.series) {
    // enforce allowed series page sizes; default to SERIES_DEFAULT_LIMIT when missing/invalid
    limit = (Array.isArray(SERIES_ALLOWED_LIMITS) && SERIES_ALLOWED_LIMITS.includes(limit as any)) ? limit : SERIES_DEFAULT_LIMIT;
  }
  const offset = (page - 1) * limit;
  const branchIds = collectDescendantIds(category.id, categories);
  const where = ['p.is_active = 1', buildBranchCondition('p', branchIds)];
  const params: any[] = [...branchIds, ...branchIds, ...branchIds];

  if (req.query.brand) {
    where.push('b.slug = ?');
    params.push(String(req.query.brand));
  }
  if (req.query.q) {
    const q = `%${String(req.query.q)}%`;
    where.push('(p.sku LIKE ? OR p.name_ru LIKE ? OR b.name LIKE ? OR p.short_description_ru LIKE ?)');
    params.push(q, q, q, q);
  }

  const whereSql = where.join(' AND ');
  const total = Number((db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${whereSql}
  `).get(...params) as any)?.count || 0);
  const products = productCardSelect(whereSql, params, limit, offset);
  const children = categories.filter((item) => Number(item.parent_id) === category.id && Number(item.is_public ?? 1) !== 0);
  const brandRows = db.prepare(`
    SELECT b.id, b.name, b.slug, b.logo_url, COUNT(DISTINCT p.id) as productsCount
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.is_active = 1 AND ${buildBranchCondition('p', branchIds)}
    GROUP BY b.id, b.name, b.slug, b.logo_url
    ORDER BY productsCount DESC, b.sort_order ASC, b.name ASC
  `).all(...branchIds, ...branchIds, ...branchIds) as any[];
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return res.json({
    category: toPublicCategoryDto(category),
    breadcrumbs: getBreadcrumbs(category, categories).map(toPublicCategoryDto),
    children: children.map(toPublicCategoryDto),
    brands: brandRows.filter((item) => item.slug || item.name),
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
});

router.get('/category/:slug/brands', (req, res) => {
  const categories = getActiveCategories();
  const category = categories.find((item) => item.slug === req.params.slug);
  if (!category) return res.status(404).json({ error: 'Not found' });
  const branchIds = collectDescendantIds(category.id, categories);
  const rows = db.prepare(`
    SELECT b.id, b.name, b.slug, b.logo_url, COUNT(DISTINCT p.id) as productsCount
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.is_active = 1 AND ${buildBranchCondition('p', branchIds)}
    GROUP BY b.id, b.name, b.slug, b.logo_url
    ORDER BY productsCount DESC, b.sort_order ASC, b.name ASC
  `).all(...branchIds, ...branchIds, ...branchIds);
  res.json(rows);
});

router.get('/category/:slug/brand/:brandSlug', (req, res) => {
  const categories = getActiveCategories();
  const category = categories.find((item) => item.slug === req.params.slug);
  if (!category) return res.status(404).json({ error: 'Not found' });
  const page = parsePage(req.query.page);
  let limit = parseLimit(req.query.limit);
  if (req.query.series) {
    limit = (Array.isArray(SERIES_ALLOWED_LIMITS) && SERIES_ALLOWED_LIMITS.includes(limit as any)) ? limit : SERIES_DEFAULT_LIMIT;
  }
  const offset = (page - 1) * limit;
  const branchIds = collectDescendantIds(category.id, categories);
  const where = ['p.is_active = 1', buildBranchCondition('p', branchIds), 'b.slug = ?'];
  const params: any[] = [...branchIds, ...branchIds, ...branchIds, req.params.brandSlug];
  const whereSql = where.join(' AND ');
  const total = Number((db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${whereSql}
  `).get(...params) as any)?.count || 0);
  const products = productCardSelect(whereSql, params, limit, offset);
  const childCategories = categories.filter((item) => Number(item.parent_id) === category.id && Number(item.is_public ?? 1) !== 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  res.json({
    category: toPublicCategoryDto(category),
    brandSlug: req.params.brandSlug,
    children: childCategories.map(toPublicCategoryDto),
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
});

export default router;
