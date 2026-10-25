import { Router } from 'express';
import { db } from '../db.js';
import { normalizeSearchText } from '../utils/searchRanking.js';

const router = Router();

router.get('/', (req, res) => {
  const q = normalizeSearchText(String(req.query.q || ''));
  const brand = String(req.query.brand || '').trim();
  const category = String(req.query.category || '').trim();

  const documents = db.prepare(`
    SELECT d.*, p.slug AS product_slug, p.sku, p.name_ru, b.name AS brand_name, b.slug AS brand_slug, c.name_ru AS category_name, c.slug AS category_slug
    FROM product_documents d
    JOIN products p ON p.id = d.product_id AND p.is_active = 1
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE d.is_public = 1 AND COALESCE(d.is_active, 1) = 1
    ORDER BY d.created_at DESC, d.id DESC
  `).all() as any[];

  let filtered = documents;
  if (brand) filtered = filtered.filter((item) => item.brand_slug === brand);
  if (category) filtered = filtered.filter((item) => item.category_slug === category);
  if (q) {
    filtered = filtered.filter((item) => normalizeSearchText([
      item.document_name,
      item.document_type,
      item.sku,
      item.name_ru,
      item.brand_name,
      item.category_name,
    ].filter(Boolean).join(' ')).includes(q));
  }

  const brands = Array.from(new Map(documents.filter((item) => item.brand_slug).map((item) => [item.brand_slug, { slug: item.brand_slug, name: item.brand_name }])).values())
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const categories = Array.from(new Map(documents.filter((item) => item.category_slug).map((item) => [item.category_slug, { slug: item.category_slug, name_ru: item.category_name }])).values())
    .sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'));

  res.json({ documents: filtered.slice(0, 200), brands, categories });
});

export default router;
