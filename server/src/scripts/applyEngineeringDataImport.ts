import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  PREVIEW_FINGERPRINT_PREFIX,
  buildEngineeringDataImportPreview,
  inspectEngineeringDataImport,
  parseEngineeringDataImportCsv,
  parseEngineeringDataResearchAuditCsv,
  readEngineeringDataImportBaseline,
  readEngineeringDataImportBaselineFromConnection,
  type EngineeringDataImportFileBundleHashes,
  type EngineeringDataImportPreview,
  type EngineeringDataImportPreviewSummary,
  type PlannedConditionEntry,
} from "./previewEngineeringDataImport.js";

export const APPLY_RECEIPT_SCHEMA_ID = "ohmx.engineering-data-import-apply-receipt.v1" as const;
export const APPLY_RECEIPT_SCHEMA_VERSION = "1.0.0" as const;

export const ED2B_APPROVED_DATABASE_SHA256 = "847e70a4757d2b03b93476d30c63e4585460367be2a1ddeba0e9a37d1cf34645" as const;
export const ED2B_APPROVED_INPUT_SHA256 = "b045b5969f4b18ad50c3861bac29dc20763f5f051ceee975bd14a6875044fe15" as const;
export const ED2B_APPROVED_PREVIEW_FINGERPRINT = "engineering-data-import-preview:sha256:ee66b41415134fb0b70cbb6fdf3bb038f56b36fcbcd196b884deb63ddf2e0ad9" as const;

export const ED2B_APPROVED_SUMMARY: Readonly<EngineeringDataImportPreviewSummary> = {
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
};

