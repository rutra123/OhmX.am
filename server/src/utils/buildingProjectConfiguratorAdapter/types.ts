/**
 * CM11 — Building Project → Engineering Configurator adapter types.
 *
 * DESIGN-ONLY / PURE-READ-ONLY boundary. This module declares the exact frozen
 * CM10 contract vocabulary (ohmx.building-project-configurator-adapter.v1 / 1.0.0).
 * It imports nothing that mutates, queries, persists, or generates: only type
 * mirrors and frozen constants from the already-sealed CM9 Engineering
 * Configurator and the Building Project DTOs.
 *
 * No runtime body, no live wiring, no load/catalog fingerprint implementation.
 */
import type {
  BuildingProject,
  BuildingProjectSnapshot,
  BuildingLoadCalculation,
  BuildingLoadInputSnapshot,
  EngineeringSystemConfiguration,
  EngineeringQualityResult,
  EngineeringCoverage,
  CalculationScope,
  CoverageConfirmation,
} from "../buildingProjectTypes.js";
import type {
  EngineeringConfiguratorInput,
  ConfiguratorSelectionIntent,
  SourcedNumericOperatingInput,
  SourcedTextOperatingInput,
  EngineeringCatalogStateRevision,
  CommerceStateRevision,
  DesignMarginPolicyInput,
} from "../engineeringConfigurator/types.js";
import type { MatcherRequestPolicySnapshot } from "../engineeringConfigurator/equipmentRequirementTypes.js";

// ---------------------------------------------------------------------------
// Contract identity
// ---------------------------------------------------------------------------
export const ADAPTER_CONTRACT_ID = "ohmx.building-project-configurator-adapter.v1" as const;
export const ADAPTER_CONTRACT_VERSION = "1.0.0" as const;

// Token / revision prefixes (external boundary validates 64 lowercase hex).
export const LOAD_REVISION_PREFIX = "load:sha256:" as const;
export const ENGINEERING_CATALOG_PREFIX = "engineering-catalog-state:sha256:" as const;
export const COMMERCE_PREFIX = "commerce-state:sha256:" as const;

// Frozen load / catalog canonical algorithm identities (CM10 §9, §10).
export const LOAD_CANONICAL_DOMAIN = "building-project-configurator-load" as const;
export const LOAD_CANONICAL_ALGORITHM_VERSION = "ohmx.building-project-load-canonical-json.v1" as const;
export const ENGINEERING_CATALOG_ALGORITHM_VERSION = "ohmx.engineering-catalog-state-canonical-json.v1" as const;
export const ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES = ["FAN_COIL", "HEAT_PUMP"] as const;

// Frozen steady-state load method (CM10 §quality.method / call-gate step 6).
export const STEADY_STATE_METHOD_ID = "ohmx.steady-state.v1" as const;
export const STEADY_STATE_METHOD_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Adapter diagnostic vocabulary
//
// CM10 reuses the 21 canonical CM8 blocking codes and the 6 CM8 warning codes
// verbatim, adding exactly three boundary blockers and one boundary warning.
// ---------------------------------------------------------------------------
export const ADAPTER_BLOCKING_REASON_CODES = [
  // CM10 boundary additions (frozen; NOT present in CM8/CM9 source).
  "building.object_not_confirmed",
  "LOAD_REVISION_UNAVAILABLE",
  "ENGINEERING_CATALOG_STATE_UNAVAILABLE",
  // Canonical CM8/CM9 codes reused in exact order.
  "POLICY_ID_VERSION_INVALID",
  "PROJECT_REVISION_STALE",
  "LOAD_CALCULATION_REVISION_STALE",
  "SYSTEM_CONFIGURATION_REVISION_STALE",
  "LOAD_CALCULATION_NOT_READY",
  "LOAD_QUALITY_INSUFFICIENT",
  "LOAD_COVERAGE_INCOMPLETE",
  "OBJECT_LOAD_MISSING",
  "ROOM_LOAD_MISSING",
  "SYSTEM_CONFIGURATION_MISSING",
  "TOPOLOGY_NOT_SUPPORTED",
  "SIMULTANEOUS_OPERATION_NOT_SUPPORTED",
  "SERVED_ROOM_INVALID",
  "OPERATING_CONDITION_REQUIRED",
  "OPERATING_CONDITION_CONFLICT",
  "FAN_SPEED_REQUIRED",
  "DESIGN_MARGIN_INVALID",
  "CM7_1_PHYSICAL_COMPONENT_REFERENCE_REQUIRED",
  "CANONICAL_VOCABULARY_INVALID",
  "ENGINEERING_CATALOG_STATE_REQUIRED",
  "ENGINEERING_CATALOG_STATE_INVALID",
] as const;
export type AdapterBlockingReasonCode = (typeof ADAPTER_BLOCKING_REASON_CODES)[number];

