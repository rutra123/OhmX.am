import { Router } from 'express';
import { db } from '../db.js';
import { productSelect } from '../utils/query.js';
import { toPublicBrandDto, toPublicProductCardDto } from '../utils/productDtos.js';

const router = Router();

function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

router.get('/', (_req, res) => {
  const brands = db.prepare('SELECT id, name, country, logo_url, description_ru, website_url, slug, sort_order, is_popular FROM brands WHERE is_active = 1 ORDER BY is_popular DESC, sort_order ASC, name ASC').all() as any[];
  res.json(brands.map(toPublicBrandDto));
});

router.get('/:slug', (req, res) => {
  const brand = db.prepare('SELECT id, name, country, logo_url, description_ru, website_url, slug, sort_order, is_popular FROM brands WHERE slug = ? AND is_active = 1').get(req.params.slug) as any;
  if (!brand) return res.status(404).json({ error: 'Not found' });
  const products = productSelect('p.is_active = 1 AND b.slug = ?', [req.params.slug]).slice(0, 60).map(toPublicProductCardDto);
  const categoryRows = db.prepare(`
    SELECT
      c.id,
      c.name_ru,
      c.slug,
      c.sort_order,
      COUNT(DISTINCT p.id) AS products_count
    FROM products p
    JOIN categories c ON c.id = p.category_id AND c.is_active = 1
    WHERE p.brand_id = ? AND p.is_active = 1
    GROUP BY c.id
    ORDER BY c.sort_order, c.name_ru
  `).all(brand.id);

  const categoriesByName = new Map<string, any>();
  for (const row of categoryRows as any[]) {
    const key = normalizeCategoryName(row.name_ru || '');
    if (!key) continue;
    const existing = categoriesByName.get(key);
    if (!existing) {
      categoriesByName.set(key, row);
      continue;
    }

    const rowCount = Number(row.products_count || 0);
    const existingCount = Number(existing.products_count || 0);
    const totalCount = existingCount + rowCount;
    const rowSort = Number(row.sort_order || 0);
    const existingSort = Number(existing.sort_order || 0);
    if (rowCount > existingCount || (rowCount === existingCount && rowSort < existingSort)) {
      categoriesByName.set(key, { ...row, products_count: totalCount });
    } else {
      existing.products_count = totalCount;
    }
  }

  const categories = [...categoriesByName.values()]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ru || '').localeCompare(String(b.name_ru || ''), 'ru'))
    .map(({ sort_order, ...category }) => category);

  res.json({ ...toPublicBrandDto(brand), categories, products });
});

export default router;
