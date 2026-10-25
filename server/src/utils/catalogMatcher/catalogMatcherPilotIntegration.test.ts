/**
 * CM4 adapter → frozen CM3 evaluator. Isolated fixture, not production DB.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCatalogCandidate } from './evaluator.js';
import { baseFanCoilRequest, heatPumpRequest } from './catalogMatcherFixtures.js';
import { createCatalogMatcherFixture } from './catalogMatcherSqliteFixture.js';
import { loadCatalogCandidates } from './queryAdapter.js';

test('PILOT-INT A BPS 2.8 kW EXCLUDED CAPACITY_TOO_LOW', () => {
  const db = createCatalogMatcherFixture();
  const facts = loadCatalogCandidates(db, baseFanCoilRequest());
  assert.equal(facts.length, 1);
  const result = evaluateCatalogCandidate(baseFanCoilRequest(), facts[0]);
  assert.equal(result.decision, 'EXCLUDED');
  assert.equal(result.primaryReason, 'CAPACITY_TOO_LOW');
  db.close();
});

test('PILOT-INT B BPS 1.8 kW MATCH_WITH_WARNINGS', () => {
  const db = createCatalogMatcherFixture();
  const request = baseFanCoilRequest({
    requiredCapacity: {
      parameterCode: 'cooling_capacity',
      requiredValue: 1.8,
      unit: 'kW',
      comparisonPolicy: 'AT_LEAST',
      upperValue: null,
    },
  });
  const facts = loadCatalogCandidates(db, request);
  const result = evaluateCatalogCandidate(request, facts[0]);
  assert.equal(result.decision, 'MATCH_WITH_WARNINGS');
  db.close();
});

test('PILOT-INT C Riello A7/W35 INSUFFICIENT_DATA missing capacity', () => {
  const db = createCatalogMatcherFixture();
  const request = heatPumpRequest();
  const facts = loadCatalogCandidates(db, request);
  assert.equal(facts.length, 1);
  const result = evaluateCatalogCandidate(request, facts[0]);
  assert.equal(result.decision, 'INSUFFICIENT_DATA');
  assert.equal(result.primaryReason, 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT');
  db.close();
});