export const ED2B_APPROVED_READY_FACT_IDS = [
  1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;
export const ED2B_APPROVED_CONFLICT_FACT_IDS = [35, 36, 37] as const;
export const ED2B_APPROVED_BLOCKED_CONTRACT_FACT_IDS = [2, 12, 31, 32, 33, 34] as const;
export const ED2B_APPROVED_REVIEW_REQUIRED_FACT_IDS = [15] as const;

export interface EngineeringDataImportApproval {
  /** Receipt label only; defaults to ED2B. Does not relax any guard. */
  phase?: "ED2B" | "RT41_FC";
  expectedDatabaseSha256: string;
  expectedInputSha256: string;
  expectedPreviewFingerprint: `${typeof PREVIEW_FINGERPRINT_PREFIX}${string}`;
  expectedSummary: EngineeringDataImportPreviewSummary;
  readyFactIds: readonly number[];
  conflictFactIds: readonly number[];
  blockedContractFactIds: readonly number[];
  reviewRequiredFactIds: readonly number[];
}

export const ED2B_APPROVAL: EngineeringDataImportApproval = {
  expectedDatabaseSha256: ED2B_APPROVED_DATABASE_SHA256,
  expectedInputSha256: ED2B_APPROVED_INPUT_SHA256,
  expectedPreviewFingerprint: ED2B_APPROVED_PREVIEW_FINGERPRINT,
  expectedSummary: { ...ED2B_APPROVED_SUMMARY },
  readyFactIds: ED2B_APPROVED_READY_FACT_IDS,
  conflictFactIds: ED2B_APPROVED_CONFLICT_FACT_IDS,
  blockedContractFactIds: ED2B_APPROVED_BLOCKED_CONTRACT_FACT_IDS,
  reviewRequiredFactIds: ED2B_APPROVED_REVIEW_REQUIRED_FACT_IDS,
};

interface AllowedTableCounts {
  sources: number;
  conditionSets: number;
  conditionEntries: number;
  values: number;
}

interface SourceReceiptRow {
  source_id: number;
  source_type: string;
  manufacturer: string | null;
  document_title: string | null;
  document_version: string | null;
  url: string | null;
  page: string | null;
  table_name: string | null;
  retrieved_at: string | null;
  audited_at: string | null;
  notes: string | null;
}

interface ConditionSetReceiptRow {
  condition_set_id: number;
  code: string;
  description: string | null;
}

interface ConditionEntryReceiptRow {
  condition_entry_id: number;
  condition_set_id: number;
  condition_key: string;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | null;
}

interface ValueReceiptRow {
  value_id: number;
  product_id: number;
  parameter_id: number;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | null;
  unit: string | null;
  condition_set_id: number | null;
  source_id: number | null;
  value_status: string;
  confidence: number | null;
}

interface ReceiptRow<Row> {
  row: Row;
  rowSha256: string;
}

interface SourceReceipt extends ReceiptRow<SourceReceiptRow> {
  sourceKey: string;
}

interface ConditionSetReceipt extends ReceiptRow<ConditionSetReceiptRow> {
  conditionKey: string;
}

interface ConditionEntryReceipt extends ReceiptRow<ConditionEntryReceiptRow> {
  conditionKey: string;
}

interface ValueReceipt extends ReceiptRow<ValueReceiptRow> {
  factId: number;
}

export interface EngineeringDataImportApplyReceipt {
  schemaId: typeof APPLY_RECEIPT_SCHEMA_ID;
  schemaVersion: typeof APPLY_RECEIPT_SCHEMA_VERSION;
  status: "COMMITTED";
  mode: "ED2B_CONTROLLED_READY_ONLY_APPLY" | "RT41_FC_CONTROLLED_READY_ONLY_APPLY";
  authorization: {
    expectedDatabaseSha256: string;
    expectedInputSha256: string;
    expectedPreviewFingerprint: string;
    approvedReadyFactIds: readonly number[];
  };
  preApply: {
    databaseBundle: EngineeringDataImportFileBundleHashes;
    databaseLogicalSha256: string;
    auditSha256: string;
    previewFingerprint: string;
  };
  backup: {
    path: string;
    sha256: string;
    databaseLogicalSha256: string;
    integrityCheck: "ok";
    foreignKeyViolationCount: 0;
  };
  applied: AllowedTableCounts & { profileLinks: 0 };
  skipped: {
    conflicts: number;
    blockedContract: number;
    reviewRequired: number;
  };
  inserted: {
    sources: SourceReceipt[];
    conditionSets: ConditionSetReceipt[];
    conditionEntries: ConditionEntryReceipt[];
    values: ValueReceipt[];
  };
  verification: {
    transactionMode: "BEGIN IMMEDIATE";
    rollbackOnError: true;
    integrityCheck: "ok";
    foreignKeyViolationCount: 0;
    postApplyDatabaseLogicalSha256: string;
    readyFactsAfterApply: 0;
    noChangeFactsAfterApply: number;
    remainingInsertPlanRows: 0;
    profileLinkageChanged: false;
    totalConnectionChanges: number;
  };
  rollback: {
    strategy: "GUARDED_RECEIPT_INVERSE_OR_VALIDATED_ONLINE_BACKUP_RESTORE";
    requiredCurrentDatabaseLogicalSha256: string;
    targetPreApplyDatabaseLogicalSha256: string;
    deleteOrder: readonly ["engineering_value", "engineering_condition_entry", "engineering_condition_set", "engineering_source"];
    exactRowIdsAndHashes: {
      engineering_value: Array<{ valueId: number; rowSha256: string }>;
      engineering_condition_entry: Array<{ conditionEntryId: number; rowSha256: string }>;
      engineering_condition_set: Array<{ conditionSetId: number; rowSha256: string }>;
      engineering_source: Array<{ sourceId: number; rowSha256: string }>;
    };
  };
  safety: {
    existingEngineeringValuesUpdated: false;
    matcherChanged: false;
    cm18Started: false;
    allowedDatabaseTables: readonly ["engineering_source", "engineering_condition_set", "engineering_condition_entry", "engineering_value"];
  };
  receiptPath: string;
}

export interface ApplyEngineeringDataImportOptions {
  databasePath: string;
  inputPath: string;
  auditPath: string;
  backupPath: string;
  receiptPath: string;
  approval: EngineeringDataImportApproval;
}

interface CliOptions {
  inputPath: string;
  expectedDatabaseSha256: string;
  expectedInputSha256: string;
  expectedPreviewFingerprint: string;
  backupPath: string;
  receiptPath: string;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareText)) result[key] = canonicalize(source[key]);
    return result;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function prettyCanonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256FileSync(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function optionalSha256FileSync(path: string): string | null {
  return existsSync(path) ? sha256FileSync(path) : null;
}

function readFileBundleSync(databasePath: string): EngineeringDataImportFileBundleHashes {
  return {
    databaseSha256: sha256FileSync(databasePath),
    databaseWalSha256: optionalSha256FileSync(`${databasePath}-wal`),
    databaseShmSha256: optionalSha256FileSync(`${databasePath}-shm`),
  };
}

function sameFileBundle(
  left: EngineeringDataImportFileBundleHashes,
  right: EngineeringDataImportFileBundleHashes,
): boolean {
  return left.databaseSha256 === right.databaseSha256
    && left.databaseWalSha256 === right.databaseWalSha256
    && left.databaseShmSha256 === right.databaseShmSha256;
}

function assertSha256(label: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function assertFingerprint(value: string): asserts value is `${typeof PREVIEW_FINGERPRINT_PREFIX}${string}` {
  const suffix = value.slice(PREVIEW_FINGERPRINT_PREFIX.length);
  if (!value.startsWith(PREVIEW_FINGERPRINT_PREFIX) || !/^[0-9a-f]{64}$/.test(suffix)) {
    throw new Error("expected preview fingerprint must use the engineering-data-import-preview SHA-256 format");
  }
}

function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function assertExactNumbers(label: string, actual: readonly number[], expected: readonly number[]): void {
  if (canonicalJson(sortedNumbers(actual)) !== canonicalJson(sortedNumbers(expected))) {
    throw new Error(`${label} mismatch: expected ${expected.join(",")} got ${actual.join(",")}`);
  }
}

function assertExactSummary(
  actual: EngineeringDataImportPreviewSummary,
  expected: EngineeringDataImportPreviewSummary,
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`approved preview summary mismatch: expected ${canonicalJson(expected)} got ${canonicalJson(actual)}`);
  }
}

