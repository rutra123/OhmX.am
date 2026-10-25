/** CM9 runtime boundary mirrors frozen CM8.1 policy 1.1.0 DTOs; source-only, no live integration. */
import type {
  EquipmentRequirement,
  MatcherRequestPolicySnapshot,
  RequirementScopeReference,
} from "./equipmentRequirementTypes.js";

export const ENGINEERING_CONFIGURATOR_POLICY_ID =
  "ohmx.engineering-configurator.heat-pump-fan-coil.v1" as const;
export const ENGINEERING_CONFIGURATOR_POLICY_VERSION = "1.1.0" as const;
export const EQUIPMENT_REQUIREMENT_CONTRACT_ID =
  "ohmx.equipment-requirement.v1" as const;
export const EQUIPMENT_REQUIREMENT_CONTRACT_VERSION = "1.1.0" as const;

/** CM7.1 freezes this generic literal on EquipmentRequirement itself. */
export const CM7_GENERIC_CONFIGURATOR_POLICY_ID =
  "ohmx.engineering-configurator-policy.v1" as const;
export const CM7_GENERIC_CONFIGURATOR_POLICY_VERSION = "1.0.0" as const;

export const CM8_SYSTEM_TOPOLOGY = "HEAT_PUMP_FAN_COIL" as const;
export const CM8_SYSTEM_ARCHITECTURE_ID =
  "hydronic_2pipe_heating_cooling" as const;
export const CM8_SYSTEM_OPERATION_POLICY = "SEASONAL_CHANGEOVER" as const;
export const CM8_SERVICE_INTENT = "HEATING_AND_COOLING" as const;
export const CM8_REVERSIBLE_SOURCE_FAMILY_ID =
  "reversible_air_to_water_heat_pump" as const;
export const CM8_FAN_COIL_FAMILY_ID = "fan_coils" as const;
export const CM8_COMPLETENESS_STATE = "PILOT_CORE_SELECTION_ONLY" as const;
export const CM8_MINIMUM_PROFESSIONAL_USE_LEVEL = 3 as const;
export const CM8_COVERAGE_AREA_EPSILON_M2 = 0.01 as const;
export const CM8_COVERAGE_RATIO_EPSILON = 0.000001 as const;
export const CM8_RESIDENTIAL_OBJECT_TYPES = ["apartment", "private_house"] as const;
export type Cm8ResidentialObjectType = (typeof CM8_RESIDENTIAL_OBJECT_TYPES)[number];
export const CM8_ACCEPTED_BUILDING_LOAD_MODES = ["steady_state"] as const;

export const CONFIGURATOR_SELECTION_INTENTS = [
  "PRELIMINARY",
  "PROFESSIONAL",
] as const;
export type ConfiguratorSelectionIntent =
  (typeof CONFIGURATOR_SELECTION_INTENTS)[number];

export const CONFIGURATOR_RESULT_STATUSES = [
  "READY_WITH_WARNINGS",
  "BLOCKED",
] as const;
export type EngineeringConfiguratorStatus =
  (typeof CONFIGURATOR_RESULT_STATUSES)[number];

export const OPERATING_INPUT_SOURCES = [
  "USER_INPUT",
  "SYSTEM_POLICY",
  "BUILDING_LOAD_CONTEXT",
  "PILOT_REFERENCE",
  "UNRESOLVED",
] as const;
export type OperatingInputSource =
  (typeof OPERATING_INPUT_SOURCES)[number];

export const OPERATING_INPUT_STATUSES = [
  "RESOLVED",
  "REQUIRED_POLICY_INPUT",
] as const;
export type OperatingInputStatus =
  (typeof OPERATING_INPUT_STATUSES)[number];

export const MARGIN_INPUT_SOURCES = [
  "NONE",
  "USER_INPUT",
  "SYSTEM_POLICY",
] as const;
export type MarginInputSource = (typeof MARGIN_INPUT_SOURCES)[number];

