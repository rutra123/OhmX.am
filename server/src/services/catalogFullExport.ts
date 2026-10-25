/**
 * Full product catalog CSV export (admin only, read-only).
 *
 * One row per products.id. Every related table is loaded once (no N+1) inside a single read
 * transaction, so the export is a consistent snapshot under SQLite WAL. Multi-value data is
 * serialised as JSON in single cells, never as extra rows. Values are exported as stored:
 * nothing is translated, upscaled or invented; image URLs stay application-relative.
 *
 * CSV: UTF-8 with BOM, RFC 4180 (comma, CRLF, every field quoted, line breaks kept inside quotes).
 * Text cells starting with = + - @ TAB or CR get a leading apostrophe (spreadsheet formula injection).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const EXPORT_SCHEMA_VERSION = 'ohmx.full-catalog-export.v2';
export const INVENTORY_SOURCE = 'ohmx_local_db_snapshot (not 1C, not real-time)';

type Db = InstanceType<typeof Database>;
type Row = Record<string, any>;

/**
 * Registry parameters also exported as flat columns (unit in the column name = canonical registry unit).
 * A flat cell is filled only when the product has exactly one KNOWN value in that unit; several values
 * (different operating conditions) leave it empty and are listed in multi_condition_parameters.
 */
export const FLAT_ENGINEERING_PARAMETERS: ReadonlyArray<{ code: string; column: string; unit: string | null }> = [
  { code: 'cooling_capacity', column: 'eng_cooling_capacity_kw', unit: 'kW' },
  { code: 'cooling_capacity_sensible', column: 'eng_cooling_capacity_sensible_kw', unit: 'kW' },
  { code: 'heating_capacity', column: 'eng_heating_capacity_kw', unit: 'kW' },
  { code: 'airflow', column: 'eng_airflow_m3h', unit: 'm³/h' },
  { code: 'water_flow', column: 'eng_water_flow_m3h', unit: 'm³/h' },
  { code: 'pressure_drop', column: 'eng_pressure_drop_kpa', unit: 'kPa' },
  { code: 'fan_power', column: 'eng_fan_power_w', unit: 'W' },
  { code: 'electrical_input', column: 'eng_electrical_input_kw', unit: 'kW' },
  { code: 'cop', column: 'eng_cop', unit: null },
  { code: 'eer', column: 'eng_eer', unit: null },
  { code: 'scop', column: 'eng_scop', unit: null },
  { code: 'seer', column: 'eng_seer', unit: null },
  { code: 'max_water_temperature', column: 'eng_max_water_temperature_c', unit: '°C' },
  { code: 'operating_outdoor_min', column: 'eng_operating_outdoor_min_c', unit: '°C' },
  { code: 'operating_outdoor_max', column: 'eng_operating_outdoor_max_c', unit: '°C' },
  { code: 'refrigerant', column: 'eng_refrigerant', unit: null },
  { code: 'power_supply', column: 'eng_power_supply', unit: null },
  { code: 'phase_count', column: 'eng_phase_count', unit: null },
  { code: 'connection_size', column: 'eng_connection_size', unit: null },
  { code: 'hydraulic_connection_size', column: 'eng_hydraulic_connection_size', unit: null },
  { code: 'pipe_configuration', column: 'eng_pipe_configuration', unit: null },
  { code: 'kvs', column: 'eng_kvs_m3h', unit: 'm³/h' },
  { code: 'dn', column: 'eng_dn_mm', unit: 'mm' },
  { code: 'pressure_rating', column: 'eng_pressure_rating_bar', unit: 'bar' },
  { code: 'stroke', column: 'eng_stroke_mm', unit: 'mm' },
  { code: 'torque', column: 'eng_torque_nm', unit: 'Nm' },
  { code: 'control_signal', column: 'eng_control_signal', unit: null },
  { code: 'supply_voltage', column: 'eng_supply_voltage', unit: null },
  { code: 'max_load', column: 'eng_max_load_a', unit: 'A' },
  { code: 'control_type', column: 'eng_control_type', unit: null },
];

