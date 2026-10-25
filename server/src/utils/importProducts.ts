import fs from 'node:fs';
import path from 'node:path';
import { db, slugify } from '../db.js';
import { storageRoot } from '../paths.js';

// Product photos from the legacy shop are mirrored to storage/images/products (same path after /img/),
// so re-imports must not bring back plain-http hotlinks to electro.am.
const LEGACY_IMAGE_RE = /^https?:\/\/(?:www\.)?electro\.am\/img\/([\w./-]+\.(?:jpe?g|png|webp|gif))(?:\?.*)?$/i;

function localizeImportImageUrl(value: string) {
  const match = String(value || '').trim().match(LEGACY_IMAGE_RE);
  if (!match) return value;
  const rel = path.posix.normalize(match[1]);
  if (!rel.startsWith('..') && fs.existsSync(path.join(storageRoot, 'images', 'products', rel))) return `/storage/images/products/${rel}`;
  return String(value).trim().replace(/^http:\/\//i, 'https://');
}

export type ImportOptions = {
  createMissingBrands?: boolean;
  createMissingCategories?: boolean;
};

type ParsedRow = Record<string, string>;

type PreviewRowMeta = {
  rowNumber: number;
  sku: string;
  name_ru: string;
  brand: string;
  categoryPath: string[];
  price_amd: string;
  active: string;
  errors: string[];
  warnings: string[];
  existingSku: boolean;
  action: 'create' | 'update';
  brandWillBeCreated: boolean;
  categoriesToCreate: string[];
};

function getCategoryLevels(item: ParsedRow) {
  const levels = Object.keys(item)
    .map((key) => {
      const match = key.match(/^category_level_(\d+)$/);
      return match ? { key, index: Number(match[1]) } : null;
    })
    .filter((entry): entry is { key: string; index: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index)
    .map(({ key }) => String(item[key] || '').trim())
    .filter(Boolean);

  return levels;
}

const rootCategorySlugMap: Record<string, string> = {
  'автоматика, реле и управление': 'avtomatika-i-upravlenie',
  'электрика': 'elektrika',
  'щиты и шкафы': 'shchity-i-shkafy',
  'кабельные системы': 'kabelnye-sistemy',
  'кабель, кабель-каналы и монтаж': 'kabelnye-sistemy',
  'водоснабжение, насосы и гидравлика': 'truboprovodnaya-armatura-i-gidravlika',
  'трубопроводная арматура и гидравлика': 'truboprovodnaya-armatura-i-gidravlika',
  'охлаждение, кондиционирование и hvac': 'hvac-i-okhlazhdenie',
  'hvac и охлаждение': 'hvac-i-okhlazhdenie',
  'розетки и выключатели': 'rozetki-i-vyklyuchateli',
  'электрическое отопление': 'elektricheskoe-otoplenie',
  'акции': 'akcii',
  'ибп, стабилизаторы и защита питания': 'silovoe-oborudovanie-i-ups',
  'силовое оборудование и ups': 'silovoe-oborudovanie-i-ups',
  'водяное отопление и котельная': 'vodyanoe-otoplenie-i-kotelnaya',
  'водяное отопление': 'vodyanoe-otoplenie-i-kotelnaya',
  'hvac и теплоснабжение': 'hvac-i-okhlazhdenie',
  'котельное оборудование': 'vodyanoe-otoplenie-i-kotelnaya',
  'трубопроводная арматура': 'truboprovodnaya-armatura-i-gidravlika',
  'автоматика и управление': 'avtomatika-i-upravlenie',
  'освещение': 'osveshchenie',
};

const approvedRootMeta: Record<string, { name: string; sortOrder: number }> = {
  elektrika: { name: 'Электрика', sortOrder: 10 },
  'rozetki-i-vyklyuchateli': { name: 'Розетки и выключатели', sortOrder: 20 },
  'shchity-i-shkafy': { name: 'Щиты и шкафы', sortOrder: 30 },
  'kabelnye-sistemy': { name: 'Кабельные системы', sortOrder: 40 },
  osveshchenie: { name: 'Освещение', sortOrder: 50 },
  'elektricheskoe-otoplenie': { name: 'Электрическое отопление', sortOrder: 60 },
  'vodyanoe-otoplenie-i-kotelnaya': { name: 'Водяное отопление и котельная', sortOrder: 70 },
  'hvac-i-okhlazhdenie': { name: 'HVAC и охлаждение', sortOrder: 80 },
  'truboprovodnaya-armatura-i-gidravlika': { name: 'Трубопроводная арматура и гидравлика', sortOrder: 90 },
  'silovoe-oborudovanie-i-ups': { name: 'Силовое оборудование и UPS', sortOrder: 100 },
  'avtomatika-i-upravlenie': { name: 'Автоматика и управление', sortOrder: 110 },
  'zapchasti-i-servis': { name: 'Запчасти и сервис', sortOrder: 120 },
  akcii: { name: 'Акции', sortOrder: 130 },
};

export function parseCsv(text: string, delimiter = ',') {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      if (current.length || row.length) {
        row.push(current.trim());
        rows.push(row);
      }
      current = '';
      row = [];
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows;
}

function parseBoolean(value: string) {
  return ['1', 'true', 'yes', 'y', 'active'].includes(String(value || '').trim().toLowerCase());
}

function parseFeatures(raw: string) {
  if (!raw) return [] as any[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isValidImportImageUrl(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return /\.(jpe?g|png|webp)(\?.*)?$/i.test(trimmed);
  if (trimmed.startsWith('/storage/') || trimmed.startsWith('/uploads/')) return /\.(jpe?g|png|webp)(\?.*)?$/i.test(trimmed);
  if (/[;]/.test(trimmed)) return false;
  return /^[\wа-яА-ЯёЁ ._/-]+\.(jpe?g|png|webp)$/i.test(trimmed);
}

function getRawImageUrls(item: ParsedRow) {
  if (item.image_urls_json) {
    try {
      const parsed = JSON.parse(item.image_urls_json);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value || '').trim()).filter(Boolean);
    } catch {
      // ignore
    }
  }
  return [item.image_1, item.image_2, item.image_3]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function parseImageUrls(item: ParsedRow) {
  return getRawImageUrls(item).filter(isValidImportImageUrl).map(localizeImportImageUrl);
}

function getInvalidImageUrls(item: ParsedRow) {
  return getRawImageUrls(item).filter((value) => !isValidImportImageUrl(value));
}

function splitLegacyCategories(value: string) {
  return String(value || '')
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getCategorySlug(name: string, parentId: number | null) {
  const normalized = name.trim().toLowerCase();
  return parentId ? slugify(`${parentId}-${name}`) : (rootCategorySlugMap[normalized] || slugify(name));
}

function simulateCategoryChain(item: ParsedRow) {
  const levels = getCategoryLevels(item);
  let parentId: number | null = null;
  const categoriesToCreate: string[] = [];

  for (const level of levels) {
    const slug = getCategorySlug(level, parentId);
    const existing = db.prepare('SELECT id FROM categories WHERE (slug = ? OR name_ru = ?) AND COALESCE(parent_id, 0) = COALESCE(?, 0)').get(slug, level, parentId) as any;
    if (existing) {
      parentId = existing.id;
      continue;
    }
    categoriesToCreate.push(level);
    parentId = -1;
  }

  return categoriesToCreate;
}

function validateRows(headers: string[], dataRows: string[][], options: ImportOptions) {
  const requiredColumns = ['sku', 'name_ru', 'brand', 'category_level_1'];
  const fileErrors: string[] = [];

  requiredColumns.forEach((column) => {
    if (!headers.includes(column)) fileErrors.push(`Missing required column: ${column}`);
  });

  const rows: ParsedRow[] = dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
  const previewRows: PreviewRowMeta[] = rows.map((item, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!item.sku) errors.push('SKU обязателен');
    if (!item.name_ru) errors.push('name_ru обязателен');
    if (!item.brand) errors.push('brand обязателен');
    if (!item.category_level_1) errors.push('category_level_1 обязателен');
    if (item.price_amd && Number.isNaN(Number(item.price_amd))) errors.push('price_amd должен быть числом');
    if (item.features_json && !parseFeatures(item.features_json).length) warnings.push('features_json не распознан или пуст');
    const invalidImageUrls = getInvalidImageUrls(item);
    if (invalidImageUrls.length) warnings.push(`некорректные изображения отброшены: ${invalidImageUrls.join(', ')}`);
    if (!parseImageUrls(item).length) warnings.push('изображения не найдены');

    const existingProduct = item.sku ? db.prepare('SELECT id FROM products WHERE sku = ?').get(item.sku) as any : null;
    const existingBrand = item.brand ? db.prepare('SELECT id FROM brands WHERE slug = ? OR name = ?').get(slugify(item.brand), item.brand) as any : null;
    const categoriesToCreate = item.category_level_1 ? simulateCategoryChain(item) : [];

    if (!existingBrand && !options.createMissingBrands) warnings.push('Бренд не найден и auto-create выключен');
    if (categoriesToCreate.length && !options.createMissingCategories) warnings.push('Категории не найдены и auto-create выключен');

    return {
      rowNumber: index + 2,
      sku: item.sku,
      name_ru: item.name_ru,
      brand: item.brand,
      categoryPath: getCategoryLevels(item),
      price_amd: item.price_amd,
      active: item.active,
      errors,
      warnings,
      existingSku: Boolean(existingProduct),
      action: existingProduct ? 'update' : 'create',
      brandWillBeCreated: !existingBrand,
      categoriesToCreate,
    };
  });

  const invalidImages = rows.flatMap((item, index) => getInvalidImageUrls(item).map((imageUrl) => ({ rowNumber: index + 2, sku: item.sku, imageUrl })));

  const summary = {
    total: previewRows.length,
    valid: previewRows.filter((row) => !row.errors.length).length,
    invalid: previewRows.filter((row) => row.errors.length).length,
    warnings: previewRows.reduce((acc, row) => acc + row.warnings.length, 0),
    toCreate: previewRows.filter((row) => row.action === 'create').length,
    toUpdate: previewRows.filter((row) => row.action === 'update').length,
    errors: previewRows.reduce((acc, row) => acc + row.errors.length, 0),
    invalidImageUrlCount: invalidImages.length,
    skippedImages: invalidImages,
  };

  const brandsToCreate = [...new Set(previewRows.filter((row) => row.brandWillBeCreated).map((row) => row.brand).filter(Boolean))];
  const categoriesToCreate = [...new Set(previewRows.flatMap((row) => row.categoriesToCreate))];
  const existingSkus = previewRows.filter((row) => row.existingSku).map((row) => row.sku);

  return { fileErrors, rows, previewRows, summary, brandsToCreate, categoriesToCreate, existingSkus };
}

function findOrCreateBrand(name: string, createMissing: boolean) {
  if (!name) return null;
  const slug = slugify(name);
  const existing = db.prepare('SELECT id FROM brands WHERE slug = ? OR name = ?').get(slug, name) as any;
  if (existing) return existing.id as number;
  if (!createMissing) return null;
  const info = db.prepare('INSERT INTO brands (name, slug, country, description_ru, is_active, sort_order, is_popular) VALUES (?, ?, ?, ?, 1, 0, 0)').run(name, slug, '', '');
  return Number(info.lastInsertRowid);
}

function findOrCreateCategory(name: string, parentId: number | null, createMissing: boolean) {
  if (!name) return null;
  const slug = getCategorySlug(name, parentId);
  const existing = db.prepare('SELECT id FROM categories WHERE (slug = ? OR name_ru = ?) AND COALESCE(parent_id, 0) = COALESCE(?, 0)').get(slug, name, parentId) as any;
  if (existing) return existing.id as number;
  if (!createMissing) return null;
  const rootMeta = parentId === null ? approvedRootMeta[slug] : null;
  const info = db.prepare(
    'INSERT INTO categories (' +
      'parent_id, name_ru, slug, description_ru, short_description_ru, image_url, icon, ' +
      'menu_type, old_aliases, sort_order, is_active, is_public, is_public_card' +
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)'
  ).run(
    parentId,
    rootMeta?.name || name,
    slug,
    'Импортировано из CSV',
    '',
    '',
    '',
    'category',
    '',
    rootMeta?.sortOrder || 0,
    rootMeta ? 1 : 0,
  );
  return Number(info.lastInsertRowid);
}

function collectAncestorCategoryIds(categoryId: number) {
  const ids: number[] = [];
  let currentId: number | null = categoryId;
  const stmt = db.prepare('SELECT id, parent_id FROM categories WHERE id = ?');

  while (currentId) {
    const row = stmt.get(currentId) as { id: number; parent_id: number | null } | undefined;
    if (!row) break;
    ids.unshift(row.id);
    currentId = row.parent_id;
  }

  return ids;
}

function resolveUniqueProductSlug(baseSlug: string, sku: string, currentProductId?: number) {
  const normalizedBase = slugify(baseSlug) || slugify(sku) || 'product';
  const skuSuffix = slugify(sku) || 'sku';
  let candidate = normalizedBase;
  let attempt = 0;

  while (true) {
    const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(candidate) as any;
    if (!existing || Number(existing.id) === Number(currentProductId || 0)) {
      return candidate;
    }

    attempt += 1;
    candidate = attempt === 1
      ? slugify(`${normalizedBase}-${skuSuffix}`)
      : slugify(`${normalizedBase}-${skuSuffix}-${attempt}`);
  }
}

function resolveCategoryChain(item: ParsedRow, createMissingCategories: boolean) {
  const levels = getCategoryLevels(item);
  let parentId: number | null = null;
  let currentId: number | null = null;

  for (const level of levels) {
    currentId = findOrCreateCategory(level, parentId, createMissingCategories);
    if (!currentId) return null;
    parentId = currentId;
  }

  return currentId;
}

function syncProductImages(productId: number, item: ParsedRow) {
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
  const imageUrls = parseImageUrls(item);
  if (!imageUrls.length) return;
  const insert = db.prepare('INSERT INTO product_images (product_id, image_url, alt_text, is_cover, sort_order) VALUES (?, ?, ?, ?, ?)');
  imageUrls.forEach((imageUrl, index) => insert.run(productId, imageUrl, item.name_ru, index === 0 ? 1 : 0, index + 1));
}

function syncProductDocuments(productId: number, item: ParsedRow) {
  if (!item.document_1_name || !item.document_1_url) return;
  db.prepare('DELETE FROM product_documents WHERE product_id = ? AND file_url = ?').run(productId, item.document_1_url);
  db.prepare('INSERT INTO product_documents (product_id, document_name, document_type, file_url, file_extension, file_size, language, version, is_public, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 1)').run(
    productId,
    item.document_1_name,
    item.document_1_type || 'other',
    item.document_1_url,
    path.extname(item.document_1_url).replace('.', '') || 'url',
    item.document_1_language || 'ru',
    '1.0',
  );
}

function syncProductFeatures(productId: number, item: ParsedRow) {
  const features = parseFeatures(item.features_json);
  db.prepare('DELETE FROM product_features WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT INTO product_features (product_id, feature_name, feature_value, feature_unit, sort_order) VALUES (?, ?, ?, ?, ?)');
  features.forEach((feature: any, index: number) => {
    if (!feature?.feature_name || feature?.feature_value === undefined || feature?.feature_value === null || feature?.feature_value === '') return;
    insert.run(productId, feature.feature_name, String(feature.feature_value), feature.feature_unit || '', Number(feature.sort_order || index + 1));
  });
}

function syncStock(productId: number, item: ParsedRow) {
  const warehouses = db.prepare('SELECT * FROM warehouses ORDER BY sort_order, id').all() as any[];
  const keyMap: Record<string, string> = {
    komitas: 'stock_komitas',
    'комитас': 'stock_komitas',
    araratyan: 'stock_araratyan',
    'араратян': 'stock_araratyan',
    gnuni: 'stock_gnuni',
    'гнуни': 'stock_gnuni',
    'nairi-zaryan': 'stock_nairi_zaryan',
    'наири-зарьян': 'stock_nairi_zaryan',
    'araratyan-90-30': 'stock_araratyan_90_30',
    'araratyan-9030': 'stock_araratyan_90_30',
    'араратян-90-30': 'stock_araratyan_90_30',
    'араратян-9030': 'stock_araratyan_90_30',
  };

  db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT INTO stock (product_id, warehouse_id, quantity, reserved_quantity, available_quantity, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  warehouses.forEach((warehouse) => {
    const stockKey = keyMap[String(warehouse.slug || '').trim().toLowerCase()] || keyMap[slugify(String(warehouse.name || ''))];
    const quantity = Number((stockKey && item[stockKey]) || 0);
    insert.run(productId, warehouse.id, quantity, 0, quantity);
  });
}

function syncProductCategoryLinks(productId: number, primaryCategoryId: number, item: ParsedRow) {
  db.prepare('DELETE FROM product_categories WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, ?)');
  insert.run(productId, primaryCategoryId, 1);

  const ancestorIds = collectAncestorCategoryIds(primaryCategoryId)
    .filter((categoryId) => categoryId !== primaryCategoryId);
  ancestorIds.forEach((categoryId) => insert.run(productId, categoryId, 0));

  const extraCategoryIds = splitLegacyCategories(item.linked_category_ids || '')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value !== primaryCategoryId);

  extraCategoryIds.forEach((categoryId) => insert.run(productId, categoryId, 0));
}

export function previewProductsCsv(filePath: string, options: ImportOptions = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return {
      fileName: path.basename(filePath),
      columns: [],
      summary: { total: 0, valid: 0, invalid: 0, warnings: 0, toCreate: 0, toUpdate: 0, errors: 0 },
      rows: [],
      brandsToCreate: [],
      categoriesToCreate: [],
      existingSkus: [],
      fileErrors: ['CSV пустой или некорректный'],
    };
  }

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((row) => row.some(Boolean));
  const { fileErrors, previewRows, summary, brandsToCreate, categoriesToCreate, existingSkus } = validateRows(headers, dataRows, options);

  return {
    fileName: path.basename(filePath),
    columns: headers,
    summary,
    rows: previewRows,
    brandsToCreate,
    categoriesToCreate,
    existingSkus,
    fileErrors,
  };
}

export function applyProductsCsv(filePath: string, options: ImportOptions = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV пустой или некорректный');
  const headers = rows[0];
  const dataRows = rows.slice(1).filter((row) => row.some(Boolean));
  const { fileErrors, rows: parsedRows, previewRows } = validateRows(headers, dataRows, options);
  if (fileErrors.length) throw new Error(fileErrors.join('; '));
  const fatalRows = previewRows.filter((row) => row.errors.length);
  if (fatalRows.length) throw new Error(`Импорт остановлен: есть ошибки в ${fatalRows.length} строках`);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  const transaction = db.transaction(() => {
    parsedRows.forEach((item) => {
      try {
        const brandId = findOrCreateBrand(item.brand, Boolean(options.createMissingBrands));
        if (!brandId) throw new Error(`Бренд не найден: ${item.brand}`);

        const categoryId = resolveCategoryChain(item, Boolean(options.createMissingCategories));
        if (!categoryId) throw new Error(`Категория не найдена: ${item.category_level_1}`);

        const seriesId = item.series
          ? (() => {
              const existing = db.prepare('SELECT id FROM series WHERE slug = ? OR name = ?').get(slugify(item.series), item.series) as any;
              if (existing) {
                db.prepare('UPDATE series SET brand_id = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(brandId, categoryId, existing.id);
                return existing.id;
              }
              const info = db.prepare('INSERT INTO series (brand_id, category_id, name, slug, description_ru, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(brandId, categoryId, item.series, slugify(item.series), '', '');
              return Number(info.lastInsertRowid);
            })()
          : null;

        const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(item.sku) as any;
        const slug = resolveUniqueProductSlug(item.slug || `${item.sku}-${item.name_ru}`, item.sku, existing?.id);
        const legacyCategories = item.source_categories || item.legacy_categories || existing?.legacy_categories || '';
        const payload = [
          item.old_id ? Number(item.old_id) : null,
          item.sku,
          item.name_ru,
          item.name_hy || '',
          item.name_en || '',
          slug,
          brandId,
          seriesId,
          categoryId,
          categoryId,
          item.short_description_ru || '',
          item.description_ru || '',
          item.price_amd ? Number(item.price_amd) : 0,
          item.price_tax_included ? Number(item.price_tax_included) : (item.price_amd ? Number(item.price_amd) : 0),
          item.currency || 'AMD',
          item.unit || 'шт',
          parseBoolean(item.show_price || '1') ? 1 : 0,
          item.availability_status || null,
          Number(item.stock_komitas || 0) + Number(item.stock_araratyan || 0) + Number(item.stock_gnuni || 0) + Number(item.stock_nairi_zaryan || 0) + Number(item.stock_araratyan_90_30 || 0),
          item.supplier_reference || '',
          legacyCategories,
          parseBoolean(item.active) ? 1 : 0,
        ];

        let productId = existing?.id as number | undefined;
        if (existing) {
          db.prepare(`UPDATE products SET
            old_id=?, sku=?, name_ru=?, name_hy=?, name_en=?, slug=?, brand_id=?, series_id=?, primary_category_id=?, category_id=?,
            short_description_ru=?, description_ru=?, price_amd=?, price_tax_included=?, currency=?, unit=?, show_price=?, availability_status=?,
            stock_quantity=?, supplier_reference=?, legacy_categories=?, is_active=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?`).run(...payload, existing.id);
          updatedCount += 1;
        } else {
          const info = db.prepare(`INSERT INTO products (
            old_id, sku, name_ru, name_hy, name_en, slug, brand_id, series_id, primary_category_id, category_id,
            short_description_ru, description_ru, price_amd, price_tax_included, currency, unit, show_price,
            availability_status, stock_quantity, supplier_reference, legacy_categories, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).run(...payload);
          productId = Number(info.lastInsertRowid);
          createdCount += 1;
        }

        if (!productId) throw new Error(`Не удалось определить товар для SKU ${item.sku}`);

        syncProductFeatures(productId, item);
        syncProductImages(productId, item);
        syncProductDocuments(productId, item);
        syncStock(productId, item);
        syncProductCategoryLinks(productId, categoryId, item);
      } catch (error: any) {
        errorCount += 1;
        throw error;
      }
    });
  });

  transaction();

  const invalidImages = parsedRows.flatMap((item, index) => getInvalidImageUrls(item).map((imageUrl) => ({ rowNumber: index + 2, sku: item.sku, imageUrl })));

  const summary = {
    fileName: path.basename(filePath),
    createdCount,
    updatedCount,
    errorCount,
    totalRows: parsedRows.length,
    invalidImageUrlCount: invalidImages.length,
    skippedImages: invalidImages,
    options,
  };

  db.prepare('INSERT INTO import_logs (file_name, mode, created_count, updated_count, error_count, summary_json) VALUES (?, ?, ?, ?, ?, ?)').run(summary.fileName, 'products_csv', createdCount, updatedCount, errorCount, JSON.stringify(summary));
  return summary;
}
