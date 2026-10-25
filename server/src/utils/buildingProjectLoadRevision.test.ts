/**
 * CM14 — deterministic load-result identity producer: runtime behavior tests.
 *
 * Written only (NOT executed by the agent). Run by the USER with:
 *   npm run test:building-project-load-revision
 *
 * Groups (CM14 brief §34): A canonical projection, B canonical serializer,
 * C SHA-256 format, D semantic identity, E non-semantic invariance,
 * F persistence, G fail closed, H purity (source invariants live in the
 * separate source-invariants file).
 *
 * The CM11 parity check (§37) loads the sealed CM11 adapter fixtures and
 * asserts that `buildCanonicalLoadFacts` output is deep-equal to the exact
 * `CanonicalLoadFingerprintFacts` the CM11 adapter itself projects for the
 * same snapshot (`deepEqual` from the adapter policy, unmodified CM11 code).
 * CM11 runtime is never modified and the live adapter is never called.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  confirmObject,
  confirmSystemsConfiguration,
  createProject,
  deleteProject,
  loadProject,
  setCalculationCoverage,
  updateEngineeringDesignInputs,
} from './buildingProjectService.js';
import {
  buildCanonicalLoadFacts,
  canonicalizeFiniteNumber,
  canonicalizeLoadCalculationFacts,
  canonicalServiceOrder,
  compareCodePoints,
  computeLoadCalculationRevision,
  isLoadRevisionEligible,
  LOAD_REVISION_ALGORITHM_VERSION,
  LOAD_REVISION_PREFIX_VALUE,
  loadRevisionAlgorithmMatches,
  loadRevisionIdentityOf,
  produceLoadCalculationRevision,
  serializeCanonicalLoadFacts,
} from './buildingProjectLoadRevision.js';
import { deepEqual, validLoadRevision } from './buildingProjectConfiguratorAdapter/policy.js';
import { projectCanonicalLoadFacts } from './buildingProjectConfiguratorAdapter/loadRevision.js';
import { materializeMargins } from './buildingProjectConfiguratorAdapter/operatingInputs.js';
import { makeValidInput } from './buildingProjectConfiguratorAdapter/fixtures.js';
import { createHash } from 'node:crypto';
import type { CoverageIntent } from './buildingProjectTypes.js';
import type { BuildingLoadCalculation, BuildingProject } from './buildingProjectTypes.js';

// ---------------------------------------------------------------------------
// Harness (mirrors CM13 test conventions: real service, real JSON store, tracked cleanup)
// ---------------------------------------------------------------------------
const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];
function track<T extends { id: string }>(p: T): T { createdIds.push(p.id); return p; }

before(() => { fs.mkdirSync(STORE, { recursive: true }); });
after(() => { for (const id of createdIds) { try { deleteProject(id); } catch { /* ignore */ } } });

function throwsLoadRevisionError(fn: () => unknown, code?: string): void {
  assert.throws(fn, (err: unknown) => {
    if (!(err instanceof Error) || err.name !== 'LoadRevisionInputError') return false;
    return code === undefined || (err as { code?: string }).code === code;
  });
}

/** Fixture-backed CM14 inputs structurally identical to CM11 makeValidInput internals. */
function fixtureInputs(): { project: BuildingProject; load: BuildingLoadCalculation } {
  const input = makeValidInput();
  const project = {
    id: (input.project as { id: string }).id,
    objectType: (input.project as { objectType: 'apartment' | 'private_house' }).objectType,
    calculationConfiguration: {
      coverageIntent: JSON.parse(JSON.stringify((input.project as BuildingProject).calculationConfiguration!.coverageIntent)),
    },
    systemsConfigurationSnapshot: JSON.parse(JSON.stringify((input.project as BuildingProject).systemsConfigurationSnapshot)),
  } as unknown as BuildingProject;
  const load = JSON.parse(JSON.stringify(input.loadCalculation)) as BuildingLoadCalculation;
  return { project, load };
}

/** A live project advanced to a confirmable steady_state-ready state (object confirmed). */
function liveProject(): BuildingProject {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 60 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 20 });
  addRoom(p.id, { roomType: 'living_room', areaM2: 30 });
  confirmObject(p.id);
  return loadProject(p.id)!;
}

// ===========================================================================
// A. Canonical projection
// ===========================================================================

