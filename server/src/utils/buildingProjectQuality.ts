/**
 * Phase 3.2P-B1 — pure Professional engineering-quality engine.
 *
 * The caller supplies normalized/effective fields and explicit applicability
 * facts. This module does not inspect BuildingProject, resolve live inputs,
 * change load precedence, mutate snapshots, or call computeBuildingLoads.
 */
import type {
  CalculationScope,
  ComputeEngineeringQualityInput,
  CoverageConfirmation,
  EngineeringBlockingField,
  EngineeringCoverage,
  EngineeringCriticality,
  EngineeringProvenance,
  EngineeringQuality,
  EngineeringQualityField,
  EngineeringQualityFieldInput,
  EngineeringQualityMessageCode,
  EngineeringQualityResult,
  EngineeringQualityService,
  QualityGateStatus,
  UseLevel,
} from './buildingProjectTypes.js';

export const QUALITY_MODEL_ID = 'ohmx.professional-quality.v1' as const;
export const QUALITY_MODEL_VERSION = '1.0.0' as const;

const QUALITY_RANK: Readonly<Record<EngineeringQuality, number>> = {
  UNRESOLVED: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  VERIFIED: 4,
};

const ALLOWED_COVERAGE_CONFIRMATIONS: Readonly<
  Record<CalculationScope, readonly CoverageConfirmation[]>
> = {
  WHOLE_OBJECT: [
    'WHOLE_OBJECT_CONFIRMED',
    'WHOLE_OBJECT_WITH_EXCLUSIONS',
    'UNCONFIRMED',
  ],
  SELECTED_ROOMS: ['SELECTED_ROOMS_CONFIRMED', 'UNCONFIRMED'],
  CONDITIONED_ZONES: ['CONDITIONED_ZONES_CONFIRMED', 'UNCONFIRMED'],
  UNKNOWN: ['UNCONFIRMED'],
};

const HEATING_CLIMATE_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'TinHeating',
  'ToutHeatingDesign',
]);

const COOLING_CLIMATE_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'TinCooling',
  'ToutCoolingDesign',
]);

const INFILTRATION_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'infiltrationMethod',
  'infiltrationFlowM3h',
  'airChangesPerHour',
  'ach50',
  'airtightnessClass',
]);

const U_VALUE_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'U_wall',
  'U_roof',
  'U_floor',
  'U_window',
  'U_door',
]);

const ENVELOPE_AREA_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'externalWallAreaM2',
  'windowAreaM2',
  'externalDoorAreaM2',
  'roofExposureAreaM2',
  'groundFloorAreaM2',
  'windowDimensions',
]);

const SOLAR_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'SHGC',
  'shadingFactor',
  'windowOrientation',
  'frameFactor',
  'solarIrradiance',
]);

const PEOPLE_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'occupancy',
  'peopleGainW',
  'occupantSensibleWPerPerson',
]);

const INTERNAL_AREA_PARAMETERS = new Set<EngineeringQualityFieldInput['parameter']>([
  'lightingGainW',
  'equipmentGainW',
]);

/** Deterministic validation error; message is the stable machine-readable code. */
export class EngineeringQualityValidationError extends Error {
  readonly code: 'coverage_invalid_combination';

  constructor(code: 'coverage_invalid_combination') {
    super(code);
    this.name = 'EngineeringQualityValidationError';
    this.code = code;
  }
}

/** Validate the frozen closed scope/confirmation matrix. Ratio is informational. */
export function validateEngineeringCoverage(coverage: EngineeringCoverage): void {
  const allowed = ALLOWED_COVERAGE_CONFIRMATIONS[coverage.scope];
  if (!allowed.includes(coverage.confirmation)) {
    throw new EngineeringQualityValidationError('coverage_invalid_combination');
  }
}

/**
 * DERIVED quality is the minimum/worst parent quality using the frozen order:
 * VERIFIED > HIGH > MEDIUM > LOW > UNRESOLVED.
 */
export function deriveEngineeringQuality(
  parentQualities: readonly EngineeringQuality[],
): EngineeringQuality {
  if (parentQualities.length === 0) return 'UNRESOLVED';
  let worst: EngineeringQuality = 'VERIFIED';
  for (const quality of parentQualities) {
    if (QUALITY_RANK[quality] < QUALITY_RANK[worst]) worst = quality;
  }
  return worst;
}

