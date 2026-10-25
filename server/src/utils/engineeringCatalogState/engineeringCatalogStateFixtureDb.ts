/**
 * ENGINEERING-CATALOG-CM15 — PURE TEST-SUPPORT fixture factory.
 *
 * Builds an in-memory better-sqlite3 database with the EXACT production DDL
 * (from reports/engineering-catalog/ENGINEERING-PRODUCT-DATA-SCHEMA-V1.sql and
 * server/src/schema.sql) and a deterministic base fixture for the frozen
 * scope ["FAN_COIL", "HEAT_PUMP"]. TEST LAYER ONLY: the write helpers below
 * are called exclusively from *.test.ts files — the provider itself never
 * writes and never imports this module's writers.
 *
 * The base fixture is deterministic: fixed ids, fixed text, no clock, no
 * randomness. Default state: 2 products (1 FAN_COIL + 1 HEAT_PUMP), full
 * parameter/value/condition-set/condition-entry/condition-key/source/
 * source-type rows, and one technical relationship.
 */
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Production DDL (subset needed by the engineering projection — verbatim
// column/constraint fidelity)
// ---------------------------------------------------------------------------

const DDL = [
  `CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name_ru TEXT NOT NULL,
    name_hy TEXT,
    name_en TEXT,
    slug TEXT UNIQUE NOT NULL,
    brand_id INTEGER,
    series_id INTEGER,
    primary_category_id INTEGER,
    category_id INTEGER,
    price_amd REAL DEFAULT 0,
    price_tax_included REAL DEFAULT 0,
    currency TEXT DEFAULT 'AMD',
    unit TEXT DEFAULT 'шт',
    show_price INTEGER DEFAULT 1,
    availability_status TEXT,
    stock_quantity REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_featured INTEGER DEFAULT 0,
    seo_title_ru TEXT,
    seo_description_ru TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE engineering_product_profile (
    product_id          INTEGER PRIMARY KEY REFERENCES products(id),
    equipment_type      TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),
    series              TEXT,
    model               TEXT,
    identity_status     TEXT NOT NULL DEFAULT 'IDENTITY_UNCERTAIN'
                        CHECK (identity_status IN ('IDENTIFIED','IDENTITY_PARTIAL','IDENTITY_UNCERTAIN')),
    data_completeness   TEXT NOT NULL DEFAULT 'BLOCKED'
                        CHECK (data_completeness IN ('COMPLETE','PARTIAL','BLOCKED')),
    source_verification TEXT NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (source_verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED')),
    schema_id           TEXT NOT NULL DEFAULT 'ohmx.engineering-product.v1',
    schema_version      TEXT NOT NULL DEFAULT '1.0.0',
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE engineering_equipment_type (
    equipment_type TEXT PRIMARY KEY,
    description    TEXT
  )`,
  `CREATE TABLE engineering_parameter (
    parameter_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_type    TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),
    code              TEXT NOT NULL,
    canonical_name    TEXT NOT NULL,
    value_type        TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),
    canonical_unit    TEXT,
    requirement_level TEXT NOT NULL CHECK (requirement_level IN ('REQUIRED_FOR_SELECTION','REQUIRED_FOR_COMPATIBILITY','RECOMMENDED','INFORMATIONAL')),
    description       TEXT,
    UNIQUE (equipment_type, code)
  )`,
  `CREATE TABLE engineering_value (
    value_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id       INTEGER NOT NULL REFERENCES products(id),
    parameter_id     INTEGER NOT NULL REFERENCES engineering_parameter(parameter_id),
    value_numeric    REAL,
    value_text       TEXT,
    value_boolean    INTEGER CHECK (value_boolean IN (0,1)),
    unit             TEXT,
    condition_set_id INTEGER REFERENCES engineering_condition_set(condition_set_id),
    source_id        INTEGER REFERENCES engineering_source(source_id),
    value_status     TEXT NOT NULL DEFAULT 'KNOWN'
                     CHECK (value_status IN ('KNOWN','UNKNOWN','CONFLICT','REVIEW_REQUIRED')),
    confidence       REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
      (value_status = 'UNKNOWN' AND value_numeric IS NULL AND value_text IS NULL AND value_boolean IS NULL)
      OR
      (value_status <> 'UNKNOWN' AND (value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)
    )
  )`,
  `CREATE TABLE engineering_condition_set (
    condition_set_id INTEGER PRIMARY KEY AUTOINCREMENT,
    code             TEXT NOT NULL UNIQUE,
    description      TEXT,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE engineering_condition_entry (
    condition_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    condition_set_id   INTEGER NOT NULL REFERENCES engineering_condition_set(condition_set_id),
    condition_key      TEXT NOT NULL REFERENCES engineering_condition_key(condition_key),
    value_numeric      REAL,
    value_text         TEXT,
    value_boolean      INTEGER CHECK (value_boolean IN (0,1)),
    UNIQUE (condition_set_id, condition_key),
    CHECK ((value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)
  )`,
  `CREATE TABLE engineering_condition_key (
    condition_key TEXT PRIMARY KEY,
    value_type    TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),
    unit          TEXT,
    description   TEXT
  )`,
  `CREATE TABLE engineering_source (
    source_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type      TEXT NOT NULL REFERENCES engineering_source_type(source_type),
    manufacturer     TEXT,
    document_title   TEXT,
    document_version TEXT,
    url              TEXT,
    page             TEXT,
    table_name       TEXT,
    retrieved_at     TEXT,
    audited_at       TEXT,
    notes            TEXT
  )`,
  `CREATE TABLE engineering_source_type (
    source_type       TEXT PRIMARY KEY,
    verification_tier TEXT NOT NULL CHECK (verification_tier IN ('AUTHORITATIVE','VERIFIED_SECONDARY','UNVERIFIED')),
    description       TEXT
  )`,
  `CREATE TABLE product_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_product_id INTEGER NOT NULL,
    target_product_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('required','recommended','optional','alternative','incompatible')),
    reason_engineering TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
    rule_source TEXT NOT NULL DEFAULT 'manual' CHECK (rule_source IN ('manual','taxonomy_rule','import_mapping','calculator_rule','ai_suggested')),
    manual_review_required INTEGER NOT NULL DEFAULT 1 CHECK (manual_review_required IN (0,1)),
    review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('draft','pending_review','approved','rejected','archived')),
    conditions_json TEXT,
    created_by TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CHECK (source_product_id <> target_product_id),
    CHECK (review_status != 'approved' OR length(trim(reason_engineering)) >= 20),
    UNIQUE (source_product_id, target_product_id, relation_type)
  )`,
];

// ---------------------------------------------------------------------------
// Deterministic base fixture
// ---------------------------------------------------------------------------

export interface FixtureIds {
  productIdFanCoil: number;
  productIdHeatPump: number;
  parameterHeatingCapacityId: number;
  parameterCoolingCapacityId: number;
  conditionSetHeatingId: number;
  conditionSetCoolingId: number;
  sourceDatasheetId: number;
}

/**
 * Create the fixture DB. Pass `filePath` to materialize it as a real SQLite
 * file (used by file-identity / mtime invariance tests); omit for an
 * in-memory database. The DDL and seed are identical either way.
 */
export function createEngineeringCatalogStateFixtureDb(filePath?: string): {
  db: Database.Database;
  ids: FixtureIds;
} {
  const db = filePath == null ? new Database(":memory:") : new Database(filePath);
  for (const ddl of DDL) db.exec(ddl);

  db.exec(`
    INSERT INTO engineering_equipment_type (equipment_type, description) VALUES
      ('FAN_COIL', 'fan coil unit'),
      ('HEAT_PUMP', 'air-to-water heat pump');
    INSERT INTO engineering_source_type (source_type, verification_tier) VALUES
      ('MANUFACTURER_DATASHEET', 'AUTHORITATIVE'),
      ('MANUAL_VERIFICATION', 'VERIFIED_SECONDARY');
    INSERT INTO products (id, sku, name_ru, slug) VALUES
      (1001, 'FC-1001', 'Тестовый фанкойл FC-1001', 'fc-1001'),
      (2002, 'HP-2002', 'Тестовый тепловой насос HP-2002', 'hp-2002');
    INSERT INTO engineering_product_profile
      (product_id, equipment_type, series, model, identity_status, data_completeness, source_verification)
    VALUES
      (1001, 'FAN_COIL', 'FC', 'FC-1001-M', 'IDENTIFIED', 'PARTIAL', 'PARTIALLY_VERIFIED'),
      (2002, 'HEAT_PUMP', 'NX', 'NXHM-9', 'IDENTIFIED', 'COMPLETE', 'VERIFIED');
    INSERT INTO engineering_parameter
      (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level)
    VALUES
      (11, 'FAN_COIL', 'heating_capacity_kw', 'Heating capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'),
      (12, 'FAN_COIL', 'cooling_capacity_kw', 'Cooling capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'),
      (13, 'HEAT_PUMP', 'heating_capacity_kw', 'Heating capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION');
    INSERT INTO engineering_condition_set (condition_set_id, code) VALUES
      (71, 'FC-HEAT-70/60'),
      (72, 'FC-COOL-7/12');
    INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES
      ('water_supply_c', 'NUMERIC', '°C'),
      ('water_return_c', 'NUMERIC', '°C');
    INSERT INTO engineering_condition_entry (condition_set_id, condition_key, value_numeric) VALUES
      (71, 'water_supply_c', 70.0),
      (71, 'water_return_c', 60.0),
      (72, 'water_supply_c', 7.0),
      (72, 'water_return_c', 12.0);
    INSERT INTO engineering_source
      (source_id, source_type, manufacturer, document_title, document_version, url)
    VALUES
      (91, 'MANUFACTURER_DATASHEET', 'Fixture Vendor', 'Fixture Datasheet', 'V1.0', 'https://fixture.invalid/ds.pdf'),
      (92, 'MANUAL_VERIFICATION', NULL, NULL, NULL, NULL);
    INSERT INTO engineering_value
      (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence)
    VALUES
      (1001, 11, 5.2, 'kW', 71, 91, 'KNOWN', 0.95),
      (1001, 12, 4.8, 'kW', 72, 91, 'KNOWN', 0.9),
      (2002, 13, 9.1, 'kW', NULL, 92, 'KNOWN', 0.85);
    INSERT INTO product_relationships
      (source_product_id, target_product_id, relation_type, reason_engineering)
    VALUES
      (2002, 1001, 'required', 'Fixture-required pairing of heat pump and fan coil');
  `);

  const ids: FixtureIds = {
    productIdFanCoil: 1001,
    productIdHeatPump: 2002,
    parameterHeatingCapacityId: 11,
    parameterCoolingCapacityId: 12,
    conditionSetHeatingId: 71,
    conditionSetCoolingId: 72,
    sourceDatasheetId: 91,
  };
  return { db, ids };
}
