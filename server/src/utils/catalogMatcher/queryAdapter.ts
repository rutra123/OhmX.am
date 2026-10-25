/**
 * CM4 read-only SQLite query adapter.
 * Loads CatalogCandidateFacts for the frozen CM3 evaluator.
 * Does not decide eligibility. Does not import the application write-capable db.
 */
import Database from 'better-sqlite3';
import type {
  CanonicalConditionKey,
  CanonicalEquipmentType,
  CanonicalParameterCode,
  CanonicalSourceType,
  CatalogCandidateFacts,
  CatalogCompatibilityFact,
  CatalogConditionSetFacts,
  CatalogMatchRequest,
  CatalogSourceFacts,
  CatalogValueFacts,
  CompatibilityRelationType,
  CompatibilityState,
  CommercialAvailability,
  RequirementLevel,
  StockStatus,
  ValueStatus,
  ValueType,
  VerificationTier,
} from './types.js';

const WRITE_SQL =
  /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|VACUUM|MERGE|TRUNCATE|ATTACH|DETACH)\b/i;
const WRITE_PRAGMA =
  /^\s*PRAGMA\s+(writable_schema|journal_mode|wal_checkpoint)\b/i;

export class MatcherWriteError extends Error {
  constructor(sql: string) {
    super(`Catalog matcher adapter refused non-SELECT SQL: ${sql.trim().slice(0, 120)}`);
    this.name = 'MatcherWriteError';
  }
}

export interface MatcherDatabase {
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
}

export interface CatalogAdapterLoadStats {
  candidates: CatalogCandidateFacts[];
  queryCount: number;
  queryNames: string[];
}

const RELATION_MAP: Record<string, CompatibilityRelationType> = {
  required: 'REQUIRED_ACCESSORY',
  recommended: 'RECOMMENDED_ACCESSORY',
  optional: 'OPTIONAL_ACCESSORY',
  alternative: 'ALTERNATIVE_TO',
  incompatible: 'INCOMPATIBLE_WITH',
};

export function assertMatcherSqlIsReadOnly(sql: string): void {
  const trimmed = sql.trim();
  if (WRITE_SQL.test(trimmed) || WRITE_PRAGMA.test(trimmed)) {
    throw new MatcherWriteError(trimmed);
  }
}

function wrapReadOnly(db: Database.Database): Database.Database {
  const prepare = db.prepare.bind(db);
  const exec = db.exec.bind(db);
  db.prepare = ((sql: string) => {
    assertMatcherSqlIsReadOnly(sql);
    return prepare(sql);
  }) as typeof db.prepare;
  db.exec = ((sql: string) => {
    assertMatcherSqlIsReadOnly(sql);
    return exec(sql);
  }) as typeof db.exec;
  return db;
}

export function openCatalogMatcherDatabase(filePath: string): Database.Database {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.pragma('foreign_keys = ON');
  return wrapReadOnly(db);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

function asBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  return Number(value) !== 0;
}

function sourceKey(row: {
  source_type: string | null;
  manufacturer: string | null;
  document_title: string | null;
  document_version: string | null;
  url: string | null;
}): string | null {
  if (!row.source_type) return null;
  return [
    row.source_type,
    row.manufacturer ?? '',
    row.document_title ?? '',
    row.document_version ?? '∅',
    row.url ?? '',
  ].join('|');
}

function mapCommerce(row: {
  price_amd: number | null;
  currency: string | null;
  availability_status: string | null;
  is_active: number | null;
}): CatalogCandidateFacts['commerce'] {
  const stockStatus: StockStatus = 'UNKNOWN';
  let commercialAvailability: CommercialAvailability = 'UNKNOWN';
  if (row.is_active === 0) commercialAvailability = 'UNAVAILABLE';
  const price =
    row.price_amd == null ? null : { amount: Number(row.price_amd), currency: row.currency || 'AMD' };
  return { stockStatus, price, commercialAvailability };
}

function mapRelation(raw: string): { relationType: CompatibilityRelationType; stateHint: CompatibilityState | null } {
  const relationType = RELATION_MAP[raw] ?? 'COMPATIBLE_WITH';
  return {
    relationType,
    stateHint: relationType === 'INCOMPATIBLE_WITH' ? 'INCOMPATIBLE' : null,
  };
}