/** The single frozen baseline provenance → quality mapping. */
export function baselineEngineeringQuality(
  provenance: EngineeringProvenance,
  criticality: EngineeringCriticality,
  derivedParentQualities: readonly EngineeringQuality[] = [],
): EngineeringQuality {
  switch (provenance) {
    case 'MEASURED':
    case 'CERTIFIED_SPEC':
      return 'VERIFIED';
    case 'PROJECT_DOCUMENTATION':
    case 'CALCULATED_FROM_LAYERS':
    case 'VERIFIED_ASSEMBLY':
    case 'AUTHORITATIVE_DATASET':
    case 'NORMATIVE_DEFAULT':
      return 'HIGH';
    case 'EXPLICIT_USER':
      return 'MEDIUM';
    case 'DERIVED':
      return deriveEngineeringQuality(derivedParentQualities);
    case 'PROFILE_DEFAULT':
    case 'LEGACY_SEED':
      return criticality === 'CRITICAL' ? 'LOW' : 'MEDIUM';
    case 'INFERRED':
    case 'FALLBACK':
      return 'LOW';
    case 'UNKNOWN':
      return 'UNRESOLVED';
  }
}

function serviceIsRequested(
  field: Pick<EngineeringQualityFieldInput, 'service'>,
  requestedServices: readonly EngineeringQualityService[],
  requiredService?: EngineeringQualityService,
): boolean {
  if (requiredService) {
    if (field.service && field.service !== requiredService) return false;
    return requestedServices.includes(requiredService);
  }
  return field.service
    ? requestedServices.includes(field.service)
    : requestedServices.length > 0;
}

function kitchenProcessApplies(field: EngineeringQualityFieldInput): boolean {
  const { roomType, livingRoomHasKitchen } = field.applicability;
  return (
    roomType === 'kitchen' ||
    roomType === 'kitchen_living' ||
    (roomType === 'living_room' && livingRoomHasKitchen)
  );
}

/**
 * Frozen parameter × requested-service × applicability × room-type matrix.
 * No area/sensitivity thresholds or inferred element facts are used.
 */
