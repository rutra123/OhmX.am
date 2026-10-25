import fs from 'node:fs';
import { parse } from 'csv-parse';
import { db, slugify } from '../db.js';
import { getMappedCategorySlug, OHMX_ROOT_CATEGORIES } from '../utils/categoryMapping.js';

const CSV_DIR = new URL('../../../csv/', import.meta.url).pathname;

async function parseCsvFile(fileName: string): Promise<any[]> {
  const records: any[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(`${CSV_DIR}${fileName}`)
      .pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true, delimiter: ';', relax_column_count: true }))
      .on('data', (data) => records.push(data))
      .on('error', reject)
      .on('end', () => resolve(records));
  });
}

function parseImageUrls(urlsStr: string) {
  if (!urlsStr) return [];
  return urlsStr.split(',').map(s => s.trim()).filter(Boolean);
}

function parseFeatures(featureStr: string) {
  if (!featureStr) return [];
  const parts = featureStr.split(',');
  const features = [];
  for (const part of parts) {
    const [name, value, position, custom] = part.split(':');
    if (name && value) {
      features.push({ name: name.trim(), value: value.trim(), position: position || '0' });
    }
  }
  return features;
}

export async function runImport() {
  console.log('Starting Import Process...');
  
  // 1. Setup New Roots
  console.log('Setting up root categories...');
  for (const root of OHMX_ROOT_CATEGORIES) {
    const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(root.slug) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO categories (name_ru, slug, parent_id, is_active, is_public_card, is_public)
        VALUES (?, ?, NULL, 1, 1, 1)
      `).run(root.name, root.slug);
    }
  }

  // 2. Load Manufacturers
  console.log('Loading manufacturers...');
  const manufacturers = await parseCsvFile('manufacturer_2026-05-12.csv');
  for (const m of manufacturers) {
    let rawName = m['Имя'] || '';
    rawName = rawName.replace(/\(.*\)/, '').trim(); // Remove (France) etc
    const isActive = m['Включено'] === '1' ? 1 : 0;
    const slug = slugify(rawName);
    
    if (!rawName) continue;
    
    const existing = db.prepare('SELECT id FROM brands WHERE slug = ?').get(slug) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO brands (name, slug, is_active)
        VALUES (?, ?, ?)
      `).run(rawName, slug, isActive);
    }
  }

  // 3. Load Products
  console.log('Loading products...');
  const products = await parseCsvFile('product_2026-05-12.csv');
  
  let importedProducts = 0;
  let unmappedCategories = new Set<string>();
  
  const insertProducts = db.transaction(() => {
    for (const p of products) {
      const sku = p['Reference #']?.trim() || p['ID'];
      if (!sku) continue;
      
      let brandRaw = p['Производитель']?.replace(/\(.*\)/, '').trim() || '';
      let brandId = null;
      if (brandRaw) {
        const brandRow = db.prepare('SELECT id FROM brands WHERE slug = ?').get(slugify(brandRaw)) as any;
        if (brandRow) brandId = brandRow.id;
      }

      const categoriesStr = p['Categories (x,y,z...)'] || '';
      const rootSlug = getMappedCategorySlug(categoriesStr, p['Имя'] || '');
      const rootRow = db.prepare('SELECT id FROM categories WHERE slug = ?').get(rootSlug) as any;
      
      if (rootSlug === 'elektrika') {
        categoriesStr.split(',').forEach((c: string) => unmappedCategories.add(c.trim()));
      }

      const isActive = p['Active (0/1)'] === '1' ? 1 : 0;
      const name = p['Имя'] || '';
      const shortDesc = p['Короткое описание'] || '';
      const desc = p['Описание'] || '';
      const priceStr = p['Price tax included'] || p['Price tax excluded'] || '0';
      const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
      const showPrice = p['Show price'] === '1' ? 1 : 0;
      
      // Default availability based on quantity but do NOT show exactly
      const qtyStr = p['Количество'] || '0';
      const qty = parseFloat(qtyStr) || 0;
      const availability = qty > 0 ? 'in_stock' : 'on_request';
      
      let slug = p['URL rewritten']?.trim() || slugify(name + '-' + sku);
      slug = slugify(slug + '-' + sku.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());

      // Upsert product
      let productId;
      const existingProduct = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as any;
      if (existingProduct) {
        productId = existingProduct.id;
        db.prepare(`
          UPDATE products SET 
            name_ru = ?, slug = ?, brand_id = ?, primary_category_id = ?, short_description_ru = ?,
            description_ru = ?, price_amd = ?, show_price = ?, availability_status = ?, is_active = ?
          WHERE id = ?
        `).run(name, slug, brandId, rootRow?.id || null, shortDesc, desc, price, showPrice, availability, isActive, productId);
      } else {
        const res = db.prepare(`
          INSERT INTO products (
            sku, name_ru, slug, brand_id, primary_category_id, short_description_ru,
            description_ru, price_amd, show_price, availability_status, is_active, stock_quantity
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sku, name, slug, brandId, rootRow?.id || null, shortDesc, desc, price, showPrice, availability, isActive, qty);
        productId = res.lastInsertRowid;
      }
      
      // Link category
      if (rootRow) {
        db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, 1)').run(productId, rootRow.id);
      }

      // Images
      const imageUrls = parseImageUrls(p['Image URLs (x,y,z...)']);
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
      imageUrls.forEach((url, idx) => {
        db.prepare('INSERT INTO product_images (product_id, image_url, sort_order, is_cover) VALUES (?, ?, ?, ?)').run(productId, url, idx, idx === 0 ? 1 : 0);
      });

      // Features
      const features = parseFeatures(p['Feature (Name:Value:Position:Customized)']);
      db.prepare('DELETE FROM product_features WHERE product_id = ?').run(productId);
      features.forEach(f => {
        db.prepare('INSERT INTO product_features (product_id, feature_name, feature_value, sort_order) VALUES (?, ?, ?, ?)').run(productId, f.name, f.value, f.position);
      });

      importedProducts++;
    }
  });
  
  insertProducts();

  const report = {
    importedProducts,
    unmappedCategories: Array.from(unmappedCategories),
  };
  
  fs.writeFileSync(new URL('../../import_report.json', import.meta.url).pathname, JSON.stringify(report, null, 2));
  fs.writeFileSync(new URL('../../unmapped_categories.csv', import.meta.url).pathname, 'Category\n' + Array.from(unmappedCategories).join('\n'));
  
  console.log('Import finished! Report written to import_report.json');
}

if (process.argv[1].includes('importOldSiteCsv')) {
  runImport().catch(console.error);
}