export const FULL_EXPORT_COLUMNS: readonly string[] = [
  // Identification
  'product_id', 'sku', 'supplier_reference', 'old_id', 'slug', 'product_url', 'admin_edit_url',
  'is_active', 'is_featured', 'created_at', 'updated_at',
  // Names and descriptions
  'name_ru', 'name_hy', 'name_en', 'short_description_ru', 'description_ru', 'seo_title_ru', 'seo_description_ru',
  // Brand and series
  'brand_id', 'brand_name', 'brand_slug', 'brand_country', 'brand_website_url', 'brand_is_active',
  'series_id', 'series_name', 'series_slug',
  // Categories
  'primary_category_id', 'primary_category_name_ru', 'primary_category_name_en', 'primary_category_name_hy',
  'primary_category_slug', 'primary_category_is_active', 'primary_category_path', 'primary_category_path_ids',
  'primary_category_url', 'parent_category_id', 'parent_category_name_ru', 'root_category_id', 'root_category_name_ru',
  'category_count', 'all_categories_json', 'legacy_categories',
  // Classification
  'product_type', 'equipment_type', 'equipment_type_source', 'system_type', 'energy_source', 'warm_floor_product_type',
  'engineering_profile_json', 'engineering_series', 'engineering_model', 'identity_status', 'data_completeness', 'source_verification',
  'required_for_selection_known', 'required_for_compatibility_known', 'missing_required_parameters', 'multi_condition_parameters',
  // Technical specifications
  'technical_specifications_count', 'technical_specifications_json',
  'structured_attributes_count', 'structured_attributes_json',
  'engineering_values_count', 'engineering_parameters_json',
  ...FLAT_ENGINEERING_PARAMETERS.map((parameter) => parameter.column),
  'feature_parameter_candidates_count', 'feature_parameter_candidates_json', 'import_source_features_json', 'calculator_inference_json',
  'cooling_power_kw', 'heating_power_kw', 'recommended_area_m2', 'suitable_for_cooling', 'suitable_for_heating',
  'warm_floor_linear_power_wm', 'warm_floor_cable_length_m', 'warm_floor_mat_area_m2', 'warm_floor_voltage_v',
  'warm_floor_room_types', 'warm_floor_floor_coverings', 'warm_floor_substrate_types', 'warm_floor_wet_zone_allowed',
  'compatible_system_types',
  // Images (image_url is the stored original; thumbnails are listed separately)
  'image_count', 'image_status', 'has_primary_image', 'has_original_image',
  'primary_image_url', 'primary_image_filename', 'primary_image_format', 'primary_image_width', 'primary_image_height',
  'primary_image_file_exists', 'primary_image_alt_text', 'primary_thumbnail_url',
  'all_image_urls_json', 'all_images_json', 'url_type',
  // Documents
  'document_count', 'documentation_status', 'datasheet_url', 'manual_url', 'certificate_url', 'all_documents_json',
  // Commercial
  'price_amd', 'price_tax_included', 'currency', 'unit', 'show_price', 'availability_status',
  // Inventory
  'inventory_source', 'stock_quantity_column', 'stock_quantity_total', 'stock_reserved_total', 'stock_available_total',
  'stock_warehouse_count', 'stock_updated_at_max', 'stock_by_warehouse_json',
  // Relations and selection
  'related_products_count', 'related_products_json',
  'is_calculator_accessory', 'accessory_group', 'accessory_default_enabled', 'required_accessory', 'optional_accessory',
  'calculator_priority', 'ai_selectable', 'ai_selection_notes', 'brand_quality_tier', 'installation_complexity',
  // Completeness
  'has_name', 'has_sku', 'has_category', 'has_description', 'has_technical_specifications', 'has_documentation',
  'catalog_completeness_status', 'completeness_issues',
  // Export metadata
  'export_schema_version', 'exported_at',
];

// ---------------------------------------------------------------- CSV writer

const FORMULA_START = /^[=+\-@\t\r]/;

/** One RFC 4180 field: always quoted, quotes doubled, line breaks preserved. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = typeof value === 'number' || typeof value === 'bigint' ? String(value) : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

export const CSV_BOM = '﻿';

export function exportFilename(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `OHMX_FULL_PRODUCT_CATALOG_${stamp}.csv`;
}

// ---------------------------------------------------------------- image headers

export type ImageInfo = { format: string; width: number; height: number };

function parseImageHeader(buf: Buffer): ImageInfo | null | 'need-more' {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 6).startsWith('GIF8')) {
    return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    if (buf.length < 30) return 'need-more';
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { format: 'webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
    return 'need-more';
  }
  return null;
}

/** Reads only as much of the file as the header needs (4 KB, growing up to 2 MB). Never modifies the file. */
export function readImageInfo(file: string): ImageInfo | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    for (let want = 4096; ; want *= 4) {
      const length = Math.min(want, size, 2 * 1024 * 1024);
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, 0);
      const info = parseImageHeader(buf);
      if (info !== 'need-more') return info;
      if (length >= size || length >= 2 * 1024 * 1024) return null;
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- snapshot

export type CatalogSnapshot = {
  products: Row[];
  brands: Map<number, Row>;
  series: Map<number, Row>;
  categories: Map<number, Row>;
  productCategories: Map<number, Row[]>;
  images: Map<number, Row[]>;
  documents: Map<number, Row[]>;
  features: Map<number, Row[]>;
  attributes: Map<number, Row[]>;
  engineeringValues: Map<number, Row[]>;
  engineeringProfiles: Map<number, Row>;
  stock: Map<number, Row[]>;
  relationships: Map<number, Row[]>;
  engineeringParameters: Map<number, Row>;
  conditionEntries: Map<number, Row[]>;
  conditionSets: Map<number, Row>;
  engineeringSources: Map<number, Row>;
  /** Optional calculator inference audit (product id -> derived values), see catalogCalculatorInference.ts. */
  calculatorInference?: Map<number, Row>;
};