export const CM8_BLOCKING_REASONS = [
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
export type Cm8BlockingReason = (typeof CM8_BLOCKING_REASONS)[number];

export const CM8_WARNING_CODES = [
  "PILOT_CORE_SELECTION_ONLY",
  "PRELIMINARY_LOAD_QUALITY",
  "BUILDING_QUALITY_WARNING",
  "PILOT_REFERENCE_OPERATING_INPUT",
  "COMPATIBILITY_UNKNOWN",
  "COMMERCE_REVISION_IGNORED",
] as const;
export type Cm8WarningCode = (typeof CM8_WARNING_CODES)[number];

export const CM81_ENGINEERING_STALE_REASONS = [
  "PROJECT_REVISION_CHANGED",
  "LOAD_CALCULATION_REVISION_CHANGED",
  "SYSTEM_CONFIGURATION_REVISION_CHANGED",
  "CONFIGURATOR_POLICY_CHANGED",
  "GENERIC_REQUIREMENT_POLICY_CHANGED",
  "MATCHER_MODEL_CHANGED",
  "MATCHER_POLICY_CHANGED",
  "ENGINEERING_SCHEMA_CHANGED",
  "ENGINEERING_CATALOG_STATE_CHANGED",
  "ENGINEERING_CATALOG_STATE_UNAVAILABLE"
] as const;
export type Cm81EngineeringStaleReason = (typeof CM81_ENGINEERING_STALE_REASONS)[number];
export const CM81_COMMERCE_STALE_REASONS = ["COMMERCE_STATE_CHANGED"] as const;
export type Cm81CommerceStaleReason = (typeof CM81_COMMERCE_STALE_REASONS)[number];
export const COMMERCE_COMPARISON_STATUSES = ["NOT_TRACKED", "NOT_COMPARED", "CURRENT", "STALE"] as const;
export type CommerceComparisonStatus = (typeof COMMERCE_COMPARISON_STATUSES)[number];

export type BuildingLoadMode = "quick" | "professional" | "steady_state";
export type BuildingLoadStatus = "calculated" | "limited" | "incomplete" | "stale";
export type ServiceLoadStatus =
  | "calculated"
  | "not_requested"
  | "not_required"
  | "missing_input"
  | "limited";
export type QualityGateStatus =
  | "PASS"
  | "PASS_WITH_WARNINGS"
  | "BLOCKED"
  | "LEGACY_UNASSESSED";
export type CalculationScope =
  | "WHOLE_OBJECT"
  | "SELECTED_ROOMS"
  | "CONDITIONED_ZONES"
  | "UNKNOWN";
export type CoverageConfirmation =
  | "WHOLE_OBJECT_CONFIRMED"
  | "SELECTED_ROOMS_CONFIRMED"
  | "CONDITIONED_ZONES_CONFIRMED"
  | "WHOLE_OBJECT_WITH_EXCLUSIONS"
  | "UNCONFIRMED";
export type UseLevel = 1 | 2 | 3;
export type MaximumEligibleLevel = 0 | UseLevel | null;

export interface EngineeringCoverageSnapshot {
  declaredAreaM2: number | null;
  modeledAreaM2: number | null;
  ratio: number | null;
  scope: CalculationScope;
  confirmation: CoverageConfirmation;
}

export interface EngineeringQualitySnapshot {
  qualityModelId: "ohmx.professional-quality.v1";
  qualityModelVersion: "1.0.0";
  requestedLevel: UseLevel;
  maximumEligibleLevel: MaximumEligibleLevel;
  gateStatus: QualityGateStatus;
  coverage: EngineeringCoverageSnapshot;
  blockingFields: readonly unknown[];
  warnings: readonly string[];
}

export interface ServiceLoadPolicySnapshot {
  status: ServiceLoadStatus;
  /** `null` never means zero. */
  demandW: number | null;
  partialDemandW?: number | null;
  warnings: readonly string[];
  missingInputs: readonly string[];
}

export interface TransmissionDesignConditionSnapshot {
  indoorHeatingC: number | null;
  indoorCoolingC: number | null;
  outdoorHeatingC: number | null;
  outdoorCoolingC: number | null;
}

export interface RoomLoadPolicySnapshot {
  roomId: string;
  roomName: string;
  roomType: string;
  areaM2: number | null;
  heating: ServiceLoadPolicySnapshot;
  cooling: ServiceLoadPolicySnapshot;
  transmissionBreakdown: TransmissionDesignConditionSnapshot | null;
}

/** Read-only subset of the current BuildingLoadCalculation DTO. */
export interface BuildingLoadCalculationPolicySnapshot {
  mode: BuildingLoadMode;
  status: BuildingLoadStatus;
  methodId: string;
  methodVersion: string;
  buildingRevisionAtCalculation: number;
  systemsRevisionAtCalculation: number;
  roomResults: readonly RoomLoadPolicySnapshot[];
  heatingDemandW: number | null;
  coolingDemandW: number | null;
  partialHeatingDemandW?: number | null;
  partialCoolingDemandW?: number | null;
  inputSnapshot: {
    projectId: string;
    requestedServices: readonly ("heating" | "cooling")[];
    buildingRevision: number;
    systemsRevision: number;
    mode: BuildingLoadMode;
    methodVersion: string;
  };
  engineeringQuality?: EngineeringQualitySnapshot;
  climateDatasetId?: string | null;
  climateDatasetVersion?: string | null;
  climateLocationId?: string | null;
  /** Audit timestamp only; excluded from deterministic load identity. */
  calculatedAt: string;
}

/** Read-only subset of current BuildingProject fields used by CM8. */
export interface BuildingProjectPolicySnapshot {
  id: string;
  objectType: Cm8ResidentialObjectType;
  buildingRevision: number;
  systemsRevision: number;
  totalAreaM2: number | null;
}

export interface BuildingSystemAssignmentPolicySnapshot {
  roomId: string;
  sourceSystemIds: {
    heating: string | null;
    cooling: string | null;
  };
  servicePreferences: {
    heating: "required" | "optional" | "not_required";
    cooling: "required" | "optional" | "not_required";
  };
  heatingSystems: readonly { familyId: string }[];
  coolingSystems: readonly { familyId: string }[];
}

/** Read-only subset of confirmed EngineeringSystemConfiguration. */
export interface SystemConfigurationPolicySnapshot {
  projectId: string;
  requestedServices: readonly ("heating" | "cooling")[];
  simultaneousHeatCoolRequired: boolean;
  architecture: {
    spaceHeatingSourceId: string | null;
    spaceCoolingSourceId: string | null;
    spaceCombinedSourceId: string | null;
    simultaneousHeatCoolSupported: boolean;
    distribution: {
      id: "hydronic_2pipe_heating_cooling" | string;
      circuitKind: "2pipe" | "4pipe" | "none" | "independent";
      simultaneousHeatCool: boolean;
    };
  };
  roomAssignments: readonly BuildingSystemAssignmentPolicySnapshot[];
  configurationStatus: string;
  buildingRevisionAtConfirmation: number | null;
  systemsRevisionAtConfirmation: number | null;
  systemsRevision: number;
}

export interface ServedRoomInput {
  roomId: string;
  servedZoneIds: readonly string[];
}

export interface SourcedNumericOperatingInput {
  value: number | null;
  unit: "°C";
  source: OperatingInputSource;
  sourceReference: string | null;
  status: OperatingInputStatus;
}

export interface SourcedTextOperatingInput {
  value: string | null;
  unit: null;
  source: OperatingInputSource;
  sourceReference: string | null;
  status: OperatingInputStatus;
}

export interface OperatingConditionPolicyInput {
  heatPumpHeating: {
    outdoorHeatingDesignC: SourcedNumericOperatingInput;
    waterSupplyC: SourcedNumericOperatingInput;
    waterReturnC: SourcedNumericOperatingInput;
  };
  heatPumpCooling: {
    outdoorCoolingDesignC: SourcedNumericOperatingInput;
    waterSupplyC: SourcedNumericOperatingInput;
    waterReturnC: SourcedNumericOperatingInput;
  };
  fanCoilHeating: {
    waterInC: SourcedNumericOperatingInput;
    waterOutC: SourcedNumericOperatingInput;
    /** Maps to canonical Matcher key indoor_air_dry_bulb_c. */
    indoor_air_c: SourcedNumericOperatingInput;
    sizingFanSpeed: SourcedTextOperatingInput;
  };
  fanCoilCooling: {
    waterInC: SourcedNumericOperatingInput;
    waterOutC: SourcedNumericOperatingInput;
    indoorAirDryBulbC: SourcedNumericOperatingInput;
    indoorAirWetBulbC: SourcedNumericOperatingInput;
    sizingFanSpeed: SourcedTextOperatingInput;
  };
}

export interface ConfiguratorDesignMarginInput {
  designMarginPercent: number;
  marginSource: MarginInputSource;
  marginPolicyId: string | null;
  marginPolicyVersion: string | null;
}

export interface DesignMarginPolicyInput {
  heatPumpHeating: ConfiguratorDesignMarginInput;
  heatPumpCooling: ConfiguratorDesignMarginInput;
  fanCoilHeating: ConfiguratorDesignMarginInput;
  fanCoilCooling: ConfiguratorDesignMarginInput;
}

/** Template literals document prefixes only; external boundary must validate 64 lowercase hex. */
export type EngineeringCatalogStateRevision = `engineering-catalog-state:sha256:${string}`;
export type CommerceStateRevision = `commerce-state:sha256:${string}`;
export interface Cm81StaleAssessment {
  engineeringStale: boolean;
  engineeringStaleReasons: readonly Cm81EngineeringStaleReason[];
  commerceStale: boolean;
  commerceStaleReasons: readonly Cm81CommerceStaleReason[];
  commerceComparisonStatus: CommerceComparisonStatus;
}

export interface EngineeringConfiguratorInput {
  policyId: typeof ENGINEERING_CONFIGURATOR_POLICY_ID;
  policyVersion: typeof ENGINEERING_CONFIGURATOR_POLICY_VERSION;
  projectId: string;
  /** Adapted from current BuildingProject.buildingRevision. */
  projectRevision: number;
  /** Deterministic `load:sha256:<hex>`; no current persisted BP field exists. */
  loadCalculationRevision: string;
  /** Equals loadCalculationRevision in policy v1. */
  sourceCalculationId: string;
  systemTopology: typeof CM8_SYSTEM_TOPOLOGY;
  /** Adapted from current BuildingProject.systemsRevision. */
  systemConfigurationRevision: number;
  selectionIntent: ConfiguratorSelectionIntent;
  projectSnapshot: BuildingProjectPolicySnapshot;
  loadCalculation: BuildingLoadCalculationPolicySnapshot;
  systemConfigurationSnapshot: SystemConfigurationPolicySnapshot;
  servedRooms: readonly ServedRoomInput[];
  operatingConditions: OperatingConditionPolicyInput;
  designMargins: DesignMarginPolicyInput;
  matcherRequestPolicy: MatcherRequestPolicySnapshot;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision;
  commerceStateRevision?: CommerceStateRevision;
}

export interface PhysicalComponent {
  componentInstanceId: string;
  equipmentType: "HEAT_PUMP" | "FAN_COIL";
  scope: "WHOLE_OBJECT" | "ROOM";
  scopeReference: RequirementScopeReference;
  quantity: 1;
  servedRoomIds: readonly string[];
  servedZoneIds: readonly string[];
  serviceRequirementIds: readonly string[];
  /** Deliberately no productId/SKU/candidates/price/stock. */
}

export interface Cm8Warning {
  code: Cm8WarningCode;
  message: string;
  sourceReference: string | null;
}

export interface Cm8BlockingReasonDetail {
  code: Cm8BlockingReason;
  message: string;
  sourceReference: string | null;
  roomId: string | null;
  service: "HEATING" | "COOLING" | null;
}

export interface EngineeringConfiguratorResult {
  status: EngineeringConfiguratorStatus;
  policyId: typeof ENGINEERING_CONFIGURATOR_POLICY_ID;
  policyVersion: typeof ENGINEERING_CONFIGURATOR_POLICY_VERSION;
  equipmentRequirementContractId: typeof EQUIPMENT_REQUIREMENT_CONTRACT_ID;
  equipmentRequirementContractVersion: typeof EQUIPMENT_REQUIREMENT_CONTRACT_VERSION;
  projectId: string;
  projectRevision: number;
  loadCalculationRevision: string;
  systemConfigurationRevision: number;
  systemTopology: typeof CM8_SYSTEM_TOPOLOGY;
  systemArchitectureId: typeof CM8_SYSTEM_ARCHITECTURE_ID;
  systemOperationPolicy: typeof CM8_SYSTEM_OPERATION_POLICY;
  /** Null only on BLOCKED diagnostics for missing/invalid engineering token. */
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  commerceStateRevision?: CommerceStateRevision;
  engineeringStale: boolean;
  engineeringStaleReasons: readonly Cm81EngineeringStaleReason[];
  commerceStale: boolean;
  commerceStaleReasons: readonly Cm81CommerceStaleReason[];
  commerceComparisonStatus: CommerceComparisonStatus;
  physicalComponents: readonly PhysicalComponent[];
  equipmentRequirements: readonly EquipmentRequirement[];
  warnings: readonly Cm8Warning[];
  blockingReasons: readonly Cm8BlockingReasonDetail[];
  completenessState: typeof CM8_COMPLETENESS_STATE;
}

/**
 * Success is always READY_WITH_WARNINGS because PILOT_CORE_SELECTION_ONLY is
 * mandatory. BLOCKED is atomic and has empty component/requirement arrays.
 */
export type SuccessfulEngineeringConfiguratorResult =
  EngineeringConfiguratorResult & {
    status: "READY_WITH_WARNINGS";
    engineeringCatalogStateRevision: EngineeringCatalogStateRevision;
    warnings: readonly [Cm8Warning, ...Cm8Warning[]];
    blockingReasons: readonly [];
  };

export type BlockedEngineeringConfiguratorResult =
  EngineeringConfiguratorResult & {
    status: "BLOCKED";
    physicalComponents: readonly [];
    equipmentRequirements: readonly [];
    blockingReasons: readonly [Cm8BlockingReasonDetail, ...Cm8BlockingReasonDetail[]];
  };


export type StalenessAssessmentInput = {
  historical: EngineeringConfiguratorResult;
  currentProjectRevision: number;
  currentLoadCalculationRevision: string;
  currentSystemConfigurationRevision: number;
  currentConfiguratorPolicyId: string;
  currentConfiguratorPolicyVersion: string;
  currentGenericRequirementPolicyVersion: string;
  currentMatcherModelId: string;
  currentMatcherModelVersion: string;
  currentMatcherPolicyId: string;
  currentMatcherPolicyVersion: string;
  currentEngineeringSchemaId: string;
  currentEngineeringSchemaVersion: string;
  currentEngineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  currentCommerceStateRevision?: CommerceStateRevision;
};
