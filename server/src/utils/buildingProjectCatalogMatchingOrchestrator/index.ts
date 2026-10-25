/** Public CM17 server-utility surface. No route or client wiring. */
export {
  runBuildingProjectCatalogMatching,
  type RunBuildingProjectCatalogMatchingOptions,
} from "./orchestrator.js";
export {
  CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID,
  CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION,
  CATALOG_MATCHING_BLOCKER_CODES,
  type CatalogMatchingBlockerCode,
  type CatalogMatchingBlocker,
  type RequirementMatcherResult,
  type SameProductCommonCandidate,
  type SameProductCompositionGroup,
  type BlockedCatalogMatchingResult,
  type MatchedCatalogMatchingResult,
  type BuildingProjectCatalogMatchingResult,
  type CatalogMatchingSnapshotSession,
  type CatalogMatchingSnapshotProvider,
} from "./types.js";
export {
  requirementToMatcherInput,
  type RequirementToMatcherInputResult,
} from "./requirementToMatcherInput.js";
export { composeSameProductGroups } from "./sameProductComposition.js";
export { SqliteCatalogMatchingSnapshotProvider } from "./catalogSnapshot.js";
