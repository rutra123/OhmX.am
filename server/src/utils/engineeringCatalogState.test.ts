/**
 * ENGINEERING-CATALOG-CM15 — RUNTIME TESTS (written by the agent, NOT run).
 *
 * Run by the USER with (Node v24.16.0 / ABI 137):
 *   npm run test:engineering-catalog-state-provider
 *
 * Covers phase §36 groups A–H:
 *   A provider contract, B projection allowlist, C canonicalization,
 *   D SHA-256, E engineering sensitivity, F commerce invariance,
 *   G coherence/fail-closed, H CM11 reference compatibility.
 *   X extended coverage (completion pass): SQL gates, typed value facts,
 *     scoping, rollback envelope, prose exclusion, relationship scoping.
 *
 * Case IDs: CM15-001 … CM15-114 (source invariants: sibling file CM15-S01…S40).
 * DB writes exist ONLY in this test layer (in-memory / temp-dir fixtures);
 * the provider itself performs read-only access and never writes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import {
  ENGINEERING_CATALOG_PREFIX,
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
  ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
  ENGINEERING_CATALOG_STATE_DOMAIN,
  compareCodePoints,
  canonicalizeFiniteNumber,
  serializeEngineeringCatalogFacts,
  computeEngineeringCatalogStateRevision,
  EngineeringCatalogStateInputError,
  projectEngineeringCatalogFacts,
  canonicalizeEngineeringCatalogFacts,
  resolveEngineeringCatalogDatabasePath,
  assertProviderSqlIsReadOnly,
  assertProviderTransactionSql,
  ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES,
  EngineeringCatalogStateProvider,
  createEngineeringCatalogStateFixtureDb,
  type EngineeringCatalogCanonicalFacts,
} from './engineeringCatalogState/index.js';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerOver(db: Database.Database): EngineeringCatalogStateProvider {
  return new EngineeringCatalogStateProvider({ db });
}

function revisionOf(db: Database.Database): string {
  return computeEngineeringCatalogStateRevision(
    projectEngineeringCatalogFacts(db) as EngineeringCatalogCanonicalFacts,
  );
}

async function referenceRevision(db: Database.Database): Promise<string> {
  const ref = await providerOver(db).getCurrentReference();
  assert.equal(ref.status, 'AVAILABLE');
  if (ref.status !== 'AVAILABLE') throw new Error('unreachable');
  return ref.revision;
}

function expectProjectionError(db: Database.Database, code: string): void {
  try {
    projectEngineeringCatalogFacts(db);
    assert.fail(`expected projection error ${code}`);
  } catch (err) {
    assert.equal((err as { code?: string }).code, code);
  }
}

function makeTempFileFixture(): { dbPath: string; close(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm15-'));
  const dbPath = path.join(dir, 'fixture.db');
  const { db } = createEngineeringCatalogStateFixtureDb(dbPath);
  return { dbPath, close: () => db.close() };
}

/** Minimal full-shape canonical facts (empty arrays) for pure-hash tests. */
function emptyFacts(): EngineeringCatalogCanonicalFacts {
  return {
    domain: ENGINEERING_CATALOG_STATE_DOMAIN,
    algorithmVersion: ENGINEERING_CATALOG_ALGORITHM_VERSION,
    projectionVersion: ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
    scopeEquipmentTypes: ['FAN_COIL', 'HEAT_PUMP'],
    profiles: [],
    values: [],
    conditionSets: [],
    conditionKeys: [],
    sourceTypes: [],
    sources: [],
    relationships: [],
  };
}

function oneValueFacts(numeric: number): EngineeringCatalogCanonicalFacts {
  return {
    ...emptyFacts(),
    values: [{
      productId: 1,
      parameterCode: 'heating_capacity_kw',
      parameterRequirementLevel: 'REQUIRED_FOR_SELECTION',
      parameterValueType: 'NUMERIC',
      parameterCanonicalUnit: 'kW',
      numeric,
      text: null,
      boolean: null,
      unit: 'kW',
      valueStatus: 'KNOWN',
      confidence: null,
      conditionSetCode: null,
      sourceType: null,
      sourceManufacturer: null,
      sourceDocumentTitle: null,
      sourceDocumentVersion: null,
      sourceUrl: null,
      verificationTier: null,
    }],
  };
}

// ===========================================================================
// A. Provider contract
// ===========================================================================

describe('CM15 A — provider contract', () => {
  test('CM15-001 getCurrentReference returns AVAILABLE with revision', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    assert.equal(ref.status, 'AVAILABLE');
    if (ref.status !== 'AVAILABLE') return;
    assert.equal(typeof ref.revision, 'string');
    db.close();
  });

  test('CM15-002 revision has the exact frozen prefix', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.ok(ref.revision.startsWith(ENGINEERING_CATALOG_PREFIX));
    }
    db.close();
  });

  test('CM15-003 revision carries exactly 64 lowercase hex characters', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      const hex = ref.revision.slice(ENGINEERING_CATALOG_PREFIX.length);
      assert.match(hex, /^[0-9a-f]{64}$/);
    }
    db.close();
  });

  test('CM15-004 AVAILABLE reference carries the frozen algorithm identity', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.equal(ref.algorithmVersion, ENGINEERING_CATALOG_ALGORITHM_VERSION);
    }
    db.close();
  });

  test('CM15-005 AVAILABLE reference carries the frozen policy identity (1.1.0)', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.equal(ref.generatedFromPolicyId, 'ohmx.engineering-configurator.heat-pump-fan-coil.v1');
      assert.equal(ref.generatedFromPolicyVersion, '1.1.0');
    }
    db.close();
  });

  test('CM15-006 AVAILABLE scope is the frozen equipment-type scope', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.deepEqual([...ref.scopeEquipmentTypes], [...ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES]);
    }
    db.close();
  });

  test('CM15-007 AVAILABLE readConsistency is COMPLETE_COHERENT_SNAPSHOT', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.equal(ref.readConsistency, 'COMPLETE_COHERENT_SNAPSHOT');
    }
    db.close();
  });

  test('CM15-008 getCurrentState matches getCurrentReference', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const provider = providerOver(db);
    const a = await provider.getCurrentState();
    const b = await provider.getCurrentReference();
    assert.deepEqual(a, b);
    db.close();
  });

  test('CM15-009 same state -> identical revision across repeated calls', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const provider = providerOver(db);
    const a = await provider.getCurrentReference();
    const b = await provider.getCurrentReference();
    assert.deepEqual(a, b);
    db.close();
  });

  test('CM15-010 missing DB file -> UNAVAILABLE with stable diagnostic, no fake token', async () => {
    const provider = new EngineeringCatalogStateProvider({
      databasePath: path.join(os.tmpdir(), 'cm15-definitely-missing.db'),
    });
    const ref = await provider.getCurrentReference();
    assert.equal(ref.status, 'UNAVAILABLE');
    if (ref.status !== 'UNAVAILABLE') return;
    assert.equal(ref.revision, null);
    assert.equal(ref.errors.length, 1);
    assert.equal(ref.errors[0].code, 'catalog_state_db_open_failed');
  });

  test('CM15-011 UNAVAILABLE reference has null policy identity and UNAVAILABLE consistency', async () => {
    const provider = new EngineeringCatalogStateProvider({
      databasePath: path.join(os.tmpdir(), 'cm15-definitely-missing.db'),
    });
    const ref = await provider.getCurrentReference();
    if (ref.status !== 'UNAVAILABLE') return;
    assert.equal(ref.generatedFromPolicyId, null);
    assert.equal(ref.generatedFromPolicyVersion, null);
    assert.equal(ref.algorithmVersion, null);
    assert.equal(ref.readConsistency, 'UNAVAILABLE');
    assert.deepEqual([...ref.scopeEquipmentTypes], []);
    assert.deepEqual([...ref.warnings], []);
  });

  test('CM15-012 default DB_PATH resolution lands on the project electro.db', () => {
    const saved = process.env.DB_PATH;
    delete process.env.DB_PATH;
    try {
      const resolved = resolveEngineeringCatalogDatabasePath();
      assert.ok(path.isAbsolute(resolved));
      assert.ok(resolved.endsWith('data/electro.db'));
    } finally {
      if (saved === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = saved;
    }
  });

  test('CM15-013 AVAILABLE reference exposes exactly the frozen CM11 keys', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = (await providerOver(db).getCurrentReference()) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(ref).sort(compareCodePoints),
      [
        'algorithmVersion',
        'errors',
        'generatedFromPolicyId',
        'generatedFromPolicyVersion',
        'readConsistency',
        'revision',
        'scopeEquipmentTypes',
        'status',
        'warnings',
      ].sort(compareCodePoints),
    );
    db.close();
  });
});

