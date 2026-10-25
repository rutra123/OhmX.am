import { db } from '../db.js';

type ProductSelectOptions = {
  includeFeatures?: boolean;
};

export function productSelect(where = '1=1', params: any[] = [], options: ProductSelectOptions = {}) {
  const rows = db.prepare(`
    SELECT
      p.id, p.sku, p.name_ru, p.name_hy, p.name_en, p.slug,
      p.brand_id, p.series_id, p.primary_category_id, p.category_id,
      p.short_description_ru, p.price_amd, p.currency, p.unit,
      p.show_price, p.availability_status,
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
    WHERE ${where}
    ORDER BY p.is_featured DESC, p.id DESC
  `).all(...params) as any[];

  if (!options.includeFeatures || !rows.length) return rows;

  const productIds = rows.map((row) => row.id);
  const placeholders = productIds.map(() => '?').join(',');
  const featureRows = db.prepare(`
    SELECT id, product_id, feature_name, feature_value, feature_unit, sort_order FROM product_features
    WHERE product_id IN (${placeholders})
    ORDER BY product_id, sort_order
  `).all(...productIds) as any[];

  const featuresByProductId = new Map<number, any[]>();
  for (const feature of featureRows) {
    const list = featuresByProductId.get(feature.product_id) || [];
    list.push(feature);
    featuresByProductId.set(feature.product_id, list);
  }

  return rows.map((row) => ({ ...row, features: featuresByProductId.get(row.id) || [] }));
}