function factIdsFor(preview: EngineeringDataImportPreview, classification: string): number[] {
  return preview.facts
    .filter((fact) => fact.classification === classification)
    .map((fact) => {
      if (fact.factId == null) throw new Error(`approved preview contains a null fact id in ${classification}`);
      return fact.factId;
    });
}

function assertApprovedPreview(
  preview: EngineeringDataImportPreview,
  approval: EngineeringDataImportApproval,
): void {
  assertSha256("expected DB SHA-256", approval.expectedDatabaseSha256);
  assertSha256("expected input SHA-256", approval.expectedInputSha256);
  assertFingerprint(approval.expectedPreviewFingerprint);
  if (preview.baseline.databaseSha256 !== approval.expectedDatabaseSha256) {
    throw new Error(`DB SHA-256 mismatch: expected ${approval.expectedDatabaseSha256} got ${preview.baseline.databaseSha256}`);
  }
  if (preview.baseline.inputSha256 !== approval.expectedInputSha256) {
    throw new Error(`input SHA-256 mismatch: expected ${approval.expectedInputSha256} got ${preview.baseline.inputSha256}`);
  }
  if (preview.previewFingerprint !== approval.expectedPreviewFingerprint) {
    throw new Error(`preview fingerprint mismatch: expected ${approval.expectedPreviewFingerprint} got ${preview.previewFingerprint}`);
  }
  assertExactSummary(preview.summary, approval.expectedSummary);
  assertExactNumbers("READY fact allowlist", factIdsFor(preview, "READY"), approval.readyFactIds);
  assertExactNumbers("CONFLICT fact exclusion", factIdsFor(preview, "CONFLICT"), approval.conflictFactIds);
  assertExactNumbers(
    "BLOCKED_CONTRACT fact exclusion",
    factIdsFor(preview, "BLOCKED_CONTRACT"),
    approval.blockedContractFactIds,
  );
  assertExactNumbers(
    "REVIEW_REQUIRED fact exclusion",
    factIdsFor(preview, "REVIEW_REQUIRED"),
    approval.reviewRequiredFactIds,
  );
  if (preview.summary.invalidCount !== 0 || preview.summary.noChangeCount !== 0) {
    throw new Error("approved pre-apply preview mismatch: INVALID and NO_CHANGE must both be zero");
  }
  const approvedReady = new Set(approval.readyFactIds);
  for (const fact of preview.facts) {
    if (fact.classification === "READY") {
      if (fact.factId == null || !approvedReady.has(fact.factId) || !fact.plannedActions.includes("INSERT_VALUE")) {
        throw new Error(`READY fact ${fact.factId ?? "NULL"} is not an approved value insert`);
      }
      continue;
    }
    if (fact.plannedActions.length !== 0) {
      throw new Error(`excluded fact ${fact.factId ?? "NULL"} unexpectedly contains insert actions`);
    }
  }
  assertExactNumbers(
    "insert-plan fact ids",
    preview.insertPlan.values.map((value) => value.factId),
    approval.readyFactIds,
  );
  for (const value of preview.insertPlan.values) {
    if (value.valueStatus !== "KNOWN" || value.confidence !== null || value.boolean !== null) {
      throw new Error(`fact ${value.factId} has a non-approved value status, confidence, or boolean payload`);
    }
    const sourceReferenceCount = Number(value.existingSourceId != null) + Number(value.sourceKey != null);
    if (sourceReferenceCount !== 1) throw new Error(`fact ${value.factId} must resolve exactly one source reference`);
    const conditionReferenceCount = Number(value.existingConditionSetId != null) + Number(value.conditionKey != null);
    if (conditionReferenceCount > 1) throw new Error(`fact ${value.factId} has ambiguous condition-set references`);
  }
}

