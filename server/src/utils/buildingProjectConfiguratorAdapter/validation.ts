/**
 * CM11 adapter — shared validated-context type and aggregation of the validation
 * gates. This module owns the interface the orchestrator and the projector share;
 * it performs no runtime side effects.
 */
import type {
  AdapterLoadCalculation,
  AdapterSystemConfiguration,
  CoverageIntent,
} from "./types.js";
import type { EngineeringQualityResult, EngineeringCoverage } from "../buildingProjectTypes.js";
import type {
  EngineeringCatalogStateRevision,
  CommerceStateRevision,
  ConfiguratorSelectionIntent,
} from "../engineeringConfigurator/types.js";
import type { MatcherRequestPolicySnapshot } from "../engineeringConfigurator/equipmentRequirementTypes.js";
import type { ResolvedDesign } from "./operatingInputs.js";

export interface AdapterContext {
  projectId: string;
  objectType: "apartment" | "private_house";
  projectRevision: number;
  systemConfigurationRevision: number;
  sortedRoomIds: readonly string[];
  load: AdapterLoadCalculation;
  system: AdapterSystemConfiguration;
  quality: EngineeringQualityResult;
  coverage: EngineeringCoverage;
  intent: CoverageIntent;
  design: ResolvedDesign;
  totalAreaM2: number | null;
  selectionIntent: ConfiguratorSelectionIntent;
  matcherRequestPolicy: MatcherRequestPolicySnapshot;
  loadRevision: string;
  sourceCalculationId: string;
  loadRevisionAlgorithmVersion: string;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision;
  commerceStateRevision?: CommerceStateRevision;
}

export { validateProjectObject, validatePolicyBridge, validateSelectionIntent, validateMatcherRequestPolicy, validateSystemConfirmation, validateTopology, validateLoadReadiness, validateRevisions, validateQuality, validateServedRooms } from "./revisionValidation.js";
export type { ValidatedProject } from "./revisionValidation.js";
export { validateCoverage } from "./coverage.js";
export type { CoverageFacts } from "./coverage.js";
export { resolveDesignInputs, resolveMargins, resolveOperatingConditions, validateCapturedDesignParity, materializeMargins } from "./operatingInputs.js";
export type { ResolvedDesign } from "./operatingInputs.js";
export { projectCanonicalLoadFacts, validateLoadRevisionReference, validateEngineeringCatalogReference } from "./loadRevision.js";
export type { LoadRevisionToken } from "./loadRevision.js";