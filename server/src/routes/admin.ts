import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, slugify } from '../db.js';
import { createAdminToken, isAdminAuthConfigured, requireAdmin, verifyAdminPassword } from '../middleware/auth.js';
import { productSelect } from '../utils/query.js';
import { DEFAULT_WARM_FLOOR_SETTINGS } from '../utils/warmFloorCalculator.js';
import { storageRoot } from '../paths.js';
import { loadCalculatorInference } from '../services/catalogCalculatorInference.js';
import { CSV_BOM, EXPORT_SCHEMA_VERSION, FULL_EXPORT_COLUMNS, buildProductRow, csvLine, exportFilename, loadCatalogSnapshotPaged, rowValues } from '../services/catalogFullExport.js';

const router = Router();

function categoryLevelMap(rows: any[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const levels = new Map<number, number>();
  const depthOf = (row: any): number => {
    if (!row?.parent_id) return 0;
    if (levels.has(row.id)) return levels.get(row.id) as number;
    const parent = byId.get(row.parent_id);
    const depth = parent ? depthOf(parent) + 1 : 0;
    levels.set(row.id, depth);
    return depth;
  };
  rows.forEach((row) => levels.set(row.id, depthOf(row)));
  return levels;
}

function optionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonString(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value.map(String).filter(Boolean));
  const text = String(value || '').trim();
  return text || '';
}

function getAdminWarmFloorSettings() {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('warm_floor_calculator') as { value_json?: string } | undefined;
  if (!row?.value_json) return DEFAULT_WARM_FLOOR_SETTINGS;
  try {
    const saved = JSON.parse(row.value_json);
    return { ...DEFAULT_WARM_FLOOR_SETTINGS, ...saved };
  } catch {
    return DEFAULT_WARM_FLOOR_SETTINGS;
  }
}