function assertFrozenEd2bCliApproval(options: CliOptions): void {
  if (options.expectedDatabaseSha256 !== ED2B_APPROVED_DATABASE_SHA256) {
    throw new Error("ED2B frozen expected DB SHA-256 mismatch");
  }
  if (options.expectedInputSha256 !== ED2B_APPROVED_INPUT_SHA256) {
    throw new Error("ED2B frozen expected input SHA-256 mismatch");
  }
  if (options.expectedPreviewFingerprint !== ED2B_APPROVED_PREVIEW_FINGERPRINT) {
    throw new Error("ED2B frozen expected preview fingerprint mismatch");
  }
}

function countAllowedTables(db: Database.Database): AllowedTableCounts {
  const sourceCount = db.prepare("SELECT COUNT(*) AS count FROM engineering_source").get() as { count: number };
  const conditionSetCount = db.prepare("SELECT COUNT(*) AS count FROM engineering_condition_set").get() as { count: number };
  const conditionEntryCount = db.prepare("SELECT COUNT(*) AS count FROM engineering_condition_entry").get() as { count: number };
  const valueCount = db.prepare("SELECT COUNT(*) AS count FROM engineering_value").get() as { count: number };
  return {
    sources: sourceCount.count,
    conditionSets: conditionSetCount.count,
    conditionEntries: conditionEntryCount.count,
    values: valueCount.count,
  };
}

function connectionTotalChanges(db: Database.Database): number {
  return (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
}

function countDelta(after: AllowedTableCounts, before: AllowedTableCounts): AllowedTableCounts {
  return {
    sources: after.sources - before.sources,
    conditionSets: after.conditionSets - before.conditionSets,
    conditionEntries: after.conditionEntries - before.conditionEntries,
    values: after.values - before.values,
  };
}

function expectedInsertCounts(preview: EngineeringDataImportPreview): AllowedTableCounts {
  return {
    sources: preview.summary.insertSourceCount,
    conditionSets: preview.summary.insertConditionSetCount,
    conditionEntries: preview.summary.insertConditionEntryCount,
    values: preview.summary.insertValueCount,
  };
}

function assertAllowedDeltas(actual: AllowedTableCounts, expected: AllowedTableCounts): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`in-transaction insert delta mismatch: expected ${canonicalJson(expected)} got ${canonicalJson(actual)}`);
  }
}

function positiveRowId(value: number | bigint, label: string): number {
  const rowId = Number(value);
  if (!Number.isSafeInteger(rowId) || rowId < 1) throw new Error(`${label} returned an invalid row id`);
  return rowId;
}

function rowHash(row: unknown): string {
  return createHash("sha256").update(canonicalJson(row), "utf8").digest("hex");
}

function conditionEntryValues(entry: PlannedConditionEntry): readonly [number | null, string | null, number | null] {
  return [entry.numeric, entry.text, entry.boolean == null ? null : Number(entry.boolean)];
}

function readSourceReceiptRow(db: Database.Database, sourceId: number): SourceReceiptRow {
  const row = db.prepare(`
    SELECT source_id, source_type, manufacturer, document_title, document_version, url,
           page, table_name, retrieved_at, audited_at, notes
    FROM engineering_source
    WHERE source_id = ?
  `).get(sourceId) as SourceReceiptRow | undefined;
  if (row == null) throw new Error(`inserted source ${sourceId} cannot be read back`);
  return row;
}

function readConditionSetReceiptRow(db: Database.Database, conditionSetId: number): ConditionSetReceiptRow {
  const row = db.prepare(`
    SELECT condition_set_id, code, description
    FROM engineering_condition_set
    WHERE condition_set_id = ?
  `).get(conditionSetId) as ConditionSetReceiptRow | undefined;
  if (row == null) throw new Error(`inserted condition set ${conditionSetId} cannot be read back`);
  return row;
}

function readConditionEntryReceiptRow(db: Database.Database, conditionEntryId: number): ConditionEntryReceiptRow {
  const row = db.prepare(`
    SELECT condition_entry_id, condition_set_id, condition_key, value_numeric, value_text, value_boolean
    FROM engineering_condition_entry
    WHERE condition_entry_id = ?
  `).get(conditionEntryId) as ConditionEntryReceiptRow | undefined;
  if (row == null) throw new Error(`inserted condition entry ${conditionEntryId} cannot be read back`);
  return row;
}

function readValueReceiptRow(db: Database.Database, valueId: number): ValueReceiptRow {
  const row = db.prepare(`
    SELECT value_id, product_id, parameter_id, value_numeric, value_text, value_boolean,
           unit, condition_set_id, source_id, value_status, confidence
    FROM engineering_value
    WHERE value_id = ?
  `).get(valueId) as ValueReceiptRow | undefined;
  if (row == null) throw new Error(`inserted engineering value ${valueId} cannot be read back`);
  return row;
}

