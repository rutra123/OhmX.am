/** CM9 local mirror of the unchanged CM7.1 requirement-only surface. No match-result DTOs. */
import type { CanonicalConditionKey, CanonicalEquipmentType, CapacityRequirement, CompatibilityRequirement,
  ConditionRequirement, ParameterExclusion, ParameterPreference, ParameterRequirement, SelectionMode,
  Service, VerificationRequirement } from '../catalogMatcher/types.js';
import type { BuildingLoadMode, MaximumEligibleLevel, QualityGateStatus, UseLevel } from '../buildingProjectTypes.js';

export const EQUIPMENT_REQUIREMENT_CONTRACT_ID = "ohmx.equipment-requirement.v1" as const;

export const EQUIPMENT_REQUIREMENT_CONTRACT_VERSION = "1.1.0" as const;

export const CONFIGURATOR_POLICY_ID = "ohmx.engineering-configurator-policy.v1" as const;

export const MATCHER_MODEL_ID = "ohmx.catalog-matcher.v1" as const;

export const MATCHER_MODEL_VERSION = "1.0.0" as const;

export const MATCHER_POLICY_ID = "ohmx.catalog-matcher-policy.v1" as const;

export const ENGINEERING_SCHEMA_ID = "ohmx.engineering-product.v1" as const;

export const ENGINEERING_SCHEMA_VERSION = "1.0.0" as const;

export const BUILDING_QUALITY_MODEL_ID = "ohmx.professional-quality.v1" as const;

export const BUILDING_QUALITY_MODEL_VERSION = "1.0.0" as const;

export const REQUIREMENT_SCOPES = [
  "WHOLE_OBJECT",
  "ROOM",
  "ZONE",
  "SYSTEM",
  "SHARED_SYSTEM",
] as const;

export const QUANTITY_STRATEGIES = [
  "SINGLE",
  "PER_ROOM",
  "PER_ZONE",
  "DERIVED",
  "MULTI_UNIT_ALLOWED",
  "SHARED",
] as const;

export const SYSTEM_TOPOLOGY_IDS = [
  "HEAT_PUMP_FAN_COIL",
  "GAS_BOILER_RADIATOR",
  "HEAT_PUMP_FLOOR_HEATING",
  "ELECTRIC_FLOOR_HEATING",
] as const;

export const SYSTEM_OPERATION_POLICIES = [
  "SEASONAL_CHANGEOVER",
  "SIMULTANEOUS_HEATING_COOLING",
] as const;

export const CONFIGURATOR_SERVICE_INTENTS = [
  "HEATING",
  "COOLING",
  "HEATING_AND_COOLING",
] as const;

export const SOURCE_LOAD_TYPES = [
  "OBJECT_HEATING_DEMAND",
  "OBJECT_COOLING_DEMAND",
  "ROOM_HEATING_DEMAND",
  "ROOM_COOLING_DEMAND",
  "ZONE_HEATING_DEMAND",
  "ZONE_COOLING_DEMAND",
] as const;

export const SOURCE_LOAD_DERIVATIONS = [
  "DIRECT_OBJECT_TOTAL",
  "DIRECT_ROOM_RESULT",
  "CONFIGURATOR_SUM_OF_ROOM_RESULTS",
] as const;

export const MARGIN_POLICY_SOURCES = [
  "NONE",
  "EXPLICIT_USER",
  "CONFIGURATOR_POLICY",
] as const;

export const OPERATING_CONDITION_SOURCES = [
  "SYSTEM_CONFIGURATION",
  "EXPLICIT_USER",
  "CONFIGURATOR_POLICY",
  "BUILDING_LOAD_CONTEXT",
] as const;

export const QUALITY_GATE_DECISIONS = [
  "ALLOWED",
  "ALLOWED_WITH_WARNINGS",
  "BLOCKED",
] as const;

export type RequirementScope = (typeof REQUIREMENT_SCOPES)[number];

export type QuantityStrategy = (typeof QUANTITY_STRATEGIES)[number];

export type SystemTopologyId = (typeof SYSTEM_TOPOLOGY_IDS)[number];

export type SystemOperationPolicy = (typeof SYSTEM_OPERATION_POLICIES)[number];