function syncProductMeta(productId: number, body: any) {
  const features = Array.isArray(body.features) ? body.features : [];
  const stock = Array.isArray(body.stock) ? body.stock : [];
  db.prepare('DELETE FROM product_features WHERE product_id = ?').run(productId);
  const insertFeature = db.prepare('INSERT INTO product_features (product_id,feature_name,feature_value,feature_unit,sort_order) VALUES (?,?,?,?,?)');
  features
    .filter((feature: any) => feature.feature_name && feature.feature_value !== undefined && feature.feature_value !== '')
    .forEach((feature: any, index: number) => {
      insertFeature.run(productId, feature.feature_name, String(feature.feature_value), feature.feature_unit || '', Number(feature.sort_order || index + 1));
    });

  db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
  const insertStock = db.prepare('INSERT INTO stock (product_id, warehouse_id, quantity, reserved_quantity, available_quantity, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  stock
    .filter((item: any) => item.warehouse_id)
    .forEach((item: any) => {
      const quantity = Number(item.quantity || 0);
      const reserved = Number(item.reserved_quantity || 0);
      const available = Number(item.available_quantity ?? quantity - reserved);
      insertStock.run(productId, Number(item.warehouse_id), quantity, reserved, available);
    });
}

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function getCategoryRows() {
  const rows = db.prepare(`
    SELECT c.*, p.name_ru as parent_name,
      (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND COALESCE(child.is_active, 1) = 1) as children_count,
      (SELECT COUNT(*) FROM products prod WHERE prod.is_active = 1 AND (
        prod.category_id = c.id OR COALESCE(prod.primary_category_id, 0) = c.id OR EXISTS (
          SELECT 1 FROM product_categories pc WHERE pc.product_id = prod.id AND pc.category_id = c.id
        )
      )) as product_count
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
  `).all() as any[];
  const levels = categoryLevelMap(rows);
  return rows.map((row) => ({
    ...row,
    level: levels.get(row.id) || 0,
    children_count: Number(row.children_count || 0),
    product_count: Number(row.product_count || 0),
  }));
}


function sortCategoryExportRows(rows: any[]) {
  return [...rows].sort((a, b) => (
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
    || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru')
    || Number(a.id || 0) - Number(b.id || 0)
  ));
}

function buildCategoryTreeCsv() {
  const categories = db.prepare(`
    SELECT id, parent_id, name_ru, slug, sort_order, is_active, is_public
    FROM categories
  `).all() as any[];
  const byId = new Map<number, any>();
  const childrenByParent = new Map<string, any[]>();

  for (const category of categories) byId.set(Number(category.id), category);
  for (const category of categories) {
    const parentId = category.parent_id ? Number(category.parent_id) : null;
    const key = parentId && byId.has(parentId) ? String(parentId) : 'root';
    childrenByParent.set(key, [...(childrenByParent.get(key) || []), category]);
  }
  for (const [key, rows] of childrenByParent.entries()) childrenByParent.set(key, sortCategoryExportRows(rows));

  const productCategoryRows = db.prepare(`
    SELECT category_id, product_id
    FROM (
      SELECT category_id AS category_id, id AS product_id
      FROM products
      WHERE is_active = 1 AND category_id IS NOT NULL
      UNION ALL
      SELECT primary_category_id AS category_id, id AS product_id
      FROM products
      WHERE is_active = 1 AND primary_category_id IS NOT NULL
      UNION ALL
      SELECT pc.category_id AS category_id, pc.product_id AS product_id
      FROM product_categories pc
      JOIN products p ON p.id = pc.product_id
      WHERE p.is_active = 1 AND pc.category_id IS NOT NULL
    )
    WHERE category_id IS NOT NULL
  `).all() as any[];
  const directProductIds = new Map<number, Set<number>>();
  for (const row of productCategoryRows) {
    const categoryId = Number(row.category_id || 0);
    const productId = Number(row.product_id || 0);
    if (!categoryId || !productId) continue;
    if (!directProductIds.has(categoryId)) directProductIds.set(categoryId, new Set<number>());
    directProductIds.get(categoryId)?.add(productId);
  }

  const totalCache = new Map<number, Set<number>>();
  const collectSubtreeProductIds = (categoryId: number, seen = new Set<number>()): Set<number> => {
    const cached = totalCache.get(categoryId);
    if (cached) return new Set(cached);
    if (seen.has(categoryId)) return new Set<number>();
    const nextSeen = new Set(seen);
    nextSeen.add(categoryId);
    const total = new Set<number>(directProductIds.get(categoryId) || []);
    for (const child of childrenByParent.get(String(categoryId)) || []) {
      for (const productId of collectSubtreeProductIds(Number(child.id), nextSeen)) total.add(productId);
    }
    totalCache.set(categoryId, total);
    return new Set(total);
  };

  const headers = [
    'id', 'parent_id', 'level', 'path', 'name', 'slug', 'position', 'is_active', 'is_public',
    'children_count', 'product_count_direct', 'product_count_total',
  ];
  const lines = [headers.map(csvCell).join(';')];
  const walk = (category: any, level: number, parentPath: string[], seen = new Set<number>()) => {
    const categoryId = Number(category.id || 0);
    if (!categoryId || seen.has(categoryId)) return;
    const pathParts = [...parentPath, category.name_ru || category.slug || String(categoryId)];
    const children = childrenByParent.get(String(categoryId)) || [];
    const directCount = directProductIds.get(categoryId)?.size || 0;
    const totalCount = collectSubtreeProductIds(categoryId).size;
    const row = [
      categoryId,
      category.parent_id || '',
      level,
      pathParts.join(' > '),
      category.name_ru || '',
      category.slug || '',
      category.sort_order ?? 0,
      category.is_active ?? 1,
      category.is_public ?? 1,
      children.length,
      directCount,
      totalCount,
    ];
    lines.push(row.map(csvCell).join(';'));
    const nextSeen = new Set(seen);
    nextSeen.add(categoryId);
    for (const child of children) walk(child, level + 1, pathParts, nextSeen);
  };

  for (const root of childrenByParent.get('root') || []) walk(root, 0, []);
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function selectedCategoriesForDelete(ids: number[]) {
  if (!ids.length) return [];
  const rows = getCategoryRows();
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as any[];
}

function buildCategoryDeletePreview(ids: number[]) {
  const selected = selectedCategoriesForDelete(ids);
  const deletable: any[] = [];
  const blocked: any[] = [];
  for (const category of selected) {
    const reasons: string[] = [];
    if (Number(category.children_count || 0) > 0) reasons.push(`Есть дочерние категории: ${category.children_count}`);
    if (Number(category.product_count || 0) > 0) reasons.push(`Есть товары: ${category.product_count}`);
    if (reasons.length) blocked.push({ ...category, reasons });
    else deletable.push(category);
  }
  return {
    deletable,
    blocked,
    summary: { requested: ids.length, deletable: deletable.length, blocked: blocked.length },
  };
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function timestampForFilename() {
  return new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
}

function buildCategoryPath(categoryId: number | null | undefined, categoriesById: Map<number, any>, warnings: string[]) {
  if (!categoryId) return 'NO_CATEGORY';
  const parts: string[] = [];
  const seen = new Set<number>();
  let current = categoriesById.get(Number(categoryId));
  let depth = 0;
  if (!current) {
    warnings.push(`MISSING_CATEGORY:${categoryId}`);
    return 'MISSING_CATEGORY';
  }
  while (current) {
    if (seen.has(Number(current.id)) || depth > 50) {
      warnings.push(`CATEGORY_CYCLE_ERROR:${categoryId}`);
      return 'CATEGORY_CYCLE_ERROR';
    }
    seen.add(Number(current.id));
    parts.push(current.name_ru || current.slug || String(current.id));
    current = current.parent_id ? categoriesById.get(Number(current.parent_id)) : null;
    depth += 1;
  }
  return parts.reverse().join(' > ');
}

function isDescendantCategory(candidateParentId: number, categoryId: number, categoriesById: Map<number, any>) {
  const seen = new Set<number>();
  let current = categoriesById.get(candidateParentId);
  let depth = 0;
  while (current) {
    if (Number(current.id) === categoryId) return true;
    if (seen.has(Number(current.id)) || depth > 50) return true;
    seen.add(Number(current.id));
    current = current.parent_id ? categoriesById.get(Number(current.parent_id)) : null;
    depth += 1;
  }
  return false;
}

const updateDocument = (documentId: string, body: any) => {
  db.prepare('UPDATE product_documents SET document_name=?, document_type=?, language=?, version=?, is_public=?, sort_order=? WHERE id=?').run(body.document_name, body.document_type || 'other', body.language || 'ru', body.version || '1.0', body.is_public ? 1 : 0, Number(body.sort_order || 0), documentId);
};

router.post('/login', (req, res) => {
  const { password, username } = req.body;
  if (!isAdminAuthConfigured()) return res.status(503).json({ error: 'Admin auth is not configured' });
  if (username === 'admin' && verifyAdminPassword(password)) return res.json({ token: createAdminToken(), username: 'admin' });
  return res.status(401).json({ error: 'Invalid credentials' });
});

router.get('/me', requireAdmin, (_req, res) => res.json({ username: 'admin' }));

router.get('/warm-floor/settings', requireAdmin, (_req, res) => {
  res.json(getAdminWarmFloorSettings());
});

router.put('/warm-floor/settings', requireAdmin, (req, res) => {
  const value = { ...DEFAULT_WARM_FLOOR_SETTINGS, ...(req.body || {}) };
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
  `).run('warm_floor_calculator', JSON.stringify(value));
  res.json(value);
});

router.get('/debug/status', requireAdmin, (_req, res) => {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any)?.count || 0);
  const scalarCount = (sql: string) => Number((db.prepare(sql).get() as any)?.count || 0);
  const latestImport = (db.prepare('SELECT * FROM import_logs ORDER BY id DESC LIMIT 1').get() as any) || null;
  const backupsDir = path.resolve(process.cwd(), '../backups');
  const latestBackup = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir)
        .map((name) => {
          const fullPath = path.join(backupsDir, name);
          const stat = fs.statSync(fullPath);
          return stat.isFile() ? { name, path: fullPath, mtimeMs: stat.mtimeMs } : null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.mtimeMs - a.mtimeMs)[0] || null
    : null;

  res.json({
    activeDatabasePath: dbPath,
    counts: {
      categories: scalarCount('SELECT COUNT(*) AS count FROM categories WHERE COALESCE(is_active, 1) = 1 AND COALESCE(is_public, 1) = 1'),
      brands: scalarCount('SELECT COUNT(*) AS count FROM brands WHERE COALESCE(is_active, 1) = 1'),
      products: scalarCount('SELECT COUNT(*) AS count FROM products WHERE COALESCE(is_active, 1) = 1'),
      product_documents: scalarCount('SELECT COUNT(*) AS count FROM product_documents WHERE COALESCE(is_active, 1) = 1 AND COALESCE(is_public, 1) = 1'),
      import_logs: count('import_logs'),
    },
    rawCounts: {
      categories: count('categories'),
      brands: count('brands'),
      products: count('products'),
      product_documents: count('product_documents'),
    },
    latestImport,
    latestBackup,
    templatePath: path.resolve(process.cwd(), '../data/imports/templates/ohmx-products-template.csv'),
    demoCsvPath: path.resolve(process.cwd(), '../data/imports/examples/ohmx-products-demo-3.csv'),
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});
router.get('/categories', requireAdmin, (req, res) => {
  const rows = getCategoryRows();
  const search = String(req.query.search || '').trim().toLowerCase();
  const level = String(req.query.level || '');
  const parentId = String(req.query.parentId || '');
  const isActive = String(req.query.isActive || '');
  const isPublic = String(req.query.isPublic || '');
  const hasChildren = String(req.query.hasChildren || '');
  const hasProducts = String(req.query.hasProducts || '');
  const filtered = rows.filter((row) => {
    const depth = Number(row.level || 0);
    const levelOk = !level || (level === 'root' ? depth === 0 : level === 'child' ? depth === 1 : depth >= 2);
    const searchOk = !search || [row.name_ru, row.slug, row.parent_name, row.id].filter(Boolean).join(' ').toLowerCase().includes(search);
    const parentOk = !parentId || (parentId === 'null' ? !row.parent_id : Number(row.parent_id || 0) === Number(parentId));
    const activeOk = !isActive || (isActive === 'true' ? Number(row.is_active ?? 1) === 1 : Number(row.is_active ?? 1) === 0);
    const publicOk = !isPublic || (isPublic === 'true' ? Number(row.is_public ?? 1) === 1 : Number(row.is_public ?? 1) === 0);
    const childrenOk = !hasChildren || (hasChildren === 'true' ? Number(row.children_count || 0) > 0 : Number(row.children_count || 0) === 0);
    const productsOk = !hasProducts || (hasProducts === 'true' ? Number(row.product_count || 0) > 0 : Number(row.product_count || 0) === 0);
    return levelOk && searchOk && parentOk && activeOk && publicOk && childrenOk && productsOk;
  });
  const sortBy = String(req.query.sortBy || 'sort_order');
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru');
    if (sortBy === 'id') return Number(a.id) - Number(b.id);
    if (sortBy === 'products') return Number(b.product_count || 0) - Number(a.product_count || 0);
    if (sortBy === 'children') return Number(b.children_count || 0) - Number(a.children_count || 0);
    return Number(a.parent_id || 0) - Number(b.parent_id || 0) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru');
  });
  res.json(sorted);
});

router.get('/categories/export-tree.csv', requireAdmin, (_req, res) => {
  const filename = `ohmx_category_tree_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buildCategoryTreeCsv());
});

router.post('/categories/bulk-delete-preview', requireAdmin, (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (!ids.length) return res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
  res.json(buildCategoryDeletePreview(ids));
});

router.get('/categories/options', requireAdmin, (_req, res) => {
  const rows = getCategoryRows().map((category) => ({
    id: category.id,
    name: category.name_ru,
    name_ru: category.name_ru,
    slug: category.slug,
    parent_id: category.parent_id,
    level: category.level,
    sort_order: category.sort_order,
    is_active: category.is_active,
    is_public: category.is_public,
  }));
  res.json(rows);
});

router.post('/categories/bulk', requireAdmin, (req, res) => {
  const ids = parseIds(req.body?.ids);
  const action = String(req.body?.action || '');
  const allowed = new Set(['soft_delete', 'set_active', 'set_inactive', 'set_visible', 'set_hidden', 'recalculate_sort_order', 'update_parent']);
  if (!ids.length) return res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
  if (!allowed.has(action)) return res.status(400).json({ error: 'Unsupported bulk action' });

  const placeholders = ids.map(() => '?').join(',');
  if (action === 'soft_delete') {
    const preview = buildCategoryDeletePreview(ids);
    if (preview.blocked.length) return res.status(409).json({ error: 'Some categories are blocked from delete', preview });
    db.prepare(`UPDATE categories SET is_active=0, is_public=0, is_public_card=0, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
    return res.json({ ok: true, affected: ids.length });
  }
  if (action === 'set_active') db.prepare(`UPDATE categories SET is_active=1, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  if (action === 'set_inactive') db.prepare(`UPDATE categories SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  if (action === 'set_visible') db.prepare(`UPDATE categories SET is_public=1, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  if (action === 'set_hidden') db.prepare(`UPDATE categories SET is_public=0, is_public_card=0, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  if (action === 'recalculate_sort_order') {
    const rows = db.prepare(`SELECT id, parent_id FROM categories WHERE id IN (${placeholders}) ORDER BY parent_id, name_ru`).all(...ids) as any[];
    const tx = db.transaction(() => {
      const byParent = new Map<string, any[]>();
      for (const row of rows) {
        const key = String(row.parent_id ?? 'root');
        byParent.set(key, [...(byParent.get(key) || []), row]);
      }
      const update = db.prepare('UPDATE categories SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
      for (const group of byParent.values()) group.forEach((row, index) => update.run((index + 1) * 10, row.id));
    });
    tx();
  }
  if (action === 'update_parent') {
    const parentId = req.body?.parentId === null || req.body?.parentId === '' ? null : Number(req.body?.parentId);
    if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) return res.status(400).json({ error: 'parentId must be a number or null' });
    if (parentId !== null && ids.includes(parentId)) return res.status(400).json({ error: 'Cannot move category into itself' });
    if (parentId !== null) {
      const allCategories = db.prepare('SELECT id, parent_id FROM categories').all() as any[];
      const byId = new Map(allCategories.map((category) => [Number(category.id), category]));
      if (!byId.has(parentId)) return res.status(400).json({ error: 'Parent category not found' });
      for (const id of ids) {
        if (isDescendantCategory(parentId, id, byId)) return res.status(400).json({ error: `Cannot move category ${id} into its own descendant` });
      }
    }
    db.prepare(`UPDATE categories SET parent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(parentId, ...ids);
  }
  return res.json({ ok: true, affected: ids.length });
});

router.get('/categories/:id', requireAdmin, (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  res.json(category);
});

router.post('/categories', requireAdmin, (req, res) => {
  const body = req.body;
  const info = db.prepare(`
    INSERT INTO categories (parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru, image_url, icon, sort_order, is_active, is_public_card)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.parent_id || null,
    body.name_ru,
    body.name_hy || '',
    body.name_en || '',
    body.slug || slugify(body.name_ru),
    body.description_ru || '',
    body.short_description_ru || '',
    body.image_url || '',
    body.icon || '',
    Number(body.sort_order || 0),
    body.is_active ? 1 : 0,
    body.is_public_card ? 1 : 0,
  );
  res.json({ id: Number(info.lastInsertRowid) });
});

router.put('/categories/:id', requireAdmin, (req, res) => {
  const body = req.body;
  db.prepare(`
    UPDATE categories SET parent_id=?, name_ru=?, name_hy=?, name_en=?, slug=?, description_ru=?, short_description_ru=?, image_url=?, icon=?, sort_order=?, is_active=?, is_public_card=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    body.parent_id || null,
    body.name_ru,
    body.name_hy || '',
    body.name_en || '',
    body.slug || slugify(body.name_ru),
    body.description_ru || '',
    body.short_description_ru || '',
    body.image_url || '',
    body.icon || '',
    Number(body.sort_order || 0),
    body.is_active ? 1 : 0,
    body.is_public_card ? 1 : 0,
    req.params.id,
  );
  res.json({ ok: true, id: req.params.id });
});

router.delete('/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const preview = buildCategoryDeletePreview([id]);
  if (!preview.deletable.length || preview.blocked.length) return res.status(409).json({ error: 'Category is blocked from delete', preview });
  db.prepare('UPDATE categories SET is_active=0, is_public=0, is_public_card=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  res.json({ ok: true });
});

router.get('/brands', requireAdmin, (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const brands = db.prepare('SELECT * FROM brands ORDER BY is_popular DESC, sort_order ASC, name ASC').all() as any[];
  res.json(brands.filter((brand) => !search || [brand.name, brand.slug, brand.country].filter(Boolean).join(' ').toLowerCase().includes(search)));
});

router.get('/brands/:id', requireAdmin, (req, res) => {
  const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(brand);
});

router.post('/brands', requireAdmin, (req, res) => {
  const body = req.body;
  const info = db.prepare('INSERT INTO brands (name, country, logo_url, description_ru, website_url, slug, is_active, sort_order, is_popular) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    body.name,
    body.country || '',
    body.logo_url || '',
    body.description_ru || '',
    body.website_url || '',
    body.slug || slugify(body.name),
    body.is_active ? 1 : 0,
    Number(body.sort_order || 0),
    body.is_popular ? 1 : 0,
  );
  res.json({ id: Number(info.lastInsertRowid) });
});

router.put('/brands/:id', requireAdmin, (req, res) => {
  const body = req.body;
  db.prepare('UPDATE brands SET name=?, country=?, logo_url=?, description_ru=?, website_url=?, slug=?, is_active=?, sort_order=?, is_popular=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    body.name,
    body.country || '',
    body.logo_url || '',
    body.description_ru || '',
    body.website_url || '',
    body.slug || slugify(body.name),
    body.is_active ? 1 : 0,
    Number(body.sort_order || 0),
    body.is_popular ? 1 : 0,
    req.params.id,
  );
  res.json({ ok: true, id: req.params.id });
});

router.delete('/brands/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE brands SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/series', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT s.*, b.name as brand_name, c.name_ru as category_name
    FROM series s
    LEFT JOIN brands b ON b.id = s.brand_id
    LEFT JOIN categories c ON c.id = s.category_id
    ORDER BY s.name
  `).all();
  res.json(rows);
});

router.post('/series', requireAdmin, (req, res) => {
  const body = req.body;
  const info = db.prepare('INSERT INTO series (brand_id,category_id,name,slug,description_ru,image_url,is_active) VALUES (?,?,?,?,?,?,1)').run(body.brand_id || null, body.category_id || null, body.name, body.slug || slugify(body.name), body.description_ru || '', body.image_url || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/series/:id', requireAdmin, (req, res) => {
  const body = req.body;
  db.prepare('UPDATE series SET brand_id=?, category_id=?, name=?, slug=?, description_ru=?, image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body.brand_id || null, body.category_id || null, body.name, body.slug || slugify(body.name), body.description_ru || '', body.image_url || '', req.params.id);
  res.json({ ok: true, id: req.params.id });
});

router.delete('/series/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE series SET is_active=0, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/products', requireAdmin, (req, res) => {
  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (req.query.q) {
    const q = `%${String(req.query.q)}%`;
    where.push('(p.sku LIKE ? OR p.name_ru LIKE ? OR p.name_en LIKE ? OR p.name_hy LIKE ? OR b.name LIKE ?)');
    params.push(q, q, q, q, q);
  }
  if (req.query.categoryId) {
    where.push('p.category_id = ?');
    params.push(Number(req.query.categoryId));
  }
  if (req.query.brandId) {
    where.push('p.brand_id = ?');
    params.push(Number(req.query.brandId));
  }
  if (req.query.isActive === 'true') where.push('p.is_active = 1');
  if (req.query.isActive === 'false') where.push('p.is_active = 0');
  if (req.query.inStock === 'true') where.push('COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) > 0');
  const rows = productSelect(where.join(' AND '), params);
  const sortBy = String(req.query.sortBy || 'updated');
  const sorted = [...rows].sort((a: any, b: any) => {
    if (sortBy === 'name') return String(a.name_ru).localeCompare(String(b.name_ru), 'ru');
    if (sortBy === 'price') return Number(b.price_amd || 0) - Number(a.price_amd || 0);
    if (sortBy === 'sku') return String(a.sku).localeCompare(String(b.sku), 'en');
    return Number(b.id) - Number(a.id);
  });
  res.json(sorted.slice(0, Number(req.query.limit || 200)));
});

router.get('/products/export', requireAdmin, (req, res) => {
  if (String(req.query.format || 'csv') !== 'csv') return res.status(400).json({ error: 'Only csv export is currently supported' });
  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  const search = String(req.query.search || req.query.q || '').trim();
  if (search) {
    const q = `%${search}%`;
    where.push('(p.sku LIKE ? OR p.name_ru LIKE ? OR p.name_en LIKE ? OR p.name_hy LIKE ? OR b.name LIKE ?)');
    params.push(q, q, q, q, q);
  }
  if (req.query.categoryId) {
    where.push('(p.category_id = ? OR COALESCE(p.primary_category_id, 0) = ? OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?))');
    params.push(Number(req.query.categoryId), Number(req.query.categoryId), Number(req.query.categoryId));
  }
  if (req.query.brandId) {
    where.push('p.brand_id = ?');
    params.push(Number(req.query.brandId));
  }
  if (req.query.isActive === 'true') where.push('p.is_active = 1');
  if (req.query.isActive === 'false') where.push('p.is_active = 0');
  if (req.query.includeInactive !== 'true' && !req.query.isActive) where.push('p.is_active = 1');
  if (req.query.isPublic === 'true' || req.query.includeHidden === 'false') where.push('COALESCE(p.show_price, 1) = 1');
  if (req.query.hasImages === 'true') where.push('EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)');
  if (req.query.hasImages === 'false') where.push('NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)');
  if (req.query.hasDocuments === 'true') where.push('EXISTS (SELECT 1 FROM product_documents pd WHERE pd.product_id = p.id AND COALESCE(pd.is_active, 1) = 1)');
  if (req.query.hasDocuments === 'false') where.push('NOT EXISTS (SELECT 1 FROM product_documents pd WHERE pd.product_id = p.id AND COALESCE(pd.is_active, 1) = 1)');

  const products = productSelect(where.join(' AND '), params) as any[];
  const categories = db.prepare('SELECT * FROM categories').all() as any[];
  const categoriesById = new Map(categories.map((category) => [Number(category.id), category]));
  const categoryLevels = categoryLevelMap(categories);
  const warnings: string[] = [];
  const productIds = products.map((product) => Number(product.id)).filter(Boolean);
  const productPlaceholders = productIds.map(() => '?').join(',');
  const featureRows = productIds.length
    ? db.prepare(`SELECT product_id, feature_name, feature_value, feature_unit FROM product_features WHERE product_id IN (${productPlaceholders}) ORDER BY product_id, sort_order, id`).all(...productIds) as any[]
    : [];
  const featuresByProduct = new Map<number, any[]>();
  for (const feature of featureRows) {
    const productId = Number(feature.product_id || 0);
    if (!productId) continue;
    featuresByProduct.set(productId, [...(featuresByProduct.get(productId) || []), feature]);
  }

  const safeAttributeColumn = (name: string) => {
    const base = slugify(String(name || '').trim())
      .replace(/-/g, '_')
      .replace(/[^a-z0-9а-яё_]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    return `attr_${base || 'attribute'}`;
  };
  const attributeHeaderByName = new Map<string, string>();
  const usedAttributeHeaders = new Set<string>();
  const attributeNames = [...new Set(featureRows.map((feature) => String(feature.feature_name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  for (const name of attributeNames) {
    const base = safeAttributeColumn(name);
    let header = base;
    let index = 2;
    while (usedAttributeHeaders.has(header)) {
      header = `${base}_${index}`;
      index += 1;
    }
    usedAttributeHeaders.add(header);
    attributeHeaderByName.set(name, header);
  }
  const attributeHeaders = [...attributeHeaderByName.values()];

  const buildCategoryTrail = (categoryId: number | null | undefined, productWarnings: string[]) => {
    if (!categoryId) return [] as any[];
    const trail: any[] = [];
    const seen = new Set<number>();
    let current = categoriesById.get(Number(categoryId));
    let depth = 0;
    if (!current) {
      productWarnings.push(`MISSING_CATEGORY:${categoryId}`);
      return trail;
    }
    while (current) {
      const currentId = Number(current.id || 0);
      if (!currentId || seen.has(currentId) || depth > 50) {
        productWarnings.push(`CATEGORY_CYCLE_ERROR:${categoryId}`);
        return trail.reverse();
      }
      seen.add(currentId);
      trail.push(current);
      current = current.parent_id ? categoriesById.get(Number(current.parent_id)) : null;
      depth += 1;
    }
    return trail.reverse();
  };

  const headers = [
    'product_id', 'sku', 'vendor_code', 'barcode', 'slug', 'name', 'title', 'short_name',
    'brand_id', 'brand_name', 'brand_slug', 'manufacturer_name', 'country_of_origin',
    'category_id', 'category_name', 'category_slug', 'category_level', 'category_path', 'root_category_name',
    'parent_category_id', 'parent_category_name', 'menu_path', 'category_is_active', 'category_is_public',
    'full_category_path', 'main_category_id', 'main_category_path', 'additional_category_ids', 'additional_category_paths',
    'series_id', 'series_name', 'collection_name',
    'price', 'old_price', 'wholesale_price', 'purchase_price', 'currency', 'vat', 'unit', 'min_order_qty', 'package_qty',
    'stock_quantity', 'warehouse_name', 'availability_status',
    'is_active', 'is_public', 'is_featured', 'is_new', 'is_sale', 'sort_order', 'created_at', 'updated_at',
    'short_description', 'description', 'full_description', 'technical_description', 'notes',
    'seo_title', 'seo_description', 'meta_title', 'meta_description', 'meta_keywords', 'canonical_url',
    'main_image_url', 'image_count', 'image_urls',
    'document_count', 'document_names', 'document_urls', 'datasheet_url', 'manual_url', 'certificate_url',
    'attributes_json', 'attributes_count', ...attributeHeaders,
    'related_product_ids', 'analog_product_ids', 'replacement_product_ids', 'export_warnings',
  ];

  const lines = [headers.map(csvCell).join(';')];
  for (const product of products) {
    const productWarnings: string[] = [];
    const mainCategoryId = Number(product.primary_category_id || product.category_id || 0) || null;
    if (!mainCategoryId) productWarnings.push('NO_CATEGORY');
    const category = mainCategoryId ? categoriesById.get(mainCategoryId) : null;
    if (mainCategoryId && !category) productWarnings.push(`MISSING_CATEGORY:${mainCategoryId}`);
    const parent = category?.parent_id ? categoriesById.get(Number(category.parent_id)) : null;
    const categoryTrail = buildCategoryTrail(mainCategoryId, productWarnings);
    const categoryPath = categoryTrail.map((item) => item.name_ru || item.slug || item.id).join(' > ');
    const rootCategory = categoryTrail[0] || null;
    const additionalCategoryRows = db.prepare('SELECT category_id FROM product_categories WHERE product_id = ? ORDER BY is_primary DESC, category_id').all(product.id) as any[];
    const additionalIds = additionalCategoryRows.map((row) => Number(row.category_id)).filter((id) => id && id !== mainCategoryId);
    const additionalPaths = additionalIds.map((id) => buildCategoryPath(id, categoriesById, productWarnings));
    const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_cover DESC, sort_order, id').all(product.id) as any[];
    const docs = db.prepare('SELECT * FROM product_documents WHERE product_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY sort_order, id').all(product.id) as any[];
    const stockRows = db.prepare('SELECT s.*, w.name as warehouse_name FROM stock s LEFT JOIN warehouses w ON w.id = s.warehouse_id WHERE s.product_id = ? ORDER BY w.sort_order, w.name').all(product.id) as any[];
    const features = featuresByProduct.get(Number(product.id)) || [];
    const featureValuesByName = new Map<string, string[]>();
    for (const feature of features) {
      const name = String(feature.feature_name || '').trim();
      if (!name) continue;
      const value = [feature.feature_value, feature.feature_unit].filter((item) => item !== null && item !== undefined && String(item).trim() !== '').join(' ');
      featureValuesByName.set(name, [...(featureValuesByName.get(name) || []), value]);
    }
    const attributesJson = featureValuesByName.size
      ? JSON.stringify(Object.fromEntries([...featureValuesByName.entries()].map(([name, values]) => [name, values.join(' | ')])))
      : '';
    const stockQuantity = stockRows.reduce((sum, row) => sum + Number(row.available_quantity ?? row.quantity ?? 0), 0);
    const docByType = (type: string) => docs.find((doc) => String(doc.document_type || '').toLowerCase().includes(type))?.file_url || '';
    const attributeValues = attributeNames.map((name) => (featureValuesByName.get(name) || []).join(' | '));
    const row = [
      product.id, product.sku, product.supplier_reference || '', '', product.slug, product.name_ru, product.name_ru, '',
      product.brand_id || '', product.brand_name || '', product.brand_slug || '', product.brand_name || '', '',
      mainCategoryId || '', category?.name_ru || (mainCategoryId ? 'MISSING_CATEGORY' : 'NO_CATEGORY'), category?.slug || '', category ? categoryLevels.get(category.id) || 0 : '', categoryPath, rootCategory?.name_ru || '',
      category?.parent_id || '', parent?.name_ru || '', categoryPath, category?.is_active ?? '', category?.is_public ?? '',
      categoryPath, mainCategoryId || '', categoryPath, additionalIds.join(','), additionalPaths.join(' | '),
      product.series_id || '', product.series_name || '', product.series_name || '',
      product.price_amd ?? '', '', '', '', product.currency || 'AMD', product.price_tax_included ?? '', product.unit || '', '', '',
      stockQuantity || product.stock_quantity || '', stockRows.map((row) => row.warehouse_name).filter(Boolean).join(' | '), product.availability_status || '',
      product.is_active ?? '', product.show_price ?? '', product.is_featured ?? '', '', '', product.sort_order ?? '', product.created_at || '', product.updated_at || '',
      product.short_description_ru || '', product.description_ru || '', product.description_ru || '', '', product.legacy_categories || '',
      product.seo_title_ru || '', product.seo_description_ru || '', product.seo_title_ru || '', product.seo_description_ru || '', '', '',
      images[0]?.image_url || product.cover_image || '', images.length, images.map((image) => image.image_url).join(' | '),
      docs.length, docs.map((doc) => doc.document_name).join(' | '), docs.map((doc) => doc.file_url).join(' | '), docByType('data'), docByType('manual'), docByType('cert'),
      attributesJson, features.length, ...attributeValues,
      '', '', '', [...new Set([...warnings, ...productWarnings])].join(' | '),
    ];
    lines.push(row.map(csvCell).join(';'));
  }

  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  const filename = `ohmx_products_export_${timestampForFilename()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Full catalog export: every product (active and inactive), one row per product, streamed in batches.
// The snapshot comes from a separate read-only connection in product-id ranges, so the storefront keeps responding.
// Read-only; an error after streaming started aborts the connection so a partial file never looks complete.
router.get('/products/export/full', requireAdmin, async (_req, res) => {
  let snapshot: Awaited<ReturnType<typeof loadCatalogSnapshotPaged>>;
  try {
    snapshot = await loadCatalogSnapshotPaged(dbPath, { calculatorInference: loadCalculatorInference });
  } catch (error) {
    console.error('Full catalog export failed while reading the catalog', error);
    return res.status(500).json({ error: 'Full catalog export failed' });
  }
  const exportedAt = new Date();
  const options = { storageRoot, exportedAt: exportedAt.toISOString() };
  const products = snapshot.products;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(exportedAt)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Export-Row-Count', String(products.length));
  res.setHeader('X-Export-Schema-Version', EXPORT_SCHEMA_VERSION);
  res.write(CSV_BOM + csvLine(FULL_EXPORT_COLUMNS));
  let index = 0;
  const writeBatch = () => {
    if (res.destroyed) return;
    try {
      const chunk: string[] = [];
      for (let count = 0; count < 50 && index < products.length; count += 1, index += 1) {
        chunk.push(csvLine(rowValues(buildProductRow(products[index], snapshot, options))));
      }
      const flushed = res.write(chunk.join(''));
      if (index >= products.length) return void res.end();
      // Always resume through setImmediate: running the next batch inside 'drain' starves new connections.
      if (flushed) setImmediate(writeBatch);
      else res.once('drain', () => setImmediate(writeBatch));
    } catch (error) {
      console.error(`Full catalog export failed at product index ${index}`, error);
      res.destroy(error as Error);
    }
  };
  setImmediate(writeBatch);
});

router.get('/products/:id', requireAdmin, (req, res) => {
  const product = db.prepare('SELECT p.*, b.name as brand_name, b.slug as brand_slug, s.name as series_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN series s ON s.id = p.series_id WHERE p.id = ?').get(req.params.id) as any;
  if (!product) return res.status(404).json({ error: 'Product not found' });
  product.features = db.prepare('SELECT * FROM product_features WHERE product_id = ? ORDER BY sort_order').all(product.id);
  product.stock = db.prepare('SELECT s.*, w.name as warehouse_name FROM stock s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.product_id = ? ORDER BY w.sort_order').all(product.id);
  product.documents = db.prepare('SELECT * FROM product_documents WHERE product_id = ? ORDER BY sort_order, id').all(product.id);
  product.images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_cover DESC, sort_order').all(product.id);
  res.json(product);
});

router.post('/products', requireAdmin, (req, res) => {
  const body = req.body;
  const info = db.prepare(`
    INSERT INTO products (sku,name_ru,name_hy,name_en,slug,brand_id,series_id,category_id,short_description_ru,description_ru,price_amd,currency,unit,is_active,is_featured,seo_title_ru,seo_description_ru,cooling_power_kw,heating_power_kw,recommended_area_m2,equipment_type,suitable_for_cooling,suitable_for_heating,is_calculator_accessory,accessory_group,accessory_default_enabled,warm_floor_product_type,warm_floor_linear_power_wm,warm_floor_cable_length_m,warm_floor_mat_area_m2,warm_floor_voltage_v,warm_floor_room_types,warm_floor_floor_coverings,warm_floor_substrate_types,warm_floor_wet_zone_allowed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    body.sku,
    body.name_ru,
    body.name_hy || '',
    body.name_en || '',
    body.slug || slugify(`${body.sku}-${body.name_ru}`),
    body.brand_id || null,
    body.series_id || null,
    body.category_id || null,
    body.short_description_ru || '',
    body.description_ru || '',
    body.price_amd || 0,
    body.currency || 'AMD',
    body.unit || 'шт',
    body.is_active ? 1 : 0,
    body.is_featured ? 1 : 0,
    body.seo_title_ru || body.name_ru,
    body.seo_description_ru || body.short_description_ru || '',
    optionalNumber(body.cooling_power_kw),
    optionalNumber(body.heating_power_kw),
    optionalNumber(body.recommended_area_m2),
    body.equipment_type || '',
    body.suitable_for_cooling ? 1 : 0,
    body.suitable_for_heating ? 1 : 0,
    body.is_calculator_accessory ? 1 : 0,
    body.accessory_group || '',
    body.accessory_default_enabled === false ? 0 : 1,
    body.warm_floor_product_type || '',
    optionalNumber(body.warm_floor_linear_power_wm),
    optionalNumber(body.warm_floor_cable_length_m),
    optionalNumber(body.warm_floor_mat_area_m2),
    optionalNumber(body.warm_floor_voltage_v),
    jsonString(body.warm_floor_room_types),
    jsonString(body.warm_floor_floor_coverings),
    jsonString(body.warm_floor_substrate_types),
    body.warm_floor_wet_zone_allowed === '' || body.warm_floor_wet_zone_allowed === null || body.warm_floor_wet_zone_allowed === undefined ? null : (body.warm_floor_wet_zone_allowed ? 1 : 0),
  );
  const productId = Number(info.lastInsertRowid);
  syncProductMeta(productId, body);
  res.json({ id: productId });
});

router.put('/products/:id', requireAdmin, (req, res) => {
  const body = req.body;
  db.prepare(`
    UPDATE products SET sku=?, name_ru=?, name_hy=?, name_en=?, slug=?, brand_id=?, series_id=?, category_id=?, short_description_ru=?, description_ru=?, price_amd=?, currency=?, unit=?, is_active=?, is_featured=?, seo_title_ru=?, seo_description_ru=?, cooling_power_kw=?, heating_power_kw=?, recommended_area_m2=?, equipment_type=?, suitable_for_cooling=?, suitable_for_heating=?, is_calculator_accessory=?, accessory_group=?, accessory_default_enabled=?, warm_floor_product_type=?, warm_floor_linear_power_wm=?, warm_floor_cable_length_m=?, warm_floor_mat_area_m2=?, warm_floor_voltage_v=?, warm_floor_room_types=?, warm_floor_floor_coverings=?, warm_floor_substrate_types=?, warm_floor_wet_zone_allowed=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    body.sku,
    body.name_ru,
    body.name_hy || '',
    body.name_en || '',
    body.slug || slugify(`${body.sku}-${body.name_ru}`),
    body.brand_id || null,
    body.series_id || null,
    body.category_id || null,
    body.short_description_ru || '',
    body.description_ru || '',
    body.price_amd || 0,
    body.currency || 'AMD',
    body.unit || 'шт',
    body.is_active ? 1 : 0,
    body.is_featured ? 1 : 0,
    body.seo_title_ru || body.name_ru,
    body.seo_description_ru || body.short_description_ru || '',
    optionalNumber(body.cooling_power_kw),
    optionalNumber(body.heating_power_kw),
    optionalNumber(body.recommended_area_m2),
    body.equipment_type || '',
    body.suitable_for_cooling ? 1 : 0,
    body.suitable_for_heating ? 1 : 0,
    body.is_calculator_accessory ? 1 : 0,
    body.accessory_group || '',
    body.accessory_default_enabled === false ? 0 : 1,
    body.warm_floor_product_type || '',
    optionalNumber(body.warm_floor_linear_power_wm),
    optionalNumber(body.warm_floor_cable_length_m),
    optionalNumber(body.warm_floor_mat_area_m2),
    optionalNumber(body.warm_floor_voltage_v),
    jsonString(body.warm_floor_room_types),
    jsonString(body.warm_floor_floor_coverings),
    jsonString(body.warm_floor_substrate_types),
    body.warm_floor_wet_zone_allowed === '' || body.warm_floor_wet_zone_allowed === null || body.warm_floor_wet_zone_allowed === undefined ? null : (body.warm_floor_wet_zone_allowed ? 1 : 0),
    req.params.id,
  );
  syncProductMeta(Number(req.params.id), body);
  res.json({ ok: true, id: req.params.id });
});

router.delete('/products/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE products SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/documents/:id', requireAdmin, (req, res) => {
  const documentId = String(req.params.id);
  updateDocument(documentId, req.body);
  res.json({ ok: true, id: documentId });
});

router.delete('/documents/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE product_documents SET is_active=0, is_public=0, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(req.params.id));
  res.json({ ok: true });
});

router.put('/products/:id/documents/:documentId', requireAdmin, (req, res) => {
  const documentId = String(req.params.documentId);
  const productId = String(req.params.id);
  const exists = db.prepare('SELECT id FROM product_documents WHERE id = ? AND product_id = ?').get(documentId, productId);
  if (!exists) return res.status(404).json({ error: 'Document not found' });
  updateDocument(documentId, req.body);
  res.json({ ok: true, id: documentId });
});

router.delete('/products/:id/documents/:documentId', requireAdmin, (req, res) => {
  const documentId = String(req.params.documentId);
  const productId = String(req.params.id);
  db.prepare('UPDATE product_documents SET is_active=0, is_public=0, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = ? AND product_id = ?').run(documentId, productId);
  res.json({ ok: true, id: documentId });
});

router.get('/import/logs', requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT * FROM import_logs ORDER BY id DESC LIMIT 20').all());
});

export default router;