export const ADAPTER_WARNING_CODES = [
  "PILOT_CORE_SELECTION_ONLY",
  "PRELIMINARY_LOAD_QUALITY",
  "BUILDING_QUALITY_WARNING",
  "PILOT_REFERENCE_OPERATING_INPUT",
  "COMPATIBILITY_UNKNOWN",
  "COMMERCE_REVISION_IGNORED",
  "ENGINEERING_CATALOG_STATE_PROVIDER_WARNING",
] as const;
export type AdapterWarningCode = (typeof ADAPTER_WARNING_CODES)[number];

// ---------------------------------------------------------------------------
// Readonly provenance vocabulary for explicit design inputs
// ---------------------------------------------------------------------------
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface PolicyReference {
  policyId: string;
  policyVersion: string;
  entryId: string;
}

export interface DesignProvenance {
  /** Stable engineering evidence locator; never a clock/random calculation id. */
  sourceReference: string;
  policyReference: PolicyReference | null;
}

/** Resolved °C design leaf. source re-typed to the explicit design vocabulary. */
export type ExplicitNumericDesignInput =
  | (Omit<SourcedNumericOperatingInput, "value" | "source" | "status" | "sourceReference"> &
      DesignProvenance & {
        value: number;
        source: "USER_INPUT";
        status: "RESOLVED";
        policyReference: null;
      })
  | (Omit<SourcedNumericOperatingInput, "value" | "source" | "status" | "sourceReference"> &
      DesignProvenance & {
        value: number;
        source: "SYSTEM_POLICY" | "PILOT_REFERENCE";
        status: "RESOLVED";
        policyReference: PolicyReference;
      });

export type ExplicitTextDesignInput =
  | (Omit<SourcedTextOperatingInput, "value" | "source" | "status" | "sourceReference"> &
      DesignProvenance & {
        value: string;
        source: "USER_INPUT";
        status: "RESOLVED";
        policyReference: null;
      })
  | (Omit<SourcedTextOperatingInput, "value" | "source" | "status" | "sourceReference"> &
      DesignProvenance & {
        value: string;
        source: "SYSTEM_POLICY" | "PILOT_REFERENCE";
        status: "RESOLVED";
        policyReference: PolicyReference;
      });

export interface UnresolvedDesignInput {
  value: null;
  source: "UNRESOLVED";
  status: "REQUIRED_POLICY_INPUT";
  sourceReference: null;
  policyReference: null;
}

export type NumericDesignInput = ExplicitNumericDesignInput | (UnresolvedDesignInput & { unit: "°C" });
export type TextDesignInput = ExplicitTextDesignInput | (UnresolvedDesignInput & { unit: null });

// ---------------------------------------------------------------------------
// Proposed (not yet live) Building Project extension fields — CM10 §4
// ---------------------------------------------------------------------------
export interface CoverageIntent {
  calculationScope: CalculationScope;
  coverageConfirmation: CoverageConfirmation;
  includedRoomIds: readonly string[];
  excludedRoomIds: readonly string[];
  includedZoneIds: readonly string[];
  requestedServices: readonly ("heating" | "cooling")[];
  buildingRevisionAtConfirmation: number | null;
  sourceReference: string | null;
}

export interface BuildingCalculationConfiguration {
  coverageIntent: CoverageIntent;
}

export interface HydronicDesignConditions {
  heatingWaterSupplyC: NumericDesignInput;
  heatingWaterReturnC: NumericDesignInput;
  coolingWaterSupplyC: NumericDesignInput;
  coolingWaterReturnC: NumericDesignInput;
}

export interface FanCoilSizingPolicyInput {
  sizingFanSpeed: TextDesignInput;
}

/** Explicit-only. No RH/psychrometric derivation is approved by this contract. */
export interface CoolingIndoorDesignCondition {
  indoorCoolingWetBulbC: NumericDesignInput;
}

export interface SystemEngineeringDesignInputs {
  hydronicDesignConditions: HydronicDesignConditions;
  coolingIndoorDesignCondition: CoolingIndoorDesignCondition;
  fanCoilSizingPolicy: FanCoilSizingPolicyInput;
  /** Absent group => CM8/CM9 explicit 0/NONE; present-invalid group blocks. */
  designMargins?: Partial<DesignMarginPolicyInput>;
}

