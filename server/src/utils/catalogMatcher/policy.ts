/**
 * Frozen CM2 matcher policy, embedded as a constant.
 * No filesystem read — evaluator purity requires this.
 */
import type {
  CanonicalEquipmentType,
  CanonicalParameterCode,
  ReasonCode,
  RequirementLevel,
  Service,
  VerificationTier,
} from './types.js';

export const CATALOG_MATCHER_POLICY_ID = 'ohmx.catalog-matcher-policy.v1' as const;
export const CATALOG_MATCHER_POLICY_VERSION = '1.0.0' as const;

export const REASON_PRECEDENCE: readonly ReasonCode[] = [
  'DATA_CONFLICT',
  'OPERATING_POINT_CONFLICT',
  'EQUIPMENT_TYPE_MISMATCH',
  'SERVICE_UNSUPPORTED',
  'PROFILE_IDENTITY_UNCERTAIN',
  'IDENTITY_UNVERIFIED',
  'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT',
  'CAPACITY_VALUE_MISSING',
  'CAPACITY_VALUE_UNKNOWN',
  'OPERATING_POINT_MISSING',
  'OPERATING_POINT_MISMATCH',
  'NO_EXACT_OPERATING_POINT',
  'INSUFFICIENT_SOURCE_VERIFICATION',
  'REQUIRED_PARAMETER_MISSING',
  'REQUIRED_PARAMETER_UNKNOWN',
  'CAPACITY_UNIT_MISMATCH',
  'UNIT_MISMATCH',
  'PARAMETER_OUT_OF_RANGE',
  'CAPACITY_TOO_LOW',
  'COMPATIBILITY_FAILED',
  'NOMINAL_SIZE_NOT_CAPACITY',
  'MULTI_UNIT_TOPOLOGY_NOT_SOLVED',
  'INTERPOLATION_NOT_ALLOWED',
  'EXTRAPOLATION_NOT_ALLOWED',
  'CONDITION_SUBSTITUTION_NOT_ALLOWED',
  'REQUEST_INVALID',
  'PROFILE_INCOMPLETE',
  'RECOMMENDED_PARAMETER_MISSING',
  'SOURCE_NOT_PROFESSIONALLY_VERIFIED',
  'COMPATIBILITY_UNKNOWN',
  'OUT_OF_STOCK',
  'PRICE_UNKNOWN',
  'COMMERCIAL_UNAVAILABLE',
];

export const DECISION_SEVERITY_WORST_TO_BEST = [
  'CONFLICT',
  'EXCLUDED',
  'INSUFFICIENT_DATA',
  'MATCH_WITH_WARNINGS',
  'MATCH',
] as const;

export const PROFESSIONAL_ACCEPTED_TIERS: readonly VerificationTier[] = [
  'AUTHORITATIVE',
  'VERIFIED_SECONDARY',
];

export const ENGINEERING_WARNING_CODES: readonly ReasonCode[] = [
  'PROFILE_INCOMPLETE',
  'RECOMMENDED_PARAMETER_MISSING',
  'COMPATIBILITY_UNKNOWN',
  'SOURCE_NOT_PROFESSIONALLY_VERIFIED',
  'IDENTITY_UNVERIFIED',
];

export const COMMERCE_WARNING_CODES: readonly ReasonCode[] = [
  'OUT_OF_STOCK',
  'PRICE_UNKNOWN',
  'COMMERCIAL_UNAVAILABLE',
];

export const COP_EQUALITY_EPSILON = 1e-4;

export const UNIT_CONVERSIONS: ReadonlyArray<{ from: string; to: string; factor: number }> = [
  { from: 'W', to: 'kW', factor: 0.001 },
  { from: 'kW', to: 'W', factor: 1000 },
  { from: 'L/min', to: 'm³/h', factor: 0.06 },
  { from: 'm³/h', to: 'L/min', factor: 16.6666666667 },
  { from: 'Pa', to: 'kPa', factor: 0.001 },
  { from: 'kPa', to: 'Pa', factor: 1000 },
];

export const SUPPORTED_SERVICES: Readonly<Record<CanonicalEquipmentType, readonly Service[]>> = {
  HEAT_PUMP: ['HEATING', 'COOLING', 'DHW'],
  FAN_COIL: ['HEATING', 'COOLING', 'AIRFLOW'],
  CIRCULATION_PUMP: ['HYDRONIC_FLOW'],
  BUFFER_TANK: ['HEATING', 'COOLING', 'DHW'],
  HYDRAULIC_SEPARATOR: ['HYDRONIC_FLOW'],
  HEAT_EXCHANGER: ['HEATING', 'COOLING'],
  MANIFOLD: ['HYDRONIC_FLOW', 'HEATING'],
  CONTROL_VALVE: ['HYDRONIC_FLOW', 'HEATING', 'COOLING'],
  BALANCING_VALVE: ['HYDRONIC_FLOW'],
  ACTUATOR: ['CONTROL'],
  THERMOSTAT: ['CONTROL'],
  CONTROLLER: ['CONTROL'],
  ACCESSORY: ['OTHER'],
};

export interface ServiceApplicability {
  requiredForSelectionOperatingPoint: CanonicalParameterCode[];
  requiredForSelectionProductLevel: CanonicalParameterCode[];
  notApplicable: CanonicalParameterCode[];
}