const QUERY_PROFILES = `
SELECT
  p.product_id,
  pr.sku,
  pr.name_ru AS title,
  b.name AS brand,
  p.equipment_type,
  p.series,
  p.model,
  p.identity_status,
  p.data_completeness,
  p.source_verification,
  p.schema_id,
  p.schema_version,
  pr.price_amd,
  pr.currency,
  pr.availability_status,
  pr.is_active
FROM engineering_product_profile p
JOIN products pr ON pr.id = p.product_id
LEFT JOIN brands b ON b.id = pr.brand_id
WHERE p.equipment_type = ?
ORDER BY p.product_id ASC
`;

function queryValuesSql(idCount: number): string {
  const ph = placeholders(idCount);
  return `
SELECT
  v.product_id,
  ep.code AS parameter_code,
  ep.requirement_level,
  ep.value_type,
  ep.canonical_unit,
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
  st.verification_tier
FROM engineering_value v
JOIN engineering_parameter ep ON ep.parameter_id = v.parameter_id
LEFT JOIN engineering_condition_set cs ON cs.condition_set_id = v.condition_set_id
LEFT JOIN engineering_source s ON s.source_id = v.source_id
LEFT JOIN engineering_source_type st ON st.source_type = s.source_type
WHERE v.product_id IN (${ph})
ORDER BY v.product_id ASC, ep.code ASC, IFNULL(cs.code, '') ASC, IFNULL(s.source_id, 0) ASC
`;
}

function queryConditionsSql(idCount: number): string {
  const ph = placeholders(idCount);
  return `
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
  SELECT DISTINCT condition_set_id
  FROM engineering_value
  WHERE product_id IN (${ph})
    AND condition_set_id IS NOT NULL
)
ORDER BY cs.code ASC, ce.condition_key ASC
`;
}

function queryRelationshipsSql(idCount: number): string {
  const ph = placeholders(idCount);
  return `
SELECT source_product_id, target_product_id, relation_type
FROM product_relationships
WHERE source_product_id IN (${ph}) OR target_product_id IN (${ph})
ORDER BY source_product_id ASC, target_product_id ASC, relation_type ASC
`;
}

