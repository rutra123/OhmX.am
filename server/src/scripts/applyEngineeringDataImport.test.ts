import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ED2B_APPROVED_BLOCKED_CONTRACT_FACT_IDS,
  ED2B_APPROVED_CONFLICT_FACT_IDS,
  ED2B_APPROVED_DATABASE_SHA256,
  ED2B_APPROVED_INPUT_SHA256,
  ED2B_APPROVED_PREVIEW_FINGERPRINT,
  ED2B_APPROVED_READY_FACT_IDS,
  ED2B_APPROVED_REVIEW_REQUIRED_FACT_IDS,
  ED2B_APPROVED_SUMMARY,
  applyEngineeringDataImport,
  type EngineeringDataImportApproval,
} from "./applyEngineeringDataImport.js";
import {
  PROPOSED_FACT_HEADERS,
  inspectEngineeringDataImport,
  type EngineeringDataImportPreview,
} from "./previewEngineeringDataImport.js";

function sha256File(path: string): string {
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
    source_document_title: "Fixture datasheet",
    source_document_version: "1",
    source_document: "https://manufacturer.invalid/fixture.pdf",
    source_retrieved_at: "",
    identity_source: "",
    source_page: "Technical data",
    note: "",
    ...overrides,
  };
}

function fixtureRows(): Record<string, string>[] {
  return [
    fact(),
    fact({
      fact_id: "2",
      product_id: "2",
      sku: "HP-2",
      equipment_type: "HEAT_PUMP",
      parameter_code: "heating_capacity",
      value_numeric: "12.1",
      value_text: "",
      unit: "kW",
      operating_mode: "heating",
      outdoor_air_c: "7",
      water_supply_c: "35",
      water_return_c: "30",
      condition_set_suggested: "HP2-A7-W35-EN14511",
      source_document_title: "Heat pump datasheet",
      source_document: "https://manufacturer.invalid/heat-pump.pdf",
    }),
    fact({
      fact_id: "3",
      parameter_code: "max_load",
      value_numeric: "0.05",
      value_text: "",
      unit: "A",
      action_status: "BLOCKED_CONTRACT",
      note: "Published as <0.05 A",
    }),
    fact({
      fact_id: "4",
      product_id: "2",
      sku: "HP-2",
      equipment_type: "HEAT_PUMP",
      parameter_code: "hydraulic_connection_size",
      value_text: "",
      action_status: "REVIEW_REQUIRED",
    }),
    fact({
      fact_id: "5",
      product_id: "2",
      sku: "HP-2",
      equipment_type: "HEAT_PUMP",
      parameter_code: "dimensions",
      value_text: "new dimensions",
      action_status: "CONFLICT_EXISTING_REVIEW",
    }),
  ];
}

