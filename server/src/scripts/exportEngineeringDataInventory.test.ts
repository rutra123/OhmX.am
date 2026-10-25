import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import {
  REQUIRED_SHEET_NAMES,
  buildCsvExports,
  buildEngineeringDataInventory,
  readInventorySourceData,
  writeEngineeringWorkbook,
  type InventorySourceData,
} from "./exportEngineeringDataInventory.js";

function fixture(): InventorySourceData {
  return {
    products: [
      {
        product_id: 3,
        sku: "ACT-3",
        name_ru: "Actuator",
        name_hy: null,
        name_en: null,
        brand_id: 20,
        brand: "Brand B",
        category_id: 200,
        category: "Controls",
        is_active: 1,
      },
      {
        product_id: 2,
        sku: "ORD-2",
        name_ru: "Ordinary product",
        name_hy: null,
        name_en: null,
        brand_id: null,
        brand: null,
        category_id: 100,
        category: "Other",
        is_active: 1,
      },
      {
        product_id: 1,
        sku: "FC-1",
        name_ru: "Fan coil 12 kW title must not be parsed",
        name_hy: null,
        name_en: null,
        brand_id: 10,
        brand: "Brand A",
        category_id: 101,
        category: "Fan coils",
        is_active: 1,
      },
    ],
    equipmentTypes: [
      { equipment_type: "ACTUATOR", description: "Actuator" },
      { equipment_type: "FAN_COIL", description: "Fan coil" },
    ],
    parameters: [
      {
        parameter_id: 1,
        equipment_type: "FAN_COIL",
        code: "airflow",
        canonical_name: "Airflow",
        value_type: "NUMERIC",
        canonical_unit: "m³/h",
        requirement_level: "REQUIRED_FOR_SELECTION",
        description: null,
      },
      {
        parameter_id: 2,
        equipment_type: "FAN_COIL",
        code: "power_supply",
        canonical_name: "Power supply",
        value_type: "TEXT",
        canonical_unit: null,
        requirement_level: "REQUIRED_FOR_COMPATIBILITY",
        description: null,
      },
      {
        parameter_id: 3,
        equipment_type: "ACTUATOR",
        code: "control_signal",
        canonical_name: "Control signal",
        value_type: "TEXT",
        canonical_unit: null,
        requirement_level: "REQUIRED_FOR_COMPATIBILITY",
        description: null,
      },
    ],
    profiles: [
      {
        product_id: 3,
        equipment_type: "ACTUATOR",
        series: null,
        model: "A3",
        identity_status: "IDENTIFIED",
        data_completeness: "COMPLETE",
        source_verification: "VERIFIED",
        schema_id: "ohmx.engineering-product.v1",
        schema_version: "1.0.0",
      },
      {
        product_id: 1,
        equipment_type: "FAN_COIL",
        series: "FC",
        model: "1",
        identity_status: "IDENTIFIED",
        data_completeness: "COMPLETE",
        source_verification: "VERIFIED",
        schema_id: "ohmx.engineering-product.v1",
        schema_version: "1.0.0",
      },
    ],
    values: [
      {
        value_id: 10,
        product_id: 1,
        parameter_id: 1,
        value_numeric: 1200,
        value_text: null,
        value_boolean: null,
        unit: "m³/h",
        condition_set_id: 50,
        source_id: 70,
        value_status: "KNOWN",
        confidence: 1,
      },
      {
        value_id: 11,
        product_id: 1,
        parameter_id: 2,
        value_numeric: null,
        value_text: "230 V",
        value_boolean: null,
        unit: null,
        condition_set_id: null,
        source_id: 70,
        value_status: "KNOWN",
        confidence: 1,
      },
    ],
    conditionSets: [
      { condition_set_id: 50, code: "FC_HIGH", description: "High fan speed" },
    ],
    conditionKeys: [
      { condition_key: "fan_speed", value_type: "TEXT", unit: null, description: "Fan speed" },
    ],
    conditionEntries: [
      {
        condition_entry_id: 500,
        condition_set_id: 50,
        condition_key: "fan_speed",
        value_numeric: null,
        value_text: "HIGH",
        value_boolean: null,
      },
    ],
    sourceTypes: [
      {
        source_type: "MANUFACTURER_DATASHEET",
        verification_tier: "AUTHORITATIVE",
        description: "Manufacturer datasheet",
      },
    ],
    sources: [
      {
        source_id: 70,
        source_type: "MANUFACTURER_DATASHEET",
        manufacturer: "Brand A",
        document_title: "FC catalogue",
        document_version: "2026",
        url: "https://example.invalid/fc.pdf",
        page: "12",
        table_name: "Performance",
        retrieved_at: "2026-01-01",
        audited_at: "2026-01-02",
        notes: null,
      },
    ],
  };
}