function assertNoTargetTableTriggers(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT name, tbl_name
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN ('engineering_source', 'engineering_condition_set', 'engineering_condition_entry', 'engineering_value')
    ORDER BY name
  `).all() as Array<{ name: string; tbl_name: string }>;
  if (rows.length > 0) {
    throw new Error(`refused target tables with triggers outside the write allowlist: ${canonicalJson(rows)}`);
  }
}

function assertPostApplyPreview(
  preview: EngineeringDataImportPreview,
  approval: EngineeringDataImportApproval,
): void {
  assertExactNumbers("post-apply NO_CHANGE fact ids", factIdsFor(preview, "NO_CHANGE"), approval.readyFactIds);
  assertExactNumbers("post-apply CONFLICT exclusions", factIdsFor(preview, "CONFLICT"), approval.conflictFactIds);
  assertExactNumbers(
    "post-apply BLOCKED_CONTRACT exclusions",
    factIdsFor(preview, "BLOCKED_CONTRACT"),
    approval.blockedContractFactIds,
  );
  assertExactNumbers(
    "post-apply REVIEW_REQUIRED exclusions",
    factIdsFor(preview, "REVIEW_REQUIRED"),
    approval.reviewRequiredFactIds,
  );
  if (preview.summary.readyCount !== 0
    || preview.summary.noChangeCount !== approval.readyFactIds.length
    || preview.summary.invalidCount !== 0
    || preview.summary.insertSourceCount !== 0
    || preview.summary.insertConditionSetCount !== 0
    || preview.summary.insertConditionEntryCount !== 0
    || preview.summary.insertValueCount !== 0
    || preview.insertPlan.sources.length !== 0
    || preview.insertPlan.conditionSets.length !== 0
    || preview.insertPlan.values.length !== 0) {
    throw new Error(`post-apply idempotency verification mismatch: ${canonicalJson(preview.summary)}`);
  }
}

function writeReceiptStage(path: string, receipt: EngineeringDataImportApplyReceipt): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, prettyCanonicalJson(receipt), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function removeIfPresent(path: string): void {
  rmSync(path, { force: true });
}

function assertOutputPaths(options: ApplyEngineeringDataImportOptions, receiptStagePath: string): void {
  const databasePath = resolve(options.databasePath);
  const protectedPaths = new Set([
    databasePath,
    resolve(`${options.databasePath}-wal`),
    resolve(`${options.databasePath}-shm`),
    resolve(options.inputPath),
    resolve(options.auditPath),
  ]);
  for (const [label, path] of [
    ["backup", resolve(options.backupPath)],
    ["receipt", resolve(options.receiptPath)],
    ["receipt stage", resolve(receiptStagePath)],
  ] as const) {
    if (protectedPaths.has(path)) throw new Error(`${label} path collides with a protected input/database path`);
    if (existsSync(path)) throw new Error(`${label} path already exists; refusing overwrite`);
  }
  if (resolve(options.backupPath) === resolve(options.receiptPath)) {
    throw new Error("backup and receipt paths must differ");
  }
}

export async function applyEngineeringDataImport(
  options: ApplyEngineeringDataImportOptions,
): Promise<EngineeringDataImportApplyReceipt> {
  const approvedPreview = await inspectEngineeringDataImport({
    databasePath: options.databasePath,
    inputPath: options.inputPath,
    auditPath: options.auditPath,
  });
  assertApprovedPreview(approvedPreview, options.approval);

  const preflightBundle: EngineeringDataImportFileBundleHashes = {
    databaseSha256: approvedPreview.baseline.databaseSha256,
    databaseWalSha256: approvedPreview.baseline.databaseWalSha256,
    databaseShmSha256: approvedPreview.baseline.databaseShmSha256,
  };
  const receiptStagePath = `${resolve(options.receiptPath)}.uncommitted-${process.pid}`;
  assertOutputPaths(options, receiptStagePath);
  mkdirSync(dirname(resolve(options.backupPath)), { recursive: true });
  mkdirSync(dirname(resolve(options.receiptPath)), { recursive: true });

  const db = new Database(resolve(options.databasePath), { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  let transactionOpen = false;
  let backupCreated = false;
  let receipt: EngineeringDataImportApplyReceipt | null = null;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;

    const lockedBundle = readFileBundleSync(resolve(options.databasePath));
    if (!sameFileBundle(preflightBundle, lockedBundle)) {
      throw new Error(`DB/WAL/SHM bundle mismatch after BEGIN IMMEDIATE: expected ${canonicalJson(preflightBundle)} got ${canonicalJson(lockedBundle)}`);
    }
    const inputBytes = readFileSync(resolve(options.inputPath));
    const auditBytes = readFileSync(resolve(options.auditPath));
    const inputSha256 = sha256Bytes(inputBytes);
    const auditSha256 = sha256Bytes(auditBytes);
    if (inputSha256 !== options.approval.expectedInputSha256) {
      throw new Error(`input SHA-256 mismatch inside transaction: expected ${options.approval.expectedInputSha256} got ${inputSha256}`);
    }
    if (auditSha256 !== approvedPreview.baseline.auditSha256) {
      throw new Error(`research audit SHA-256 mismatch inside transaction: expected ${approvedPreview.baseline.auditSha256} got ${auditSha256}`);
    }

    const facts = parseEngineeringDataImportCsv(inputBytes.toString("utf8"));
    const auditRows = parseEngineeringDataResearchAuditCsv(auditBytes.toString("utf8"));
    const lockedBaseline = readEngineeringDataImportBaselineFromConnection(db, facts);
    const lockedPreview = buildEngineeringDataImportPreview({
      facts,
      auditRows,
      inputSha256,
      auditSha256,
      databaseSha256: lockedBundle.databaseSha256,
      databaseWalSha256: lockedBundle.databaseWalSha256,
      databaseShmSha256: lockedBundle.databaseShmSha256,
      baseline: lockedBaseline,
    });
    assertApprovedPreview(lockedPreview, options.approval);
    assertNoTargetTableTriggers(db);

    const backupSource = new Database(resolve(options.databasePath), { readonly: true, fileMustExist: true });
    try {
      backupSource.pragma("query_only = ON");
      await backupSource.backup(resolve(options.backupPath));
    } finally {
      backupSource.close();
    }
    backupCreated = true;
    const backupBaseline = readEngineeringDataImportBaseline(resolve(options.backupPath), facts);
    if (backupBaseline.logicalSha256 !== lockedBaseline.logicalSha256) {
      throw new Error(`online backup logical fingerprint mismatch: source ${lockedBaseline.logicalSha256} backup ${backupBaseline.logicalSha256}`);
    }
    const backupSha256 = sha256FileSync(resolve(options.backupPath));

    const beforeCounts = countAllowedTables(db);
    const profileSnapshot = canonicalJson(lockedBaseline.profiles);
    const totalChangesBefore = connectionTotalChanges(db);

    const sourceIdByKey = new Map<string, number>();
    const insertedSources: SourceReceipt[] = [];
    const insertSource = db.prepare(`
      INSERT INTO engineering_source
        (source_type, manufacturer, document_title, document_version, url, page,
         table_name, retrieved_at, audited_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `);
    for (const source of lockedPreview.insertPlan.sources) {
      const result = insertSource.run(
        source.sourceType,
        source.manufacturer,
        source.documentTitle,
        source.documentVersion,
        source.url,
        source.page,
        source.tableName,
        source.retrievedAt,
        source.identitySource,
      );
      if (result.changes !== 1) throw new Error(`source ${source.sourceKey} insert affected ${result.changes} rows`);
      const sourceId = positiveRowId(result.lastInsertRowid, `source ${source.sourceKey}`);
      sourceIdByKey.set(source.sourceKey, sourceId);
      const row = readSourceReceiptRow(db, sourceId);
      insertedSources.push({ sourceKey: source.sourceKey, row, rowSha256: rowHash(row) });
    }

    const conditionSetIdByKey = new Map<string, number>();
    const insertedConditionSets: ConditionSetReceipt[] = [];
    const insertedConditionEntries: ConditionEntryReceipt[] = [];
    const insertConditionSet = db.prepare(`
      INSERT INTO engineering_condition_set (code, description)
      VALUES (?, ?)
    `);
    const insertConditionEntry = db.prepare(`
      INSERT INTO engineering_condition_entry
        (condition_set_id, condition_key, value_numeric, value_text, value_boolean)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const conditionSet of lockedPreview.insertPlan.conditionSets) {
      const setResult = insertConditionSet.run(conditionSet.code, conditionSet.description);
      if (setResult.changes !== 1) {
        throw new Error(`condition set ${conditionSet.conditionKey} insert affected ${setResult.changes} rows`);
      }
      const conditionSetId = positiveRowId(setResult.lastInsertRowid, `condition set ${conditionSet.conditionKey}`);
      conditionSetIdByKey.set(conditionSet.conditionKey, conditionSetId);
      const setRow = readConditionSetReceiptRow(db, conditionSetId);
      insertedConditionSets.push({
        conditionKey: conditionSet.conditionKey,
        row: setRow,
        rowSha256: rowHash(setRow),
      });
      for (const entry of conditionSet.entries) {
        const values = conditionEntryValues(entry);
        const entryResult = insertConditionEntry.run(conditionSetId, entry.conditionKey, ...values);
        if (entryResult.changes !== 1) {
          throw new Error(`condition entry ${conditionSet.conditionKey}/${entry.conditionKey} affected ${entryResult.changes} rows`);
        }
        const conditionEntryId = positiveRowId(
          entryResult.lastInsertRowid,
          `condition entry ${conditionSet.conditionKey}/${entry.conditionKey}`,
        );
        const entryRow = readConditionEntryReceiptRow(db, conditionEntryId);
        insertedConditionEntries.push({
          conditionKey: conditionSet.conditionKey,
          row: entryRow,
          rowSha256: rowHash(entryRow),
        });
      }
    }

    const insertedValues: ValueReceipt[] = [];
    const insertValue = db.prepare(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, value_text, value_boolean, unit,
         condition_set_id, source_id, value_status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const value of lockedPreview.insertPlan.values) {
      const conditionSetId = value.existingConditionSetId
        ?? (value.conditionKey == null ? null : conditionSetIdByKey.get(value.conditionKey) ?? null);
      const sourceId = value.existingSourceId
        ?? (value.sourceKey == null ? null : sourceIdByKey.get(value.sourceKey) ?? null);
      if (value.conditionKey != null && conditionSetId == null) {
        throw new Error(`fact ${value.factId} cannot resolve planned condition set ${value.conditionKey}`);
      }
      if (sourceId == null) throw new Error(`fact ${value.factId} cannot resolve its approved source`);
      const result = insertValue.run(
        value.productId,
        value.parameterId,
        value.numeric,
        value.text,
        value.boolean,
        value.unit,
        conditionSetId,
        sourceId,
        value.valueStatus,
        value.confidence,
      );
      if (result.changes !== 1) throw new Error(`fact ${value.factId} value insert affected ${result.changes} rows`);
      const valueId = positiveRowId(result.lastInsertRowid, `fact ${value.factId}`);
      const row = readValueReceiptRow(db, valueId);
      insertedValues.push({ factId: value.factId, row, rowSha256: rowHash(row) });
    }

    const afterCounts = countAllowedTables(db);
    const actualDeltas = countDelta(afterCounts, beforeCounts);
    const expectedDeltas = expectedInsertCounts(lockedPreview);
    assertAllowedDeltas(actualDeltas, expectedDeltas);
    const expectedConnectionChanges = expectedDeltas.sources
      + expectedDeltas.conditionSets
      + expectedDeltas.conditionEntries
      + expectedDeltas.values;
    const connectionChanges = connectionTotalChanges(db) - totalChangesBefore;
    if (connectionChanges !== expectedConnectionChanges) {
      throw new Error(`connection change count mismatch: expected ${expectedConnectionChanges} got ${connectionChanges}`);
    }

    const postBaseline = readEngineeringDataImportBaselineFromConnection(db, facts);
    if (canonicalJson(postBaseline.profiles) !== profileSnapshot) {
      throw new Error("engineering_product_profile changed even though no approved READY action requested profile linkage");
    }
    const postPreview = buildEngineeringDataImportPreview({
      facts,
      auditRows,
      inputSha256,
      auditSha256,
      databaseSha256: lockedBundle.databaseSha256,
      databaseWalSha256: lockedBundle.databaseWalSha256,
      databaseShmSha256: lockedBundle.databaseShmSha256,
      baseline: postBaseline,
    });
    assertPostApplyPreview(postPreview, options.approval);

    receipt = {
      schemaId: APPLY_RECEIPT_SCHEMA_ID,
      schemaVersion: APPLY_RECEIPT_SCHEMA_VERSION,
      status: "COMMITTED",
      mode: options.approval.phase === "RT41_FC" ? "RT41_FC_CONTROLLED_READY_ONLY_APPLY" : "ED2B_CONTROLLED_READY_ONLY_APPLY",
      authorization: {
        expectedDatabaseSha256: options.approval.expectedDatabaseSha256,
        expectedInputSha256: options.approval.expectedInputSha256,
        expectedPreviewFingerprint: options.approval.expectedPreviewFingerprint,
        approvedReadyFactIds: [...options.approval.readyFactIds],
      },
      preApply: {
        databaseBundle: lockedBundle,
        databaseLogicalSha256: lockedBaseline.logicalSha256,
        auditSha256,
        previewFingerprint: lockedPreview.previewFingerprint,
      },
      backup: {
        path: resolve(options.backupPath),
        sha256: backupSha256,
        databaseLogicalSha256: backupBaseline.logicalSha256,
        integrityCheck: backupBaseline.integrityCheck,
        foreignKeyViolationCount: 0,
      },
      applied: {
        ...actualDeltas,
        profileLinks: 0,
      },
      skipped: {
        conflicts: options.approval.conflictFactIds.length,
        blockedContract: options.approval.blockedContractFactIds.length,
        reviewRequired: options.approval.reviewRequiredFactIds.length,
      },
      inserted: {
        sources: insertedSources,
        conditionSets: insertedConditionSets,
        conditionEntries: insertedConditionEntries,
        values: insertedValues,
      },
      verification: {
        transactionMode: "BEGIN IMMEDIATE",
        rollbackOnError: true,
        integrityCheck: postBaseline.integrityCheck,
        foreignKeyViolationCount: 0,
        postApplyDatabaseLogicalSha256: postBaseline.logicalSha256,
        readyFactsAfterApply: 0,
        noChangeFactsAfterApply: postPreview.summary.noChangeCount,
        remainingInsertPlanRows: 0,
        profileLinkageChanged: false,
        totalConnectionChanges: connectionChanges,
      },
      rollback: {
        strategy: "GUARDED_RECEIPT_INVERSE_OR_VALIDATED_ONLINE_BACKUP_RESTORE",
        requiredCurrentDatabaseLogicalSha256: postBaseline.logicalSha256,
        targetPreApplyDatabaseLogicalSha256: lockedBaseline.logicalSha256,
        deleteOrder: [
          "engineering_value",
          "engineering_condition_entry",
          "engineering_condition_set",
          "engineering_source",
        ],
        exactRowIdsAndHashes: {
          engineering_value: insertedValues.map((row) => ({ valueId: row.row.value_id, rowSha256: row.rowSha256 })),
          engineering_condition_entry: insertedConditionEntries.map((row) => ({
            conditionEntryId: row.row.condition_entry_id,
            rowSha256: row.rowSha256,
          })),
          engineering_condition_set: insertedConditionSets.map((row) => ({
            conditionSetId: row.row.condition_set_id,
            rowSha256: row.rowSha256,
          })),
          engineering_source: insertedSources.map((row) => ({ sourceId: row.row.source_id, rowSha256: row.rowSha256 })),
        },
      },
      safety: {
        existingEngineeringValuesUpdated: false,
        matcherChanged: false,
        cm18Started: false,
        allowedDatabaseTables: [
          "engineering_source",
          "engineering_condition_set",
          "engineering_condition_entry",
          "engineering_value",
        ],
      },
      receiptPath: resolve(options.receiptPath),
    };

    writeReceiptStage(receiptStagePath, receipt);
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original guarded-apply error.
      }
      transactionOpen = false;
    }
    removeIfPresent(receiptStagePath);
    if (backupCreated) removeIfPresent(resolve(options.backupPath));
    throw error;
  } finally {
    db.close();
  }

  if (receipt == null) throw new Error("ED2B apply reached COMMIT without a receipt");
  try {
    renameSync(receiptStagePath, resolve(options.receiptPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DATABASE COMMITTED but receipt publication failed; recover the staged receipt at ${receiptStagePath}: ${message}`,
    );
  }
  return receipt;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const accepted = new Set([
    "--input",
    "--expected-db-sha",
    "--expected-input-sha",
    "--expected-preview-fingerprint",
    "--backup",
    "--receipt",
  ]);
  if (argv.length !== accepted.size * 2) {
    throw new Error(
      "Usage: npm run apply:engineering-data-import -w server -- --input <v2.csv> --expected-db-sha <sha256> --expected-input-sha <sha256> --expected-preview-fingerprint <fingerprint> --backup <backup.db> --receipt <receipt.json>",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] as string;
    const value = argv[index + 1] as string;
    if (!accepted.has(flag)) throw new Error(`Unsupported ED2B apply argument ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate ED2B apply argument ${flag}`);
    if (value === "") throw new Error(`ED2B apply argument ${flag} requires a value`);
    values.set(flag, value);
  }
  for (const flag of accepted) {
    if (!values.has(flag)) throw new Error(`Missing ED2B apply argument ${flag}`);
  }
  return {
    inputPath: resolve(values.get("--input") as string),
    expectedDatabaseSha256: values.get("--expected-db-sha") as string,
    expectedInputSha256: values.get("--expected-input-sha") as string,
    expectedPreviewFingerprint: values.get("--expected-preview-fingerprint") as string,
    backupPath: resolve(values.get("--backup") as string),
    receiptPath: resolve(values.get("--receipt") as string),
  };
}

function repositoryRoot(): string {
  return resolve(fileURLToPath(new URL("../../../", import.meta.url)));
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  assertFrozenEd2bCliApproval(cli);
  const root = repositoryRoot();
  const receipt = await applyEngineeringDataImport({
    databasePath: join(root, "data", "electro.db"),
    inputPath: cli.inputPath,
    auditPath: join(dirname(cli.inputPath), "engineering_data_research_audit.csv"),
    backupPath: cli.backupPath,
    receiptPath: cli.receiptPath,
    approval: ED2B_APPROVAL,
  });
  process.stdout.write(prettyCanonicalJson(receipt));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