// ---------------------------------------------------------------------------
// Adapter input projection over real Building Project DTOs + proposed fields
// ---------------------------------------------------------------------------
export type AdapterSystemConfiguration = EngineeringSystemConfiguration & {
  engineeringDesignInputs?: SystemEngineeringDesignInputs | null;
};

export type AdapterObjectSnapshot = BuildingProjectSnapshot & {
  calculationConfiguration?: BuildingCalculationConfiguration | null;
};

export type AdapterLoadInputSnapshot = BuildingLoadInputSnapshot & {
  calculationConfiguration?: BuildingCalculationConfiguration | null;
  systemEngineeringDesignInputs?: SystemEngineeringDesignInputs | null;
};

export type AdapterLoadCalculation = Omit<BuildingLoadCalculation, "inputSnapshot"> & {
  inputSnapshot: AdapterLoadInputSnapshot;
};

export type AdapterBuildingProject = Omit<
  BuildingProject,
  "systemsConfiguration" | "systemsConfigurationSnapshot" | "objectConfirmedSnapshot" | "loads"
> & {
  calculationConfiguration?: BuildingCalculationConfiguration | null;
  systemsConfiguration: AdapterSystemConfiguration | null;
  systemsConfigurationSnapshot: AdapterSystemConfiguration | null;
  objectConfirmedSnapshot: AdapterObjectSnapshot | null;
  loads?: AdapterLoadCalculation | null;
};

// ---------------------------------------------------------------------------
// Canonical load facts (exact fingerprint allowlist projection — CM10 §9)
// ---------------------------------------------------------------------------
export interface CanonicalServiceLoadFacts {
  status: BuildingLoadCalculation["roomResults"][number]["heating"]["status"];
  demandW: number | null;
  partialDemandW: number | null;
  warnings: readonly string[];
  missingInputs: readonly string[];
}

export interface CanonicalRoomLoadFacts {
  roomId: string;
  roomType: string;
  areaM2: number | null;
  heating: CanonicalServiceLoadFacts;
  cooling: CanonicalServiceLoadFacts;
  transmissionBreakdown: {
    indoorHeatingC: number | null;
    indoorCoolingC: number | null;
    outdoorHeatingC: number | null;
    outdoorCoolingC: number | null;
  } | null;
}

export interface CanonicalQualityField {
  fieldId: string;
  roomId: string | null;
  parameter: string;
  service: "heating" | "cooling" | null;
  effectiveValue: number | string | boolean | null;
  unit: string | null;
  effectiveProvenance: EngineeringQualityResult["fields"][number]["effectiveProvenance"];
  userConfirmed: boolean;
  quality: EngineeringQualityResult["fields"][number]["quality"];
  criticality: EngineeringQualityResult["fields"][number]["criticality"];
  requiredQuality: EngineeringQualityResult["fields"][number]["requiredQuality"];
  status: "ok" | "warning" | "blocked";
  sourceReference: string | null;
  messageCode: string | null;
  supersededBy: readonly string[];
}

export interface CanonicalBlockingField {
  fieldId: string;
  roomId: string | null;
  service: "heating" | "cooling" | null;
  parameter: string;
  reasonCode: string;
  requiredQuality: string;
  requiredProvenance: readonly string[];
}

export interface CanonicalQualityFacts {
  qualityModelId: EngineeringQualityResult["qualityModelId"];
  qualityModelVersion: EngineeringQualityResult["qualityModelVersion"];
  requestedLevel: EngineeringQualityResult["requestedLevel"];
  maximumEligibleLevel: EngineeringQualityResult["maximumEligibleLevel"];
  gateStatus: EngineeringQualityResult["gateStatus"];
  coverage: EngineeringCoverage;
  fields: readonly CanonicalQualityField[];
  blockingFields: readonly CanonicalBlockingField[];
  warnings: readonly string[];
}

export interface CanonicalDesignInputs {
  hydronicDesignConditions: HydronicDesignConditions;
  coolingIndoorDesignCondition: CoolingIndoorDesignCondition;
  fanCoilSizingPolicy: FanCoilSizingPolicyInput;
  designMargins: DesignMarginPolicyInput; // all four groups materialized with sanctioned NONE only
}