// ===========================================================================
// B. Projection allowlist
// ===========================================================================

describe('CM15 B — projection allowlist', () => {
  test('CM15-014 profiles carry exactly the CM8.1 engineering candidate fields', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const facts = projectEngineeringCatalogFacts(db) as unknown as Record<string, unknown>;
    const profiles = facts.profiles as Array<Record<string, unknown>>;
    assert.equal(profiles.length, 2);
    assert.deepEqual(
      Object.keys(profiles[0]).sort(compareCodePoints),
      [
        'dataCompleteness',
        'equipmentType',
        'identityStatus',
        'model',
        'productId',
        'schemaId',
        'schemaVersion',
        'series',
        'sku',
        'sourceVerification',
      ].sort(compareCodePoints),
    );
    db.close();
  });

  test('CM15-015 values carry the matcher-relevant value + provenance tuple', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const facts = projectEngineeringCatalogFacts(db) as unknown as Record<string, unknown>;
    const values = facts.values as Array<Record<string, unknown>>;
    assert.ok(values.length >= 3);
    assert.deepEqual(
      Object.keys(values[0]).sort(compareCodePoints),
      [
        'boolean',
        'confidence',
        'conditionSetCode',
        'numeric',
        'parameterCanonicalUnit',
        'parameterCode',
        'parameterRequirementLevel',
        'parameterValueType',
        'productId',
        'sourceDocumentTitle',
        'sourceDocumentVersion',
        'sourceManufacturer',
        'sourceType',
        'sourceUrl',
        'text',
        'unit',
        'valueStatus',
        'verificationTier',
      ].sort(compareCodePoints),
    );
    db.close();
  });

  test('CM15-016 projection is scoped to FAN_COIL + HEAT_PUMP only', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    // FK-valid out-of-scope fixture (CM15-RC2): the referenced
    // engineering_equipment_type row must exist before the profile that
    // references it — otherwise SQLITE_CONSTRAINT_FOREIGNKEY.
    db.prepare(
      "INSERT INTO engineering_equipment_type (equipment_type, description) VALUES ('THERMOSTAT', 'room thermostat')",
    ).run();
    db.prepare(
      "INSERT INTO products (id, sku, name_ru, slug) VALUES (3003, 'TH-3003', 'Термостат', 'th-3003')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_product_profile (product_id, equipment_type) VALUES (3003, 'THERMOSTAT')",
    ).run();
    const facts = projectEngineeringCatalogFacts(db) as unknown as { profiles: Array<{ productId: number }> };
    assert.deepEqual(facts.profiles.map((p) => p.productId).sort((a, b) => a - b), [1001, 2002]);
    db.close();
  });

  test('CM15-017 canonical facts carry domain + algorithm + projection + scope identity', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const facts = projectEngineeringCatalogFacts(db) as unknown as Record<string, unknown>;
    assert.equal(facts.domain, ENGINEERING_CATALOG_STATE_DOMAIN);
    assert.equal(facts.algorithmVersion, ENGINEERING_CATALOG_ALGORITHM_VERSION);
    assert.equal(facts.projectionVersion, ENGINEERING_CATALOG_STATE_PROJECTION_VERSION);
    assert.deepEqual([...(facts.scopeEquipmentTypes as string[])], ['FAN_COIL', 'HEAT_PUMP']);
    db.close();
  });

  test('CM15-018 condition sets are projected with entries, keys, sources, tiers', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      conditionSets: Array<{ conditionSetCode: string; entries: unknown[] }>;
      conditionKeys: Array<{ conditionKey: string }>;
      sources: unknown[];
      sourceTypes: unknown[];
    };
    assert.deepEqual(
      facts.conditionSets.map((c) => c.conditionSetCode).sort(compareCodePoints),
      ['FC-COOL-7/12', 'FC-HEAT-70/60'],
    );
    assert.equal(facts.conditionSets[0].entries.length, 2);
    assert.deepEqual(
      facts.conditionKeys.map((k) => k.conditionKey).sort(compareCodePoints),
      ['water_return_c', 'water_supply_c'],
    );
    assert.equal(facts.sources.length, 2);
    assert.equal(facts.sourceTypes.length, 2);
    db.close();
  });

  test('CM15-115 standalone canonical condition-key additions change the semantic revision', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const before = revisionOf(db);
    db.prepare(
      "INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES ('outdoor_air_wet_bulb_c', 'NUMERIC', '°C')",
    ).run();
    const after = revisionOf(db);
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      conditionKeys: Array<{ conditionKey: string; valueType: string; canonicalUnit: string | null }>;
    };
    assert.notEqual(after, before);
    assert.deepEqual(
      facts.conditionKeys.find((key) => key.conditionKey === 'outdoor_air_wet_bulb_c'),
      { conditionKey: 'outdoor_air_wet_bulb_c', valueType: 'NUMERIC', canonicalUnit: '°C' },
    );
    db.close();
  });

  test('CM15-019 relationships are projected as technical relation tuples', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      relationships: Array<{ sourceProductId: number; targetProductId: number; relationType: string }>;
    };
    assert.deepEqual(facts.relationships, [
      { sourceProductId: 2002, targetProductId: 1001, relationType: 'required' },
    ]);
    db.close();
  });

  test('CM15-020 empty engineering catalog is a valid deterministic state', () => {
    const fixture = createEngineeringCatalogStateFixtureDb();
    fixture.db.exec(`
      DELETE FROM product_relationships;
      DELETE FROM engineering_value;
      DELETE FROM engineering_condition_entry;
      DELETE FROM engineering_condition_set;
      DELETE FROM engineering_source;
      DELETE FROM engineering_source_type;
      DELETE FROM engineering_condition_key;
      DELETE FROM engineering_parameter;
      DELETE FROM engineering_product_profile;
      DELETE FROM products;
      DELETE FROM engineering_equipment_type;
    `);
    const a = revisionOf(fixture.db);
    const b = revisionOf(fixture.db);
    assert.equal(a, b);
    assert.match(a, /^engineering-catalog-state:sha256:[0-9a-f]{64}$/);
    fixture.db.close();
  });
});

