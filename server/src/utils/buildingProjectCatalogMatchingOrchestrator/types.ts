/** CM17 isolated catalog-matching orchestration contract. */
import type {
  BuildingProjectEngineeringOrchestrationResult,
  ConfiguredLiveOrchestrationResult,
} from "../buildingProjectEngineeringOrchestrator/types.js";
import type {
  EngineeringCatalogStateRevision,
  PhysicalComponent,
} from "../engineeringConfigurator/types.js";
import type {
  EquipmentRequirement,
  Service,
} from "../engineeringConfigurator/equipmentRequirementTypes.js";
import type {
  CandidateEvaluation,
  CatalogMatchRequest,
  CatalogMatchResponse,
  CanonicalEquipmentType,
} from "../catalogMatcher/types.js";
import type {
  CatalogMatcherFailureKind,
  CatalogMatcherResult,
} from "../catalogMatcher/service.js";

export const CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID =
  "ohmx.building-project-catalog-matching-orchestrator.v1" as const;
export const CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION = "1.0.0" as const;

export const CATALOG_MATCHING_BLOCKER_CODES = [
  "CM16_BLOCKED",
  "ENGINEERING_CATALOG_STATE_UNAVAILABLE",
  "ENGINEERING_CATALOG_STATE_CHANGED",
  "REQUIREMENT_IDENTITY_INVALID",
  "DUPLICATE_REQUIREMENT_ID",
  "COMPONENT_LINKAGE_INVALID",
  "UNSUPPORTED_MATCHER_REQUEST_CONVERSION",
  "MATCHER_TECHNICAL_FAILURE",
  "NO_ELIGIBLE_CANDIDATE",
  "SAME_PRODUCT_NO_COMMON_CANDIDATE",
] as const;
export type CatalogMatchingBlockerCode = (typeof CATALOG_MATCHING_BLOCKER_CODES)[number];

export interface CatalogMatchingBlocker {
  code: CatalogMatchingBlockerCode;
  message: string;
  requirementId: string | null;
  componentInstanceId: string | null;
  sourceCode: string | null;
  matcherFailureKind: CatalogMatcherFailureKind | null;
  expectedEngineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  observedEngineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
}

export interface RequirementMatcherResult {
  requirement: EquipmentRequirement;
  request: CatalogMatchRequest;
  response: CatalogMatchResponse;
}

export interface CommonCandidatePerRequirementEvidence {
  requirementId: string;
  service: Service;
  candidate: CandidateEvaluation;
}

export interface SameProductCommonCandidate {
  productId: number;
  perRequirementEvidence: readonly CommonCandidatePerRequirementEvidence[];
}

export interface SameProductCompositionGroup {
  componentInstanceId: string;
  selectionConstraint: "SAME_PRODUCT";
  equipmentType: CanonicalEquipmentType;
  roomId: string | null;
  requirementIds: readonly string[];
  services: readonly Service[];
  perRequirementCandidateProductIds: readonly {
    requirementId: string;
    service: Service;
    productIds: readonly number[];
  }[];
  commonCandidateProductIds: readonly number[];
  commonCandidates: readonly SameProductCommonCandidate[];
  /** CM17 exposes candidates but invents no winner-selection rule. */
  selectedProductId: null;
}

export interface CatalogMatchingResultBase {
  contractId: typeof CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID;
  contractVersion: typeof CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION;
  projectId: string;
  buildingRevision: number | null;
  systemsRevision: number | null;
  loadCalculationRevision: string | null;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  cm16Result: BuildingProjectEngineeringOrchestrationResult;
  physicalComponents: readonly PhysicalComponent[];
  equipmentRequirements: readonly EquipmentRequirement[];
  requirementMatches: readonly RequirementMatcherResult[];
  sameProductGroups: readonly SameProductCompositionGroup[];
}

export interface BlockedCatalogMatchingResult extends CatalogMatchingResultBase {
  status: "BLOCKED";
  blocker: CatalogMatchingBlocker;
}

export interface MatchedCatalogMatchingResult extends CatalogMatchingResultBase {
  status: "MATCHED";
  blocker: null;
  cm16Result: ConfiguredLiveOrchestrationResult;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision;
}

export type BuildingProjectCatalogMatchingResult =
  | BlockedCatalogMatchingResult
  | MatchedCatalogMatchingResult;

/** One read-only catalog snapshot shared by revision projection and every Matcher call. */
export interface CatalogMatchingSnapshotSession {
  revision: EngineeringCatalogStateRevision;
  match(request: CatalogMatchRequest): CatalogMatcherResult;
  commit(): void;
  rollback(): void;
}

export interface CatalogMatchingSnapshotProvider {
  openSession(): CatalogMatchingSnapshotSession;
}
