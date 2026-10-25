import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import {
  CANONICAL_PARAMETER_CODES,
  CONDITION_KEYS,
  ENGINEERING_SCHEMA_ID,
  ENGINEERING_SCHEMA_VERSION,
  EQUIPMENT_TYPES,
  SOURCE_TYPES,
} from "../utils/catalogMatcher/types.js";

export const PREVIEW_SCHEMA_ID = "ohmx.engineering-data-import-preview.v1" as const;
export const PREVIEW_SCHEMA_VERSION = "1.0.0" as const;
export const PREVIEW_FINGERPRINT_PREFIX = "engineering-data-import-preview:sha256:" as const;
export const IMPORT_INPUT_SCHEMA_ID_V1 = "ohmx.engineering-data-proposed-facts.v1" as const;
export const IMPORT_INPUT_SCHEMA_VERSION_V1 = "1.0.0" as const;
export const IMPORT_INPUT_SCHEMA_ID_V2 = "ohmx.engineering-data-proposed-facts.v2" as const;
export const IMPORT_INPUT_SCHEMA_VERSION_V2 = "2.0.0" as const;
export const IMPORT_INPUT_SCHEMA_ID_V3 = "ohmx.engineering-data-proposed-facts.v3" as const;
export const IMPORT_INPUT_SCHEMA_VERSION_V3 = "3.0.0" as const;
const SOURCE_KEY_PREFIX = "engineering-source:sha256:" as const;
const CONDITION_KEY_PREFIX = "engineering-condition-set:sha256:" as const;

export const PROPOSED_FACT_HEADERS_V1 = [
  "fact_id",
  "product_id",
  "sku",
  "equipment_type",
  "parameter_code",
  "proposed_parameter_code",
  "value_numeric",
  "value_text",
  "unit",
  "operating_mode",
  "outdoor_air_c",
  "outdoor_air_wet_bulb_c",
  "water_supply_c",
  "water_return_c",
  "condition_set_suggested",
  "evidence_class",
  "action_status",
  "source_document",
  "identity_source",
  "source_page",
  "note",
] as const;

export const PROPOSED_FACT_HEADERS_V2 = [
  "fact_id",
  "product_id",
  "sku",
  "equipment_type",
  "parameter_code",
  "proposed_parameter_code",
  "value_numeric",
  "value_text",
  "unit",
  "operating_mode",
  "outdoor_air_c",
  "outdoor_air_wet_bulb_c",
  "water_supply_c",
  "water_return_c",
  "condition_set_suggested",
  "evidence_class",
  "action_status",
  "source_type",
  "source_manufacturer",
  "source_document_title",
  "source_document_version",
  "source_document",
  "source_retrieved_at",
  "identity_source",
  "source_page",
  "note",
] as const;

// v3 = v2 plus indoor-unit (FAN_COIL) condition columns inserted after water_return_c.
export const PROPOSED_FACT_HEADERS_V3 = [
  ...PROPOSED_FACT_HEADERS_V2.slice(0, PROPOSED_FACT_HEADERS_V2.indexOf("water_return_c") + 1),
  "indoor_air_dry_bulb_c",
  "indoor_air_wet_bulb_c",
  "water_in_c",
  "water_out_c",
  "fan_speed",
  "esp_pa",
  "test_standard",
  ...PROPOSED_FACT_HEADERS_V2.slice(PROPOSED_FACT_HEADERS_V2.indexOf("water_return_c") + 1),
] as const;

// New fixtures and successor research packages use v2. The parser remains
// read-compatible with the frozen v1 input so its original preview is reproducible.
export const PROPOSED_FACT_HEADERS = PROPOSED_FACT_HEADERS_V2;

const AUDIT_HEADERS = [
  "severity",
  "product_id",
  "sku",
  "area",
  "status",
  "finding",
  "recommended_action",
  "source",
] as const;

const INPUT_ACTION_STATUSES = [
  "READY_TO_PREVIEW",
  "BLOCKED_CONTRACT",
  "REVIEW_REQUIRED",
  "CONFLICT_EXISTING_REVIEW",
] as const;

const EVIDENCE_CLASSES = [
  "DIRECT_MANUFACTURER",
  "DIRECT_MANUFACTURER_LIMIT",
  "DERIVED_FROM_EXISTING_AUTHORITATIVE_STRUCTURED_VALUE",
  "MANUFACTURER_FAMILY_PLUS_HISTORICAL_SKU_ID",
  "MANUFACTURER_OPERATING_LIMIT_DIAGRAM",
  "DIRECT_MANUFACTURER_CURRENT_CATALOG",
  "DIRECT_MANUFACTURER_CURRENT_TECH_DATA",
] as const;

export const PREVIEW_CLASSIFICATIONS = [
  "READY",
  "NO_CHANGE",
  "CONFLICT",
  "BLOCKED_CONTRACT",
  "REVIEW_REQUIRED",
  "INVALID",
] as const;

const REQUIRED_SCHEMA_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  products: ["id", "sku", "is_active"],
  engineering_equipment_type: ["equipment_type", "description"],
  engineering_parameter: [
    "parameter_id", "equipment_type", "code", "canonical_name", "value_type", "canonical_unit",
    "requirement_level", "description",
  ],
  engineering_product_profile: [
    "product_id", "equipment_type", "series", "model", "identity_status", "data_completeness",
    "source_verification", "schema_id", "schema_version",
  ],
  engineering_condition_key: ["condition_key", "value_type", "unit", "description"],
  engineering_source_type: ["source_type", "verification_tier", "description"],
  engineering_source: [
    "source_id", "source_type", "manufacturer", "document_title", "document_version", "url", "page",
    "table_name", "retrieved_at", "audited_at", "notes",
  ],
  engineering_condition_set: ["condition_set_id", "code", "description"],
  engineering_condition_entry: [
    "condition_entry_id", "condition_set_id", "condition_key", "value_numeric", "value_text", "value_boolean",
  ],
  engineering_value: [
    "value_id", "product_id", "parameter_id", "value_numeric", "value_text", "value_boolean", "unit",
    "condition_set_id", "source_id", "value_status", "confidence",
  ],
};

const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|VACUUM|REINDEX|MERGE|TRUNCATE|ATTACH|DETACH)\b/i;
const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ACTION_ORDER = ["INSERT_SOURCE", "INSERT_CONDITION_SET", "INSERT_CONDITION_ENTRY", "INSERT_VALUE"] as const;
const MATCHER_EQUIPMENT_TYPES = new Set<string>(EQUIPMENT_TYPES);
const MATCHER_PARAMETER_CODES = new Set<string>(CANONICAL_PARAMETER_CODES);
const MATCHER_CONDITION_KEYS = new Set<string>(CONDITION_KEYS);
const MATCHER_SOURCE_TYPES = new Set<string>(SOURCE_TYPES);

type ProposedFactHeader =
  | (typeof PROPOSED_FACT_HEADERS_V1)[number]
  | (typeof PROPOSED_FACT_HEADERS_V2)[number]
  | (typeof PROPOSED_FACT_HEADERS_V3)[number];
type AuditHeader = (typeof AUDIT_HEADERS)[number];
export type InputActionStatus = (typeof INPUT_ACTION_STATUSES)[number];
export type PreviewClassification = (typeof PREVIEW_CLASSIFICATIONS)[number];
export type PlannedInsertAction = (typeof ACTION_ORDER)[number];
type ScalarValueType = "NUMERIC" | "TEXT" | "BOOLEAN";
type NullableScalar = string | number | boolean | null;

export interface ProposedImportFact {
  rowNumber: number;
  factIdRaw: string;
  productIdRaw: string;
  sku: string;
  equipmentType: string;
  parameterCode: string;
  proposedParameterCode: string;
  valueNumericRaw: string;
  valueText: string;
  unit: string;
  operatingMode: string;
  outdoorAirCRaw: string;
  outdoorAirWetBulbCRaw: string;
  waterSupplyCRaw: string;
  waterReturnCRaw: string;
  indoorAirDryBulbCRaw: string;
  indoorAirWetBulbCRaw: string;
  waterInCRaw: string;
  waterOutCRaw: string;
  fanSpeed: string;
  espPaRaw: string;
  testStandard: string;
  conditionSetSuggested: string;
  evidenceClass: string;
  actionStatus: string;
  inputSchemaId: typeof IMPORT_INPUT_SCHEMA_ID_V1 | typeof IMPORT_INPUT_SCHEMA_ID_V2 | typeof IMPORT_INPUT_SCHEMA_ID_V3;
  inputSchemaVersion: typeof IMPORT_INPUT_SCHEMA_VERSION_V1 | typeof IMPORT_INPUT_SCHEMA_VERSION_V2 | typeof IMPORT_INPUT_SCHEMA_VERSION_V3;
  sourceType: string;
  sourceManufacturer: string;
  sourceDocumentTitle: string;
  sourceDocumentVersion: string;
  sourceDocument: string;
  sourceRetrievedAt: string;
  identitySource: string;
  sourcePage: string;
  note: string;
  raw: Readonly<Partial<Record<ProposedFactHeader, string>>>;
}

export interface ResearchAuditRow {
  rowNumber: number;
  severity: string;
  productIdRaw: string;
  sku: string;
  area: string;
  status: string;
  finding: string;
  recommendedAction: string;
  source: string;
  raw: Readonly<Record<AuditHeader, string>>;
}

interface ProductRow {
  id: number;
  sku: string;
  is_active: number;
}

interface EquipmentTypeRow {
  equipment_type: string;
  description: string | null;
}

interface ProfileRow {
  product_id: number;
  equipment_type: string;
  series: string | null;
  model: string | null;
  identity_status: string;
  data_completeness: string;
  source_verification: string;
  schema_id: string;
  schema_version: string;
}

interface ParameterRow {
  parameter_id: number;
  equipment_type: string;
  code: string;
  canonical_name: string;
  value_type: ScalarValueType;
  canonical_unit: string | null;
  requirement_level: string;
  description: string | null;
}

interface ConditionKeyRow {
  condition_key: string;
  value_type: ScalarValueType;
  unit: string | null;
  description: string | null;
}

interface SourceTypeRow {
  source_type: string;
  verification_tier: string;
  description: string | null;
}

