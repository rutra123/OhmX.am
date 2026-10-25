/**
 * ENGINEERING-CATALOG-CM15 — Engineering Catalog State Provider types.
 *
 * IMPLEMENTATION of CM12 §18 (EngineeringCatalogStateProvider), producing the
 * frozen `engineering-catalog-state:sha256:<64 lowercase hex>` revision from
 * the CM8.1 engineering-only semantic catalog projection.
 *
 * Purity contract (CM15 phase):
 *   - read-only SQLite access only (SELECT); no INSERT/UPDATE/DELETE/ALTER/
 *     DROP/CREATE/VACUUM/REINDEX on any database;
 *   - NO Adapter / Configurator / Matcher invocation, no client, no routes;
 *   - revision is semantic-engineering identity only: no DB file hash, no
 *     mtime, no PRAGMA data_version, no rowid/insertion chronology, no clock,
 *     no randomness, no salt, no timestamp.
 *
 * This module imports ONLY the frozen CM11 adapter contract vocabulary
 * (types + frozen constants from buildingProjectConfiguratorAdapter/types.ts,
 * the same frozen module CM12's contract reuses). It does not import and does
 * not modify: catalogMatcher/*, engineeringConfigurator runtime modules,
 * buildingProjectConfiguratorAdapter/buildEngineeringConfiguratorInput.ts,
 * buildingProjectLoadRevision.ts, client code, or routes.
 *
 * Frozen algorithm identity (CM10 §10 / CM11 types.ts — reused verbatim):
 *   prefix          engineering-catalog-state:sha256:
 *   algorithm       ohmx.engineering-catalog-state-canonical-json.v1
 *   scope           ["FAN_COIL", "HEAT_PUMP"]
 *   reference shape EngineeringCatalogStateReference (AVAILABLE / UNAVAILABLE)
 *
 * The CM15 projection layer adds exactly ONE new identity literal of its own
 * (the projection schema version below). It does NOT introduce a competing
 * revision format, prefix, or hash algorithm.
 */
import type {
  DeepReadonly,
  EngineeringCatalogStateReference,
  // Type-position import of the frozen constant so `typeof` queries below
  // resolve against the single frozen definition (never redeclared here).
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
} from "../buildingProjectConfiguratorAdapter/types.js";

// ---------------------------------------------------------------------------
// Frozen constants re-used verbatim from the CM11 adapter contract module.
// (Imported, not redeclared, so there is exactly one source of truth.)
// ---------------------------------------------------------------------------
export {
  ENGINEERING_CATALOG_PREFIX,
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
} from "../buildingProjectConfiguratorAdapter/types.js";

/**
 * CM15 projection schema identity. Versioned independently from the frozen
 * hash algorithm: a projection field-set change bumps THIS literal (and must
 * be accompanied by contract tests), not the frozen algorithm id.
 */
export const ENGINEERING_CATALOG_STATE_PROJECTION_VERSION =
  "ohmx.engineering-catalog-state-projection.v1.1" as const;

/**
 * Branded revision token — structurally identical mirror of the frozen
 * `EngineeringCatalogStateRevision` template-literal type (declared in
 * engineeringConfigurator/types.ts and consumed by the frozen CM11 adapter
 * reference shape). Declared LOCALLY because this module must not import
 * engineeringConfigurator modules (CM15 invariant: import allowlist is
 * closed); template-literal types with the same structure are mutually
 * assignable, so the mirror is type-safe with zero runtime footprint.
 */
export type EngineeringCatalogStateRevision =
  `engineering-catalog-state:sha256:${string}`;

/** Canonical facts domain marker (CM14 used "building-project-configurator-load"). */
export const ENGINEERING_CATALOG_STATE_DOMAIN = "ohmx.engineering-catalog-state" as const;

// ---------------------------------------------------------------------------
// Canonical engineering facts (exact CM8.1 engineering allowlist projection).
//
// Every field below is MATCHER_RELEVANT_ENGINEERING: it is either consumed by
// the CM3 evaluator / CM4 queryAdapter / CM5 service for technical candidate
// identity, engineering parameter values, operating-condition matching,
// verification/provenance eligibility, technical relationships, or it belongs
// to the CM8.1-frozen ENGINEERING_CANDIDATE_STATE_FIELDS list.
//
// Deliberately ABSENT (CM8.1 COMMERCE_ONLY / NOT_MATCHER_RELEVANT, verified
// unchanged against current source in CM15):
//   products.price_amd, products.currency, products.stock_quantity,
//   products.availability_status, products.is_active, products.name_ru
//   (title), products.description_ru, brands.name, commerce.stockStatus,
//   commerce.commercialAvailability, commerce.price.
//
// Deliberately ABSENT (not consumed by the matcher, would be dead weight):
//   audit timestamps (engineering_product_profile.created_at/updated_at,
//   engineering_value.created_at/updated_at, engineering_source.retrieved_at/
//   audited_at, engineering_condition_set.created_at), prose descriptions
//   (engineering_parameter.description, engineering_source.notes/page/
//   table_name, engineering_condition_key.description,
//   engineering_equipment_type.description).
// ---------------------------------------------------------------------------