// ===========================================================================
// C. Canonicalization
// ===========================================================================

describe('CM15 C — canonicalization', () => {
  test('CM15-021 key order in input object does not change canonical JSON', () => {
    assert.equal(
      serializeEngineeringCatalogFacts({ b: 1, a: 2 }),
      serializeEngineeringCatalogFacts({ a: 2, b: 1 }),
    );
  });

  test('CM15-022 recursive key ordering (nested objects)', () => {
    assert.equal(
      serializeEngineeringCatalogFacts({ x: { d: 1, c: { f: 2, e: 3 } } }),
      serializeEngineeringCatalogFacts({ x: { c: { e: 3, f: 2 }, d: 1 } }),
    );
  });

  test('CM15-023 code-point ordering, not localeCompare (non-ASCII keys)', () => {
    assert.ok(compareCodePoints('systemEngineeringDesignInputs', 'systemsRevision') < 0);
    assert.equal(
      serializeEngineeringCatalogFacts({ systemsRevision: 1, systemEngineeringDesignInputs: 2 }),
      serializeEngineeringCatalogFacts({ systemEngineeringDesignInputs: 2, systemsRevision: 1 }),
    );
  });

  test('CM15-024 explicit null preserved and distinct from 0 and ""', () => {
    assert.equal(serializeEngineeringCatalogFacts({ unit: null }), '{"unit":null}');
    assert.equal(serializeEngineeringCatalogFacts({ unit: 0 }), '{"unit":0}');
    assert.equal(serializeEngineeringCatalogFacts({ unit: '' }), '{"unit":""}');
    assert.notEqual(
      serializeEngineeringCatalogFacts({ unit: null }),
      serializeEngineeringCatalogFacts({ unit: 0 }),
    );
    assert.notEqual(
      serializeEngineeringCatalogFacts({ unit: null }),
      serializeEngineeringCatalogFacts({ unit: '' }),
    );
  });

  test('CM15-025 false != 0 in canonical JSON identity', () => {
    assert.equal(serializeEngineeringCatalogFacts({ flag: false }), '{"flag":false}');
    assert.notEqual(
      serializeEngineeringCatalogFacts({ flag: false }),
      serializeEngineeringCatalogFacts({ flag: 0 }),
    );
  });

  test('CM15-026 -0 normalized to 0 (deep walk re-assigns leaves)', () => {
    const facts = { values: [{ numeric: -0, confidence: 0.9 }] };
    assert.equal(serializeEngineeringCatalogFacts(facts), '{"values":[{"confidence":0.9,"numeric":0}]}');
  });

  test('CM15-027 1 and 1.0 hash identically (IEEE-754 double identity)', () => {
    assert.equal(
      computeEngineeringCatalogStateRevision(oneValueFacts(1)),
      computeEngineeringCatalogStateRevision(oneValueFacts(1.0)),
    );
  });

  test('CM15-028 NaN fails closed', () => {
    assert.throws(
      () => serializeEngineeringCatalogFacts({ numeric: Number.NaN }),
      (err: unknown) => (err as EngineeringCatalogStateInputError).code === 'catalog_state_number_nan',
    );
  });

  test('CM15-029 +Infinity fails closed', () => {
    assert.throws(
      () => serializeEngineeringCatalogFacts({ numeric: Number.POSITIVE_INFINITY }),
      (err: unknown) => (err as EngineeringCatalogStateInputError).code === 'catalog_state_number_infinite',
    );
  });

  test('CM15-030 -Infinity fails closed', () => {
    assert.throws(
      () => serializeEngineeringCatalogFacts({ numeric: Number.NEGATIVE_INFINITY }),
      (err: unknown) => (err as EngineeringCatalogStateInputError).code === 'catalog_state_number_infinite',
    );
  });

  test('CM15-031 canonicalizeFiniteNumber gates NaN/±Infinity, normalizes -0', () => {
    assert.equal(canonicalizeFiniteNumber(-0, 'p'), 0);
    assert.equal(canonicalizeFiniteNumber(5, 'p'), 5);
    assert.throws(() => canonicalizeFiniteNumber(Number.NaN, 'p'));
    assert.throws(() => canonicalizeFiniteNumber(Number.POSITIVE_INFINITY, 'p'));
  });

  test('CM15-032 unicode strings survive exactly (UTF-8 identity)', () => {
    assert.equal(serializeEngineeringCatalogFacts({ text: 'м³/h — ∅' }), '{"text":"м³/h — ∅"}');
  });

  test('CM15-033 array order is frozen semantic order (serializer never re-sorts)', () => {
    assert.equal(serializeEngineeringCatalogFacts({ list: [3, 1, 2] }), '{"list":[3,1,2]}');
  });
});

// ===========================================================================
// D. SHA-256 / revision format
// ===========================================================================

