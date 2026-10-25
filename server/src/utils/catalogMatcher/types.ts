/*
 * CATALOG MATCHER CONTRACT V1
 * Public + internal DTOs for the CM3 pure evaluator.
 * Canonical vocabularies copied from ohmx.engineering-product.v1 / 1.0.0
 * and ohmx.catalog-matcher.v1 / 1.0.0. No SQLite adapter.
 */


export const MATCHER_MODEL_ID = "ohmx.catalog-matcher.v1" as const;
export const MATCHER_MODEL_VERSION = "1.0.0" as const;
export const MATCHER_POLICY_ID = "ohmx.catalog-matcher-policy.v1" as const;
export const MATCHER_POLICY_VERSION = "1.0.0" as const;
export const ENGINEERING_SCHEMA_ID = "ohmx.engineering-product.v1" as const;
export const ENGINEERING_SCHEMA_VERSION = "1.0.0" as const;

export const SELECTION_MODES = [
  "PRELIMINARY",
  "PROFESSIONAL",
] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

export const EQUIPMENT_TYPES = [
  "HEAT_PUMP",
  "FAN_COIL",
  "CIRCULATION_PUMP",
  "BUFFER_TANK",
  "HYDRAULIC_SEPARATOR",
  "HEAT_EXCHANGER",
  "MANIFOLD",
  "CONTROL_VALVE",
  "BALANCING_VALVE",
  "ACTUATOR",
  "THERMOSTAT",
  "CONTROLLER",
  "ACCESSORY",
] as const;
export type CanonicalEquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const SERVICES = [
  "HEATING",
  "COOLING",
  "DHW",
  "HYDRONIC_FLOW",
  "HYDRONIC_PRESSURE",
  "AIRFLOW",
  "CONTROL",
  "OTHER",
] as const;
export type Service = (typeof SERVICES)[number];

export const COMPARISON_POLICIES = [
  "AT_LEAST",
  "AT_MOST",
  "EQUAL",
  "WITHIN_RANGE",
] as const;
export type ComparisonPolicy = (typeof COMPARISON_POLICIES)[number];

export const CONDITION_MATCH_STATES = [
  "EXACT",
  "COMPATIBLE",
  "MISSING",
  "CONFLICT",
  "NOT_APPLICABLE",
] as const;
export type ConditionMatchState = (typeof CONDITION_MATCH_STATES)[number];

