import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { productSelect } from '../utils/query.js';
import { toPublicProductCardDto, toPublicProductDetailDto, toPublicProductDocumentDto } from '../utils/productDtos.js';
import { appendSalesModeWhere } from '../utils/salesMode.js';
import { emptyPublicProductRelationships, getPublicProductRelationships } from '../services/productRelationshipsService.js';
import { getProductSeriesKit } from '../services/productSeriesKitService.js';

// Import bookkeeping rows (e.g. "source: legacy-import") are not product specifications.
const INTERNAL_FEATURE_NAMES = new Set(['source']);

const router = Router();

function collectProductCategoryTrails(productId: number, primaryCategoryId?: number | null) {
  type CategoryRow = { id: number; parent_id: number | null; name_ru: string; name_en: string | null; name_hy: string | null; slug: string };
  const categories = db.prepare('SELECT id, parent_id, name_ru, name_en, name_hy, slug FROM categories WHERE is_active = 1').all() as CategoryRow[];
  const byId = new Map(categories.map((item) => [item.id, item]));
  const linkedRows = db.prepare('SELECT category_id FROM product_categories WHERE product_id = ?').all(productId) as Array<{ category_id: number }>;
  const linkedIds = new Set<number>(linkedRows.map((row) => Number(row.category_id)).filter(Boolean));
  if (primaryCategoryId) linkedIds.add(Number(primaryCategoryId));

  const buildTrail = (categoryId: number) => {
    const trail: Array<Omit<CategoryRow, 'parent_id'>> = [];
    let current = byId.get(categoryId);
    while (current) {
      trail.unshift({ id: current.id, slug: current.slug, name_ru: current.name_ru, name_en: current.name_en, name_hy: current.name_hy });
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return trail;
  };

  const isAncestor = (candidateId: number, targetId: number) => {
    let current = byId.get(targetId);
    while (current?.parent_id) {
      if (current.parent_id === candidateId) return true;
      current = byId.get(current.parent_id);
    }
    return false;
  };

  const idList = Array.from(linkedIds);
  const leafIds = idList.filter((categoryId) => !idList.some((otherId) => otherId !== categoryId && isAncestor(categoryId, otherId)));
  const paths = leafIds
    .map((categoryId) => buildTrail(categoryId))
    .filter((trail) => trail.length)
    .sort((a, b) => b.length - a.length || a.map((item) => item.name_ru).join(' > ').localeCompare(b.map((item) => item.name_ru).join(' > '), 'ru'));

  const primaryTrail = primaryCategoryId ? paths.find((trail) => trail[trail.length - 1]?.id === Number(primaryCategoryId)) || buildTrail(Number(primaryCategoryId)) : [];

  return {
    breadcrumbs: primaryTrail.map((item, index) => ({
      label: item.name_ru,
      // Translations for the client's UI language (empty = keep the Russian label).
      name_en: item.name_en || '',
      name_hy: item.name_hy || '',
      slug: item.slug,
      to: index === 0 ? `/catalog/${item.slug}` : `/catalog/${primaryTrail[0]?.slug}/${primaryTrail.slice(1, index + 1).map((part) => part.slug).join('/')}`,
    })),
    categoryPaths: paths.map((trail) => ({
      label: trail.map((item) => item.name_ru).join(' > '),
      label_en: trail.map((item) => item.name_en || item.name_ru).join(' > '),
      label_hy: trail.map((item) => item.name_hy || item.name_ru).join(' > '),
      slugs: trail.map((item) => item.slug),
      url: trail.length === 1 ? `/catalog/${trail[0].slug}` : `/catalog/${trail[0].slug}/${trail.slice(1).map((item) => item.slug).join('/')}`,
    })),
  };
}

router.get('/', (req, res) => {
  const where: string[] = ['p.is_active = 1'];
  const params: any[] = [];
  if (req.query.q) {
    where.push('(p.sku LIKE ? OR p.name_ru LIKE ? OR p.name_en LIKE ? OR p.name_hy LIKE ? OR b.name LIKE ?)');
    const q = `%${String(req.query.q)}%`;
    params.push(q, q, q, q, q);
  }
  if (req.query.category) {
    where.push(`(
      c.slug = ?
      OR p.category_id = ?
      OR COALESCE(p.primary_category_id, 0) = ?
      OR EXISTS (
        SELECT 1 FROM product_categories pc
        JOIN categories c2 ON c2.id = pc.category_id
        WHERE pc.product_id = p.id AND (c2.slug = ? OR pc.category_id = ?)
      )
    )`);
    params.push(String(req.query.category), String(req.query.category), String(req.query.category), String(req.query.category), String(req.query.category));
  }
  if (req.query.brand) {
    where.push('b.slug = ?');
    params.push(String(req.query.brand));
  }
  if (String(req.query.inStock || '') === 'true') where.push('COALESCE((SELECT SUM(s.available_quantity) FROM stock s WHERE s.product_id = p.id), 0) > 0');
  if (String(req.query.hasDocs || '') === 'true') where.push('(SELECT COUNT(*) FROM product_documents d WHERE d.product_id = p.id AND d.is_public = 1 AND COALESCE(d.is_active, 1) = 1) > 0');
  appendSalesModeWhere(where, params, req.query.saleMode);
  if (req.query.minPrice) {
    where.push('p.price_amd >= ?');
    params.push(Number(req.query.minPrice));
  }
  if (req.query.maxPrice) {
    where.push('p.price_amd <= ?');
    params.push(Number(req.query.maxPrice));
  }
  const items = productSelect(where.join(' AND '), params);
  res.json(items.slice(0, Number(req.query.limit || 100)).map(toPublicProductCardDto));
});

router.get('/by-id/:id', requireAdmin, (req, res) => {
  const product = db.prepare('SELECT p.*, b.name as brand_name, b.slug as brand_slug, s.name as series_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN series s ON s.id = p.series_id WHERE p.id = ?').get(req.params.id) as any;
  if (!product) return res.status(404).json({ error: 'Not found' });
  product.features = db.prepare('SELECT id, feature_name, feature_value, feature_unit, sort_order FROM product_features WHERE product_id = ? ORDER BY sort_order').all(product.id);
  product.stock = db.prepare('SELECT s.*, w.name as warehouse_name FROM stock s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.product_id = ? ORDER BY w.sort_order').all(product.id);
  product.documents = db.prepare('SELECT * FROM product_documents WHERE product_id = ? ORDER BY sort_order, id').all(product.id);
  product.images = db.prepare('SELECT id, image_url, alt_text, is_cover, sort_order FROM product_images WHERE product_id = ? ORDER BY is_cover DESC, sort_order').all(product.id);
  res.json({ product });
});

router.get('/:slug/documents', (req, res) => {
  const product = db.prepare('SELECT id, slug FROM products WHERE slug = ? AND is_active = 1').get(req.params.slug) as any;
  if (!product) return res.status(404).json({ error: 'Not found' });
  const documents = db.prepare('SELECT id, document_name, document_type, file_url, file_extension, file_size, language, version, sort_order FROM product_documents WHERE product_id = ? AND is_public = 1 AND COALESCE(is_active, 1) = 1 ORDER BY sort_order, id').all(product.id);
  res.json({ productId: product.id, slug: product.slug, documents: documents.map(toPublicProductDocumentDto) });
});

router.get('/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT
      p.id, p.sku, p.name_ru, p.name_hy, p.name_en, p.slug, p.brand_id, p.series_id,
      p.primary_category_id, p.category_id, p.short_description_ru, p.description_ru,
      p.price_amd, p.currency, p.unit, p.show_price, p.availability_status,
      p.cooling_power_kw, p.heating_power_kw, p.recommended_area_m2, p.equipment_type,
      p.energy_source, p.system_type, p.warm_floor_product_type, p.warm_floor_linear_power_wm,
      p.warm_floor_cable_length_m, p.warm_floor_mat_area_m2, p.warm_floor_voltage_v,
      p.warm_floor_room_types, p.warm_floor_floor_coverings, p.warm_floor_substrate_types,
      p.warm_floor_wet_zone_allowed, p.seo_title_ru, p.seo_description_ru,
      b.name as brand_name, b.slug as brand_slug, sr.name as series_name, sr.slug as series_slug,
      c.name_ru as category_name, c.slug as category_slug,
      COALESCE((SELECT SUM(s.available_quantity) FROM stock s WHERE s.product_id = p.id),0) as available_quantity,
      COALESCE((SELECT COUNT(*) FROM product_documents d WHERE d.product_id = p.id AND d.is_public = 1 AND COALESCE(d.is_active, 1) = 1), 0) AS documents_count,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id AND i.is_cover = 1 ORDER BY i.sort_order LIMIT 1) AS cover_image
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN series sr ON sr.id = p.series_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    WHERE p.slug = ? AND p.is_active = 1
  `).get(req.params.slug) as any;
  if (!product) return res.status(404).json({ error: 'Not found' });
  product.features = db.prepare('SELECT id, feature_name, feature_value, feature_unit, sort_order FROM product_features WHERE product_id = ? ORDER BY sort_order').all(product.id)
    .filter((feature: any) => !INTERNAL_FEATURE_NAMES.has(String(feature.feature_name || '').trim().toLowerCase()) && String(feature.feature_value || '').trim());
  product.images = db.prepare('SELECT id, image_url, alt_text, is_cover, sort_order FROM product_images WHERE product_id = ? ORDER BY is_cover DESC, sort_order').all(product.id);
  product.documents = db.prepare('SELECT id, document_name, document_type, file_url, file_extension, file_size, language, version, sort_order FROM product_documents WHERE product_id = ? AND is_public = 1 AND COALESCE(is_active, 1) = 1 ORDER BY sort_order, id').all(product.id);
  const categoryMeta = collectProductCategoryTrails(product.id, product.primary_category_id || product.category_id || null);
  product.breadcrumbs = categoryMeta.breadcrumbs;
  product.category_paths = categoryMeta.categoryPaths;

  const relatedWhere: string[] = ['p.is_active = 1', 'p.slug <> ?'];
  const relatedParams: any[] = [product.slug];
  if (product.category_id) {
    relatedWhere.push('p.category_id = ?');
    relatedParams.push(product.category_id);
  } else if (product.brand_id) {
    relatedWhere.push('p.brand_id = ?');
    relatedParams.push(product.brand_id);
  }

  let seriesKit = null;
  try {
    seriesKit = getProductSeriesKit(product);
  } catch (error) {
    console.warn('[product-series-kit] failed to build series kit', {
      productId: Number(product.id),
      error: error instanceof Error ? error.message : 'unknown_error',
    });
  }
  // Colour variants of the same model are shown separately; keep "similar" for real alternatives, in-stock first.
  const variantSlugs = new Set((seriesKit?.colorVariants || []).map((item) => item.slug));
  const relatedProducts = productSelect(relatedWhere.join(' AND '), relatedParams)
    .filter((row: any) => !variantSlugs.has(String(row.slug)))
    .sort((a: any, b: any) => (Number(b.available_quantity) > 0 ? 1 : 0) - (Number(a.available_quantity) > 0 ? 1 : 0))
    .map(toPublicProductCardDto)
    .slice(0, 6);

  let typedRelationships = emptyPublicProductRelationships();
  try {
    typedRelationships = getPublicProductRelationships(Number(product.id));
  } catch (error) {
    console.warn('[product-relationships] failed to load public typed relationships', {
      productId: Number(product.id),
      error: error instanceof Error ? error.message : 'unknown_error',
    });
  }

  res.json({
    product: toPublicProductDetailDto(product),
    relatedProducts,
    relatedProductGroups: typedRelationships.relatedProducts,
    compatibilityWarnings: typedRelationships.compatibilityWarnings,
    seriesKit,
  });
});

export default router;