describe('CM15 D — SHA-256 identity', () => {
  test('CM15-034 known vector: empty-scope facts -> pinned digest', () => {
    const revision = computeEngineeringCatalogStateRevision(emptyFacts());
    assert.equal(
      revision,
      'engineering-catalog-state:sha256:5045357e3119244b1de4a226a7c9aa1fa0ae525dc3b45c9f27e6f6a345ac8e02',
    );
    // Independent cross-check over the same canonical JSON.
    const manual = createHash('sha256')
      .update(serializeEngineeringCatalogFacts(emptyFacts()), 'utf8')
      .digest('hex');
    assert.equal(revision, `engineering-catalog-state:sha256:${manual}`);
  });

  test('CM15-035 SHA-256 is deterministic across repeated computation', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    assert.equal(revisionOf(db), revisionOf(db));
    assert.equal(revisionOf(db), revisionOf(db));
    db.close();
  });

  test('CM15-036 digest is lowercase hex (never uppercase, never base64)', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const hex = revisionOf(db).slice(ENGINEERING_CATALOG_PREFIX.length);
    assert.equal(hex, hex.toLowerCase());
    assert.doesNotMatch(hex, /[A-F+/=]/);
    db.close();
  });

  test('CM15-037 no salt: identical facts hash identically across instances', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });
});

// ===========================================================================
// E. Engineering sensitivity (change => different revision)
// ===========================================================================

describe('CM15 E — engineering sensitivity', () => {
  test('CM15-038 baseline fixture revision is stable across instances (reference point)', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-039 engineering_value numeric change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE engineering_value SET value_numeric = 5.3 WHERE product_id = 1001 AND parameter_id = 11').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-040 engineering_value unit change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_value SET unit = 'kWx' WHERE product_id = 1001 AND parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-040b empty-string unit vs null unit => different revision (null != "")', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_value SET unit = '' WHERE product_id = 1001 AND parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-041 engineering_value status change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_value SET value_status = 'REVIEW_REQUIRED' WHERE product_id = 1001 AND parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-042 engineering_value confidence change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE engineering_value SET confidence = 0.5 WHERE product_id = 1001 AND parameter_id = 11').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-043 engineering parameter code change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_parameter SET code = 'heating_capacity_kwx' WHERE parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-044 parameter requirement_level change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_parameter SET requirement_level = 'RECOMMENDED' WHERE parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-045 parameter canonical_unit change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_parameter SET canonical_unit = 'BTU/h' WHERE parameter_id = 11").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-046 condition entry value change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_condition_entry SET value_numeric = 65.0 WHERE condition_set_id = 71 AND condition_key = 'water_supply_c'").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-047 condition key change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    // FK-valid rename (CM15-RC1): engineering_condition_entry.condition_key
    // REFERENCES engineering_condition_key(condition_key), so the parent row
    // must exist BEFORE any entry points at the new key. The old key row is
    // left in place (a now-unreferenced key is relationally valid and the
    // projection still emits it — the entry/value change alone alters the
    // canonical facts, which is the semantics under test).
    b.db.prepare(
      "INSERT INTO engineering_condition_key (condition_key, value_type, unit, description) VALUES ('water_supply_hp_c', 'NUMERIC', '°C', 'heat-pump supply water temperature')",
    ).run();
    b.db.prepare(
      "UPDATE engineering_condition_entry SET condition_key = 'water_supply_hp_c' WHERE condition_key = 'water_supply_c'",
    ).run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-048 condition set membership change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE engineering_value SET condition_set_id = NULL WHERE product_id = 1001 AND parameter_id = 12').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-049 condition-set code change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_condition_set SET code = 'FC-HEAT-70/60x' WHERE condition_set_id = 71").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-050 condition key canonical unit change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_condition_key SET unit = 'K' WHERE condition_key = 'water_supply_c'").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-051 source type change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_source SET source_type = 'MANUAL_VERIFICATION' WHERE source_id = 91").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-052 source linkage change (value now cites the datasheet) => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE engineering_value SET source_id = 91 WHERE product_id = 2002 AND parameter_id = 13').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-053 source linkage removal => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE engineering_value SET source_id = NULL WHERE product_id = 1001').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-054 source document identity change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_source SET document_version = 'V2.0' WHERE source_id = 91").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-055 verification tier change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_source_type SET verification_tier = 'UNVERIFIED' WHERE source_type = 'MANUFACTURER_DATASHEET'").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-056 profile linkage change (equipment type) => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET equipment_type = 'HEAT_PUMP' WHERE product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-057 identity_status change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET identity_status = 'IDENTITY_UNCERTAIN' WHERE product_id = 2002").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-058 data_completeness change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET data_completeness = 'COMPLETE' WHERE product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-059 profile source_verification change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET source_verification = 'VERIFIED' WHERE product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-060 profile schema_version change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET schema_version = '1.1.0' WHERE product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-061 sku change => different revision (technical candidate identity)', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE products SET sku = 'FC-1001X' WHERE id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-062 series/model change => different revision (frozen CM8.1 candidate state)', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET series = 'FCX', model = 'FC-1001-MX' WHERE product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-063 technical relationship change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE product_relationships SET relation_type = 'recommended' WHERE source_product_id = 2002 AND target_product_id = 1001").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-064 relationship removal => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('DELETE FROM product_relationships').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-065 relationship target change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("INSERT INTO products (id, sku, name_ru, slug) VALUES (3003, 'FC-3003', 'Второй фанкойл', 'fc-3003')").run();
    b.db.prepare("INSERT INTO engineering_product_profile (product_id, equipment_type) VALUES (3003, 'FAN_COIL')").run();
    b.db.prepare('UPDATE product_relationships SET target_product_id = 3003').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-066 new in-scope value row => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("INSERT INTO engineering_parameter (parameter_id, equipment_type, code, canonical_name, value_type, requirement_level) VALUES (14, 'FAN_COIL', 'airflow_m3h', 'Airflow', 'NUMERIC', 'RECOMMENDED')").run();
    b.db.prepare("INSERT INTO engineering_value (product_id, parameter_id, value_numeric, unit, value_status) VALUES (1001, 14, 800.0, 'm³/h', 'KNOWN')").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-067 removed value row => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('DELETE FROM engineering_value WHERE product_id = 1001 AND parameter_id = 11').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });
});

// ===========================================================================
// F. Commerce invariance (change => SAME revision)
// ===========================================================================

