/**
 * Catalog consolidation 2026-10-21 for "Автоматика и управление" (910002), owner-approved.
 *
 * - Merges "Аксессуары для реле" (910115) into "Промежуточные реле, таймеры и аксессуары" (910022)
 *   and "Аксессуары для частотных преобразователей" (910116) into "Частотные преобразователи и аксессуары" (910117).
 *   Targets keep their id and slug (canonical URLs); source slugs go to the target's old_aliases (HTTP 301).
 *   Source categories are archived (is_active = 0), never deleted; their product_categories rows stay as history.
 * - Every product of both pairs gets product_attributes.product_type = equipment | accessory, so the
 *   accessory distinction survives without the archived category.
 * - Persists the approved sibling order (sort_order) and EN/HY names of the affected catalog path.
 *
 * Usage (dry-run unless --apply / --rollback):
 *   node dist/cli/consolidateAutomationCategories.js --db <copy.db> [--apply --manifest-out <file>]
 *   node dist/cli/consolidateAutomationCategories.js --db <copy.db> --rollback <manifest.json>
 * Writing to this checkout's runtime DB additionally requires --owner-approved-production.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from '../paths.js';

export const MIGRATION_SOURCE = 'catalog-consolidation-20261021';
const EXTRACTION_VERSION = 'catalog-consolidation-v1';
const PARENT_ID = 910002;

type Names = { ru: string; en: string; hy: string };
type Merge = { targetId: number; targetSlug: string; targetRu: string; sourceId: number; sourceSlug: string; sourceRu: string; names: Names };

export const MERGES: Merge[] = [
  {
    targetId: 910022,
    targetSlug: 'avtomatika-i-upravlenie-promezhutochnye-rele-i-taymery',
    targetRu: 'Промежуточные реле и таймеры',
    sourceId: 910115,
    sourceSlug: 'avtomatika-i-upravlenie-aksessuary-dlya-rele',
    sourceRu: 'Аксессуары для реле',
    names: { ru: 'Промежуточные реле, таймеры и аксессуары', en: 'Intermediate Relays, Timers & Accessories', hy: 'Միջանկյալ ռելեներ, թայմերներ և պարագաներ' },
  },
  {
    targetId: 910117,
    targetSlug: 'avtomatika-i-upravlenie-chastotnye-preobrazovateli',
    targetRu: 'Частотные преобразователи',
    sourceId: 910116,
    sourceSlug: 'avtomatika-i-upravlenie-aksessuary-dlya-chastotnyh-preobrazovateley',
    sourceRu: 'Аксессуары для частотных преобразователей',
    names: { ru: 'Частотные преобразователи и аксессуары', en: 'Frequency Converters & Accessories', hy: 'Հաճախականության փոխակերպիչներ և պարագաներ' },
  },
];

/** Approved order of the seven visible children of 910002 (gaps of 10 leave room for later inserts). */
export const SIBLING_ORDER: { id: number; ru: string; sortOrder: number }[] = [
  { id: 910022, ru: 'Промежуточные реле, таймеры и аксессуары', sortOrder: 10 },
  { id: 910023, ru: 'Реле контроля и защиты', sortOrder: 20 },
  { id: 910021, ru: 'Контрольно-измерительные приборы', sortOrder: 30 },
  { id: 910020, ru: 'Контроллеры АВР', sortOrder: 40 },
  { id: 910019, ru: 'Кнопки, индикаторы и посты управления', sortOrder: 50 },
  { id: 910117, ru: 'Частотные преобразователи и аксессуары', sortOrder: 60 },
  { id: 910130, ru: 'Домофоны и дверные звонки', sortOrder: 70 },
];