function createFixtureDb(path: string, rejectProductTwoInserts = false): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
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
      source_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      condition_set_id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT
    );
    CREATE TABLE engineering_condition_entry (
      condition_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      condition_set_id INTEGER NOT NULL REFERENCES engineering_condition_set(condition_set_id),
      condition_key TEXT NOT NULL REFERENCES engineering_condition_key(condition_key),
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0,1)),
      UNIQUE (condition_set_id, condition_key),
      CHECK ((value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)
    );
    CREATE TABLE engineering_value (
      value_id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      parameter_id INTEGER NOT NULL REFERENCES engineering_parameter(parameter_id),
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0,1)),
      unit TEXT,
      condition_set_id INTEGER REFERENCES engineering_condition_set(condition_set_id),
      source_id INTEGER REFERENCES engineering_source(source_id),
      value_status TEXT NOT NULL,
      confidence REAL,
      CHECK (${rejectProductTwoInserts ? "product_id <> 2 OR parameter_id <> 3" : "1 = 1"}),
      CHECK (
        (value_status = 'UNKNOWN' AND value_numeric IS NULL AND value_text IS NULL AND value_boolean IS NULL)
        OR
        (value_status <> 'UNKNOWN' AND (value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)
      )
    );

    INSERT INTO engineering_equipment_type (equipment_type) VALUES ('THERMOSTAT'), ('HEAT_PUMP');
    INSERT INTO products (id, sku, is_active) VALUES (1, 'SKU-1', 1), (2, 'HP-2', 1);
    INSERT INTO engineering_product_profile
      (product_id, equipment_type, series, model, identity_status, data_completeness, source_verification, schema_id, schema_version)
    VALUES
      (1, 'THERMOSTAT', 'T', 'T1', 'IDENTIFIED', 'PARTIAL', 'PARTIALLY_VERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (2, 'HEAT_PUMP', 'HP', 'HP2', 'IDENTIFIED', 'PARTIAL', 'PARTIALLY_VERIFIED', 'ohmx.engineering-product.v1', '1.0.0');
    INSERT INTO engineering_parameter
      (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level)
    VALUES
      (1, 'THERMOSTAT', 'control_type', 'Control type', 'TEXT', NULL, 'REQUIRED_FOR_SELECTION'),
      (2, 'THERMOSTAT', 'max_load', 'Maximum load', 'NUMERIC', 'A', 'REQUIRED_FOR_COMPATIBILITY'),
      (3, 'HEAT_PUMP', 'heating_capacity', 'Heating capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'),
      (4, 'HEAT_PUMP', 'hydraulic_connection_size', 'Hydraulic connection', 'TEXT', NULL, 'REQUIRED_FOR_COMPATIBILITY'),
      (5, 'HEAT_PUMP', 'dimensions', 'Dimensions', 'TEXT', NULL, 'INFORMATIONAL');
    INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES
      ('operating_mode', 'TEXT', NULL),
      ('outdoor_air_c', 'NUMERIC', '°C'),
      ('water_supply_c', 'NUMERIC', '°C'),
      ('water_return_c', 'NUMERIC', '°C'),
      ('test_standard', 'TEXT', NULL);
    INSERT INTO engineering_source_type (source_type, verification_tier)
      VALUES ('MANUFACTURER_DATASHEET', 'AUTHORITATIVE');
    INSERT INTO engineering_value
      (value_id, product_id, parameter_id, value_text, value_status)
      VALUES (90, 2, 5, 'old dimensions', 'KNOWN');
  `);
  return db;
}

interface Fixture {
  directory: string;
  databasePath: string;
  inputPath: string;
  auditPath: string;
  backupPath: string;
  receiptPath: string;
}

function createFixture(rejectProductTwoInserts = false): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "ohmx-ed2b-"));
  const databasePath = join(directory, "fixture.db");
  const db = createFixtureDb(databasePath, rejectProductTwoInserts);
  db.close();
  const inputPath = join(directory, "facts.csv");
  const auditPath = join(directory, "engineering_data_research_audit.csv");
  writeFileSync(inputPath, renderInput(fixtureRows()), "utf8");
  writeFileSync(auditPath, "severity,product_id,sku,area,status,finding,recommended_action,source\n", "utf8");
  return {
    directory,
    databasePath,
    inputPath,
    auditPath,
    backupPath: join(directory, "backup", "fixture.db"),
    receiptPath: join(directory, "receipt", "apply-receipt.json"),
  };
}

function approvalFrom(preview: EngineeringDataImportPreview): EngineeringDataImportApproval {
  return {
    expectedDatabaseSha256: preview.baseline.databaseSha256,
    expectedInputSha256: preview.baseline.inputSha256,
    expectedPreviewFingerprint: preview.previewFingerprint,
    expectedSummary: { ...preview.summary },
    readyFactIds: preview.facts.filter((row) => row.classification === "READY").map((row) => row.factId as number),
    conflictFactIds: preview.facts.filter((row) => row.classification === "CONFLICT").map((row) => row.factId as number),
    blockedContractFactIds: preview.facts.filter((row) => row.classification === "BLOCKED_CONTRACT").map((row) => row.factId as number),
    reviewRequiredFactIds: preview.facts.filter((row) => row.classification === "REVIEW_REQUIRED").map((row) => row.factId as number),
  };
}

async function inspectFixture(fixture: Fixture): Promise<EngineeringDataImportPreview> {
  return inspectEngineeringDataImport({
    databasePath: fixture.databasePath,
    inputPath: fixture.inputPath,
    auditPath: fixture.auditPath,
  });
}

test("freezes the exact ED2B three-way approval tokens", () => {
  assert.equal(ED2B_APPROVED_DATABASE_SHA256, "847e70a4757d2b03b93476d30c63e4585460367be2a1ddeba0e9a37d1cf34645");
  assert.equal(ED2B_APPROVED_INPUT_SHA256, "b045b5969f4b18ad50c3861bac29dc20763f5f051ceee975bd14a6875044fe15");
  assert.equal(
    ED2B_APPROVED_PREVIEW_FINGERPRINT,
    "engineering-data-import-preview:sha256:ee66b41415134fb0b70cbb6fdf3bb038f56b36fcbcd196b884deb63ddf2e0ad9",
  );
  assert.deepEqual(ED2B_APPROVED_SUMMARY, {
    factsDiscovered: 37,
    readyCount: 27,
    noChangeCount: 0,
    conflictCount: 3,
    blockedContractCount: 6,
    reviewRequiredCount: 1,
    invalidCount: 0,
    insertSourceCount: 5,
    insertConditionSetCount: 5,
    insertConditionEntryCount: 28,
    insertValueCount: 27,
  });
  assert.deepEqual([...ED2B_APPROVED_READY_FACT_IDS], [
    1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  ]);
  assert.deepEqual([...ED2B_APPROVED_CONFLICT_FACT_IDS], [35, 36, 37]);
  assert.deepEqual([...ED2B_APPROVED_BLOCKED_CONTRACT_FACT_IDS], [2, 12, 31, 32, 33, 34]);
  assert.deepEqual([...ED2B_APPROVED_REVIEW_REQUIRED_FACT_IDS], [15]);
});

test("applies only canonical READY actions and proves preview idempotency", async () => {
  const fixture = createFixture();
  try {
    const approvedPreview = await inspectFixture(fixture);
    const approval = approvalFrom(approvedPreview);
    assert.deepEqual(approvedPreview.summary, {
      factsDiscovered: 5,
      readyCount: 2,
      noChangeCount: 0,
      conflictCount: 1,
      blockedContractCount: 1,
      reviewRequiredCount: 1,
      invalidCount: 0,
      insertSourceCount: 2,
      insertConditionSetCount: 1,
      insertConditionEntryCount: 5,
      insertValueCount: 2,
    });

    const receipt = await applyEngineeringDataImport({
      databasePath: fixture.databasePath,
      inputPath: fixture.inputPath,
      auditPath: fixture.auditPath,
      backupPath: fixture.backupPath,
      receiptPath: fixture.receiptPath,
      approval,
    });

    assert.equal(receipt.status, "COMMITTED");
    assert.deepEqual(receipt.applied, {
      sources: 2,
      conditionSets: 1,
      conditionEntries: 5,
      values: 2,
      profileLinks: 0,
    });
    assert.equal(receipt.inserted.values.map((row) => row.factId).join(","), "1,2");
    assert.equal(existsSync(fixture.backupPath), true);
    assert.deepEqual(JSON.parse(readFileSync(fixture.receiptPath, "utf8")), receipt);

    const db = new Database(fixture.databasePath, { readonly: true });
    try {
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM engineering_source").get() as { count: number }).count, 2);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM engineering_condition_set").get() as { count: number }).count, 1);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM engineering_condition_entry").get() as { count: number }).count, 5);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM engineering_value").get() as { count: number }).count, 3);
      assert.deepEqual(
        db.prepare("SELECT value_text, value_status FROM engineering_value WHERE value_id = 90").get(),
        { value_text: "old dimensions", value_status: "KNOWN" },
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS count FROM engineering_value WHERE parameter_id IN (2, 4)").get() as { count: number }).count,
        0,
      );
    } finally {
      db.close();
    }

    const postApplyPreview = await inspectFixture(fixture);
    assert.equal(postApplyPreview.summary.readyCount, 0);
    assert.equal(postApplyPreview.summary.noChangeCount, 2);
    assert.equal(postApplyPreview.summary.conflictCount, 1);
    assert.equal(postApplyPreview.summary.blockedContractCount, 1);
    assert.equal(postApplyPreview.summary.reviewRequiredCount, 1);
    assert.equal(postApplyPreview.summary.insertValueCount, 0);
    assert.deepEqual(
      postApplyPreview.facts.filter((row) => row.classification === "NO_CHANGE").map((row) => row.factId),
      [1, 2],
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("refuses every DB/input/preview binding mismatch before creating outputs", async () => {
  for (const mismatch of ["database", "input", "preview"] as const) {
    const fixture = createFixture();
    try {
      const preview = await inspectFixture(fixture);
      const approval = approvalFrom(preview);
      if (mismatch === "database") approval.expectedDatabaseSha256 = "0".repeat(64);
      if (mismatch === "input") approval.expectedInputSha256 = "1".repeat(64);
      if (mismatch === "preview") {
        approval.expectedPreviewFingerprint = `engineering-data-import-preview:sha256:${"2".repeat(64)}`;
      }
      const before = sha256File(fixture.databasePath);
      await assert.rejects(() => applyEngineeringDataImport({
        databasePath: fixture.databasePath,
        inputPath: fixture.inputPath,
        auditPath: fixture.auditPath,
        backupPath: fixture.backupPath,
        receiptPath: fixture.receiptPath,
        approval,
      }), /mismatch/i);
      assert.equal(sha256File(fixture.databasePath), before);
      assert.equal(existsSync(fixture.backupPath), false);
      assert.equal(existsSync(fixture.receiptPath), false);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("rolls back sources, conditions, entries, and values when a later insert fails", async () => {
  const fixture = createFixture(true);
  try {
    const preview = await inspectFixture(fixture);
    const approval = approvalFrom(preview);
    const before = sha256File(fixture.databasePath);

    await assert.rejects(() => applyEngineeringDataImport({
      databasePath: fixture.databasePath,
      inputPath: fixture.inputPath,
      auditPath: fixture.auditPath,
      backupPath: fixture.backupPath,
      receiptPath: fixture.receiptPath,
      approval,
    }), /CHECK constraint failed/);

    assert.equal(sha256File(fixture.databasePath), before);
    assert.equal(existsSync(fixture.receiptPath), false);
    const check = new Database(fixture.databasePath, { readonly: true });
    try {
      assert.equal((check.prepare("SELECT COUNT(*) AS count FROM engineering_source").get() as { count: number }).count, 0);
      assert.equal((check.prepare("SELECT COUNT(*) AS count FROM engineering_condition_set").get() as { count: number }).count, 0);
      assert.equal((check.prepare("SELECT COUNT(*) AS count FROM engineering_condition_entry").get() as { count: number }).count, 0);
      assert.equal((check.prepare("SELECT COUNT(*) AS count FROM engineering_value").get() as { count: number }).count, 1);
    } finally {
      check.close();
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