interface SourceRow {
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

interface ConditionSetRow {
  condition_set_id: number;
  code: string;
  description: string | null;
}

interface ConditionEntryRow {
  condition_entry_id: number;
  condition_set_id: number;
  condition_key: string;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | boolean | null;
}

interface ValueRow {
  value_id: number;
  product_id: number;
  parameter_id: number;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | boolean | null;
  unit: string | null;
  condition_set_id: number | null;
  source_id: number | null;
  value_status: string;
  confidence: number | null;
}

interface SchemaRow {
  name: string;
  sql: string;
}

interface SchemaColumnRow {
  table_name: string;
  column_name: string;
  column_type: string;
  not_null: number;
  primary_key: number;
}

interface IntegrityCheckRow {
  integrity_check: string;
}

interface ForeignKeyCheckRow {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

export interface EngineeringDataImportBaseline {
  integrityCheck: "ok";
  foreignKeyCheck: ForeignKeyCheckRow[];
  products: ProductRow[];
  equipmentTypes: EquipmentTypeRow[];
  profiles: ProfileRow[];
  parameters: ParameterRow[];
  conditionKeys: ConditionKeyRow[];
  sourceTypes: SourceTypeRow[];
  sources: SourceRow[];
  conditionSets: ConditionSetRow[];
  conditionEntries: ConditionEntryRow[];
  values: ValueRow[];
  schema: SchemaRow[];
  schemaColumns: SchemaColumnRow[];
  logicalSha256: string;
}

export interface PlannedConditionEntry {
  conditionKey: string;
  valueType: ScalarValueType;
  canonicalUnit: string | null;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
}

export interface ExistingValuePreview {
  valueId: number;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  unit: string | null;
  conditionSetId: number | null;
  conditionSetCode: string | null;
  sourceId: number | null;
  valueStatus: string;
  confidence: number | null;
}

export interface EngineeringDataImportPreviewFact {
  factId: number | null;
  sourceRowNumber: number;
  productId: number | null;
  sku: string;
  equipmentType: string;
  sourceParameterCode: string;
  targetParameterCode: string;
  sourceParameterId: number | null;
  parameterId: number | null;
  parameterValueType: ScalarValueType | null;
  parameterCanonicalUnit: string | null;
  valueNumeric: number | null;
  valueNumericRaw: string;
  valueText: string | null;
  unit: string | null;
  conditionSetSuggested: string | null;
  conditionEntries: PlannedConditionEntry[];
  existingConditionSetId: number | null;
  existingConditionSetCode: string | null;
  evidenceClass: string;
  inputActionStatus: string;
  classification: PreviewClassification;
  plannedAction: string;
  plannedActions: PlannedInsertAction[];
  sourceType: string | null;
  sourceManufacturer: string | null;
  sourceDocumentTitle: string | null;
  sourceDocumentVersion: string | null;
  sourceRetrievedAt: string | null;
  existingSourceId: number | null;
  sourceKey: string | null;
  existingValueIds: number[];
  existingValues: ExistingValuePreview[];
  auditStatuses: string[];
  reason: string;
  sourceDocument: string;
  identitySource: string | null;
  sourcePage: string | null;
  note: string | null;
}

export interface PlannedSourceInsert {
  sourceKey: string;
  sourceType: string;
  manufacturer: string;
  documentTitle: string;
  documentVersion: string | null;
  url: string;
  page: string | null;
  retrievedAt: string | null;
  tableName: null;
  identitySource: string | null;
}

export interface PlannedConditionSetInsert {
  conditionKey: string;
  code: string;
  description: string;
  entries: PlannedConditionEntry[];
}

export interface PlannedValueInsert {
  factId: number;
  productId: number;
  parameterId: number;
  parameterCode: string;
  numeric: number | null;
  text: string | null;
  boolean: null;
  unit: string | null;
  existingConditionSetId: number | null;
  conditionKey: string | null;
  existingSourceId: number | null;
  sourceKey: string | null;
  valueStatus: "KNOWN";
  confidence: null;
}

export interface EngineeringDataImportPreviewSummary {
  factsDiscovered: number;
  readyCount: number;
  noChangeCount: number;
  conflictCount: number;
  blockedContractCount: number;
  reviewRequiredCount: number;
  invalidCount: number;
  insertSourceCount: number;
  insertConditionSetCount: number;
  insertConditionEntryCount: number;
  insertValueCount: number;
}

export interface EngineeringDataImportPreview {
  schemaId: typeof PREVIEW_SCHEMA_ID;
  schemaVersion: typeof PREVIEW_SCHEMA_VERSION;
  mode: "READ_ONLY_DETERMINISTIC_PREVIEW";
  contract: {
    engineeringSchemaId: typeof ENGINEERING_SCHEMA_ID;
    engineeringSchemaVersion: typeof ENGINEERING_SCHEMA_VERSION;
    matcherVocabularyReadOnly: true;
    classifications: readonly PreviewClassification[];
  };
  baseline: {
    databaseSha256: string;
    databaseWalSha256: string | null;
    databaseShmSha256: string | null;
    databaseLogicalSha256: string;
    inputSha256: string;
    auditSha256: string;
    integrityCheck: "ok";
    foreignKeyViolationCount: 0;
  };
  previewFingerprint: `${typeof PREVIEW_FINGERPRINT_PREFIX}${string}`;
  summary: EngineeringDataImportPreviewSummary;
  safety: {
    databaseWrites: 0;
    applyExecuted: false;
    matcherChanged: false;
    cm18Started: false;
  };
  insertPlan: {
    sources: PlannedSourceInsert[];
    conditionSets: PlannedConditionSetInsert[];
    values: PlannedValueInsert[];
  };
  facts: EngineeringDataImportPreviewFact[];
}

export interface BuildEngineeringDataImportPreviewOptions {
  facts: ProposedImportFact[];
  auditRows: ResearchAuditRow[];
  inputSha256: string;
  auditSha256: string;
  databaseSha256: string;
  databaseWalSha256: string | null;
  databaseShmSha256: string | null;
  baseline: EngineeringDataImportBaseline;
}

export interface InspectEngineeringDataImportOptions {
  databasePath: string;
  inputPath: string;
  auditPath: string;
}

export interface PreviewEngineeringDataImportOptions extends InspectEngineeringDataImportOptions {
  outputDirectory: string;
}

export interface EngineeringDataImportFileBundleHashes {
  databaseSha256: string;
  databaseWalSha256: string | null;
  databaseShmSha256: string | null;
}

interface FactWorkingState {
  fact: ProposedImportFact;
  factId: number | null;
  productId: number | null;
  targetParameterCode: string;
  sourceParameter: ParameterRow | null;
  targetParameter: ParameterRow | null;
  numeric: number | null;
  text: string | null;
  unit: string | null;
  conditionEntries: PlannedConditionEntry[];
  conditionSignature: string | null;
  inputConditionKey: string | null;
  duplicateFactId: boolean;
  duplicateSemanticSlot: boolean;
  inconsistentInputConditionSet: boolean;
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

function prettyDeterministicJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDigest(hash.digest("hex")));
  });
}

async function optionalSha256File(path: string): Promise<string | null> {
  return existsSync(path) ? sha256File(path) : null;
}

export async function readEngineeringDataImportFileBundleHashes(
  databasePath: string,
): Promise<EngineeringDataImportFileBundleHashes> {
  return {
    databaseSha256: await sha256File(databasePath),
    databaseWalSha256: await optionalSha256File(`${databasePath}-wal`),
    databaseShmSha256: await optionalSha256File(`${databasePath}-shm`),
  };
}

export function sameEngineeringDataImportFileBundle(
  a: EngineeringDataImportFileBundleHashes,
  b: EngineeringDataImportFileBundleHashes,
): boolean {
  return a.databaseSha256 === b.databaseSha256
    && a.databaseWalSha256 === b.databaseWalSha256
    && a.databaseShmSha256 === b.databaseShmSha256;
}

function parseExactCsv<Header extends string>(
  csvText: string,
  expectedHeaders: readonly Header[],
  label: string,
): Array<{ rowNumber: number; raw: Record<Header, string> }> {
  const records = parse(csvText, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }) as unknown;
  if (!Array.isArray(records) || records.length === 0) throw new Error(`${label} is empty`);
  const rows = records as unknown[][];
  const header = rows[0];
  if (!Array.isArray(header) || header.some((cell) => typeof cell !== "string")) {
    throw new Error(`${label} header is invalid`);
  }
  if (header.length !== expectedHeaders.length || header.some((cell, index) => cell !== expectedHeaders[index])) {
    throw new Error(`${label} header mismatch: expected ${expectedHeaders.join(",")}`);
  }
  return rows.slice(1).map((row, index) => {
    if (!Array.isArray(row) || row.length !== expectedHeaders.length || row.some((cell) => typeof cell !== "string")) {
      throw new Error(`${label} row ${index + 2} has an invalid column count or value type`);
    }
    const raw = {} as Record<Header, string>;
    expectedHeaders.forEach((name, column) => {
      raw[name] = row[column] as string;
    });
    return { rowNumber: index + 2, raw };
  });
}

function proposedFactHeaders(csvText: string): string[] {
  const records = parse(csvText, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }) as unknown;
  if (!Array.isArray(records) || records.length === 0 || !Array.isArray(records[0])) {
    throw new Error("engineering-data input is empty or has an invalid header");
  }
  const header = records[0];
  if (header.some((cell) => typeof cell !== "string")) throw new Error("engineering-data input header is invalid");
  return header as string[];
}

function sameHeaders(header: readonly string[], expected: readonly string[]): boolean {
  return header.length === expected.length && header.every((cell, index) => cell === expected[index]);
}

