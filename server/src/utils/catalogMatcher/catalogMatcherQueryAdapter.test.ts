/**
 * CM4 query adapter tests. Isolated in-memory fixture. Not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseFanCoilRequest, heatPumpRequest } from './catalogMatcherFixtures.js';
import { createCatalogMatcherFixture } from './catalogMatcherSqliteFixture.js';
import {
  MatcherWriteError,
  assertMatcherSqlIsReadOnly,
  loadCatalogCandidates,
  loadCatalogCandidatesWithStats,
  openCatalogMatcherDatabase,
} from './queryAdapter.js';

test('QA-01 FAN_COIL profile loaded', () => {
  const db = createCatalogMatcherFixture();
  const rows = loadCatalogCandidates(db, baseFanCoilRequest());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.product.productId, 24244);
  assert.equal(rows[0]?.product.sku, '80022011');
  assert.equal(rows[0]?.profile.equipmentType, 'FAN_COIL');
  db.close();
});

test('QA-02 HEAT_PUMP profile loaded', () => {
  const db = createCatalogMatcherFixture();
  const rows = loadCatalogCandidates(db, heatPumpRequest());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.product.productId, 28761);
  assert.equal(rows[0]?.profile.dataCompleteness, 'BLOCKED');
  db.close();
});

test('QA-03 empty-value profile still returned', () => {
  const db = createCatalogMatcherFixture();
  const rows = loadCatalogCandidates(db, {
    ...baseFanCoilRequest(),
    equipmentType: 'BALANCING_VALVE',
    service: 'HYDRONIC_FLOW',
    requiredCapacity: null,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.product.productId, 24347);
  assert.equal(rows[0]?.values.length, 0);
  db.close();
});

test('QA-04 multiple operating points preserved', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  const drops = bps?.values.filter((row) => row.parameterCode === 'pressure_drop') ?? [];
  assert.equal(drops.length, 2);
  const sets = new Set(drops.map((row) => row.conditionSetCode));
  assert.equal(sets.has('FC22-COOL-HIGH-7/12'), true);
  assert.equal(sets.has('FC22-HEAT-HIGH-70/60'), true);
  db.close();
});

test('QA-05 sources attached correctly', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  assert.ok(bps && bps.sources.length >= 1);
  assert.equal(bps.sources[0]?.sourceType, 'MANUFACTURER_DATASHEET');
  assert.equal(bps.sources[0]?.verificationTier, 'AUTHORITATIVE');
  db.close();
});

test('QA-06 condition sets attached correctly', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  const cool = bps?.conditionSets.find((set) => set.conditionSetCode === 'FC22-COOL-HIGH-7/12');
  assert.ok(cool);
  assert.equal(cool.entries.some((entry) => entry.conditionKey === 'fan_speed' && entry.text === 'HIGH'), true);
  db.close();
});

test('QA-07 typed numeric/text/boolean condition values preserved', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  const cool = bps?.conditionSets.find((set) => set.conditionSetCode === 'FC22-COOL-HIGH-7/12');
  const water = cool?.entries.find((entry) => entry.conditionKey === 'water_in_c');
  const speed = cool?.entries.find((entry) => entry.conditionKey === 'fan_speed');
  assert.equal(water?.numeric, 7);
  assert.equal(water?.text, null);
  assert.equal(speed?.text, 'HIGH');
  assert.equal(speed?.numeric, null);
  db.close();
});

test('QA-08 batched queries, no N+1', () => {
  const db = createCatalogMatcherFixture();
  const stats = loadCatalogCandidatesWithStats(db, baseFanCoilRequest());
  assert.ok(stats.queryCount <= 4);
  assert.equal(stats.queryNames.includes('profiles'), true);
  assert.equal(stats.queryNames.includes('values'), true);
  assert.equal(stats.queryNames.includes('conditions'), true);
  db.close();
});

test('QA-09 deterministic ordering', () => {
  const db = createCatalogMatcherFixture();
  const a = loadCatalogCandidates(db, baseFanCoilRequest());
  const b = loadCatalogCandidates(db, baseFanCoilRequest());
  assert.deepEqual(
    a.map((row) => row.product.productId),
    b.map((row) => row.product.productId),
  );
  assert.deepEqual(
    a[0]?.values.map((row) => [row.parameterCode, row.conditionSetCode]),
    b[0]?.values.map((row) => [row.parameterCode, row.conditionSetCode]),
  );
  db.close();
});

test('QA-10 missing capacity candidate not filtered out', () => {
  const db = createCatalogMatcherFixture();
  const riello = loadCatalogCandidates(db, heatPumpRequest())[0];
  assert.ok(riello);
  assert.equal(riello.values.some((row) => row.parameterCode === 'heating_capacity'), false);
  db.close();
});

test('QA-11 PARTIAL and BLOCKED profiles not filtered out', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  const hp = loadCatalogCandidates(db, heatPumpRequest())[0];
  assert.equal(bps?.profile.dataCompleteness, 'PARTIAL');
  assert.equal(hp?.profile.dataCompleteness, 'BLOCKED');
  db.close();
});

test('QA-12 commerce unknown stays unknown', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  assert.equal(bps?.commerce.stockStatus, 'UNKNOWN');
  assert.equal(bps?.commerce.commercialAvailability, 'UNKNOWN');
  db.close();
});

test('QA-13 compatibility empty stays empty/unknown', () => {
  const db = createCatalogMatcherFixture();
  const bps = loadCatalogCandidates(db, baseFanCoilRequest())[0];
  assert.equal(bps?.compatibilityFacts.length, 0);
  db.close();
});

test('QA-14 adapter performs no writes', () => {
  assert.throws(() => assertMatcherSqlIsReadOnly('INSERT INTO products (id) VALUES (1)'), MatcherWriteError);
  assert.throws(() => assertMatcherSqlIsReadOnly('CREATE INDEX x ON products(id)'), MatcherWriteError);
  const db = createCatalogMatcherFixture();
  const before = Number((db.prepare('SELECT COUNT(*) AS c FROM engineering_value').get() as { c: number }).c);
  loadCatalogCandidates(db, baseFanCoilRequest());
  const after = Number((db.prepare('SELECT COUNT(*) AS c FROM engineering_value').get() as { c: number }).c);
  assert.equal(before, after);
  db.close();
});

test('QA-15 title is not parsed as capacity', () => {
  const db = createCatalogMatcherFixture();
  const hp = loadCatalogCandidates(db, heatPumpRequest())[0];
  assert.ok(hp?.product.title?.includes('12 кВт'));
  assert.equal(hp.values.some((row) => row.parameterCode === 'heating_capacity'), false);
  assert.equal(hp.values.some((row) => row.parameterCode === 'nominal_size' && row.numeric === 12), false);
  db.close();
});

test('QA-16 readonly file connection rejects writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm4-'));
  const path = join(dir, 'fixture.db');
  const seed = createCatalogMatcherFixture();
  writeFileSync(path, seed.serialize());
  seed.close();
  const readonly = openCatalogMatcherDatabase(path);
  assert.throws(() => readonly.exec('INSERT INTO brands (id, name) VALUES (9, \'x\')'), MatcherWriteError);
  readonly.close();
});
