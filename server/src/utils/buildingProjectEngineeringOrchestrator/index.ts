/**
 * CM16 — public surface of the live engineering orchestration module.
 *
 * Exports ONLY the orchestration entry point, its result/option types, the
 * structural provider dependency, and the frozen blocker-code vocabulary.
 * It does NOT export and does NOT import the Catalog Matcher runtime, load
 * recalculation, any persistence mutation, any route, or any client code.
 */
export { runBuildingProjectEngineeringConfiguration } from "./orchestrator.js";
export type { RunBuildingProjectEngineeringConfigurationOptions } from "./orchestrator.js";
export {
  LIVE_ORCHESTRATION_CONTRACT_ID,
  LIVE_ORCHESTRATION_CONTRACT_VERSION,
  type OrchestrationStatus,
  type OrchestrationDiagnostic,
  type OrchestrationBlocker,
  type EngineeringCatalogStateProviderLike,
  type LiveOrchestrationResultBase,
  type BlockedLiveOrchestrationResult,
  type ConfiguredLiveOrchestrationResult,
  type BuildingProjectEngineeringOrchestrationResult,
} from "./types.js";
export {
  ORCHESTRATION_BLOCKER_CODES,
  type OrchestrationBlockerCode,
} from "./validation.js";
export type { AssembleAdapterInputArgs } from "./assembleAdapterInput.js";