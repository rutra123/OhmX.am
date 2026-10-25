/**
 * CM5 orchestration/service tests. Isolated fixture/facts. Not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateCatalogCandidate } from './evaluator.js';
import { baseFanCoilRequest, fanCoilFacts, heatPumpRequest, value } from './catalogMatcherFixtures.js';
import { createCatalogMatcherFixture } from './catalogMatcherSqliteFixture.js';
import { loadCatalogCandidates } from './queryAdapter.js';
import { matchCatalogProducts, validateCatalogMatchRequest } from './service.js';
import type { CatalogCandidateFacts, CatalogMatchRequest, CandidateEvaluation } from './types.js';

const dir = dirname(fileURLToPath(import.meta.url));

function assertOk(result: ReturnType<typeof matchCatalogProducts>) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected ok result');
  return result.response;
}

function withProduct(facts: CatalogCandidateFacts, productId: number, sku: string): CatalogCandidateFacts {
  return {
    ...facts,
    product: { ...facts.product, productId, sku },
    profile: { ...facts.profile, productId },
  };
}

function bucketIds(rows: CandidateEvaluation[]): number[] {
  return rows.map((row) => row.productId);
}

function allIds(response: ReturnType<typeof assertOk>): number[] {
  return [
    ...bucketIds(response.candidates),
    ...bucketIds(response.insufficientData),
    ...bucketIds(response.excluded),
    ...bucketIds(response.conflicts),
  ];
}

function summarySum(response: ReturnType<typeof assertOk>): number {
  const s = response.summary;
  return s.eligible + s.eligibleWithWarnings + s.insufficientData + s.excluded + s.conflicts;
}

test('SVC-01 unknown equipment type is REQUEST_ERROR not exclusion', () => {
  let loaded = false;
  const request = { ...baseFanCoilRequest(), equipmentType: 'NOT_A_TYPE' } as CatalogMatchRequest;
  const result = matchCatalogProducts(request, { loadCandidates: () => { loaded = true; return []; } });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'REQUEST_ERROR');
  assert.equal(result.error.errorCode, 'UNKNOWN_EQUIPMENT_TYPE');
  assert.equal(loaded, false);
});

test('SVC-02 unknown parameter code is REQUEST_ERROR', () => {
  const request = {
    ...baseFanCoilRequest(),
    requiredCapacity: {
      parameterCode: 'not_a_param',
      requiredValue: 2.8,
      unit: 'kW',
      comparisonPolicy: 'AT_LEAST',
      upperValue: null,
    },
  } as CatalogMatchRequest;
  const result = matchCatalogProducts(request, { loadCandidates: () => [] });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'REQUEST_ERROR');
  assert.equal(result.error.errorCode, 'UNKNOWN_PARAMETER_CODE');
});

test('SVC-03 invalid unit is REQUEST_ERROR', () => {
  const result = matchCatalogProducts(
    baseFanCoilRequest({
      requiredCapacity: {
        parameterCode: 'cooling_capacity',
        requiredValue: 2.8,
        unit: '   ',
        comparisonPolicy: 'AT_LEAST',
        upperValue: null,
      },
    }),
    { loadCandidates: () => [] },
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'REQUEST_ERROR');
  assert.equal(result.error.errorCode, 'INVALID_UNIT');
});

test('SVC-04 unknown condition key is REQUEST_ERROR', () => {
  const request = {
    ...baseFanCoilRequest(),
    operatingConditions: [
      {
        conditionKey: 'not_a_key',
        valueNumeric: 7,
        valueText: null,
        valueBoolean: null,
        unit: '°C',
        matchPolicy: 'EXACT',
      },
    ],
  } as CatalogMatchRequest;
  const result = matchCatalogProducts(request, { loadCandidates: () => [] });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'REQUEST_ERROR');
  assert.equal(result.error.errorCode, 'UNKNOWN_CONDITION_KEY');
});

test('SVC-05 invalid request fields do not become candidate exclusions', () => {
  const invalid = validateCatalogMatchRequest(baseFanCoilRequest({ maxCandidates: 0 }));
  assert.ok(invalid);
  assert.equal(invalid?.errorCode, 'INVALID_REQUEST');
  const margin = matchCatalogProducts(
    baseFanCoilRequest({ designMarginPercent: -1 }),
    { loadCandidates: () => { throw new Error('must not load'); } },
  );
  assert.equal(margin.ok, false);
  if (margin.ok) throw new Error('expected failure');
  assert.equal(margin.kind, 'REQUEST_ERROR');
  assert.equal(margin.error.errorCode, 'INVALID_MARGIN');
});

test('SVC-06 empty candidate set returns zero summary', () => {
  const db = createCatalogMatcherFixture();
  const response = assertOk(matchCatalogProducts(
    baseFanCoilRequest({
      equipmentType: 'CIRCULATION_PUMP',
      service: 'HYDRONIC_FLOW',
      requiredCapacity: null,
      requiredParameters: [],
    }),
    { db },
  ));
  assert.equal(response.summary.productsConsidered, 0);
  assert.equal(summarySum(response), 0);
  assert.deepEqual(response.candidates, []);
  assert.deepEqual(response.insufficientData, []);
  assert.deepEqual(response.excluded, []);
  assert.deepEqual(response.conflicts, []);
  db.close();
});

test('SVC-07 PILOT A BPS 2.8 kW EXCLUDED CAPACITY_TOO_LOW', () => {
  const db = createCatalogMatcherFixture();
  const response = assertOk(matchCatalogProducts(baseFanCoilRequest(), { db }));
  assert.equal(response.summary.productsConsidered, 1);
  assert.equal(response.summary.excluded, 1);
  assert.equal(response.summary.eligible, 0);
  assert.equal(response.candidates.length, 0);
  assert.equal(response.excluded.length, 1);
  assert.equal(response.excluded[0]?.productId, 24244);
  assert.equal(response.excluded[0]?.decision, 'EXCLUDED');
  assert.equal(response.excluded[0]?.primaryReason, 'CAPACITY_TOO_LOW');
  db.close();
});

test('SVC-08 PILOT B BPS 1.8 kW MATCH_WITH_WARNINGS not MATCH', () => {
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
  const response = assertOk(matchCatalogProducts(request, { db }));
  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0]?.decision, 'MATCH_WITH_WARNINGS');
  assert.notEqual(response.candidates[0]?.decision, 'MATCH');
  assert.equal(response.summary.eligibleWithWarnings, 1);
  assert.equal(response.summary.eligible, 0);
  db.close();
});

test('SVC-09 PILOT C Riello A7/W35 INSUFFICIENT_DATA missing capacity', () => {
  const db = createCatalogMatcherFixture();
  const response = assertOk(matchCatalogProducts(heatPumpRequest(), { db }));
  assert.equal(response.summary.productsConsidered, 1);
  assert.equal(response.summary.insufficientData, 1);
  assert.equal(response.insufficientData[0]?.decision, 'INSUFFICIENT_DATA');
  assert.equal(response.insufficientData[0]?.primaryReason, 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT');
  assert.equal(response.insufficientData[0]?.matchedValues.find((row) => row.parameterCode === 'heating_capacity'), undefined);
  db.close();
});

function fiveBucketFacts(): CatalogCandidateFacts[] {
  const match = withProduct(fanCoilFacts(), 11, 'MATCH-11');
  const warned = withProduct(fanCoilFacts({
    values: fanCoilFacts().values.filter((row) => row.parameterCode !== 'sound_pressure' && row.parameterCode !== 'sound_power'),
  }), 22, 'WARN-22');
  const missing = withProduct(fanCoilFacts({
    values: fanCoilFacts().values.filter((row) => row.parameterCode !== 'cooling_capacity'),
  }), 33, 'MISS-33');
  const excluded = withProduct(fanCoilFacts({
    values: fanCoilFacts().values.map((row) => (row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 2.0 } : row)),
  }), 44, 'EXCL-44');
  const conflict = withProduct(fanCoilFacts({
    values: [...fanCoilFacts().values, value({ parameterCode: 'cooling_capacity', numeric: 2.2, sourceKey: 'src-other' })],
  }), 55, 'CONF-55');
  return [conflict, excluded, match, missing, warned];
}

test('SVC-10 five decision buckets grouping and ranks', () => {
  const request = baseFanCoilRequest();
  const response = assertOk(matchCatalogProducts(request, { loadCandidates: () => fiveBucketFacts() }));
  assert.deepEqual(response.candidates.map((row) => row.decision), ['MATCH', 'MATCH_WITH_WARNINGS']);
  assert.deepEqual(bucketIds(response.candidates), [11, 22]);
  assert.equal(response.candidates[0]?.rank, 1);
  assert.equal(response.candidates[1]?.rank, 2);
  assert.equal(response.insufficientData[0]?.decision, 'INSUFFICIENT_DATA');
  assert.equal(response.excluded[0]?.decision, 'EXCLUDED');
  assert.equal(response.conflicts[0]?.decision, 'CONFLICT');
  assert.equal(response.excluded[0]?.rank, null);
  assert.equal(response.candidates[0]?.rank, 1);
});

test('SVC-11 summary arithmetic equals productsConsidered', () => {
  const response = assertOk(matchCatalogProducts(baseFanCoilRequest(), { loadCandidates: () => fiveBucketFacts() }));
  assert.equal(response.summary.productsConsidered, 5);
  assert.equal(response.summary.eligible, 1);
  assert.equal(response.summary.eligibleWithWarnings, 1);
  assert.equal(response.summary.insufficientData, 1);
  assert.equal(response.summary.excluded, 1);
  assert.equal(response.summary.conflicts, 1);
  assert.equal(summarySum(response), response.summary.productsConsidered);
});

test('SVC-12 deterministic ordering independent of input order', () => {
  const request = baseFanCoilRequest();
  const a = assertOk(matchCatalogProducts(request, { loadCandidates: () => fiveBucketFacts() }));
  const b = assertOk(matchCatalogProducts(request, { loadCandidates: () => [...fiveBucketFacts()].reverse() }));
  assert.equal(JSON.stringify(a.candidates.map((row) => row.productId)), JSON.stringify(b.candidates.map((row) => row.productId)));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('SVC-13 no duplicate product IDs across buckets', () => {
  const response = assertOk(matchCatalogProducts(baseFanCoilRequest(), { loadCandidates: () => fiveBucketFacts() }));
  const ids = allIds(response);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 5);
});

test('SVC-14 maxCandidates truncates eligible array not summary', () => {
  const request = baseFanCoilRequest({ maxCandidates: 1, maxDiagnosticResults: 1 });
  const extras = [
    withProduct(fanCoilFacts(), 11, 'A'),
    withProduct(fanCoilFacts(), 12, 'B'),
    withProduct(fanCoilFacts({
      values: fanCoilFacts().values.map((row) => (row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 2.0 } : row)),
    }), 44, 'E'),
    withProduct(fanCoilFacts({
      values: fanCoilFacts().values.map((row) => (row.parameterCode === 'cooling_capacity' ? { ...row, numeric: 1.5 } : row)),
    }), 45, 'F'),
  ];
  const response = assertOk(matchCatalogProducts(request, { loadCandidates: () => extras }));
  assert.equal(response.summary.eligible, 2);
  assert.equal(response.summary.excluded, 2);
  assert.equal(response.candidates.length, 1);
  assert.equal(response.excluded.length, 1);
  assert.equal(summarySum(response), 4);
  assert.equal(response.summary.productsConsidered, 4);
});

test('SVC-15 commerce does not change engineering MATCH', () => {
  const facts = withProduct(fanCoilFacts({
    commerce: { stockStatus: 'OUT_OF_STOCK', price: null, commercialAvailability: 'UNAVAILABLE' },
  }), 11, 'COMM-11');
  const response = assertOk(matchCatalogProducts(baseFanCoilRequest(), { loadCandidates: () => [facts] }));
  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0]?.decision, 'MATCH');
  assert.equal(response.excluded.length, 0);
  assert.equal(response.candidates[0]?.commercialData.stockStatus, 'OUT_OF_STOCK');
  assert.equal(response.candidates[0]?.commercialData.price, null);
});

test('SVC-16 adapter error is DATABASE_READ_ERROR not INSUFFICIENT_DATA', () => {
  const result = matchCatalogProducts(baseFanCoilRequest(), {
    loadCandidates: () => {
      throw new Error('sqlite read failed');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'DATABASE_READ_ERROR');
  assert.notEqual(result.kind, 'REQUEST_ERROR');
});

test('SVC-17 evaluator result is preserved through the service', () => {
  const db = createCatalogMatcherFixture();
  const request = baseFanCoilRequest();
  const response = assertOk(matchCatalogProducts(request, { db }));
  const facts = loadCatalogCandidates(db, request)[0];
  assert.ok(facts);
  const direct = evaluateCatalogCandidate(request, facts);
  assert.equal(response.excluded[0]?.decision, direct.decision);
  assert.equal(response.excluded[0]?.primaryReason, direct.primaryReason);
  assert.equal(response.excluded[0]?.engineeringEligibility, direct.engineeringEligibility);
  db.close();
});

test('SVC-18 service uses read-only query adapter only', () => {
  const text = readFileSync(join(dir, 'service.ts'), 'utf8');
  assert.match(text, /loadCatalogCandidates/);
  assert.match(text, /openCatalogMatcherDatabase/);
  assert.equal(text.includes('electro.db'), false);
  assert.equal(text.includes('../db'), false);
  assert.equal(text.includes('dist/db'), false);
  assert.equal(text.includes('INSERT INTO'), false);
  assert.equal(text.includes('CREATE INDEX'), false);
});

test('SVC-19 service does not duplicate engineering policy', () => {
  const text = readFileSync(join(dir, 'service.ts'), 'utf8');
  assert.match(text, /evaluateCatalogCandidate/);
  assert.match(text, /rankEligibleCandidates/);
  assert.equal(text.includes('CAPACITY_TOO_LOW'), false);
  assert.equal(text.includes('CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT'), false);
  assert.equal(text.includes('available >='), false);
  assert.equal(text.includes('Date.now'), false);
  assert.equal(text.includes('Math.random'), false);
});

test('SVC-20 allowInterpolation is a response warning not REQUEST_ERROR', () => {
  const result = matchCatalogProducts(
    baseFanCoilRequest({ allowInterpolation: true }),
    { loadCandidates: () => [] },
  );
  const response = assertOk(result);
  assert.equal(response.warnings.some((row) => row.code === 'INTERPOLATION_NOT_ALLOWED'), true);
});

test('SVC-21 missing service options is MATCHER_INTERNAL_ERROR', () => {
  const result = matchCatalogProducts(baseFanCoilRequest());
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.kind, 'MATCHER_INTERNAL_ERROR');
});