function copyFixture(): InventorySourceData {
  return structuredClone(fixture());
}

test("retains every catalog product, including products without profiles", () => {
  const inventory = buildEngineeringDataInventory(fixture());
  assert.deepEqual(inventory.products.map((row) => row.product_id), [1, 2, 3]);
  assert.equal(inventory.summary.total_products, 3);
});

test("retains and classifies no-profile products", () => {
  const row = buildEngineeringDataInventory(fixture()).products.find((item) => item.product_id === 2);
  assert.equal(row?.engineering_profile_present, false);
  assert.equal(row?.engineering_status, "NO_ENGINEERING_PROFILE");
  assert.equal(row?.selection_ready, false);
});

test("classifies supported and not-yet-supported engineering profiles", () => {
  const rows = buildEngineeringDataInventory(fixture()).products;
  const fanCoil = rows.find((row) => row.product_id === 1);
  const actuator = rows.find((row) => row.product_id === 3);
  assert.equal(fanCoil?.matcher_selection_contract, "CURRENT_MATCHER_SUPPORTED");
  assert.equal(fanCoil?.engineering_status, "ENGINEERING_READY");
  assert.equal(actuator?.matcher_selection_contract, "SELECTION_CONTRACT_NOT_IMPLEMENTED");
  assert.equal(actuator?.engineering_status, "ENGINEERING_INCOMPLETE");
});

test("includes current Matcher-required product-level values even when the DB definition is less strict", () => {
  const data = copyFixture();
  data.products.push({
    product_id: 4,
    sku: "HP-4",
    name_ru: "Heat pump",
    name_hy: null,
    name_en: null,
    brand_id: 10,
    brand: "Brand A",
    category_id: 102,
    category: "Heat pumps",
    is_active: 1,
  });
  data.equipmentTypes.push({ equipment_type: "HEAT_PUMP", description: "Heat pump" });
  data.profiles.push({
    product_id: 4,
    equipment_type: "HEAT_PUMP",
    series: null,
    model: "HP-4",
    identity_status: "IDENTIFIED",
    data_completeness: "COMPLETE",
    source_verification: "VERIFIED",
    schema_id: "ohmx.engineering-product.v1",
    schema_version: "1.0.0",
  });
  data.parameters.push({
    parameter_id: 4,
    equipment_type: "HEAT_PUMP",
    code: "min_water_temperature_cooling",
    canonical_name: "Minimum cooling water temperature",
    value_type: "NUMERIC",
    canonical_unit: "°C",
    requirement_level: "RECOMMENDED",
    description: null,
  });
  const missing = buildEngineeringDataInventory(data).missingRequired.find(
    (row) => row.product_id === 4 && row.parameter_code === "min_water_temperature_cooling",
  );
  assert.equal(missing?.requirement_level, "REQUIRED_FOR_SELECTION");
  assert.equal(missing?.condition_scope, "PRODUCT_ANY");
  assert.equal(missing?.requirement_source, "MATCHER_SERVICE_APPLICABILITY");
});

test("emits a missing REQUIRED_FOR_SELECTION fact", () => {
  const data = copyFixture();
  data.values = data.values.filter((row) => row.parameter_id !== 1);
  const missing = buildEngineeringDataInventory(data).missingRequired;
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.parameter_code, "airflow");
  assert.equal(missing[0]?.requirement_level, "REQUIRED_FOR_SELECTION");
  assert.equal(missing[0]?.missing_status, "MISSING");
});

test("does not emit a present required selection value as missing", () => {
  const missing = buildEngineeringDataInventory(fixture()).missingRequired;
  assert.equal(missing.some((row) => row.product_id === 1 && row.parameter_code === "airflow"), false);
});