function mapProposedFact(
  rowNumber: number,
  raw: Readonly<Record<ProposedFactHeader, string>>,
  inputSchemaId: ProposedImportFact["inputSchemaId"],
  inputSchemaVersion: ProposedImportFact["inputSchemaVersion"],
): ProposedImportFact {
  return {
    rowNumber,
    factIdRaw: raw.fact_id ?? "",
    productIdRaw: raw.product_id ?? "",
    sku: raw.sku ?? "",
    equipmentType: raw.equipment_type ?? "",
    parameterCode: raw.parameter_code ?? "",
    proposedParameterCode: raw.proposed_parameter_code ?? "",
    valueNumericRaw: raw.value_numeric ?? "",
    valueText: raw.value_text ?? "",
    unit: raw.unit ?? "",
    operatingMode: raw.operating_mode ?? "",
    outdoorAirCRaw: raw.outdoor_air_c ?? "",
    outdoorAirWetBulbCRaw: raw.outdoor_air_wet_bulb_c ?? "",
    waterSupplyCRaw: raw.water_supply_c ?? "",
    waterReturnCRaw: raw.water_return_c ?? "",
    indoorAirDryBulbCRaw: raw.indoor_air_dry_bulb_c ?? "",
    indoorAirWetBulbCRaw: raw.indoor_air_wet_bulb_c ?? "",
    waterInCRaw: raw.water_in_c ?? "",
    waterOutCRaw: raw.water_out_c ?? "",
    fanSpeed: raw.fan_speed ?? "",
    espPaRaw: raw.esp_pa ?? "",
    testStandard: raw.test_standard ?? "",
    conditionSetSuggested: raw.condition_set_suggested ?? "",
    evidenceClass: raw.evidence_class ?? "",
    actionStatus: raw.action_status ?? "",
    inputSchemaId,
    inputSchemaVersion,
    sourceType: raw.source_type ?? "",
    sourceManufacturer: raw.source_manufacturer ?? "",
    sourceDocumentTitle: raw.source_document_title ?? "",
    sourceDocumentVersion: raw.source_document_version ?? "",
    sourceDocument: raw.source_document ?? "",
    sourceRetrievedAt: raw.source_retrieved_at ?? "",
    identitySource: raw.identity_source ?? "",
    sourcePage: raw.source_page ?? "",
    note: raw.note ?? "",
    raw,
  };
}

export function parseEngineeringDataImportCsv(csvText: string): ProposedImportFact[] {
  const header = proposedFactHeaders(csvText);
  if (sameHeaders(header, PROPOSED_FACT_HEADERS_V3)) {
    return parseExactCsv(csvText, PROPOSED_FACT_HEADERS_V3, "engineering-data v3 input")
      .map(({ rowNumber, raw }) => mapProposedFact(
        rowNumber,
        raw as Readonly<Record<ProposedFactHeader, string>>,
        IMPORT_INPUT_SCHEMA_ID_V3,
        IMPORT_INPUT_SCHEMA_VERSION_V3,
      ));
  }
  if (sameHeaders(header, PROPOSED_FACT_HEADERS_V2)) {
    return parseExactCsv(csvText, PROPOSED_FACT_HEADERS_V2, "engineering-data v2 input")
      .map(({ rowNumber, raw }) => mapProposedFact(
        rowNumber,
        raw as Readonly<Record<ProposedFactHeader, string>>,
        IMPORT_INPUT_SCHEMA_ID_V2,
        IMPORT_INPUT_SCHEMA_VERSION_V2,
      ));
  }
  if (sameHeaders(header, PROPOSED_FACT_HEADERS_V1)) {
    return parseExactCsv(csvText, PROPOSED_FACT_HEADERS_V1, "engineering-data v1 input")
      .map(({ rowNumber, raw }) => mapProposedFact(
        rowNumber,
        raw as Readonly<Record<ProposedFactHeader, string>>,
        IMPORT_INPUT_SCHEMA_ID_V1,
        IMPORT_INPUT_SCHEMA_VERSION_V1,
      ));
  }
  throw new Error(
    `engineering-data input header mismatch: expected v1 ${PROPOSED_FACT_HEADERS_V1.join(",")} or v2 ${PROPOSED_FACT_HEADERS_V2.join(",")} or v3 ${PROPOSED_FACT_HEADERS_V3.join(",")}`,
  );
}

export function parseEngineeringDataResearchAuditCsv(csvText: string): ResearchAuditRow[] {
  return parseExactCsv(csvText, AUDIT_HEADERS, "engineering-data research audit").map(({ rowNumber, raw }) => ({
    rowNumber,
    severity: raw.severity,
    productIdRaw: raw.product_id,
    sku: raw.sku,
    area: raw.area,
    status: raw.status,
    finding: raw.finding,
    recommendedAction: raw.recommended_action,
    source: raw.source,
    raw,
  }));
}

export function assertPreviewSqlIsReadOnly(sql: string): void {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed)
    || trimmed.includes(";")
    || /--|\/\*/.test(trimmed)
    || WRITE_SQL.test(trimmed)
    || /\bPRAGMA\b/i.test(trimmed)) {
    throw new Error(`Engineering-data preview refused non-read-only SQL: ${trimmed.slice(0, 120)}`);
  }
}

function selectAll<T>(db: Database.Database, sql: string, params: readonly unknown[] = []): T[] {
  assertPreviewSqlIsReadOnly(sql);
  return db.prepare(sql).all(...params) as T[];
}

function positiveInteger(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function numericValue(raw: string): number | null {
  if (!NUMERIC_LITERAL.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function booleanValue(value: number | boolean | null): boolean | null {
  if (value == null) return null;
  return typeof value === "boolean" ? value : value !== 0;
}

function nullableText(value: string): string | null {
  return value === "" ? null : value;
}

function schemaColumns(db: Database.Database): SchemaColumnRow[] {
  const rows: SchemaColumnRow[] = [];
  for (const table of Object.keys(REQUIRED_SCHEMA_COLUMNS).sort(compareText)) {
    const safeTable = table.replaceAll("'", "''");
    rows.push(...selectAll<SchemaColumnRow>(db, `
      SELECT
        '${safeTable}' AS table_name,
        name AS column_name,
        type AS column_type,
        "notnull" AS not_null,
        pk AS primary_key
      FROM pragma_table_info('${safeTable}')
      ORDER BY cid
    `));
  }
  return rows;
}

function assertCurrentSchema(columns: readonly SchemaColumnRow[]): void {
  const byTable = new Map<string, Set<string>>();
  for (const row of columns) {
    const current = byTable.get(row.table_name) ?? new Set<string>();
    current.add(row.column_name);
    byTable.set(row.table_name, current);
  }
  for (const [table, required] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
    const actual = byTable.get(table);
    if (!actual) throw new Error(`BLOCKED_CONTRACT: required table ${table} is absent`);
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(`BLOCKED_CONTRACT: ${table} is missing required columns ${missing.join(",")}`);
    }
  }
}

function placeholders(count: number): string {
  if (count < 1) throw new Error("Cannot construct an empty placeholder list");
  return new Array(count).fill("?").join(",");
}

export function readEngineeringDataImportBaselineFromConnection(
  db: Database.Database,
  facts: readonly ProposedImportFact[],
): EngineeringDataImportBaseline {
  const productIds = Array.from(new Set(facts.map((fact) => positiveInteger(fact.productIdRaw)).filter((id): id is number => id != null)))
    .sort((a, b) => a - b);
  const integrityRows = db.pragma("integrity_check") as IntegrityCheckRow[];
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") {
    throw new Error(`BLOCKED_CONTRACT: PRAGMA integrity_check failed: ${canonicalJson(integrityRows)}`);
  }
  const foreignKeyCheck = db.pragma("foreign_key_check") as ForeignKeyCheckRow[];
  if (foreignKeyCheck.length > 0) {
    throw new Error(`BLOCKED_CONTRACT: PRAGMA foreign_key_check returned ${foreignKeyCheck.length} violation(s)`);
  }
  const columns = schemaColumns(db);
  assertCurrentSchema(columns);
  const productFilter = productIds.length > 0 ? `WHERE id IN (${placeholders(productIds.length)})` : "WHERE 0 = 1";
  const profileFilter = productIds.length > 0 ? `WHERE product_id IN (${placeholders(productIds.length)})` : "WHERE 0 = 1";
  const valueFilter = productIds.length > 0 ? `WHERE product_id IN (${placeholders(productIds.length)})` : "WHERE 0 = 1";
  const params = productIds.length > 0 ? productIds : [];
  const result = {
        integrityCheck: "ok" as const,
        foreignKeyCheck,
        products: selectAll<ProductRow>(db, `
          SELECT id, sku, is_active
          FROM products
          ${productFilter}
          ORDER BY id
        `, params),
        equipmentTypes: selectAll<EquipmentTypeRow>(db, `
          SELECT equipment_type, description
          FROM engineering_equipment_type
          ORDER BY equipment_type
        `),
        profiles: selectAll<ProfileRow>(db, `
          SELECT product_id, equipment_type, series, model, identity_status, data_completeness,
                 source_verification, schema_id, schema_version
          FROM engineering_product_profile
          ${profileFilter}
          ORDER BY product_id
        `, params),
        parameters: selectAll<ParameterRow>(db, `
          SELECT parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit,
                 requirement_level, description
          FROM engineering_parameter
          ORDER BY equipment_type, code, parameter_id
        `),
        conditionKeys: selectAll<ConditionKeyRow>(db, `
          SELECT condition_key, value_type, unit, description
          FROM engineering_condition_key
          ORDER BY condition_key
        `),
        sourceTypes: selectAll<SourceTypeRow>(db, `
          SELECT source_type, verification_tier, description
          FROM engineering_source_type
          ORDER BY source_type
        `),
        sources: selectAll<SourceRow>(db, `
          SELECT source_id, source_type, manufacturer, document_title, document_version, url, page,
                 table_name, retrieved_at, audited_at, notes
          FROM engineering_source
          ORDER BY source_id
        `),
        conditionSets: selectAll<ConditionSetRow>(db, `
          SELECT condition_set_id, code, description
          FROM engineering_condition_set
          ORDER BY code, condition_set_id
        `),
        conditionEntries: selectAll<ConditionEntryRow>(db, `
          SELECT condition_entry_id, condition_set_id, condition_key, value_numeric, value_text, value_boolean
          FROM engineering_condition_entry
          ORDER BY condition_set_id, condition_key, condition_entry_id
        `),
        values: selectAll<ValueRow>(db, `
          SELECT value_id, product_id, parameter_id, value_numeric, value_text, value_boolean, unit,
                 condition_set_id, source_id, value_status, confidence
          FROM engineering_value
          ${valueFilter}
          ORDER BY product_id, parameter_id, condition_set_id, value_id
        `, params),
        schema: selectAll<SchemaRow>(db, `
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'table'
            AND (name = 'products' OR name LIKE 'engineering_%')
          ORDER BY name
        `),
        schemaColumns: columns,
  };
  const logicalSha256 = sha256Text(canonicalJson(result));
  return { ...result, logicalSha256 };
}

export function readEngineeringDataImportBaseline(
  databasePath: string,
  facts: readonly ProposedImportFact[],
): EngineeringDataImportBaseline {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    const readSnapshot = db.transaction(() => readEngineeringDataImportBaselineFromConnection(db, facts));
    return readSnapshot.deferred();
  } finally {
    db.close();
  }
}