export interface CanonicalLoadFingerprintFacts {
  domain: "building-project-configurator-load";
  algorithmVersion: "ohmx.building-project-load-canonical-json.v1";
  projectId: string;
  buildingRevisionAtCalculation: number;
  systemsRevisionAtCalculation: number;
  mode: BuildingLoadCalculation["mode"];
  status: BuildingLoadCalculation["status"];
  methodId: string;
  methodVersion: string;
  heatingDemandW: number | null;
  coolingDemandW: number | null;
  partialHeatingDemandW: number | null;
  partialCoolingDemandW: number | null;
  warnings: readonly string[];
  missingInputs: readonly string[];
  roomResults: readonly CanonicalRoomLoadFacts[];
  engineeringQuality: CanonicalQualityFacts;
  climateDatasetId: string | null;
  climateDatasetVersion: string | null;
  climateLocationId: string | null;
  inputSnapshot: {
    projectId: string;
    objectType: BuildingProject["objectType"];
    buildingRevision: number;
    systemsRevision: number;
    mode: BuildingLoadCalculation["mode"];
    methodVersion: string;
    requestedServices: readonly ("heating" | "cooling")[];
    rooms: readonly { id: string; roomType: string; areaM2: number | null; floorId: string | null }[];
    servicePreferences: readonly {
      roomId: string;
      heating: "required" | "optional" | "not_required";
      cooling: "required" | "optional" | "not_required";
    }[];
    calculationConfiguration: BuildingCalculationConfiguration;
    systemEngineeringDesignInputs: CanonicalDesignInputs;
  };
}

// ---------------------------------------------------------------------------
// External references (validated, not produced, by this adapter)
// ---------------------------------------------------------------------------
export interface ProviderDiagnostic {
  code: string;
  sourceReference: string | null;
  message: string;
}

export type LoadRevisionReference =
  | {
      status: "AVAILABLE";
      revision: string;
      sourceCalculationId: string;
      algorithmVersion: typeof LOAD_CANONICAL_ALGORITHM_VERSION;
      canonicalFacts: DeepReadonly<CanonicalLoadFingerprintFacts>;
      errors: readonly [];
    }
  | {
      status: "UNAVAILABLE";
      revision: null;
      sourceCalculationId: null;
      algorithmVersion: string | null;
      canonicalFacts: null;
      errors: readonly ProviderDiagnostic[];
    };

export type EngineeringCatalogStateReference =
  | {
      status: "AVAILABLE";
      revision: EngineeringCatalogStateRevision;
      generatedFromPolicyId: "ohmx.engineering-configurator.heat-pump-fan-coil.v1";
      generatedFromPolicyVersion: "1.1.0";
      algorithmVersion: typeof ENGINEERING_CATALOG_ALGORITHM_VERSION;
      scopeEquipmentTypes: readonly ["FAN_COIL", "HEAT_PUMP"];
      readConsistency: "COMPLETE_COHERENT_SNAPSHOT";
      warnings: readonly ProviderDiagnostic[];
      errors: readonly [];
    }
  | {
      status: "UNAVAILABLE";
      revision: null;
      generatedFromPolicyId: string | null;
      generatedFromPolicyVersion: string | null;
      algorithmVersion: string | null;
      scopeEquipmentTypes: readonly string[];
      readConsistency: "UNAVAILABLE";
      warnings: readonly ProviderDiagnostic[];
      errors: readonly ProviderDiagnostic[];
    };

/** Caller-owned interface, invoked OUTSIDE the pure adapter (no provider impl here). */
export interface EngineeringCatalogStateProvider {
  getCurrentReference(): Promise<DeepReadonly<EngineeringCatalogStateReference>>;
}
export interface LoadRevisionProducer {
  produceReference(load: DeepReadonly<AdapterLoadCalculation>): DeepReadonly<LoadRevisionReference>;
}

export interface AdapterPolicyIdentities {
  adapterContract: { id: "ohmx.building-project-configurator-adapter.v1"; version: "1.0.0" };
  topologyPolicy: { id: "ohmx.engineering-configurator.heat-pump-fan-coil.v1"; version: "1.1.0" };
  equipmentRequirementContract: { id: "ohmx.equipment-requirement.v1"; version: "1.1.0" };
  genericRequirementPolicy: { id: "ohmx.engineering-configurator-policy.v1"; version: "1.0.0" };
  qualityModel: { id: "ohmx.professional-quality.v1"; version: "1.0.0" };
  engineeringSchema: { id: "ohmx.engineering-product.v1"; version: "1.0.0" };
  matcherModel: { id: "ohmx.catalog-matcher.v1"; version: "1.0.0" };
  matcherPolicy: { id: "ohmx.catalog-matcher-policy.v1"; version: "1.0.0" };
}