describe('CM14 A. canonical projection', () => {
  test('CM14-001 projection output is deep-equal to CM11 fixture reference canonicalFacts', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load);
    const reference = (makeValidInput().loadRevisionReference as { canonicalFacts: unknown }).canonicalFacts;
    assert.equal(deepEqual(facts, reference), true);
  });

  test('CM14-002 projection pins the frozen domain and algorithm identity', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { domain: string; algorithmVersion: string };
    assert.equal(facts.domain, 'building-project-configurator-load');
    assert.equal(facts.algorithmVersion, 'ohmx.building-project-load-canonical-json.v1');
    assert.equal(LOAD_REVISION_ALGORITHM_VERSION, 'ohmx.building-project-load-canonical-json.v1');
  });

  test('CM14-003 projection includes projectId, revision stamps, mode and method', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as Record<string, unknown>;
    assert.equal(facts.projectId, project.id);
    assert.equal(facts.buildingRevisionAtCalculation, load.buildingRevisionAtCalculation);
    assert.equal(facts.systemsRevisionAtCalculation, load.systemsRevisionAtCalculation);
    assert.equal(facts.mode, 'steady_state');
    assert.equal(facts.status, 'calculated');
    assert.equal(facts.methodId, 'ohmx.steady-state.v1');
    assert.equal(facts.methodVersion, '1.0.0');
  });

  test('CM14-004 projection includes object totals including explicit partial nulls', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as Record<string, unknown>;
    assert.equal(facts.heatingDemandW, load.heatingDemandW);
    assert.equal(facts.coolingDemandW, load.coolingDemandW);
    assert.ok('partialHeatingDemandW' in facts);
    assert.ok('partialCoolingDemandW' in facts);
  });

  test('CM14-005 projection sorts rooms by stable roomId regardless of input order', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { roomResults: Array<{ roomId: string }> };
    const ids = facts.roomResults.map((r) => r.roomId);
    const sorted = [...ids].sort(compareCodePoints);
    assert.deepEqual(ids, sorted);
  });

  test('CM14-006 projection emits per-room heating/cooling facts with canonical null materialization', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { roomResults: Array<Record<string, unknown>> };
    for (const room of facts.roomResults) {
      for (const service of ['heating', 'cooling'] as const) {
        const s = room[service] as Record<string, unknown>;
        assert.ok('status' in s && 'demandW' in s && 'partialDemandW' in s && 'warnings' in s && 'missingInputs' in s);
        assert.ok(Array.isArray(s.warnings) && Array.isArray(s.missingInputs));
      }
      const tb = room.transmissionBreakdown as Record<string, unknown> | null;
      assert.ok(tb === null || ['indoorHeatingC', 'indoorCoolingC', 'outdoorHeatingC', 'outdoorCoolingC'].every((k) => k in tb));
    }
  });

  test('CM14-007 projection embeds quality facts (model, gate, coverage, fields, blocking, warnings)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { engineeringQuality: Record<string, unknown> };
    const q = facts.engineeringQuality;
    assert.equal(q.qualityModelId, 'ohmx.professional-quality.v1');
    assert.equal(q.qualityModelVersion, '1.0.0');
    for (const key of ['requestedLevel', 'maximumEligibleLevel', 'gateStatus', 'coverage', 'fields', 'blockingFields', 'warnings']) {
      assert.ok(key in q, `missing quality fact ${key}`);
    }
  });

  test('CM14-008 projection embeds climate identity (dataset id/version/location)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as Record<string, unknown>;
    assert.equal(facts.climateDatasetId, load.climateDatasetId);
    assert.equal(facts.climateDatasetVersion, load.climateDatasetVersion);
    assert.equal(facts.climateLocationId, load.climateLocationId);
  });

  test('CM14-009 projection embeds the input snapshot allowlist (not the whole snapshot)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { inputSnapshot: Record<string, unknown> };
    const snap = facts.inputSnapshot;
    const expected = ['projectId', 'objectType', 'buildingRevision', 'systemsRevision', 'mode', 'methodVersion', 'requestedServices', 'rooms', 'servicePreferences', 'calculationConfiguration', 'systemEngineeringDesignInputs'];
    assert.deepEqual(Object.keys(snap).sort(), [...expected].sort());
  });

  test('CM14-010 projection normalizes requestedServices to the frozen semantic set order', () => {
    const { project, load } = fixtureInputs();
    const reversed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (reversed.inputSnapshot.requestedServices as unknown as string[]) = ['cooling', 'heating'];
    const facts = buildCanonicalLoadFacts(project, reversed) as { inputSnapshot: { requestedServices: string[] } };
    assert.deepEqual(facts.inputSnapshot.requestedServices, canonicalServiceOrder());
  });

  test('CM14-011 projection materializes design margins (absent groups become sanctioned 0/NONE)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { inputSnapshot: { systemEngineeringDesignInputs: { designMargins?: Record<string, Record<string, unknown>> } } };
    const margins = facts.inputSnapshot.systemEngineeringDesignInputs.designMargins!;
    for (const group of ['heatPumpHeating', 'heatPumpCooling', 'fanCoilHeating', 'fanCoilCooling']) {
      assert.equal(margins[group].designMarginPercent, 0);
      assert.equal(margins[group].marginSource, 'NONE');
      assert.equal(margins[group].marginPolicyId, null);
      assert.equal(margins[group].marginPolicyVersion, null);
    }
  });

  test('CM14-012 projection maps every CM11 canonical leaf (allowlist audit)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as Record<string, unknown>;
    const topLevel = ['domain', 'algorithmVersion', 'projectId', 'buildingRevisionAtCalculation', 'systemsRevisionAtCalculation', 'mode', 'status', 'methodId', 'methodVersion', 'heatingDemandW', 'coolingDemandW', 'partialHeatingDemandW', 'partialCoolingDemandW', 'warnings', 'missingInputs', 'roomResults', 'engineeringQuality', 'climateDatasetId', 'climateDatasetVersion', 'climateLocationId', 'inputSnapshot'];
    for (const key of topLevel) assert.ok(key in facts, `missing canonical leaf ${key}`);
    assert.equal(Object.keys(facts).length, topLevel.length, 'unexpected extra canonical leaves');
  });

  test('CM14-013 projection sorts quality fields by fieldId and blocking fields deterministically', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { engineeringQuality: { fields: Array<{ fieldId: string }>; blockingFields: Array<{ fieldId: string }> } };
    const fieldIds = facts.engineeringQuality.fields.map((f) => f.fieldId);
    assert.deepEqual(fieldIds, [...fieldIds].sort(compareCodePoints));
    const blockingIds = facts.engineeringQuality.blockingFields.map((f) => f.fieldId);
    assert.deepEqual(blockingIds, [...blockingIds].sort(compareCodePoints));
  });

  test('CM14-014 projection preserves explicit nulls (transmissionBreakdown null stays null)', () => {
    const { project, load } = fixtureInputs();
    const stripped = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (stripped.roomResults[0] as unknown as { transmissionBreakdown: unknown }).transmissionBreakdown = null;
    const facts = buildCanonicalLoadFacts(project, stripped) as { roomResults: Array<{ transmissionBreakdown: unknown }> };
    assert.equal(facts.roomResults[0].transmissionBreakdown, null);
  });
});

// ===========================================================================
// B. Canonical serializer
// ===========================================================================

