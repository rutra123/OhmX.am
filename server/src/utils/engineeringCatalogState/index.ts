/**
 * ENGINEERING-CATALOG-CM15 — public surface of the isolated provider module.
 *
 * Exports ONLY: the frozen-constant re-exports, canonicalization, projection,
 * provider, and the pure test-support fixture factory. It does NOT export and
 * does NOT import any Adapter / Configurator / Matcher / client / route
 * runtime.
 */
export {
  ENGINEERING_CATALOG_PREFIX,
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
  ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
  ENGINEERING_CATALOG_STATE_DOMAIN,
  type EngineeringCatalogCanonicalFacts,
  type ProfileCanonicalFacts,
  type ValueCanonicalFacts,
  type ConditionEntryCanonicalFacts,
  type ConditionSetCanonicalFacts,
  type ConditionKeyCanonicalFacts,
  type SourceTypeCanonicalFacts,
  type SourceCanonicalFacts,
  type RelationshipCanonicalFacts,
  type EngineeringCatalogStateDbHandle,
} from "./types.js";
export {
  EngineeringCatalogStateInputError,
  compareCodePoints,
  canonicalizeFiniteNumber,
  canonicalizeEngineeringCatalogFacts,
  serializeEngineeringCatalogFacts,
  computeEngineeringCatalogStateRevision,
} from "./canonicalize.js";
export {
  EngineeringCatalogProjectionError,
  projectEngineeringCatalogFacts,
} from "./projection.js";
export {
  ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES,
  resolveEngineeringCatalogDatabasePath,
  assertProviderSqlIsReadOnly,
  assertProviderTransactionSql,
  EngineeringCatalogStateProvider,
  type EngineeringCatalogStateProviderOptions,
} from "./provider.js";
export { createEngineeringCatalogStateFixtureDb } from "./engineeringCatalogStateFixtureDb.js";
