/**
 * CM13 — Building Project engineering-selection prerequisite helpers.
 *
 * Pure persistence-boundary normalization / validation / equality for the
 * CM12-frozen "live prerequisites":
 *   - explicit calculation coverage intent / confirmation
 *   - system engineering design inputs (hydronic / wet-bulb / fan-speed) + provenance
 *
 * This module has NO fs, NO db, NO network, and never imports or calls the
 * adapter (`buildEngineeringConfiguratorInput`), the Configurator
 * (`configureHeatPumpFanCoil`), or the Catalog Matcher. It only shapes and
 * validates the authoritative persisted inputs.
 *
 * Vocabulary parity: the design-input shape mirrors the frozen CM10/CM12
 * `SystemEngineeringDesignInputs` contract (buildingProjectConfiguratorAdapter/
 * types.ts) field-for-field, adapted to mutable persisted DTO arrays.
 */
import type {
  BuildingProject,
  CalculationScope,
  CoverageConfirmation,
  CoverageIntent,
  HydronicDesignConditions,
  CoolingIndoorDesignCondition,
  FanCoilSizingPolicyInput,
  NumericEngineeringDesignInput,
  TextEngineeringDesignInput,
  SystemEngineeringDesignInputs,
  EngineeringDesignInputSource,
  EngineeringDesignInputProvenance,
  EngineeringDesignPolicyReference,
} from './buildingProjectTypes.js';

/** Validation error carrying a stable machine code, mirrored by the route error handler. */
export class EngineeringSelectionInputError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'EngineeringSelectionInputError';
    this.code = code;
    this.details = details;
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new EngineeringSelectionInputError(code, message, details);
}

const CALCULATION_SCOPES: readonly CalculationScope[] = [
  'WHOLE_OBJECT',
  'SELECTED_ROOMS',
  'CONDITIONED_ZONES',
  'UNKNOWN',
];

const COVERAGE_CONFIRMATIONS: readonly CoverageConfirmation[] = [
  'WHOLE_OBJECT_CONFIRMED',
  'SELECTED_ROOMS_CONFIRMED',
  'CONDITIONED_ZONES_CONFIRMED',
  'WHOLE_OBJECT_WITH_EXCLUSIONS',
  'UNCONFIRMED',
];

const DESIGN_PROVENANCE: readonly EngineeringDesignInputProvenance[] = [
  'USER_INPUT',
  'SYSTEM_POLICY',
  'PILOT_REFERENCE',
];

function isDesignProvenance(value: unknown): value is EngineeringDesignInputProvenance {
  return DESIGN_PROVENANCE.includes(value as EngineeringDesignInputProvenance);
}

function dedupeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next || out.includes(next)) continue;
    out.push(next);
  }
  return out;
}