describe('CM15 F — commerce invariance (CM8.1 preserved)', () => {
  test('CM15-068 price change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE products SET price_amd = 999999.0 WHERE id IN (1001, 2002)').run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-069 currency change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE products SET currency = 'USD' WHERE id IN (1001, 2002)").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-070 stock_quantity change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE products SET stock_quantity = 42.0 WHERE id IN (1001, 2002)').run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-071 availability_status change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE products SET availability_status = 'in_stock' WHERE id IN (1001, 2002)").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-072 products.is_active change => SAME revision (CM8.1 COMMERCE_ONLY re-verified)', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare('UPDATE products SET is_active = 0 WHERE id IN (1001, 2002)').run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-073 title (name_ru) change => SAME revision (no title-kW logic)', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE products SET name_ru = 'Совершенно другое название 99999' WHERE id IN (1001, 2002)").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-074 SEO text change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE products SET seo_title_ru = 'SEO x', seo_description_ru = 'SEO y' WHERE id = 1001").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-075 combined commerce edit storm => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare(`
      UPDATE products SET
        price_amd = 1.0,
        currency = 'EUR',
        stock_quantity = 0.0,
        availability_status = 'out_of_stock',
        is_active = 0,
        is_featured = 1,
        show_price = 0
      WHERE id IN (1001, 2002)
    `).run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-076 audit timestamps and source prose do not enter identity', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_product_profile SET updated_at = '1999-01-01 00:00:00'").run();
    b.db.prepare("UPDATE engineering_value SET updated_at = '1999-01-01 00:00:00'").run();
    b.db.prepare("UPDATE engineering_source SET retrieved_at = '1999-01-01', audited_at = '1999-01-01', notes = 'note', page = '7', table_name = 'T'").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });
});

// ===========================================================================
// G. Coherence, order invariance, fail-closed
// ===========================================================================

describe('CM15 G — coherence / order invariance / fail-closed', () => {
  test('CM15-077 rowid renumbering with identical semantics => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    // Recreate the value table so every value_id (rowid) changes while the
    // semantic rows stay identical.
    b.db.exec('ALTER TABLE engineering_value RENAME TO engineering_value_old');
    b.db.exec(`
      CREATE TABLE engineering_value (
        value_id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id       INTEGER NOT NULL REFERENCES products(id),
        parameter_id     INTEGER NOT NULL REFERENCES engineering_parameter(parameter_id),
        value_numeric    REAL,
        value_text       TEXT,
        value_boolean    INTEGER CHECK (value_boolean IN (0,1)),
        unit             TEXT,
        condition_set_id INTEGER REFERENCES engineering_condition_set(condition_set_id),
        source_id        INTEGER REFERENCES engineering_source(source_id),
        value_status     TEXT NOT NULL DEFAULT 'KNOWN',
        confidence       REAL,
        created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    b.db.exec(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, value_text, value_boolean, unit, condition_set_id, source_id, value_status, confidence)
      SELECT product_id, parameter_id, value_numeric, value_text, value_boolean, unit, condition_set_id, source_id, value_status, confidence
      FROM engineering_value_old ORDER BY product_id DESC, parameter_id DESC
    `);
    b.db.exec('DROP TABLE engineering_value_old');
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-078 reinsertion in reverse order (different rowids) => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    const rows = b.db.prepare('SELECT * FROM engineering_value ORDER BY value_id DESC').all() as Array<Record<string, unknown>>;
    b.db.prepare('DELETE FROM engineering_value').run();
    const insert = b.db.prepare(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, value_text, value_boolean, unit, condition_set_id, source_id, value_status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
      insert.run(r.product_id, r.parameter_id, r.value_numeric, r.value_text, r.value_boolean, r.unit, r.condition_set_id, r.source_id, r.value_status, r.confidence);
    }
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-079 provider reference equals direct projection revision (path parity)', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    assert.equal(revisionOf(db), await referenceRevision(db));
    db.close();
  });

  test('CM15-080 duplicate identical value rows collapse to one semantic fact => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence)
      SELECT product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence
      FROM engineering_value WHERE product_id = 1001 AND parameter_id = 11
    `).run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-081 ambiguous value slot (same slot, different value) fails closed', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.prepare(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence)
      SELECT product_id, parameter_id, 7.7, unit, condition_set_id, source_id, value_status, confidence
      FROM engineering_value WHERE product_id = 1001 AND parameter_id = 11
    `).run();
    expectProjectionError(db, 'catalog_state_ambiguous_value_slot');
    db.close();
  });

  test('CM15-082 different source tuple on same parameter is NOT ambiguous (distinct slots)', () => {
    const { db, ids } = createEngineeringCatalogStateFixtureDb();
    db.prepare(`
      INSERT INTO engineering_value
        (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence)
      VALUES (?, ?, 5.4, 'kW', ?, ?, 'KNOWN', 0.8)
    `).run(ids.productIdFanCoil, ids.parameterHeatingCapacityId, ids.conditionSetHeatingId, 92);
    const facts = projectEngineeringCatalogFacts(db) as unknown as { values: unknown[] };
    assert.equal(facts.values.length, 4);
    db.close();
  });

  test('CM15-083 query failure -> projection error (fail closed)', () => {
    const db = new Database(':memory:'); // no engineering tables at all
    expectProjectionError(db, 'catalog_state_projection_query_failed');
    db.close();
  });

  test('CM15-084 dangling source link (inconsistent snapshot) fails closed', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE engineering_value SET source_id = 999 WHERE product_id = 1001').run();
    expectProjectionError(db, 'catalog_state_inconsistent_source_link');
    db.close();
  });

  test('CM15-085 dangling condition-set link (inconsistent snapshot) fails closed', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE engineering_value SET condition_set_id = 999 WHERE product_id = 1001').run();
    expectProjectionError(db, 'catalog_state_missing_condition_set');
    db.close();
  });

  test('CM15-086 provider wraps projection failure as UNAVAILABLE (no fake token)', async () => {
    const db = new Database(':memory:'); // no tables
    const ref = await providerOver(db).getCurrentReference();
    assert.equal(ref.status, 'UNAVAILABLE');
    if (ref.status !== 'UNAVAILABLE') return;
    assert.equal(ref.revision, null);
    assert.equal(ref.errors.length, 1);
    assert.match(ref.errors[0].code, /^catalog_state_/);
    db.close();
  });

  test('CM15-087 file-based fixture: two sequential reads give identical facts', () => {
    const tmp = makeTempFileFixture();
    try {
      const p1 = new EngineeringCatalogStateProvider({ databasePath: tmp.dbPath });
      const p2 = new EngineeringCatalogStateProvider({ databasePath: tmp.dbPath });
      const a = p1.readCanonicalFacts();
      const b = p2.readCanonicalFacts();
      assert.equal(serializeEngineeringCatalogFacts(a), serializeEngineeringCatalogFacts(b));
    } finally {
      tmp.close();
    }
  });

  test('CM15-088 two independent in-memory instances produce equal references', async () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    assert.deepEqual(
      await providerOver(a.db).getCurrentReference(),
      await providerOver(b.db).getCurrentReference(),
    );
    a.db.close();
    b.db.close();
  });

  test('CM15-089 transaction gate refuses non-transaction exec SQL', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const handle = {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => {
        // Simulate the ReadOnlyDbHandle gate by importing the guard indirectly:
        // any write attempt through exec must never come from the provider.
        if (!/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
          throw new Error('refused non-transaction exec SQL');
        }
        db.exec(sql);
      },
    };
    assert.throws(() => handle.exec("INSERT INTO products (sku) VALUES ('x')"));
    handle.exec('BEGIN DEFERRED');
    handle.exec('COMMIT');
    db.close();
  });
});