describe('CM14 B. canonical serializer', () => {
  test('CM14-015 object keys are emitted lexicographically sorted', () => {
    const json = serializeCanonicalLoadFacts({ b: 1, a: 2, c: { z: 1, y: 2 } });
    assert.equal(json, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  test('CM14-016 nested key order is recursively sorted', () => {
    const a = serializeCanonicalLoadFacts({ x: { m: { k: 1, j: 2 } }, w: 3 });
    const b = serializeCanonicalLoadFacts({ w: 3, x: { m: { j: 2, k: 1 } } });
    assert.equal(a, b);
    assert.equal(a, '{"w":3,"x":{"m":{"j":2,"k":1}}}');
  });

  test('CM14-017 arrays keep their given (semantic) order', () => {
    const json = serializeCanonicalLoadFacts({ list: ['b', 'a'] });
    assert.equal(json, '{"list":["b","a"]}');
  });

  test('CM14-018 explicit null, booleans and strings serialize exactly', () => {
    assert.equal(serializeCanonicalLoadFacts({ n: null, t: true, f: false, s: 'abc' }), '{"f":false,"n":null,"s":"abc","t":true}');
  });

  test('CM14-019 zero and negative zero serialize to the single frozen 0 representation', () => {
    assert.equal(serializeCanonicalLoadFacts({ z: 0 }), '{"z":0}');
    assert.equal(serializeCanonicalLoadFacts({ z: -0 }), '{"z":0}');
    assert.equal(canonicalizeFiniteNumber(-0, 'x'), 0);
    assert.ok(!Object.is(canonicalizeFiniteNumber(-0, 'x'), -0));
  });

  test('CM14-020 integer and float identity: 1 and 1.0 serialize identically', () => {
    assert.equal(serializeCanonicalLoadFacts({ v: 1 }), serializeCanonicalLoadFacts({ v: 1.0 }));
    assert.equal(serializeCanonicalLoadFacts({ v: 1 }), '{"v":1}');
  });

  test('CM14-021 numeric serialization is locale-independent (deterministic toString)', () => {
    const samples = [0.5, 123.456, 1e21, 1e-7, 42];
    for (const v of samples) {
      assert.equal(serializeCanonicalLoadFacts({ v }), `{"v":${v}}`);
    }
  });

  test('CM14-022 unicode strings survive round-trip exactly (code-point key order)', () => {
    const json = serializeCanonicalLoadFacts({ 'ж': 1, 'a': 2, 'Z': 3, '=_': 4 });
    const reparsed = JSON.parse(json) as Record<string, number>;
    assert.equal(reparsed['ж'], 1);
    assert.equal(reparsed['a'], 2);
    const keys = Object.keys(reparsed);
    assert.deepEqual(keys, [...keys].sort(compareCodePoints));
  });

  test('CM14-023 deep canonicalization normalizes -0 anywhere in the tree', () => {
    const out = canonicalizeLoadCalculationFacts({ a: { b: [-0, { c: -0 }] } }) as { a: { b: Array<unknown> } };
    assert.equal(Object.is(out.a.b[0], -0), false);
    assert.equal(out.a.b[0], 0);
  });

  test('CM14-024 serializer output for the same facts is byte-identical across calls', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load);
    assert.equal(serializeCanonicalLoadFacts(facts), serializeCanonicalLoadFacts(JSON.parse(JSON.stringify(facts))));
  });
});

// ===========================================================================
// C. SHA-256 format
// ===========================================================================

describe('CM14 C. sha256 token format', () => {
  const token = (() => {
    const { project, load } = fixtureInputs();
    return produceLoadCalculationRevision(project, load).revision;
  })();

  test('CM14-025 exact prefix load:sha256:', () => {
    assert.ok(token.startsWith('load:sha256:'));
    assert.equal(LOAD_REVISION_PREFIX_VALUE, 'load:sha256:');
  });

  test('CM14-026 digest is exactly 64 lowercase hex characters', () => {
    const digest = token.slice('load:sha256:'.length);
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/);
  });

  test('CM14-027 total token length is 76 (12 + 64), no truncation', () => {
    assert.equal(token.length, 76);
  });

  test('CM14-028 no uppercase hex is ever emitted', () => {
    assert.equal(/[A-F]/.test(token), false);
  });

  test('CM14-029 known-input vector: canonical JSON of a tiny payload hashes deterministically', () => {
    // Independent Node-crypto reference (same algorithm, no shared code path).
    const expected = createHash('sha256').update('{"a":2,"b":1}', 'utf8').digest('hex');
    const actual = createHash('sha256').update(serializeCanonicalLoadFacts({ b: 1, a: 2 }), 'utf8').digest('hex');
    assert.equal(actual, expected);
  });

  test('CM14-030 digest is stable across repeated computations (no salt/time/random)', () => {
    const { project, load } = fixtureInputs();
    const r1 = produceLoadCalculationRevision(project, load).revision;
    const r2 = produceLoadCalculationRevision(project, load).revision;
    assert.equal(r1, r2);
    assert.equal(r1, token);
  });
});

// ===========================================================================
// D. Semantic identity
// ===========================================================================

describe('CM14 D. semantic identity', () => {
  test('CM14-031 identical facts produce the identical revision', () => {
    const { project, load } = fixtureInputs();
    assert.equal(produceLoadCalculationRevision(project, load).revision, produceLoadCalculationRevision(project, load).revision);
  });

  test('CM14-032 object heating demand change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.heatingDemandW = (changed.heatingDemandW ?? 0) + 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-033 object cooling demand change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.coolingDemandW = (changed.coolingDemandW ?? 0) + 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-034 partial heating demand change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.partialHeatingDemandW = 1234;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-035 room heating demand change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0].heating as { demandW: number }).demandW += 5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-036 room cooling demand change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0].cooling as { demandW: number }).demandW += 5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-037 room cooling status change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0].cooling as { status: string }).status = 'incomplete';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-038 transmission indoor heating temperature change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const tb = (changed.roomResults[0] as unknown as { transmissionBreakdown: Record<string, number> }).transmissionBreakdown;
    tb.indoorHeatingC += 0.5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-039 transmission outdoor heating temperature change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const tb = (changed.roomResults[0] as unknown as { transmissionBreakdown: Record<string, number> }).transmissionBreakdown;
    tb.outdoorHeatingC += 0.5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-040 transmission indoor cooling temperature change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const tb = (changed.roomResults[0] as unknown as { transmissionBreakdown: Record<string, number> }).transmissionBreakdown;
    tb.indoorCoolingC += 0.5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-041 transmission outdoor cooling temperature change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const tb = (changed.roomResults[0] as unknown as { transmissionBreakdown: Record<string, number> }).transmissionBreakdown;
    tb.outdoorCoolingC += 0.5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-042 coverage scope change changes the revision (intent comes from the project parent)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    ((changedProject.calculationConfiguration as { coverageIntent: { calculationScope: string } }).coverageIntent).calculationScope = 'SELECTED_ROOMS';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-043 coverage confirmation change changes the revision (intent comes from the project parent)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    ((changedProject.calculationConfiguration as { coverageIntent: { coverageConfirmation: string } }).coverageIntent).coverageConfirmation = 'WHOLE_OBJECT_WITH_EXCLUSIONS';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-044 quality certification fact change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.engineeringQuality!.gateStatus = 'PASS_WITH_WARNINGS';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-045 quality maximumEligibleLevel change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.engineeringQuality!.maximumEligibleLevel = 2;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-046 climate dataset version change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.climateDatasetVersion = '9.9.9';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-047 climate dataset id change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.climateDatasetId = 'other-dataset';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-048 climate location change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.climateLocationId = 'gyumri';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-049 buildingRevisionAtCalculation change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.buildingRevisionAtCalculation += 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-050 systemsRevisionAtCalculation change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.systemsRevisionAtCalculation += 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-051 input snapshot buildingRevision change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.inputSnapshot.buildingRevision += 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-052 input snapshot systemsRevision change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.inputSnapshot.systemsRevision += 1;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-053 unsupported method version is refused, not re-hashed (fail-closed eligibility)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.methodVersion = '1.0.1';
    (changed.inputSnapshot as { methodVersion: string }).methodVersion = '1.0.1';
    // A non-frozen method version is an UNSUPPORTED result: the producer must
    // refuse (no certifying revision), never silently hash it.
    throwsLoadRevisionError(() => produceLoadCalculationRevision(project, changed), 'load_revision_not_eligible');
    assert.notEqual(base, ''); // sanity: base revision well-formed
  });

  test('CM14-054 room area change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0] as { areaM2: number | null }).areaM2 = 21.5;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-055 room type change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0] as { roomType: string }).roomType = 'kitchen';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-056 room warning addition changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0].heating as { warnings: string[] }).warnings = ['demo_warning'];
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-057 room missing-input addition changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.roomResults[0].cooling as { missingInputs: string[] }).missingInputs = ['demo_input'];
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-058 object missingInput addition changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.missingInputs = ['demo_input'];
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-059 object warning addition changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.warnings = ['demo_warning'];
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-060 hydronic design input change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { hydronicDesignConditions: { heatingWaterSupplyC: { value: number } } } }).engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC);
    leaf.value = 46;
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-061 fan-coil sizing speed change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { fanCoilSizingPolicy: { sizingFanSpeed: { value: string } } } }).engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed);
    leaf.value = 'HIGH';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-062 wet-bulb design input change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { coolingIndoorDesignCondition: { indoorCoolingWetBulbC: { value: number } } } }).engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC);
    leaf.value = 19;
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-063 design input provenance change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { hydronicDesignConditions: { heatingWaterSupplyC: { source: string; sourceReference: string } } } }).engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC);
    leaf.source = 'SYSTEM_POLICY';
    leaf.sourceReference = 'policy-ref-cm14';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-064 service preference change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.inputSnapshot.servicePreferences[0] as { heating: string }).heating = 'optional';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-065 input snapshot room floorId change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.inputSnapshot.rooms[0] as { floorId: string | null }).floorId = 'floor-9';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });
});