/** EN names are owner-approved for the seven (section 3); HY names are proposals pending owner review. */
export const LOCALIZED_NAMES: { id: number; ru: string; en: string; hy: string }[] = [
  // Root EN names match the navigation contract labels (navigationComposer TOP_LEVEL_SPECS) so title and menu agree.
  { id: 910002, ru: 'Автоматика и управление', en: 'Automation', hy: 'Ավտոմատիկա և կառավարում' },
  { id: 910023, ru: 'Реле контроля и защиты', en: 'Monitoring & Protection Relays', hy: 'Հսկման և պաշտպանության ռելեներ' },
  { id: 910021, ru: 'Контрольно-измерительные приборы', en: 'Measuring Instruments', hy: 'Չափիչ-հսկիչ սարքեր' },
  { id: 910020, ru: 'Контроллеры АВР', en: 'ATS Controllers', hy: 'Պահուստի ավտոմատ միացման (ATS) կարգավորիչներ' },
  { id: 910019, ru: 'Кнопки, индикаторы и посты управления', en: 'Pushbuttons, Indicators & Control Stations', hy: 'Կոճակներ, ցուցիչներ և կառավարման կայաններ' },
  { id: 910130, ru: 'Домофоны и дверные звонки', en: 'Intercoms & Doorbells', hy: 'Դոմոֆոններ և դռան զանգեր' },
  // HVAC reference path (EN UI showed Russian titles and breadcrumbs there).
  { id: 910001, ru: 'HVAC и теплоснабжение', en: 'HVAC', hy: 'HVAC և ջերմամատակարարում' },
  { id: 910009, ru: 'Автоматика HVAC', en: 'HVAC Automation', hy: 'HVAC ավտոմատիկա' },
  { id: 910121, ru: 'Контроллеры тепловых пунктов', en: 'Heating Substation Controllers', hy: 'Ջերմային կետերի կարգավորիչներ' },
  { id: 910063, ru: 'Датчики, реле и измерительные приборы', en: 'Sensors, Relays & Gauges', hy: 'Տվիչներ, ռելեներ և չափիչ սարքեր' },
  { id: 910064, ru: 'Термостаты и пульты управления', en: 'Thermostats & Control Panels', hy: 'Թերմոստատներ և կառավարման վահանակներ' },
  { id: 910065, ru: 'Электроприводы клапанов', en: 'Valve Actuators', hy: 'Փականների էլեկտրական շարժիչներ' },
];

type Db = InstanceType<typeof Database>;

function parseArgs(argv: string[]) {
  const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  return {
    db: value('--db'),
    apply: argv.includes('--apply'),
    rollback: value('--rollback'),
    manifestOut: value('--manifest-out'),
    ownerApprovedProduction: argv.includes('--owner-approved-production'),
  };
}