export function determineEngineeringCriticality(
  field: EngineeringQualityFieldInput,
  requestedServices: readonly EngineeringQualityService[],
): EngineeringCriticality {
  const parameter = field.parameter;
  const applicability = field.applicability;

  if (parameter === 'calculationScope' || parameter === 'physicalCompleteness') {
    return 'CRITICAL';
  }
  if (parameter === 'roomType') {
    return applicability.roomLoadCalculated ? 'SUPPORTING' : 'IRRELEVANT';
  }
  if (!applicability.roomLoadCalculated) return 'IRRELEVANT';

  if (HEATING_CLIMATE_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices, 'heating') ? 'CRITICAL' : 'IRRELEVANT';
  }
  if (COOLING_CLIMATE_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices, 'cooling') ? 'CRITICAL' : 'IRRELEVANT';
  }
  if (parameter === 'climate') {
    return serviceIsRequested(field, requestedServices) ? 'CRITICAL' : 'IRRELEVANT';
  }

  if (parameter === 'areaM2' || parameter === 'heightM') {
    return serviceIsRequested(field, requestedServices) ? 'CRITICAL' : 'IRRELEVANT';
  }

  if (INFILTRATION_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices) && applicability.outdoorAirLoadApplicable
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (parameter === 'ventilationFlowM3h') {
    return serviceIsRequested(field, requestedServices) && applicability.mechanicalVentilationUsed
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (U_VALUE_PARAMETERS.has(parameter) || ENVELOPE_AREA_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices) && applicability.elementExists
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (SOLAR_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices, 'cooling') &&
      applicability.solarExposedGlazingExists
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (PEOPLE_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices, 'cooling') &&
      applicability.occupancy != null &&
      applicability.occupancy > 0
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (INTERNAL_AREA_PARAMETERS.has(parameter)) {
    return serviceIsRequested(field, requestedServices, 'cooling') && applicability.roomHasArea
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  if (parameter === 'kitchenProcessSchedule') {
    return serviceIsRequested(field, requestedServices, 'cooling') && kitchenProcessApplies(field)
      ? 'CRITICAL'
      : 'IRRELEVANT';
  }

  return serviceIsRequested(field, requestedServices) ? 'IMPORTANT' : 'IRRELEVANT';
}

/** Apply only the explicit A3 parameter-specific exceptions to the baseline. */
export function classifyEngineeringQuality(
  field: EngineeringQualityFieldInput,
  criticality: EngineeringCriticality,
): EngineeringQuality {
  const baseline = baselineEngineeringQuality(
    field.effectiveProvenance,
    criticality,
    field.derivedParentQualities,
  );

  if (field.effectiveProvenance === 'EXPLICIT_USER') {
    if (
      field.parameter === 'climate' ||
      HEATING_CLIMATE_PARAMETERS.has(field.parameter) ||
      COOLING_CLIMATE_PARAMETERS.has(field.parameter)
    ) {
      return 'HIGH';
    }

    if (
      field.userConfirmed &&
      (field.parameter === 'windowOrientation' ||
        field.parameter === 'windowDimensions' ||
        field.parameter === 'windowAreaM2')
    ) {
      return 'HIGH';
    }

    if (field.parameter === 'kitchenProcessSchedule') return 'HIGH';

    // Confirmation does not promote critical U-values or ACH without evidence.
    if (U_VALUE_PARAMETERS.has(field.parameter)) return 'MEDIUM';
    if (field.parameter === 'airChangesPerHour' || field.parameter === 'ach50') {
      return 'MEDIUM';
    }

    // Frozen A3 confirmation rule for non-critical explicit values.
    if (
      field.userConfirmed &&
      (criticality === 'IMPORTANT' || criticality === 'SUPPORTING')
    ) {
      return 'HIGH';
    }
  }

  // Explicit frozen kitchen 5 W/m² profile exception. The critical baseline is
  // already LOW; this branch keeps the parameter-specific rule visible once.
  if (
    field.effectiveProvenance === 'PROFILE_DEFAULT' &&
    field.parameter === 'equipmentGainW' &&
    field.service === 'cooling' &&
    field.effectiveValue === 5 &&
    field.unit === 'W/m²' &&
    kitchenProcessApplies(field)
  ) {
    return 'LOW';
  }

  return baseline;
}

function qualityAtLeast(actual: EngineeringQuality, required: EngineeringQuality): boolean {
  return QUALITY_RANK[actual] >= QUALITY_RANK[required];
}

function requiredQualityForLevel(
  level: UseLevel,
  criticality: EngineeringCriticality,
): EngineeringQuality {
  if (criticality === 'IRRELEVANT' || criticality === 'SUPPORTING') return 'LOW';
  if (level === 3) return criticality === 'CRITICAL' ? 'HIGH' : 'MEDIUM';
  if (level === 2) return 'MEDIUM';
  return 'LOW';
}

function isSuperseded(field: EngineeringQualityField): boolean {
  return (field.supersededBy?.length ?? 0) > 0;
}

function isGateEffective(field: EngineeringQualityField): boolean {
  return field.criticality !== 'IRRELEVANT' && !isSuperseded(field);
}

function fieldBlocker(
  field: EngineeringQualityField,
  level: UseLevel,
  reasonCode: EngineeringQualityMessageCode,
): EngineeringBlockingField {
  return {
    fieldId: field.fieldId,
    roomId: field.roomId,
    service: field.service,
    parameter: field.parameter,
    reasonCode,
    requiredQuality: requiredQualityForLevel(level, field.criticality),
  };
}

function criticalLevel2Reason(
  field: EngineeringQualityField,
): EngineeringQualityMessageCode | null {
  if (field.effectiveProvenance === 'PROFILE_DEFAULT' || field.effectiveProvenance === 'LEGACY_SEED') {
    return 'critical_profile_default';
  }
  if (field.effectiveProvenance === 'UNKNOWN' || field.quality === 'UNRESOLVED') {
    return 'critical_unresolved';
  }
  if (
    field.effectiveProvenance === 'INFERRED' ||
    field.effectiveProvenance === 'FALLBACK' ||
    field.quality === 'LOW'
  ) {
    return 'critical_low_quality';
  }
  return null;
}

function criticalLevel3Reason(
  field: EngineeringQualityField,
): EngineeringQualityMessageCode | null {
  const level2Reason = criticalLevel2Reason(field);
  if (level2Reason) return level2Reason;
  if (!qualityAtLeast(field.quality, 'HIGH')) return 'critical_below_high_quality';
  return null;
}

function provenanceWarning(
  field: EngineeringQualityField,
): EngineeringQualityMessageCode | null {
  switch (field.effectiveProvenance) {
    case 'PROFILE_DEFAULT':
      return 'profile_default_used';
    case 'INFERRED':
      return 'inferred_value_used';
    case 'FALLBACK':
      return 'fallback_value_used';
    case 'LEGACY_SEED':
      return 'legacy_seed_used';
    case 'UNKNOWN':
      return 'unknown_value_used';
    default:
      return null;
  }
}

interface LevelEvaluation {
  blockingFields: EngineeringBlockingField[];
  warnings: EngineeringQualityMessageCode[];
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

function evaluateLevel(
  level: UseLevel,
  fields: readonly EngineeringQualityField[],
  coverage: EngineeringCoverage,
): LevelEvaluation {
  const blockingFields: EngineeringBlockingField[] = [];
  const warnings: EngineeringQualityMessageCode[] = [];

  for (const field of fields) {
    if (!isGateEffective(field)) continue;

    const sourceWarning = provenanceWarning(field);
    if (sourceWarning) pushUnique(warnings, sourceWarning);

    if (level === 2) {
      if (field.criticality === 'CRITICAL') {
        const reason = criticalLevel2Reason(field);
        if (reason) blockingFields.push(fieldBlocker(field, level, reason));
      } else if (field.criticality === 'IMPORTANT' && field.quality === 'MEDIUM') {
        pushUnique(warnings, 'important_medium_warning');
      }
    }

    if (level === 3) {
      if (field.criticality === 'CRITICAL') {
        const reason = criticalLevel3Reason(field);
        if (reason) blockingFields.push(fieldBlocker(field, level, reason));
      } else if (
        field.criticality === 'IMPORTANT' &&
        !qualityAtLeast(field.quality, 'MEDIUM')
      ) {
        blockingFields.push(fieldBlocker(field, level, 'important_below_medium'));
      }
    }
  }

  if (level === 2 && coverage.confirmation === 'UNCONFIRMED') {
    pushUnique(warnings, 'coverage_unconfirmed');
  }

  if (level === 3) {
    if (coverage.scope === 'UNKNOWN') {
      blockingFields.push({
        fieldId: 'coverage',
        parameter: 'calculationScope',
        reasonCode: 'coverage_unknown',
        requiredQuality: 'HIGH',
      });
    } else if (coverage.confirmation === 'UNCONFIRMED') {
      blockingFields.push({
        fieldId: 'coverage',
        parameter: 'calculationScope',
        reasonCode: 'coverage_unconfirmed',
        requiredQuality: 'HIGH',
      });
    }
  }

  return { blockingFields, warnings };
}

function normalizedFields(
  input: ComputeEngineeringQualityInput,
): EngineeringQualityField[] {
  return input.fields.map((field) => {
    const criticality = determineEngineeringCriticality(field, input.requestedServices);
    const quality = classifyEngineeringQuality(field, criticality);
    return {
      fieldId: field.fieldId,
      roomId: field.roomId,
      parameter: field.parameter,
      service: field.service,
      effectiveValue: field.effectiveValue,
      unit: field.unit,
      effectiveProvenance: field.effectiveProvenance,
      userConfirmed: field.userConfirmed,
      quality,
      criticality,
      requiredQuality: requiredQualityForLevel(input.requestedLevel, criticality),
      status: 'ok',
      sourceReference: field.sourceReference,
      supersededBy: field.supersededBy ? [...field.supersededBy] : undefined,
    };
  });
}

function warningForField(
  field: EngineeringQualityField,
  requestedLevel: UseLevel,
): EngineeringQualityMessageCode | null {
  if (!isGateEffective(field)) return null;
  if (
    requestedLevel === 2 &&
    field.criticality === 'IMPORTANT' &&
    field.quality === 'MEDIUM'
  ) {
    return 'important_medium_warning';
  }
  return provenanceWarning(field);
}

function annotateFields(
  fields: readonly EngineeringQualityField[],
  requestedLevel: UseLevel,
  blockers: readonly EngineeringBlockingField[],
): EngineeringQualityField[] {
  const blockerByFieldId = new Map(
    blockers
      .filter((blocker) => blocker.fieldId !== 'coverage' && blocker.fieldId !== 'physicalCompleteness')
      .map((blocker) => [blocker.fieldId, blocker] as const),
  );

  return fields.map((field) => {
    if (isSuperseded(field)) {
      return { ...field, status: 'ok', messageCode: 'superseded_input' };
    }
    if (field.criticality === 'IRRELEVANT') {
      return { ...field, status: 'ok', messageCode: undefined };
    }
    const blocker = blockerByFieldId.get(field.fieldId);
    if (blocker) {
      return { ...field, status: 'blocked', messageCode: blocker.reasonCode };
    }
    const warning = warningForField(field, requestedLevel);
    if (warning) return { ...field, status: 'warning', messageCode: warning };
    return { ...field, status: 'ok', messageCode: undefined };
  });
}

function cloneCoverage(coverage: EngineeringCoverage): EngineeringCoverage {
  return { ...coverage };
}

export interface LegacyEngineeringQualityInput {
  evaluatedAt: string;
  requestedLevel: UseLevel;
  coverage: EngineeringCoverage;
  assumptions?: readonly string[];
}

/** Explicit factory for historical calculations that never ran this model. */
export function createLegacyEngineeringQualityResult(
  input: LegacyEngineeringQualityInput,
): EngineeringQualityResult {
  validateEngineeringCoverage(input.coverage);
  return {
    qualityModelId: QUALITY_MODEL_ID,
    qualityModelVersion: QUALITY_MODEL_VERSION,
    evaluatedAt: input.evaluatedAt,
    requestedLevel: input.requestedLevel,
    maximumEligibleLevel: null,
    gateStatus: 'LEGACY_UNASSESSED',
    coverage: cloneCoverage(input.coverage),
    fields: [],
    blockingFields: [],
    warnings: ['legacy_unassessed'],
    assumptions: [...(input.assumptions ?? [])],
  };
}

/**
 * Pure B1 API. Highest eligibility is computed independently of requestedLevel;
 * warnings and blockers are then rendered for the requested level.
 */
export function computeEngineeringQuality(
  input: ComputeEngineeringQualityInput,
): EngineeringQualityResult {
  validateEngineeringCoverage(input.coverage);

  // Frozen A3.1 order A: legacy wins over physical completeness and field gates.
  if (input.legacyUnassessed) {
    return createLegacyEngineeringQualityResult({
      evaluatedAt: input.evaluatedAt,
      requestedLevel: input.requestedLevel,
      coverage: input.coverage,
      assumptions: input.assumptions,
    });
  }

  const fields = normalizedFields(input);

  // Frozen A3.1 order B: non-legacy physical incompleteness has no eligible level.
  if (!input.physicalCompleteness) {
    const blockingFields: EngineeringBlockingField[] = [{
      fieldId: 'physicalCompleteness',
      parameter: 'physicalCompleteness',
      reasonCode: 'physical_completeness_required',
      requiredQuality: 'LOW',
    }];
    return {
      qualityModelId: QUALITY_MODEL_ID,
      qualityModelVersion: QUALITY_MODEL_VERSION,
      evaluatedAt: input.evaluatedAt,
      requestedLevel: input.requestedLevel,
      maximumEligibleLevel: 0,
      gateStatus: 'BLOCKED',
      coverage: cloneCoverage(input.coverage),
      fields: annotateFields(fields, input.requestedLevel, blockingFields),
      blockingFields,
      warnings: [],
      assumptions: [...(input.assumptions ?? [])],
    };
  }

  // Frozen A3.1 order C: physically complete non-legacy calculations return 1|2|3.
  const level3 = evaluateLevel(3, fields, input.coverage);
  const level2 = evaluateLevel(2, fields, input.coverage);
  const maximumEligibleLevel: UseLevel =
    level3.blockingFields.length === 0
      ? 3
      : level2.blockingFields.length === 0
        ? 2
        : 1;

  const requested = evaluateLevel(input.requestedLevel, fields, input.coverage);
  const gateStatus: QualityGateStatus =
    maximumEligibleLevel < input.requestedLevel
      ? 'BLOCKED'
      : requested.warnings.length > 0
        ? 'PASS_WITH_WARNINGS'
        : 'PASS';

  return {
    qualityModelId: QUALITY_MODEL_ID,
    qualityModelVersion: QUALITY_MODEL_VERSION,
    evaluatedAt: input.evaluatedAt,
    requestedLevel: input.requestedLevel,
    maximumEligibleLevel,
    gateStatus,
    coverage: cloneCoverage(input.coverage),
    fields: annotateFields(fields, input.requestedLevel, requested.blockingFields),
    blockingFields: requested.blockingFields,
    warnings: requested.warnings,
    assumptions: [...(input.assumptions ?? [])],
  };
}
