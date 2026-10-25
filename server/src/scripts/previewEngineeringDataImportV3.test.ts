import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openReferenceDatabase } from "../testSupport/referenceDatabase.js";
import {
  IMPORT_INPUT_SCHEMA_ID_V3,
  PROPOSED_FACT_HEADERS_V2,
  PROPOSED_FACT_HEADERS_V3,
  buildEngineeringDataImportPreview,
  parseEngineeringDataImportCsv,
  readEngineeringDataImportBaselineFromConnection,
} from "./previewEngineeringDataImport.js";


function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function renderV3(rows: readonly Record<string, string>[]): string {
  return [
    PROPOSED_FACT_HEADERS_V3.join(","),
    ...rows.map((row) => PROPOSED_FACT_HEADERS_V3.map((h) => csvCell(row[h] ?? "")).join(",")),
  ].join("\n") + "\n";
}

const COOL = {
  operating_mode: "cooling", water_in_c: "7", water_out_c: "12", indoor_air_dry_bulb_c: "27",
  indoor_air_wet_bulb_c: "19", fan_speed: "HIGH", esp_pa: "0", test_standard: "EN 1397",
  condition_set_suggested: "FC-COOL-HIGH-W7-12-A27-19-ESP0-EN1397",
};
const HEAT = {
  operating_mode: "heating", water_in_c: "70", water_out_c: "60", indoor_air_dry_bulb_c: "20",
  fan_speed: "HIGH", condition_set_suggested: "FC-HEAT-HIGH-W70-60-A20",
};

function factRow(id: number, parameter: string, value: string, unit: string, cond: Record<string, string>) {
  return {
    fact_id: String(id), product_id: "1", sku: "FC-1", equipment_type: "FAN_COIL", parameter_code: parameter,
    value_numeric: value, unit, evidence_class: "DIRECT_MANUFACTURER", action_status: "READY_TO_PREVIEW",
    source_type: "MANUFACTURER_DATASHEET", source_manufacturer: "Vendor", source_document_title: "FC sheet",
    source_document: "https://manufacturer.invalid/fc.pdf", source_page: "p.1", ...cond,
  };
}

function fixture(): Database.Database {
  const live = openReferenceDatabase();
  const db = new Database(":memory:");
  const ddl = live.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name LIKE 'engineering_%' AND sql IS NOT NULL ORDER BY name",
  ).all() as Array<{ sql: string }>;
  db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, is_active INTEGER DEFAULT 1)");
  for (const row of ddl) db.exec(row.sql);
  for (const table of ["engineering_equipment_type", "engineering_condition_key", "engineering_source_type", "engineering_parameter"]) {
    const rows = live.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    }
  }
  live.close();
  db.prepare("INSERT INTO products (id, sku, is_active) VALUES (1, 'FC-1', 1)").run();
  db.prepare(
    "INSERT INTO engineering_product_profile (product_id, equipment_type, identity_status, data_completeness, source_verification) VALUES (1,'FAN_COIL','IDENTIFIED','BLOCKED','UNVERIFIED')",
  ).run();
  return db;
}

function preview(rows: readonly Record<string, string>[]) {
  const facts = parseEngineeringDataImportCsv(renderV3(rows));
  const db = fixture();
  const baseline = readEngineeringDataImportBaselineFromConnection(db, facts);
  db.close();
  return buildEngineeringDataImportPreview({
    facts, auditRows: [], inputSha256: "1".repeat(64), auditSha256: "2".repeat(64), databaseSha256: "3".repeat(64),
    databaseWalSha256: null, databaseShmSha256: null, baseline,
  });
}

test("v3 header is v2 plus seven FAN_COIL condition columns after water_return_c", () => {
  const added = PROPOSED_FACT_HEADERS_V3.filter((h) => !(PROPOSED_FACT_HEADERS_V2 as readonly string[]).includes(h));
  assert.deepEqual(added, [
    "indoor_air_dry_bulb_c", "indoor_air_wet_bulb_c", "water_in_c", "water_out_c", "fan_speed", "esp_pa", "test_standard",
  ]);
  assert.equal(PROPOSED_FACT_HEADERS_V3.indexOf("indoor_air_dry_bulb_c"), PROPOSED_FACT_HEADERS_V3.indexOf("water_return_c") + 1);
  assert.deepEqual(PROPOSED_FACT_HEADERS_V3.filter((h) => !added.includes(h)), [...PROPOSED_FACT_HEADERS_V2]);
});

test("v3 CSV parses and maps FAN_COIL condition fields", () => {
  const [f] = parseEngineeringDataImportCsv(renderV3([factRow(1, "cooling_capacity", "2", "kW", COOL)]));
  assert.equal(f.inputSchemaId, IMPORT_INPUT_SCHEMA_ID_V3);
  assert.equal(f.waterInCRaw, "7");
  assert.equal(f.waterOutCRaw, "12");
  assert.equal(f.indoorAirDryBulbCRaw, "27");
  assert.equal(f.indoorAirWetBulbCRaw, "19");
  assert.equal(f.fanSpeed, "HIGH");
  assert.equal(f.espPaRaw, "0");
  assert.equal(f.testStandard, "EN 1397");
});

test("FAN_COIL cooling and heating airflow are distinct slots and READY with full conditions", () => {
  const p = preview([
    factRow(1, "cooling_capacity", "2", "kW", COOL),
    factRow(2, "airflow", "400", "m³/h", COOL),
    factRow(3, "airflow", "400", "m³/h", HEAT),
    factRow(4, "heating_capacity", "4.91", "kW", HEAT),
  ]);
  assert.deepEqual(p.facts.map((r) => r.classification), ["READY", "READY", "READY", "READY"]);
  assert.equal(p.summary.invalidCount, 0);
  const coolSet = p.insertPlan.conditionSets.find((s) => s.code === "FC-COOL-HIGH-W7-12-A27-19-ESP0-EN1397");
  assert.ok(coolSet, "cooling condition set is planned");
  const keys = coolSet.entries.map((e: { conditionKey: string }) => e.conditionKey);
  assert.deepEqual(keys, [
    "esp_pa", "fan_speed", "indoor_air_dry_bulb_c", "indoor_air_wet_bulb_c", "operating_mode", "test_standard", "water_in_c", "water_out_c",
  ]);
});

test("same factual value without conditions in v3 still collapses (no silent condition loss)", () => {
  const p = preview([
    factRow(1, "airflow", "400", "m³/h", {}),
    factRow(2, "airflow", "400", "m³/h", {}),
  ]);
  assert.equal(p.summary.invalidCount, 2);
});

test("invalid fan_speed and inconsistent shared condition code are rejected", () => {
  const bad = preview([factRow(1, "cooling_capacity", "2", "kW", { ...COOL, fan_speed: "MAX" })]);
  assert.equal(bad.facts[0].classification, "INVALID");
  assert.match(bad.facts[0].reason, /fan_speed must be one of/);
  const incons = preview([
    factRow(1, "cooling_capacity", "2", "kW", COOL),
    factRow(2, "airflow", "400", "m³/h", { ...COOL, water_out_c: "13" }),
  ]);
  assert.ok(incons.facts.every((r) => r.classification === "INVALID"));
});