export type ConfiguratorServiceIntent = (typeof CONFIGURATOR_SERVICE_INTENTS)[number];

export type SourceLoadType = (typeof SOURCE_LOAD_TYPES)[number];

export type SourceLoadDerivation = (typeof SOURCE_LOAD_DERIVATIONS)[number];

export type MarginPolicySource = (typeof MARGIN_POLICY_SOURCES)[number];

export type OperatingConditionSource = (typeof OPERATING_CONDITION_SOURCES)[number];

export type QualityGateDecisionState = (typeof QUALITY_GATE_DECISIONS)[number];

export interface RequirementScopeReference {
  /** Stable, deterministic identity for the stated scope; never inferred from equipmentType. */
  scopeId: string;
  roomId: string | null;
  zoneId: string | null;
  systemId: string | null;
  /** Explicit service footprint. A shared requirement lists every served room. */
  servedRoomIds: readonly string[];
}

export interface RequirementQuantity {
  strategy: QuantityStrategy;
  /** Null only while DERIVED/MULTI_UNIT_ALLOWED composition remains unresolved. */
  targetQuantity: number | null;
  capacityBasis: "PER_ITEM" | "SYSTEM_TOTAL";
  derivationReference: string | null;
  /** Frozen false: Catalog Matcher v1 must never multiply products. */
  matcherMayMultiply: false;
}

export interface SourceCalculationRevision {
  projectRevision: number;
  systemsRevision: number;
  /**
   * Stable revision/token assigned to the immutable load result. Until a separate
   * persisted revision exists, this equals sourceCalculationId.
   */
  loadCalculationRevision: string;
  methodId: string;
  methodVersion: string;
  loadMode: BuildingLoadMode;
}

export interface SourceCoverageSnapshot {
  declaredAreaM2: number | null;
  modeledAreaM2: number | null;
  ratio: number | null;
  scope: "WHOLE_OBJECT" | "SELECTED_ROOMS" | "CONDITIONED_ZONES" | "UNKNOWN" | null;
  confirmation:
    | "WHOLE_OBJECT_CONFIRMED"
    | "SELECTED_ROOMS_CONFIRMED"
    | "CONDITIONED_ZONES_CONFIRMED"
    | "WHOLE_OBJECT_WITH_EXCLUSIONS"
    | "UNCONFIRMED"
    | null;
}

export interface SourceLoadReference {
  /** Deterministic semantic key; never calculatedAt, Date.now(), or random UUID. */
  sourceCalculationId: string;
  sourceRevision: SourceCalculationRevision;
  sourceLoadType: SourceLoadType;
  /** Exact load snapshot in W. A requirement is not generated from null or an incomplete total. */
  sourceLoadW: number;
  sourceRoomIds: readonly string[];
  sourceLoadDerivation: SourceLoadDerivation;
  /** Snapshot of engineeringQuality.maximumEligibleLevel; null means unassessed legacy data. */
  sourceQualityLevel: MaximumEligibleLevel;
  sourceRequestedQualityLevel: UseLevel | null;
  sourceQualityGateStatus: QualityGateStatus | null;
  sourceQualityModelId: typeof BUILDING_QUALITY_MODEL_ID | null;
  sourceQualityModelVersion: typeof BUILDING_QUALITY_MODEL_VERSION | null;
  sourceCoverage: SourceCoverageSnapshot;
  climateDatasetId: string | null;
  climateDatasetVersion: string | null;
  climateLocationId: string | null;
}

export interface OperatingConditionProvenance {
  conditionKey: CanonicalConditionKey;
  source: OperatingConditionSource;
  sourceReference: string;
}

export interface DesignMargin {
  /** Same numeric base as requiredCapacity.requiredValue. */
  baseRequiredCapacity: number;
  unit: string;
  designMarginPercent: number;
  /** baseRequiredCapacity * (1 + designMarginPercent / 100). */
  effectiveRequiredCapacity: number;
  marginPolicySource: MarginPolicySource;
  marginPolicyId: string | null;
  marginPolicyVersion: string | null;
}