// ---------------------------------------------------------------------------
// Adapter input / output
// ---------------------------------------------------------------------------
export interface BuildingProjectConfiguratorAdapterInput {
  project: DeepReadonly<AdapterBuildingProject>;
  loadCalculation: DeepReadonly<AdapterLoadCalculation> | null;
  confirmedSystemSnapshot: DeepReadonly<AdapterSystemConfiguration> | null;
  loadRevisionReference: DeepReadonly<LoadRevisionReference> | null;
  engineeringCatalogStateReference: DeepReadonly<EngineeringCatalogStateReference> | null;
  selectionIntent: ConfiguratorSelectionIntent;
  policyIdentities: DeepReadonly<AdapterPolicyIdentities>;
  matcherRequestPolicy: DeepReadonly<MatcherRequestPolicySnapshot>;
  commerceStateRevision?: CommerceStateRevision;
}

export interface AdapterBlockingReason {
  code: AdapterBlockingReasonCode;
  fieldPath: string;
  sourceReference: string | null;
  roomId: string | null;
  service: "HEATING" | "COOLING" | null;
  message: string;
}

export interface AdapterWarning {
  code: AdapterWarningCode;
  fieldPath: string;
  sourceReference: string | null;
  message: string;
}

export type AdapterSourceKind =
  | "LIVE_PROJECT"
  | "LOAD_SNAPSHOT"
  | "CONFIRMED_SYSTEM"
  | "POLICY"
  | "REVISION_PROVIDER";

export type AdapterTransformation =
  | "COPY"
  | "PROJECT"
  | "SORT"
  | "CONSENSUS"
  | "SHARED_COPY"
  | "POLICY_CONSTANT"
  | "OMIT";

export interface AdapterSourceTraceEntry {
  /** RFC 6901 output pointer, incl. concrete sorted array index or unresolved root. */
  targetPath: string;
  sourcePaths: readonly string[];
  sourceKind: AdapterSourceKind;
  transformation: AdapterTransformation;
  revisionOwner: string;
  availability: "RESOLVED" | "MISSING" | "INVALID" | "OMITTED_OPTIONAL";
}

export interface AdapterRevisionTrace {
  projectId: string | null;
  projectRevision: number | null;
  objectConfirmedRevision: number | null;
  systemConfigurationRevision: number | null;
  systemBuildingRevisionAtConfirmation: number | null;
  systemsRevisionAtConfirmation: number | null;
  buildingRevisionAtCalculation: number | null;
  systemsRevisionAtCalculation: number | null;
  inputSnapshotBuildingRevision: number | null;
  inputSnapshotSystemsRevision: number | null;
  coverageBuildingRevisionAtConfirmation: number | null;
  loadCalculationRevision: string | null;
  sourceCalculationId: string | null;
  loadRevisionAlgorithmVersion: string | null;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  engineeringCatalogAlgorithmVersion: string | null;
  commerceStateRevision: CommerceStateRevision | null;
  policyIdentities: DeepReadonly<AdapterPolicyIdentities> | null;
  selectionIntent: ConfiguratorSelectionIntent | null;
  matcherRequestPolicy: DeepReadonly<MatcherRequestPolicySnapshot> | null;
  engineeringCurrency: "VALIDATED_SUPPLIED_SNAPSHOT" | "NOT_CERTIFIED";
  commerceComparisonStatus: "NOT_TRACKED" | "NOT_COMPARED";
  /** Adapter never certifies ongoing live freshness. Caller must re-acquire before use. */
  liveCurrentCertified: false;
}

export interface AdapterResultBase {
  contractId: typeof ADAPTER_CONTRACT_ID;
  contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  warnings: readonly AdapterWarning[];
  sourceTrace: readonly AdapterSourceTraceEntry[];
  revisionTrace: DeepReadonly<AdapterRevisionTrace>;
}

export type BuildingProjectConfiguratorAdapterResult =
  | (AdapterResultBase & {
      status: "READY";
      input: DeepReadonly<EngineeringConfiguratorInput>;
      blockingReasons: readonly [];
    })
  | (AdapterResultBase & {
      status: "BLOCKED";
      /** CM10 freezes BLOCKED input as ABSENT (`never`), not null/partial. */
      input?: never;
      blockingReasons: readonly [AdapterBlockingReason, ...AdapterBlockingReason[]];
    });