function conditionEntry(
  conditionKey: string,
  valueType: ScalarValueType,
  canonicalUnit: string | null,
  value: NullableScalar,
): PlannedConditionEntry {
  return {
    conditionKey,
    valueType,
    canonicalUnit,
    numeric: typeof value === "number" ? value : null,
    text: typeof value === "string" ? value : null,
    boolean: typeof value === "boolean" ? value : null,
  };
}

function buildConditionEntries(fact: ProposedImportFact): { entries: PlannedConditionEntry[]; invalidNumericFields: string[] } {
  const entries: PlannedConditionEntry[] = [];
  const invalidNumericFields: string[] = [];
  if (fact.operatingMode !== "") entries.push(conditionEntry("operating_mode", "TEXT", null, fact.operatingMode));
  const numericFields: Array<{ raw: string; inputName: string; conditionKey: string }> = [
    { raw: fact.outdoorAirCRaw, inputName: "outdoor_air_c", conditionKey: "outdoor_air_c" },
    { raw: fact.outdoorAirWetBulbCRaw, inputName: "outdoor_air_wet_bulb_c", conditionKey: "outdoor_air_wet_bulb_c" },
    { raw: fact.waterSupplyCRaw, inputName: "water_supply_c", conditionKey: "water_supply_c" },
    { raw: fact.waterReturnCRaw, inputName: "water_return_c", conditionKey: "water_return_c" },
    { raw: fact.indoorAirDryBulbCRaw, inputName: "indoor_air_dry_bulb_c", conditionKey: "indoor_air_dry_bulb_c" },
    { raw: fact.indoorAirWetBulbCRaw, inputName: "indoor_air_wet_bulb_c", conditionKey: "indoor_air_wet_bulb_c" },
    { raw: fact.waterInCRaw, inputName: "water_in_c", conditionKey: "water_in_c" },
    { raw: fact.waterOutCRaw, inputName: "water_out_c", conditionKey: "water_out_c" },
  ];
  for (const field of numericFields) {
    if (field.raw === "") continue;
    const parsed = numericValue(field.raw);
    if (parsed == null) invalidNumericFields.push(field.inputName);
    else entries.push(conditionEntry(field.conditionKey, "NUMERIC", "°C", parsed));
  }
  if (fact.espPaRaw !== "") {
    const parsed = numericValue(fact.espPaRaw);
    if (parsed == null) invalidNumericFields.push("esp_pa");
    else entries.push(conditionEntry("esp_pa", "NUMERIC", "Pa", parsed));
  }
  if (fact.fanSpeed !== "") entries.push(conditionEntry("fan_speed", "TEXT", null, fact.fanSpeed));
  if (fact.testStandard !== "") {
    entries.push(conditionEntry("test_standard", "TEXT", null, fact.testStandard));
  } else if (/(^|-)EN14511$/i.test(fact.conditionSetSuggested)) {
    entries.push(conditionEntry("test_standard", "TEXT", null, "EN 14511"));
  }
  entries.sort((a, b) => compareText(a.conditionKey, b.conditionKey));
  return { entries, invalidNumericFields };
}

function conditionSignature(entries: readonly PlannedConditionEntry[]): string {
  return canonicalJson(entries);
}

function currentConditionEntries(
  conditionSetId: number,
  baseline: EngineeringDataImportBaseline,
  conditionKeysByCode: ReadonlyMap<string, ConditionKeyRow>,
): PlannedConditionEntry[] {
  return baseline.conditionEntries
    .filter((entry) => entry.condition_set_id === conditionSetId)
    .map((entry): PlannedConditionEntry => {
      const definition = conditionKeysByCode.get(entry.condition_key);
      return {
        conditionKey: entry.condition_key,
        valueType: definition?.value_type ?? (entry.value_numeric != null ? "NUMERIC" : entry.value_text != null ? "TEXT" : "BOOLEAN"),
        canonicalUnit: definition?.unit ?? null,
        numeric: entry.value_numeric,
        text: entry.value_text,
        boolean: booleanValue(entry.value_boolean),
      };
    })
    .sort((a, b) => compareText(a.conditionKey, b.conditionKey));
}

function buildWorkingStates(
  facts: readonly ProposedImportFact[],
  baseline: EngineeringDataImportBaseline,
): FactWorkingState[] {
  const parametersByKey = new Map(baseline.parameters.map((parameter) => [
    `${parameter.equipment_type}\u0000${parameter.code}`,
    parameter,
  ]));
  const factIdCounts = new Map<string, number>();
  for (const fact of facts) factIdCounts.set(fact.factIdRaw, (factIdCounts.get(fact.factIdRaw) ?? 0) + 1);

  const initial = facts.map((fact): FactWorkingState => {
    const targetParameterCode = fact.proposedParameterCode || fact.parameterCode;
    const parsedConditions = buildConditionEntries(fact);
    const signature = parsedConditions.invalidNumericFields.length === 0
      ? conditionSignature(parsedConditions.entries)
      : null;
    const factId = positiveInteger(fact.factIdRaw);
    const productId = positiveInteger(fact.productIdRaw);
    const numeric = fact.valueNumericRaw === "" ? null : numericValue(fact.valueNumericRaw);
    const text = nullableText(fact.valueText);
    return {
      fact,
      factId,
      productId,
      targetParameterCode,
      sourceParameter: parametersByKey.get(`${fact.equipmentType}\u0000${fact.parameterCode}`) ?? null,
      targetParameter: parametersByKey.get(`${fact.equipmentType}\u0000${targetParameterCode}`) ?? null,
      numeric,
      text,
      unit: nullableText(fact.unit),
      conditionEntries: parsedConditions.entries,
      conditionSignature: signature,
      inputConditionKey: fact.conditionSetSuggested || null,
      duplicateFactId: (factIdCounts.get(fact.factIdRaw) ?? 0) > 1,
      duplicateSemanticSlot: false,
      inconsistentInputConditionSet: false,
    };
  });

  const semanticSlotCounts = new Map<string, number>();
  for (const state of initial) {
    const conditionIdentity = state.conditionSignature ?? (state.fact.conditionSetSuggested || "PRODUCT_ANY");
    const key = `${state.fact.productIdRaw}\u0000${state.fact.equipmentType}\u0000${state.targetParameterCode}\u0000${conditionIdentity}`;
    semanticSlotCounts.set(key, (semanticSlotCounts.get(key) ?? 0) + 1);
  }
  for (const state of initial) {
    const conditionIdentity = state.conditionSignature ?? (state.fact.conditionSetSuggested || "PRODUCT_ANY");
    const key = `${state.fact.productIdRaw}\u0000${state.fact.equipmentType}\u0000${state.targetParameterCode}\u0000${conditionIdentity}`;
    state.duplicateSemanticSlot = (semanticSlotCounts.get(key) ?? 0) > 1;
  }

  const signaturesByInputCode = new Map<string, Set<string>>();
  for (const state of initial) {
    if (!state.inputConditionKey || state.conditionSignature == null) continue;
    const signatures = signaturesByInputCode.get(state.inputConditionKey) ?? new Set<string>();
    signatures.add(state.conditionSignature);
    signaturesByInputCode.set(state.inputConditionKey, signatures);
  }
  for (const state of initial) {
    state.inconsistentInputConditionSet = Boolean(
      state.inputConditionKey && (signaturesByInputCode.get(state.inputConditionKey)?.size ?? 0) > 1,
    );
  }
  return initial;
}

function auditAreaMatches(parameterCode: string, area: string): boolean {
  const normalized = area.toLowerCase();
  if (parameterCode === "dimensions") return normalized.includes("dimension");
  if (parameterCode === "weight") return normalized.includes("weight");
  if (parameterCode === "scop") return normalized.includes("scop");
  if (parameterCode === "torque") return normalized.includes("actuator contract");
  if (parameterCode === "max_load") return normalized.includes("comparator");
  if (parameterCode.startsWith("operating_outdoor_")) return normalized.includes("outdoor operating range");
  if (parameterCode === "hydraulic_connection_size") return normalized.includes("hydraulic connection");
  if (["heating_capacity", "cooling_capacity", "cop", "eer", "electrical_input"].includes(parameterCode)) {
    return normalized.includes("operating points");
  }
  return false;
}

function auditStatusesFor(fact: ProposedImportFact, auditRows: readonly ResearchAuditRow[]): string[] {
  return Array.from(new Set(auditRows
    .filter((row) => (row.productIdRaw === "" || row.productIdRaw === fact.productIdRaw)
      && (row.sku === "" || row.sku === fact.sku)
      && auditAreaMatches(fact.parameterCode, row.area))
    .map((row) => row.status)))
    .sort(compareText);
}

interface ProposedSourceIdentity {
  sourceType: string;
  manufacturer: string;
  documentTitle: string;
  documentVersion: string | null;
  url: string;
  retrievedAt: string | null;
}

