/**
 * CM6 HTTP API tests. Isolated fixture / injected service. Not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  catalogMatcherTransportErrorHandler,
  createCatalogMatcherRouter,
} from '../../routes/catalogMatcher.js';
import { baseFanCoilRequest, heatPumpRequest } from './catalogMatcherFixtures.js';
import { createCatalogMatcherFixture } from './catalogMatcherSqliteFixture.js';
import { matchCatalogProducts, type CatalogMatcherResult } from './service.js';
import type { CatalogMatchRequest } from './types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const MATCH_PATH = '/api/catalog-matcher/match';

function fixtureMatch() {
  const db = createCatalogMatcherFixture();
  const match = (request: CatalogMatchRequest): CatalogMatcherResult =>
    matchCatalogProducts(request, { db });
  return { db, match };
}

function validationMatch() {
  return (request: CatalogMatchRequest): CatalogMatcherResult =>
    matchCatalogProducts(request, { loadCandidates: () => [] });
}

function createApp(match: (request: CatalogMatchRequest) => CatalogMatcherResult) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(catalogMatcherTransportErrorHandler);
  app.use('/api/catalog-matcher', createCatalogMatcherRouter({ match }));
  return app;
}

async function httpJson(
  app: express.Express,
  options: {
    method?: string;
    path?: string;
    body?: unknown;
    raw?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const path = options.path ?? MATCH_PATH;
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.raw != null) {
    headers['content-type'] = options.contentType ?? 'application/json';
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers['content-type'] = options.contentType ?? 'application/json';
    payload = JSON.stringify(options.body);
  }
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: payload,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('API-01 PILOT A BPS 2.8 kW HTTP 200 EXCLUDED CAPACITY_TOO_LOW', async () => {
  const { db, match } = fixtureMatch();
  try {
    const res = await httpJson(createApp(match), { body: baseFanCoilRequest() });
    assert.equal(res.status, 200);
    const body = res.json as { excluded: Array<{ decision: string; primaryReason: string }>; summary: { excluded: number } };
    assert.equal(body.excluded[0]?.decision, 'EXCLUDED');
    assert.equal(body.excluded[0]?.primaryReason, 'CAPACITY_TOO_LOW');
    assert.equal(body.summary.excluded, 1);
  } finally {
    db.close();
  }
});

test('API-02 PILOT B BPS 1.8 kW HTTP 200 MATCH_WITH_WARNINGS', async () => {
  const { db, match } = fixtureMatch();
  try {
    const res = await httpJson(createApp(match), {
      body: baseFanCoilRequest({
        requiredCapacity: {
          parameterCode: 'cooling_capacity',
          requiredValue: 1.8,
          unit: 'kW',
          comparisonPolicy: 'AT_LEAST',
          upperValue: null,
        },
      }),
    });
    assert.equal(res.status, 200);
    const body = res.json as { candidates: Array<{ decision: string }> };
    assert.equal(body.candidates[0]?.decision, 'MATCH_WITH_WARNINGS');
  } finally {
    db.close();
  }
});

test('API-03 PILOT C Riello A7/W35 HTTP 200 INSUFFICIENT_DATA', async () => {
  const { db, match } = fixtureMatch();
  try {
    const res = await httpJson(createApp(match), { body: heatPumpRequest() });
    assert.equal(res.status, 200);
    const body = res.json as {
      insufficientData: Array<{ decision: string; primaryReason: string }>;
    };
    assert.equal(body.insufficientData[0]?.decision, 'INSUFFICIENT_DATA');
    assert.equal(body.insufficientData[0]?.primaryReason, 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT');
  } finally {
    db.close();
  }
});

test('API-04 empty catalog HTTP 200 productsConsidered 0', async () => {
  const { db, match } = fixtureMatch();
  try {
    const res = await httpJson(createApp(match), {
      body: baseFanCoilRequest({
        equipmentType: 'CIRCULATION_PUMP',
        service: 'HYDRONIC_FLOW',
        requiredCapacity: null,
        requiredParameters: [],
      }),
    });
    assert.equal(res.status, 200);
    const body = res.json as { summary: { productsConsidered: number }; candidates: unknown[] };
    assert.equal(body.summary.productsConsidered, 0);
    assert.deepEqual(body.candidates, []);
  } finally {
    db.close();
  }
});

test('API-05 malformed JSON is 400 INVALID_REQUEST', async () => {
  const res = await httpJson(createApp(validationMatch()), { raw: '{not json' });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'INVALID_REQUEST');
  assert.equal(res.text.includes('stack'), false);
});

test('API-06 unknown equipment type is 400 not exclusion', async () => {
  const res = await httpJson(createApp(validationMatch()), {
    body: { ...baseFanCoilRequest(), equipmentType: 'NOT_A_TYPE' },
  });
  assert.equal(res.status, 400);
  const body = res.json as { code: string; excluded?: unknown };
  assert.equal(body.code, 'UNKNOWN_EQUIPMENT_TYPE');
  assert.equal(body.excluded, undefined);
});

test('API-07 unknown parameter code is 400', async () => {
  const res = await httpJson(createApp(validationMatch()), {
    body: {
      ...baseFanCoilRequest(),
      requiredCapacity: {
        parameterCode: 'not_a_param',
        requiredValue: 2.8,
        unit: 'kW',
        comparisonPolicy: 'AT_LEAST',
        upperValue: null,
      },
    },
  });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'UNKNOWN_PARAMETER_CODE');
});

test('API-08 invalid unit is 400', async () => {
  const res = await httpJson(createApp(validationMatch()), {
    body: baseFanCoilRequest({
      requiredCapacity: {
        parameterCode: 'cooling_capacity',
        requiredValue: 2.8,
        unit: '   ',
        comparisonPolicy: 'AT_LEAST',
        upperValue: null,
      },
    }),
  });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'INVALID_UNIT');
});

test('API-09 unknown condition key is 400', async () => {
  const res = await httpJson(createApp(validationMatch()), {
    body: {
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
    },
  });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'UNKNOWN_CONDITION_KEY');
});

test('API-10 missing required fields is 400', async () => {
  const res = await httpJson(createApp(validationMatch()), { body: {} });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.ok(body.code === 'INVALID_REQUEST' || body.code === 'UNKNOWN_MATCHER_MODEL');
});

test('API-11 array body is 400 INVALID_REQUEST', async () => {
  const res = await httpJson(createApp(validationMatch()), { body: [] });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'INVALID_REQUEST');
});

test('API-12 SQL-looking equipmentType is 400 not executed SQL', async () => {
  const res = await httpJson(createApp(validationMatch()), {
    body: { ...baseFanCoilRequest(), equipmentType: "FAN_COIL'; DROP TABLE products;--" },
  });
  assert.equal(res.status, 400);
  const body = res.json as { code: string };
  assert.equal(body.code, 'UNKNOWN_EQUIPMENT_TYPE');
});

test('API-13 DATABASE_READ_ERROR is 503 without path or stack', async () => {
  const match = (): CatalogMatcherResult => ({
    ok: false,
    kind: 'DATABASE_READ_ERROR',
    error: {
      message: 'ENOENT /workspace/app/data/electro.db sqlite fail',
      cause: '/workspace/app/data/electro.db',
    },
  });
  const res = await httpJson(createApp(match), { body: baseFanCoilRequest() });
  assert.equal(res.status, 503);
  const body = res.json as { code: string; error: string };
  assert.equal(body.code, 'DATABASE_READ_ERROR');
  assert.equal(res.text.includes('electro.db'), false);
  assert.equal(res.text.includes('/workspace/app'), false);
  assert.equal(res.text.includes('stack'), false);
  assert.equal(res.text.includes('ENOENT'), false);
});

test('API-14 MATCHER_INTERNAL_ERROR is 500 without stack', async () => {
  const match = (): CatalogMatcherResult => ({
    ok: false,
    kind: 'MATCHER_INTERNAL_ERROR',
    error: { message: 'boom at /workspace/.hermes/node/bin/node', cause: 'Error: boom\n    at service.ts:1' },
  });
  const res = await httpJson(createApp(match), { body: baseFanCoilRequest() });
  assert.equal(res.status, 500);
  const body = res.json as { code: string; error: string };
  assert.equal(body.code, 'MATCHER_INTERNAL_ERROR');
  assert.equal(body.error, 'Catalog matcher internal error');
  assert.equal(res.text.includes('service.ts'), false);
  assert.equal(res.text.includes('.hermes'), false);
});

test('API-15 thrown matcher exception is 500', async () => {
  const match = (): CatalogMatcherResult => {
    throw new Error('secret stack /workspace/app/data/electro.db');
  };
  const res = await httpJson(createApp(match), { body: baseFanCoilRequest() });
  assert.equal(res.status, 500);
  assert.equal(res.text.includes('electro.db'), false);
  assert.equal(res.text.includes('secret stack'), false);
});

test('API-16 GET is not a matcher endpoint', async () => {
  const res = await httpJson(createApp(validationMatch()), { method: 'GET', path: MATCH_PATH });
  assert.notEqual(res.status, 200);
});

test('API-17 repeated POST is deterministic', async () => {
  const { db, match } = fixtureMatch();
  try {
    const app = createApp(match);
    const a = await httpJson(app, { body: baseFanCoilRequest() });
    const b = await httpJson(app, { body: baseFanCoilRequest() });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(JSON.stringify(a.json), JSON.stringify(b.json));
  } finally {
    db.close();
  }
});

test('API-18 route source is read-only transport', () => {
  const text = readFileSync(join(dir, '../../routes/catalogMatcher.ts'), 'utf8');
  assert.match(text, /matchCatalogProducts/);
  assert.equal(text.includes("from '../db.js'"), false);
  assert.equal(text.includes('INSERT'), false);
  assert.equal(text.includes('UPDATE'), false);
  assert.equal(text.includes('CREATE INDEX'), false);
  assert.equal(text.includes('Date.now'), false);
  assert.equal(text.includes('Math.random'), false);
  assert.equal(text.includes('better-sqlite3'), false);
});
