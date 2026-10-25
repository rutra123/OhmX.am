import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { toPublicProductDocumentDto, toPublicProductSearchDto } from '../utils/productDtos.js';
import { unicodeFoldForSearch } from '../utils/searchRanking.js';
import { appendSalesModeWhere } from '../utils/salesMode.js';
import { canonicalLabelForCategory } from '../utils/navigationComposer.js';
import { ensureCatalogSearchIndex, searchCatalog, searchCatalogBrands, searchCatalogCategories } from '../services/catalogSearchIndex.js';
const router = Router();
// Build the in-memory search index right after startup instead of on the first visitor's query.
setImmediate(() => {
    ensureCatalogSearchIndex().catch((error) => console.warn('[search] index warm-up failed', error instanceof Error ? error.message : error));
});
// Express 4 does not catch rejected promises from async handlers.
function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => unknown) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(handler(req, res, next)).catch((error) => {
            console.error('[search] request failed', error instanceof Error ? error.message : error);
            if (!res.headersSent)
                res.status(500).json({ error: 'Search failed' });
        });
    };
}
function placeholders(values: unknown[]) {
    return values.map(() => '?').join(',');
}
/** Rows for ids, returned in the order of ids. */
function rowsInOrder(sql: string, ids: number[]): any[] {
    if (!ids.length)
        return [];
    const rows = db.prepare(sql.replace('__IDS__', placeholders(ids))).all(...ids);
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    return ids.map((id) => byId.get(Number(id))).filter(Boolean);
}
/** Applies the saleMode filter to ranked ids, keeping their order. */
function filterIdsBySaleMode(ids: number[], saleMode: unknown) {
    const where: string[] = [];
    const params: unknown[] = [];
    appendSalesModeWhere(where, params, saleMode);
    if (!where.length || !ids.length)
        return ids;
    const allowed = new Set<number>();
    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        for (const row of db.prepare(`SELECT p.id FROM products p WHERE p.id IN (${placeholders(chunk)}) AND ${where.join(' AND ')}`).all(...chunk, ...params))
            allowed.add(Number(row.id));
    }
    return ids.filter((id) => allowed.has(Number(id)));
}
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const DEFAULT_SUGGESTION_LIMIT = 8;
const MAX_SUGGESTION_LIMIT = 10;
const DOCUMENT_LIMIT = 20;
// SQLite LIKE/UPPER are ASCII-only for case. Register JS Unicode fold once for this connection.
db.function('unicode_fold', { deterministic: true }, (value: unknown) => unicodeFoldForSearch(value));
function parsePage(value: unknown) {
    const page = Number(value || 1);
    return Number.isInteger(page) && page > 0 ? page : 1;
}
function parseLimit(value: unknown, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
    const limit = Number(value || defaultLimit);
    if (!Number.isInteger(limit) || limit <= 0)
        return defaultLimit;
    return Math.min(limit, maxLimit);
}
function escapeLike(value: unknown) {
    return String(value || '').trim().replace(/[\\%_]/g, '\\$&');
}
/** Fold query first, then wrap for LIKE — both sides use unicode_fold / folded patterns. */
function likePattern(value: unknown) {
    return `%${escapeLike(unicodeFoldForSearch(value))}%`;
}
function buildCategoryUrl(category: any, categoriesById: Map<number, any>) {
    // Canonical navigation href: single-slug catalog path (shared with menus)
    if (category?.slug)
        return `/catalog/${category.slug}`;
    const trail = [];
    let current = category;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        trail.unshift(current);
        current = current.parent_id ? categoriesById.get(Number(current.parent_id)) : null;
    }
    return `/catalog/${trail.map((item) => item.slug).filter(Boolean).join('/')}`;
}
router.get('/suggestions', asyncRoute(async (req: Request, res: Response) => {
    const qRaw = String(req.query.q || '').trim();
    if (qRaw.length < 2)
        return res.json({ suggestions: [] });
    const suggestionLimit = parseLimit(req.query.limit, DEFAULT_SUGGESTION_LIMIT, MAX_SUGGESTION_LIMIT);
    const idx = await ensureCatalogSearchIndex();
    const found = searchCatalog(qRaw, idx);
    const productSuggestions = rowsInOrder(`
    SELECT p.id, p.sku, p.slug, p.name_ru, p.brand_id, p.series_id,
      COALESCE(p.primary_category_id, p.category_id) AS category_id,
      b.name as brand_name,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order, i.id LIMIT 1) AS cover_image
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.id IN (__IDS__)
  `, found.ids.slice(0, suggestionLimit));
    const productItems = productSuggestions.map((product) => ({
        id: `product-${product.id}`,
        type: 'product',
        label: product.name_ru,
        detail: [product.brand_name, product.sku ? `SKU ${product.sku}` : ''].filter(Boolean).join(' · '),
        value: product.sku || product.name_ru,
        url: `/product/${product.slug}`,
        imageUrl: product.cover_image || '',
        score: 0,
    }));
    const relatedProductItems = (() => {
        const includeRelated = req.query.related === '1' || req.query.related === 'true';
        if (!includeRelated || productSuggestions.length === 0 || productSuggestions.length >= suggestionLimit)
            return [];
        const directIds = [...new Set(productSuggestions.map((product) => Number(product.id)).filter(Boolean))];
        const brandIds = [...new Set(productSuggestions.map((product) => Number(product.brand_id)).filter(Boolean))];
        const seriesIds = [...new Set(productSuggestions.map((product) => Number(product.series_id)).filter(Boolean))];
        const categoryIds = [...new Set(productSuggestions.map((product) => Number(product.category_id)).filter(Boolean))];
        const relatedClauses = [];
        const relatedParams = [];
        if (seriesIds.length) {
            relatedClauses.push(`p.series_id IN (${seriesIds.map(() => '?').join(',')})`);
            relatedParams.push(...seriesIds);
        }
        if (brandIds.length) {
            relatedClauses.push(`p.brand_id IN (${brandIds.map(() => '?').join(',')})`);
            relatedParams.push(...brandIds);
        }
        if (categoryIds.length) {
            const categoryPlaceholders = categoryIds.map(() => '?').join(',');
            relatedClauses.push(`(
        COALESCE(p.primary_category_id, p.category_id) IN (${categoryPlaceholders})
        OR EXISTS (
          SELECT 1 FROM product_categories pc
          WHERE pc.product_id = p.id AND pc.category_id IN (${categoryPlaceholders})
        )
      )`);
            relatedParams.push(...categoryIds, ...categoryIds);
        }
        if (!relatedClauses.length || !directIds.length)
            return [];
        const directPlaceholders = directIds.map(() => '?').join(',');
        const relatedLimit = Math.max(0, suggestionLimit - productSuggestions.length);
        const rows = db.prepare(`
      SELECT p.id, p.sku, p.slug, p.name_ru, p.brand_id, p.series_id,
        COALESCE(p.primary_category_id, p.category_id) AS category_id,
        b.name as brand_name,
        (SELECT image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order, i.id LIMIT 1) AS cover_image
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.is_active = 1
        AND p.id NOT IN (${directPlaceholders})
        AND (${relatedClauses.join(' OR ')})
      ORDER BY p.is_featured DESC, p.id DESC
      LIMIT ?
    `).all(...directIds, ...relatedParams, relatedLimit);
        return rows.map((product) => {
            const score = -1000
                + (seriesIds.includes(Number(product.series_id)) ? 80 : 0)
                + (brandIds.includes(Number(product.brand_id)) ? 50 : 0)
                + (categoryIds.includes(Number(product.category_id)) ? 35 : 0);
            return {
                id: `product-${product.id}`,
                type: 'product',
                label: product.name_ru,
                detail: ['Похожий товар', product.brand_name, product.sku ? `SKU ${product.sku}` : ''].filter(Boolean).join(' · '),
                value: product.sku || product.name_ru,
                url: `/product/${product.slug}`,
                imageUrl: product.cover_image || '',
                score,
            };
        });
    })();
    const categories = rowsInOrder('SELECT id, parent_id, name_ru, name_en, slug FROM categories WHERE id IN (__IDS__)', searchCatalogCategories(qRaw, 3, idx));
    const categoryParents = db.prepare('SELECT id, parent_id, slug FROM categories WHERE is_active = 1 AND COALESCE(is_public, 1) != 0').all() as any[];
    const categoriesById = new Map([...categoryParents, ...categories].map((category) => [Number(category.id), category]));
    const categorySuggestions = categories.map((category) => ({
        id: `category-${category.id}`,
        type: 'category',
        label: canonicalLabelForCategory(Number(category.id), category.name_ru),
        detail: 'Категория',
        value: canonicalLabelForCategory(Number(category.id), category.name_ru),
        url: buildCategoryUrl(category, categoriesById),
    }));
    const brandSuggestions = rowsInOrder('SELECT id, name, slug, country FROM brands WHERE id IN (__IDS__)', searchCatalogBrands(qRaw, 2, idx))
        .map((brand) => ({
        id: `brand-${brand.id}`,
        type: 'brand',
        label: brand.name,
        detail: brand.country ? `Бренд · ${brand.country}` : 'Бренд',
        value: brand.name,
        url: `/brands/${brand.slug}`,
    }));
    // Matching brands and categories first (one tap to a whole section), then products.
    const sectionItems = [...brandSuggestions, ...categorySuggestions].slice(0, Math.max(0, Math.min(3, suggestionLimit - 3)));
    const suggestions = [...sectionItems, ...productItems, ...relatedProductItems]
        .slice(0, suggestionLimit)
        .map(({ score, ...suggestion }: { score?: number; [key: string]: unknown }) => suggestion);
    res.json({ suggestions });
}));
router.get('/', asyncRoute(async (req: Request, res: Response) => {
    const qRaw = String(req.query.q || '').trim();
    const page = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;
    if (!qRaw) {
        return res.json({
            query: '',
            products: [],
            documents: [],
            pagination: { page, limit, total: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        });
    }
    const idx = await ensureCatalogSearchIndex();
    const found = searchCatalog(qRaw, idx);
    const rankedIds = filterIdsBySaleMode(found.ids, req.query.saleMode);
    const total = rankedIds.length;
    const rows = rowsInOrder(`
    SELECT
      p.id, p.sku, p.name_ru, p.name_hy, p.name_en, p.slug,
      p.brand_id, p.series_id, p.primary_category_id, p.category_id,
      p.short_description_ru, p.price_amd, p.currency, p.unit, p.show_price, p.availability_status,
      b.name as brand_name, b.slug as brand_slug,
      c.name_ru as category_name, c.slug as category_slug,
      s.name as series_name, s.slug as series_slug,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id AND i.is_cover = 1 ORDER BY i.sort_order LIMIT 1) AS cover_image,
      (SELECT COUNT(*) FROM product_documents d WHERE d.product_id = p.id AND d.is_public = 1 AND COALESCE(d.is_active, 1) = 1) AS documents_count,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity,
      COALESCE((SELECT GROUP_CONCAT(pc.category_id) FROM product_categories pc WHERE pc.product_id = p.id), '') AS category_ids_csv
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE p.id IN (__IDS__)
  `, rankedIds.slice(offset, offset + limit));
    const products = rows.map(toPublicProductSearchDto).filter((product) => product?.id && product?.slug);
    const documentPattern = likePattern(qRaw);
    const documentRows = db.prepare(`
    SELECT
      d.id, d.document_name, d.document_type, d.file_url, d.file_extension, d.file_size, d.language, d.version, d.sort_order,
      p.slug as product_slug, p.sku, p.name_ru, b.name as brand_name,
      (CASE WHEN unicode_fold(d.document_name) LIKE ? ESCAPE '\\' THEN 1000 ELSE 0 END
       + CASE WHEN unicode_fold(p.sku) LIKE ? ESCAPE '\\' THEN 700 ELSE 0 END
       + CASE WHEN unicode_fold(p.name_ru) LIKE ? ESCAPE '\\' THEN 500 ELSE 0 END
       + CASE WHEN unicode_fold(b.name) LIKE ? ESCAPE '\\' THEN 300 ELSE 0 END) AS score
    FROM product_documents d
    JOIN products p ON p.id = d.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.is_active = 1
      AND d.is_public = 1
      AND COALESCE(d.is_active, 1) = 1
      AND (unicode_fold(d.document_name) LIKE ? ESCAPE '\\' OR unicode_fold(d.document_type) LIKE ? ESCAPE '\\' OR unicode_fold(p.sku) LIKE ? ESCAPE '\\' OR unicode_fold(p.name_ru) LIKE ? ESCAPE '\\' OR unicode_fold(b.name) LIKE ? ESCAPE '\\')
    ORDER BY score DESC, d.sort_order ASC, d.id DESC
    LIMIT ?
  `).all(documentPattern, documentPattern, documentPattern, documentPattern, documentPattern, documentPattern, documentPattern, documentPattern, documentPattern, DOCUMENT_LIMIT);
    const documents = documentRows
        .map((doc) => {
        const publicDocument = toPublicProductDocumentDto(doc);
        return {
            id: publicDocument.id,
            document_name: publicDocument.document_name,
            document_type: publicDocument.document_type,
            file_url: publicDocument.file_url,
            file_extension: publicDocument.file_extension,
            file_size: publicDocument.file_size,
            language: publicDocument.language,
            version: publicDocument.version,
            sort_order: publicDocument.sort_order,
            product_slug: doc.product_slug,
            sku: doc.sku,
            name_ru: doc.name_ru,
            brand_name: doc.brand_name,
        };
    })
        .filter((doc) => doc.file_url);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
        query: qRaw,
        // relaxed: nothing matched every word, results match all but one; correctedQuery: wrong keyboard layout fixed
        relaxed: found.relaxed,
        correctedQuery: found.correctedQuery,
        products,
        documents,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        },
    });
}));
export default router;