test("classifies missing compatibility values separately", () => {
  const data = copyFixture();
  data.values = data.values.filter((row) => row.parameter_id !== 2);
  const inventory = buildEngineeringDataInventory(data);
  assert.equal(inventory.missingCompatibility.some((row) => row.parameter_code === "power_supply"), true);
  assert.equal(inventory.missingRequired.some((row) => row.parameter_code === "power_supply"), false);
  assert.equal(inventory.products.find((row) => row.product_id === 1)?.compatibility_ready, false);
});

test("generic values do not satisfy operating-point selection requirements", () => {
  const data = copyFixture();
  const airflow = data.values.find((row) => row.parameter_id === 1);
  assert.ok(airflow);
  airflow.condition_set_id = null;
  const missing = buildEngineeringDataInventory(data).missingRequired;
  assert.equal(missing[0]?.condition_scope, "VALUE_OPERATING_POINT");
  assert.equal(missing[0]?.reason, "CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT");
});

test("condition-bound known values satisfy operating-point inventory completeness", () => {
  const inventory = buildEngineeringDataInventory(fixture());
  assert.equal(inventory.missingRequired.length, 0);
  assert.equal(inventory.operatingPoints.length, 1);
  assert.equal(inventory.operatingPoints[0]?.condition_set_code, "FC_HIGH");
  assert.equal(inventory.operatingPoints[0]?.fan_speed, "HIGH");
});

test("UNKNOWN remains missing and is never converted to zero", () => {
  const data = copyFixture();
  const airflow = data.values.find((row) => row.parameter_id === 1);
  assert.ok(airflow);
  airflow.value_status = "UNKNOWN";
  airflow.value_numeric = null;
  const missing = buildEngineeringDataInventory(data).missingRequired;
  assert.equal(missing[0]?.missing_status, "UNKNOWN");
  assert.equal(missing[0]?.VALUE_TO_FILL, "");
});

test("retains source provenance on engineering values and source usage", () => {
  const inventory = buildEngineeringDataInventory(fixture());
  const value = inventory.engineeringValues.find((row) => row.value_id === 10);
  assert.equal(value?.source_id, 70);
  assert.equal(value?.source_type, "MANUFACTURER_DATASHEET");
  assert.equal(value?.verification_tier, "AUTHORITATIVE");
  assert.match(String(value?.source_reference), /FC catalogue/);
  assert.equal(inventory.sources[0]?.values_using_source, 2);
  assert.equal(inventory.sources[0]?.products_using_source, 1);
});

test("does not derive engineering values from title or description text", () => {
  const data = copyFixture();
  data.values = data.values.filter((row) => row.parameter_id !== 1);
  const inventory = buildEngineeringDataInventory(data);
  assert.equal(inventory.missingRequired.some((row) => row.parameter_code === "airflow"), true);
  assert.equal(inventory.engineeringValues.some((row) => row.parameter_code === "airflow"), false);
});

test("ordering is deterministic across reversed source query order", () => {
  const forward = fixture();
  const reverse = copyFixture();
  reverse.products.reverse();
  reverse.parameters.reverse();
  reverse.profiles.reverse();
  reverse.values.reverse();
  reverse.conditionSets.reverse();
  reverse.conditionKeys.reverse();
  reverse.conditionEntries.reverse();
  reverse.sources.reverse();
  reverse.sourceTypes.reverse();
  assert.deepEqual(buildEngineeringDataInventory(reverse), buildEngineeringDataInventory(forward));
});

test("CSV row counts are coherent with inventory arrays", () => {
  const inventory = buildEngineeringDataInventory(fixture());
  const csv = buildCsvExports(inventory);
  const dataRows = (text: string) => text.trimEnd().split("\n").length - 1;
  assert.equal(dataRows(csv["products.csv"]), inventory.products.length);
  assert.equal(dataRows(csv["missing_required.csv"]), inventory.missingRequired.length);
  assert.equal(dataRows(csv["missing_compatibility.csv"]), inventory.missingCompatibility.length);
  assert.equal(dataRows(csv["engineering_values.csv"]), inventory.engineeringValues.length);
  assert.equal(dataRows(csv["operating_points.csv"]), inventory.operatingPoints.length);
  assert.equal(dataRows(csv["sources.csv"]), inventory.sources.length);
});