function normalizeRequestedServices(values: unknown): Array<'heating' | 'cooling'> {
  if (!Array.isArray(values)) return [];
  const out: Array<'heating' | 'cooling'> = [];
  for (const value of values) {
    if (value === 'heating' || value === 'cooling') {
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

function normalizePolicyReference(
  rawPolicy: unknown,
  source: EngineeringDesignInputProvenance,
  fieldPath: string,
): EngineeringDesignPolicyReference | null {
  if (source === 'USER_INPUT') {
    if (rawPolicy != null) {
      fail('engineering.design_input_policy_unexpected', `${fieldPath}: USER_INPUT must not carry a policyReference`, { fieldPath });
    }
    return null;
  }
  const p = rawPolicy as { policyId?: unknown; policyVersion?: unknown; entryId?: unknown } | null | undefined;
  if (!p || typeof p !== 'object') {
    fail('engineering.design_input_policy_required', `${fieldPath}: ${source} requires a policyReference`, { fieldPath });
  }
  const policyId = typeof p.policyId === 'string' && p.policyId.trim() ? p.policyId : null;
  const policyVersion = typeof p.policyVersion === 'string' && p.policyVersion.trim() ? p.policyVersion : null;
  const entryId = typeof p.entryId === 'string' && p.entryId.trim() ? p.entryId : null;
  if (!policyId || !policyVersion || !entryId) {
    fail('engineering.design_input_policy_required', `${fieldPath}: ${source} policyReference requires policyId, policyVersion, entryId`, { fieldPath });
  }
  return { policyId, policyVersion, entryId };
}

function normalizeProvenanceSource(rawSource: unknown, fieldPath: string): EngineeringDesignInputProvenance {
  if (!isDesignProvenance(rawSource)) {
    fail('engineering.design_input_source_invalid', `${fieldPath}: invalid source`, { fieldPath, source: rawSource });
  }
  return rawSource;
}

function unresolvedNumeric(): NumericEngineeringDesignInput {
  return {
    value: null,
    unit: '°C',
    source: 'UNRESOLVED',
    sourceReference: null,
    policyReference: null,
    status: 'REQUIRED_POLICY_INPUT',
  };
}

function normalizeNumericDesignInput(raw: unknown, fieldPath: string): NumericEngineeringDesignInput {
  if (raw == null) return unresolvedNumeric();
  if (typeof raw !== 'object') fail('engineering.design_input_invalid', `${fieldPath}: expected an object`, { fieldPath });
  const obj = raw as { value?: unknown; unit?: unknown; source?: unknown; sourceReference?: unknown; policyReference?: unknown };
  const value = obj.value;
  if (value == null) return unresolvedNumeric();
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('engineering.design_input_nonfinite', `${fieldPath}: value must be a finite number`, { fieldPath, value });
  }
  if (obj.unit !== '°C') {
    fail('engineering.design_input_unit_invalid', `${fieldPath}: unit must be °C`, { fieldPath, unit: obj.unit });
  }
  const source = normalizeProvenanceSource(obj.source, fieldPath);
  const policyReference = normalizePolicyReference(obj.policyReference, source, fieldPath);
  return {
    value,
    unit: '°C',
    source,
    sourceReference: typeof obj.sourceReference === 'string' && obj.sourceReference ? obj.sourceReference : null,
    policyReference,
    status: 'RESOLVED',
  };
}

function unresolvedText(): TextEngineeringDesignInput {
  return {
    value: null,
    unit: null,
    source: 'UNRESOLVED',
    sourceReference: null,
    policyReference: null,
    status: 'REQUIRED_POLICY_INPUT',
  };
}

function normalizeTextDesignInput(raw: unknown, fieldPath: string): TextEngineeringDesignInput {
  if (raw == null) return unresolvedText();
  if (typeof raw !== 'object') fail('engineering.design_input_invalid', `${fieldPath}: expected an object`, { fieldPath });
  const obj = raw as { value?: unknown; unit?: unknown; source?: unknown; sourceReference?: unknown; policyReference?: unknown };
  const value = obj.value;
  if (value == null) return unresolvedText();
  if (typeof value !== 'string' || value.trim() === '') {
    fail('engineering.fan_speed_invalid', `${fieldPath}: value must be a non-empty string`, { fieldPath, value });
  }
  if (obj.unit != null) {
    fail('engineering.design_input_unit_invalid', `${fieldPath}: unit must be null`, { fieldPath, unit: obj.unit });
  }
  const source = normalizeProvenanceSource(obj.source, fieldPath);
  const policyReference = normalizePolicyReference(obj.policyReference, source, fieldPath);
  return {
    value,
    unit: null,
    source,
    sourceReference: typeof obj.sourceReference === 'string' && obj.sourceReference ? obj.sourceReference : null,
    policyReference,
    status: 'RESOLVED',
  };
}

function normalizeHydronicDesignConditions(raw: unknown): HydronicDesignConditions {
  const h = (raw ?? {}) as {
    heatingWaterSupplyC?: unknown;
    heatingWaterReturnC?: unknown;
    coolingWaterSupplyC?: unknown;
    coolingWaterReturnC?: unknown;
  };
  const heatingWaterSupplyC = normalizeNumericDesignInput(h.heatingWaterSupplyC, 'hydronicDesignConditions.heatingWaterSupplyC');
  const heatingWaterReturnC = normalizeNumericDesignInput(h.heatingWaterReturnC, 'hydronicDesignConditions.heatingWaterReturnC');
  const coolingWaterSupplyC = normalizeNumericDesignInput(h.coolingWaterSupplyC, 'hydronicDesignConditions.coolingWaterSupplyC');
  const coolingWaterReturnC = normalizeNumericDesignInput(h.coolingWaterReturnC, 'hydronicDesignConditions.coolingWaterReturnC');

  // Seasonal ordering applies only when BOTH seasonal leaves are resolved; a
  // missing leaf stays unresolved and never fabricates or rejects a partial save.
  if (
    heatingWaterSupplyC.value != null
    && heatingWaterReturnC.value != null
    && heatingWaterSupplyC.value <= heatingWaterReturnC.value
  ) {
    fail('engineering.hydronic_heating_order_invalid', 'Hydronic heating: supply temperature must exceed return temperature');
  }
  if (
    coolingWaterSupplyC.value != null
    && coolingWaterReturnC.value != null
    && coolingWaterSupplyC.value >= coolingWaterReturnC.value
  ) {
    fail('engineering.hydronic_cooling_order_invalid', 'Hydronic cooling: supply temperature must be below return temperature');
  }

  return { heatingWaterSupplyC, heatingWaterReturnC, coolingWaterSupplyC, coolingWaterReturnC };
}

function normalizeCoolingIndoorDesignCondition(raw: unknown): CoolingIndoorDesignCondition {
  const c = (raw ?? {}) as { indoorCoolingWetBulbC?: unknown };
  return {
    indoorCoolingWetBulbC: normalizeNumericDesignInput(c.indoorCoolingWetBulbC, 'coolingIndoorDesignCondition.indoorCoolingWetBulbC'),
  };
}

function normalizeFanCoilSizingPolicyInput(raw: unknown): FanCoilSizingPolicyInput {
  const f = (raw ?? {}) as { sizingFanSpeed?: unknown };
  return {
    sizingFanSpeed: normalizeTextDesignInput(f.sizingFanSpeed, 'fanCoilSizingPolicy.sizingFanSpeed'),
  };
}

/** Normalize a full system engineering design input payload to the persisted shape. */
export function normalizeSystemEngineeringDesignInputs(raw: unknown): SystemEngineeringDesignInputs {
  const input = (raw ?? {}) as {
    hydronicDesignConditions?: unknown;
    coolingIndoorDesignCondition?: unknown;
    fanCoilSizingPolicy?: unknown;
  };
  return {
    hydronicDesignConditions: normalizeHydronicDesignConditions(input.hydronicDesignConditions),
    coolingIndoorDesignCondition: normalizeCoolingIndoorDesignCondition(input.coolingIndoorDesignCondition),
    fanCoilSizingPolicy: normalizeFanCoilSizingPolicyInput(input.fanCoilSizingPolicy),
  };
}

/** Deterministic semantic equality of two normalized design-input payloads. */
export function engineeringDesignInputsEqual(
  a: SystemEngineeringDesignInputs | null | undefined,
  b: SystemEngineeringDesignInputs | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Normalized payloads carry fixed key order and fully-populated leaves, so
  // canonical JSON stringification is a stable semantic comparison.
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Coverage intent
// ---------------------------------------------------------------------------

export interface CoverageIntentInput {
  calculationScope: CalculationScope;
  coverageConfirmation: CoverageConfirmation;
  includedRoomIds?: string[];
  excludedRoomIds?: string[];
  includedZoneIds?: string[];
  requestedServices?: Array<'heating' | 'cooling'>;
  sourceReference?: string | null;
}

/**
 * Normalize a coverage intent and stamp its confirmation revision from the
 * current building revision. A confirmed intent records the exact current
 * buildingRevisionAtConfirmation; an UNCONFIRMED intent leaves it null.
 */
export function normalizeCoverageIntent(project: BuildingProject, input: CoverageIntentInput): CoverageIntent {
  if (!CALCULATION_SCOPES.includes(input.calculationScope)) {
    fail('building.coverage_scope_invalid', `Unknown calculation scope: ${String(input.calculationScope)}`, { scope: input.calculationScope });
  }
  if (!COVERAGE_CONFIRMATIONS.includes(input.coverageConfirmation)) {
    fail('building.coverage_confirmation_invalid', `Unknown coverage confirmation: ${String(input.coverageConfirmation)}`, { confirmation: input.coverageConfirmation });
  }
  const isConfirmed = input.coverageConfirmation !== 'UNCONFIRMED';
  return {
    calculationScope: input.calculationScope,
    coverageConfirmation: input.coverageConfirmation,
    includedRoomIds: dedupeStrings(input.includedRoomIds),
    excludedRoomIds: dedupeStrings(input.excludedRoomIds),
    includedZoneIds: dedupeStrings(input.includedZoneIds),
    requestedServices: normalizeRequestedServices(input.requestedServices),
    buildingRevisionAtConfirmation: isConfirmed ? project.buildingRevision : null,
    sourceReference: typeof input.sourceReference === 'string' && input.sourceReference ? input.sourceReference : null,
  };
}

/**
 * A prior coverage confirmation no longer certifies the current project once the
 * building revision has moved past the revision recorded at confirmation.
 */
export function isCoverageConfirmationStale(project: BuildingProject): boolean {
  const intent = project.calculationConfiguration?.coverageIntent;
  if (!intent || intent.coverageConfirmation === 'UNCONFIRMED') return false;
  if (intent.buildingRevisionAtConfirmation == null) return false;
  return Number(project.buildingRevision || 0) !== Number(intent.buildingRevisionAtConfirmation);
}

/** `EngineeringDesignInputSource` re-export for consumers needing the literal type. */
export type { EngineeringDesignInputSource };