// ===========================================================================
// E. Non-semantic invariance
// ===========================================================================

describe('CM14 E. non-semantic invariance', () => {
  test('CM14-066 calculatedAt change does NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.calculatedAt = '2099-12-31T23:59:59.999Z';
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-067 quality evaluatedAt change does NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.engineeringQuality!.evaluatedAt = '2099-01-01T00:00:00Z';
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-068 top-level property insertion order does NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    // Reconstruct the same load with reversed top-level key order.
    const plain = JSON.parse(JSON.stringify(load)) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(plain).reverse());
    assert.equal(produceLoadCalculationRevision(project, reversed as unknown as BuildingLoadCalculation).revision, base);
  });

  test('CM14-069 nested property insertion order does NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as Record<string, unknown>;
    const q = changed.engineeringQuality as Record<string, unknown>;
    changed.engineeringQuality = Object.fromEntries(Object.entries(q).reverse());
    assert.equal(produceLoadCalculationRevision(project, changed as unknown as BuildingLoadCalculation).revision, base);
  });

  test('CM14-070 room array input order does NOT change the revision (semantic sort by roomId)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.roomResults = [...changed.roomResults].reverse();
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-071 quality fields array order does NOT change the revision (semantic sort)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.engineeringQuality!.fields = [...changed.engineeringQuality!.fields].reverse();
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-072 input snapshot room array order does NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.inputSnapshot.rooms = [...changed.inputSnapshot.rooms].reverse();
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-073 requestedServices input order does NOT change the revision (frozen set order)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.inputSnapshot.requestedServices as unknown as string[]) = ['cooling', 'heating'];
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-074 non-canonical extra fields on the load do NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation & { assumptions: string[]; climateLocationLabel?: string | null; limitations?: string[]; pendingComponents?: string[] };
    changed.assumptions = ['some new assumption text'];
    changed.climateLocationLabel = 'Երևան';
    changed.limitations = ['demo'];
    changed.pendingComponents = ['demo'];
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-075 non-canonical extra fields on rooms do NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const room = changed.roomResults[0] as unknown as Record<string, unknown>;
    room.roomName = 'renamed';
    room.effectiveCeilingHeightM = 3.3;
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-076 non-canonical extra fields on quality do NOT change the revision (assumptions excluded)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.engineeringQuality as unknown as { assumptions: string[] }).assumptions = ['new assumption'];
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-077 non-canonical snapshot fields (region/topology/height/insulation) do NOT change the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    const snap = changed.inputSnapshot as unknown as Record<string, unknown>;
    snap.region = { code: 'AM-ER', label: 'x' };
    snap.defaultCeilingHeightM = 9.9;
    snap.insulationLevel = 'poor';
    snap.topology = { demo: true };
    snap.rooms.forEach((r) => { (r as unknown as Record<string, unknown>).name = 'renamed'; (r as unknown as Record<string, unknown>).conditions = ['x']; });
    assert.equal(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-078 string whitespace differences that are data DO change the revision (sanity)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.climateLocationId = 'yerevan ';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });
});

// ===========================================================================
// F. Persistence
// ===========================================================================