export const DECISION_STATES = [
  "MATCH",
  "MATCH_WITH_WARNINGS",
  "INSUFFICIENT_DATA",
  "EXCLUDED",
  "CONFLICT",
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const ENGINEERING_ELIGIBILITY_STATES = [
  "ELIGIBLE",
  "ELIGIBLE_WITH_WARNINGS",
  "INSUFFICIENT_DATA",
  "EXCLUDED",
  "CONFLICT",
] as const;
export type EngineeringEligibilityState = (typeof ENGINEERING_ELIGIBILITY_STATES)[number];

export const VERIFICATION_REQUIREMENTS = [
  "ANY_KNOWN",
  "VERIFIED_SECONDARY",
  "AUTHORITATIVE",
] as const;
export type VerificationRequirement = (typeof VERIFICATION_REQUIREMENTS)[number];

export const VERIFICATION_TIERS = [
  "AUTHORITATIVE",
  "VERIFIED_SECONDARY",
  "UNVERIFIED",
] as const;
export type VerificationTier = (typeof VERIFICATION_TIERS)[number];

export const SOURCE_TYPES = [
  "MANUFACTURER_DATASHEET",
  "MANUFACTURER_MANUAL",
  "MANUFACTURER_WEBSITE",
  "AUTHORIZED_DISTRIBUTOR",
  "MANUAL_VERIFICATION",
  "EXISTING_STRUCTURED_ATTRIBUTE",
  "PRODUCT_DESCRIPTION",
  "LEGACY_IMPORT",
  "UNKNOWN",
] as const;
export type CanonicalSourceType = (typeof SOURCE_TYPES)[number];

export const REQUIREMENT_LEVELS = [
  "REQUIRED_FOR_SELECTION",
  "REQUIRED_FOR_COMPATIBILITY",
  "RECOMMENDED",
  "INFORMATIONAL",
] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export const VALUE_STATUSES = [
  "KNOWN",
  "UNKNOWN",
  "CONFLICT",
  "REVIEW_REQUIRED",
] as const;
export type ValueStatus = (typeof VALUE_STATUSES)[number];

export const IDENTITY_STATUSES = [
  "IDENTIFIED",
  "IDENTITY_PARTIAL",
  "IDENTITY_UNCERTAIN",
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const DATA_COMPLETENESS_STATES = [
  "COMPLETE",
  "PARTIAL",
  "BLOCKED",
] as const;
export type DataCompleteness = (typeof DATA_COMPLETENESS_STATES)[number];

export const PROFILE_SOURCE_VERIFICATION_STATES = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
] as const;
export type ProfileSourceVerification = (typeof PROFILE_SOURCE_VERIFICATION_STATES)[number];

export const COMPATIBILITY_RELATION_TYPES = [
  "COMPATIBLE_WITH",
  "REQUIRED_ACCESSORY",
  "RECOMMENDED_ACCESSORY",
  "OPTIONAL_ACCESSORY",
  "ALTERNATIVE_TO",
  "INCOMPATIBLE_WITH",
] as const;
export type CompatibilityRelationType = (typeof COMPATIBILITY_RELATION_TYPES)[number];

export const COMPATIBILITY_STATES = [
  "CONFIRMED",
  "UNKNOWN",
  "INCOMPATIBLE",
  "NOT_APPLICABLE",
] as const;
export type CompatibilityState = (typeof COMPATIBILITY_STATES)[number];

export const CONDITION_REQUIREMENT_POLICIES = [
  "EXACT",
] as const;
export type ConditionRequirementPolicy = (typeof CONDITION_REQUIREMENT_POLICIES)[number];

export const REQUIREMENT_KINDS = [
  "SELECTION",
  "COMPATIBILITY",
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const CONDITION_SCOPES = [
  "VALUE_OPERATING_POINT",
  "PRODUCT_ANY",
] as const;
export type ConditionScope = (typeof CONDITION_SCOPES)[number];

export const STOCK_STATUSES = [
  "IN_STOCK",
  "OUT_OF_STOCK",
  "UNKNOWN",
] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const COMMERCIAL_AVAILABILITY = [
  "AVAILABLE",
  "UNAVAILABLE",
  "UNKNOWN",
] as const;
export type CommercialAvailability = (typeof COMMERCIAL_AVAILABILITY)[number];

export const REQUEST_SOURCES = [
  "ENGINEERING_CONFIGURATOR",
  "API",
  "MANUAL",
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const REQUIREMENT_EVALUATION_STATUSES = [
  "SATISFIED",
  "MISSING",
  "UNKNOWN",
  "CONFLICT",
  "OUT_OF_RANGE",
  "NOT_APPLICABLE",
] as const;
export type RequirementEvaluationStatus = (typeof REQUIREMENT_EVALUATION_STATUSES)[number];

export const REASON_CODES = [
  "CAPACITY_TOO_LOW",
  "CAPACITY_VALUE_MISSING",
  "CAPACITY_VALUE_UNKNOWN",
  "CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT",
  "CAPACITY_UNIT_MISMATCH",
  "OPERATING_POINT_MISMATCH",
  "OPERATING_POINT_MISSING",
  "OPERATING_POINT_CONFLICT",
  "NO_EXACT_OPERATING_POINT",
  "INSUFFICIENT_SOURCE_VERIFICATION",
  "REQUIRED_PARAMETER_MISSING",
  "REQUIRED_PARAMETER_UNKNOWN",
  "PARAMETER_OUT_OF_RANGE",
  "EQUIPMENT_TYPE_MISMATCH",
  "SERVICE_UNSUPPORTED",
  "DATA_CONFLICT",
  "IDENTITY_UNVERIFIED",
  "PROFILE_IDENTITY_UNCERTAIN",
  "PROFILE_INCOMPLETE",
  "COMPATIBILITY_UNKNOWN",
  "COMPATIBILITY_FAILED",
  "RECOMMENDED_PARAMETER_MISSING",
  "SOURCE_NOT_PROFESSIONALLY_VERIFIED",
  "UNIT_MISMATCH",
  "INTERPOLATION_NOT_ALLOWED",
  "EXTRAPOLATION_NOT_ALLOWED",
  "CONDITION_SUBSTITUTION_NOT_ALLOWED",
  "MULTI_UNIT_TOPOLOGY_NOT_SOLVED",
  "NOMINAL_SIZE_NOT_CAPACITY",
  "REQUEST_INVALID",
  "OUT_OF_STOCK",
  "PRICE_UNKNOWN",
  "COMMERCIAL_UNAVAILABLE",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const CONDITION_KEYS = [
  "outdoor_air_c",
  "indoor_air_dry_bulb_c",
  "indoor_air_wet_bulb_c",
  "water_in_c",
  "water_out_c",
  "water_supply_c",
  "water_return_c",
  "relative_humidity_pct",
  "fan_speed",
  "operating_mode",
  "frequency_hz",
  "load_percent",
  "test_standard",
  "esp_pa",
] as const;
export type CanonicalConditionKey = (typeof CONDITION_KEYS)[number];

export const CANONICAL_PARAMETER_CODES = [
  "accessory_role",
  "airflow",
  "available_head",
  "backup_heater",
  "capacity",
  "capacity_modulation_max",
  "capacity_modulation_min",
  "coil_water_volume",
  "communication",
  "communication_protocol",
  "compatible_equipment",
  "compatible_valves",
  "connection_size",
  "control_algorithms",
  "control_signal",
  "control_type",
  "cooling_capacity",
  "cooling_capacity_sensible",
  "cop",
  "dhw_support",
  "dimensions",
  "dn",
  "drain_connection",
  "eer",
  "electrical_input",
  "electrical_input_current",
  "electrical_power",
  "fail_safe",
  "fan_current",
  "fan_power",
  "flow_meter",
  "flow_range",
  "heating_capacity",
  "hydraulic_connection_size",
  "input_types",
  "insulation",
  "integrated_pump",
  "kvs",
  "material",
  "max_flow",
  "max_head",
  "max_load",
  "max_pressure",
  "max_pressure_drop",
  "max_temperature",
  "max_water_temperature",
  "max_working_pressure",
  "media_temperature_max",
  "media_temperature_min",
  "medium_temperature_max",
  "medium_temperature_min",
  "min_water_temperature_cooling",
  "mounting",
  "mounting_type",
  "nominal_size",
  "number_of_circuits",
  "number_of_plates",
  "number_of_ports",
  "operating_outdoor_max",
  "operating_outdoor_min",
  "output_types",
  "phase_count",
  "pipe_configuration",
  "plate_material",
  "power_supply",
  "pressure_drop",
  "pressure_rating",
  "protection_class",
  "pump_curve",
  "refrigerant",
  "running_time",
  "scop",
  "seer",
  "sensor_type",
  "setpoint_max",
  "setpoint_min",
  "sound_power",
  "sound_pressure",
  "speed_control",
  "stroke",
  "supply_voltage",
  "torque",
  "valve_characteristic",
  "volume",
  "water_flow",
  "water_flow_max",
  "water_flow_min",
  "weight",
] as const;
export type CanonicalParameterCode = (typeof CANONICAL_PARAMETER_CODES)[number];

export const TEST_CASE_IDS = [
  "CM1-01",
  "CM1-02",
  "CM1-03",
  "CM1-04",
  "CM1-05",
  "CM1-06",
  "CM1-07",
  "CM1-08",
  "CM1-09",
  "CM1-10",
  "CM1-11",
  "CM1-12",
  "CM1-13",
  "CM1-14",
  "CM1-15",
  "CM1-16",
  "CM1-17",
  "CM1-18",
  "CM1-19",
  "CM1-20",
  "CM1-21",
  "CM1-22",
  "CM1-23",
  "CM1-24",
  "CM1-25",
  "CM1-26",
  "CM1-27",
] as const;
export type TestCaseId = (typeof TEST_CASE_IDS)[number];


export interface DisplayValue {
  valueNumeric?: number;
  valueText?: string;
  valueBoolean?: boolean;
  unit: string | null;
}

export interface CapacityRequirement {
  parameterCode: CanonicalParameterCode;
  requiredValue: number;
  unit: string;
  comparisonPolicy: ComparisonPolicy;
  upperValue: number | null;
}

export interface ConditionRequirement {
  conditionKey: CanonicalConditionKey;
  valueNumeric: number | null;
  valueText: string | null;
  valueBoolean: boolean | null;
  unit: string | null;
  matchPolicy: ConditionRequirementPolicy;
}

export interface ParameterRequirement {
  parameterCode: CanonicalParameterCode;
  requirementKind: RequirementKind;
  conditionScope: ConditionScope;
}

export interface ParameterPreference {
  parameterCode: CanonicalParameterCode;
  preferredValue: DisplayValue | null;
  conditionContext: ConditionRequirement[];
}

export interface ParameterExclusion {
  parameterCode: CanonicalParameterCode;
  excludedValue: DisplayValue | null;
  reason: string;
}

export interface CompatibilityTarget {
  productId: number | null;
  equipmentType: CanonicalEquipmentType | null;
  parameterCode: CanonicalParameterCode | null;
}

export interface CompatibilityRequirement {
  relationType: CompatibilityRelationType;
  target: CompatibilityTarget;
  required: boolean;
}

export interface ProjectContext {
  projectId: string | null;
  roomId: string | null;
  systemId: string | null;
  source: RequestSource;
}

export interface CatalogMatchRequest {
  matcherModelId: typeof MATCHER_MODEL_ID;
  matcherModelVersion: typeof MATCHER_MODEL_VERSION;
  schemaVersion: typeof ENGINEERING_SCHEMA_VERSION;
  policyId: typeof MATCHER_POLICY_ID;
  policyVersion: string;
  selectionMode: SelectionMode;
  equipmentType: CanonicalEquipmentType;
  service: Service;
  requiredCapacity: CapacityRequirement | null;
  operatingConditions: ConditionRequirement[];
  requiredParameters: ParameterRequirement[];
  preferredParameters: ParameterPreference[];
  excludedParameters: ParameterExclusion[];
  compatibilityRequirements: CompatibilityRequirement[];
  requiredVerificationTier: VerificationRequirement;
  requireExactOperatingPoint: boolean;
  allowInterpolation: boolean;
  allowExtrapolation: boolean;
  designMarginPercent: number;
  maxCandidates: number;
  maxDiagnosticResults: number;
  projectContext: ProjectContext | null;
}

export interface RequirementEvaluation {
  parameterCode: CanonicalParameterCode;
  requirementLevel: RequirementLevel;
  status: RequirementEvaluationStatus;
  matchedValueCount: number;
}

export interface RequirementGap {
  parameterCode: CanonicalParameterCode;
  requirementLevel: RequirementLevel;
  reasonCode: ReasonCode;
}

export interface OperatingPointEvaluation {
  overall: ConditionMatchState;
  requested: ConditionRequirement[];
  actual: ConditionRequirement[];
  perKey: Partial<Record<CanonicalConditionKey, ConditionMatchState>>;
}

export interface MatchedValue {
  parameterCode: CanonicalParameterCode;
  value: DisplayValue;
  conditionSetCode: string | null;
  operatingPoint: ConditionRequirement[];
  valueStatus: ValueStatus;
  sourceType: CanonicalSourceType | null;
  verificationTier: VerificationTier | null;
}

export interface VerificationSummary {
  sourceType: CanonicalSourceType | null;
  verificationTier: VerificationTier | null;
  professionalEligible: boolean;
  identityStatus: IdentityStatus;
  dataCompleteness: DataCompleteness;
  profileSourceVerification: ProfileSourceVerification;
}

export interface CompatibilityEvaluation {
  relationType: CompatibilityRelationType;
  state: CompatibilityState;
  target: CompatibilityTarget;
  reasonCode: ReasonCode | null;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface CommercialData {
  stockStatus: StockStatus;
  price: Money | null;
  commercialAvailability: CommercialAvailability;
}

export interface Warning {
  code: ReasonCode;
  message: string;
  parameter: CanonicalParameterCode | null;
  conditionContext: ConditionRequirement[];
}

export interface ReasonDetail {
  code: ReasonCode;
  parameter: CanonicalParameterCode | null;
  required: DisplayValue | null;
  actual: DisplayValue | null;
  conditionContext: ConditionRequirement[];
  humanMessage: string;
}

export interface CandidateExplanation {
  decision: DecisionState;
  humanSummary: string;
  reasonDetails: ReasonDetail[];
}

export interface CandidateEvaluation {
  productId: number;
  sku: string;
  equipmentType: CanonicalEquipmentType;
  decision: DecisionState;
  engineeringEligibility: EngineeringEligibilityState;
  rank: number | null;
  rankScore: number | null;
  rankKey: string[];
  oversizeRatio: number | null;
  matchedValues: MatchedValue[];
  requiredValues: RequirementEvaluation[];
  operatingPoint: OperatingPointEvaluation;
  verification: VerificationSummary;
  compatibility: CompatibilityEvaluation[];
  missingRequirements: RequirementGap[];
  warnings: Warning[];
  reasonCodes: ReasonCode[];
  reasonDetails: ReasonDetail[];
  primaryReason: ReasonCode | null;
  allReasons: ReasonCode[];
  commercialData: CommercialData;
  explanation: CandidateExplanation;
}

export interface MatchSummary {
  productsConsidered: number;
  eligible: number;
  eligibleWithWarnings: number;
  insufficientData: number;
  excluded: number;
  conflicts: number;
}

export interface CatalogMatchResponse {
  matcherModelId: typeof MATCHER_MODEL_ID;
  matcherModelVersion: typeof MATCHER_MODEL_VERSION;
  policyId: typeof MATCHER_POLICY_ID;
  policyVersion: string;
  request: CatalogMatchRequest;
  effectiveRequiredCapacity: number | null;
  summary: MatchSummary;
  candidates: CandidateEvaluation[];
  insufficientData: CandidateEvaluation[];
  excluded: CandidateEvaluation[];
  conflicts: CandidateEvaluation[];
  warnings: Warning[];
}

export const VALUE_SELECTION_STATUSES = [
  "FOUND_ONE",
  "NOT_FOUND",
  "CONFLICT",
  "MULTIPLE_EQUIVALENT",
] as const;
export type ValueSelectionStatus = (typeof VALUE_SELECTION_STATUSES)[number];

export const REQUEST_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNKNOWN_EQUIPMENT_TYPE",
  "UNKNOWN_PARAMETER_CODE",
  "UNKNOWN_CONDITION_KEY",
  "UNKNOWN_SERVICE",
  "INVALID_UNIT",
  "INVALID_MARGIN",
  "INVALID_COMPARISON",
  "UNKNOWN_MATCHER_MODEL",
] as const;
export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

export type ValueType = "NUMERIC" | "TEXT" | "BOOLEAN";

export interface CatalogMatcherRequestError {
  errorCode: RequestErrorCode;
  message: string;
  field: string | null;
  details: string[];
}

export interface CatalogProductRef {
  productId: number;
  sku: string;
  equipmentType: CanonicalEquipmentType;
  /** Presentation only. Never used as engineering capacity. */
  title?: string | null;
  brand?: string | null;
}

export interface CatalogProfileFacts {
  productId: number;
  equipmentType: CanonicalEquipmentType;
  series: string | null;
  model: string | null;
  identityStatus: IdentityStatus;
  dataCompleteness: DataCompleteness;
  sourceVerification: ProfileSourceVerification;
  schemaId: string;
  schemaVersion: string;
}

export interface CatalogSourceFacts {
  sourceKey: string;
  sourceType: CanonicalSourceType;
  verificationTier: VerificationTier;
  manufacturer: string | null;
  documentTitle: string | null;
  documentVersion: string | null;
  url: string | null;
}

export interface CatalogConditionEntryFacts {
  conditionKey: CanonicalConditionKey;
  valueType: ValueType;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  unit: string | null;
}

export interface CatalogConditionSetFacts {
  conditionSetCode: string;
  entries: CatalogConditionEntryFacts[];
}

export interface CatalogValueFacts {
  parameterCode: CanonicalParameterCode;
  requirementLevel: RequirementLevel;
  valueType: ValueType;
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  unit: string | null;
  canonicalUnit: string | null;
  status: ValueStatus;
  confidence: number | null;
  conditionSetCode: string | null;
  sourceKey: string | null;
  sourceType: CanonicalSourceType | null;
  verificationTier: VerificationTier | null;
}

export interface CatalogCompatibilityFact {
  relationType: CompatibilityRelationType;
  targetProductId: number | null;
  targetEquipmentType: CanonicalEquipmentType | null;
  stateHint: CompatibilityState | null;
}

export interface CatalogCommerceFacts {
  stockStatus: StockStatus;
  price: Money | null;
  commercialAvailability: CommercialAvailability;
}

export interface CatalogCandidateFacts {
  product: CatalogProductRef;
  profile: CatalogProfileFacts;
  values: CatalogValueFacts[];
  sources: CatalogSourceFacts[];
  conditionSets: CatalogConditionSetFacts[];
  compatibilityFacts: CatalogCompatibilityFact[];
  commerce: CatalogCommerceFacts;
}

export interface OperatingPointMatchResult {
  overall: ConditionMatchState;
  perKey: Partial<Record<CanonicalConditionKey, ConditionMatchState>>;
  matchedSetCode: string | null;
}

export interface ValueSelectionResult {
  status: ValueSelectionStatus;
  parameterCode: CanonicalParameterCode;
  values: CatalogValueFacts[];
  conditionSetCode: string | null;
  reasonCode: ReasonCode | null;
}

export interface RankTuple {
  decisionQuality: number;
  oversizeRatio: number;
  exactConditionCount: number;
  verificationRank: number;
  completenessRank: number;
  preferredMatches: number;
  productId: number;
}