export interface CalculationQualityGateDecision {
  requestedMatcherMode: SelectionMode;
  buildingQualityGateStatus: QualityGateStatus | null;
  buildingRequestedLevel: UseLevel | null;
  buildingMaximumEligibleLevel: MaximumEligibleLevel;
  /** Supplied by configurator policy; CM7 freezes no universal threshold. */
  minimumUseLevelForProfessional: UseLevel;
  preliminaryAllowedWithInsufficientQuality: boolean;
  decision: QualityGateDecisionState;
  allowedMatcherMode: SelectionMode | null;
  warnings: readonly string[];
  blockingReasons: readonly ("LOAD_CALCULATION_NOT_READY" | "LOAD_QUALITY_INSUFFICIENT")[];
}

export interface MatcherRequestPolicySnapshot {
  matcherModelId: typeof MATCHER_MODEL_ID;
  matcherModelVersion: typeof MATCHER_MODEL_VERSION;
  engineeringSchemaVersion: typeof ENGINEERING_SCHEMA_VERSION;
  matcherPolicyId: typeof MATCHER_POLICY_ID;
  matcherPolicyVersion: string;
  requiredVerificationTier: VerificationRequirement;
  requireExactOperatingPoint: boolean;
  allowInterpolation: boolean;
  allowExtrapolation: boolean;
  maxCandidates: number;
  maxDiagnosticResults: number;
}

export interface RequirementRevisionStamp {
  projectId: string;
  projectRevision: number;
  systemConfigurationRevision: number;
  loadCalculationRevision: string;
  sourceCalculationId: string;
  configuratorPolicyId: typeof CONFIGURATOR_POLICY_ID;
  configuratorPolicyVersion: string;
  matcherModelId: typeof MATCHER_MODEL_ID;
  matcherModelVersion: typeof MATCHER_MODEL_VERSION;
  matcherPolicyId: typeof MATCHER_POLICY_ID;
  matcherPolicyVersion: string;
  engineeringSchemaId: typeof ENGINEERING_SCHEMA_ID;
  engineeringSchemaVersion: typeof ENGINEERING_SCHEMA_VERSION;
}

export interface RequirementWarning {
  code: string;
  message: string;
  sourceReference: string | null;
}

export interface PhysicalComponentReference {
  componentInstanceId: string;
  selectionConstraint: "SAME_PRODUCT";
}

export interface EquipmentRequirement {
  contractId: typeof EQUIPMENT_REQUIREMENT_CONTRACT_ID;
  contractVersion: typeof EQUIPMENT_REQUIREMENT_CONTRACT_VERSION;
  requirementId: string;
  /**
   * Generic logical grouping of related requirements. Non-null alone never means
   * one physical component, SAME_PRODUCT, one common productId, or one quantity.
   */
  requirementGroupId: string | null;
  /**
   * Optional and nullable for v1.0.0 readability. A policy that requires one
   * physical product must fail closed when this reference is absent/null.
   */
  physicalComponentRef?: PhysicalComponentReference | null;
  projectId: string;
  scope: RequirementScope;
  scopeReference: RequirementScopeReference;
  systemTopologyId: SystemTopologyId;
  systemArchitectureId: string;
  systemOperationPolicy: SystemOperationPolicy;
  systemServiceIntent: ConfiguratorServiceIntent;
  equipmentType: CanonicalEquipmentType;
  /** Canonical Matcher Service. Combined intent is split before this DTO. */
  service: Service;
  quantityStrategy: QuantityStrategy;
  quantity: RequirementQuantity;
  requiredCapacity: CapacityRequirement | null;
  operatingConditions: readonly ConditionRequirement[];
  operatingConditionProvenance: readonly OperatingConditionProvenance[];
  requiredParameters: readonly ParameterRequirement[];
  preferredParameters: readonly ParameterPreference[];
  excludedParameters: readonly ParameterExclusion[];
  compatibilityRequirements: readonly CompatibilityRequirement[];
  selectionMode: SelectionMode;
  calculationQualityGate: CalculationQualityGateDecision;
  sourceLoadReference: SourceLoadReference;
  designMargin: DesignMargin | null;
  notes: readonly string[];
  warnings: readonly RequirementWarning[];
  policyId: typeof CONFIGURATOR_POLICY_ID;
  policyVersion: string;
  matcherRequestPolicy: MatcherRequestPolicySnapshot;
  revisionStamp: RequirementRevisionStamp;
}
