import type {
  CanonicalParameterCode,
  CatalogCandidateFacts,
  CatalogConditionSetFacts,
  CatalogMatchRequest,
  CatalogValueFacts,
  ConditionRequirement,
  RequirementLevel,
} from './types.js';
import { MATCHER_MODEL_ID, MATCHER_MODEL_VERSION, MATCHER_POLICY_ID } from './types.js';

export const COOL_HIGH_712: ConditionRequirement[] = [
  { conditionKey: 'fan_speed', valueNumeric: null, valueText: 'HIGH', valueBoolean: null, unit: null, matchPolicy: 'EXACT' },
  { conditionKey: 'water_in_c', valueNumeric: 7, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
  { conditionKey: 'water_out_c', valueNumeric: 12, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
  { conditionKey: 'indoor_air_dry_bulb_c', valueNumeric: 27, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
  { conditionKey: 'indoor_air_wet_bulb_c', valueNumeric: 19, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
];

export const A7W35: ConditionRequirement[] = [
  { conditionKey: 'outdoor_air_c', valueNumeric: 7, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
  { conditionKey: 'water_supply_c', valueNumeric: 35, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
];

export function baseFanCoilRequest(overrides: Partial<CatalogMatchRequest> = {}): CatalogMatchRequest {
  return {
    matcherModelId: MATCHER_MODEL_ID,
    matcherModelVersion: MATCHER_MODEL_VERSION,
    schemaVersion: '1.0.0',
    policyId: MATCHER_POLICY_ID,
    policyVersion: '1.0.0',
    selectionMode: 'PROFESSIONAL',
    equipmentType: 'FAN_COIL',
    service: 'COOLING',
    requiredCapacity: {
      parameterCode: 'cooling_capacity',
      requiredValue: 2.8,
      unit: 'kW',
      comparisonPolicy: 'AT_LEAST',
      upperValue: null,
    },
    operatingConditions: COOL_HIGH_712,
    requiredParameters: [
      { parameterCode: 'cooling_capacity', requirementKind: 'SELECTION', conditionScope: 'VALUE_OPERATING_POINT' },
    ],
    preferredParameters: [],
    excludedParameters: [],
    compatibilityRequirements: [],
    requiredVerificationTier: 'VERIFIED_SECONDARY',
    requireExactOperatingPoint: true,
    allowInterpolation: false,
    allowExtrapolation: false,
    designMarginPercent: 0,
    maxCandidates: 20,
    maxDiagnosticResults: 100,
    projectContext: null,
    ...overrides,
  };
}

export function coolSet(code = 'SYN-COOL-HIGH-7/12'): CatalogConditionSetFacts {
  return {
    conditionSetCode: code,
    entries: [
      { conditionKey: 'fan_speed', valueType: 'TEXT', numeric: null, text: 'HIGH', boolean: null, unit: null },
      { conditionKey: 'water_in_c', valueType: 'NUMERIC', numeric: 7, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'water_out_c', valueType: 'NUMERIC', numeric: 12, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'indoor_air_dry_bulb_c', valueType: 'NUMERIC', numeric: 27, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'indoor_air_wet_bulb_c', valueType: 'NUMERIC', numeric: 19, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'operating_mode', valueType: 'TEXT', numeric: null, text: 'cooling', boolean: null, unit: null },
      { conditionKey: 'test_standard', valueType: 'TEXT', numeric: null, text: 'EN 1397', boolean: null, unit: null },
    ],
  };
}

export function heat7060Set(): CatalogConditionSetFacts {
  return {
    conditionSetCode: 'FC22-HEAT-HIGH-70/60',
    entries: [
      { conditionKey: 'fan_speed', valueType: 'TEXT', numeric: null, text: 'HIGH', boolean: null, unit: null },
      { conditionKey: 'water_in_c', valueType: 'NUMERIC', numeric: 70, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'water_out_c', valueType: 'NUMERIC', numeric: 60, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'indoor_air_dry_bulb_c', valueType: 'NUMERIC', numeric: 20, text: null, boolean: null, unit: '°C' },
      { conditionKey: 'operating_mode', valueType: 'TEXT', numeric: null, text: 'heating', boolean: null, unit: null },
    ],
  };
}

export function value(partial: Partial<CatalogValueFacts> & Pick<CatalogValueFacts, 'parameterCode'>): CatalogValueFacts {
  return {
    requirementLevel: 'REQUIRED_FOR_SELECTION',
    valueType: 'NUMERIC',
    numeric: null,
    text: null,
    boolean: null,
    unit: 'kW',
    canonicalUnit: 'kW',
    status: 'KNOWN',
    confidence: 0.95,
    conditionSetCode: 'SYN-COOL-HIGH-7/12',
    sourceKey: 'src-auth',
    sourceType: 'MANUFACTURER_DATASHEET',
    verificationTier: 'AUTHORITATIVE',
    ...partial,
  };
}

function recommendedFanCoilValues(): CatalogValueFacts[] {
  const rec = (code: CanonicalParameterCode, numeric: number, unit: string, level: RequirementLevel = 'RECOMMENDED'): CatalogValueFacts =>
    value({
      parameterCode: code,
      requirementLevel: level,
      numeric,
      unit,
      canonicalUnit: unit,
      conditionSetCode: code === 'fan_power' || code === 'drain_connection' ? null : 'SYN-COOL-HIGH-7/12',
    });
  return [
    rec('water_flow', 0.344, 'm³/h'),
    rec('pressure_drop', 16.3, 'kPa'),
    rec('fan_power', 55, 'W'),
    rec('sound_pressure', 38, 'dB(A)'),
    rec('sound_power', 50, 'dB(A)'),
    rec('drain_connection', 20, 'mm'),
    value({ parameterCode: 'pipe_configuration', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '2-pipe', unit: null, canonicalUnit: null, conditionSetCode: null }),
    value({ parameterCode: 'connection_size', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '1/2 inch F', unit: null, canonicalUnit: null, conditionSetCode: null }),
    value({ parameterCode: 'power_supply', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '230/1/50', unit: null, canonicalUnit: null, conditionSetCode: null }),
    value({ parameterCode: 'phase_count', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'NUMERIC', numeric: 1, unit: null, canonicalUnit: null, conditionSetCode: null }),
  ];
}

export function fanCoilFacts(overrides: Partial<CatalogCandidateFacts> = {}): CatalogCandidateFacts {
  const productId = overrides.product?.productId ?? 90001;
  const base: CatalogCandidateFacts = {
    product: { productId, sku: 'SYN-FC-001', equipmentType: 'FAN_COIL' },
    profile: {
      productId,
      equipmentType: 'FAN_COIL',
      series: 'SYN',
      model: 'FC-TEST',
      identityStatus: 'IDENTIFIED',
      dataCompleteness: 'COMPLETE',
      sourceVerification: 'VERIFIED',
      schemaId: 'ohmx.engineering-product.v1',
      schemaVersion: '1.0.0',
    },
    values: [
      value({ parameterCode: 'cooling_capacity', numeric: 3.0 }),
      value({ parameterCode: 'cooling_capacity_sensible', numeric: 2.4 }),
      value({ parameterCode: 'airflow', numeric: 500, unit: 'm³/h', canonicalUnit: 'm³/h' }),
      ...recommendedFanCoilValues(),
    ],
    sources: [{
      sourceKey: 'src-auth',
      sourceType: 'MANUFACTURER_DATASHEET',
      verificationTier: 'AUTHORITATIVE',
      manufacturer: 'SYN',
      documentTitle: 'Synthetic datasheet',
      documentVersion: '1',
      url: null,
    }],
    conditionSets: [coolSet()],
    compatibilityFacts: [],
    commerce: { stockStatus: 'IN_STOCK', price: { amount: 100000, currency: 'AMD' }, commercialAvailability: 'AVAILABLE' },
  };
  return {
    ...base,
    ...overrides,
    product: overrides.product ?? base.product,
    profile: overrides.profile ?? base.profile,
  };
}

export function bpsFacts(): CatalogCandidateFacts {
  return {
    product: { productId: 24244, sku: '80022011', equipmentType: 'FAN_COIL' },
    profile: {
      productId: 24244,
      equipmentType: 'FAN_COIL',
      series: 'FC',
      model: 'FC22-OM1',
      identityStatus: 'IDENTIFIED',
      dataCompleteness: 'PARTIAL',
      sourceVerification: 'PARTIALLY_VERIFIED',
      schemaId: 'ohmx.engineering-product.v1',
      schemaVersion: '1.0.0',
    },
    values: [
      value({ parameterCode: 'cooling_capacity', numeric: 2.0, conditionSetCode: 'FC22-COOL-HIGH-7/12' }),
      value({ parameterCode: 'cooling_capacity_sensible', numeric: 1.62, conditionSetCode: 'FC22-COOL-HIGH-7/12' }),
      value({ parameterCode: 'airflow', numeric: 400, unit: 'm³/h', canonicalUnit: 'm³/h', conditionSetCode: 'FC22-COOL-HIGH-7/12' }),
      value({ parameterCode: 'heating_capacity', numeric: 4.91, conditionSetCode: 'FC22-HEAT-HIGH-70/60' }),
      value({ parameterCode: 'water_flow', requirementLevel: 'RECOMMENDED', numeric: 0.344, unit: 'm³/h', canonicalUnit: 'm³/h', conditionSetCode: 'FC22-COOL-HIGH-7/12' }),
      value({ parameterCode: 'pressure_drop', requirementLevel: 'RECOMMENDED', numeric: 16.3, unit: 'kPa', canonicalUnit: 'kPa', conditionSetCode: 'FC22-COOL-HIGH-7/12' }),
      value({ parameterCode: 'fan_power', requirementLevel: 'RECOMMENDED', numeric: 55, unit: 'W', canonicalUnit: 'W', conditionSetCode: null }),
      value({ parameterCode: 'drain_connection', requirementLevel: 'RECOMMENDED', numeric: 20, unit: 'mm', canonicalUnit: 'mm', conditionSetCode: null }),
      value({ parameterCode: 'pipe_configuration', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '2-pipe', unit: null, canonicalUnit: null, conditionSetCode: null }),
      value({ parameterCode: 'connection_size', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '1/2 inch F', unit: null, canonicalUnit: null, conditionSetCode: null }),
      value({ parameterCode: 'power_supply', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: '230/1/50-60', unit: null, canonicalUnit: null, conditionSetCode: null }),
    ],
    sources: [{
      sourceKey: 'bps-fc-tech-sheet',
      sourceType: 'MANUFACTURER_DATASHEET',
      verificationTier: 'AUTHORITATIVE',
      manufacturer: 'BPS Tecnologie (Clima)',
      documentTitle: 'Technical sheet FC(E), Serie FC (2-pipe)',
      documentVersion: 'ST_FC_210 8BPS-R00',
      url: 'https://www.bpstecnologie.com/wp-content/uploads/fc-madre-en/1Technical-sheet-FC___E__.pdf',
    }],
    conditionSets: [
      {
        ...coolSet('FC22-COOL-HIGH-7/12'),
      },
      heat7060Set(),
    ],
    compatibilityFacts: [],
    commerce: { stockStatus: 'UNKNOWN', price: { amount: 1, currency: 'AMD' }, commercialAvailability: 'AVAILABLE' },
  };
}

export function rielloFacts(): CatalogCandidateFacts {
  const v = (partial: Partial<CatalogValueFacts> & Pick<CatalogValueFacts, 'parameterCode'>): CatalogValueFacts =>
    value({
      conditionSetCode: null,
      sourceKey: 'riello-nxhm-datasheet',
      sourceType: 'AUTHORIZED_DISTRIBUTOR',
      verificationTier: 'VERIFIED_SECONDARY',
      ...partial,
    });
  return {
    product: { productId: 28761, sku: '20203649', equipmentType: 'HEAT_PUMP' },
    profile: {
      productId: 28761,
      equipmentType: 'HEAT_PUMP',
      series: 'NXHM',
      model: 'NXHM 12',
      identityStatus: 'IDENTIFIED',
      dataCompleteness: 'BLOCKED',
      sourceVerification: 'PARTIALLY_VERIFIED',
      schemaId: 'ohmx.engineering-product.v1',
      schemaVersion: '1.0.0',
    },
    values: [
      v({ parameterCode: 'max_water_temperature', requirementLevel: 'REQUIRED_FOR_SELECTION', numeric: 65, unit: '°C', canonicalUnit: '°C' }),
      v({ parameterCode: 'scop', requirementLevel: 'RECOMMENDED', numeric: 4.67, unit: null, canonicalUnit: null, conditionSetCode: 'SCOP@35' }),
      v({ parameterCode: 'sound_power', requirementLevel: 'RECOMMENDED', numeric: 65, unit: 'dB(A)', canonicalUnit: 'dB(A)' }),
      v({ parameterCode: 'water_flow_min', requirementLevel: 'RECOMMENDED', numeric: 0.7, unit: 'm³/h', canonicalUnit: 'm³/h' }),
      v({ parameterCode: 'water_flow_max', requirementLevel: 'RECOMMENDED', numeric: 2.5, unit: 'm³/h', canonicalUnit: 'm³/h' }),
      v({ parameterCode: 'refrigerant', requirementLevel: 'REQUIRED_FOR_COMPATIBILITY', valueType: 'TEXT', numeric: null, text: 'R32', unit: null, canonicalUnit: null }),
      v({ parameterCode: 'weight', requirementLevel: 'INFORMATIONAL', numeric: 144, unit: 'kg', canonicalUnit: 'kg' }),
      v({ parameterCode: 'dimensions', requirementLevel: 'INFORMATIONAL', valueType: 'TEXT', numeric: null, text: '945x1385x526', unit: 'mm', canonicalUnit: 'mm' }),
      v({ parameterCode: 'nominal_size', requirementLevel: 'INFORMATIONAL', valueType: 'TEXT', numeric: null, text: '12 kW', unit: null, canonicalUnit: null }),
    ],
    sources: [{
      sourceKey: 'riello-nxhm-datasheet',
      sourceType: 'AUTHORIZED_DISTRIBUTOR',
      verificationTier: 'VERIFIED_SECONDARY',
      manufacturer: 'Riello',
      documentTitle: 'Riello NXHM Datasheet',
      documentVersion: null,
      url: 'https://midsummerwholesale.co.uk/pdfs/riello-nxhm-datasheet.pdf',
    }],
    conditionSets: [{
      conditionSetCode: 'SCOP@35',
      entries: [{ conditionKey: 'water_supply_c', valueType: 'NUMERIC', numeric: 35, text: null, boolean: null, unit: '°C' }],
    }],
    compatibilityFacts: [],
    commerce: { stockStatus: 'UNKNOWN', price: { amount: 1, currency: 'AMD' }, commercialAvailability: 'AVAILABLE' },
  };
}

export function heatPumpRequest(): CatalogMatchRequest {
  return {
    ...baseFanCoilRequest({
      equipmentType: 'HEAT_PUMP',
      service: 'HEATING',
      requiredCapacity: {
        parameterCode: 'heating_capacity',
        requiredValue: 8,
        unit: 'kW',
        comparisonPolicy: 'AT_LEAST',
        upperValue: null,
      },
      operatingConditions: A7W35,
      requiredParameters: [
        { parameterCode: 'heating_capacity', requirementKind: 'SELECTION', conditionScope: 'VALUE_OPERATING_POINT' },
      ],
    }),
  };
}

