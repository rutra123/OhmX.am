/**
 * CM3 pure evaluator tests. Intentionally not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCatalogCandidate } from './evaluator.js';
import { matchOperatingPoint } from './operatingPoint.js';
import { rankEligibleCandidates } from './ranking.js';
import { selectApplicableEngineeringValue } from './valueSelection.js';
import {
  A7W35,
  baseFanCoilRequest,
  bpsFacts,
  coolSet,
  fanCoilFacts,
  heatPumpRequest,
  value,
} from './catalogMatcherFixtures.js';

test('EV-01 exact professional match', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    requiredCapacity: { parameterCode: 'cooling_capacity', requiredValue: 2.8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
  }), fanCoilFacts());
  assert.equal(result.decision, 'MATCH');
  assert.equal(result.engineeringEligibility, 'ELIGIBLE');
  assert.equal(result.rankScore, null);
});

test('EV-02 insufficient capacity', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), fanCoilFacts({
    values: fanCoilFacts().values.map((row) => row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 2.0 } : row),
  }));
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'CAPACITY_TOO_LOW');
});

test('EV-03 missing capacity', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.filter((row) => row.parameterCode !== 'cooling_capacity'),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.ok(result.allReasons.includes('CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT') || result.allReasons.includes('CAPACITY_VALUE_MISSING'));
});

test('EV-04 missing capacity at requested operating point / wrong OP', () => {
  const facts = fanCoilFacts();
  const request = baseFanCoilRequest({
    operatingConditions: [
      { conditionKey: 'fan_speed', valueNumeric: null, valueText: 'HIGH', valueBoolean: null, unit: null, matchPolicy: 'EXACT' },
      { conditionKey: 'water_in_c', valueNumeric: 45, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
      { conditionKey: 'water_out_c', valueNumeric: 40, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
      { conditionKey: 'indoor_air_dry_bulb_c', valueNumeric: 27, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
      { conditionKey: 'indoor_air_wet_bulb_c', valueNumeric: 19, valueText: null, valueBoolean: null, unit: '°C', matchPolicy: 'EXACT' },
    ],
  });
  const result = evaluateCatalogCandidate(request, facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.equal(result.primaryReason, 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT');
  assert.ok(result.allReasons.includes('OPERATING_POINT_MISMATCH'));
});

test('EV-05 missing condition', () => {
  const set = coolSet();
  set.entries = set.entries.filter((entry) => entry.conditionKey !== 'indoor_air_wet_bulb_c');
  const facts = fanCoilFacts({ conditionSets: [set] });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.ok(
    result.allReasons.includes('CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT') ||
    result.allReasons.includes('OPERATING_POINT_MISSING'),
  );
});

test('EV-06 insufficient source verification professional', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.map((row) => ({ ...row, verificationTier: 'UNVERIFIED' as const, sourceType: 'PRODUCT_DESCRIPTION' as const })),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.ok(result.allReasons.includes('INSUFFICIENT_SOURCE_VERIFICATION'));
});

test('EV-07 preliminary warning match for unverified source', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.map((row) => ({ ...row, verificationTier: 'UNVERIFIED' as const, sourceType: 'PRODUCT_DESCRIPTION' as const })),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest({ selectionMode: 'PRELIMINARY' }), facts);
  assert.equal(result.decision, 'MATCH_WITH_WARNINGS');
  assert.ok(result.allReasons.includes('SOURCE_NOT_PROFESSIONALLY_VERIFIED'));
});

test('EV-08 conflicting values', () => {
  const base = fanCoilFacts();
  const facts = fanCoilFacts({
    values: [
      ...base.values,
      value({ parameterCode: 'cooling_capacity', numeric: 2.2, sourceKey: 'src-other' }),
    ],
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'CONFLICT');
  assert.equal(result.primaryReason, 'DATA_CONFLICT');
});

test('EV-09 required parameter missing airflow', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.filter((row) => row.parameterCode !== 'airflow'),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.ok(result.allReasons.includes('REQUIRED_PARAMETER_MISSING'));
});

test('EV-10 recommended parameter missing', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.filter((row) => row.parameterCode !== 'sound_pressure' && row.parameterCode !== 'sound_power'),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'MATCH_WITH_WARNINGS');
  assert.ok(result.allReasons.includes('RECOMMENDED_PARAMETER_MISSING'));
});

test('EV-11 equipment type mismatch', () => {
  const facts = fanCoilFacts({
    product: { productId: 90001, sku: 'SYN-FC-001', equipmentType: 'HEAT_PUMP' },
    profile: { ...fanCoilFacts().profile, equipmentType: 'HEAT_PUMP' },
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'EQUIPMENT_TYPE_MISMATCH');
});

test('EV-12 service mismatch', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({ service: 'DHW' }), fanCoilFacts());
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'SERVICE_UNSUPPORTED');
});

test('EV-13 multiple legitimate operating points do not MAX', () => {
  const facts = bpsFacts();
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    requiredCapacity: { parameterCode: 'cooling_capacity', requiredValue: 1.8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
  }), facts);
  const cooling = result.matchedValues.find((row) => row.parameterCode === 'cooling_capacity');
  assert.equal(cooling?.value.valueNumeric, 2.0);
  assert.notEqual(cooling?.value.valueNumeric, 4.91);
});

test('EV-14 compatibility UNKNOWN when required', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    compatibilityRequirements: [{
      relationType: 'COMPATIBLE_WITH',
      target: { productId: 1, equipmentType: null, parameterCode: null },
      required: true,
    }],
  }), fanCoilFacts());
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.ok(result.allReasons.includes('COMPATIBILITY_UNKNOWN'));
  assert.equal(result.compatibility[0]?.state, 'UNKNOWN');
});

test('EV-15 explicit incompatibility', () => {
  const facts = fanCoilFacts({
    compatibilityFacts: [{
      relationType: 'INCOMPATIBLE_WITH',
      targetProductId: 99,
      targetEquipmentType: null,
      stateHint: 'INCOMPATIBLE',
    }],
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    compatibilityRequirements: [{
      relationType: 'INCOMPATIBLE_WITH',
      target: { productId: 99, equipmentType: null, parameterCode: null },
      required: true,
    }],
  }), facts);
  assert.equal(result.decision, 'EXCLUDED');
  assert.ok(result.allReasons.includes('COMPATIBILITY_FAILED'));
});

test('EV-16 preliminary does not convert under-capacity to MATCH', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.map((row) => row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 1.0 } : row),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest({ selectionMode: 'PRELIMINARY' }), facts);
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'CAPACITY_TOO_LOW');
});

test('EV-17 professional fail-closed on BLOCKED profile', () => {
  const facts = fanCoilFacts({
    profile: { ...fanCoilFacts().profile, dataCompleteness: 'BLOCKED' },
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.notEqual(result.decision, 'MATCH');
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
});

test('EV-18 deterministic reason precedence', () => {
  const facts = fanCoilFacts({
    product: { productId: 1, sku: 'X', equipmentType: 'HEAT_PUMP' },
    profile: { ...fanCoilFacts().profile, equipmentType: 'HEAT_PUMP', dataCompleteness: 'PARTIAL' },
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.primaryReason, 'EQUIPMENT_TYPE_MISMATCH');
  assert.deepEqual(result.allReasons, result.reasonCodes);
  assert.equal(result.primaryReason, result.allReasons[0]);
});

test('EV-19 deterministic ranking by productId tie-break', () => {
  const a = evaluateCatalogCandidate(baseFanCoilRequest(), fanCoilFacts({
    product: { productId: 90020, sku: 'B', equipmentType: 'FAN_COIL' },
    profile: { ...fanCoilFacts().profile, productId: 90020 },
  }));
  const b = evaluateCatalogCandidate(baseFanCoilRequest(), fanCoilFacts({
    product: { productId: 90010, sku: 'A', equipmentType: 'FAN_COIL' },
    profile: { ...fanCoilFacts().profile, productId: 90010 },
  }));
  const ranked = rankEligibleCandidates([a, b]);
  assert.equal(ranked[0]?.productId, 90010);
  assert.equal(ranked[1]?.productId, 90020);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.rankScore, null);
});

test('EV-20 commerce out of stock remains technically eligible', () => {
  const facts = fanCoilFacts({
    commerce: { stockStatus: 'OUT_OF_STOCK', price: null, commercialAvailability: 'UNAVAILABLE' },
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'MATCH');
  assert.ok(result.allReasons.includes('OUT_OF_STOCK'));
  assert.ok(result.allReasons.includes('PRICE_UNKNOWN'));
  assert.equal(result.engineeringEligibility, 'ELIGIBLE');
});

test('EV-21 no interpolation', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    allowInterpolation: true,
    operatingConditions: A7W35,
    equipmentType: 'HEAT_PUMP',
    service: 'HEATING',
    requiredCapacity: { parameterCode: 'heating_capacity', requiredValue: 8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
  }), fanCoilFacts());
  assert.ok(result.allReasons.includes('INTERPOLATION_NOT_ALLOWED'));
  assert.notEqual(result.decision, 'MATCH');
});

test('EV-22 no extrapolation warning when requested', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({ allowExtrapolation: true }), fanCoilFacts());
  assert.ok(result.allReasons.includes('EXTRAPOLATION_NOT_ALLOWED'));
});

test('EV-23 duplicate equivalent values are FOUND_ONE not CONFLICT', () => {
  const base = fanCoilFacts();
  const facts = fanCoilFacts({
    values: [
      ...base.values,
      value({ parameterCode: 'cooling_capacity', numeric: 3.0, sourceKey: 'src-2' }),
    ],
  });
  const selected = selectApplicableEngineeringValue(
    'cooling_capacity',
    baseFanCoilRequest().operatingConditions,
    facts.values,
    facts.conditionSets,
  );
  assert.equal(selected.status, 'MULTIPLE_EQUIVALENT');
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.notEqual(result.decision, 'CONFLICT');
  assert.equal(result.decision, 'MATCH');
});

test('operating point HIGH equals HIGH when a new extra wet-bulb condition is unrequested', () => {
  const set = coolSet();
  set.entries.push({
    conditionKey: 'outdoor_air_wet_bulb_c',
    valueType: 'NUMERIC',
    numeric: 6,
    text: null,
    boolean: null,
    unit: '°C',
  });
  const result = matchOperatingPoint(baseFanCoilRequest().operatingConditions, set);
  assert.equal(result.overall, 'EXACT');
});

test('operating point HIGH does not equal high', () => {
  const set = coolSet();
  const fan = set.entries.find((entry) => entry.conditionKey === 'fan_speed');
  if (fan) fan.text = 'high';
  const result = matchOperatingPoint(baseFanCoilRequest().operatingConditions, set);
  assert.equal(result.overall, 'MISSING');
});

test('70/60 does not satisfy 7/12', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    requiredCapacity: { parameterCode: 'cooling_capacity', requiredValue: 1.8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
  }), bpsFacts());
  const cooling = result.matchedValues.find((row) => row.parameterCode === 'cooling_capacity');
  assert.equal(cooling?.conditionSetCode, 'FC22-COOL-HIGH-7/12');
});

test('explicit 10 percent margin raises effective requirement', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.map((row) => row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 8.5 } : row),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    requiredCapacity: { parameterCode: 'cooling_capacity', requiredValue: 8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
    designMarginPercent: 10,
  }), facts);
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'CAPACITY_TOO_LOW');
  assert.ok(result.oversizeRatio != null && result.oversizeRatio < 1);
});

test('unknown capacity is not zero', () => {
  const facts = fanCoilFacts({
    values: fanCoilFacts().values.map((row) =>
      row.parameterCode === 'cooling_capacity'
        ? { ...row, status: 'UNKNOWN' as const, numeric: null }
        : row,
    ),
  });
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.notEqual(result.primaryReason, 'CAPACITY_TOO_LOW');
});