/** Profile projection = CM8.1 ENGINEERING_CANDIDATE_STATE_FIELDS verbatim. */
export interface ProfileCanonicalFacts {
  productId: number;
  sku: string;
  equipmentType: string;
  series: string | null;
  model: string | null;
  identityStatus: string;
  dataCompleteness: string;
  sourceVerification: string;
  schemaId: string;
  schemaVersion: string;
}

/**
 * Engineering value projection. Mirrors the exact CM4 value-fact columns
 * (queryAdapter queryValuesSql): parameter definition + value + condition-set
 * linkage + source semantic tuple + verification tier. Each row carries its
 * full provenance tuple, so the projection never depends on rowid, source_id
 * numbers, or query order.
 */
export interface ValueCanonicalFacts {
  productId: number;
  parameterCode: string;
  parameterRequirementLevel: string;
  parameterValueType: string;
  parameterCanonicalUnit: string | null;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  unit: string | null;
  valueStatus: string;
  confidence: number | null;
  conditionSetCode: string | null;
  sourceType: string | null;
  sourceManufacturer: string | null;
  sourceDocumentTitle: string | null;
  sourceDocumentVersion: string | null;
  sourceUrl: string | null;
  verificationTier: string | null;
}

/** One operating-condition entry inside a condition set (CM4 condition facts). */
export interface ConditionEntryCanonicalFacts {
  conditionKey: string;
  valueType: string;
  canonicalUnit: string | null;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
}

export interface ConditionSetCanonicalFacts {
  conditionSetCode: string;
  entries: ConditionEntryCanonicalFacts[];
}

/** engineering_condition_key definition row (canonical unit / type). */
export interface ConditionKeyCanonicalFacts {
  conditionKey: string;
  valueType: string;
  canonicalUnit: string | null;
}

/** engineering_source_type row (verification tier mapping). */
export interface SourceTypeCanonicalFacts {
  sourceType: string;
  verificationTier: string;
}

/**
 * engineering_source row projected as its CM4 semantic source tuple
 * (source_type | manufacturer | document_title | document_version | url).
 * The tuple itself is the stable semantic identity; source_id numbers are
 * NOT projected. Prose (notes/page/table_name) and retrieval timestamps are
 * excluded — the matcher never consumes them.
 */
export interface SourceCanonicalFacts {
  sourceType: string;
  manufacturer: string | null;
  documentTitle: string | null;
  documentVersion: string | null;
  url: string | null;
  verificationTier: string;
}

/** Technical compatibility/relationship fact (raw relation_type vocabulary). */
export interface RelationshipCanonicalFacts {
  sourceProductId: number;
  targetProductId: number;
  relationType: string;
}

/**
 * Full canonical engineering catalog state for the frozen scope
 * ["FAN_COIL", "HEAT_PUMP"]. Every array is deterministically sorted by its
 * semantic identity (never rowid / query order) before hashing.
 */
export interface EngineeringCatalogCanonicalFacts {
  domain: typeof ENGINEERING_CATALOG_STATE_DOMAIN;
  algorithmVersion: typeof ENGINEERING_CATALOG_ALGORITHM_VERSION;
  projectionVersion: typeof ENGINEERING_CATALOG_STATE_PROJECTION_VERSION;
  scopeEquipmentTypes: readonly ["FAN_COIL", "HEAT_PUMP"];
  profiles: ProfileCanonicalFacts[];
  values: ValueCanonicalFacts[];
  conditionSets: ConditionSetCanonicalFacts[];
  conditionKeys: ConditionKeyCanonicalFacts[];
  sourceTypes: SourceTypeCanonicalFacts[];
  sources: SourceCanonicalFacts[];
  relationships: RelationshipCanonicalFacts[];
}

// ---------------------------------------------------------------------------
// Read-only DB handle (structural subset of better-sqlite3 Database; also
// satisfiable by in-memory test doubles). The provider only ever calls
// prepare(...).all(...) with SELECT statements.
// ---------------------------------------------------------------------------
export interface EngineeringCatalogStateDbHandle {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
  };
  /**
   * Transaction-control channel ONLY: BEGIN / COMMIT / ROLLBACK statements
   * for the coherent-read envelope. Implementations must refuse anything
   * else (the provider gates exec to exactly that vocabulary).
   */
  exec(sql: string): void;
}

export type EngineeringCatalogStateReferenceReadonly =
  DeepReadonly<EngineeringCatalogStateReference>;

export type { DeepReadonly };
