/**
 * ENGINEERING-CATALOG-CM15 — engineering-only semantic projection (READ-ONLY).
 *
 * Reads the catalog SQLite schema (verified against the LIVE production DB,
 * 2026-09-10; schema owner: reports/engineering-catalog/
 * ENGINEERING-PRODUCT-DATA-SCHEMA-V1.sql + server/src/schema.sql for
 * products/product_relationships) and projects ONLY the CM8.1
 * matcher-relevant engineering state:
 *
 *   engineering_product_profile  (CM8.1 ENGINEERING_CANDIDATE_STATE_FIELDS)
 *   engineering_value + engineering_parameter definition columns
 *   engineering_condition_set + engineering_condition_entry + condition keys
 *   engineering_source (semantic tuple) + engineering_source_type (tier)
 *   product_relationships (technical relation tuples)
 *
 * Classification frozen in CM8.1 and RE-VERIFIED against current source in
 * CM15 (queryAdapter.ts): products.is_active = COMMERCE_ONLY;
 * products.stock_quantity = NOT_MATCHER_RELEVANT (unread);
 * products.availability_status = READ_BUT_IGNORED (selected, ignored);
 * CM4 stockStatus = 'UNKNOWN'. None of these columns is selected here.
 * products.name_ru (title), descriptions, brand name, price/currency are
 * equally excluded (no title-kW logic; §12/§20 of the phase).
 *
 * Determinism: every entity array is sorted in JS by its SEMANTIC identity
 * (never rowid, never query return order). Duplicate handling (phase §19):
 *   - two value rows identical in ALL projected fields -> one semantic fact;
 *   - two value rows with the same (product, parameter, condition-set,
 *     source-tuple) slot but differing content -> FAIL CLOSED
 *     (catalog_state_ambiguous_value_slot; CM8.1: reject ambiguous
 *     first-row-sensitive value slots);
 *   - source rows whose CM4 semantic tuples are identical are one fact
 *     (the matcher itself keys sources on exactly this tuple).
 *
 * Every SQL statement in this module is a SELECT. No INSERT / UPDATE /
 * DELETE / ALTER / DROP / CREATE / VACUUM / REINDEX / PRAGMA anywhere.
 */
import {
  ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
  ENGINEERING_CATALOG_STATE_DOMAIN,
  type ConditionEntryCanonicalFacts,
  type ConditionKeyCanonicalFacts,
  type ConditionSetCanonicalFacts,
  type EngineeringCatalogCanonicalFacts,
  type EngineeringCatalogStateDbHandle,
  type ProfileCanonicalFacts,
  type RelationshipCanonicalFacts,
  type SourceCanonicalFacts,
  type SourceTypeCanonicalFacts,
  type ValueCanonicalFacts,
} from "./types.js";
import {
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
} from "../buildingProjectConfiguratorAdapter/types.js";
import { canonicalizeFiniteNumber, compareCodePoints } from "./canonicalize.js";

/** Projection failure — carries a stable machine code, never a fabricated fact. */
export class EngineeringCatalogProjectionError extends Error {
  readonly code: string;
  readonly fieldPath: string;