export function parseAliases(raw: unknown): string[] {
  return String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function sameFile(a: string, b: string) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function scopeProductIds(db: Db) {
  const ids = MERGES.flatMap((merge) => [merge.targetId, merge.sourceId]);
  const placeholders = ids.map(() => '?').join(',');
  return (db.prepare(`
    SELECT DISTINCT p.id FROM products p
    WHERE p.category_id IN (${placeholders}) OR p.primary_category_id IN (${placeholders})
       OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id IN (${placeholders}))
    ORDER BY p.id
  `).all(...ids, ...ids, ...ids) as { id: number }[]).map((row) => row.id);
}

function directProductIds(db: Db, categoryId: number) {
  return (db.prepare(`
    SELECT DISTINCT p.id FROM products p
    WHERE p.category_id = ? OR p.primary_category_id = ?
       OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?)
    ORDER BY p.id
  `).all(categoryId, categoryId, categoryId) as { id: number }[]).map((row) => row.id);
}

/** Active products visible through the active children of 910002 (the counter semantics of routes/categories). */
function visibleChildCounts(db: Db) {
  const children = db.prepare('SELECT id, name_ru, slug, sort_order FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order, name_ru').all(PARENT_ID) as any[];
  return children.map((child) => ({
    ...child,
    products: Number(db.prepare(`
      SELECT COUNT(DISTINCT p.id) AS c FROM products p
      WHERE p.is_active = 1 AND (p.category_id = ? OR COALESCE(p.primary_category_id, 0) = ?
        OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?))
    `).get(child.id, child.id, child.id)?.c || 0),
  }));
}

type State = 'pending' | 'applied';

export function detectState(db: Db): State {
  const flags = MERGES.map((merge) => {
    const source = db.prepare('SELECT is_active FROM categories WHERE id = ?').get(merge.sourceId);
    const target = db.prepare('SELECT old_aliases FROM categories WHERE id = ?').get(merge.targetId);
    return Number(source?.is_active) === 0 && parseAliases(target?.old_aliases).includes(merge.sourceSlug);
  });
  const marked = Number(db.prepare('SELECT COUNT(*) AS c FROM product_attributes WHERE source = ?').get(MIGRATION_SOURCE)?.c || 0);
  if (flags.every(Boolean) && marked > 0) return 'applied';
  if (!flags.some(Boolean) && marked === 0) return 'pending';
  throw new Error(`Partial consolidation state (categories=${JSON.stringify(flags)}, marked attributes=${marked}); restore from backup or roll back before retrying.`);
}

/** Throws unless the DB matches the audited 2026-10-21 baseline the owner approved. */
export function verifyPreconditions(db: Db) {
  const problems: string[] = [];
  const category = (id: number) => db.prepare('SELECT id, parent_id, name_ru, slug, is_active FROM categories WHERE id = ?').get(id);
  for (const merge of MERGES) {
    for (const [id, slug, ru] of [[merge.targetId, merge.targetSlug, merge.targetRu], [merge.sourceId, merge.sourceSlug, merge.sourceRu]] as const) {
      const row = category(id);
      if (!row) problems.push(`category ${id} missing`);
      else {
        if (row.parent_id !== PARENT_ID) problems.push(`category ${id} parent ${row.parent_id} != ${PARENT_ID}`);
        if (row.slug !== slug) problems.push(`category ${id} slug ${row.slug} != ${slug}`);
        if (row.name_ru !== ru) problems.push(`category ${id} name "${row.name_ru}" != "${ru}"`);
        if (Number(row.is_active) !== 1) problems.push(`category ${id} is not active`);
      }
    }
    if (Number(db.prepare('SELECT COUNT(*) AS c FROM categories WHERE parent_id = ?').get(merge.sourceId)?.c || 0) > 0) problems.push(`source ${merge.sourceId} has child categories`);
    const overlap = directProductIds(db, merge.sourceId).filter((id) => directProductIds(db, merge.targetId).includes(id));
    if (overlap.length) problems.push(`products in both ${merge.sourceId} and ${merge.targetId}: ${overlap.join(',')}`);
  }
  for (const item of [...SIBLING_ORDER.filter((entry) => !MERGES.some((merge) => merge.targetId === entry.id)), ...LOCALIZED_NAMES]) {
    const row = category(item.id);
    if (!row) problems.push(`category ${item.id} missing`);
    else if (row.name_ru !== item.ru) problems.push(`category ${item.id} name "${row.name_ru}" != "${item.ru}"`);
  }
  const children = db.prepare('SELECT id FROM categories WHERE parent_id = ? AND is_active = 1').all(PARENT_ID).map((row: any) => Number(row.id)).sort();
  const expected = [...SIBLING_ORDER.map((item) => item.id), ...MERGES.map((merge) => merge.sourceId)].sort();
  if (JSON.stringify(children) !== JSON.stringify(expected)) problems.push(`active children of ${PARENT_ID} are ${children.join(',')}, expected ${expected.join(',')}`);
  const existingTypes = Number(db.prepare(`SELECT COUNT(*) AS c FROM product_attributes WHERE attribute_key = 'product_type'`).get()?.c || 0);
  if (existingTypes) problems.push(`${existingTypes} product_type attributes already exist; refusing to mix classifications`);
  if (problems.length) throw new Error(`Preconditions failed:\n- ${problems.join('\n- ')}`);
}

export function buildManifest(db: Db) {
  const productIds = scopeProductIds(db);
  const categoryIds = [...new Set([PARENT_ID, ...MERGES.flatMap((merge) => [merge.targetId, merge.sourceId]), ...SIBLING_ORDER.map((item) => item.id), ...LOCALIZED_NAMES.map((item) => item.id)])].sort();
  const inList = (ids: number[]) => ids.map(() => '?').join(',');
  return {
    migration: MIGRATION_SOURCE,
    createdAt: new Date().toISOString(),
    categories: db.prepare(`SELECT id, name_ru, name_en, name_hy, sort_order, is_active, is_public, old_aliases, updated_at FROM categories WHERE id IN (${inList(categoryIds)}) ORDER BY id`).all(...categoryIds),
    products: db.prepare(`SELECT id, sku, category_id, primary_category_id, updated_at FROM products WHERE id IN (${inList(productIds)}) ORDER BY id`).all(...productIds),
    productCategories: db.prepare(`SELECT product_id, category_id, is_primary, created_at FROM product_categories WHERE product_id IN (${inList(productIds)}) ORDER BY product_id, category_id`).all(...productIds),
    before: { visibleChildren: visibleChildCounts(db), unions: MERGES.map((merge) => ({ targetId: merge.targetId, sourceId: merge.sourceId, target: directProductIds(db, merge.targetId), source: directProductIds(db, merge.sourceId) })) },
  };
}

export function applyConsolidation(db: Db) {
  const insertAttribute = db.prepare(`
    INSERT INTO product_attributes (product_id, attribute_key, value_text, confidence, source, evidence, extraction_version)
    VALUES (?, 'product_type', ?, 1.0, ?, ?, ?)
  `);
  const run = db.transaction(() => {
    for (const merge of MERGES) {
      const sourceProducts = directProductIds(db, merge.sourceId);
      const targetProducts = directProductIds(db, merge.targetId);
      for (const productId of sourceProducts) {
        db.prepare(`
          UPDATE products SET
            category_id = CASE WHEN category_id = ? THEN ? ELSE category_id END,
            primary_category_id = CASE WHEN primary_category_id = ? THEN ? ELSE primary_category_id END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(merge.sourceId, merge.targetId, merge.sourceId, merge.targetId, productId);
        const wasPrimary = Number(db.prepare('SELECT is_primary FROM product_categories WHERE product_id = ? AND category_id = ?').get(productId, merge.sourceId)?.is_primary || 0);
        db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, ?)').run(productId, merge.targetId, wasPrimary);
        // The archived link stays as provenance; it no longer competes for the primary breadcrumb.
        db.prepare('UPDATE product_categories SET is_primary = 0 WHERE product_id = ? AND category_id = ?').run(productId, merge.sourceId);
        insertAttribute.run(productId, 'accessory', MIGRATION_SOURCE, `source_category_id=${merge.sourceId}; source_category_slug=${merge.sourceSlug}`, EXTRACTION_VERSION);
      }
      for (const productId of targetProducts) {
        insertAttribute.run(productId, 'equipment', MIGRATION_SOURCE, `source_category_id=${merge.targetId}; source_category_slug=${merge.targetSlug}`, EXTRACTION_VERSION);
      }
      const target = db.prepare('SELECT old_aliases FROM categories WHERE id = ?').get(merge.targetId);
      const aliases = [...new Set([...parseAliases(target?.old_aliases), merge.sourceSlug])].join(',');
      db.prepare('UPDATE categories SET name_ru = ?, name_en = ?, name_hy = ?, old_aliases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(merge.names.ru, merge.names.en, merge.names.hy, aliases, merge.targetId);
      db.prepare('UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(merge.sourceId);
    }
    for (const item of SIBLING_ORDER) db.prepare('UPDATE categories SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.sortOrder, item.id);
    for (const item of LOCALIZED_NAMES) db.prepare('UPDATE categories SET name_en = ?, name_hy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.en, item.hy, item.id);
  });
  run();
}

/** Throws unless every product of the merged pairs is reachable through its (active) target and counts are unions. */
export function verifyApplied(db: Db, manifest: ReturnType<typeof buildManifest>) {
  const problems: string[] = [];
  for (const union of manifest.before.unions) {
    const expected = [...new Set([...union.target, ...union.source])].sort((a, b) => a - b);
    const actual = directProductIds(db, union.targetId);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`category ${union.targetId}: ${actual.length} products, expected union ${expected.length}`);
  }
  const visible = visibleChildCounts(db);
  const order = visible.map((item: any) => Number(item.id));
  if (JSON.stringify(order) !== JSON.stringify(SIBLING_ORDER.map((item) => item.id))) problems.push(`visible order ${order.join(',')}`);
  const beforeTotal = new Set(manifest.before.unions.flatMap((union) => [...union.target, ...union.source]));
  for (const productId of beforeTotal) {
    const sku = manifest.products.find((row: any) => row.id === productId)?.sku;
    const row = db.prepare('SELECT sku, primary_category_id FROM products WHERE id = ?').get(productId);
    if (!row || row.sku !== sku) problems.push(`product ${productId} missing or SKU changed`);
    else if (!db.prepare('SELECT 1 FROM categories WHERE id = ? AND is_active = 1').get(row.primary_category_id)) problems.push(`product ${productId} primary category ${row.primary_category_id} inactive`);
  }
  if (problems.length) throw new Error(`Post-apply verification failed:\n- ${problems.join('\n- ')}`);
  return visible;
}

export function rollbackConsolidation(db: Db, manifest: ReturnType<typeof buildManifest>) {
  if (manifest.migration !== MIGRATION_SOURCE) throw new Error(`Manifest belongs to ${manifest.migration}`);
  const run = db.transaction(() => {
    for (const row of manifest.categories as any[]) {
      db.prepare('UPDATE categories SET name_ru = ?, name_en = ?, name_hy = ?, sort_order = ?, is_active = ?, is_public = ?, old_aliases = ?, updated_at = ? WHERE id = ?')
        .run(row.name_ru, row.name_en, row.name_hy, row.sort_order, row.is_active, row.is_public, row.old_aliases, row.updated_at, row.id);
    }
    for (const row of manifest.products as any[]) {
      db.prepare('UPDATE products SET category_id = ?, primary_category_id = ?, updated_at = ? WHERE id = ?').run(row.category_id, row.primary_category_id, row.updated_at, row.id);
    }
    const productIds = (manifest.products as any[]).map((row) => row.id);
    db.prepare(`DELETE FROM product_categories WHERE product_id IN (${productIds.map(() => '?').join(',')})`).run(...productIds);
    const insert = db.prepare('INSERT INTO product_categories (product_id, category_id, is_primary, created_at) VALUES (?, ?, ?, ?)');
    for (const row of manifest.productCategories as any[]) insert.run(row.product_id, row.category_id, row.is_primary, row.created_at);
    db.prepare('DELETE FROM product_attributes WHERE source = ?').run(MIGRATION_SOURCE);
  });
  run();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) throw new Error('--db <path> is required (use a copy made with sqlite3 .backup)');
  const dbFile = path.resolve(args.db);
  const writes = args.apply || Boolean(args.rollback);
  if (writes && sameFile(dbFile, resolveProjectPath('./data/electro.db')) && !args.ownerApprovedProduction) {
    throw new Error(`${dbFile} is this checkout's runtime DB; production migration needs owner approval (--owner-approved-production) and a verified backup.`);
  }
  const db = new Database(dbFile, { fileMustExist: true });
  db.pragma('foreign_keys = ON');

  if (args.rollback) {
    const manifest = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    rollbackConsolidation(db, manifest);
    console.log(JSON.stringify({ result: 'rolled_back', state: detectState(db), visibleChildren: visibleChildCounts(db) }, null, 2));
    return;
  }

  const state = detectState(db);
  if (state === 'applied') {
    console.log(JSON.stringify({ result: 'already_applied', visibleChildren: visibleChildCounts(db) }, null, 2));
    return;
  }
  verifyPreconditions(db);
  const manifest = buildManifest(db);
  if (!args.apply) {
    console.log(JSON.stringify({ result: 'dry_run', products: manifest.products.length, before: manifest.before }, null, 2));
    return;
  }
  if (!args.manifestOut) throw new Error('--manifest-out <file> is required with --apply (rollback input)');
  fs.mkdirSync(path.dirname(path.resolve(args.manifestOut)), { recursive: true });
  fs.writeFileSync(args.manifestOut, JSON.stringify(manifest, null, 2));
  applyConsolidation(db);
  const visible = verifyApplied(db, manifest);
  console.log(JSON.stringify({ result: 'applied', manifest: path.resolve(args.manifestOut), visibleChildren: visible }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