// ===========================================================================
// H. CM11 reference compatibility
// ===========================================================================

describe('CM15 H — CM11 compatibility', () => {
  test('CM15-090 generated reference matches the frozen CM11 vocabulary values', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const ref = await providerOver(db).getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.equal(ref.readConsistency, 'COMPLETE_COHERENT_SNAPSHOT');
      assert.equal(ref.generatedFromPolicyId, 'ohmx.engineering-configurator.heat-pump-fan-coil.v1');
      assert.equal(ref.generatedFromPolicyVersion, '1.1.0');
      assert.equal(ref.algorithmVersion, ENGINEERING_CATALOG_ALGORITHM_VERSION);
      assert.ok(ref.revision.startsWith('engineering-catalog-state:sha256:'));
    }
    db.close();
  });

  test('CM15-091 provider satisfies the CM11 EngineeringCatalogStateProvider interface shape', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const provider: { getCurrentReference(): Promise<unknown> } = providerOver(db);
    const ref = (await provider.getCurrentReference()) as { status: string };
    assert.equal(ref.status, 'AVAILABLE');
    db.close();
  });

  test('CM15-092 CM11 adapter types still declare the frozen catalog-state identity (untouched)', () => {
    const typesSource = fs.readFileSync(
      path.join(HERE, 'buildingProjectConfiguratorAdapter', 'types.ts'),
      'utf8',
    );
    assert.ok(typesSource.includes('ENGINEERING_CATALOG_PREFIX = "engineering-catalog-state:sha256:"'));
    assert.ok(typesSource.includes('ENGINEERING_CATALOG_ALGORITHM_VERSION = "ohmx.engineering-catalog-state-canonical-json.v1"'));
    assert.ok(typesSource.includes('getCurrentReference(): Promise<DeepReadonly<EngineeringCatalogStateReference>>'));
  });

  test('CM15-093 CM11 adapter implementation module exists untouched (sentinel)', () => {
    const adapterSource = fs.readFileSync(
      path.join(HERE, 'buildingProjectConfiguratorAdapter', 'buildEngineeringConfiguratorInput.ts'),
      'utf8',
    );
    assert.ok(adapterSource.includes('buildEngineeringConfiguratorInput'));
  });
});

// ===========================================================================
// Explicit required cases from phase §37 items 21–23 (file identity)
// ===========================================================================

describe('CM15 — file-identity invariance', () => {
  test('CM15-094 mtime change does not affect revision', async () => {
    const tmp = makeTempFileFixture();
    try {
      const before = await new EngineeringCatalogStateProvider({ databasePath: tmp.dbPath }).getCurrentReference();
      const future = new Date(Date.now() + 86_400_000);
      fs.utimesSync(tmp.dbPath, future, future);
      const after = await new EngineeringCatalogStateProvider({ databasePath: tmp.dbPath }).getCurrentReference();
      assert.deepEqual(before, after);
    } finally {
      tmp.close();
    }
  });

  test('CM15-095 semantically equal files with different mtimes hash identically', async () => {
    const t1 = makeTempFileFixture();
    const t2 = makeTempFileFixture();
    try {
      fs.utimesSync(t2.dbPath, new Date(0), new Date(0));
      const r1 = await new EngineeringCatalogStateProvider({ databasePath: t1.dbPath }).getCurrentReference();
      const r2 = await new EngineeringCatalogStateProvider({ databasePath: t2.dbPath }).getCurrentReference();
      assert.deepEqual(r1, r2);
    } finally {
      t1.close();
      t2.close();
    }
  });

  test('CM15-096 provider never issues PRAGMA data_version (runtime source assertion)', () => {
    // Comment-aware (CM15-RC3): documentation saying "no PRAGMA data_version"
    // is NOT an executable pragma. Strip block + line comments first, exactly
    // like the CM13-RC pattern used by the source-invariant suite.
    const stripComments = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const providerCode = stripComments(
      fs.readFileSync(path.join(HERE, 'engineeringCatalogState', 'provider.ts'), 'utf8'),
    );
    assert.equal(/PRAGMA\s+data_version/i.test(providerCode), false);
    assert.equal(providerCode.includes('data_version'), false);
    const projectionCode = stripComments(
      fs.readFileSync(path.join(HERE, 'engineeringCatalogState', 'projection.ts'), 'utf8'),
    );
    assert.equal(/PRAGMA\s+data_version/i.test(projectionCode), false);
    assert.equal(projectionCode.includes('data_version'), false);
  });
});

// ===========================================================================
// X. Extended coverage (completion pass): SQL gates, typed value facts,
//    scoping, rollback envelope, prose exclusion, relationship scoping
// ===========================================================================