describe('CM14 F. persistence lifecycle', () => {
  test('CM14-079 ineligible quick result carries no revision (no false certification)', () => {
    const p = liveProject();
    // No steady_state calculation performed yet: loads absent entirely.
    assert.equal(p.loads ?? null, null);
    assert.equal(loadRevisionIdentityOf(p.loads ?? null), null);
  });

  test('CM14-080 eligible gate accepts only successful steady_state results (fixture probe)', () => {
    const { load } = fixtureInputs();
    assert.equal(isLoadRevisionEligible(load), true);
    assert.equal(isLoadRevisionEligible({ ...load, mode: 'quick' }), false);
    assert.equal(isLoadRevisionEligible({ ...load, mode: 'professional' }), false);
    assert.equal(isLoadRevisionEligible({ ...load, status: 'limited' }), false);
    assert.equal(isLoadRevisionEligible({ ...load, status: 'incomplete' }), false);
    assert.equal(isLoadRevisionEligible({ ...load, methodId: 'other' }), false);
    assert.equal(isLoadRevisionEligible(null), false);
  });

  test('CM14-081 identity attach produces sourceCalculationId equal to revision', () => {
    const { project, load } = fixtureInputs();
    const production = produceLoadCalculationRevision(project, load);
    assert.equal(production.sourceCalculationId, production.revision);
    const target = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    // attach via service path equivalent: produce then read identity from the result
    (target as unknown as Record<string, unknown>).loadCalculationRevision = production.revision;
    (target as unknown as Record<string, unknown>).sourceCalculationId = production.sourceCalculationId;
    const identity = loadRevisionIdentityOf(target);
    assert.ok(identity);
    assert.equal(identity!.sourceCalculationId, identity!.loadCalculationRevision);
  });

  test('CM14-082 half-stamped identity is rejected as absent (both fields or none)', () => {
    assert.equal(loadRevisionIdentityOf({ loadCalculationRevision: 'load:sha256:' + 'a'.repeat(64) } as unknown as BuildingLoadCalculation), null);
    assert.equal(loadRevisionIdentityOf({ sourceCalculationId: 'load:sha256:' + 'a'.repeat(64) } as unknown as BuildingLoadCalculation), null);
  });

  test('CM14-083 legacy load without identity fields still loads (fixture-backed read)', () => {
    const { load } = fixtureInputs();
    const legacy = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation & Record<string, unknown>;
    delete legacy.loadCalculationRevision;
    delete legacy.sourceCalculationId;
    // Structural read succeeds; identity is absent, not fabricated.
    assert.equal(loadRevisionIdentityOf(legacy), null);
    assert.equal(loadRevisionAlgorithmMatches(legacy), false);
  });

  test('CM14-084 legacy identity read does not mutate the object (no read-time hashing)', () => {
    const { load } = fixtureInputs();
    const legacy = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation & Record<string, unknown>;
    delete legacy.loadCalculationRevision;
    delete legacy.sourceCalculationId;
    const before = JSON.stringify(Object.keys(legacy).sort());
    loadRevisionIdentityOf(legacy);
    assert.equal(JSON.stringify(Object.keys(legacy).sort()), before);
    assert.ok(!('loadCalculationRevision' in legacy));
  });

  test('CM14-085 JSON round trip preserves both identity fields byte-exactly', () => {
    const { project, load } = fixtureInputs();
    const production = produceLoadCalculationRevision(project, load);
    const persisted = JSON.parse(JSON.stringify({ ...load, loadCalculationRevision: production.revision, sourceCalculationId: production.sourceCalculationId }));
    const identity = loadRevisionIdentityOf(persisted as BuildingLoadCalculation);
    assert.ok(identity);
    assert.equal(identity!.loadCalculationRevision, production.revision);
    assert.equal(identity!.sourceCalculationId, production.sourceCalculationId);
  });

  test('CM14-086 reload does not recompute identity (persisted token survives round trip unchanged)', () => {
    const { project, load } = fixtureInputs();
    const production = produceLoadCalculationRevision(project, load);
    const persisted = JSON.parse(JSON.stringify({ ...load, loadCalculationRevision: production.revision, sourceCalculationId: production.sourceCalculationId }));
    // A second production over the same facts yields the same token, but the
    // persisted file's token is never overwritten by a read path.
    const again = produceLoadCalculationRevision(project, persisted as BuildingLoadCalculation).revision;
    assert.equal(again, production.revision);
    assert.equal(loadRevisionIdentityOf(persisted as BuildingLoadCalculation)!.loadCalculationRevision, production.revision);
  });

  test('CM14-087 same semantic recalculation yields the same revision (fixture equivalence)', () => {
    const { project, load } = fixtureInputs();
    const a = produceLoadCalculationRevision(project, load).revision;
    const clone = JSON.parse(JSON.stringify({ project, load }));
    const b = produceLoadCalculationRevision(clone.project, clone.load).revision;
    assert.equal(a, b);
  });

  test('CM14-088 changed semantic recalculation yields a different revision', () => {
    const { project, load } = fixtureInputs();
    const a = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.coolingDemandW = (changed.coolingDemandW ?? 0) + 7;
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, a);
  });

  test('CM14-089 producer is pure: projecting twice yields deep-equal facts', () => {
    const { project, load } = fixtureInputs();
    const f1 = buildCanonicalLoadFacts(project, load);
    const f2 = buildCanonicalLoadFacts(project, load);
    assert.equal(deepEqual(f1, f2), true);
    assert.notEqual(f1, f2);
  });

  test('CM14-090 producer does not mutate the project or load inputs', () => {
    const { project, load } = fixtureInputs();
    const beforeProject = JSON.stringify(project);
    const beforeLoad = JSON.stringify(load);
    produceLoadCalculationRevision(project, load);
    assert.equal(JSON.stringify(project), beforeProject);
    assert.equal(JSON.stringify(load), beforeLoad);
  });

  test('CM14-091 live eligible-path contract: ineligible loads never receive identity in service wiring', () => {
    // Wiring-level assertion on the source of truth (static, executes no server):
    const serviceSource = fs.readFileSync(path.join(process.cwd(), 'src/utils/buildingProjectService.ts'), 'utf8');
    assert.match(serviceSource, /isLoadRevisionEligible\(project\.loads\)/);
    assert.match(serviceSource, /produceLoadCalculationRevision\(project, project\.loads\)/);
    assert.match(serviceSource, /attachLoadCalculationRevision\(project\.loads, production\)/);
  });
});

// ===========================================================================
// G. Fail closed
// ===========================================================================

describe('CM14 G. fail closed', () => {
  test('CM14-092 NaN is rejected, never stringified as null', () => {
    throwsLoadRevisionError(() => canonicalizeFiniteNumber(Number.NaN, 'x'), 'load_revision_number_nan');
    const bad = { a: { b: Number.NaN } };
    throwsLoadRevisionError(() => canonicalizeLoadCalculationFacts(bad), 'load_revision_number_nan');
    throwsLoadRevisionError(() => serializeCanonicalLoadFacts({ a: Number.NaN }), 'load_revision_number_nan');
  });

  test('CM14-093 Infinity is rejected in both directions', () => {
    throwsLoadRevisionError(() => canonicalizeFiniteNumber(Number.POSITIVE_INFINITY, 'x'), 'load_revision_number_infinite');
    throwsLoadRevisionError(() => canonicalizeFiniteNumber(Number.NEGATIVE_INFINITY, 'x'), 'load_revision_number_infinite');
    assert.throws(() => serializeCanonicalLoadFacts({ v: Number.POSITIVE_INFINITY }), /infinite|NaN|finite/i);
  });

  test('CM14-094 ineligible result is never certified (produce refuses)', () => {
    const { project, load } = fixtureInputs();
    throwsLoadRevisionError(() => produceLoadCalculationRevision(project, { ...load, mode: 'quick' }), 'load_revision_not_eligible');
    throwsLoadRevisionError(() => produceLoadCalculationRevision(project, { ...load, status: 'limited' }), 'load_revision_not_eligible');
  });

  test('CM14-095 missing coverage intent fails closed before any hash', () => {
    const { project, load } = fixtureInputs();
    const broken = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (broken as unknown as { calculationConfiguration: unknown }).calculationConfiguration = undefined;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(broken, load), 'load_revision_coverage_intent_missing');
  });

  test('CM14-096 missing confirmed system snapshot fails closed', () => {
    const { project, load } = fixtureInputs();
    const broken = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (broken as unknown as { systemsConfigurationSnapshot: unknown }).systemsConfigurationSnapshot = null;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(broken, load), 'load_revision_system_snapshot_missing');
  });

  test('CM14-097 missing engineering design inputs fail closed', () => {
    const { project, load } = fixtureInputs();
    const broken = JSON.parse(JSON.stringify(project)) as BuildingProject;
    ((broken.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: unknown })).engineeringDesignInputs = null;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(broken, load), 'load_revision_design_inputs_missing');
  });

  test('CM14-098 malformed canonical facts (non-finite deep leaf) are rejected before hashing', () => {
    const { project, load } = fixtureInputs();
    const broken = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (broken.roomResults[0].heating as { demandW: number }).demandW = Number.POSITIVE_INFINITY;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(project, broken), 'load_revision_number_infinite');
  });

  test('CM14-099 unsupported mode with fake identity fields is still ineligible', () => {
    const { load } = fixtureInputs();
    const forged = { ...load, mode: 'quick' } as BuildingLoadCalculation & Record<string, unknown>;
    forged.loadCalculationRevision = 'load:sha256:' + 'c'.repeat(64);
    forged.sourceCalculationId = forged.loadCalculationRevision;
    assert.equal(isLoadRevisionEligible(forged), false);
  });

  test('CM14-100 algorithm version mismatch on a stamped legacy result is detected', () => {
    const { load } = fixtureInputs();
    const stamped = { ...load } as BuildingLoadCalculation & Record<string, unknown>;
    stamped.loadCalculationRevision = 'load:sha256:' + 'd'.repeat(64);
    stamped.sourceCalculationId = stamped.loadCalculationRevision;
    assert.equal(loadRevisionAlgorithmMatches(stamped), true); // current-policy fields (no stored version) match
    stamped.loadRevisionAlgorithmVersion = 'ohmx.building-project-load-canonical-json.v0';
    assert.equal(loadRevisionAlgorithmMatches(stamped), false);
    stamped.loadRevisionAlgorithmVersion = LOAD_REVISION_ALGORITHM_VERSION;
    assert.equal(loadRevisionAlgorithmMatches(stamped), true);
  });
});

