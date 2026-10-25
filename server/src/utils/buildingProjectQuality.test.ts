/**
 * Phase 3.2P-B1 — frozen Professional quality-engine contract tests.
 *
 * Intentionally written but NOT executed in B1. The user owns verification.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EngineeringQualityValidationError,
  baselineEngineeringQuality,
  classifyEngineeringQuality,
  computeEngineeringQuality,
  deriveEngineeringQuality,
  determineEngineeringCriticality,
} from './buildingProjectQuality.js';
import type {
  ComputeEngineeringQualityInput,
  EngineeringCoverage,
  EngineeringFieldApplicability,
  EngineeringProvenance,
  EngineeringQualityFieldInput,
} from './buildingProjectTypes.js';

const EVALUATED_AT = '2026-09-02T00:00:00.000Z';

const CONFIRMED_COVERAGE: EngineeringCoverage = {
  declaredAreaM2: 100,
  modeledAreaM2: 100,
  ratio: 1,
  scope: 'WHOLE_OBJECT',
  confirmation: 'WHOLE_OBJECT_CONFIRMED',
};

const UNCONFIRMED_COVERAGE: EngineeringCoverage = {
  ...CONFIRMED_COVERAGE,
  confirmation: 'UNCONFIRMED',
};

const DEFAULT_APPLICABILITY: EngineeringFieldApplicability = {
  roomLoadCalculated: true,
  elementExists: true,
  outdoorAirLoadApplicable: true,
  solarExposedGlazingExists: true,
  occupancy: 2,
  roomHasArea: true,
  roomType: 'bedroom',
  livingRoomHasKitchen: false,
  mechanicalVentilationUsed: true,
};

type FieldOverrides = Partial<Omit<EngineeringQualityFieldInput, 'applicability'>> & {
  applicability?: Partial<EngineeringFieldApplicability>;
};

function field(overrides: FieldOverrides = {}): EngineeringQualityFieldInput {
  const { applicability, ...rest } = overrides;
  return {
    fieldId: 'room-1:U_wall',
    roomId: 'room-1',
    parameter: 'U_wall',
    service: 'heating',
    effectiveValue: 0.3,
    unit: 'W/(m²·K)',
    effectiveProvenance: 'PROJECT_DOCUMENTATION',
    userConfirmed: false,
    applicability: { ...DEFAULT_APPLICABILITY, ...applicability },
    ...rest,
  };
}

function compute(
  fields: readonly EngineeringQualityFieldInput[],
  overrides: Partial<Omit<ComputeEngineeringQualityInput, 'fields'>> = {},
) {
  return computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['heating'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: CONFIRMED_COVERAGE,
    fields,
    assumptions: [],
    ...overrides,
  });
}

test('baseline provenance mapping is unique and follows frozen A3', () => {
  const expected: ReadonlyArray<readonly [EngineeringProvenance, ReturnType<typeof baselineEngineeringQuality>]> = [
    ['MEASURED', 'VERIFIED'],
    ['CERTIFIED_SPEC', 'VERIFIED'],
    ['PROJECT_DOCUMENTATION', 'HIGH'],
    ['CALCULATED_FROM_LAYERS', 'HIGH'],
    ['VERIFIED_ASSEMBLY', 'HIGH'],
    ['AUTHORITATIVE_DATASET', 'HIGH'],
    ['NORMATIVE_DEFAULT', 'HIGH'],
    ['EXPLICIT_USER', 'MEDIUM'],
    ['INFERRED', 'LOW'],
    ['FALLBACK', 'LOW'],
    ['UNKNOWN', 'UNRESOLVED'],
  ];
  for (const [provenance, quality] of expected) {
    assert.equal(baselineEngineeringQuality(provenance, 'IMPORTANT'), quality, provenance);
  }
  assert.equal(baselineEngineeringQuality('PROFILE_DEFAULT', 'CRITICAL'), 'LOW');
  assert.equal(baselineEngineeringQuality('PROFILE_DEFAULT', 'IMPORTANT'), 'MEDIUM');
  assert.equal(baselineEngineeringQuality('LEGACY_SEED', 'CRITICAL'), 'LOW');
  assert.equal(baselineEngineeringQuality('LEGACY_SEED', 'IMPORTANT'), 'MEDIUM');
});

test('EXPLICIT_USER U-value without evidence remains MEDIUM', () => {
  const input = field({ effectiveProvenance: 'EXPLICIT_USER', userConfirmed: true });
  assert.equal(classifyEngineeringQuality(input, 'CRITICAL'), 'MEDIUM');
});

test('confirmed EXPLICIT_USER window orientation becomes HIGH', () => {
  const input = field({
    fieldId: 'room-1:window-orientation',
    parameter: 'windowOrientation',
    service: 'cooling',
    effectiveValue: 'S',
    unit: undefined,
    effectiveProvenance: 'EXPLICIT_USER',
    userConfirmed: true,
  });
  assert.equal(classifyEngineeringQuality(input, 'CRITICAL'), 'HIGH');
});

test('PROFILE_DEFAULT on a CRITICAL field is LOW', () => {
  const input = field({ effectiveProvenance: 'PROFILE_DEFAULT' });
  assert.equal(classifyEngineeringQuality(input, 'CRITICAL'), 'LOW');
});

test('DERIVED quality inherits the worst parent quality', () => {
  assert.equal(deriveEngineeringQuality(['HIGH', 'HIGH']), 'HIGH');
  assert.equal(deriveEngineeringQuality(['HIGH', 'MEDIUM']), 'MEDIUM');
  assert.equal(deriveEngineeringQuality(['VERIFIED', 'HIGH']), 'HIGH');
  assert.equal(deriveEngineeringQuality(['HIGH', 'UNRESOLVED']), 'UNRESOLVED');
  assert.equal(deriveEngineeringQuality([]), 'UNRESOLVED');
});

test('IRRELEVANT field cannot block or warn', () => {
  const result = compute([
    field({
      effectiveProvenance: 'PROFILE_DEFAULT',
      applicability: { elementExists: false },
    }),
  ]);
  assert.equal(result.fields[0].criticality, 'IRRELEVANT');
  assert.equal(result.maximumEligibleLevel, 3);
  assert.deepEqual(result.blockingFields, []);
  assert.deepEqual(result.warnings, []);
});

test('superseded field is excluded from blockers and warnings', () => {
  const result = compute([
    field({
      fieldId: 'room-1:profile-wall-u',
      effectiveProvenance: 'PROFILE_DEFAULT',
      supersededBy: ['room-1:certified-wall-u'],
    }),
    field({
      fieldId: 'room-1:certified-wall-u',
      effectiveProvenance: 'CERTIFIED_SPEC',
    }),
  ]);
  assert.equal(result.maximumEligibleLevel, 3);
  assert.deepEqual(result.blockingFields, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.fields[0].messageCode, 'superseded_input');
});

test('invalid coverage combination is rejected deterministically', () => {
  assert.throws(
    () => compute([], {
      coverage: {
        ...CONFIRMED_COVERAGE,
        scope: 'SELECTED_ROOMS',
        confirmation: 'WHOLE_OBJECT_CONFIRMED',
      },
    }),
    (error: unknown) =>
      error instanceof EngineeringQualityValidationError &&
      error.code === 'coverage_invalid_combination',
  );
});

test('physicalCompleteness=false and requested Level 1 returns zero and BLOCKED', () => {
  const result = compute([], { requestedLevel: 1, physicalCompleteness: false });
  assert.equal(result.maximumEligibleLevel, 0);
  assert.equal(result.gateStatus, 'BLOCKED');
  assert.equal(result.blockingFields[0].reasonCode, 'physical_completeness_required');
});

test('physicalCompleteness=false and requested Level 3 returns zero and BLOCKED', () => {
  const result = compute([], { requestedLevel: 3, physicalCompleteness: false });
  assert.equal(result.maximumEligibleLevel, 0);
  assert.equal(result.gateStatus, 'BLOCKED');
});

test('non-legacy results never return null', () => {
  const incomplete = compute([], { physicalCompleteness: false });
  const complete = compute([field()]);
  assert.notEqual(incomplete.maximumEligibleLevel, null);
  assert.notEqual(complete.maximumEligibleLevel, null);
});

test('physically complete results never return zero', () => {
  const preliminary = compute([
    field({ effectiveProvenance: 'PROFILE_DEFAULT' }),
  ]);
  assert.notEqual(preliminary.maximumEligibleLevel, 0);
  assert.notEqual(preliminary.maximumEligibleLevel, null);
});

test('Level 1 is eligible when physical completeness is true', () => {
  const result = compute([
    field({ effectiveProvenance: 'PROFILE_DEFAULT' }),
  ], { requestedLevel: 1 });
  assert.equal(result.maximumEligibleLevel, 1);
  assert.equal(result.gateStatus, 'PASS_WITH_WARNINGS');
});

test('Level 2 is blocked by CRITICAL PROFILE_DEFAULT', () => {
  const result = compute([
    field({ effectiveProvenance: 'PROFILE_DEFAULT' }),
  ], { requestedLevel: 2 });
  assert.equal(result.maximumEligibleLevel, 1);
  assert.equal(result.gateStatus, 'BLOCKED');
  assert.ok(result.blockingFields.some((item) => item.reasonCode === 'critical_profile_default'));
});

test('Level 2 UNCONFIRMED coverage is a warning, not a blocker', () => {
  const result = compute([
    field({ effectiveProvenance: 'PROJECT_DOCUMENTATION' }),
  ], { requestedLevel: 2, coverage: UNCONFIRMED_COVERAGE });
  assert.equal(result.maximumEligibleLevel, 2);
  assert.equal(result.gateStatus, 'PASS_WITH_WARNINGS');
  assert.ok(result.warnings.includes('coverage_unconfirmed'));
  assert.ok(!result.blockingFields.some((item) => item.reasonCode === 'coverage_unconfirmed'));
});

test('Level 3 is blocked by UNCONFIRMED coverage', () => {
  const result = compute([
    field({ effectiveProvenance: 'PROJECT_DOCUMENTATION' }),
  ], { requestedLevel: 3, coverage: UNCONFIRMED_COVERAGE });
  assert.equal(result.maximumEligibleLevel, 2);
  assert.equal(result.gateStatus, 'BLOCKED');
  assert.ok(result.blockingFields.some((item) => item.reasonCode === 'coverage_unconfirmed'));
});

test('Level 3 accepts authoritative climate data', () => {
  const result = compute([
    field({
      fieldId: 'climate:heating',
      roomId: undefined,
      parameter: 'climate',
      service: 'heating',
      effectiveValue: 'yerevan-agro',
      unit: undefined,
      effectiveProvenance: 'AUTHORITATIVE_DATASET',
    }),
  ]);
  assert.equal(result.fields[0].quality, 'HIGH');
  assert.equal(result.fields[0].criticality, 'CRITICAL');
  assert.equal(result.maximumEligibleLevel, 3);
  assert.equal(result.gateStatus, 'PASS');
});

test('maximumEligibleLevel is independent of requestedLevel', () => {
  const result = compute([field()], { requestedLevel: 1 });
  assert.equal(result.maximumEligibleLevel, 3);
});

test('requested Level 3 with Level 1 eligible is BLOCKED', () => {
  const result = compute([
    field({ effectiveProvenance: 'PROFILE_DEFAULT' }),
  ], { requestedLevel: 3 });
  assert.equal(result.maximumEligibleLevel, 1);
  assert.equal(result.gateStatus, 'BLOCKED');
});

test('requested Level 1 with Level 3 eligible is PASS', () => {
  const result = compute([field()], { requestedLevel: 1 });
  assert.equal(result.maximumEligibleLevel, 3);
  assert.equal(result.gateStatus, 'PASS');
});

test('legacy state returns null and LEGACY_UNASSESSED before physical gating', () => {
  const result = compute([], {
    legacyUnassessed: true,
    physicalCompleteness: false,
  });
  assert.equal(result.maximumEligibleLevel, null);
  assert.equal(result.gateStatus, 'LEGACY_UNASSESSED');
  assert.deepEqual(result.warnings, ['legacy_unassessed']);
});

test('kitchen cooling PROFILE_DEFAULT equipment is a CRITICAL Level 2 blocker', () => {
  const result = compute([
    field({
      fieldId: 'kitchen-1:equipment-profile',
      roomId: 'kitchen-1',
      parameter: 'equipmentGainW',
      service: 'cooling',
      effectiveValue: 5,
      unit: 'W/m²',
      effectiveProvenance: 'PROFILE_DEFAULT',
      applicability: { roomType: 'kitchen' },
    }),
  ], { requestedLevel: 2, requestedServices: ['cooling'] });
  assert.equal(result.fields[0].criticality, 'CRITICAL');
  assert.equal(result.fields[0].quality, 'LOW');
  assert.equal(result.maximumEligibleLevel, 1);
  assert.equal(result.gateStatus, 'BLOCKED');
});

test('heating-only kitchen process field is IRRELEVANT', () => {
  const input = field({
    fieldId: 'kitchen-1:process',
    roomId: 'kitchen-1',
    parameter: 'kitchenProcessSchedule',
    service: 'cooling',
    effectiveValue: 'evening',
    unit: undefined,
    effectiveProvenance: 'EXPLICIT_USER',
    applicability: { roomType: 'kitchen' },
  });
  assert.equal(determineEngineeringCriticality(input, ['heating']), 'IRRELEVANT');
  const result = compute([input], { requestedServices: ['heating'] });
  assert.equal(result.fields[0].criticality, 'IRRELEVANT');
  assert.deepEqual(result.blockingFields, []);
  assert.deepEqual(result.warnings, []);
});

test('revision-21 quality fixture is only Level 1 eligible', () => {
  const result = compute([
    field({ fieldId: 'room-1:wall-u', effectiveProvenance: 'PROFILE_DEFAULT' }),
    field({
      fieldId: 'room-1:ach',
      parameter: 'airChangesPerHour',
      effectiveValue: 0.8,
      unit: '1/h',
      effectiveProvenance: 'PROFILE_DEFAULT',
    }),
    field({
      fieldId: 'room-1:shgc',
      parameter: 'SHGC',
      service: 'cooling',
      effectiveValue: 0.7,
      unit: 'ratio',
      effectiveProvenance: 'PROFILE_DEFAULT',
    }),
  ], {
    requestedLevel: 3,
    requestedServices: ['heating', 'cooling'],
    coverage: {
      declaredAreaM2: 180,
      modeledAreaM2: 50,
      ratio: 50 / 180,
      scope: 'UNKNOWN',
      confirmation: 'UNCONFIRMED',
    },
  });
  assert.equal(result.maximumEligibleLevel, 1);
  assert.equal(result.gateStatus, 'BLOCKED');
});

test('closed provenance vocabulary has no undefined or retired provenance values', () => {
  const provenances = [
    'MEASURED',
    'CERTIFIED_SPEC',
    'PROJECT_DOCUMENTATION',
    'CALCULATED_FROM_LAYERS',
    'VERIFIED_ASSEMBLY',
    'EXPLICIT_USER',
    'AUTHORITATIVE_DATASET',
    'NORMATIVE_DEFAULT',
    'DERIVED',
    'PROFILE_DEFAULT',
    'INFERRED',
    'LEGACY_SEED',
    'FALLBACK',
    'UNKNOWN',
  ] as const satisfies readonly EngineeringProvenance[];
  assert.equal(provenances.length, 14);
  assert.equal(provenances.map(String).includes('TEST_RESULT'), false);
  assert.equal(provenances.map(String).includes('USER_CONFIRMED'), false);
  const qualities = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNRESOLVED'] as const;
  for (const provenance of provenances) {
    const quality = baselineEngineeringQuality(provenance, 'IMPORTANT', ['HIGH']);
    assert.notEqual(quality, undefined, provenance);
    assert.ok(qualities.includes(quality), provenance);
  }
});

test('userConfirmed never mutates or promotes PROFILE_DEFAULT provenance', () => {
  const result = compute([
    field({
      effectiveProvenance: 'PROFILE_DEFAULT',
      userConfirmed: true,
    }),
  ], { requestedLevel: 2 });
  assert.equal(result.fields[0].effectiveProvenance, 'PROFILE_DEFAULT');
  assert.equal(result.fields[0].quality, 'LOW');
  assert.equal(result.maximumEligibleLevel, 1);
});