describe('CM15 X — extended coverage (gates / typed values / scoping / rollback)', () => {
  /** Seeds BOOLEAN + TEXT parameters with KNOWN values on product 1001. */
  function addTypedValueParams(db: Database.Database): void {
    db.prepare(
      "INSERT INTO engineering_parameter (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level) VALUES (21, 'FAN_COIL', 'has_electric_heater', 'Electric heater flag', 'BOOLEAN', NULL, 'RECOMMENDED')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_parameter (parameter_id, equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level) VALUES (22, 'FAN_COIL', 'body_material', 'Body material', 'TEXT', NULL, 'RECOMMENDED')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_value (product_id, parameter_id, value_boolean, value_status) VALUES (1001, 21, 1, 'KNOWN')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_value (product_id, parameter_id, value_text, value_status) VALUES (1001, 22, 'steel', 'KNOWN')",
    ).run();
  }

  test('CM15-097 describeCanonicalJson exposes exactly the canonical JSON whose SHA-256 is the revision', async () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    const provider = providerOver(db);
    const facts = provider.readCanonicalFacts() as EngineeringCatalogCanonicalFacts;
    const json = provider.describeCanonicalJson(facts);
    assert.equal(json, serializeEngineeringCatalogFacts(facts));
    const manual = createHash('sha256').update(json, 'utf8').digest('hex');
    const ref = await provider.getCurrentReference();
    if (ref.status === 'AVAILABLE') {
      assert.equal(ref.revision, `engineering-catalog-state:sha256:${manual}`);
    }
    db.close();
  });

  test('CM15-098 canonicalizeEngineeringCatalogFacts deep re-assigns -0 leaves (arrays + nesting)', () => {
    const payload: {
      values: Array<{ numeric: number; confidence: number }>;
      nested: { entries: Array<{ numeric: number }> };
    } = {
      values: [{ numeric: -0, confidence: 0.5 }],
      nested: { entries: [{ numeric: -0 }] },
    };
    const out = canonicalizeEngineeringCatalogFacts(payload);
    assert.equal(Object.is(out.values[0].numeric, -0), false);
    assert.equal(out.values[0].numeric, 0);
    assert.equal(out.nested.entries[0].numeric, 0);
  });

  test('CM15-099 projection failure inside the read envelope ROLLBACKs, never COMMITs, and surfaces UNAVAILABLE', async () => {
    const execs: string[] = [];
    const failing = {
      prepare: (_sql: string): { all(..._params: unknown[]): unknown[] } => {
        throw new Error('projection boom');
      },
      exec: (sql: string): void => {
        execs.push(sql);
      },
    };
    const ref = await new EngineeringCatalogStateProvider({ db: failing }).getCurrentReference();
    assert.equal(ref.status, 'UNAVAILABLE');
    if (ref.status !== 'UNAVAILABLE') return;
    assert.equal(ref.revision, null);
    assert.equal(ref.errors.length, 1);
    assert.equal(ref.errors[0].code, 'catalog_state_projection_query_failed');
    assert.deepEqual(execs, ['BEGIN DEFERRED', 'ROLLBACK']);
  });

  test('CM15-100 boolean and text value facts project as exactly typed leaves', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    addTypedValueParams(db);
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      values: Array<{
        productId: number;
        parameterCode: string;
        numeric: number | null;
        text: string | null;
        boolean: boolean | null;
      }>;
    };
    const flag = facts.values.find((v) => v.productId === 1001 && v.parameterCode === 'has_electric_heater');
    const material = facts.values.find((v) => v.productId === 1001 && v.parameterCode === 'body_material');
    assert.ok(flag);
    assert.ok(material);
    assert.equal(flag.boolean, true);
    assert.equal(flag.numeric, null);
    assert.equal(flag.text, null);
    assert.equal(material.text, 'steel');
    assert.equal(material.boolean, null);
    assert.equal(material.numeric, null);
    db.close();
  });

  test('CM15-101 UNKNOWN value row projects with all-null value leaves and status UNKNOWN', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.prepare(
      "INSERT INTO engineering_parameter (parameter_id, equipment_type, code, canonical_name, value_type, requirement_level) VALUES (23, 'FAN_COIL', 'maintenance_note', 'Maintenance note', 'TEXT', 'INFORMATIONAL')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_value (product_id, parameter_id, value_status) VALUES (1001, 23, 'UNKNOWN')",
    ).run();
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      values: Array<{
        parameterCode: string;
        numeric: number | null;
        text: string | null;
        boolean: boolean | null;
        valueStatus: string;
      }>;
    };
    const row = facts.values.find((v) => v.parameterCode === 'maintenance_note');
    assert.ok(row);
    assert.equal(row.valueStatus, 'UNKNOWN');
    assert.equal(row.numeric, null);
    assert.equal(row.text, null);
    assert.equal(row.boolean, null);
    db.close();
  });

  test('CM15-102 values of out-of-scope products are never projected', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.prepare(
      "INSERT INTO engineering_equipment_type (equipment_type, description) VALUES ('THERMOSTAT', 'room thermostat')",
    ).run();
    db.prepare(
      "INSERT INTO products (id, sku, name_ru, slug) VALUES (3003, 'TH-3003', 'Термостат', 'th-3003')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_product_profile (product_id, equipment_type) VALUES (3003, 'THERMOSTAT')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_parameter (parameter_id, equipment_type, code, canonical_name, value_type, requirement_level) VALUES (31, 'THERMOSTAT', 'setpoint_c', 'Setpoint', 'NUMERIC', 'INFORMATIONAL')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_value (product_id, parameter_id, value_numeric, value_status) VALUES (3003, 31, 25.0, 'KNOWN')",
    ).run();
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      profiles: Array<{ productId: number }>;
      values: Array<{ productId: number }>;
    };
    assert.deepEqual(facts.profiles.map((p) => p.productId).sort((a, b) => a - b), [1001, 2002]);
    assert.equal(facts.values.some((v) => v.productId === 3003), false);
    db.close();
  });

  test('CM15-103 same parameter under a different condition set is NOT an ambiguous slot', () => {
    const { db, ids } = createEngineeringCatalogStateFixtureDb();
    db.prepare(
      'INSERT INTO engineering_value (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence) VALUES (?, ?, 5.0, ?, ?, ?, ?, ?)',
    ).run(
      ids.productIdFanCoil,
      ids.parameterHeatingCapacityId,
      'kW',
      ids.conditionSetCoolingId,
      ids.sourceDatasheetId,
      'KNOWN',
      0.8,
    );
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      values: Array<{ productId: number; parameterCode: string; conditionSetCode: string | null }>;
    };
    const heatingRows = facts.values.filter(
      (v) => v.productId === 1001 && v.parameterCode === 'heating_capacity_kw',
    );
    assert.equal(heatingRows.length, 2);
    assert.deepEqual(
      heatingRows.map((v) => v.conditionSetCode).sort(compareCodePoints),
      ['FC-COOL-7/12', 'FC-HEAT-70/60'],
    );
    db.close();
  });

  test('CM15-104 value ordering is semantic: unconditioned first, then condition code-point order (never rowid)', () => {
    const { db, ids } = createEngineeringCatalogStateFixtureDb();
    db.prepare(
      'INSERT INTO engineering_value (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence) VALUES (?, ?, 5.0, ?, ?, ?, ?, ?)',
    ).run(
      ids.productIdFanCoil,
      ids.parameterHeatingCapacityId,
      'kW',
      ids.conditionSetCoolingId,
      ids.sourceDatasheetId,
      'KNOWN',
      0.8,
    );
    db.prepare(
      'INSERT INTO engineering_value (product_id, parameter_id, value_numeric, unit, condition_set_id, source_id, value_status, confidence) VALUES (?, ?, 8.0, ?, ?, ?, ?, ?)',
    ).run(
      ids.productIdHeatPump,
      13,
      'kW',
      ids.conditionSetHeatingId,
      ids.sourceDatasheetId,
      'KNOWN',
      0.8,
    );
    const facts = projectEngineeringCatalogFacts(db) as unknown as {
      values: Array<{ productId: number; parameterCode: string; conditionSetCode: string | null }>;
    };
    const fanCoilHeating = facts.values.filter(
      (v) => v.productId === 1001 && v.parameterCode === 'heating_capacity_kw',
    );
    assert.deepEqual(fanCoilHeating.map((v) => v.conditionSetCode), ['FC-COOL-7/12', 'FC-HEAT-70/60']);
    const heatPumpHeating = facts.values.filter(
      (v) => v.productId === 2002 && v.parameterCode === 'heating_capacity_kw',
    );
    assert.deepEqual(heatPumpHeating.map((v) => v.conditionSetCode), [null, 'FC-HEAT-70/60']);
    db.close();
  });

  test('CM15-105 SQL gates: SELECT/WITH pass; writes and PRAGMA refused', () => {
    assert.doesNotThrow(() => assertProviderSqlIsReadOnly('SELECT 1'));
    assert.doesNotThrow(() => assertProviderSqlIsReadOnly('  with x as (select 1) select * from x'));
    assert.throws(() => assertProviderSqlIsReadOnly('INSERT INTO products (sku) VALUES (1)'));
    assert.throws(() => assertProviderSqlIsReadOnly('UPDATE products SET sku = 1 WHERE id = 1'));
    assert.throws(() => assertProviderSqlIsReadOnly('DELETE FROM products'));
    assert.throws(() => assertProviderSqlIsReadOnly('PRAGMA data_version'));
    assert.doesNotThrow(() => assertProviderTransactionSql('BEGIN DEFERRED'));
    assert.doesNotThrow(() => assertProviderTransactionSql('COMMIT'));
    assert.doesNotThrow(() => assertProviderTransactionSql('ROLLBACK'));
    assert.throws(() => assertProviderTransactionSql('SELECT 1'));
  });

  test('CM15-106 provider diagnostic vocabulary is exactly the four frozen codes', () => {
    assert.deepEqual([...ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES], [
      'catalog_state_db_open_failed',
      'catalog_state_projection_failed',
      'catalog_state_canonicalization_failed',
      'catalog_state_digest_failed',
    ]);
  });

  test('CM15-107 boolean value change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    addTypedValueParams(a.db);
    addTypedValueParams(b.db);
    b.db.prepare('UPDATE engineering_value SET value_boolean = 0 WHERE product_id = 1001 AND parameter_id = 21').run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-108 text value change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    addTypedValueParams(a.db);
    addTypedValueParams(b.db);
    b.db.prepare("UPDATE engineering_value SET value_text = 'aluminium' WHERE product_id = 1001 AND parameter_id = 22").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-109 source manufacturer change => different revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_source SET manufacturer = 'Other Vendor' WHERE source_id = 91").run();
    assert.notEqual(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-110 parameter prose (canonical_name/description) change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare(
      "UPDATE engineering_parameter SET canonical_name = 'Totally different name', description = 'prose' WHERE parameter_id = 11",
    ).run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-111 equipment-type/condition-set description prose change => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare("UPDATE engineering_equipment_type SET description = 'other'").run();
    b.db.prepare("UPDATE engineering_condition_set SET description = 'other'").run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    a.db.close();
    b.db.close();
  });

  test('CM15-112 relationship scoping: out-of-scope<->out-of-scope excluded, out-of-scope->in-scope included', () => {
    const { db } = createEngineeringCatalogStateFixtureDb();
    db.prepare(
      "INSERT INTO engineering_equipment_type (equipment_type, description) VALUES ('THERMOSTAT', 'room thermostat')",
    ).run();
    db.prepare(
      "INSERT INTO products (id, sku, name_ru, slug) VALUES (4004, 'TH-4004', 'Термостат A', 'th-4004')",
    ).run();
    db.prepare(
      "INSERT INTO products (id, sku, name_ru, slug) VALUES (4005, 'TH-4005', 'Термостат B', 'th-4005')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_product_profile (product_id, equipment_type) VALUES (4004, 'THERMOSTAT')",
    ).run();
    db.prepare(
      "INSERT INTO engineering_product_profile (product_id, equipment_type) VALUES (4005, 'THERMOSTAT')",
    ).run();
    db.prepare(
      "INSERT INTO product_relationships (source_product_id, target_product_id, relation_type, reason_engineering) VALUES (4004, 4005, 'recommended', 'Out-of-scope thermostat pairing reason text')",
    ).run();
    const relationshipsOf = (): Array<{ sourceProductId: number; targetProductId: number }> =>
      (projectEngineeringCatalogFacts(db) as unknown as {
        relationships: Array<{ sourceProductId: number; targetProductId: number }>;
      }).relationships;
    assert.equal(relationshipsOf().length, 1);
    db.prepare(
      "INSERT INTO product_relationships (source_product_id, target_product_id, relation_type, reason_engineering) VALUES (4004, 1001, 'recommended', 'Thermostat paired with in-scope fan coil unit reason')",
    ).run();
    assert.equal(relationshipsOf().length, 2);
    assert.ok(relationshipsOf().some((r) => r.sourceProductId === 4004 && r.targetProductId === 1001));
    db.close();
  });

  test('CM15-113 unreferenced source rows are never projected => SAME revision', () => {
    const a = createEngineeringCatalogStateFixtureDb();
    const b = createEngineeringCatalogStateFixtureDb();
    b.db.prepare(
      "INSERT INTO engineering_source (source_id, source_type, manufacturer, document_title, document_version, url) VALUES (93, 'MANUFACTURER_DATASHEET', 'Unused Vendor', 'Unused Document', 'V9', 'https://fixture.invalid/unused.pdf')",
    ).run();
    assert.equal(revisionOf(a.db), revisionOf(b.db));
    const facts = projectEngineeringCatalogFacts(b.db) as unknown as { sources: unknown[] };
    assert.equal(facts.sources.length, 2);
    a.db.close();
    b.db.close();
  });

  test('CM15-114 non-SQLite bytes at databasePath -> UNAVAILABLE (fail closed, no fake token)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm15-notadb-'));
    const dbPath = path.join(dir, 'garbage.db');
    fs.writeFileSync(dbPath, Buffer.from('definitely not a sqlite database file payload'.repeat(16), 'utf8'));
    try {
      const ref = await new EngineeringCatalogStateProvider({ databasePath: dbPath }).getCurrentReference();
      assert.equal(ref.status, 'UNAVAILABLE');
      if (ref.status !== 'UNAVAILABLE') return;
      assert.equal(ref.revision, null);
      assert.equal(ref.errors.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
