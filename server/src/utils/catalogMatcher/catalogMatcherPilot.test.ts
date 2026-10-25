/**
 * CM3 pilot fixtures. Copied EPD facts — no production DB.
 * Intentionally not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCatalogCandidate } from './evaluator.js';
import { baseFanCoilRequest, bpsFacts, heatPumpRequest, rielloFacts } from './catalogMatcherFixtures.js';

test('PILOT A BPS 2.8 kW is EXCLUDED CAPACITY_TOO_LOW', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), bpsFacts());
  assert.equal(result.productId, 24244);
  assert.equal(result.sku, '80022011');
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'CAPACITY_TOO_LOW');
  assert.equal(result.engineeringEligibility, 'EXCLUDED');
  const cooling = result.matchedValues.find((row) => row.parameterCode === 'cooling_capacity');
  assert.equal(cooling?.value.valueNumeric, 2.0);
  assert.equal(cooling?.verificationTier, 'AUTHORITATIVE');
  assert.equal(result.operatingPoint.overall, 'EXACT');
});

test('PILOT B BPS 1.8 kW is MATCH_WITH_WARNINGS', () => {
  const result = evaluateCatalogCandidate(baseFanCoilRequest({
    requiredCapacity: { parameterCode: 'cooling_capacity', requiredValue: 1.8, unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
  }), bpsFacts());
  assert.equal(result.decision, 'MATCH_WITH_WARNINGS');
  assert.equal(result.engineeringEligibility, 'ELIGIBLE_WITH_WARNINGS');
  assert.ok(result.allReasons.includes('PROFILE_INCOMPLETE'));
  assert.ok(result.allReasons.includes('RECOMMENDED_PARAMETER_MISSING'));
  assert.ok(result.allReasons.includes('COMPATIBILITY_UNKNOWN'));
  assert.equal(result.primaryReason, 'PROFILE_INCOMPLETE');
  assert.notEqual(result.decision, 'MATCH');
});

test('PILOT C Riello A7/W35 is INSUFFICIENT_DATA missing capacity', () => {
  const result = evaluateCatalogCandidate(heatPumpRequest(), rielloFacts());
  assert.equal(result.productId, 28761);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.equal(result.primaryReason, 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT');
  assert.equal(result.matchedValues.find((row) => row.parameterCode === 'heating_capacity'), undefined);
  assert.ok(result.allReasons.includes('NOMINAL_SIZE_NOT_CAPACITY'));
  assert.notEqual(result.primaryReason, 'CAPACITY_TOO_LOW');
});
