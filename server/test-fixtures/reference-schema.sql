-- Schema-only reference DDL (no data) for tests that need the catalog table layout.
-- Generated from the application's SQLite schema; products is created by each test.
CREATE TABLE engineering_condition_entry (
  condition_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_set_id   INTEGER NOT NULL REFERENCES engineering_condition_set(condition_set_id),
  condition_key      TEXT NOT NULL REFERENCES engineering_condition_key(condition_key),
  value_numeric      REAL,
  value_text         TEXT,
  value_boolean      INTEGER CHECK (value_boolean IN (0,1)),
  UNIQUE (condition_set_id, condition_key),
  CHECK ((value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)
);
CREATE TABLE engineering_condition_key (
  condition_key TEXT PRIMARY KEY,
  value_type    TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),
  unit          TEXT,
  description   TEXT
);
CREATE TABLE engineering_condition_set (
  condition_set_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  description      TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE engineering_equipment_type (
  equipment_type TEXT PRIMARY KEY,
  description    TEXT
);
CREATE TABLE engineering_parameter (
  parameter_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type    TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),
  code              TEXT NOT NULL,
  canonical_name    TEXT NOT NULL,
  value_type        TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),
  canonical_unit    TEXT,
  requirement_level TEXT NOT NULL CHECK (requirement_level IN ('REQUIRED_FOR_SELECTION','REQUIRED_FOR_COMPATIBILITY','RECOMMENDED','INFORMATIONAL')),
  description       TEXT,
  UNIQUE (equipment_type, code)
);
CREATE TABLE engineering_product_profile (
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
);
CREATE TABLE engineering_source (
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
);
CREATE TABLE engineering_source_type (
  source_type       TEXT PRIMARY KEY,
  verification_tier TEXT NOT NULL CHECK (verification_tier IN ('AUTHORITATIVE','VERIFIED_SECONDARY','UNVERIFIED')),
  description       TEXT
);
CREATE TABLE engineering_value (
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
);
CREATE TABLE product_relationships (
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
CREATE TABLE relationship_review_queue (
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
CREATE TABLE relationship_rules (
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
CREATE INDEX idx_ep_cond_entry_set    ON engineering_condition_entry(condition_set_id);
CREATE INDEX idx_ep_param_type        ON engineering_parameter(equipment_type);
CREATE INDEX idx_ep_profile_readiness ON engineering_product_profile(identity_status, data_completeness, source_verification);
CREATE INDEX idx_ep_profile_type      ON engineering_product_profile(equipment_type);
CREATE INDEX idx_ep_source_type       ON engineering_source(source_type);
CREATE INDEX idx_ep_value_composite   ON engineering_value(product_id, parameter_id, condition_set_id);
CREATE INDEX idx_ep_value_condition   ON engineering_value(condition_set_id);
CREATE INDEX idx_ep_value_numeric     ON engineering_value(parameter_id, value_numeric);
CREATE INDEX idx_ep_value_parameter   ON engineering_value(parameter_id);
CREATE INDEX idx_ep_value_product     ON engineering_value(product_id);
CREATE INDEX idx_ep_value_source      ON engineering_value(source_id);
CREATE INDEX idx_ep_value_status      ON engineering_value(value_status);
CREATE INDEX idx_product_relationships_pair ON product_relationships(source_product_id, target_product_id);
CREATE INDEX idx_product_relationships_review ON product_relationships(review_status, manual_review_required, confidence, relation_type);
CREATE INDEX idx_product_relationships_source_public ON product_relationships(source_product_id, review_status, relation_type, confidence);
CREATE INDEX idx_product_relationships_target ON product_relationships(target_product_id, review_status, relation_type);
CREATE INDEX idx_relationship_review_queue_pair ON relationship_review_queue(source_product_id, target_product_id, proposed_relation_type);
CREATE INDEX idx_relationship_review_queue_rule ON relationship_review_queue(rule_id, review_status);
CREATE INDEX idx_relationship_review_queue_source ON relationship_review_queue(source_product_id, review_status, priority);
CREATE INDEX idx_relationship_review_queue_worklist ON relationship_review_queue(review_status, priority, confidence, proposed_relation_type);
CREATE INDEX idx_relationship_rules_active_priority ON relationship_rules(is_active, rule_type, priority);
CREATE INDEX idx_relationship_rules_auto_apply ON relationship_rules(is_active, auto_apply_allowed, manual_review_required, default_confidence);
