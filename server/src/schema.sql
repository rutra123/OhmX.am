CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  name_ru TEXT NOT NULL,
  name_hy TEXT,
  name_en TEXT,
  slug TEXT UNIQUE NOT NULL,
  description_ru TEXT,
  short_description_ru TEXT,
  icon TEXT,
  image_url TEXT,
  menu_type TEXT DEFAULT 'category',
  old_aliases TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  is_public INTEGER DEFAULT 1,
  is_public_card INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  logo_url TEXT,
  description_ru TEXT,
  website_url TEXT,
  slug TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  is_popular INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER,
  category_id INTEGER,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description_ru TEXT,
  image_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_id INTEGER,
  sku TEXT UNIQUE NOT NULL,
  name_ru TEXT NOT NULL,
  name_hy TEXT,
  name_en TEXT,
  slug TEXT UNIQUE NOT NULL,
  brand_id INTEGER,
  series_id INTEGER,
  primary_category_id INTEGER,
  category_id INTEGER,
  short_description_ru TEXT,
  description_ru TEXT,
  price_amd REAL DEFAULT 0,
  price_tax_included REAL DEFAULT 0,
  currency TEXT DEFAULT 'AMD',
  unit TEXT DEFAULT 'шт',
  show_price INTEGER DEFAULT 1,
  availability_status TEXT,
  stock_quantity REAL DEFAULT 0,
  supplier_reference TEXT,
  legacy_categories TEXT,
  cooling_power_kw REAL,
  heating_power_kw REAL,
  recommended_area_m2 REAL,
  equipment_type TEXT,
  suitable_for_cooling INTEGER DEFAULT 0,
  suitable_for_heating INTEGER DEFAULT 0,
  is_calculator_accessory INTEGER DEFAULT 0,
  accessory_group TEXT,
  accessory_default_enabled INTEGER DEFAULT 1,
  energy_source TEXT,
  system_type TEXT,
  calculator_priority INTEGER DEFAULT 0,
  warm_floor_product_type TEXT,
  warm_floor_linear_power_wm REAL,
  warm_floor_cable_length_m REAL,
  warm_floor_mat_area_m2 REAL,
  warm_floor_voltage_v REAL,
  warm_floor_room_types TEXT,
  warm_floor_floor_coverings TEXT,
  warm_floor_substrate_types TEXT,
  warm_floor_wet_zone_allowed INTEGER,
  is_active INTEGER DEFAULT 1,
  is_featured INTEGER DEFAULT 0,
  seo_title_ru TEXT,
  seo_description_ru TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_categories (
  product_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  is_primary INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, category_id)
);
CREATE TABLE IF NOT EXISTS product_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  feature_name TEXT NOT NULL,
  feature_value TEXT NOT NULL,
  feature_unit TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  is_cover INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_extension TEXT,
  file_size INTEGER DEFAULT 0,
  language TEXT DEFAULT 'ru',
  version TEXT,
  is_public INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
  reserved_quantity REAL DEFAULT 0,
  available_quantity REAL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  delivery_type TEXT,
  pickup_warehouse TEXT,
  comment TEXT,
  total_amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'AMD',
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  sku TEXT,
  product_name TEXT,
  quantity REAL DEFAULT 0,
  price_amd REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hint TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT,
  mode TEXT DEFAULT 'products_csv',
  created_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  summary_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_relationships (
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
);

CREATE TABLE IF NOT EXISTS relationship_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('category_to_category','product_type_to_product_type','brand_series_compatibility','attribute_match','calculator_rule','manual_seed')),
  source_selector_json TEXT NOT NULL,
  target_selector_json TEXT NOT NULL,
  proposed_relation_type TEXT NOT NULL CHECK (proposed_relation_type IN ('required','recommended','optional','alternative','incompatible')),
  conditions_json TEXT,
  default_confidence TEXT NOT NULL DEFAULT 'low' CHECK (default_confidence IN ('high','medium','low')),
  auto_apply_allowed INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply_allowed IN (0,1)),
  manual_review_required INTEGER NOT NULL DEFAULT 1 CHECK (manual_review_required IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relationship_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_product_id INTEGER,
  target_product_id INTEGER,
  proposed_relation_type TEXT NOT NULL CHECK (proposed_relation_type IN ('required','recommended','optional','alternative','incompatible')),
  reason_engineering TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium','low')),
  rule_source TEXT NOT NULL DEFAULT 'taxonomy_rule' CHECK (rule_source IN ('manual','taxonomy_rule','import_mapping','calculator_rule','ai_suggested')),
  rule_id INTEGER,
  missing_facts_json TEXT,
  conditions_json TEXT,
  priority TEXT NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3')),
  review_status TEXT NOT NULL DEFAULT 'generated' CHECK (review_status IN ('generated','pending_review','in_review','approved','rejected','needs_data','superseded','archived')),
  reviewer_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (rule_id) REFERENCES relationship_rules(id) ON DELETE SET NULL,
  CHECK (source_product_id IS NULL OR target_product_id IS NULL OR source_product_id <> target_product_id)
);
