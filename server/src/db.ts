import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { envPath, resolveProjectPath, schemaPath } from './paths.js';

dotenv.config({ path: envPath });

function resolveDbPath() {
  const configured = (process.env.DB_PATH || './data/electro.db').trim();
  return resolveProjectPath(configured);
}

const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
export { dbPath };
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

function tableColumns(table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((column) => column.name);
}

function ensureColumn(table: string, name: string, definition: string) {
  const columns = tableColumns(table);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureMigrations() {
  ensureColumn('categories', 'short_description_ru', 'TEXT');
  ensureColumn('categories', 'is_public_card', 'INTEGER DEFAULT 0');
  ensureColumn('categories', 'menu_type', "TEXT DEFAULT 'category'");
  ensureColumn('categories', 'old_aliases', 'TEXT');
  ensureColumn('categories', 'is_public', 'INTEGER DEFAULT 1');
  ensureColumn('brands', 'sort_order', 'INTEGER DEFAULT 0');
  ensureColumn('brands', 'is_popular', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'old_id', 'INTEGER');
  ensureColumn('products', 'primary_category_id', 'INTEGER');
  ensureColumn('products', 'price_tax_included', 'REAL DEFAULT 0');
  ensureColumn('products', 'show_price', 'INTEGER DEFAULT 1');
  ensureColumn('products', 'availability_status', 'TEXT');
  ensureColumn('products', 'stock_quantity', 'REAL DEFAULT 0');
  ensureColumn('products', 'supplier_reference', 'TEXT');
  ensureColumn('products', 'legacy_categories', 'TEXT');
  ensureColumn('products', 'cooling_power_kw', 'REAL');
  ensureColumn('products', 'heating_power_kw', 'REAL');
  ensureColumn('products', 'recommended_area_m2', 'REAL');
  ensureColumn('products', 'equipment_type', 'TEXT');
  ensureColumn('products', 'suitable_for_cooling', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'suitable_for_heating', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'is_calculator_accessory', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'accessory_group', 'TEXT');
  ensureColumn('products', 'accessory_default_enabled', 'INTEGER DEFAULT 1');
  ensureColumn('products', 'energy_source', 'TEXT');
  ensureColumn('products', 'system_type', 'TEXT');
  ensureColumn('products', 'calculator_priority', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'warm_floor_product_type', 'TEXT');
  ensureColumn('products', 'warm_floor_linear_power_wm', 'REAL');
  ensureColumn('products', 'warm_floor_cable_length_m', 'REAL');
  ensureColumn('products', 'warm_floor_mat_area_m2', 'REAL');
  ensureColumn('products', 'warm_floor_voltage_v', 'REAL');
  ensureColumn('products', 'warm_floor_room_types', 'TEXT');
  ensureColumn('products', 'warm_floor_floor_coverings', 'TEXT');
  ensureColumn('products', 'warm_floor_substrate_types', 'TEXT');
  ensureColumn('products', 'warm_floor_wet_zone_allowed', 'INTEGER');
  ensureColumn('products', 'ai_selectable', 'INTEGER DEFAULT 1');
  ensureColumn('products', 'ai_selection_notes', 'TEXT');
  ensureColumn('products', 'compatible_system_types', 'TEXT');
  ensureColumn('products', 'required_accessory', 'INTEGER DEFAULT 0');
  ensureColumn('products', 'optional_accessory', 'INTEGER DEFAULT 1');
  ensureColumn('products', 'brand_quality_tier', 'TEXT');
  ensureColumn('products', 'installation_complexity', 'TEXT');
  ensureColumn('series', 'deleted_at', 'TEXT');
  ensureColumn('product_documents', 'is_active', 'INTEGER DEFAULT 1');
  ensureColumn('product_documents', 'deleted_at', 'TEXT');
  ensureColumn('product_documents', 'updated_at', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS product_categories (
    product_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    is_primary INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, category_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT,
    mode TEXT DEFAULT 'products_csv',
    created_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    summary_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_context_documents (
    user_id TEXT PRIMARY KEY,
    document_id TEXT UNIQUE NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    user_id TEXT,
    guest_id TEXT,
    product_id TEXT,
    category_id TEXT,
    brand_id TEXT,
    selection_id TEXT,
    direction TEXT,
    search_query TEXT,
    payload_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_user_created ON user_activity_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_activity_guest_created ON user_activity_events(guest_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_activity_type_created ON user_activity_events(event_type, created_at);
  `);
  db.exec('UPDATE products SET primary_category_id = COALESCE(primary_category_id, category_id) WHERE category_id IS NOT NULL');
  db.exec(`INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary)
    SELECT id, COALESCE(primary_category_id, category_id), 1
    FROM products
    WHERE COALESCE(primary_category_id, category_id) IS NOT NULL`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_categories_parent_active_sort ON categories(parent_id, is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_products_active_primary_category ON products(is_active, primary_category_id);
    CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category_id);
    CREATE INDEX IF NOT EXISTS idx_product_categories_category_product ON product_categories(category_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_product_id ON stock(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_documents_product_public ON product_documents(product_id, is_public);
    CREATE INDEX IF NOT EXISTS idx_product_images_cover_sort ON product_images(product_id, is_cover, sort_order);
    CREATE INDEX IF NOT EXISTS idx_product_features_product_sort ON product_features(product_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_product_relationships_source_public ON product_relationships(source_product_id, review_status, relation_type, confidence);
    CREATE INDEX IF NOT EXISTS idx_product_relationships_target ON product_relationships(target_product_id, review_status, relation_type);
    CREATE INDEX IF NOT EXISTS idx_product_relationships_review ON product_relationships(review_status, manual_review_required, confidence, relation_type);
    CREATE INDEX IF NOT EXISTS idx_product_relationships_pair ON product_relationships(source_product_id, target_product_id);
    CREATE INDEX IF NOT EXISTS idx_relationship_rules_active_priority ON relationship_rules(is_active, rule_type, priority);
    CREATE INDEX IF NOT EXISTS idx_relationship_rules_auto_apply ON relationship_rules(is_active, auto_apply_allowed, manual_review_required, default_confidence);
    CREATE INDEX IF NOT EXISTS idx_relationship_review_queue_worklist ON relationship_review_queue(review_status, priority, confidence, proposed_relation_type);
    CREATE INDEX IF NOT EXISTS idx_relationship_review_queue_source ON relationship_review_queue(source_product_id, review_status, priority);
    CREATE INDEX IF NOT EXISTS idx_relationship_review_queue_rule ON relationship_review_queue(rule_id, review_status);
    CREATE INDEX IF NOT EXISTS idx_relationship_review_queue_pair ON relationship_review_queue(source_product_id, target_product_id, proposed_relation_type);
  `);
}

type ApprovedPublicRoot = {
  slug: string;
  fallbackName: string;
  sortOrder: number;
  aliases?: string[];
};

const approvedPublicRoots: ApprovedPublicRoot[] = [
  { slug: 'elektrika-i-schitovoe-oborudovanie', fallbackName: 'Электрика и щитовое оборудование', sortOrder: 10 },
  { slug: 'rozetki-i-vyklyuchateli', fallbackName: 'Розетки и выключатели', sortOrder: 20 },
  { slug: 'kabel-kabel-kanaly-i-montazh', fallbackName: 'Кабель, кабель-каналы и монтаж', sortOrder: 30 },
  { slug: 'osveschenie', fallbackName: 'Освещение', sortOrder: 40 },
  { slug: 'elektricheskoe-otoplenie', fallbackName: 'Электрическое отопление', sortOrder: 50 },
  { slug: 'hvac-i-teplosnabzhenie', fallbackName: 'HVAC и теплоснабжение', sortOrder: 60 },
  { slug: 'truboprovodnaya-armatura-i-gidravlika', fallbackName: 'Трубопроводная арматура и гидравлика', sortOrder: 70 },
  { slug: 'avtomatika-i-upravlenie', fallbackName: 'Автоматика и управление', sortOrder: 80 },
];

export function ensureApprovedPublicRootCards() {
  const findBySlug = db.prepare('SELECT id FROM categories WHERE slug = ? AND parent_id IS NULL');
  const findByName = db.prepare('SELECT id FROM categories WHERE name_ru = ? AND parent_id IS NULL');
  const insertRoot = db.prepare('INSERT INTO categories (parent_id, name_ru, slug, description_ru, short_description_ru, image_url, icon, sort_order, is_active, is_public_card) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1)');
  const updateRoot = db.prepare(`
    UPDATE categories
    SET name_ru = ?, slug = ?, is_public_card = 1, is_public = 1, is_active = 1, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  approvedPublicRoots.forEach((item) => {
    const existingBySlug = findBySlug.get(item.slug) as { id: number } | undefined;
    const existingByName = findByName.get(item.fallbackName) as { id: number } | undefined;
    const targetId = existingBySlug?.id || existingByName?.id;

    if (targetId) {
      updateRoot.run(item.fallbackName, item.slug, item.sortOrder, targetId);
      return;
    }

    insertRoot.run(item.fallbackName, item.slug, 'Публичная root-категория OhmX.am', '', '', '', item.sortOrder);
  });

  const placeholders = approvedPublicRoots.map(() => '?').join(',');
  db.prepare(`
    UPDATE categories
    SET is_public_card = CASE WHEN slug IN (${placeholders}) THEN is_public_card ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE parent_id IS NULL AND is_public_card = 1 AND slug NOT IN (${placeholders})
  `).run(...approvedPublicRoots.map((item) => item.slug), ...approvedPublicRoots.map((item) => item.slug));
}

type RootMergeSpec = {
  sourceSlug: string;
  targetSlug: string;
};

const legacyRootMerges: RootMergeSpec[] = [
  { sourceSlug: 'hvac-i-teplosnabzhenie', targetSlug: 'hvac-i-okhlazhdenie' },
  { sourceSlug: 'ohlazhdenie-kondicionirovanie-i-hvac', targetSlug: 'hvac-i-okhlazhdenie' },
  { sourceSlug: 'vodosnabzhenie-nasosy-i-gidravlika', targetSlug: 'truboprovodnaya-armatura-i-gidravlika' },
  { sourceSlug: 'kabel-kabel-kanaly-i-montazh', targetSlug: 'kabelnye-sistemy' },
  { sourceSlug: 'ibp-stabilizatory-i-zashchita-pitaniya', targetSlug: 'silovoe-oborudovanie-i-ups' },
  { sourceSlug: 'avtomatika-rele-i-upravlenie', targetSlug: 'avtomatika-i-upravlenie' },
  { sourceSlug: 'zapchasti-i-servisnye-komponenty', targetSlug: 'zapchasti-i-servis' },
];

function collectCategoryIds(rootId: number) {
  const ids = [rootId];
  const queue = [rootId];
  const childrenStmt = db.prepare('SELECT id FROM categories WHERE parent_id = ?');

  while (queue.length) {
    const currentId = queue.shift() as number;
    const children = childrenStmt.all(currentId) as Array<{ id: number }>;
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }

  return ids;
}

export function hideEmptyPublicRootCards() {
  const roots = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND is_active = 1 AND is_public_card = 1').all() as Array<{ id: number }>;
  const countProducts = db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM product_categories pc
    JOIN products p ON p.id = pc.product_id AND p.is_active = 1
    WHERE pc.category_id IN (
      SELECT value FROM json_each(?)
    )
  `);
  const hideRoot = db.prepare(`
    UPDATE categories
    SET is_public = 0,
        is_public_card = 0,
        is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const root of roots) {
    const descendantIds = collectCategoryIds(root.id);
    const productCount = Number((countProducts.get(JSON.stringify(descendantIds)) as { count?: number } | undefined)?.count || 0);
    if (!productCount) hideRoot.run(root.id);
  }
}

function hideLegacyRoot(rootId: number) {
  db.prepare(`
    UPDATE categories
    SET is_public = 0,
        is_public_card = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(rootId);
}

function mergeProductCategoryLinks(sourceId: number, targetId: number) {
  db.prepare(`
    INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary)
    SELECT product_id, ?, is_primary
    FROM product_categories
    WHERE category_id = ?
  `).run(targetId, sourceId);
  db.prepare('DELETE FROM product_categories WHERE category_id = ?').run(sourceId);
}

function reparentRootBranch(sourceSlug: string, targetSlug: string) {
  const source = db.prepare('SELECT id FROM categories WHERE slug = ? AND parent_id IS NULL').get(sourceSlug) as { id: number } | undefined;
  const target = db.prepare('SELECT id FROM categories WHERE slug = ? AND parent_id IS NULL').get(targetSlug) as { id: number } | undefined;
  if (!source || !target || source.id === target.id) return;

  db.prepare('UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ?').run(target.id, source.id);
  db.prepare(`
    UPDATE products
    SET primary_category_id = CASE WHEN primary_category_id = ? THEN ? ELSE primary_category_id END,
        category_id = CASE WHEN category_id = ? THEN ? ELSE category_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE primary_category_id = ? OR category_id = ?
  `).run(source.id, target.id, source.id, target.id, source.id, source.id);
  mergeProductCategoryLinks(source.id, target.id);
  hideLegacyRoot(source.id);
}

function classifyElektrikaChild(name: string) {
  const value = name.trim().toLowerCase();

  if (!value || value === 'главная' || value === 'разное') return 'akcii';
  if (/автоматическ.*выключател|\bузо\b|контактор|модульн.*защит|модульн.*управлен|dpx|drx|cx³|cx3/.test(value)) return null;
  if (
    /legrand серия|\bceliane\b|\bcariva\b|\bquteo\b|\bforix\b|\bniloe\b|\bsuno\b|\bmosaic\b|\bplexo\b|\binspiria\b|\bvalena\b|\barteor\b/.test(value)
    || /электроустановочн|рамк|механизм|лицевые панели|суппорт|розетк|выключател|диммер|rj45|usb|tv|блоки/.test(value)
  ) return 'rozetki-i-vyklyuchateli';

  if (/щит|шкаф|xl³|xl3|atlantic ip66/.test(value)) return 'shchity-i-shkafy';
  if (/кабель|лотк|канал|гофр|трубы и фитинги danfoss|metra\/dlp-s/.test(value)) return 'kabelnye-sistemy';
  if (/домашнее освещение|светильник|освещени/.test(value)) return 'osveshchenie';
  if (/радиатор|конвектор|тёпл|теплые полы|теплые пол|теплый пол|котельн|баки для воды|отопительн|теплоносител|запчасти для котлов|emmeti|beretta|italtherm/.test(value)) {
    return value.includes('запчаст') ? 'zapchasti-i-servis' : 'vodyanoe-otoplenie-i-kotelnaya';
  }
  if (/насос|арматур|клапан|гидравлик/.test(value)) return 'truboprovodnaya-armatura-i-gidravlika';

  return null;
}

function rebalanceElektrikaRoot() {
  const elektrika = db.prepare("SELECT id FROM categories WHERE slug = 'elektrika' AND parent_id IS NULL").get() as { id: number } | undefined;
  if (!elektrika) return;

  const children = db.prepare('SELECT id, name_ru FROM categories WHERE parent_id = ?').all(elektrika.id) as Array<{ id: number; name_ru: string }>;
  const findRootId = db.prepare('SELECT id FROM categories WHERE slug = ? AND parent_id IS NULL');

  for (const child of children) {
    const targetSlug = classifyElektrikaChild(child.name_ru);
    if (!targetSlug) continue;
    const target = findRootId.get(targetSlug) as { id: number } | undefined;
    if (!target || target.id === elektrika.id) continue;
    db.prepare('UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND parent_id = ?').run(target.id, child.id, elektrika.id);
  }
}

function moveMisplacedSwitchChildren() {
  const switchesRoot = db.prepare("SELECT id FROM categories WHERE slug = 'rozetki-i-vyklyuchateli' AND parent_id IS NULL").get() as { id: number } | undefined;
  const elektrikaRoot = db.prepare("SELECT id FROM categories WHERE slug = 'elektrika' AND parent_id IS NULL").get() as { id: number } | undefined;
  if (!switchesRoot || !elektrikaRoot) return;

  const children = db.prepare('SELECT id, name_ru FROM categories WHERE parent_id = ?').all(switchesRoot.id) as Array<{ id: number; name_ru: string }>;
  for (const child of children) {
    const value = child.name_ru.trim().toLowerCase();
    if (/автоматическ.*выключател|\bузо\b|контактор|dpx|drx|cx³|cx3/.test(value)) {
      db.prepare('UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND parent_id = ?').run(elektrikaRoot.id, child.id, switchesRoot.id);
    }
  }
}

function mergeDuplicateCategories(primaryId: number, duplicateId: number) {
  db.prepare('UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ?').run(primaryId, duplicateId);
  db.prepare(`
    UPDATE products
    SET primary_category_id = CASE WHEN primary_category_id = ? THEN ? ELSE primary_category_id END,
        category_id = CASE WHEN category_id = ? THEN ? ELSE category_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE primary_category_id = ? OR category_id = ?
  `).run(duplicateId, primaryId, duplicateId, primaryId, duplicateId, duplicateId);
  mergeProductCategoryLinks(duplicateId, primaryId);
  db.prepare(`
    UPDATE categories
    SET is_active = 0,
        is_public = 0,
        is_public_card = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(duplicateId);
}

function mergeSiblingDuplicates() {
  const duplicates = db.prepare(`
    SELECT parent_id, name_ru
    FROM categories
    WHERE is_active = 1 AND parent_id IS NOT NULL
    GROUP BY parent_id, name_ru
    HAVING COUNT(*) > 1
  `).all() as Array<{ parent_id: number; name_ru: string }>;

  for (const item of duplicates) {
    const siblings = db.prepare(`
      SELECT id
      FROM categories
      WHERE parent_id = ? AND name_ru = ? AND is_active = 1
      ORDER BY id
    `).all(item.parent_id, item.name_ru) as Array<{ id: number }>;

    if (siblings.length < 2) continue;
    const [primary, ...rest] = siblings;
    for (const duplicate of rest) mergeDuplicateCategories(primary.id, duplicate.id);
  }
}

function hideNavigationNoiseCategories() {
  db.prepare(`
    UPDATE categories
    SET is_public = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE name_ru IN ('Главная', 'Разное', 'Action', 'Italtherm', 'Baltur', 'Beretta', 'Riello', 'Аксессуары Emmeti и Beretta')
  `).run();
}

function collectDescendantIdsForCleanup(categoryId: number) {
  const ids = [categoryId];
  const queue = [categoryId];
  const stmt = db.prepare('SELECT id FROM categories WHERE parent_id = ? AND is_active = 1');
  while (queue.length) {
    const currentId = queue.shift() as number;
    const children = stmt.all(currentId) as Array<{ id: number }>;
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

function countProductsInCategoryTree(categoryId: number) {
  const ids = collectDescendantIdsForCleanup(categoryId);
  const placeholders = ids.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM products p
    LEFT JOIN product_categories pc ON pc.product_id = p.id
    WHERE p.is_active = 1 AND (
      p.category_id IN (${placeholders})
      OR COALESCE(p.primary_category_id, 0) IN (${placeholders})
      OR pc.category_id IN (${placeholders})
    )
  `).get(...ids, ...ids, ...ids) as { count: number } | undefined;
  return Number(row?.count || 0);
}

function cleanupPublicChildren() {
  const roots = db.prepare('SELECT id, slug FROM categories WHERE parent_id IS NULL AND is_active = 1').all() as Array<{ id: number; slug: string }>;
  const childStmt = db.prepare('SELECT id, name_ru, slug FROM categories WHERE parent_id = ? AND is_active = 1');
  const setPublic = db.prepare('UPDATE categories SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  for (const root of roots) {
    const children = childStmt.all(root.id) as Array<{ id: number; name_ru: string; slug: string }>;
    for (const child of children) {
      const name = child.name_ru.trim();
      const lower = name.toLowerCase();
      const productCount = countProductsInCategoryTree(child.id);
      let hide = false;

      if (!productCount) hide = true;
      if (/^главная$/i.test(name) || /^разное$/i.test(name) || /^action$/i.test(name)) hide = true;
      if (
        root.slug === 'rozetki-i-vyklyuchateli'
        && (
          /^(legrand серия|электроустановочные изделия|электротехнические изделия)/i.test(name)
          || /^(механизмы|рамки|лицевые панели|универсальные суппорты|plexo ip)/i.test(name)
          || /(^|\s)(белый|слоновая кость|графит|титан|антрацит|алюминий|серый|черный|чёрный)$/i.test(name)
          || /^блоки$/i.test(name)
        )
      ) hide = true;
      if (root.slug === 'kabelnye-sistemy' && /(радиаторы отопления)/i.test(lower)) hide = true;
      if (root.slug === 'vodyanoe-otoplenie-i-kotelnaya' && /^элементы регулировки теплоносителя/i.test(name)) hide = true;
      if (root.slug === 'hvac-i-okhlazhdenie' && /(водяное радиаторное отопление|трубопроводная арматура)/i.test(lower)) hide = true;
      if (root.slug === 'truboprovodnaya-armatura-i-gidravlika' && /(радиаторы отопления|котельное оборудование)/i.test(lower)) hide = true;
      if (root.slug === 'avtomatika-i-upravlenie' && /(радиаторы отопления|котельное оборудование|регулирующая арматура)/i.test(lower)) hide = true;
      if (root.slug === 'akcii' && !/специальные предложения/i.test(lower)) hide = true;

      setPublic.run(hide ? 0 : 1, child.id);
    }
  }
}

export function reconcileCatalogRoots() {
  const tx = db.transaction(() => {
    for (const spec of legacyRootMerges) reparentRootBranch(spec.sourceSlug, spec.targetSlug);
    rebalanceElektrikaRoot();
    moveMisplacedSwitchChildren();
    mergeSiblingDuplicates();
    hideNavigationNoiseCategories();
    cleanupPublicChildren();
  });
  tx();
}

function hasV2CategoryCleanup() {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM categories
    WHERE id IN (910001,910002,910003,910004,910005,910006,910007,910008)
      AND parent_id IS NULL
      AND is_active = 1
  `).get() as { count: number } | undefined;
  return Number(row?.count || 0) === 8;
}

function keepV2RootCardsPublic() {
  db.prepare(`
    UPDATE categories
    SET is_public = 1,
        is_public_card = CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id >= 910001 AND id <= 910999 AND is_active = 1
  `).run();
}

ensureMigrations();
if (hasV2CategoryCleanup()) {
  // V2 import owns the clean category tree. Do not run the legacy root-card
  // normalizer/merge rules here; they resurrect old roots such as
  // `kabelnye-sistemy` and reparent V2 branches under legacy categories.
  keepV2RootCardsPublic();
} else {
  ensureApprovedPublicRootCards();
  reconcileCatalogRoots();
  hideEmptyPublicRootCards();
}

export function now() { return new Date().toISOString(); }
export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9а-яё\s-]/gi, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}
