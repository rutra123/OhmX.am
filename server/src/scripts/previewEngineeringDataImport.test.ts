import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { externalFixture } from "../testSupport/referenceDatabase.js";
import {
  PROPOSED_FACT_HEADERS,
  assertPreviewSqlIsReadOnly,
  buildEngineeringDataImportPreview,
  parseEngineeringDataImportCsv,
  parseEngineeringDataResearchAuditCsv,
  previewEngineeringDataImport,
  readEngineeringDataImportBaseline,
  renderEngineeringDataImportPreviewCsv,
  renderEngineeringDataImportPreviewMarkdown,
} from "./previewEngineeringDataImport.js";

// The research CSV packages and the baseline database snapshot are private project inputs and are not
// part of this repository. Tests that need them run only when these variables point at them:
//   OHMX_ENGINEERING_RESEARCH_DIR  directory holding engineering_data_proposed_import_facts.csv,
//                                  engineering_data_proposed_import_facts_v2.csv and
//                                  engineering_data_research_audit.csv
//   OHMX_ENGINEERING_BASELINE_DB   a SQLite snapshot to use as the read-only baseline (never the live database)
const RESEARCH_DIR = externalFixture("OHMX_ENGINEERING_RESEARCH_DIR");
const PRIMARY_INPUT = join(RESEARCH_DIR ?? "", "engineering_data_proposed_import_facts.csv");
const SUCCESSOR_INPUT = join(RESEARCH_DIR ?? "", "engineering_data_proposed_import_facts_v2.csv");
const RESEARCH_AUDIT = join(RESEARCH_DIR ?? "", "engineering_data_research_audit.csv");
const DATABASE_PATH = externalFixture("OHMX_ENGINEERING_BASELINE_DB") ?? "";
const NEEDS_RESEARCH = RESEARCH_DIR ? false : "requires external research CSVs (set OHMX_ENGINEERING_RESEARCH_DIR)";
const NEEDS_BASELINE = RESEARCH_DIR && DATABASE_PATH ? false : "requires external research CSVs and baseline DB (set OHMX_ENGINEERING_RESEARCH_DIR and OHMX_ENGINEERING_BASELINE_DB)";

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function renderInput(rows: readonly Record<string, string>[]): string {
  return [
    PROPOSED_FACT_HEADERS.join(","),
    ...rows.map((row) => PROPOSED_FACT_HEADERS.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\n") + "\n";
}

function fact(overrides: Partial<Record<(typeof PROPOSED_FACT_HEADERS)[number], string>> = {}): Record<string, string> {
  return {
    fact_id: "1",
    product_id: "1",
    sku: "SKU-1",
    equipment_type: "THERMOSTAT",
    parameter_code: "control_type",
    proposed_parameter_code: "",
    value_numeric: "",
    value_text: "ON/OFF",
    unit: "",
    operating_mode: "",
    outdoor_air_c: "",
    outdoor_air_wet_bulb_c: "",
    water_supply_c: "",
    water_return_c: "",
    condition_set_suggested: "",
    evidence_class: "DIRECT_MANUFACTURER",
    action_status: "READY_TO_PREVIEW",
    source_type: "MANUFACTURER_DATASHEET",
    source_manufacturer: "Vendor",
    source_document_title: "Sheet",
    source_document_version: "1",
    source_document: "https://manufacturer.invalid/datasheet.pdf",
    source_retrieved_at: "",
    identity_source: "",
    source_page: "Technical data",
    note: "",
    ...overrides,
  };
}

function createFixtureDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE engineering_equipment_type (
      equipment_type TEXT PRIMARY KEY,
      description TEXT
    );
    CREATE TABLE engineering_parameter (
      parameter_id INTEGER PRIMARY KEY,
      equipment_type TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),
      code TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),
      canonical_unit TEXT,
      requirement_level TEXT NOT NULL,
      description TEXT,
      UNIQUE (equipment_type, code)
    );
    CREATE TABLE engineering_product_profile (
      product_id INTEGER PRIMARY KEY REFERENCES products(id),
      equipment_type TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),
      series TEXT,
      model TEXT,
      identity_status TEXT NOT NULL,
      data_completeness TEXT NOT NULL,
      source_verification TEXT NOT NULL,
      schema_id TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
    CREATE TABLE engineering_condition_key (
      condition_key TEXT PRIMARY KEY,
      value_type TEXT NOT NULL,
      unit TEXT,
      description TEXT
    );
    CREATE TABLE engineering_source_type (
      source_type TEXT PRIMARY KEY,
      verification_tier TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE engineering_source (
      source_id INTEGER PRIMARY KEY,
      source_type TEXT NOT NULL REFERENCES engineering_source_type(source_type),
      manufacturer TEXT,
      document_title TEXT,
      document_version TEXT,
      url TEXT,
      page TEXT,
      table_name TEXT,
      retrieved_at TEXT,
      audited_at TEXT,
      notes TEXT
    );
    CREATE TABLE engineering_condition_set (
      condition_set_id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      description TEXT
    );
    CREATE TABLE engineering_condition_entry (
      condition_entry_id INTEGER PRIMARY KEY,
      condition_set_id INTEGER NOT NULL REFERENCES engineering_condition_set(condition_set_id),
      condition_key TEXT NOT NULL REFERENCES engineering_condition_key(condition_key),
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER,
      UNIQUE (condition_set_id, condition_key)
    );
    CREATE TABLE engineering_value (
      value_id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      parameter_id INTEGER NOT NULL REFERENCES engineering_parameter(parameter_id),
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER,
      unit TEXT,
      condition_set_id INTEGER REFERENCES engineering_condition_set(condition_set_id),
      source_id INTEGER REFERENCES engineering_source(source_id),
      value_status TEXT NOT NULL,
      confidence REAL
    );

    INSERT INTO engineering_equipment_type (equipment_type) VALUES
      ('THERMOSTAT'), ('ACTUATOR'), ('HEAT_PUMP');
    INSERT INTO products (id, sku, is_active) VALUES
      (1, 'SKU-1', 1),
      (2, '082F1155', 1),
      (3, '20203649', 1);
    INSERT INTO engineering_product_profile
      (product_id, equipment_type, series, model, identity_status, data_completeness, source_verification, schema_id, schema_version)
    VALUES
      (1, 'THERMOSTAT', 'T', 'T1', 'IDENTIFIED', 'BLOCKED', 'UNVERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (2, 'ACTUATOR', 'ABN', 'ABN A5', 'IDENTIFIED', 'PARTIAL', 'UNVERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (3, 'HEAT_PUMP', 'NXHM', 'NXHM 12', 'IDENTIFIED', 'BLOCKED', 'PARTIALLY_VERIFIED', 'ohmx.engineering-product.v1', '1.0.0');
    INSERT INTO engineering_parameter
      (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level)
    VALUES
      (1, 'THERMOSTAT', 'control_type', 'Control type', 'TEXT', NULL, 'REQUIRED_FOR_SELECTION'),
      (2, 'THERMOSTAT', 'max_load', 'Maximum load', 'NUMERIC', 'A', 'REQUIRED_FOR_COMPATIBILITY'),
      (3, 'ACTUATOR', 'torque', 'Torque', 'NUMERIC', 'Nm', 'REQUIRED_FOR_COMPATIBILITY'),
      (4, 'HEAT_PUMP', 'heating_capacity', 'Heating capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'),
      (5, 'HEAT_PUMP', 'operating_outdoor_min', 'Outdoor minimum', 'NUMERIC', '°C', 'REQUIRED_FOR_SELECTION'),
      (6, 'HEAT_PUMP', 'operating_outdoor_max', 'Outdoor maximum', 'NUMERIC', '°C', 'REQUIRED_FOR_SELECTION'),
      (7, 'HEAT_PUMP', 'hydraulic_connection_size', 'Hydraulic connection', 'TEXT', NULL, 'REQUIRED_FOR_COMPATIBILITY'),
      (8, 'HEAT_PUMP', 'dimensions', 'Dimensions', 'TEXT', 'mm', 'INFORMATIONAL'),
      (9, 'HEAT_PUMP', 'weight', 'Weight', 'NUMERIC', 'kg', 'INFORMATIONAL'),
      (10, 'HEAT_PUMP', 'scop', 'SCOP', 'NUMERIC', NULL, 'RECOMMENDED');
    INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES
      ('operating_mode', 'TEXT', NULL),
      ('outdoor_air_c', 'NUMERIC', '°C'),
      ('water_supply_c', 'NUMERIC', '°C'),
      ('water_return_c', 'NUMERIC', '°C'),
      ('test_standard', 'TEXT', NULL);
    INSERT INTO engineering_source_type (source_type, verification_tier) VALUES
      ('MANUFACTURER_DATASHEET', 'AUTHORITATIVE'),
      ('MANUFACTURER_WEBSITE', 'AUTHORITATIVE');
    INSERT INTO engineering_source
      (source_id, source_type, manufacturer, document_title, document_version, url)
    VALUES
      (1, 'MANUFACTURER_DATASHEET', 'Vendor', 'Sheet', '1', 'https://manufacturer.invalid/datasheet.pdf');
  `);
  return db;
}

function withFixture<T>(run: (directory: string, dbPath: string, db: Database.Database) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "ohmx-ed2a-"));
  const dbPath = join(directory, "fixture.db");
  const db = createFixtureDb(dbPath);
  try {
    return run(directory, dbPath, db);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function buildPreview(dbPath: string, rows: readonly Record<string, string>[]) {
  const facts = parseEngineeringDataImportCsv(renderInput(rows));
  const auditRows = parseEngineeringDataResearchAuditCsv(
    "severity,product_id,sku,area,status,finding,recommended_action,source\n",
  );
  const baseline = readEngineeringDataImportBaseline(dbPath, facts);
  return buildEngineeringDataImportPreview({
    facts,
    auditRows,
    inputSha256: "1".repeat(64),
    auditSha256: "2".repeat(64),
    databaseSha256: digest(dbPath),
    databaseWalSha256: null,
    databaseShmSha256: null,
    baseline,
  });
}

test("parses all 37 research facts and preserves safety-critical literals", { skip: NEEDS_RESEARCH }, () => {
  const facts = parseEngineeringDataImportCsv(readFileSync(PRIMARY_INPUT, "utf8"));
  assert.equal(facts.length, 37);
  const maxLoad = facts.find((row) => row.sku === "088U1005" && row.parameterCode === "max_load");
  assert.equal(maxLoad?.valueNumericRaw, "0.05");
  assert.match(maxLoad?.note ?? "", /<50 mA \/ 10 W/);
  const actuator = facts.find((row) => row.sku === "082F1155" && row.parameterCode === "torque");
  assert.equal(actuator?.proposedParameterCode, "actuating_force");
  assert.equal(actuator?.valueNumericRaw, "100");
  assert.equal(actuator?.unit, "N");
  const outdoorModes = new Set(
    facts
      .filter((row) => row.sku === "20203649" && row.parameterCode.startsWith("operating_outdoor_"))
      .map((row) => row.operatingMode),
  );
  assert.deepEqual(outdoorModes, new Set(["heating", "cooling"]));
  assert.equal(facts.filter((row) => row.actionStatus === "CONFLICT_EXISTING_REVIEW").length, 3);
  assert.equal(facts.find((row) => row.parameterCode === "hydraulic_connection_size")?.actionStatus, "REVIEW_REQUIRED");
});

test("parses the ED2A.1 successor package with explicit source identities", { skip: NEEDS_RESEARCH }, () => {
  const facts = parseEngineeringDataImportCsv(readFileSync(SUCCESSOR_INPUT, "utf8"));
  assert.equal(facts.length, 37);
  assert.equal(facts.every((row) => row.sourceType !== ""), true);
  assert.equal(facts.find((row) => row.factIdRaw === "5")?.sourceType, "MANUFACTURER_WEBSITE");
  assert.equal(facts.find((row) => row.factIdRaw === "5")?.sourceRetrievedAt, "2026-09-15T03:55:16Z");
  assert.equal(facts.find((row) => row.factIdRaw === "5")?.sourceDocumentVersion, "");
  assert.equal(facts.find((row) => row.factIdRaw === "4")?.sourceManufacturer, "BPS Tecnologie (Clima)");
  assert.equal(facts.find((row) => row.factIdRaw === "2")?.actionStatus, "BLOCKED_CONTRACT");
  assert.equal(facts.find((row) => row.factIdRaw === "12")?.proposedParameterCode, "actuating_force");
  assert.equal(facts.filter((row) => row.parameterCode.startsWith("operating_outdoor_") && row.actionStatus === "BLOCKED_CONTRACT").length, 4);
  assert.equal(facts.filter((row) => row.actionStatus === "CONFLICT_EXISTING_REVIEW").length, 3);
  assert.equal(facts.find((row) => row.parameterCode === "hydraulic_connection_size")?.actionStatus, "REVIEW_REQUIRED");
});

test("preserves blocked-contract, conflict, and review input decisions without insert actions", () => withFixture((_dir, dbPath) => {
  const rows = [
    fact({ fact_id: "1", product_id: "1", sku: "SKU-1", parameter_code: "max_load", value_numeric: "0.05", value_text: "", unit: "A", note: "Published as <50 mA / 10 W", action_status: "READY_TO_PREVIEW" }),
    fact({ fact_id: "2", product_id: "2", sku: "082F1155", equipment_type: "ACTUATOR", parameter_code: "torque", proposed_parameter_code: "actuating_force", value_numeric: "100", value_text: "", unit: "N", action_status: "BLOCKED_CONTRACT" }),
    fact({ fact_id: "3", product_id: "3", sku: "20203649", equipment_type: "HEAT_PUMP", parameter_code: "operating_outdoor_min", value_numeric: "-25", value_text: "", unit: "°C", operating_mode: "heating", action_status: "BLOCKED_CONTRACT" }),
    fact({ fact_id: "4", product_id: "3", sku: "20203649", equipment_type: "HEAT_PUMP", parameter_code: "dimensions", value_text: "865x1385x523", action_status: "CONFLICT_EXISTING_REVIEW" }),
    fact({ fact_id: "5", product_id: "3", sku: "20203649", equipment_type: "HEAT_PUMP", parameter_code: "hydraulic_connection_size", value_text: "", action_status: "REVIEW_REQUIRED" }),
  ];
  const preview = buildPreview(dbPath, rows);
  assert.deepEqual(preview.facts.map((row) => row.classification), [
    "BLOCKED_CONTRACT",
    "BLOCKED_CONTRACT",
    "BLOCKED_CONTRACT",
    "CONFLICT",
    "REVIEW_REQUIRED",
  ]);
  assert.equal(preview.facts.every((row) => !row.plannedActions.includes("INSERT_VALUE")), true);
  assert.equal(preview.facts[1]?.targetParameterCode, "actuating_force");
  assert.equal(preview.facts[1]?.parameterId, null);
  assert.match(preview.facts[0]?.reason ?? "", /comparator/i);
}));

test("accepts a complete authoritative datasheet identity and plans one new source", () => withFixture((_dir, dbPath) => {
  const preview = buildPreview(dbPath, [fact({
    source_document: "https://manufacturer.invalid/icon.pdf",
    source_type: "MANUFACTURER_DATASHEET",
    source_manufacturer: "Danfoss",
    source_document_title: "Danfoss Icon thermostat datasheet",
    source_document_version: "",
  })]);
  assert.equal(preview.facts[0]?.classification, "READY");
  assert.equal(preview.facts[0]?.plannedActions.includes("INSERT_SOURCE"), true);
  assert.equal(preview.insertPlan.sources.length, 1);
  assert.equal(preview.insertPlan.sources[0]?.documentVersion, null);
}));

test("accepts an authoritative manufacturer website without a fabricated document version", () => withFixture((_dir, dbPath) => {
  const preview = buildPreview(dbPath, [fact({
    source_document: "https://manufacturer.invalid/design-center/product",
    source_type: "MANUFACTURER_WEBSITE",
    source_manufacturer: "Danfoss",
    source_document_title: "Danfoss LENO MSV-BD Design Center page",
    source_document_version: "",
    source_retrieved_at: "2026-09-15T03:55:16Z",
  })]);
  assert.equal(preview.facts[0]?.classification, "READY");
  assert.equal(preview.insertPlan.sources[0]?.sourceType, "MANUFACTURER_WEBSITE");
  assert.equal(preview.insertPlan.sources[0]?.documentVersion, null);
  assert.equal(preview.insertPlan.sources[0]?.retrievedAt, "2026-09-15T03:55:16Z");
}));

test("rejects missing manufacturer, missing document title, and URL-only new sources", () => withFixture((_dir, dbPath) => {
  const base = {
    source_document: "https://manufacturer.invalid/unregistered-sheet.pdf",
    source_type: "MANUFACTURER_DATASHEET",
    source_manufacturer: "Danfoss",
    source_document_title: "Danfoss Icon thermostat datasheet",
  };
  const missingManufacturer = buildPreview(dbPath, [
    fact({ ...base, fact_id: "1", source_manufacturer: "" }),
  ]);
  const missingTitle = buildPreview(dbPath, [
    fact({ ...base, fact_id: "2", source_document_title: "" }),
  ]);
  const urlOnly = buildPreview(dbPath, [
    fact({
      ...base,
      fact_id: "3",
      source_type: "",
      source_manufacturer: "",
      source_document_title: "",
      source_document_version: "",
      source_retrieved_at: "",
    }),
  ]);
  const previews = [missingManufacturer, missingTitle, urlOnly];
  assert.equal(previews.every((preview) => preview.facts[0]?.classification === "BLOCKED_CONTRACT"), true);
  assert.equal(previews.every((preview) => !preview.facts[0]?.plannedActions.includes("INSERT_SOURCE")), true);
  assert.match(missingManufacturer.facts[0]?.reason ?? "", /manufacturer/i);
  assert.match(missingTitle.facts[0]?.reason ?? "", /document_title/i);
  assert.match(urlOnly.facts[0]?.reason ?? "", /URL alone is insufficient/i);
}));

test("deduplicates new sources by canonical source identity, not page", () => withFixture((_dir, dbPath, db) => {
  db.exec(`
    INSERT INTO engineering_parameter
      (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level)
    VALUES (11, 'THERMOSTAT', 'supply_voltage', 'Supply voltage', 'TEXT', NULL, 'REQUIRED_FOR_COMPATIBILITY');
  `);
  const source = {
    source_document: "https://manufacturer.invalid/icon.pdf",
    source_type: "MANUFACTURER_DATASHEET",
    source_manufacturer: "Danfoss",
    source_document_title: "Danfoss Icon thermostat datasheet",
    source_document_version: "",
  };
  const preview = buildPreview(dbPath, [
    fact({ ...source, fact_id: "1", source_page: "p.2" }),
    fact({ ...source, fact_id: "2", parameter_code: "supply_voltage", value_text: "230 V", source_page: "Electrical data" }),
  ]);
  assert.equal(preview.facts.every((row) => row.classification === "READY"), true);
  assert.equal(preview.insertPlan.sources.length, 1);
  assert.equal(preview.insertPlan.sources[0]?.page, "Electrical data");
}));

test("blocks a nominally ready fact when a supplied condition key is absent from the current registry", () => withFixture((_dir, dbPath) => {
  const preview = buildPreview(dbPath, [fact({
    product_id: "3",
    sku: "20203649",
    equipment_type: "HEAT_PUMP",
    parameter_code: "heating_capacity",
    value_numeric: "12.1",
    value_text: "",
    unit: "kW",
    operating_mode: "heating",
    outdoor_air_c: "7",
    outdoor_air_wet_bulb_c: "6",
    water_supply_c: "35",
    water_return_c: "30",
    condition_set_suggested: "NXHM012-A7-W35-EN14511",
  })]);
  assert.equal(preview.facts[0]?.classification, "BLOCKED_CONTRACT");
  assert.match(preview.facts[0]?.reason ?? "", /outdoor_air_wet_bulb_c/);
  assert.equal(preview.summary.blockedContractCount, 1);
}));

test("accepts outdoor_air_wet_bulb_c as a NUMERIC °C source-stated condition when registry and matcher support it", () => withFixture((_dir, dbPath, db) => {
  db.exec("INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES ('outdoor_air_wet_bulb_c', 'NUMERIC', '°C')");
  const preview = buildPreview(dbPath, [fact({
    product_id: "3",
    sku: "20203649",
    equipment_type: "HEAT_PUMP",
    parameter_code: "heating_capacity",
    value_numeric: "12.1",
    value_text: "",
    unit: "kW",
    operating_mode: "heating",
    outdoor_air_c: "7",
    outdoor_air_wet_bulb_c: "6",
    water_supply_c: "35",
    water_return_c: "30",
    condition_set_suggested: "NXHM012-A7-W35-EN14511",
  })]);
  assert.equal(preview.facts[0]?.classification, "READY");
  assert.equal(preview.facts[0]?.conditionEntries.some((entry) => entry.conditionKey === "outdoor_air_wet_bulb_c" && entry.numeric === 6 && entry.canonicalUnit === "°C"), true);
}));

test("classifies an exact existing slot as NO_CHANGE", () => withFixture((_dir, dbPath, db) => {
  db.exec(`
    INSERT INTO engineering_value
      (value_id, product_id, parameter_id, value_text, source_id, value_status, confidence)
    VALUES (1, 1, 1, 'ON/OFF', 1, 'KNOWN', 1.0);
  `);
  const preview = buildPreview(dbPath, [fact()]);
  assert.equal(preview.facts[0]?.classification, "NO_CHANGE");
  assert.equal(preview.facts[0]?.plannedAction, "NO_CHANGE");
  assert.deepEqual(preview.facts[0]?.existingValueIds, [1]);
}));

test("classifies a different value in the same current slot as CONFLICT", () => withFixture((_dir, dbPath, db) => {
  db.exec(`
    INSERT INTO engineering_value
      (value_id, product_id, parameter_id, value_text, value_status)
    VALUES (1, 1, 1, 'PI', 'KNOWN');
  `);
  const preview = buildPreview(dbPath, [fact()]);
  assert.equal(preview.facts[0]?.classification, "CONFLICT");
  assert.equal(preview.facts[0]?.plannedActions.includes("INSERT_VALUE"), false);
}));

test("invalidates identity mismatch, unit mismatch, duplicate ids, and duplicate semantic slots", () => withFixture((_dir, dbPath) => {
  const rows = [
    fact({ fact_id: "1", sku: "WRONG" }),
    fact({ fact_id: "2", product_id: "3", sku: "20203649", equipment_type: "HEAT_PUMP", parameter_code: "heating_capacity", value_numeric: "12", value_text: "", unit: "W" }),
    fact({ fact_id: "3" }),
    fact({ fact_id: "3", value_text: "PI" }),
    fact({ fact_id: "4" }),
    fact({ fact_id: "5" }),
  ];
  const preview = buildPreview(dbPath, rows);
  assert.equal(preview.summary.invalidCount, 6);
  assert.equal(preview.facts.every((row) => row.classification === "INVALID"), true);
}));

test("blocks a condition-set code collision with different current entries", () => withFixture((_dir, dbPath, db) => {
  db.exec(`
    INSERT INTO engineering_condition_set (condition_set_id, code, description)
    VALUES (1, 'NXHM012-A7-W35-EN14511', 'existing');
    INSERT INTO engineering_condition_entry
      (condition_entry_id, condition_set_id, condition_key, value_numeric)
    VALUES (1, 1, 'outdoor_air_c', 2);
  `);
  const preview = buildPreview(dbPath, [fact({
    product_id: "3",
    sku: "20203649",
    equipment_type: "HEAT_PUMP",
    parameter_code: "heating_capacity",
    value_numeric: "12.1",
    value_text: "",
    unit: "kW",
    operating_mode: "heating",
    outdoor_air_c: "7",
    water_supply_c: "35",
    water_return_c: "30",
    condition_set_suggested: "NXHM012-A7-W35-EN14511",
  })]);
  assert.equal(preview.facts[0]?.classification, "CONFLICT");
  assert.match(preview.facts[0]?.reason ?? "", /condition-set code/i);
}));

test("produces sorted deterministic facts, insert dependencies, counts, and fingerprint", () => withFixture((_dir, dbPath) => {
  const previewA = buildPreview(dbPath, [
    fact({ fact_id: "2", parameter_code: "max_load", value_numeric: "1", value_text: "", unit: "A" }),
    fact({ fact_id: "1" }),
  ]);
  const previewB = buildPreview(dbPath, [
    fact({ fact_id: "2", parameter_code: "max_load", value_numeric: "1", value_text: "", unit: "A" }),
    fact({ fact_id: "1" }),
  ]);
  assert.deepEqual(previewA.facts.map((row) => row.factId), [1, 2]);
  assert.equal(previewA.previewFingerprint, previewB.previewFingerprint);
  assert.equal(renderEngineeringDataImportPreviewCsv(previewA), renderEngineeringDataImportPreviewCsv(previewB));
  assert.equal(previewA.summary.readyCount, 2);
  assert.equal(previewA.insertPlan.values.length, 2);
  assert.equal(previewA.insertPlan.sources.length, 0);
  assert.equal(previewA.facts.every((row) => row.plannedActions.includes("INSERT_VALUE")), true);
}));

test("classifies the current 37-fact research package fail-closed against the current repository baseline", { skip: NEEDS_BASELINE }, () => {
  const facts = parseEngineeringDataImportCsv(readFileSync(PRIMARY_INPUT, "utf8"));
  const auditRows = parseEngineeringDataResearchAuditCsv(readFileSync(RESEARCH_AUDIT, "utf8"));
  const baseline = readEngineeringDataImportBaseline(DATABASE_PATH, facts);
  const preview = buildEngineeringDataImportPreview({
    facts,
    auditRows,
    inputSha256: digest(PRIMARY_INPUT),
    auditSha256: digest(RESEARCH_AUDIT),
    databaseSha256: digest(DATABASE_PATH),
    databaseWalSha256: null,
    databaseShmSha256: null,
    baseline,
  });
  assert.equal(preview.summary.factsDiscovered, 37);
  assert.equal(preview.summary.readyCount, 1);
  assert.equal(preview.summary.noChangeCount, 0);
  assert.equal(preview.summary.conflictCount, 3);
  assert.equal(preview.summary.blockedContractCount, 32);
  assert.equal(preview.summary.reviewRequiredCount, 1);
  assert.equal(preview.summary.invalidCount, 0);
  assert.equal(preview.insertPlan.values.length, 1);
});

test("renders all required hashes, counts, fingerprint, and safety boundaries", () => withFixture((_dir, dbPath) => {
  const preview = buildPreview(dbPath, [fact()]);
  const csv = renderEngineeringDataImportPreviewCsv(preview);
  const markdown = renderEngineeringDataImportPreviewMarkdown(preview);
  assert.match(csv, /db_baseline_sha256,input_sha256,preview_fingerprint/);
  assert.match(markdown, /DB writes: 0/);
  assert.match(markdown, /Matcher changed: NO/);
  assert.match(markdown, /CM18 started: NO/);
  assert.match(markdown, new RegExp(preview.baseline.databaseSha256));
  assert.match(markdown, new RegExp(preview.baseline.inputSha256));
  assert.match(markdown, new RegExp(preview.previewFingerprint));
}));

test("end-to-end preview writes only deterministic report artifacts and leaves DB bytes unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ohmx-ed2a-e2e-"));
  const dbPath = join(directory, "fixture.db");
  const db = createFixtureDb(dbPath);
  db.close();
  const inputPath = join(directory, "facts.csv");
  const auditPath = join(directory, "audit.csv");
  const outputA = join(directory, "preview-a");
  const outputB = join(directory, "preview-b");
  writeFileSync(inputPath, renderInput([fact()]), "utf8");
  writeFileSync(auditPath, "severity,product_id,sku,area,status,finding,recommended_action,source\n", "utf8");
  try {
    const before = digest(dbPath);
    const first = await previewEngineeringDataImport({ databasePath: dbPath, inputPath, auditPath, outputDirectory: outputA });
    const second = await previewEngineeringDataImport({ databasePath: dbPath, inputPath, auditPath, outputDirectory: outputB });
    assert.equal(digest(dbPath), before);
    assert.equal(first.previewFingerprint, second.previewFingerprint);
    for (const name of [
      "engineering-data-import-preview.csv",
      "engineering-data-import-preview.json",
      "ENGINEERING-DATA-IMPORT-PREVIEW.md",
    ]) {
      assert.deepEqual(readFileSync(join(outputA, name)), readFileSync(join(outputB, name)));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read-only SQL guard rejects write, DDL, PRAGMA, and multi-statement input", () => {
  assert.doesNotThrow(() => assertPreviewSqlIsReadOnly("SELECT * FROM engineering_value"));
  for (const sql of [
    "INSERT INTO engineering_value DEFAULT VALUES",
    "UPDATE engineering_value SET value_status='KNOWN'",
    "DELETE FROM engineering_value",
    "CREATE TABLE forbidden (id INTEGER)",
    "PRAGMA wal_checkpoint",
    "SELECT 1; DELETE FROM engineering_value",
  ]) {
    assert.throws(() => assertPreviewSqlIsReadOnly(sql));
  }
});