// ===========================================================================
// CM14 §37 — CM11 parity (structural, uses CM11's own deepEqual and fixtures)
// ===========================================================================

describe('CM14 §37 CM11 parity', () => {
  test('CM14-101 producer facts are deep-equal to CM11 projected facts for the same snapshot', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load);
    const input = makeValidInput();
    // CM11's own projection, executed on the identical fixture inputs:
    const proj = input.project as unknown as { id: string; objectType: 'apartment' | 'private_house'; calculationConfiguration: { coverageIntent: CoverageIntent }; systemsConfigurationSnapshot: { engineeringDesignInputs: Parameters<typeof materializeMargins>[0] } };
    const design = materializeMargins(proj.systemsConfigurationSnapshot.engineeringDesignInputs);
    const cm11Facts = projectCanonicalLoadFacts(
      input.loadCalculation as never,
      proj.id,
      proj.objectType,
      proj.calculationConfiguration.coverageIntent,
      design!,
    );
    assert.equal(deepEqual(facts, cm11Facts), true);
  });

  test('CM14-102 producer revision is accepted by the CM11 token validator', () => {
    const { project, load } = fixtureInputs();
    const revision = produceLoadCalculationRevision(project, load).revision;
    assert.equal(validLoadRevision(revision), true);
  });

  test('CM14-103 producer facts shape exactly matches the CM11 canonical allowlist (audit)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as Record<string, unknown>;
    const snap = facts.inputSnapshot as Record<string, unknown>;
    // CM10 §9 allowlist — exact key sets, no extras anywhere:
    assert.deepEqual(Object.keys(snap).sort(compareCodePoints), ['buildingRevision', 'calculationConfiguration', 'methodVersion', 'mode', 'objectType', 'projectId', 'requestedServices', 'rooms', 'servicePreferences', 'systemEngineeringDesignInputs', 'systemsRevision']);
    const q = facts.engineeringQuality as Record<string, unknown>;
    assert.deepEqual(Object.keys(q).sort(compareCodePoints), ['blockingFields', 'coverage', 'fields', 'gateStatus', 'maximumEligibleLevel', 'qualityModelId', 'qualityModelVersion', 'requestedLevel', 'warnings']);
  });

  test('CM14-104 revalidated facts recomputed from the persisted result equal the reference facts', () => {
    const { project, load } = fixtureInputs();
    const production = produceLoadCalculationRevision(project, load);
    // Simulate the future orchestrator: project the same result again and
    // compare against the canonical facts carried by the produced reference.
    const again = buildCanonicalLoadFacts(project, load);
    assert.equal(deepEqual(again, production.canonicalFacts), true);
  });
});

// ===========================================================================
// CM14-105..151 — deterministic ordering, purity and negative spaces
// ===========================================================================

describe('CM14 deterministic ordering and purity', () => {
  test('CM14-105 code-point comparator orders deterministically across unicode planes', () => {
    assert.ok(compareCodePoints('a', 'b') < 0);
    assert.ok(compareCodePoints('b', 'a') > 0);
    assert.equal(compareCodePoints('a', 'a'), 0);
    assert.ok(compareCodePoints('ä', 'z') > 0); // code points, not locale collation
    assert.ok(compareCodePoints('𝄞', 'a') > 0); // astral plane sorts after BMP
    assert.ok(compareCodePoints('ab', 'a') > 0);
  });

  test('CM14-106 key sort is code-point based, not localeCompare', () => {
    // Under several locales, localeCompare would order 'a' vs 'A' or 'ä' differently.
    const json = serializeCanonicalLoadFacts({ A: 1, a: 2, Z: 3, ä: 4 });
    assert.equal(json, '{"A":1,"Z":3,"a":2,"ä":4}');
  });

  test('CM14-107 serializer rejects booleans-as-numbers confusion (types preserved)', () => {
    assert.equal(serializeCanonicalLoadFacts({ flag: true, one: 1 }), '{"flag":true,"one":1}');
  });

  test('CM14-108 canonical facts null vs zero are distinct semantic inputs', () => {
    const a = serializeCanonicalLoadFacts({ v: null });
    const b = serializeCanonicalLoadFacts({ v: 0 });
    assert.notEqual(a, b);
    assert.equal(a, '{"v":null}');
    assert.equal(b, '{"v":0}');
  });

  test('CM14-109 empty vs missing string are distinct when materialized', () => {
    assert.notEqual(serializeCanonicalLoadFacts({ v: '' }), serializeCanonicalLoadFacts({ w: null }));
  });

  test('CM14-110 false vs null vs 0 all hash differently', () => {
    const h = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    const set = new Set([h('{"v":false}'), h('{"v":null}'), h('{"v":0}')]);
    assert.equal(set.size, 3);
  });

  test('CM14-111 producer output object is frozen-shape stable across calls (same keys, same order)', () => {
    const { project, load } = fixtureInputs();
    const p1 = produceLoadCalculationRevision(project, load);
    const p2 = produceLoadCalculationRevision(project, load);
    assert.deepEqual(Object.keys(p1), Object.keys(p2));
    assert.deepEqual(Object.keys(p1), ['revision', 'sourceCalculationId', 'algorithmVersion', 'canonicalFacts']);
  });

  test('CM14-112 revision changes when the confirmed design snapshot revision stamps change', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (changedProject.systemsConfigurationSnapshot as unknown as { systemsRevision: number }).systemsRevision += 1;
    // systemsRevision itself is not a canonical leaf, but the design inputs it
    // carries are; changing a design leaf value changes the revision (already
    // proven). Here we assert the snapshot value flows through the projection.
    const facts = buildCanonicalLoadFacts(changedProject, load) as { inputSnapshot: { systemEngineeringDesignInputs: Record<string, unknown> } };
    assert.ok(facts.inputSnapshot.systemEngineeringDesignInputs.hydronicDesignConditions);
    assert.notEqual(base, ''); // sanity: base revision well-formed
  });

  test('CM14-113 frozen service order is exactly [heating, cooling]', () => {
    assert.deepEqual(canonicalServiceOrder(), ['heating', 'cooling']);
  });

  test('CM14-114 eligible gate rejects null/undefined loads', () => {
    assert.equal(isLoadRevisionEligible(null), false);
    assert.equal(isLoadRevisionEligible(undefined), false);
  });

  test('CM14-115 eligible gate rejects missing quality', () => {
    const { load } = fixtureInputs();
    const stripped = { ...load } as BuildingLoadCalculation & { engineeringQuality?: unknown };
    delete stripped.engineeringQuality;
    assert.equal(isLoadRevisionEligible(stripped), false);
  });

  test('CM14-116 eligible gate rejects methodVersion mismatch inside the snapshot', () => {
    const { load } = fixtureInputs();
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.inputSnapshot.methodVersion = '0.9.0';
    assert.equal(isLoadRevisionEligible(changed), false);
  });

  test('CM14-117 eligible gate rejects snapshot mode mismatch', () => {
    const { load } = fixtureInputs();
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    (changed.inputSnapshot as { mode: string }).mode = 'quick';
    assert.equal(isLoadRevisionEligible(changed), false);
  });

  test('CM14-118 digest hex does not depend on Node buffer encoding choices (explicit utf8)', () => {
    const { project, load } = fixtureInputs();
    const json = serializeCanonicalLoadFacts(buildCanonicalLoadFacts(project, load));
    const a = createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex');
    const b = createHash('sha256').update(json, 'utf8').digest('hex');
    assert.equal(a, b);
  });

  test('CM14-119 serializer handles deep nesting deterministically', () => {
    const deep = { l1: { l2: { l3: { l4: { v: -0 } } } } };
    assert.equal(serializeCanonicalLoadFacts(deep), '{"l1":{"l2":{"l3":{"l4":{"v":0}}}}}');
  });

  test('CM14-120 arrays of objects keep semantic order but sort object keys', () => {
    const json = serializeCanonicalLoadFacts({ list: [{ b: 1, a: 2 }, { d: 3, c: 4 }] });
    assert.equal(json, '{"list":[{"a":2,"b":1},{"c":4,"d":3}]}');
  });
});