function sourceTypeFor(fact: ProposedImportFact): string {
  if (fact.sourceType !== "") return fact.sourceType;
  return /\.pdf(?:$|[?#])|[?&]action=download(?:&|$)/i.test(fact.sourceDocument)
    ? "MANUFACTURER_DATASHEET"
    : "MANUFACTURER_WEBSITE";
}

function sourceIdentityFor(fact: ProposedImportFact, sourceType: string): ProposedSourceIdentity {
  return {
    sourceType,
    manufacturer: fact.sourceManufacturer,
    documentTitle: fact.sourceDocumentTitle,
    documentVersion: nullableText(fact.sourceDocumentVersion),
    url: fact.sourceDocument,
    retrievedAt: nullableText(fact.sourceRetrievedAt),
  };
}

function sourceIdentityKey(identity: Pick<ProposedSourceIdentity, "sourceType" | "manufacturer" | "documentTitle" | "documentVersion" | "url">): string {
  return canonicalJson({
    sourceType: identity.sourceType,
    manufacturer: identity.manufacturer,
    documentTitle: identity.documentTitle,
    documentVersion: identity.documentVersion,
    url: identity.url,
  });
}

function validUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function sourceIdentityProblem(fact: ProposedImportFact, identity: ProposedSourceIdentity): string | null {
  if (fact.inputSchemaId === IMPORT_INPUT_SCHEMA_ID_V1) {
    return "BLOCKED_CONTRACT: a new source requires source_type, manufacturer, document_title or stable official document identifier, and URL identity; frozen v1 input supplies only the URL/page, and URL alone is insufficient";
  }
  if (fact.sourceType === "") return "BLOCKED_CONTRACT: new source requires source_type; URL alone is insufficient";
  if (identity.manufacturer.trim() === "") return "BLOCKED_CONTRACT: new source requires source_manufacturer";
  if (identity.documentTitle.trim() === "") return "BLOCKED_CONTRACT: new source requires source_document_title or stable official document identifier";
  if (identity.url.trim() === "") return "BLOCKED_CONTRACT: new source requires source_document URL";
  if (identity.sourceType === "MANUFACTURER_WEBSITE") {
    if (identity.retrievedAt == null) return "BLOCKED_CONTRACT: MANUFACTURER_WEBSITE source requires source_retrieved_at";
    if (!validUtcTimestamp(identity.retrievedAt)) return "BLOCKED_CONTRACT: source_retrieved_at must be an explicit UTC timestamp";
  }
  return null;
}

function completeCurrentSourceIdentity(source: SourceRow): boolean {
  const type = source.source_type;
  if (source.manufacturer == null || source.manufacturer.trim() === "") return false;
  if (source.document_title == null || source.document_title.trim() === "") return false;
  if (source.url == null || source.url.trim() === "") return false;
  if (type === "MANUFACTURER_WEBSITE") {
    return source.retrieved_at != null && validUtcTimestamp(source.retrieved_at);
  }
  return true;
}

function sameSourceIdentity(source: SourceRow, identity: ProposedSourceIdentity): boolean {
  return source.source_type === identity.sourceType
    && source.manufacturer === identity.manufacturer
    && source.document_title === identity.documentTitle
    && source.document_version === identity.documentVersion
    && source.url === identity.url;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function existingValuePreview(
  value: ValueRow,
  conditionSetsById: ReadonlyMap<number, ConditionSetRow>,
): ExistingValuePreview {
  return {
    valueId: value.value_id,
    numeric: value.value_numeric,
    text: value.value_text,
    boolean: booleanValue(value.value_boolean),
    unit: value.unit,
    conditionSetId: value.condition_set_id,
    conditionSetCode: value.condition_set_id == null ? null : conditionSetsById.get(value.condition_set_id)?.code ?? null,
    sourceId: value.source_id,
    valueStatus: value.value_status,
    confidence: value.confidence,
  };
}

function sameProposedValue(state: FactWorkingState, existing: ValueRow): boolean {
  return existing.value_status === "KNOWN"
    && existing.value_numeric === state.numeric
    && existing.value_text === state.text
    && booleanValue(existing.value_boolean) == null
    && existing.unit === state.unit;
}

function specializedBlockedReason(state: FactWorkingState): string {
  const { fact } = state;
  if (fact.parameterCode === "max_load" && /</.test(`${fact.valueText} ${fact.note}`)) {
    return "BLOCKED_CONTRACT: current NUMERIC scalar max_load cannot preserve the '<' comparator in the manufacturer limit <0.05 A / 10 W";
  }
  if (fact.parameterCode === "torque" && state.targetParameterCode === "actuating_force") {
    return "BLOCKED_CONTRACT: manufacturer value is actuating_force = 100 N; it is not torque and ACTUATOR actuating_force [N] is absent from the current registry";
  }
  if (fact.parameterCode === "operating_outdoor_min" || fact.parameterCode === "operating_outdoor_max") {
    return `BLOCKED_CONTRACT: ${fact.parameterCode} is currently PRODUCT_ANY but this source limit is mode/condition dependent (${fact.operatingMode || "mode unresolved"}); no unconditional insert is allowed`;
  }
  return `BLOCKED_CONTRACT: input action_status is BLOCKED_CONTRACT${fact.note ? ` — ${fact.note}` : ""}`;
}

function plannedActionText(actions: readonly PlannedInsertAction[], classification: PreviewClassification): string {
  if (classification !== "READY") return classification;
  return actions.join("+");
}

function validateHash(name: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest`);
}

export function buildEngineeringDataImportPreview(
  options: BuildEngineeringDataImportPreviewOptions,
): EngineeringDataImportPreview {
  validateHash("inputSha256", options.inputSha256);
  validateHash("auditSha256", options.auditSha256);
  validateHash("databaseSha256", options.databaseSha256);
  validateHash("databaseLogicalSha256", options.baseline.logicalSha256);
  if (options.databaseWalSha256 != null) validateHash("databaseWalSha256", options.databaseWalSha256);
  if (options.databaseShmSha256 != null) validateHash("databaseShmSha256", options.databaseShmSha256);

  const productsById = new Map(options.baseline.products.map((row) => [row.id, row]));
  const profilesByProductId = new Map(options.baseline.profiles.map((row) => [row.product_id, row]));
  const equipmentTypes = new Set(options.baseline.equipmentTypes.map((row) => row.equipment_type));
  const conditionKeysByCode = new Map(options.baseline.conditionKeys.map((row) => [row.condition_key, row]));
  const sourceTypesByCode = new Map(options.baseline.sourceTypes.map((row) => [row.source_type, row]));
  const sourcesByUrl = new Map<string, SourceRow[]>();
  for (const source of options.baseline.sources) {
    if (source.url == null) continue;
    const current = sourcesByUrl.get(source.url) ?? [];
    current.push(source);
    sourcesByUrl.set(source.url, current);
  }
  const conditionSetsById = new Map(options.baseline.conditionSets.map((row) => [row.condition_set_id, row]));
  const conditionSetsByCode = new Map(options.baseline.conditionSets.map((row) => [row.code, row]));
  const currentConditionSignatures = new Map<number, string>();
  const conditionSetIdsBySignature = new Map<string, number[]>();
  for (const set of options.baseline.conditionSets) {
    const signature = conditionSignature(currentConditionEntries(set.condition_set_id, options.baseline, conditionKeysByCode));
    currentConditionSignatures.set(set.condition_set_id, signature);
    const ids = conditionSetIdsBySignature.get(signature) ?? [];
    ids.push(set.condition_set_id);
    conditionSetIdsBySignature.set(signature, ids);
  }

  const workingStates = buildWorkingStates(options.facts, options.baseline);
  const previewFacts: EngineeringDataImportPreviewFact[] = [];

  for (const state of workingStates) {
    const fact = state.fact;
    const problems: string[] = [];
    const auditStatuses = auditStatusesFor(fact, options.auditRows);
    const product = state.productId == null ? null : productsById.get(state.productId) ?? null;
    const profile = state.productId == null ? null : profilesByProductId.get(state.productId) ?? null;
    if (state.factId == null) problems.push("fact_id must be a positive safe integer");
    if (state.productId == null) problems.push("product_id must be a positive safe integer");
    if (fact.sku === "") problems.push("sku is required");
    if (fact.equipmentType === "") problems.push("equipment_type is required");
    if (fact.parameterCode === "") problems.push("parameter_code is required");
    if (state.duplicateFactId) problems.push(`duplicate fact_id ${fact.factIdRaw}`);
    if (state.duplicateSemanticSlot) problems.push("duplicate proposed semantic value slot in input");
    if (state.inconsistentInputConditionSet) problems.push(`input condition-set code ${fact.conditionSetSuggested} has inconsistent entries`);
    if (product == null && state.productId != null) problems.push(`product ${state.productId} does not exist`);
    if (product != null && product.sku !== fact.sku) problems.push(`SKU mismatch: DB=${product.sku} input=${fact.sku}`);
    if (product != null && product.is_active === 0) problems.push("target product is inactive");
    if (profile == null && state.productId != null) problems.push(`engineering profile missing for product ${state.productId}`);
    if (profile != null && profile.equipment_type !== fact.equipmentType) {
      problems.push(`equipment type mismatch: profile=${profile.equipment_type} input=${fact.equipmentType}`);
    }
    if (profile != null && (profile.schema_id !== ENGINEERING_SCHEMA_ID || profile.schema_version !== ENGINEERING_SCHEMA_VERSION)) {
      problems.push(`profile schema mismatch: ${profile.schema_id}/${profile.schema_version}`);
    }
    if (!equipmentTypes.has(fact.equipmentType)) problems.push(`equipment type ${fact.equipmentType} is not registered`);
    if (!MATCHER_EQUIPMENT_TYPES.has(fact.equipmentType)) problems.push(`equipment type ${fact.equipmentType} is absent from the current canonical vocabulary`);
    if (!INPUT_ACTION_STATUSES.includes(fact.actionStatus as InputActionStatus)) problems.push(`unsupported action_status ${fact.actionStatus}`);
    if (!EVIDENCE_CLASSES.includes(fact.evidenceClass as (typeof EVIDENCE_CLASSES)[number])) problems.push(`unsupported evidence_class ${fact.evidenceClass}`);
    if (!validHttpUrl(fact.sourceDocument)) problems.push("source_document must be an absolute HTTP(S) URL");
    if (state.sourceParameter == null) problems.push(`source parameter ${fact.equipmentType}/${fact.parameterCode} is not registered`);
    if (!MATCHER_PARAMETER_CODES.has(fact.parameterCode)) problems.push(`source parameter ${fact.parameterCode} is absent from the current canonical vocabulary`);

    let classification: PreviewClassification;
    let reason: string;
    let existingConditionSetId: number | null = null;
    let existingConditionSetCode: string | null = null;
    let existingSourceId: number | null = null;
    let sourceKey: string | null = null;
    let sourceType: string | null = null;
    let existingValues: ValueRow[] = [];
    let plannedActions: PlannedInsertAction[] = [];

    if (problems.length > 0) {
      classification = "INVALID";
      reason = `INVALID: ${problems.join("; ")}`;
    } else if (fact.actionStatus === "BLOCKED_CONTRACT") {
      classification = "BLOCKED_CONTRACT";
      reason = specializedBlockedReason(state);
    } else if (fact.actionStatus === "REVIEW_REQUIRED") {
      classification = "REVIEW_REQUIRED";
      reason = `REVIEW_REQUIRED: source row remains unresolved and is not eligible for insert${fact.note ? ` — ${fact.note}` : ""}`;
    } else if (fact.actionStatus === "CONFLICT_EXISTING_REVIEW") {
      classification = "CONFLICT";
      existingValues = state.sourceParameter == null || state.productId == null
        ? []
        : options.baseline.values.filter((value) => value.product_id === state.productId && value.parameter_id === state.sourceParameter?.parameter_id);
      reason = `CONFLICT: input requires existing-value review; overwrite prohibited${fact.note ? ` — ${fact.note}` : ""}`;
    } else if (fact.parameterCode === "max_load" && /</.test(`${fact.valueText} ${fact.note}`)) {
      classification = "BLOCKED_CONTRACT";
      reason = specializedBlockedReason(state);
    } else if ((fact.parameterCode === "operating_outdoor_min" || fact.parameterCode === "operating_outdoor_max")
      && state.conditionEntries.length > 0) {
      classification = "BLOCKED_CONTRACT";
      reason = specializedBlockedReason(state);
    } else if (!MATCHER_PARAMETER_CODES.has(state.targetParameterCode)) {
      classification = "BLOCKED_CONTRACT";
      reason = `BLOCKED_CONTRACT: target parameter ${state.targetParameterCode} is absent from the current canonical vocabulary`;
    } else if (state.targetParameter == null) {
      classification = "BLOCKED_CONTRACT";
      reason = `BLOCKED_CONTRACT: target parameter ${fact.equipmentType}/${state.targetParameterCode} is absent from the current registry`;
    } else {
      const readyProblems: string[] = [];
      if (fact.valueNumericRaw !== "" && state.numeric == null) readyProblems.push("value_numeric is not a finite decimal literal");
      const populatedValueCount = Number(fact.valueNumericRaw !== "") + Number(fact.valueText !== "");
      if (populatedValueCount !== 1) readyProblems.push("exactly one of value_numeric/value_text must be populated");
      if (state.targetParameter.value_type === "NUMERIC" && fact.valueNumericRaw === "") readyProblems.push("NUMERIC parameter requires value_numeric");
      if (state.targetParameter.value_type === "TEXT" && fact.valueText === "") readyProblems.push("TEXT parameter requires value_text");
      if (state.targetParameter.value_type === "BOOLEAN") readyProblems.push("input contract has no boolean value column");
      if (state.targetParameter.value_type === "NUMERIC") {
        if (state.targetParameter.canonical_unit == null && fact.unit !== "") readyProblems.push("unit must be empty for this unitless NUMERIC parameter");
        if (state.targetParameter.canonical_unit != null && fact.unit !== state.targetParameter.canonical_unit) {
          readyProblems.push(`unit mismatch: registry=${state.targetParameter.canonical_unit} input=${fact.unit || "<empty>"}`);
        }
      } else if (state.targetParameter.value_type === "TEXT"
        && state.targetParameter.canonical_unit != null
        && fact.unit !== state.targetParameter.canonical_unit) {
        readyProblems.push(`unit mismatch: registry=${state.targetParameter.canonical_unit} input=${fact.unit || "<empty>"}`);
      }
      const parsedConditions = buildConditionEntries(fact);
      if (parsedConditions.invalidNumericFields.length > 0) {
        readyProblems.push(`invalid numeric condition field(s): ${parsedConditions.invalidNumericFields.join(",")}`);
      }
      if (fact.fanSpeed !== "" && !/^(LOW|MEDIUM|HIGH|AUTO)$/.test(fact.fanSpeed)) {
        readyProblems.push(`fan_speed must be one of LOW, MEDIUM, HIGH, AUTO (got ${fact.fanSpeed})`);
      }
      if (state.conditionEntries.length > 0 && !state.inputConditionKey) readyProblems.push("condition_set_suggested is required when condition fields are populated");
      if (state.conditionEntries.length === 0 && state.inputConditionKey) readyProblems.push("condition_set_suggested has no structured condition entries");

      if (readyProblems.length > 0) {
        classification = "INVALID";
        reason = `INVALID: ${readyProblems.join("; ")}`;
      } else {
        const missingConditionKeys = state.conditionEntries
          .filter((entry) => !conditionKeysByCode.has(entry.conditionKey) || !MATCHER_CONDITION_KEYS.has(entry.conditionKey))
          .map((entry) => entry.conditionKey);
        const mismatchedConditionKeys = state.conditionEntries.filter((entry) => {
          const current = conditionKeysByCode.get(entry.conditionKey);
          return current != null && (current.value_type !== entry.valueType || current.unit !== entry.canonicalUnit);
        });
        if (missingConditionKeys.length > 0) {
          classification = "BLOCKED_CONTRACT";
          reason = `BLOCKED_CONTRACT: current engineering_condition_key registry lacks ${missingConditionKeys.join(",")}; supplied source conditions will not be dropped or remapped`;
        } else if (mismatchedConditionKeys.length > 0) {
          classification = "BLOCKED_CONTRACT";
          reason = `BLOCKED_CONTRACT: condition-key type/unit mismatch for ${mismatchedConditionKeys.map((entry) => entry.conditionKey).join(",")}`;
        } else {
          const inputCondition = state.inputConditionKey ? conditionSetsByCode.get(state.inputConditionKey) ?? null : null;
          if (inputCondition && currentConditionSignatures.get(inputCondition.condition_set_id) !== state.conditionSignature) {
            classification = "CONFLICT";
            existingConditionSetId = inputCondition.condition_set_id;
            existingConditionSetCode = inputCondition.code;
            reason = `CONFLICT: condition-set code ${inputCondition.code} already exists with different entries`;
          } else {
            const matchingConditionIds = state.inputConditionKey == null || state.conditionSignature == null
              ? []
              : conditionSetIdsBySignature.get(state.conditionSignature) ?? [];
            const matchedCondition = state.inputConditionKey == null
              ? null
              : inputCondition
                ?? (matchingConditionIds.length > 0 ? conditionSetsById.get(matchingConditionIds[0] as number) ?? null : null);
            existingConditionSetId = matchedCondition?.condition_set_id ?? null;
            existingConditionSetCode = matchedCondition?.code ?? null;

            const sourceMatches = sourcesByUrl.get(fact.sourceDocument) ?? [];
            if (sourceMatches.length > 1) {
              classification = "CONFLICT";
              reason = `CONFLICT: source URL resolves to multiple current source records (${sourceMatches.map((source) => source.source_id).join(",")})`;
            } else {
              const sourceMatch = sourceMatches[0] ?? null;
              const proposedSourceType = sourceTypeFor(fact);
              const proposedSourceIdentity = sourceIdentityFor(fact, proposedSourceType);
              sourceType = sourceMatch?.source_type ?? proposedSourceType;
              const sourceTypeDefinition = sourceTypesByCode.get(sourceType);
              if (!MATCHER_SOURCE_TYPES.has(sourceType)) {
                classification = "BLOCKED_CONTRACT";
                reason = `BLOCKED_CONTRACT: source type ${sourceType} is absent from the current canonical vocabulary`;
              } else if (sourceTypeDefinition == null) {
                classification = "BLOCKED_CONTRACT";
                reason = `BLOCKED_CONTRACT: source type ${sourceType} is absent from engineering_source_type`;
              } else if (sourceTypeDefinition.verification_tier !== "AUTHORITATIVE") {
                classification = "BLOCKED_CONTRACT";
                reason = `BLOCKED_CONTRACT: source ${sourceType} resolves to ${sourceTypeDefinition.verification_tier}, not AUTHORITATIVE`;
              } else if (sourceMatch != null && !completeCurrentSourceIdentity(sourceMatch)) {
                classification = "BLOCKED_CONTRACT";
                reason = `BLOCKED_CONTRACT: current source ${sourceMatch.source_id} has incomplete source-type-aware authoritative identity`;
              } else if (sourceMatch != null
                && (fact.inputSchemaId === IMPORT_INPUT_SCHEMA_ID_V2 || fact.inputSchemaId === IMPORT_INPUT_SCHEMA_ID_V3)
                && !sameSourceIdentity(sourceMatch, proposedSourceIdentity)) {
                classification = "CONFLICT";
                reason = `CONFLICT: current source ${sourceMatch.source_id} identity differs from supplied ${fact.inputSchemaId === IMPORT_INPUT_SCHEMA_ID_V3 ? "v3" : "v2"} source identity`;
              } else if (fact.evidenceClass === "DERIVED_FROM_EXISTING_AUTHORITATIVE_STRUCTURED_VALUE" && sourceMatch == null) {
                classification = "BLOCKED_CONTRACT";
                reason = "BLOCKED_CONTRACT: derived fact requires the cited existing authoritative source row, but none matches source_document";
              } else if (sourceMatch == null) {
                const identityProblem = sourceIdentityProblem(fact, proposedSourceIdentity);
                if (identityProblem != null) {
                  classification = "BLOCKED_CONTRACT";
                  reason = identityProblem;
                } else {
                  sourceKey = `${SOURCE_KEY_PREFIX}${sha256Text(sourceIdentityKey(proposedSourceIdentity))}`;
                  plannedActions.push("INSERT_SOURCE");
                  classification = "READY";
                  if (state.inputConditionKey && existingConditionSetId == null) {
                    plannedActions.push("INSERT_CONDITION_SET", "INSERT_CONDITION_ENTRY");
                  }
                  plannedActions.push("INSERT_VALUE");
                  reason = `READY: ${plannedActions.join("+")}`;
                }
              } else {
                existingSourceId = sourceMatch.source_id;
                existingValues = options.baseline.values.filter((value) => value.product_id === state.productId
                  && value.parameter_id === state.targetParameter?.parameter_id
                  && value.condition_set_id === existingConditionSetId
                  && ((state.inputConditionKey == null && value.condition_set_id == null)
                    || (state.inputConditionKey != null && existingConditionSetId != null)));
                if (existingValues.length > 0) {
                  const exact = existingValues.filter((value) => sameProposedValue(state, value));
                  if (exact.length === existingValues.length) {
                    classification = "NO_CHANGE";
                    reason = `NO_CHANGE: exact KNOWN value already exists in the same normalized slot (${exact.map((value) => value.value_id).join(",")})`;
                  } else {
                    classification = "CONFLICT";
                    reason = `CONFLICT: current value(s) ${existingValues.map((value) => value.value_id).join(",")} occupy the same normalized slot with different payload/status`;
                  }
                } else {
                  classification = "READY";
                  if (state.inputConditionKey && existingConditionSetId == null) {
                    plannedActions.push("INSERT_CONDITION_SET", "INSERT_CONDITION_ENTRY");
                  }
                  plannedActions.push("INSERT_VALUE");
                  reason = `READY: ${plannedActions.join("+")}`;
                }
              }
            }
          }
        }
      }
    }

    plannedActions = ACTION_ORDER.filter((action) => plannedActions.includes(action));
    const existingPreviews = existingValues
      .map((value) => existingValuePreview(value, conditionSetsById))
      .sort((a, b) => a.valueId - b.valueId);
    previewFacts.push({
      factId: state.factId,
      sourceRowNumber: fact.rowNumber,
      productId: state.productId,
      sku: fact.sku,
      equipmentType: fact.equipmentType,
      sourceParameterCode: fact.parameterCode,
      targetParameterCode: state.targetParameterCode,
      sourceParameterId: state.sourceParameter?.parameter_id ?? null,
      parameterId: state.targetParameter?.parameter_id ?? null,
      parameterValueType: state.targetParameter?.value_type ?? null,
      parameterCanonicalUnit: state.targetParameter?.canonical_unit ?? null,
      valueNumeric: state.numeric,
      valueNumericRaw: fact.valueNumericRaw,
      valueText: state.text,
      unit: state.unit,
      conditionSetSuggested: nullableText(fact.conditionSetSuggested),
      conditionEntries: state.conditionEntries,
      existingConditionSetId,
      existingConditionSetCode,
      evidenceClass: fact.evidenceClass,
      inputActionStatus: fact.actionStatus,
      classification,
      plannedAction: plannedActionText(plannedActions, classification),
      plannedActions,
      sourceType,
      sourceManufacturer: nullableText(fact.sourceManufacturer),
      sourceDocumentTitle: nullableText(fact.sourceDocumentTitle),
      sourceDocumentVersion: nullableText(fact.sourceDocumentVersion),
      sourceRetrievedAt: nullableText(fact.sourceRetrievedAt),
      existingSourceId,
      sourceKey,
      existingValueIds: existingPreviews.map((value) => value.valueId),
      existingValues: existingPreviews,
      auditStatuses,
      reason,
      sourceDocument: fact.sourceDocument,
      identitySource: nullableText(fact.identitySource),
      sourcePage: nullableText(fact.sourcePage),
      note: nullableText(fact.note),
    });
  }

  previewFacts.sort((a, b) => {
    if (a.factId == null && b.factId != null) return 1;
    if (a.factId != null && b.factId == null) return -1;
    return (a.factId ?? 0) - (b.factId ?? 0) || a.sourceRowNumber - b.sourceRowNumber;
  });

  const sourceInsertMap = new Map<string, PlannedSourceInsert>();
  const conditionInsertMap = new Map<string, PlannedConditionSetInsert>();
  const valueInserts: PlannedValueInsert[] = [];
  for (const row of previewFacts.filter((fact) => fact.classification === "READY")) {
    if (row.sourceKey != null) {
      sourceInsertMap.set(row.sourceKey, {
        sourceKey: row.sourceKey,
        sourceType: row.sourceType as string,
        manufacturer: row.sourceManufacturer as string,
        documentTitle: row.sourceDocumentTitle as string,
        documentVersion: row.sourceDocumentVersion,
        url: row.sourceDocument,
        page: row.sourcePage,
        retrievedAt: row.sourceRetrievedAt,
        tableName: null,
        identitySource: row.identitySource,
      });
    }
    let conditionKey: string | null = null;
    if (row.conditionSetSuggested != null && row.existingConditionSetId == null) {
      conditionKey = `${CONDITION_KEY_PREFIX}${sha256Text(canonicalJson({
        code: row.conditionSetSuggested,
        entries: row.conditionEntries,
      }))}`;
      conditionInsertMap.set(conditionKey, {
        conditionKey,
        code: row.conditionSetSuggested,
        description: `ED2A deterministic import condition ${row.conditionSetSuggested}`,
        entries: row.conditionEntries,
      });
    }
    valueInserts.push({
      factId: row.factId as number,
      productId: row.productId as number,
      parameterId: row.parameterId as number,
      parameterCode: row.targetParameterCode,
      numeric: row.valueNumeric,
      text: row.valueText,
      boolean: null,
      unit: row.unit,
      existingConditionSetId: row.existingConditionSetId,
      conditionKey,
      existingSourceId: row.existingSourceId,
      sourceKey: row.sourceKey,
      valueStatus: "KNOWN",
      confidence: null,
    });
  }
  const sources = Array.from(sourceInsertMap.values()).sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const conditionSets = Array.from(conditionInsertMap.values()).sort((a, b) => compareText(a.code, b.code));
  valueInserts.sort((a, b) => a.factId - b.factId);

  const count = (classification: PreviewClassification): number => previewFacts.filter((row) => row.classification === classification).length;
  const summary: EngineeringDataImportPreviewSummary = {
    factsDiscovered: previewFacts.length,
    readyCount: count("READY"),
    noChangeCount: count("NO_CHANGE"),
    conflictCount: count("CONFLICT"),
    blockedContractCount: count("BLOCKED_CONTRACT"),
    reviewRequiredCount: count("REVIEW_REQUIRED"),
    invalidCount: count("INVALID"),
    insertSourceCount: sources.length,
    insertConditionSetCount: conditionSets.length,
    insertConditionEntryCount: conditionSets.reduce((total, conditionSet) => total + conditionSet.entries.length, 0),
    insertValueCount: valueInserts.length,
  };

  const baseline = {
    databaseSha256: options.databaseSha256,
    databaseWalSha256: options.databaseWalSha256,
    databaseShmSha256: options.databaseShmSha256,
    databaseLogicalSha256: options.baseline.logicalSha256,
    inputSha256: options.inputSha256,
    auditSha256: options.auditSha256,
    integrityCheck: options.baseline.integrityCheck,
    foreignKeyViolationCount: 0 as const,
  };
  const fingerprintPayload = {
    schemaId: PREVIEW_SCHEMA_ID,
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    contract: {
      engineeringSchemaId: ENGINEERING_SCHEMA_ID,
      engineeringSchemaVersion: ENGINEERING_SCHEMA_VERSION,
      matcherVocabularyReadOnly: true,
      classifications: PREVIEW_CLASSIFICATIONS,
    },
    baseline,
    summary,
    insertPlan: { sources, conditionSets, values: valueInserts },
    facts: previewFacts,
  };
  const previewFingerprint = `${PREVIEW_FINGERPRINT_PREFIX}${sha256Text(canonicalJson(fingerprintPayload))}` as const;
  return {
    schemaId: PREVIEW_SCHEMA_ID,
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    mode: "READ_ONLY_DETERMINISTIC_PREVIEW",
    contract: {
      engineeringSchemaId: ENGINEERING_SCHEMA_ID,
      engineeringSchemaVersion: ENGINEERING_SCHEMA_VERSION,
      matcherVocabularyReadOnly: true,
      classifications: PREVIEW_CLASSIFICATIONS,
    },
    baseline,
    previewFingerprint,
    summary,
    safety: {
      databaseWrites: 0,
      applyExecuted: false,
      matcherChanged: false,
      cm18Started: false,
    },
    insertPlan: { sources, conditionSets, values: valueInserts },
    facts: previewFacts,
  };
}

function encodeCsvCell(value: NullableScalar): string {
  if (value == null) return "";
  const text = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const PREVIEW_CSV_COLUMNS = [
  "fact_id", "source_row_number", "product_id", "sku", "equipment_type", "source_parameter_code",
  "target_parameter_code", "source_parameter_id", "parameter_id", "parameter_value_type", "parameter_canonical_unit",
  "value_numeric", "value_numeric_raw", "value_text", "unit", "condition_set_suggested", "condition_entries_json",
  "existing_condition_set_id", "existing_condition_set_code", "evidence_class", "input_action_status", "classification",
  "planned_action", "planned_actions", "source_type", "source_manufacturer", "source_document_title", "source_document_version",
  "source_retrieved_at", "existing_source_id", "source_key", "existing_value_ids",
  "existing_values_json", "audit_statuses", "reason", "source_document", "identity_source", "source_page", "note",
  "db_baseline_sha256", "input_sha256", "preview_fingerprint",
] as const;

export function renderEngineeringDataImportPreviewCsv(preview: EngineeringDataImportPreview): string {
  const lines = [PREVIEW_CSV_COLUMNS.join(",")];
  for (const fact of preview.facts) {
    const row: Record<(typeof PREVIEW_CSV_COLUMNS)[number], NullableScalar> = {
      fact_id: fact.factId,
      source_row_number: fact.sourceRowNumber,
      product_id: fact.productId,
      sku: fact.sku,
      equipment_type: fact.equipmentType,
      source_parameter_code: fact.sourceParameterCode,
      target_parameter_code: fact.targetParameterCode,
      source_parameter_id: fact.sourceParameterId,
      parameter_id: fact.parameterId,
      parameter_value_type: fact.parameterValueType,
      parameter_canonical_unit: fact.parameterCanonicalUnit,
      value_numeric: fact.valueNumeric,
      value_numeric_raw: fact.valueNumericRaw,
      value_text: fact.valueText,
      unit: fact.unit,
      condition_set_suggested: fact.conditionSetSuggested,
      condition_entries_json: canonicalJson(fact.conditionEntries),
      existing_condition_set_id: fact.existingConditionSetId,
      existing_condition_set_code: fact.existingConditionSetCode,
      evidence_class: fact.evidenceClass,
      input_action_status: fact.inputActionStatus,
      classification: fact.classification,
      planned_action: fact.plannedAction,
      planned_actions: fact.plannedActions.join("|"),
      source_type: fact.sourceType,
      source_manufacturer: fact.sourceManufacturer,
      source_document_title: fact.sourceDocumentTitle,
      source_document_version: fact.sourceDocumentVersion,
      source_retrieved_at: fact.sourceRetrievedAt,
      existing_source_id: fact.existingSourceId,
      source_key: fact.sourceKey,
      existing_value_ids: fact.existingValueIds.join("|"),
      existing_values_json: canonicalJson(fact.existingValues),
      audit_statuses: fact.auditStatuses.join("|"),
      reason: fact.reason,
      source_document: fact.sourceDocument,
      identity_source: fact.identitySource,
      source_page: fact.sourcePage,
      note: fact.note,
      db_baseline_sha256: preview.baseline.databaseSha256,
      input_sha256: preview.baseline.inputSha256,
      preview_fingerprint: preview.previewFingerprint,
    };
    lines.push(PREVIEW_CSV_COLUMNS.map((column) => encodeCsvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

export function renderEngineeringDataImportPreviewMarkdown(preview: EngineeringDataImportPreview): string {
  const summary = preview.summary;
  const lines = [
    "# ENGINEERING-DATA-ED2A import preview",
    "",
    "## Status",
    "",
    "READ-ONLY DETERMINISTIC PREVIEW. No database change was applied.",
    "",
    `Engineering contract: \`${preview.contract.engineeringSchemaId}\` / \`${preview.contract.engineeringSchemaVersion}\``,
    "",
    "## Frozen baseline",
    "",
    `- DB baseline SHA-256: \`${preview.baseline.databaseSha256}\``,
    `- DB WAL SHA-256: \`${preview.baseline.databaseWalSha256 ?? "ABSENT"}\``,
    `- DB SHM SHA-256: \`${preview.baseline.databaseShmSha256 ?? "ABSENT"}\``,
    `- DB logical SHA-256: \`${preview.baseline.databaseLogicalSha256}\``,
    `- Input SHA-256: \`${preview.baseline.inputSha256}\``,
    `- Research audit SHA-256: \`${preview.baseline.auditSha256}\``,
    `- Integrity check: \`${preview.baseline.integrityCheck}\``,
    `- Foreign-key violations: ${preview.baseline.foreignKeyViolationCount}`,
    `- Preview fingerprint: \`${preview.previewFingerprint}\``,
    "",
    "## Classification counts",
    "",
    `- FACTS_DISCOVERED: ${summary.factsDiscovered}`,
    `- READY: ${summary.readyCount}`,
    `- NO_CHANGE: ${summary.noChangeCount}`,
    `- CONFLICT: ${summary.conflictCount}`,
    `- BLOCKED_CONTRACT: ${summary.blockedContractCount}`,
    `- REVIEW_REQUIRED: ${summary.reviewRequiredCount}`,
    `- INVALID: ${summary.invalidCount}`,
    "",
    "## Deduplicated insert plan",
    "",
    `- INSERT_SOURCE: ${summary.insertSourceCount}`,
    `- INSERT_CONDITION_SET: ${summary.insertConditionSetCount}`,
    `- INSERT_CONDITION_ENTRY: ${summary.insertConditionEntryCount}`,
    `- INSERT_VALUE: ${summary.insertValueCount}`,
    "",
    "Only READY rows appear in the insert plan. This document does not authorize ED2B apply.",
    "",
    "## Facts",
    "",
    "| fact_id | SKU | parameter | target | classification | planned action | reason |",
    "|---:|---|---|---|---|---|---|",
  ];
  for (const fact of preview.facts) {
    lines.push(`| ${fact.factId ?? "INVALID"} | ${markdownCell(fact.sku)} | ${markdownCell(fact.sourceParameterCode)} | ${markdownCell(fact.targetParameterCode)} | ${fact.classification} | ${markdownCell(fact.plannedAction)} | ${markdownCell(fact.reason)} |`);
  }
  lines.push(
    "",
    "## Safety boundary",
    "",
    "- DB writes: 0",
    "- Apply executed: NO",
    "- Matcher changed: NO",
    "- CM18 started: NO",
    "- Deploy/restart: NO",
    "",
    "STOP after ENGINEERING-DATA-ED2A.",
    "",
  );
  return lines.join("\n");
}

export function renderEngineeringDataImportPreviewJson(preview: EngineeringDataImportPreview): string {
  return prettyDeterministicJson(preview);
}

const OUTPUT_FILES = [
  "engineering-data-import-preview.csv",
  "engineering-data-import-preview.json",
  "ENGINEERING-DATA-IMPORT-PREVIEW.md",
] as const;

async function restorePreviousOutputs(
  outputDirectory: string,
  stageDirectory: string,
  previous: ReadonlyMap<string, string | null>,
): Promise<void> {
  for (const name of OUTPUT_FILES) {
    if (!previous.has(name)) continue;
    const target = join(outputDirectory, name);
    await rm(target, { force: true });
    const backup = previous.get(name);
    if (backup != null && existsSync(backup)) await rename(backup, target);
  }
  await rm(stageDirectory, { recursive: true, force: true });
}

export async function inspectEngineeringDataImport(
  options: InspectEngineeringDataImportOptions,
): Promise<EngineeringDataImportPreview> {
  const baselineFiles = await readEngineeringDataImportFileBundleHashes(options.databasePath);
  const [inputBytes, auditBytes] = await Promise.all([readFile(options.inputPath), readFile(options.auditPath)]);
  const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const auditSha256 = createHash("sha256").update(auditBytes).digest("hex");
  const facts = parseEngineeringDataImportCsv(inputBytes.toString("utf8"));
  const auditRows = parseEngineeringDataResearchAuditCsv(auditBytes.toString("utf8"));
  const dbBaseline = readEngineeringDataImportBaseline(options.databasePath, facts);
  const [afterInput, afterAudit, afterRead] = await Promise.all([
    sha256File(options.inputPath),
    sha256File(options.auditPath),
    readEngineeringDataImportFileBundleHashes(options.databasePath),
  ]);
  if (afterInput !== inputSha256 || afterAudit !== auditSha256) {
    throw new Error("Input or supporting audit changed during the coherent read-only preview baseline");
  }
  if (!sameEngineeringDataImportFileBundle(baselineFiles, afterRead)) {
    throw new Error("Database/WAL/SHM changed during the coherent read-only preview baseline");
  }
  return buildEngineeringDataImportPreview({
    facts,
    auditRows,
    inputSha256,
    auditSha256,
    databaseSha256: baselineFiles.databaseSha256,
    databaseWalSha256: baselineFiles.databaseWalSha256,
    databaseShmSha256: baselineFiles.databaseShmSha256,
    baseline: dbBaseline,
  });
}

export async function previewEngineeringDataImport(
  options: PreviewEngineeringDataImportOptions,
): Promise<EngineeringDataImportPreview> {
  const preview = await inspectEngineeringDataImport(options);
  const baselineFiles: EngineeringDataImportFileBundleHashes = {
    databaseSha256: preview.baseline.databaseSha256,
    databaseWalSha256: preview.baseline.databaseWalSha256,
    databaseShmSha256: preview.baseline.databaseShmSha256,
  };
  const inputSha256 = preview.baseline.inputSha256;
  const auditSha256 = preview.baseline.auditSha256;
  const artifacts: Readonly<Record<(typeof OUTPUT_FILES)[number], string>> = {
    "engineering-data-import-preview.csv": renderEngineeringDataImportPreviewCsv(preview),
    "engineering-data-import-preview.json": renderEngineeringDataImportPreviewJson(preview),
    "ENGINEERING-DATA-IMPORT-PREVIEW.md": renderEngineeringDataImportPreviewMarkdown(preview),
  };

  const stageDirectory = join(dirname(options.outputDirectory), `.${basename(options.outputDirectory)}-stage-${process.pid}`);
  const previous = new Map<string, string | null>();
  await rm(stageDirectory, { recursive: true, force: true });
  await mkdir(stageDirectory, { recursive: true });
  try {
    for (const name of OUTPUT_FILES) await writeFile(join(stageDirectory, name), artifacts[name], "utf8");
    const [afterInput, afterAudit, afterGeneration] = await Promise.all([
      sha256File(options.inputPath),
      sha256File(options.auditPath),
      readEngineeringDataImportFileBundleHashes(options.databasePath),
    ]);
    if (afterInput !== inputSha256 || afterAudit !== auditSha256) {
      throw new Error("Input or supporting audit changed while preview artifacts were generated");
    }
    if (!sameEngineeringDataImportFileBundle(baselineFiles, afterGeneration)) {
      throw new Error("Database/WAL/SHM changed while preview artifacts were generated");
    }

    await mkdir(options.outputDirectory, { recursive: true });
    for (const name of OUTPUT_FILES) {
      const target = join(options.outputDirectory, name);
      const backup = join(stageDirectory, `.previous-${name}`);
      if (existsSync(target)) {
        await rename(target, backup);
        previous.set(name, backup);
      } else {
        previous.set(name, null);
      }
      await rename(join(stageDirectory, name), target);
    }
    const finalDatabase = await readEngineeringDataImportFileBundleHashes(options.databasePath);
    if (!sameEngineeringDataImportFileBundle(baselineFiles, finalDatabase)) {
      throw new Error("Database/WAL/SHM changed before preview publication completed; prior outputs will be restored");
    }
    return preview;
  } catch (error) {
    const published = OUTPUT_FILES.some((name) => previous.has(name));
    if (published) await restorePreviousOutputs(options.outputDirectory, stageDirectory, previous);
    throw error;
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}

function repositoryRoot(): string {
  return resolve(fileURLToPath(new URL("../../../", import.meta.url)));
}

function parseCliInput(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--input" || !argv[1]) {
    throw new Error("Usage: npm run preview:engineering-data-import -w server -- --input <csv>");
  }
  return resolve(argv[1]);
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const inputPath = parseCliInput(process.argv.slice(2));
  const preview = await previewEngineeringDataImport({
    databasePath: join(root, "data", "electro.db"),
    inputPath,
    auditPath: join(dirname(inputPath), "engineering_data_research_audit.csv"),
    outputDirectory: join(root, "reports", "engineering-data", "import-preview"),
  });
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    mode: preview.mode,
    databaseSha256: preview.baseline.databaseSha256,
    inputSha256: preview.baseline.inputSha256,
    previewFingerprint: preview.previewFingerprint,
    summary: preview.summary,
    outputDirectory: join(root, "reports", "engineering-data", "import-preview"),
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