  constructor(code: string, fieldPath: string, message?: string) {
    super(message ?? `engineering_catalog_state_projection: ${code} at ${fieldPath}`);
    this.name = "EngineeringCatalogProjectionError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

function fail(code: string, fieldPath: string, message?: string): never {
  throw new EngineeringCatalogProjectionError(code, fieldPath, message);
}

// ---------------------------------------------------------------------------
// Strict row-field mapping (null checked FIRST — never Number(null) -> 0)
// ---------------------------------------------------------------------------

function asText(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") fail("catalog_state_column_not_text", fieldPath);
  return value;
}

function asTextOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asNumberOrNull(value: unknown, fieldPath: string): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return canonicalizeFiniteNumber(n, fieldPath);
}

/** Identical semantics to the CM4 queryAdapter `asBoolean`. */
function asBooleanOrNull(value: unknown): boolean | null {
  if (value == null) return null;
  return Number(value) !== 0;
}

/** The exact CM4 `sourceKey` formula — the matcher's own source identity. */
function semanticSourceKey(row: {
  sourceType: string | null;
  manufacturer: string | null;
  documentTitle: string | null;
  documentVersion: string | null;
  url: string | null;
}): string | null {
  if (!row.sourceType) return null;
  return [
    row.sourceType,
    row.manufacturer ?? "",
    row.documentTitle ?? "",
    row.documentVersion ?? "∅",
    row.url ?? "",
  ].join("|");
}

// ---------------------------------------------------------------------------
// SQL projection (SELECT-only allowlist; scope from the frozen constant)
// ---------------------------------------------------------------------------

const SCOPE_PARAMS = ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES as unknown as string[];

const SQL_PROFILES = `
SELECT
  p.product_id,
  pr.sku,
  p.equipment_type,
  p.series,
  p.model,
  p.identity_status,
  p.data_completeness,
  p.source_verification,
  p.schema_id,
  p.schema_version
FROM engineering_product_profile p
JOIN products pr ON pr.id = p.product_id
WHERE p.equipment_type IN (?, ?)
`;

const SQL_VALUES = `
SELECT
  v.product_id,
  ep.code AS parameter_code,
  ep.requirement_level,
  ep.value_type AS parameter_value_type,
  ep.canonical_unit AS parameter_canonical_unit,
  v.value_numeric,
  v.value_text,
  v.value_boolean,
  v.unit,
  v.value_status,
  v.confidence,
  cs.code AS condition_set_code,
  s.source_type,
  s.manufacturer,
  s.document_title,
  s.document_version,
  s.url,
  st.verification_tier,
  v.source_id,
  v.condition_set_id
FROM engineering_value v
JOIN engineering_parameter ep ON ep.parameter_id = v.parameter_id
LEFT JOIN engineering_condition_set cs ON cs.condition_set_id = v.condition_set_id
LEFT JOIN engineering_source s ON s.source_id = v.source_id
LEFT JOIN engineering_source_type st ON st.source_type = s.source_type
WHERE v.product_id IN (
  SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
)
`;

const SQL_CONDITION_SETS = `
SELECT
  cs.code AS condition_set_code,
  ce.condition_key,
  ck.value_type,
  ck.unit AS canonical_unit,
  ce.value_numeric,
  ce.value_text,
  ce.value_boolean
FROM engineering_condition_set cs
JOIN engineering_condition_entry ce ON ce.condition_set_id = cs.condition_set_id
JOIN engineering_condition_key ck ON ck.condition_key = ce.condition_key
WHERE cs.condition_set_id IN (
  SELECT DISTINCT v.condition_set_id
  FROM engineering_value v
  WHERE v.condition_set_id IS NOT NULL
    AND v.product_id IN (
      SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
    )
)
`;

const SQL_CONDITION_KEYS = `
SELECT
  ck.condition_key,
  ck.value_type,
  ck.unit
FROM engineering_condition_key ck
`;

const SQL_SOURCES = `
SELECT
  s.source_type,
  s.manufacturer,
  s.document_title,
  s.document_version,
  s.url,
  st.verification_tier
FROM engineering_source s
JOIN engineering_source_type st ON st.source_type = s.source_type
WHERE s.source_id IN (
  SELECT DISTINCT v.source_id
  FROM engineering_value v
  WHERE v.source_id IS NOT NULL
    AND v.product_id IN (
      SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
    )
)
`;

const SQL_SOURCE_TYPES = `
SELECT DISTINCT
  st.source_type,
  st.verification_tier
FROM engineering_source_type st
JOIN engineering_source s ON s.source_type = st.source_type
WHERE s.source_id IN (
  SELECT DISTINCT v.source_id
  FROM engineering_value v
  WHERE v.source_id IS NOT NULL
    AND v.product_id IN (
      SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
    )
)
`;

const SQL_RELATIONSHIPS = `
SELECT
  r.source_product_id,
  r.target_product_id,
  r.relation_type
FROM product_relationships r
WHERE r.source_product_id IN (
    SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
  )
  OR r.target_product_id IN (
    SELECT product_id FROM engineering_product_profile WHERE equipment_type IN (?, ?)
  )
`;

interface RawRow {
  [column: string]: unknown;
}

function queryAll(db: EngineeringCatalogStateDbHandle, sql: string, params: readonly unknown[], name: string): RawRow[] {
  let rows: unknown[];
  try {
    rows = db.prepare(sql).all(...params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail("catalog_state_projection_query_failed", name, message);
  }
  if (!Array.isArray(rows)) fail("catalog_state_projection_query_failed", name);
  return rows as RawRow[];
}

// ---------------------------------------------------------------------------
// Deterministic ordering helpers (semantic identity, never rowid)
// ---------------------------------------------------------------------------

function compareNullableText(a: string | null, b: string | null): number {
  const ra = a == null ? 0 : 1;
  const rb = b == null ? 0 : 1;
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  return compareCodePoints(a as string, b as string);
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

// ---------------------------------------------------------------------------
// Entity mapping + sorting
// ---------------------------------------------------------------------------

function mapProfiles(rows: RawRow[]): ProfileCanonicalFacts[] {
  const out = rows.map((row, i) => ({
    productId: asNumberOrNull(row.product_id, `profiles[${i}].productId`) as number,
    sku: asText(row.sku, `profiles[${i}].sku`),
    equipmentType: asText(row.equipment_type, `profiles[${i}].equipmentType`),
    series: asTextOrNull(row.series),
    model: asTextOrNull(row.model),
    identityStatus: asText(row.identity_status, `profiles[${i}].identityStatus`),
    dataCompleteness: asText(row.data_completeness, `profiles[${i}].dataCompleteness`),
    sourceVerification: asText(row.source_verification, `profiles[${i}].sourceVerification`),
    schemaId: asText(row.schema_id, `profiles[${i}].schemaId`),
    schemaVersion: asText(row.schema_version, `profiles[${i}].schemaVersion`),
  }));
  out.sort((a, b) => compareNumber(a.productId, b.productId));
  return out;
}

interface MappedValue {
  fact: ValueCanonicalFacts;
  slotKey: string;
  contentKey: string;
  sortKey: {
    productId: number;
    parameterCode: string;
    conditionRank: number;
    conditionSetCode: string | null;
    sourceTuple: string | null;
  };
}

function mapValues(rows: RawRow[]): ValueCanonicalFacts[] {
  const mapped: MappedValue[] = [];
  const seenSlots = new Map<string, string>();

  rows.forEach((row, i) => {
    const productId = asNumberOrNull(row.product_id, `values[${i}].productId`) as number;
    const parameterCode = asText(row.parameter_code, `values[${i}].parameterCode`);
    const conditionSetCode = asTextOrNull(row.condition_set_code);
    const sourceType = asTextOrNull(row.source_type);
    const sourceTuple = semanticSourceKey({
      sourceType,
      manufacturer: asTextOrNull(row.manufacturer),
      documentTitle: asTextOrNull(row.document_title),
      documentVersion: asTextOrNull(row.document_version),
      url: asTextOrNull(row.url),
    });

    // Coherent-read gate: a value that LINKS a source/condition set must see
    // that linked row in the same snapshot. (FKs make this unreachable on a
    // healthy DB; a violation means an inconsistent read -> fail closed.)
    if (row.source_id != null && sourceTuple == null) {
      fail("catalog_state_inconsistent_source_link", `values[${i}].source_id`);
    }
    if (row.condition_set_id != null && conditionSetCode == null) {
      fail("catalog_state_missing_condition_set", `values[${i}].condition_set_id`);
    }

    const fact: ValueCanonicalFacts = {
      productId,
      parameterCode,
      parameterRequirementLevel: asText(row.requirement_level, `values[${i}].parameterRequirementLevel`),
      parameterValueType: asText(row.parameter_value_type, `values[${i}].parameterValueType`),
      parameterCanonicalUnit: asTextOrNull(row.parameter_canonical_unit),
      numeric: asNumberOrNull(row.value_numeric, `values[${i}].numeric`),
      text: asTextOrNull(row.value_text),
      boolean: asBooleanOrNull(row.value_boolean),
      unit: asTextOrNull(row.unit),
      valueStatus: asText(row.value_status, `values[${i}].valueStatus`),
      confidence: asNumberOrNull(row.confidence, `values[${i}].confidence`),
      conditionSetCode,
      sourceType,
      sourceManufacturer: asTextOrNull(row.manufacturer),
      sourceDocumentTitle: asTextOrNull(row.document_title),
      sourceDocumentVersion: asTextOrNull(row.document_version),
      sourceUrl: asTextOrNull(row.url),
      verificationTier: asTextOrNull(row.verification_tier),
    };

    // Duplicate policy (phase §19): identical full rows are one semantic fact;
    // same slot with differing content is an ambiguous value slot -> fail.
    const slotKey = JSON.stringify([productId, parameterCode, conditionSetCode, sourceTuple]);
    const contentKey = JSON.stringify(fact);
    const previous = seenSlots.get(slotKey);
    if (previous === undefined) {
      seenSlots.set(slotKey, contentKey);
    } else if (previous !== contentKey) {
      fail(
        "catalog_state_ambiguous_value_slot",
        `values[${i}]`,
        `ambiguous engineering_value slot for product ${productId}, parameter ${parameterCode}`,
      );
    } else {
      return; // fully identical duplicate row -> one semantic fact
    }

    mapped.push({
      fact,
      slotKey,
      contentKey,
      sortKey: {
        productId,
        parameterCode,
        conditionRank: conditionSetCode == null ? 0 : 1,
        conditionSetCode,
        sourceTuple,
      },
    });
  });

  mapped.sort((a, b) => {
    const ka = a.sortKey;
    const kb = b.sortKey;
    if (ka.productId !== kb.productId) return compareNumber(ka.productId, kb.productId);
    const byParameter = compareCodePoints(ka.parameterCode, kb.parameterCode);
    if (byParameter !== 0) return byParameter;
    if (ka.conditionRank !== kb.conditionRank) return ka.conditionRank - kb.conditionRank;
    const byCondition = compareNullableText(ka.conditionSetCode, kb.conditionSetCode);
    if (byCondition !== 0) return byCondition;
    return compareNullableText(ka.sourceTuple, kb.sourceTuple);
  });
  return mapped.map((entry) => entry.fact);
}

function mapConditionSets(rows: RawRow[]): ConditionSetCanonicalFacts[] {
  const byCode = new Map<string, ConditionSetCanonicalFacts>();
  rows.forEach((row, i) => {
    const code = asText(row.condition_set_code, `conditionSets[${i}].conditionSetCode`);
    const entry: ConditionEntryCanonicalFacts = {
      conditionKey: asText(row.condition_key, `conditionSets[${i}].conditionKey`),
      valueType: asText(row.value_type, `conditionSets[${i}].valueType`),
      canonicalUnit: asTextOrNull(row.canonical_unit),
      numeric: asNumberOrNull(row.value_numeric, `conditionSets[${i}].numeric`),
      text: asTextOrNull(row.value_text),
      boolean: asBooleanOrNull(row.value_boolean),
    };
    const current = byCode.get(code) ?? { conditionSetCode: code, entries: [] };
    current.entries.push(entry);
    byCode.set(code, current);
  });
  const out = Array.from(byCode.values());
  out.sort((a, b) => compareCodePoints(a.conditionSetCode, b.conditionSetCode));
  for (const set of out) {
    set.entries.sort((a, b) => compareCodePoints(a.conditionKey, b.conditionKey));
    // UNIQUE(condition_set_id, condition_key) guarantees no entry duplicates.
  }
  return out;
}

function mapConditionKeys(rows: RawRow[]): ConditionKeyCanonicalFacts[] {
  const out = rows.map((row, i) => ({
    conditionKey: asText(row.condition_key, `conditionKeys[${i}].conditionKey`),
    valueType: asText(row.value_type, `conditionKeys[${i}].valueType`),
    canonicalUnit: asTextOrNull(row.unit),
  }));
  out.sort((a, b) => compareCodePoints(a.conditionKey, b.conditionKey));
  return out;
}

function mapSources(rows: RawRow[]): SourceCanonicalFacts[] {
  const seen = new Map<string, SourceCanonicalFacts>();
  rows.forEach((row, i) => {
    const sourceType = asText(row.source_type, `sources[${i}].sourceType`);
    const fact: SourceCanonicalFacts = {
      sourceType,
      manufacturer: asTextOrNull(row.manufacturer),
      documentTitle: asTextOrNull(row.document_title),
      documentVersion: asTextOrNull(row.document_version),
      url: asTextOrNull(row.url),
      verificationTier: asText(row.verification_tier, `sources[${i}].verificationTier`),
    };
    const tuple = semanticSourceKey({
      sourceType: fact.sourceType,
      manufacturer: fact.manufacturer,
      documentTitle: fact.documentTitle,
      documentVersion: fact.documentVersion,
      url: fact.url,
    });
    if (tuple != null && !seen.has(tuple)) seen.set(tuple, fact);
  });
  const out = Array.from(seen.values());
  out.sort((a, b) =>
    compareCodePoints(
      semanticSourceKey({
        sourceType: a.sourceType,
        manufacturer: a.manufacturer,
        documentTitle: a.documentTitle,
        documentVersion: a.documentVersion,
        url: a.url,
      }) ?? "",
      semanticSourceKey({
        sourceType: b.sourceType,
        manufacturer: b.manufacturer,
        documentTitle: b.documentTitle,
        documentVersion: b.documentVersion,
        url: b.url,
      }) ?? "",
    ),
  );
  return out;
}

function mapSourceTypes(rows: RawRow[]): SourceTypeCanonicalFacts[] {
  const out = rows.map((row, i) => ({
    sourceType: asText(row.source_type, `sourceTypes[${i}].sourceType`),
    verificationTier: asText(row.verification_tier, `sourceTypes[${i}].verificationTier`),
  }));
  out.sort((a, b) => compareCodePoints(a.sourceType, b.sourceType));
  return out;
}

function mapRelationships(rows: RawRow[]): RelationshipCanonicalFacts[] {
  const out = rows.map((row, i) => ({
    sourceProductId: asNumberOrNull(row.source_product_id, `relationships[${i}].sourceProductId`) as number,
    targetProductId: asNumberOrNull(row.target_product_id, `relationships[${i}].targetProductId`) as number,
    relationType: asText(row.relation_type, `relationships[${i}].relationType`),
  }));
  out.sort((a, b) => {
    if (a.sourceProductId !== b.sourceProductId) return compareNumber(a.sourceProductId, b.sourceProductId);
    if (a.targetProductId !== b.targetProductId) return compareNumber(a.targetProductId, b.targetProductId);
    return compareCodePoints(a.relationType, b.relationType);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Projection entry point
// ---------------------------------------------------------------------------

/**
 * Read the engineering catalog state for the frozen scope and return the
 * canonical semantic facts ready for canonical JSON + SHA-256.
 *
 * The caller is responsible for the coherent-read envelope (BEGIN DEFERRED ..
 * COMMIT around ALL queries in this function — see provider.ts); every query
 * here is a plain SELECT.
 */
export function projectEngineeringCatalogFacts(
  db: EngineeringCatalogStateDbHandle,
): EngineeringCatalogCanonicalFacts {
  const profiles = mapProfiles(queryAll(db, SQL_PROFILES, SCOPE_PARAMS, "profiles"));
  const values = mapValues(queryAll(db, SQL_VALUES, SCOPE_PARAMS, "values"));
  const conditionSets = mapConditionSets(queryAll(db, SQL_CONDITION_SETS, SCOPE_PARAMS, "conditionSets"));
  const conditionKeys = mapConditionKeys(queryAll(db, SQL_CONDITION_KEYS, [], "conditionKeys"));
  const sources = mapSources(queryAll(db, SQL_SOURCES, SCOPE_PARAMS, "sources"));
  const sourceTypes = mapSourceTypes(queryAll(db, SQL_SOURCE_TYPES, SCOPE_PARAMS, "sourceTypes"));
  const relationships = mapRelationships(
    queryAll(db, SQL_RELATIONSHIPS, [...SCOPE_PARAMS, ...SCOPE_PARAMS], "relationships"),
  );

  return {
    domain: ENGINEERING_CATALOG_STATE_DOMAIN,
    algorithmVersion: ENGINEERING_CATALOG_ALGORITHM_VERSION,
    projectionVersion: ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
    scopeEquipmentTypes: ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
    profiles,
    values,
    conditionSets,
    conditionKeys,
    sourceTypes,
    sources,
    relationships,
  };
}