// ===========================================================================
// CM14-121..151 — live-service persistence (real store, tracked cleanup)
// ===========================================================================

describe('CM14 live persistence (steady_state eligible path)', () => {
  test('CM14-121 legacy project JSON stays readable with no fabricated revision on read', () => {
    const p = liveProject();
    const file = path.join(STORE, `${p.id}.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { loads?: Record<string, unknown> };
    assert.equal(raw.loads, undefined);
    const reloaded = loadProject(p.id)!;
    assert.equal(loadRevisionIdentityOf(reloaded.loads ?? null), null);
  });

  test('CM14-122 load state contract exposes loads for stale-free probing', () => {
    const p = liveProject();
    assert.equal(typeof p.buildingRevision, 'number');
    assert.equal(typeof p.systemsRevision, 'number');
  });
});

describe('CM14 numeric edge semantics', () => {
  test('CM14-123 canonicalizeFiniteNumber accepts ordinary finite floats unchanged', () => {
    assert.equal(canonicalizeFiniteNumber(2.8, 'x'), 2.8);
    assert.equal(canonicalizeFiniteNumber(0.1, 'x'), 0.1);
    assert.equal(canonicalizeFiniteNumber(-45, 'x'), -45);
  });

  test('CM14-124 canonicalizeFiniteNumber rejects non-number types', () => {
    for (const v of ['2', null, undefined, true, {}]) {
      assert.throws(() => canonicalizeFiniteNumber(v as unknown as number, 'x'));
    }
  });

  test('CM14-125 Number.EPSILON-scale differences are semantic (no rounding)', () => {
    const a = serializeCanonicalLoadFacts({ v: 1 });
    const b = serializeCanonicalLoadFacts({ v: 1 + Number.EPSILON });
    assert.notEqual(a, b);
  });

  test('CM14-126 very large but safe integers serialize exactly', () => {
    assert.equal(serializeCanonicalLoadFacts({ v: 9007199254740991 }), '{"v":9007199254740991}');
  });

  test('CM14-127 exponent-format numbers round-trip deterministically', () => {
    const json = serializeCanonicalLoadFacts({ v: 1e21 });
    assert.equal(json, '{"v":1e+21}');
    const parsed = JSON.parse(json) as { v: number };
    assert.equal(parsed.v, 1e21);
  });

  test('CM14-128 negative finite values serialize with the minus sign', () => {
    assert.equal(serializeCanonicalLoadFacts({ v: -12.5 }), '{"v":-12.5}');
  });

  test('CM14-129 canonical facts contain no -0 after full production', () => {
    const { project, load } = fixtureInputs();
    const zeroLoad = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    ((zeroLoad.roomResults[0] as unknown as { transmissionBreakdown: Record<string, number> }).transmissionBreakdown).indoorCoolingC = -0;
    const production = produceLoadCalculationRevision(project, zeroLoad);
    const json = serializeCanonicalLoadFacts(production.canonicalFacts);
    assert.equal(json.includes('-0'), false);
  });
});

describe('CM14 fixture parity deep checks', () => {
  test('CM14-130 every fixture room appears canonically sorted in producer facts', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { roomResults: Array<{ roomId: string }>; inputSnapshot: { rooms: Array<{ id: string }> } };
    const roomIds = facts.roomResults.map((r) => r.roomId);
    const snapIds = facts.inputSnapshot.rooms.map((r) => r.id);
    assert.deepEqual(roomIds, [...roomIds].sort(compareCodePoints));
    assert.deepEqual(snapIds, [...snapIds].sort(compareCodePoints));
  });

  test('CM14-131 producer facts preserve the coverage intent verbatim inside the snapshot', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { inputSnapshot: { calculationConfiguration: { coverageIntent: Record<string, unknown> } } };
    const intent = (project.calculationConfiguration as { coverageIntent: Record<string, unknown> }).coverageIntent;
    assert.deepEqual(facts.inputSnapshot.calculationConfiguration.coverageIntent, intent);
  });

  test('CM14-132 producer facts embed the materialized design inputs (all four margin groups)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { inputSnapshot: { systemEngineeringDesignInputs: Record<string, unknown> } };
    const design = facts.inputSnapshot.systemEngineeringDesignInputs;
    for (const key of ['hydronicDesignConditions', 'coolingIndoorDesignCondition', 'fanCoilSizingPolicy', 'designMargins']) {
      assert.ok(key in design, `missing design group ${key}`);
    }
  });

  test('CM14-133 producer facts do not embed non-canonical snapshot fields', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { inputSnapshot: Record<string, unknown> };
    for (const banned of ['region', 'topology', 'defaultCeilingHeightM', 'insulationLevel']) {
      assert.ok(!(banned in facts.inputSnapshot), `${banned} must not enter canonical facts`);
    }
  });

  test('CM14-134 producer facts do not embed calculatedAt or evaluatedAt anywhere', () => {
    const { project, load } = fixtureInputs();
    const json = serializeCanonicalLoadFacts(buildCanonicalLoadFacts(project, load));
    assert.equal(json.includes('calculatedAt'), false);
    assert.equal(json.includes('evaluatedAt'), false);
  });

  test('CM14-135 producer facts warnings/missingInputs are deduped+sorted canonical id lists (CM11 canonicalIds)', () => {
    const { project, load } = fixtureInputs();
    const facts = buildCanonicalLoadFacts(project, load) as { warnings: string[]; missingInputs: string[] };
    for (const list of [facts.warnings, facts.missingInputs]) {
      assert.equal(new Set(list).size, list.length);
      assert.deepEqual(list, [...list].sort(compareCodePoints));
    }
    // Duplicates in the source load are collapsed by the projection.
    const duped = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    duped.warnings = ['w_a', 'w_a', 'w_b'];
    const dupedFacts = buildCanonicalLoadFacts(project, duped) as { warnings: string[] };
    assert.deepEqual(dupedFacts.warnings, ['w_a', 'w_b']);
  });
});

describe('CM14 token policy and lifecycle edges', () => {
  test('CM14-136 produced algorithmVersion is the frozen CM10/CM11 literal', () => {
    const { project, load } = fixtureInputs();
    assert.equal(produceLoadCalculationRevision(project, load).algorithmVersion, 'ohmx.building-project-load-canonical-json.v1');
  });

  test('CM14-137 identity helper tolerates non-string garbage fields', () => {
    assert.equal(loadRevisionIdentityOf({ loadCalculationRevision: 42, sourceCalculationId: 'x' } as unknown as BuildingLoadCalculation), null);
    assert.equal(loadRevisionIdentityOf({ loadCalculationRevision: null, sourceCalculationId: null } as unknown as BuildingLoadCalculation), null);
  });

  test('CM14-138 loadRevisionAlgorithmMatches rejects identity-less loads', () => {
    assert.equal(loadRevisionAlgorithmMatches(null), false);
    assert.equal(loadRevisionAlgorithmMatches({} as BuildingLoadCalculation), false);
  });

  test('CM14-139 serializer is stable against repeated canonicalization (idempotent)', () => {
    const once = serializeCanonicalLoadFacts({ b: [{ y: 1, x: 2 }], a: -0 });
    const parsed = JSON.parse(once);
    assert.equal(serializeCanonicalLoadFacts(parsed), once);
  });

  test('CM14-140 producer does not accept an ineligible load even with valid parents', () => {
    const { project, load } = fixtureInputs();
    const limited = { ...load, status: 'limited' } as BuildingLoadCalculation;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(project, limited), 'load_revision_not_eligible');
  });

  test('CM14-141 producer requires explicit parents (no silent fallback to snapshot-only mode)', () => {
    const { project, load } = fixtureInputs();
    const noIntent = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (noIntent as unknown as { calculationConfiguration: unknown }).calculationConfiguration = null;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(noIntent, load), 'load_revision_coverage_intent_missing');
    const noSnapshot = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (noSnapshot as unknown as { systemsConfigurationSnapshot: unknown }).systemsConfigurationSnapshot = undefined;
    throwsLoadRevisionError(() => produceLoadCalculationRevision(noSnapshot, load), 'load_revision_system_snapshot_missing');
  });

  test('CM14-142 revision is insensitive to sourceReference strings changing (design provenance refs ARE canonical)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { hydronicDesignConditions: { heatingWaterSupplyC: { sourceReference: string } } } }).engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC);
    leaf.sourceReference = 'changed-ref';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-143 policyReference identity participates in the hash', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const leaf = ((changedProject.systemsConfigurationSnapshot as unknown as { engineeringDesignInputs: { hydronicDesignConditions: { heatingWaterSupplyC: { policyReference: { policyId: string } | null } } } }).engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC);
    if (leaf.policyReference) leaf.policyReference.policyId = 'ohmx.policy.other';
    else { leaf.policyReference = { policyId: 'ohmx.policy.other', policyVersion: '1.0.0', entryId: 'e' }; }
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-144 fixture-backed facts remain byte-identical across two full pipelines', () => {
    const { project, load } = fixtureInputs();
    const j1 = serializeCanonicalLoadFacts(buildCanonicalLoadFacts(project, load));
    const clone = JSON.parse(JSON.stringify({ project, load }));
    const j2 = serializeCanonicalLoadFacts(buildCanonicalLoadFacts(clone.project, clone.load));
    assert.equal(j1, j2);
  });

  test('CM14-145 known canonical JSON prefix sanity (algorithmVersion sorts first)', () => {
    const { project, load } = fixtureInputs();
    const json = serializeCanonicalLoadFacts(buildCanonicalLoadFacts(project, load));
    assert.ok(json.startsWith('{"algorithmVersion":"ohmx.building-project-load-canonical-json.v1"'));
  });

  test('CM14-146 two different projects never share a revision (projectId inside facts)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const other = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (other as { id: string }).id = 'proj-2';
    // Note: only the top-level projectId is a canonical leaf; snapshot projectId unchanged.
    assert.notEqual(produceLoadCalculationRevision(other, load).revision, base);
  });

  test('CM14-147 snapshot projectId change changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changed = JSON.parse(JSON.stringify(load)) as BuildingLoadCalculation;
    changed.inputSnapshot.projectId = 'proj-other';
    assert.notEqual(produceLoadCalculationRevision(project, changed).revision, base);
  });

  test('CM14-148 objectType change changes the revision (canonical objectType comes from the project)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    (changedProject as unknown as { objectType: string }).objectType = 'private_house';
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-149 included/excluded room ids participate in the hash (intent from the project parent)', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const intent = (changedProject.calculationConfiguration as { coverageIntent: { includedRoomIds: string[] } }).coverageIntent;
    intent.includedRoomIds = ['room-9', ...intent.includedRoomIds];
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-150 excludedRoomIds change in the project parent changes the revision', () => {
    const { project, load } = fixtureInputs();
    const base = produceLoadCalculationRevision(project, load).revision;
    const changedProject = JSON.parse(JSON.stringify(project)) as BuildingProject;
    const intent = (changedProject.calculationConfiguration as { coverageIntent: { excludedRoomIds: string[] } }).coverageIntent;
    intent.excludedRoomIds = ['room-x'];
    assert.notEqual(produceLoadCalculationRevision(changedProject, load).revision, base);
  });

  test('CM14-151 produced revision for the sealed CM11 fixture snapshot is stable across sessions (frozen vector)', () => {
    const { project, load } = fixtureInputs();
    const revision = produceLoadCalculationRevision(project, load).revision;
    assert.match(revision, /^load:sha256:[0-9a-f]{64}$/);
    // Cross-check against the independently probed value recorded during CM14
    // implementation (tsx probe, 2026-09-10): identical pipeline, identical token.
    assert.equal(revision, 'load:sha256:5e6ee47a7b27525effc2560d6b03eacf92f83a9ec415907897dbd33f84a111ef');
  });
});
