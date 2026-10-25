import realTest from 'node:test';
import assert from 'node:assert/strict';

// Integration test against a RUNNING server. There is deliberately no default target: set
// OHMX_SEARCH_BASE_URL to a disposable instance (never the production service) to run it.
const BASE_URL = process.env.OHMX_SEARCH_BASE_URL;
const test = BASE_URL
  ? realTest
  : (name, fn) => realTest(name, { skip: 'integration test: set OHMX_SEARCH_BASE_URL to a disposable server' }, fn);

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response.json();
}

async function search(q, params = {}) {
  const url = new URL('/api/search', BASE_URL);
  url.searchParams.set('q', q);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url.pathname}${url.search} returned ${response.status}`);
  return response.json();
}

function productIds(result) {
  return (result.products || []).map((product) => product.id);
}

function assertSearchShape(result) {
  assert.equal(typeof result.query, 'string');
  assert.ok(Array.isArray(result.products));
  assert.ok(Array.isArray(result.documents));
  assert.equal(typeof result.pagination, 'object');
  assert.equal(typeof result.pagination.total, 'number');
}

function assertNoDuplicateProducts(result) {
  const ids = productIds(result);
  assert.equal(new Set(ids).size, ids.length);
}

test('health endpoint is available for live search regression tests', async () => {
  const health = await getJson('/api/health');
  assert.equal(health.ok, true);
});

test('exact SKU keeps product 24545 as the first result', async () => {
  const result = await search('41221');
  assertSearchShape(result);
  assertNoDuplicateProducts(result);
  assert.equal(result.products[0]?.id, 24545);
  assert.equal(result.products[0]?.sku, '41221');
  assert.equal(result.products[0]?.category_id, 910130);
  assert.equal(result.products[0]?.primary_category_id, 910130);
  assert.equal(result.products[0]?.category_name, 'Домофоны и дверные звонки');
});

test('Cyrillic case variants return the same ordered product set and include 24545', async () => {
  const lower = await search('звонок');
  const title = await search('Звонок');
  const upper = await search('ЗВОНОК');

  for (const result of [lower, title, upper]) {
    assertSearchShape(result);
    assertNoDuplicateProducts(result);
  }

  assert.deepEqual(productIds(title), productIds(lower));
  assert.deepEqual(productIds(upper), productIds(lower));
  assert.equal(title.pagination.total, lower.pagination.total);
  assert.equal(upper.pagination.total, lower.pagination.total);

  const hit = lower.products.find((product) => product.id === 24545);
  assert.ok(hit, '24545 should be present for звонок');
  assert.equal(hit.name_ru, 'Звонок - Legrand Lido - белый');
  assert.equal(hit.category_id, 910130);
  assert.equal(hit.primary_category_id, 910130);
});

test('domain-specific Cyrillic search still finds video intercom product 26722', async () => {
  const result = await search('домофон');
  assertSearchShape(result);
  assertNoDuplicateProducts(result);
  assert.ok(result.products.some((product) => product.id === 26722 && product.sku === '369330'));
});

test('Latin brand search is case-insensitive', async () => {
  const lower = await search('legrand');
  const upper = await search('LEGRAND');
  assertSearchShape(lower);
  assertSearchShape(upper);
  assert.equal(upper.pagination.total, lower.pagination.total);
  assert.deepEqual(productIds(upper), productIds(lower));
});

test('miss query and wildcard-looking literals keep JSON shape and do not expand as wildcards', async () => {
  const miss = await search('___no_such_product_zzz___');
  assertSearchShape(miss);
  assert.equal(miss.pagination.total, 0);

  for (const q of ['%', '_', '100%', 'A_B', '\\', '%_test']) {
    const result = await search(q);
    assertSearchShape(result);
    assertNoDuplicateProducts(result);
    assert.ok(result.pagination.total < 1000, `${q} expanded suspiciously to ${result.pagination.total} results`);
  }
});

test('pagination shape is stable', async () => {
  const page1 = await search('legrand', { page: 1, limit: 5 });
  const page2 = await search('legrand', { page: 2, limit: 5 });
  assert.equal(page1.products.length, 5);
  assert.equal(page2.products.length, 5);
  assert.equal(page1.pagination.limit, 5);
  assert.equal(page2.pagination.page, 2);
  assert.equal(page2.pagination.hasPrevPage, true);
  assert.equal(new Set([...productIds(page1), ...productIds(page2)]).size, 10);
});

test('empty query returns the documented empty shape', async () => {
  const result = await search('');
  assertSearchShape(result);
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.documents, []);
  assert.equal(result.pagination.total, 0);
});