test("XLSX contains the seven required sheets and blank unlocked manual columns", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ohmx-ed1-xlsx-"));
  const path = join(directory, "inventory.xlsx");
  try {
    const data = copyFixture();
    data.values = data.values.filter((row) => row.parameter_id !== 1);
    const inventory = buildEngineeringDataInventory(data);
    await writeEngineeringWorkbook(inventory, path);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), REQUIRED_SHEET_NAMES);
    const sheet = workbook.getWorksheet("Missing Required");
    assert.ok(sheet);
    const headers = sheet.getRow(1).values as unknown[];
    for (const name of ["VALUE_TO_FILL", "SOURCE_DOCUMENT", "SOURCE_PAGE", "NOTE"]) {
      const column = headers.findIndex((value) => value === name);
      assert.ok(column > 0, `${name} column exists`);
      assert.ok(sheet.getCell(2, column).value == null || sheet.getCell(2, column).value === "");
      assert.equal(sheet.getCell(2, column).protection.locked, false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read-only DB inventory leaves the database byte-for-byte unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "ohmx-ed1-db-"));
  const path = join(directory, "fixture.db");
  try {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE brands (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE categories (id INTEGER PRIMARY KEY, name_ru TEXT NOT NULL);
      CREATE TABLE product_categories (product_id INTEGER NOT NULL, category_id INTEGER NOT NULL, is_primary INTEGER DEFAULT 0);
      CREATE TABLE products (
        id INTEGER PRIMARY KEY, sku TEXT NOT NULL, name_ru TEXT NOT NULL, name_hy TEXT, name_en TEXT,
        brand_id INTEGER, category_id INTEGER, primary_category_id INTEGER, is_active INTEGER DEFAULT 1
      );
      CREATE TABLE engineering_equipment_type (equipment_type TEXT PRIMARY KEY, description TEXT);
      CREATE TABLE engineering_parameter (
        parameter_id INTEGER PRIMARY KEY, equipment_type TEXT NOT NULL, code TEXT NOT NULL,
        canonical_name TEXT NOT NULL, value_type TEXT NOT NULL, canonical_unit TEXT,
        requirement_level TEXT NOT NULL, description TEXT
      );
      CREATE TABLE engineering_product_profile (
        product_id INTEGER PRIMARY KEY, equipment_type TEXT NOT NULL, series TEXT, model TEXT,
        identity_status TEXT NOT NULL, data_completeness TEXT NOT NULL, source_verification TEXT NOT NULL,
        schema_id TEXT NOT NULL, schema_version TEXT NOT NULL
      );
      CREATE TABLE engineering_condition_set (condition_set_id INTEGER PRIMARY KEY, code TEXT NOT NULL, description TEXT);
      CREATE TABLE engineering_condition_key (condition_key TEXT PRIMARY KEY, value_type TEXT NOT NULL, unit TEXT, description TEXT);
      CREATE TABLE engineering_condition_entry (
        condition_entry_id INTEGER PRIMARY KEY, condition_set_id INTEGER NOT NULL, condition_key TEXT NOT NULL,
        value_numeric REAL, value_text TEXT, value_boolean INTEGER
      );
      CREATE TABLE engineering_source_type (source_type TEXT PRIMARY KEY, verification_tier TEXT NOT NULL, description TEXT);
      CREATE TABLE engineering_source (
        source_id INTEGER PRIMARY KEY, source_type TEXT NOT NULL, manufacturer TEXT, document_title TEXT,
        document_version TEXT, url TEXT, page TEXT, table_name TEXT, retrieved_at TEXT, audited_at TEXT, notes TEXT
      );
      CREATE TABLE engineering_value (
        value_id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, parameter_id INTEGER NOT NULL,
        value_numeric REAL, value_text TEXT, value_boolean INTEGER, unit TEXT, condition_set_id INTEGER,
        source_id INTEGER, value_status TEXT NOT NULL, confidence REAL
      );
      INSERT INTO products (id, sku, name_ru) VALUES (1, 'P-1', 'Product');
    `);
    db.close();
    const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = digest();
    const source = readInventorySourceData(path);
    const after = digest();
    assert.equal(source.products.length, 1);
    assert.equal(after, before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