function groupBy(rows: Row[], key: string) {
  const map = new Map<number, Row[]>();
  for (const row of rows) {
    const id = Number(row[key]);
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

function tableExists(db: Db, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

type TableSpec = { name: string; requires?: string[]; sql: string; key?: string; order?: string; map?: 'id' | 'product_id' };

/** Per-product tables are read in product-id ranges ("{range}") so no single query blocks the event loop for long. */
const SNAPSHOT_TABLES: TableSpec[] = [
  { name: 'products', sql: 'SELECT * FROM products p WHERE {range} ORDER BY p.id', key: 'p.id' },
  { name: 'brands', sql: 'SELECT * FROM brands', map: 'id' },
  { name: 'series', sql: 'SELECT * FROM series', map: 'id' },
  { name: 'categories', sql: 'SELECT * FROM categories', map: 'id' },
  { name: 'productCategories', sql: 'SELECT * FROM product_categories pc WHERE {range} ORDER BY pc.product_id, pc.is_primary DESC, pc.category_id', key: 'pc.product_id' },
  { name: 'images', sql: 'SELECT * FROM product_images i WHERE {range} ORDER BY i.product_id, i.is_cover DESC, i.sort_order, i.id', key: 'i.product_id' },
  { name: 'documents', sql: 'SELECT * FROM product_documents d WHERE {range} ORDER BY d.product_id, d.sort_order, d.id', key: 'd.product_id' },
  { name: 'features', sql: 'SELECT * FROM product_features f WHERE {range} ORDER BY f.product_id, f.sort_order, f.id', key: 'f.product_id' },
  { name: 'attributes', sql: 'SELECT * FROM product_attributes a WHERE {range} ORDER BY a.product_id, a.attribute_key, a.id', key: 'a.product_id' },
  {
    name: 'engineeringValues', requires: ['engineering_value', 'engineering_parameter'], key: 'v.product_id',
    sql: `SELECT v.*, p.code AS parameter_code, p.canonical_name AS parameter_name, p.canonical_unit AS parameter_unit
          FROM engineering_value v LEFT JOIN engineering_parameter p ON p.parameter_id = v.parameter_id
          WHERE {range} ORDER BY v.product_id, v.parameter_id, v.value_id`,
  },
  { name: 'engineeringProfiles', requires: ['engineering_product_profile'], sql: 'SELECT * FROM engineering_product_profile', map: 'product_id' },
  {
    name: 'stock', key: 's.product_id',
    sql: `SELECT s.*, w.name AS warehouse_name, w.slug AS warehouse_slug, w.is_active AS warehouse_is_active, w.sort_order AS warehouse_sort
          FROM stock s LEFT JOIN warehouses w ON w.id = s.warehouse_id WHERE {range} ORDER BY s.product_id, w.sort_order, s.warehouse_id`,
  },
  { name: 'engineeringParameters', requires: ['engineering_parameter'], sql: 'SELECT * FROM engineering_parameter', map: 'id' },
  { name: 'conditionSets', requires: ['engineering_condition_set'], sql: 'SELECT * FROM engineering_condition_set', map: 'id' },
  {
    name: 'conditionEntries', requires: ['engineering_condition_entry', 'engineering_condition_key'],
    sql: `SELECT ce.*, ck.unit AS key_unit FROM engineering_condition_entry ce LEFT JOIN engineering_condition_key ck ON ck.condition_key = ce.condition_key
          ORDER BY ce.condition_set_id, ce.condition_key`,
  },
  {
    name: 'engineeringSources', requires: ['engineering_source', 'engineering_source_type'],
    sql: 'SELECT s.*, st.verification_tier FROM engineering_source s LEFT JOIN engineering_source_type st ON st.source_type = s.source_type',
  },
  {
    name: 'relationships', requires: ['product_relationships'], key: 'r.source_product_id',
    sql: `SELECT r.*, t.sku AS target_sku FROM product_relationships r LEFT JOIN products t ON t.id = r.target_product_id
          WHERE {range} ORDER BY r.source_product_id, r.relation_type, r.target_product_id`,
  },
];

const GROUP_KEYS: Record<string, string> = { productCategories: 'product_id', images: 'product_id', documents: 'product_id', features: 'product_id', attributes: 'product_id', engineeringValues: 'product_id', stock: 'product_id', relationships: 'source_product_id' };
const RANGE_SIZE = 400;
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

function assemble(tables: Record<string, Row[]>): CatalogSnapshot {
  const byId = (rows: Row[] = [], key = 'id') => new Map(rows.map((row) => [Number(row[key]), row]));
  const grouped = (name: string) => groupBy(tables[name] || [], GROUP_KEYS[name]);
  return {
    products: tables.products || [],
    brands: byId(tables.brands),
    series: byId(tables.series),
    categories: byId(tables.categories),
    productCategories: grouped('productCategories'),
    images: grouped('images'),
    documents: grouped('documents'),
    features: grouped('features'),
    attributes: grouped('attributes'),
    engineeringValues: grouped('engineeringValues'),
    engineeringProfiles: byId(tables.engineeringProfiles, 'product_id'),
    stock: grouped('stock'),
    relationships: grouped('relationships'),
    engineeringParameters: byId(tables.engineeringParameters, 'parameter_id'),
    conditionSets: byId(tables.conditionSets, 'condition_set_id'),
    conditionEntries: groupBy(tables.conditionEntries || [], 'condition_set_id'),
    engineeringSources: byId(tables.engineeringSources, 'source_id'),
  };
}

/** Whole catalog in one read transaction (consistent snapshot), synchronously. Used by tests and small datasets. */
export function loadCatalogSnapshot(db: Db): CatalogSnapshot {
  return db.transaction(() => {
    const tables: Record<string, Row[]> = {};
    for (const spec of SNAPSHOT_TABLES) {
      if (spec.requires?.some((table) => !tableExists(db, table))) continue;
      tables[spec.name] = db.prepare(spec.sql.replace('{range}', '1 = 1')).all() as Row[];
    }
    return assemble(tables);
  })();
}

/**
 * Same snapshot through a dedicated read-only connection: one read transaction held across ticks (WAL keeps it
 * consistent and never blocks writers), product-id ranges between which the event loop serves other requests.
 * The application's shared connection is not used, so no other request runs inside this transaction.
 */
export type CalculatorInferenceLoader = (db: Db, ranges: [number, number][], nextTick: () => Promise<void>) => Promise<Map<number, Row>>;

export async function loadCatalogSnapshotPaged(
  dbFile: string,
  options: { open?: (file: string) => Db; calculatorInference?: CalculatorInferenceLoader } = {},
): Promise<CatalogSnapshot> {
  const db = (options.open || ((file: string) => new Database(file, { readonly: true, fileMustExist: true })))(dbFile);
  try {
    db.prepare('BEGIN').run();
    const bounds = db.prepare('SELECT MIN(id) AS lo, MAX(id) AS hi FROM products').get() as Row;
    const lo = Number(bounds?.lo || 0);
    const hi = Number(bounds?.hi || 0);
    const tables: Record<string, Row[]> = {};
    for (const spec of SNAPSHOT_TABLES) {
      if (spec.requires?.some((table) => !tableExists(db, table))) continue;
      if (!spec.key) {
        tables[spec.name] = db.prepare(spec.sql).all() as Row[];
        await nextTick();
        continue;
      }
      const statement = db.prepare(spec.sql.replace('{range}', `${spec.key} >= ? AND ${spec.key} < ?`));
      const rows: Row[] = [];
      // Rows whose product id falls outside the products range (orphans) are still exported by the leading/trailing ranges.
      for (const [from, to] of [[Number.MIN_SAFE_INTEGER, lo], ...rangeSteps(lo, hi), [hi + 1, Number.MAX_SAFE_INTEGER]]) {
        for (const row of statement.all(from, to) as Row[]) rows.push(row);
        await nextTick();
      }
      tables[spec.name] = rows;
    }
    // Same transaction: the audit sees exactly the snapshot the rows are built from.
    const calculatorInference = options.calculatorInference ? await options.calculatorInference(db, rangeSteps(lo, hi), nextTick) : undefined;
    db.prepare('COMMIT').run();
    return calculatorInference ? { ...assemble(tables), calculatorInference } : assemble(tables);
  } finally {
    if (db.inTransaction) db.prepare('ROLLBACK').run();
    db.close();
  }
}

function rangeSteps(lo: number, hi: number) {
  const steps: [number, number][] = [];
  for (let from = lo; from <= hi; from += RANGE_SIZE) steps.push([from, Math.min(from + RANGE_SIZE, hi + 1)]);
  return steps;
}

// ---------------------------------------------------------------- row building

const blank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';
const json = (value: unknown) => JSON.stringify(value);
const parseJsonOrRaw = (value: unknown) => {
  if (blank(value)) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return String(value);
  }
};
const STORAGE_PREFIX = '/storage/images/';

function categoryTrail(categoryId: number, categories: Map<number, Row>) {
  const trail: Row[] = [];
  const seen = new Set<number>();
  let current = categories.get(categoryId);
  while (current && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    trail.unshift(current);
    current = current.parent_id ? categories.get(Number(current.parent_id)) : undefined;
  }
  return { trail, cyclic: Boolean(current) };
}

/** Public URL /catalog/<root>/<…>/<slug>, only when the whole trail is active (archived categories have none). */
function categoryUrl(trail: Row[]) {
  if (!trail.length || trail.some((item) => Number(item.is_active) !== 1)) return '';
  return `/catalog/${trail.map((item) => item.slug).join('/')}`;
}

/** Resolves an application-relative /storage/images/ URL to a file inside storageRoot, or null when unsafe. */
export function storageFileFor(url: string, storageRoot: string): string | null {
  if (!url.startsWith(STORAGE_PREFIX)) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(url.slice(STORAGE_PREFIX.length));
  } catch {
    return null;
  }
  const base = path.resolve(storageRoot, 'images');
  const file = path.resolve(base, relative);
  return file.startsWith(base + path.sep) ? file : null;
}

function thumbnailFor(url: string, storageRoot: string) {
  const match = /^\/storage\/images\/products\/(.+)\.(?:jpe?g|png|webp|gif)$/i.exec(url);
  if (!match) return '';
  const thumb = `/storage/images/thumbs/${match[1]}.webp`;
  const file = storageFileFor(thumb, storageRoot);
  return file && fs.existsSync(file) ? thumb : '';
}

function describeImage(image: Row, storageRoot: string) {
  const url = String(image.image_url || '');
  const file = storageFileFor(url, storageRoot);
  const exists = Boolean(file && fs.existsSync(file));
  const info = exists && file ? readImageInfo(file) : null;
  return {
    url,
    valid_url: Boolean(file),
    file_exists: exists,
    filename: url ? path.posix.basename(url) : '',
    format: info?.format || (path.posix.extname(url).slice(1).toLowerCase() || ''),
    width: info?.width ?? null,
    height: info?.height ?? null,
    is_cover: Number(image.is_cover) === 1,
    sort_order: image.sort_order ?? 0,
    alt_text: image.alt_text ?? '',
    thumbnail_url: thumbnailFor(url, storageRoot),
  };
}

/**
 * Imported product_features that carry calculator-relevant parameters (names observed in the catalog, 2026-10-23).
 * Exported as unverified candidates: the stored text is copied as-is, nothing is parsed into the registry.
 */
type CandidateScope = (context: { warmFloorType: string; categoryName: string }) => boolean;
const HEAT_SOURCE_CATEGORY = /котл|радиатор|конвектор/i;
const WARM_FLOOR_ELEMENT: CandidateScope = ({ warmFloorType }) => warmFloorType === 'heating_cable' || warmFloorType === 'heating_mat';
export const FEATURE_CANDIDATE_RULES: ReadonlyArray<{ parameter: string; name: RegExp; scope?: CandidateScope }> = [
  { parameter: 'kvs', name: /^(kvs|коэффициент,?\s*kvs)$/i },
  { parameter: 'stroke', name: /ход штока/i },
  { parameter: 'actuator_travel_speed_or_time', name: /^(скорость|время) перемещения штока/i },
  { parameter: 'cooling_output', name: /^охлаждающая мощность/i },
  { parameter: 'heat_output', name: /^(тепловая мощность|номинальная тепловая мощность|минимальная тепловая мощность|номинальная макс\. мощность|полезная мощность|теплоотдача|мощность ∆t|мощность δt|мощность при \d)/i },
  { parameter: 'heat_output', name: /^мощность(, (квт|вт)| \(|,? кВт)/i, scope: ({ categoryName }) => HEAT_SOURCE_CATEGORY.test(categoryName) },
  { parameter: 'electrical_power', name: /^(потребляемая мощность|электрическая мощность|номинальная потребляемая мощность|номинальная мощность, вт|мощность при 230 в)/i },
  { parameter: 'linear_power', name: /^(линейная мощность|удельная мощность)/i },
  { parameter: 'cable_or_mat_length', name: /^длина, м$/i, scope: WARM_FLOOR_ELEMENT },
  { parameter: 'mat_width', name: /^ширина, м$/i, scope: WARM_FLOOR_ELEMENT },
  { parameter: 'heated_area', name: /^площадь (обогрева|отопление|отопления)/i },
  { parameter: 'rated_current', name: /^номинальный ток/i },
  { parameter: 'switched_current', name: /^коммутируемый ток/i },
  { parameter: 'nominal_voltage', name: /^номинальное напряжение$/i },
  { parameter: 'connection_size', name: /^размер присоединения$/i },
  { parameter: 'connection_type', name: /^тип присоединения$/i },
  { parameter: 'max_operating_temperature', name: /^макс(\.|имальная|имально допустимая)? (рабочая )?температур/i },
];

const CONDITION_MARKER = /(∆|Δ|\bt=|\bT=|при\s|\d+\s*°?\s*\/\s*\d+)/i;

export function featureParameterCandidates(features: Row[], context: { warmFloorType: string; categoryName: string }) {
  const candidates: Row[] = [];
  for (const feature of features) {
    const name = String(feature.feature_name || '').trim();
    const rule = FEATURE_CANDIDATE_RULES.find((item) => item.name.test(name) && (!item.scope || item.scope(context)));
    if (!rule) continue;
    const unitInName = /,\s*([^,]+)$/.exec(name)?.[1] ?? /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? null;
    candidates.push({
      parameter: rule.parameter,
      feature_name: name,
      value_raw: feature.feature_value ?? null,
      unit_raw: feature.feature_unit ?? null,
      unit_in_name: unitInName,
      conditions_in_name: CONDITION_MARKER.test(name) ? name : null,
      status: 'CANDIDATE_FROM_IMPORTED_FEATURE',
      verification: 'UNVERIFIED',
    });
  }
  return candidates;
}

/** Registry values with their operating conditions and source; plus required-coverage and flat columns. */
export function engineeringParameterView(values: Row[], equipmentType: string, snapshot: CatalogSnapshot) {
  const parameters = values.map((value) => {
    const parameter = snapshot.engineeringParameters.get(Number(value.parameter_id));
    const set = value.condition_set_id ? snapshot.conditionSets.get(Number(value.condition_set_id)) : undefined;
    const entries = value.condition_set_id ? snapshot.conditionEntries.get(Number(value.condition_set_id)) || [] : [];
    const source = value.source_id ? snapshot.engineeringSources.get(Number(value.source_id)) : undefined;
    const boolean = value.value_boolean === null || value.value_boolean === undefined ? null : Number(value.value_boolean) === 1;
    return {
      code: parameter?.code ?? value.parameter_code ?? null,
      name: parameter?.canonical_name ?? value.parameter_name ?? null,
      requirement_level: parameter?.requirement_level ?? null,
      value_type: parameter?.value_type ?? null,
      value: value.value_numeric ?? value.value_text ?? boolean,
      unit: value.unit ?? parameter?.canonical_unit ?? null,
      canonical_unit: parameter?.canonical_unit ?? null,
      status: value.value_status ?? null,
      confidence: value.confidence ?? null,
      condition_set_code: set?.code ?? null,
      conditions: entries.map((entry) => ({
        key: entry.condition_key,
        value: entry.value_numeric ?? entry.value_text ?? (entry.value_boolean === null || entry.value_boolean === undefined ? null : Number(entry.value_boolean) === 1),
        unit: entry.key_unit ?? null,
      })),
      source: source ? {
        type: source.source_type ?? null, verification_tier: source.verification_tier ?? null, manufacturer: source.manufacturer ?? null,
        document_title: source.document_title ?? null, document_version: source.document_version ?? null, page: source.page ?? null,
        table_name: source.table_name ?? null, url: source.url ?? null, retrieved_at: source.retrieved_at ?? null, audited_at: source.audited_at ?? null,
      } : null,
    };
  });
  const known = new Map<string, typeof parameters>();
  for (const parameter of parameters) {
    if (parameter.status !== 'KNOWN' || !parameter.code) continue;
    known.set(parameter.code, [...(known.get(parameter.code) || []), parameter]);
  }
  const registry = [...snapshot.engineeringParameters.values()].filter((parameter) => equipmentType && parameter.equipment_type === equipmentType);
  const coverage = (level: string) => {
    const required = registry.filter((parameter) => parameter.requirement_level === level);
    return { total: required.length, known: required.filter((parameter) => known.has(parameter.code)).length, missing: required.filter((parameter) => !known.has(parameter.code)).map((parameter) => parameter.code) };
  };
  const selection = coverage('REQUIRED_FOR_SELECTION');
  const compatibility = coverage('REQUIRED_FOR_COMPATIBILITY');
  const flat: Record<string, unknown> = {};
  const multi: string[] = [];
  const notes: string[] = [];
  for (const { code, column, unit } of FLAT_ENGINEERING_PARAMETERS) {
    const list = known.get(code) || [];
    flat[column] = '';
    if (list.length > 1) multi.push(`${code}(${list.length})`);
    if (list.length !== 1) continue;
    const [only] = list;
    const numeric = only.value_type === 'NUMERIC';
    if (numeric && unit !== null && only.unit !== unit) { notes.push(`${code}:unit_${only.unit}`); continue; }
    flat[column] = only.value === null ? '' : only.value;
  }
  return {
    parameters,
    flat,
    selectionKnown: registry.length ? `${selection.known}/${selection.total}` : '',
    compatibilityKnown: registry.length ? `${compatibility.known}/${compatibility.total}` : '',
    missingRequired: [...selection.missing, ...compatibility.missing],
    multiCondition: multi,
    unitNotes: notes,
  };
}

const docUrlByType = (docs: Row[], pattern: RegExp) => docs.find((doc) => pattern.test(String(doc.document_type || '')))?.file_url || '';

export function buildProductRow(product: Row, snapshot: CatalogSnapshot, options: { storageRoot: string; exportedAt: string }): Record<string, unknown> {
  const id = Number(product.id);
  const issues: string[] = [];
  const brand = product.brand_id ? snapshot.brands.get(Number(product.brand_id)) : undefined;
  const series = product.series_id ? snapshot.series.get(Number(product.series_id)) : undefined;

  // Categories: primary + every product_categories link + legacy category_id, without duplicates.
  const primaryId = Number(product.primary_category_id || product.category_id || 0) || null;
  const links = snapshot.productCategories.get(id) || [];
  const categoryIds = [...new Set([primaryId, Number(product.category_id || 0) || null, ...links.map((link) => Number(link.category_id))].filter((value): value is number => Boolean(value)))];
  const primary = primaryId ? snapshot.categories.get(primaryId) : undefined;
  const { trail: primaryTrail, cyclic } = primaryId ? categoryTrail(primaryId, snapshot.categories) : { trail: [] as Row[], cyclic: false };
  if (!primaryId) issues.push('missing_category');
  else if (!primary) issues.push('primary_category_not_found');
  else if (Number(primary.is_active) !== 1) issues.push('primary_category_inactive');
  if (cyclic) issues.push('category_cycle');
  const allCategories = categoryIds.map((categoryId) => {
    const category = snapshot.categories.get(categoryId);
    const { trail } = categoryTrail(categoryId, snapshot.categories);
    const link = links.find((item) => Number(item.category_id) === categoryId);
    return {
      id: categoryId,
      name_ru: category?.name_ru ?? null,
      slug: category?.slug ?? null,
      path: trail.map((item) => item.name_ru).join(' > '),
      is_active: category ? Number(category.is_active) === 1 : null,
      is_primary: categoryId === primaryId,
      linked_via: [link ? 'product_categories' : null, categoryId === Number(product.primary_category_id) ? 'primary_category_id' : null, categoryId === Number(product.category_id) ? 'category_id' : null].filter(Boolean),
      found: Boolean(category),
    };
  });
  for (const category of allCategories) if (!category.found) issues.push(`category_not_found:${category.id}`);

  // Specifications. "source" feature rows are import bookkeeping (hidden on the storefront) and are kept separately.
  const features = snapshot.features.get(id) || [];
  const specifications = features.filter((feature) => String(feature.feature_name || '').trim().toLowerCase() !== 'source');
  const importSource = features.filter((feature) => String(feature.feature_name || '').trim().toLowerCase() === 'source');
  const attributes = snapshot.attributes.get(id) || [];
  const engineering = snapshot.engineeringValues.get(id) || [];
  const profile = snapshot.engineeringProfiles.get(id);
  const productType = attributes.find((attribute) => attribute.attribute_key === 'product_type')?.value_text ?? '';
  // Equipment type: engineering profile first (authoritative registry), then the legacy product columns.
  const profileType = String(profile?.equipment_type || '');
  const equipmentType = profileType || String(product.equipment_type || '').trim() || String(product.warm_floor_product_type || '').trim();
  const equipmentTypeSource = profileType ? 'engineering_product_profile'
    : !blank(product.equipment_type) ? 'products.equipment_type'
      : !blank(product.warm_floor_product_type) ? 'products.warm_floor_product_type' : '';
  const engineeringView = engineeringParameterView(engineering, profileType, snapshot);
  for (const note of engineeringView.unitNotes) issues.push(`engineering_unit_mismatch:${note}`);
  const candidates = featureParameterCandidates(specifications, {
    warmFloorType: String(product.warm_floor_product_type || '').trim(),
    categoryName: String(snapshot.categories.get(Number(product.primary_category_id || product.category_id || 0))?.name_ru || ''),
  });
  const inference = snapshot.calculatorInference?.get(id);

  // Images
  const images = (snapshot.images.get(id) || []).map((image) => describeImage(image, options.storageRoot));
  const primaryImage = images[0];
  let imageStatus = 'missing';
  if (primaryImage) imageStatus = !primaryImage.valid_url ? 'invalid_url' : primaryImage.file_exists ? 'present' : 'file_missing';
  if (!primaryImage) issues.push('missing_image');
  else if (!primaryImage.valid_url) issues.push('invalid_image_url');
  else if (!primaryImage.file_exists) issues.push('image_file_missing');
  for (const image of images.slice(1)) {
    if (!image.valid_url) issues.push(`invalid_additional_image_url:${image.filename}`);
    else if (!image.file_exists) issues.push(`additional_image_file_missing:${image.filename}`);
  }

  // Documents: all rows with their state; links only for active, not deleted documents.
  const documentRows = snapshot.documents.get(id) || [];
  const liveDocuments = documentRows.filter((doc) => Number(doc.is_active ?? 1) === 1 && blank(doc.deleted_at));

  // Inventory
  const stockRows = snapshot.stock.get(id) || [];
  const sum = (key: string) => stockRows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const stockUpdatedMax = stockRows.reduce((max, row) => (String(row.updated_at || '') > max ? String(row.updated_at) : max), '');

  const relationships = snapshot.relationships.get(id) || [];

  const hasName = !blank(product.name_ru);
  const hasSku = !blank(product.sku);
  const hasCategory = Boolean(primary && Number(primary.is_active) === 1);
  const hasDescription = !blank(product.description_ru) || !blank(product.short_description_ru);
  const hasSpecifications = specifications.length > 0 || attributes.length > 0 || engineering.length > 0;
  if (!hasName) issues.push('missing_name');
  if (!hasSku) issues.push('missing_sku');
  if (!hasDescription) issues.push('missing_description');
  if (!hasSpecifications) issues.push('missing_technical_specifications');
  // Required: name, SKU, active category, primary image file. Recommended: description, specifications. Documents are optional.
  const requiredOk = hasName && hasSku && hasCategory && imageStatus === 'present';
  const completeness = !requiredOk ? 'incomplete' : hasDescription && hasSpecifications ? 'complete' : 'partial';

  const parent = primary?.parent_id ? snapshot.categories.get(Number(primary.parent_id)) : undefined;
  const root = primaryTrail[0];

  const row: Record<string, unknown> = {
    product_id: id,
    sku: product.sku ?? '',
    supplier_reference: product.supplier_reference ?? '',
    old_id: product.old_id ?? '',
    slug: product.slug ?? '',
    product_url: product.slug ? `/product/${product.slug}` : '',
    admin_edit_url: `/admin/products/${id}/edit`,
    is_active: product.is_active ?? '',
    is_featured: product.is_featured ?? '',
    created_at: product.created_at ?? '',
    updated_at: product.updated_at ?? '',
    name_ru: product.name_ru ?? '',
    name_hy: product.name_hy ?? '',
    name_en: product.name_en ?? '',
    short_description_ru: product.short_description_ru ?? '',
    description_ru: product.description_ru ?? '',
    seo_title_ru: product.seo_title_ru ?? '',
    seo_description_ru: product.seo_description_ru ?? '',
    brand_id: product.brand_id ?? '',
    brand_name: brand?.name ?? '',
    brand_slug: brand?.slug ?? '',
    brand_country: brand?.country ?? '',
    brand_website_url: brand?.website_url ?? '',
    brand_is_active: brand?.is_active ?? '',
    series_id: product.series_id ?? '',
    series_name: series?.name ?? '',
    series_slug: series?.slug ?? '',
    primary_category_id: primaryId ?? '',
    primary_category_name_ru: primary?.name_ru ?? '',
    primary_category_name_en: primary?.name_en ?? '',
    primary_category_name_hy: primary?.name_hy ?? '',
    primary_category_slug: primary?.slug ?? '',
    primary_category_is_active: primary?.is_active ?? '',
    primary_category_path: primaryTrail.map((item) => item.name_ru).join(' > '),
    primary_category_path_ids: primaryTrail.map((item) => item.id).join(' > '),
    primary_category_url: categoryUrl(primaryTrail),
    parent_category_id: parent?.id ?? '',
    parent_category_name_ru: parent?.name_ru ?? '',
    root_category_id: root?.id ?? '',
    root_category_name_ru: root?.name_ru ?? '',
    category_count: allCategories.length,
    all_categories_json: json(allCategories.map(({ found, ...category }) => category)),
    legacy_categories: product.legacy_categories ?? '',
    product_type: productType,
    equipment_type: equipmentType,
    equipment_type_source: equipmentTypeSource,
    system_type: product.system_type ?? '',
    energy_source: product.energy_source ?? '',
    warm_floor_product_type: product.warm_floor_product_type ?? '',
    engineering_profile_json: profile ? json(profile) : '',
    engineering_series: profile?.series ?? '',
    engineering_model: profile?.model ?? '',
    identity_status: profile?.identity_status ?? '',
    data_completeness: profile?.data_completeness ?? '',
    source_verification: profile?.source_verification ?? '',
    required_for_selection_known: engineeringView.selectionKnown,
    required_for_compatibility_known: engineeringView.compatibilityKnown,
    missing_required_parameters: engineeringView.missingRequired.join(' | '),
    multi_condition_parameters: engineeringView.multiCondition.join(' | '),
    technical_specifications_count: specifications.length,
    technical_specifications_json: json(specifications.map((feature) => ({ name: feature.feature_name, value: feature.feature_value, unit: feature.feature_unit ?? null, sort_order: feature.sort_order ?? 0 }))),
    structured_attributes_count: attributes.length,
    structured_attributes_json: json(attributes.map((attribute) => ({
      key: attribute.attribute_key, value_text: attribute.value_text ?? null, value_number: attribute.value_number ?? null, unit: attribute.value_unit ?? null,
      confidence: attribute.confidence ?? null, source: attribute.source ?? null, extraction_version: attribute.extraction_version ?? null,
    }))),
    engineering_values_count: engineering.length,
    engineering_parameters_json: engineering.length ? json(engineeringView.parameters) : '[]',
    feature_parameter_candidates_count: candidates.length,
    feature_parameter_candidates_json: json(candidates),
    import_source_features_json: json(importSource.map((feature) => ({ value: feature.feature_value, unit: feature.feature_unit ?? null }))),
    calculator_inference_json: inference ? json(inference) : '',
    cooling_power_kw: product.cooling_power_kw ?? '',
    heating_power_kw: product.heating_power_kw ?? '',
    recommended_area_m2: product.recommended_area_m2 ?? '',
    suitable_for_cooling: product.suitable_for_cooling ?? '',
    suitable_for_heating: product.suitable_for_heating ?? '',
    warm_floor_linear_power_wm: product.warm_floor_linear_power_wm ?? '',
    warm_floor_cable_length_m: product.warm_floor_cable_length_m ?? '',
    warm_floor_mat_area_m2: product.warm_floor_mat_area_m2 ?? '',
    warm_floor_voltage_v: product.warm_floor_voltage_v ?? '',
    warm_floor_room_types: product.warm_floor_room_types ?? '',
    warm_floor_floor_coverings: product.warm_floor_floor_coverings ?? '',
    warm_floor_substrate_types: product.warm_floor_substrate_types ?? '',
    warm_floor_wet_zone_allowed: product.warm_floor_wet_zone_allowed ?? '',
    compatible_system_types: product.compatible_system_types ?? '',
    image_count: images.length,
    image_status: imageStatus,
    has_primary_image: primaryImage ? 1 : 0,
    has_original_image: primaryImage?.file_exists ? 1 : 0,
    primary_image_url: primaryImage?.url ?? '',
    primary_image_filename: primaryImage?.filename ?? '',
    primary_image_format: primaryImage?.format ?? '',
    primary_image_width: primaryImage?.width ?? '',
    primary_image_height: primaryImage?.height ?? '',
    primary_image_file_exists: primaryImage ? (primaryImage.file_exists ? 1 : 0) : '',
    primary_image_alt_text: primaryImage?.alt_text ?? '',
    primary_thumbnail_url: primaryImage?.thumbnail_url ?? '',
    all_image_urls_json: json(images.map((image) => image.url)),
    all_images_json: json(images.map(({ valid_url, ...image }) => image)),
    url_type: 'relative',
    document_count: liveDocuments.length,
    documentation_status: liveDocuments.length ? 'present' : 'none',
    datasheet_url: docUrlByType(liveDocuments, /data|spec|паспорт/i),
    manual_url: docUrlByType(liveDocuments, /manual|instruction|инструкц/i),
    certificate_url: docUrlByType(liveDocuments, /cert|сертиф/i),
    all_documents_json: json(documentRows.map((doc) => ({
      id: doc.id, name: doc.document_name, type: doc.document_type, url: doc.file_url, extension: doc.file_extension ?? null,
      size: doc.file_size ?? null, language: doc.language ?? null, version: doc.version ?? null,
      is_public: doc.is_public ?? null, is_active: doc.is_active ?? null, deleted_at: doc.deleted_at ?? null, sort_order: doc.sort_order ?? 0,
    }))),
    price_amd: product.price_amd ?? '',
    price_tax_included: product.price_tax_included ?? '',
    currency: product.currency ?? '',
    unit: product.unit ?? '',
    show_price: product.show_price ?? '',
    availability_status: product.availability_status ?? '',
    inventory_source: INVENTORY_SOURCE,
    stock_quantity_column: product.stock_quantity ?? '',
    stock_quantity_total: sum('quantity'),
    stock_reserved_total: sum('reserved_quantity'),
    stock_available_total: sum('available_quantity'),
    stock_warehouse_count: stockRows.length,
    stock_updated_at_max: stockUpdatedMax,
    stock_by_warehouse_json: json(stockRows.map((row) => ({
      warehouse_id: row.warehouse_id, warehouse_name: row.warehouse_name ?? null, warehouse_slug: row.warehouse_slug ?? null,
      warehouse_is_active: row.warehouse_is_active ?? null, quantity: row.quantity ?? 0, reserved_quantity: row.reserved_quantity ?? 0,
      available_quantity: row.available_quantity ?? 0, updated_at: row.updated_at ?? null,
    }))),
    related_products_count: relationships.length,
    related_products_json: json(relationships.map((relation) => ({
      target_product_id: relation.target_product_id, target_sku: relation.target_sku ?? null, relation_type: relation.relation_type,
      review_status: relation.review_status, confidence: relation.confidence, rule_source: relation.rule_source,
      reason_engineering: relation.reason_engineering ?? null, conditions: parseJsonOrRaw(relation.conditions_json),
      manual_review_required: relation.manual_review_required ?? null, reviewed_at: relation.reviewed_at ?? null,
    }))),
    is_calculator_accessory: product.is_calculator_accessory ?? '',
    accessory_group: product.accessory_group ?? '',
    accessory_default_enabled: product.accessory_default_enabled ?? '',
    required_accessory: product.required_accessory ?? '',
    optional_accessory: product.optional_accessory ?? '',
    calculator_priority: product.calculator_priority ?? '',
    ai_selectable: product.ai_selectable ?? '',
    ai_selection_notes: product.ai_selection_notes ?? '',
    brand_quality_tier: product.brand_quality_tier ?? '',
    installation_complexity: product.installation_complexity ?? '',
    has_name: hasName ? 1 : 0,
    has_sku: hasSku ? 1 : 0,
    has_category: hasCategory ? 1 : 0,
    has_description: hasDescription ? 1 : 0,
    has_technical_specifications: hasSpecifications ? 1 : 0,
    has_documentation: liveDocuments.length ? 1 : 0,
    catalog_completeness_status: completeness,
    completeness_issues: issues.join(' | '),
    export_schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: options.exportedAt,
  };
  // Added after the literal: spreading into a ~170-key literal makes V8 build every row in slow mode.
  return Object.assign(row, engineeringView.flat);
}

export function rowValues(row: Record<string, unknown>) {
  return FULL_EXPORT_COLUMNS.map((column) => row[column]);
}