export function loadCatalogCandidatesWithStats(
  db: MatcherDatabase,
  request: CatalogMatchRequest,
): CatalogAdapterLoadStats {
  const queryNames: string[] = [];
  const run = (name: string, sql: string, params: unknown[]) => {
    assertMatcherSqlIsReadOnly(sql);
    queryNames.push(name);
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  };

  const profileRows = run('profiles', QUERY_PROFILES, [request.equipmentType]);
  if (profileRows.length === 0) {
    return { candidates: [], queryCount: queryNames.length, queryNames };
  }

  const ids = profileRows.map((row) => Number(row.product_id));
  const valueRows = run('values', queryValuesSql(ids.length), ids);
  const conditionRows = run('conditions', queryConditionsSql(ids.length), ids);

  let relationRows: Array<Record<string, unknown>> = [];
  try {
    relationRows = run('relationships', queryRelationshipsSql(ids.length), [...ids, ...ids]);
  } catch {
    relationRows = [];
  }

  const valuesByProduct = new Map<number, CatalogValueFacts[]>();
  const sourcesByProduct = new Map<number, Map<string, CatalogSourceFacts>>();
  const conditionSetCodesByProduct = new Map<number, Set<string>>();

  for (const row of valueRows) {
    const productId = Number(row.product_id);
    const key = sourceKey({
      source_type: (row.source_type as string | null) ?? null,
      manufacturer: (row.manufacturer as string | null) ?? null,
      document_title: (row.document_title as string | null) ?? null,
      document_version: (row.document_version as string | null) ?? null,
      url: (row.url as string | null) ?? null,
    });
    const fact: CatalogValueFacts = {
      parameterCode: row.parameter_code as CanonicalParameterCode,
      requirementLevel: row.requirement_level as RequirementLevel,
      valueType: row.value_type as ValueType,
      numeric: row.value_numeric == null ? null : Number(row.value_numeric),
      text: (row.value_text as string | null) ?? null,
      boolean: asBoolean(row.value_boolean),
      unit: (row.unit as string | null) ?? null,
      canonicalUnit: (row.canonical_unit as string | null) ?? null,
      status: (row.value_status as ValueStatus) ?? 'KNOWN',
      confidence: row.confidence == null ? null : Number(row.confidence),
      conditionSetCode: (row.condition_set_code as string | null) ?? null,
      sourceKey: key,
      sourceType: (row.source_type as CanonicalSourceType | null) ?? null,
      verificationTier: (row.verification_tier as VerificationTier | null) ?? null,
    };
    const list = valuesByProduct.get(productId) ?? [];
    list.push(fact);
    valuesByProduct.set(productId, list);

    if (key && row.source_type) {
      const map = sourcesByProduct.get(productId) ?? new Map<string, CatalogSourceFacts>();
      if (!map.has(key)) {
        map.set(key, {
          sourceKey: key,
          sourceType: row.source_type as CanonicalSourceType,
          verificationTier: (row.verification_tier as VerificationTier) ?? 'UNVERIFIED',
          manufacturer: (row.manufacturer as string | null) ?? null,
          documentTitle: (row.document_title as string | null) ?? null,
          documentVersion: (row.document_version as string | null) ?? null,
          url: (row.url as string | null) ?? null,
        });
      }
      sourcesByProduct.set(productId, map);
    }
    if (row.condition_set_code) {
      const set = conditionSetCodesByProduct.get(productId) ?? new Set<string>();
      set.add(String(row.condition_set_code));
      conditionSetCodesByProduct.set(productId, set);
    }
  }

  const conditionSets = new Map<string, CatalogConditionSetFacts>();
  for (const row of conditionRows) {
    const code = String(row.condition_set_code);
    const current = conditionSets.get(code) ?? { conditionSetCode: code, entries: [] };
    current.entries.push({
      conditionKey: row.condition_key as CanonicalConditionKey,
      valueType: row.value_type as ValueType,
      numeric: row.value_numeric == null ? null : Number(row.value_numeric),
      text: (row.value_text as string | null) ?? null,
      boolean: asBoolean(row.value_boolean),
      unit: (row.canonical_unit as string | null) ?? (null as string | null),
    });
    conditionSets.set(code, current);
  }

  const relationsByProduct = new Map<number, CatalogCompatibilityFact[]>();
  for (const row of relationRows) {
    const sourceId = Number(row.source_product_id);
    const mapped = mapRelation(String(row.relation_type));
    const fact: CatalogCompatibilityFact = {
      relationType: mapped.relationType,
      targetProductId: Number(row.target_product_id),
      targetEquipmentType: null,
      stateHint: mapped.stateHint,
    };
    const list = relationsByProduct.get(sourceId) ?? [];
    list.push(fact);
    relationsByProduct.set(sourceId, list);
  }

  const candidates: CatalogCandidateFacts[] = profileRows.map((row) => {
    const productId = Number(row.product_id);
    const usedSetCodes = conditionSetCodesByProduct.get(productId) ?? new Set<string>();
    const sets = Array.from(usedSetCodes)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((code) => conditionSets.get(code) ?? { conditionSetCode: code, entries: [] });
    const sources = Array.from(sourcesByProduct.get(productId)?.values() ?? []).sort((a, b) =>
      a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
    );
    return {
      product: {
        productId,
        sku: String(row.sku),
        equipmentType: row.equipment_type as CanonicalEquipmentType,
        title: (row.title as string | null) ?? null,
        brand: (row.brand as string | null) ?? null,
      },
      profile: {
        productId,
        equipmentType: row.equipment_type as CanonicalEquipmentType,
        series: (row.series as string | null) ?? null,
        model: (row.model as string | null) ?? null,
        identityStatus: row.identity_status as CatalogCandidateFacts['profile']['identityStatus'],
        dataCompleteness: row.data_completeness as CatalogCandidateFacts['profile']['dataCompleteness'],
        sourceVerification: row.source_verification as CatalogCandidateFacts['profile']['sourceVerification'],
        schemaId: String(row.schema_id ?? 'ohmx.engineering-product.v1'),
        schemaVersion: String(row.schema_version ?? '1.0.0'),
      },
      values: valuesByProduct.get(productId) ?? [],
      sources,
      conditionSets: sets,
      compatibilityFacts: relationsByProduct.get(productId) ?? [],
      commerce: mapCommerce({
        price_amd: row.price_amd as number | null,
        currency: row.currency as string | null,
        availability_status: row.availability_status as string | null,
        is_active: row.is_active as number | null,
      }),
    };
  });

  return { candidates, queryCount: queryNames.length, queryNames };
}

export function loadCatalogCandidates(
  db: MatcherDatabase,
  request: CatalogMatchRequest,
): CatalogCandidateFacts[] {
  return loadCatalogCandidatesWithStats(db, request).candidates;
}