const FAN_COOLING: ServiceApplicability = {
  requiredForSelectionOperatingPoint: ['cooling_capacity', 'cooling_capacity_sensible', 'airflow'],
  requiredForSelectionProductLevel: [],
  notApplicable: ['heating_capacity'],
};

const FAN_HEATING: ServiceApplicability = {
  requiredForSelectionOperatingPoint: ['heating_capacity', 'airflow'],
  requiredForSelectionProductLevel: [],
  notApplicable: ['cooling_capacity', 'cooling_capacity_sensible'],
};

const HP_HEATING: ServiceApplicability = {
  requiredForSelectionOperatingPoint: ['heating_capacity', 'cop', 'electrical_input'],
  requiredForSelectionProductLevel: ['max_water_temperature', 'operating_outdoor_min', 'operating_outdoor_max'],
  notApplicable: ['cooling_capacity', 'eer'],
};

const HP_COOLING: ServiceApplicability = {
  requiredForSelectionOperatingPoint: ['cooling_capacity', 'eer', 'electrical_input'],
  requiredForSelectionProductLevel: ['min_water_temperature_cooling', 'operating_outdoor_min', 'operating_outdoor_max'],
  notApplicable: ['heating_capacity', 'cop'],
};

export const SERVICE_APPLICABILITY: Partial<
  Record<CanonicalEquipmentType, Partial<Record<Service, ServiceApplicability>>>
> = {
  FAN_COIL: { COOLING: FAN_COOLING, HEATING: FAN_HEATING },
  HEAT_PUMP: { HEATING: HP_HEATING, COOLING: HP_COOLING },
};

export const PARAMETER_REQUIREMENT_LEVELS: Partial<
  Record<CanonicalEquipmentType, Partial<Record<CanonicalParameterCode, RequirementLevel>>>
> = {
  FAN_COIL: {
    cooling_capacity: 'REQUIRED_FOR_SELECTION',
    cooling_capacity_sensible: 'REQUIRED_FOR_SELECTION',
    heating_capacity: 'REQUIRED_FOR_SELECTION',
    airflow: 'REQUIRED_FOR_SELECTION',
    water_flow: 'RECOMMENDED',
    pressure_drop: 'RECOMMENDED',
    fan_power: 'RECOMMENDED',
    sound_pressure: 'RECOMMENDED',
    sound_power: 'RECOMMENDED',
    drain_connection: 'RECOMMENDED',
    pipe_configuration: 'REQUIRED_FOR_COMPATIBILITY',
    connection_size: 'REQUIRED_FOR_COMPATIBILITY',
    power_supply: 'REQUIRED_FOR_COMPATIBILITY',
    phase_count: 'REQUIRED_FOR_COMPATIBILITY',
    fan_current: 'INFORMATIONAL',
    mounting_type: 'INFORMATIONAL',
    coil_water_volume: 'INFORMATIONAL',
    weight: 'INFORMATIONAL',
    dimensions: 'INFORMATIONAL',
    nominal_size: 'INFORMATIONAL',
  },
  HEAT_PUMP: {
    heating_capacity: 'REQUIRED_FOR_SELECTION',
    cooling_capacity: 'REQUIRED_FOR_SELECTION',
    cop: 'REQUIRED_FOR_SELECTION',
    eer: 'REQUIRED_FOR_SELECTION',
    electrical_input: 'REQUIRED_FOR_SELECTION',
    max_water_temperature: 'REQUIRED_FOR_SELECTION',
    operating_outdoor_min: 'REQUIRED_FOR_SELECTION',
    operating_outdoor_max: 'REQUIRED_FOR_SELECTION',
    scop: 'RECOMMENDED',
    seer: 'RECOMMENDED',
    water_flow_min: 'RECOMMENDED',
    water_flow_max: 'RECOMMENDED',
    sound_power: 'RECOMMENDED',
    refrigerant: 'REQUIRED_FOR_COMPATIBILITY',
    power_supply: 'REQUIRED_FOR_COMPATIBILITY',
    phase_count: 'REQUIRED_FOR_COMPATIBILITY',
    hydraulic_connection_size: 'REQUIRED_FOR_COMPATIBILITY',
    nominal_size: 'INFORMATIONAL',
    dimensions: 'INFORMATIONAL',
    weight: 'INFORMATIONAL',
  },
};

export interface CatalogMatcherPolicy {
  policyId: typeof CATALOG_MATCHER_POLICY_ID;
  policyVersion: typeof CATALOG_MATCHER_POLICY_VERSION;
  matcherModelId: 'ohmx.catalog-matcher.v1';
  matcherModelVersion: '1.0.0';
  reasonPrecedence: readonly ReasonCode[];
}

export const CATALOG_MATCHER_POLICY: CatalogMatcherPolicy = {
  policyId: CATALOG_MATCHER_POLICY_ID,
  policyVersion: CATALOG_MATCHER_POLICY_VERSION,
  matcherModelId: 'ohmx.catalog-matcher.v1',
  matcherModelVersion: '1.0.0',
  reasonPrecedence: REASON_PRECEDENCE,
};

export function getServiceApplicability(
  equipmentType: CanonicalEquipmentType,
  service: Service,
): ServiceApplicability | null {
  return SERVICE_APPLICABILITY[equipmentType]?.[service] ?? null;
}

export function isServiceSupported(equipmentType: CanonicalEquipmentType, service: Service): boolean {
  return (SUPPORTED_SERVICES[equipmentType] ?? []).includes(service);
}
