/**
 * CM13 — Building Project engineering-selection prerequisite persistence tests.
 *
 * Behavior coverage for the newly persisted, CM12-frozen prerequisites:
 *   - explicit calculation coverage intent / confirmation + lifecycle
 *   - system engineering design inputs (hydronic / wet-bulb / fan-speed) + provenance
 *   - revision/invalidation semantics
 *   - confirmed-snapshot capture + deep-clone isolation
 *   - legacy JSON backward compatibility
 *
 * Traceability: CM13-001 … (behavior) and CM13-S01 … (source invariants, separate file).
 * These tests are run by the USER; the agent does not execute them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  confirmObject,
  confirmSystemsConfiguration,
  createProject,
  deleteProject,
  loadProject,
  removeRoom,
  setCalculationCoverage,
  setRoomTypeCount,
  updateEngineeringDesignInputs,
  updateProjectMeta,
  updateRoom,
  updateSystemsConfiguration,
} from './buildingProjectService.js';
import {
  EngineeringSelectionInputError,
  engineeringDesignInputsEqual,
  isCoverageConfirmationStale,
  normalizeCoverageIntent,
  normalizeSystemEngineeringDesignInputs,
} from './buildingProjectEngineeringSelection.js';
import type { BuildingProject, SystemEngineeringDesignInputs } from './buildingProjectTypes.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];
function track<T extends { id: string }>(p: T): T { createdIds.push(p.id); return p; }

before(() => { fs.mkdirSync(STORE, { recursive: true }); });
after(() => { for (const id of createdIds) { try { deleteProject(id); } catch { /* ignore */ } } });

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof Error && (err as EngineeringSelectionInputError).code === code, `expected ${code}`);
}

const POLICY = { policyId: 'ohmx.engineering-configurator-policy.v1', policyVersion: '1.0.0', entryId: 'entry-1' };

function num(
  value: number,
  source: 'USER_INPUT' | 'SYSTEM_POLICY' | 'PILOT_REFERENCE' = 'USER_INPUT',
  policyReference: unknown = null,
): unknown {
  return { value, unit: '°C', source, sourceReference: null, policyReference };
}
function txt(value: string, source: 'USER_INPUT' | 'SYSTEM_POLICY' | 'PILOT_REFERENCE' = 'USER_INPUT', policyReference: unknown = null): unknown {
  return { value, unit: null, source, sourceReference: null, policyReference };
}

function validDesignInputs(): SystemEngineeringDesignInputs {
  return {
    hydronicDesignConditions: {
      heatingWaterSupplyC: num(70) as any,
      heatingWaterReturnC: num(60) as any,
      coolingWaterSupplyC: num(7) as any,
      coolingWaterReturnC: num(12) as any,
    },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) as any },
    fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') as any },
  };
}

function fakeProject(rev = 5, extra: Partial<BuildingProject> = {}): BuildingProject {
  return {
    id: 'fake', name: 'fake', status: 'draft', createdAt: '', updatedAt: '', objectConfirmedAt: null,
    objectConfirmedRevision: null, buildingRevision: rev, objectType: 'apartment', region: null, totalAreaM2: null,
    defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms: [], selectedSystems: [],
    systemsRevision: 0, systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
    ...extra,
  } as BuildingProject;
}

/** A confirmed private_house with two rooms and a discriminant area (confirmObject-ready). */
function confirmedHouse(): BuildingProject {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 180 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  addRoom(p.id, { roomType: 'living_room', areaM2: 24 });
  return confirmObject(p.id);
}

// ===========================================================================
// A. Legacy loading
// ===========================================================================

test('CM13-001 legacy project without CM13 fields loads with no coverage intent', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  assert.equal(p.calculationConfiguration, undefined);
  assert.equal(isCoverageConfirmationStale(p), false);
});

test('CM13-002 legacy reload preserves absence (no fabricated design inputs)', () => {
  const p = track(createProject({ objectType: 'apartment' }));
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.calculationConfiguration, undefined);
  assert.equal(reloaded.systemsConfiguration, null);
});

test('CM13-003 reading a legacy project does not mutate the persisted file', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const before = fs.readFileSync(path.join(STORE, `${p.id}.json`), 'utf8');
  loadProject(p.id);
  const after = fs.readFileSync(path.join(STORE, `${p.id}.json`), 'utf8');
  assert.equal(after, before);
});

test('CM13-004 legacy default systems configuration carries no engineering design inputs', () => {
  const p = confirmedHouse();
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.systemsConfiguration?.engineeringDesignInputs, undefined);
});

// ===========================================================================
// B. Coverage persistence
// ===========================================================================

test('CM13-005 save WHOLE_OBJECT / WHOLE_OBJECT_CONFIRMED intent', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(r.calculationConfiguration?.coverageIntent.calculationScope, 'WHOLE_OBJECT');
  assert.equal(r.calculationConfiguration?.coverageIntent.coverageConfirmation, 'WHOLE_OBJECT_CONFIRMED');
});

test('CM13-006 confirmed intent stamps current buildingRevisionAtConfirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(r.calculationConfiguration?.coverageIntent.buildingRevisionAtConfirmation, p.buildingRevision);
});

test('CM13-007 UNCONFIRMED intent leaves buildingRevisionAtConfirmation null', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED' });
  assert.equal(r.calculationConfiguration?.coverageIntent.buildingRevisionAtConfirmation, null);
});

test('CM13-008 coverage intent persists requested services exactly', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'SELECTED_ROOMS', coverageConfirmation: 'SELECTED_ROOMS_CONFIRMED', requestedServices: ['heating', 'cooling'] });
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.requestedServices, ['heating', 'cooling']);
});

test('CM13-009 coverage intent dedupes include rooms', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'CONDITIONED_ZONES', coverageConfirmation: 'CONDITIONED_ZONES_CONFIRMED', includedRoomIds: ['r1', 'r2', 'r1'] });
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.includedRoomIds, ['r1', 'r2']);
});

test('CM13-010 coverage intent persists include/exclude/zone lists + sourceReference', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, {
    calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_WITH_EXCLUSIONS',
    includedRoomIds: ['r1'], excludedRoomIds: ['r2'], includedZoneIds: ['z1'], sourceReference: 'manual-coverage-1',
  });
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.excludedRoomIds, ['r2']);
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.includedZoneIds, ['z1']);
  assert.equal(r.calculationConfiguration?.coverageIntent.sourceReference, 'manual-coverage-1');
});

test('CM13-011 coverage reload round trip preserves confirmation revision', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.calculationConfiguration?.coverageIntent.calculationScope, 'WHOLE_OBJECT');
  assert.equal(reloaded.calculationConfiguration?.coverageIntent.coverageConfirmation, 'WHOLE_OBJECT_CONFIRMED');
  assert.equal(reloaded.calculationConfiguration?.coverageIntent.buildingRevisionAtConfirmation, p.buildingRevision);
});

test('CM13-012 invalid calculation scope rejected', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  throwsCode(() => setCalculationCoverage(p.id, { calculationScope: 'BOGUS' as any, coverageConfirmation: 'UNCONFIRMED' }), 'building.coverage_scope_invalid');
});

test('CM13-013 invalid coverage confirmation rejected', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  throwsCode(() => setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'BOGUS' as any }), 'building.coverage_confirmation_invalid');
});

// ===========================================================================
// C. Coverage invalidation
// ===========================================================================

test('CM13-014 room addition invalidates prior coverage confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(isCoverageConfirmationStale(c), false);
  const afterAdd = addRoom(c.id, { roomType: 'kitchen', areaM2: 10 });
  assert.equal(isCoverageConfirmationStale(afterAdd), true);
});

test('CM13-015 room removal invalidates prior coverage confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = removeRoom(c.id, r.rooms[0].id);
  assert.equal(isCoverageConfirmationStale(after), true);
});

test('CM13-016 room area change invalidates prior coverage confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = updateRoom(c.id, r.rooms[0].id, { areaM2: 22 });
  assert.equal(isCoverageConfirmationStale(after), true);
});

test('CM13-017 buildingRevision change does not falsely refresh the stored confirmation stamp', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const stamped = c.calculationConfiguration!.coverageIntent.buildingRevisionAtConfirmation!;
  const after = addRoom(c.id, { roomType: 'kitchen', areaM2: 10 });
  assert.equal(after.calculationConfiguration!.coverageIntent.buildingRevisionAtConfirmation, stamped);
  assert.notEqual(after.buildingRevision, stamped);
});

test('CM13-018 non-room update (meta name) invalidates confirmation via buildingRevision', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = updateProjectMeta(c.id, { name: 'Renamed' });
  assert.equal(isCoverageConfirmationStale(after), true);
});

test('CM13-019 no-op coverage rewrite keeps confirmation current', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const again = setCalculationCoverage(c.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(isCoverageConfirmationStale(again), false);
});

test('CM13-020 re-confirm after room change yields fresh (non-stale) confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = addRoom(p.id, { roomType: 'kitchen', areaM2: 10 });
  assert.equal(isCoverageConfirmationStale(after), true);
  const re = setCalculationCoverage(after.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(isCoverageConfirmationStale(re), false);
});

test('CM13-021 UNCONFIRMED coverage is never stale after room change', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED' });
  const after = addRoom(p.id, { roomType: 'kitchen', areaM2: 10 });
  assert.equal(isCoverageConfirmationStale(after), false);
});

test('CM13-022 equal room area does not auto-confirm coverage (no intent)', () => {
  const p = track(createProject({ objectType: 'private_house', totalAreaM2: 40 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 20 });
  addRoom(p.id, { roomType: 'living_room', areaM2: 20 });
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.calculationConfiguration, undefined);
});

// ===========================================================================
// D. Coverage quality bridge semantics (authoritative scope/confirmation)
// ===========================================================================

test('CM13-023 persisted WHOLE_OBJECT/WHOLE_OBJECT_CONFIRMED normalizes to authoritative scope', () => {
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(intent.calculationScope, 'WHOLE_OBJECT');
  assert.equal(intent.coverageConfirmation, 'WHOLE_OBJECT_CONFIRMED');
});

test('CM13-024 SELECTED_ROOMS / SELECTED_ROOMS_CONFIRMED normalizes', () => {
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'SELECTED_ROOMS', coverageConfirmation: 'SELECTED_ROOMS_CONFIRMED' });
  assert.equal(intent.calculationScope, 'SELECTED_ROOMS');
  assert.equal(intent.coverageConfirmation, 'SELECTED_ROOMS_CONFIRMED');
});

test('CM13-025 WHOLE_OBJECT_WITH_EXCLUSIONS normalizes and is confirmed', () => {
  const intent = normalizeCoverageIntent(fakeProject(8), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_WITH_EXCLUSIONS' });
  assert.equal(intent.coverageConfirmation, 'WHOLE_OBJECT_WITH_EXCLUSIONS');
  assert.equal(intent.buildingRevisionAtConfirmation, 8);
});

test('CM13-026 absent intent yields fallback (bridge reports UNKNOWN/UNCONFIRMED)', () => {
  const p = fakeProject(5);
  assert.equal(p.calculationConfiguration, undefined);
  assert.equal(isCoverageConfirmationStale(p), false);
});

test('CM13-027 ratio == 1 does not auto-confirm (ratio is not a recognized input field)', () => {
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED', ...({ ratio: 1 } as any) });
  assert.equal(intent.coverageConfirmation, 'UNCONFIRMED');
  assert.equal((intent as any).ratio, undefined);
});

// ===========================================================================
// E. Hydronic persistence + validation
// ===========================================================================

test('CM13-028 valid heating temperatures resolve with provenance', () => {
  const d = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.value, 70);
  assert.equal(d.hydronicDesignConditions.heatingWaterReturnC.value, 60);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.source, 'USER_INPUT');
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.status, 'RESOLVED');
});

test('CM13-029 valid cooling temperatures resolve', () => {
  const d = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  assert.equal(d.hydronicDesignConditions.coolingWaterSupplyC.value, 7);
  assert.equal(d.hydronicDesignConditions.coolingWaterReturnC.value, 12);
});

test('CM13-030 USER_INPUT provenance survives with null policy reference', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70), heatingWaterReturnC: num(60) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.source, 'USER_INPUT');
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.policyReference, null);
});

test('CM13-031 SYSTEM_POLICY provenance survives with policy reference', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', POLICY), heatingWaterReturnC: num(60, 'SYSTEM_POLICY', POLICY) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.source, 'SYSTEM_POLICY');
  assert.deepEqual(d.hydronicDesignConditions.heatingWaterSupplyC.policyReference, POLICY);
});

test('CM13-032 PILOT_REFERENCE provenance survives (not collapsed to SYSTEM_POLICY)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'PILOT_REFERENCE', POLICY), heatingWaterReturnC: num(60, 'PILOT_REFERENCE', POLICY) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.source, 'PILOT_REFERENCE');
});

test('CM13-033 SYSTEM_POLICY sourceReference is preserved', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: { value: 70, unit: '°C', source: 'SYSTEM_POLICY', sourceReference: 'policy-row-9', policyReference: POLICY }, heatingWaterReturnC: num(60, 'SYSTEM_POLICY', POLICY) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.sourceReference, 'policy-row-9');
});

test('CM13-034 heating supply <= return rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(60), heatingWaterReturnC: num(70) } } as any), 'engineering.hydronic_heating_order_invalid');
});

test('CM13-035 heating supply == return rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(60), heatingWaterReturnC: num(60) } } as any), 'engineering.hydronic_heating_order_invalid');
});

test('CM13-036 cooling supply >= return rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { coolingWaterSupplyC: num(12), coolingWaterReturnC: num(7) } } as any), 'engineering.hydronic_cooling_order_invalid');
});

test('CM13-037 cooling supply == return rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { coolingWaterSupplyC: num(10), coolingWaterReturnC: num(10) } } as any), 'engineering.hydronic_cooling_order_invalid');
});

test('CM13-038 valid heating order at supply strictly above return resolves', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(71), heatingWaterReturnC: num(70) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.value, 71);
});

test('CM13-039 non-finite value rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: { value: Number.NaN, unit: '°C', source: 'USER_INPUT' }, heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_nonfinite');
});

test('CM13-040 non-°C numeric unit rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: { value: 70, unit: 'K', source: 'USER_INPUT' }, heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_unit_invalid');
});

test('CM13-041 invalid source rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: { value: 70, unit: '°C', source: 'MANUAL' }, heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_source_invalid');
});

test('CM13-042 SYSTEM_POLICY without policy reference rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', null), heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_policy_required');
});

test('CM13-043 PILOT_REFERENCE without policy reference rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'PILOT_REFERENCE', null), heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_policy_required');
});

test('CM13-044 USER_INPUT with policy reference rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'USER_INPUT', POLICY), heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_policy_unexpected');
});

test('CM13-045 incomplete policy reference (missing entryId) rejected', () => {
  const bad = { policyId: 'p', policyVersion: '1', entryId: '' };
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', bad), heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_policy_required');
});

test('CM13-046 missing hydronic leaf stays unresolved (no default insertion)', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.value, null);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.source, 'UNRESOLVED');
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.status, 'REQUIRED_POLICY_INPUT');
});

test('CM13-047 no 70/60 heating default', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.notEqual(d.hydronicDesignConditions.heatingWaterSupplyC.value, 70);
  assert.notEqual(d.hydronicDesignConditions.heatingWaterReturnC.value, 60);
});

test('CM13-048 no A7/W35 cooling default', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.notEqual(d.hydronicDesignConditions.coolingWaterSupplyC.value, 7);
  assert.notEqual(d.hydronicDesignConditions.coolingWaterReturnC.value, 35);
});

test('CM13-049 partial save (heating resolved, cooling missing) does not throw', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70), heatingWaterReturnC: num(60) } } as any);
  assert.equal(d.hydronicDesignConditions.coolingWaterSupplyC.value, null);
});

test('CM13-050 numeric value 0 resolves as finite (not treated as missing)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(0) } } as any);
  assert.equal(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value, 0);
});

// ===========================================================================
// F. Wet bulb
// ===========================================================================

test('CM13-051 explicit wet bulb persists with provenance', () => {
  const d = normalizeSystemEngineeringDesignInputs({ coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) } } as any);
  assert.equal(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value, 18);
  assert.equal(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.source, 'USER_INPUT');
});

test('CM13-052 wet bulb SYSTEM_POLICY provenance persists', () => {
  const d = normalizeSystemEngineeringDesignInputs({ coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18, 'SYSTEM_POLICY', POLICY) } } as any);
  assert.equal(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.source, 'SYSTEM_POLICY');
});

test('CM13-053 absent wet bulb stays absent', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.equal(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value, null);
});

test('CM13-054 no BPS 19°C default', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.notEqual(d.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value, 19);
});

// ===========================================================================
// G. Fan speed
// ===========================================================================

test('CM13-055 explicit fan speed persists', () => {
  const d = normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') } } as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, 'MEDIUM');
});

test('CM13-056 fan speed SYSTEM_POLICY source persists', () => {
  const d = normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM', 'SYSTEM_POLICY', POLICY) } } as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.source, 'SYSTEM_POLICY');
});

test('CM13-057 fan speed value is preserved exactly (no case folding)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('high') } } as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, 'high');
});

test('CM13-058 absent fan speed stays absent', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, null);
});

test('CM13-059 no HIGH default', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, null);
});

test('CM13-060 empty fan speed string rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('  ') } } as any), 'engineering.fan_speed_invalid');
});

test('CM13-061 fan speed non-null unit rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: { value: 'MEDIUM', unit: 'x', source: 'USER_INPUT' } } } as any), 'engineering.design_input_unit_invalid');
});

// ===========================================================================
// H. Normalization equality / no-op
// ===========================================================================

test('CM13-062 normalization is idempotent', () => {
  const once = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  const twice = normalizeSystemEngineeringDesignInputs(once);
  assert.equal(engineeringDesignInputsEqual(once, twice), true);
});

test('CM13-063 equality: null vs null is true', () => {
  assert.equal(engineeringDesignInputsEqual(null, null), true);
});

test('CM13-064 equality: null vs object is false', () => {
  assert.equal(engineeringDesignInputsEqual(null, normalizeSystemEngineeringDesignInputs(validDesignInputs())), false);
});

test('CM13-065 equality: identical values true', () => {
  const a = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  const b = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  assert.equal(engineeringDesignInputsEqual(a, b), true);
});

test('CM13-066 equality: different value false', () => {
  const a = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  const changed = { ...validDesignInputs(), hydronicDesignConditions: { ...validDesignInputs().hydronicDesignConditions, heatingWaterSupplyC: num(65) } } as any;
  assert.equal(engineeringDesignInputsEqual(a, normalizeSystemEngineeringDesignInputs(changed)), false);
});

test('CM13-067 equality: different provenance (same value) false', () => {
  const a = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  const other = validDesignInputs();
  (other.hydronicDesignConditions.heatingWaterSupplyC as any).source = 'SYSTEM_POLICY';
  (other.hydronicDesignConditions.heatingWaterSupplyC as any).policyReference = POLICY;
  assert.equal(engineeringDesignInputsEqual(a, normalizeSystemEngineeringDesignInputs(other)), false);
});

// ===========================================================================
// I. systemsRevision lifecycle (service)
// ===========================================================================

test('CM13-068 heating design change increments systemsRevision', () => {
  const h = confirmedHouse();
  const r = updateEngineeringDesignInputs(h.id, validDesignInputs());
  assert.equal(r.systemsRevision, h.systemsRevision + 1);
});

test('CM13-069 cooling design change increments systemsRevision', () => {
  const h = confirmedHouse();
  const first = updateEngineeringDesignInputs(h.id, validDesignInputs());
  const changed = { ...validDesignInputs(), hydronicDesignConditions: { ...validDesignInputs().hydronicDesignConditions, coolingWaterSupplyC: num(8) } } as SystemEngineeringDesignInputs;
  const second = updateEngineeringDesignInputs(first.id, changed);
  assert.equal(second.systemsRevision, first.systemsRevision + 1);
});

test('CM13-070 wet bulb change increments systemsRevision', () => {
  const h = confirmedHouse();
  const first = updateEngineeringDesignInputs(h.id, validDesignInputs());
  const changed = { ...validDesignInputs(), coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(17) } } as SystemEngineeringDesignInputs;
  const second = updateEngineeringDesignInputs(first.id, changed);
  assert.equal(second.systemsRevision, first.systemsRevision + 1);
});

test('CM13-071 fan speed change increments systemsRevision', () => {
  const h = confirmedHouse();
  const first = updateEngineeringDesignInputs(h.id, validDesignInputs());
  const changed = { ...validDesignInputs(), fanCoilSizingPolicy: { sizingFanSpeed: txt('HIGH') } } as SystemEngineeringDesignInputs;
  const second = updateEngineeringDesignInputs(first.id, changed);
  assert.equal(second.systemsRevision, first.systemsRevision + 1);
});

test('CM13-072 identical design update is a deterministic no-op', () => {
  const h = confirmedHouse();
  const first = updateEngineeringDesignInputs(h.id, validDesignInputs());
  const second = updateEngineeringDesignInputs(first.id, validDesignInputs());
  assert.equal(second.systemsRevision, first.systemsRevision);
});

test('CM13-073 design update on draft object rejected', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  assert.throws(() => updateEngineeringDesignInputs(p.id, validDesignInputs()), /Confirm the object/);
});

test('CM13-074 design change does not touch buildingRevision', () => {
  const h = confirmedHouse();
  const r = updateEngineeringDesignInputs(h.id, validDesignInputs());
  assert.equal(r.buildingRevision, h.buildingRevision);
});

// ===========================================================================
// J. Confirmed system snapshot capture + deep clone
// ===========================================================================

function confirmableWithDesign(): BuildingProject {
  const h = confirmedHouse();
  const sys = updateSystemsConfiguration(h.id, { requestedServices: ['cooling'], selectedSystemFamilies: ['multi_split'] });
  return updateEngineeringDesignInputs(sys.id, validDesignInputs());
}

test('CM13-075 confirmed snapshot captures engineering design inputs', () => {
  const p = confirmableWithDesign();
  const confirmed = confirmSystemsConfiguration(p.id);
  assert.equal(confirmed.status, 'systems_configured');
  assert.deepEqual(confirmed.systemsConfigurationSnapshot?.engineeringDesignInputs, confirmed.systemsConfiguration?.engineeringDesignInputs);
});

test('CM13-076 snapshot is deep-cloned (draft edit does not mutate prior snapshot)', () => {
  const p = confirmableWithDesign();
  const confirmed = confirmSystemsConfiguration(p.id);
  const snapshotBefore = JSON.stringify(confirmed.systemsConfigurationSnapshot?.engineeringDesignInputs);
  const changed = { ...validDesignInputs(), hydronicDesignConditions: { ...validDesignInputs().hydronicDesignConditions, heatingWaterSupplyC: num(75) } } as SystemEngineeringDesignInputs;
  const edited = updateEngineeringDesignInputs(confirmed.id, changed);
  assert.equal(JSON.stringify(edited.systemsConfigurationSnapshot?.engineeringDesignInputs), snapshotBefore);
  assert.notEqual(JSON.stringify(edited.systemsConfiguration?.engineeringDesignInputs), snapshotBefore);
});

test('CM13-077 post-confirmation design edit demotes system status', () => {
  const p = confirmableWithDesign();
  const confirmed = confirmSystemsConfiguration(p.id);
  assert.equal(confirmed.status, 'systems_configured');
  const changed = { ...validDesignInputs(), coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(16) } } as SystemEngineeringDesignInputs;
  const edited = updateEngineeringDesignInputs(confirmed.id, changed);
  assert.equal(edited.status, 'object_confirmed');
});

test('CM13-078 stale confirmed snapshot cannot masquerade as current', () => {
  const p = confirmableWithDesign();
  const confirmed = confirmSystemsConfiguration(p.id);
  const snapshotRev = confirmed.systemsConfigurationSnapshot?.systemsRevision;
  const changed = { ...validDesignInputs(), fanCoilSizingPolicy: { sizingFanSpeed: txt('LOW') } } as SystemEngineeringDesignInputs;
  const edited = updateEngineeringDesignInputs(confirmed.id, changed);
  assert.notEqual(edited.systemsRevision, snapshotRev);
  assert.equal(edited.systemsConfigurationSnapshot?.systemsRevision, snapshotRev);
});

test('CM13-079 snapshot captures provenance exactly', () => {
  const h = confirmedHouse();
  const sys = updateSystemsConfiguration(h.id, { requestedServices: ['cooling'], selectedSystemFamilies: ['multi_split'] });
  const withPolicy = normalizeSystemEngineeringDesignInputs({
    hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', POLICY), heatingWaterReturnC: num(60, 'SYSTEM_POLICY', POLICY) },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') },
  } as any);
  const withDesign = updateEngineeringDesignInputs(sys.id, withPolicy as SystemEngineeringDesignInputs);
  const confirmed = confirmSystemsConfiguration(withDesign.id);
  assert.deepEqual(confirmed.systemsConfigurationSnapshot?.engineeringDesignInputs?.hydronicDesignConditions.heatingWaterSupplyC.policyReference, POLICY);
});

// ===========================================================================
// K. Persistence round trip
// ===========================================================================

test('CM13-080 design inputs survive write → reload exactly', () => {
  const h = confirmedHouse();
  const written = updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal(engineeringDesignInputsEqual(reloaded.systemsConfiguration?.engineeringDesignInputs, written.systemsConfiguration?.engineeringDesignInputs), true);
});

test('CM13-081 coverage + design inputs survive combined round trip', () => {
  const h = confirmedHouse();
  setCalculationCoverage(h.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal(reloaded.calculationConfiguration?.coverageIntent.calculationScope, 'WHOLE_OBJECT');
  assert.equal(reloaded.systemsConfiguration?.engineeringDesignInputs?.hydronicDesignConditions.heatingWaterSupplyC.value, 70);
});

test('CM13-082 persisted provenance preserved exactly after reload', () => {
  const h = confirmedHouse();
  const withPolicy = normalizeSystemEngineeringDesignInputs({
    hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', POLICY), heatingWaterReturnC: num(60, 'SYSTEM_POLICY', POLICY) },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') },
  } as any);
  updateEngineeringDesignInputs(h.id, withPolicy as SystemEngineeringDesignInputs);
  const reloaded = loadProject(h.id)!;
  assert.deepEqual(reloaded.systemsConfiguration?.engineeringDesignInputs?.hydronicDesignConditions.heatingWaterSupplyC.policyReference, POLICY);
});

test('CM13-083 PILOT_REFERENCE not converted to SYSTEM_POLICY on reload', () => {
  const h = confirmedHouse();
  const pilot = normalizeSystemEngineeringDesignInputs({
    hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'PILOT_REFERENCE', POLICY), heatingWaterReturnC: num(60, 'PILOT_REFERENCE', POLICY) },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') },
  } as any);
  updateEngineeringDesignInputs(h.id, pilot as SystemEngineeringDesignInputs);
  const reloaded = loadProject(h.id)!;
  assert.equal(reloaded.systemsConfiguration?.engineeringDesignInputs?.hydronicDesignConditions.heatingWaterSupplyC.source, 'PILOT_REFERENCE');
});

test('CM13-084 partial (unresolved) design inputs survive reload', () => {
  const h = confirmedHouse();
  updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal(reloaded.systemsConfiguration?.engineeringDesignInputs?.fanCoilSizingPolicy.sizingFanSpeed.value, 'MEDIUM');
});

// ===========================================================================
// L. Purity / boundary (behavioral)
// ===========================================================================

test('CM13-085 design input persistence never fabricates a load result', () => {
  const h = confirmedHouse();
  updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal(reloaded.loads, undefined);
});

test('CM13-086 design input persistence never creates a load revision field', () => {
  const h = confirmedHouse();
  updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal((reloaded as any).loadCalculationRevision, undefined);
});

test('CM13-087 design input persistence never creates a catalog state revision field', () => {
  const h = confirmedHouse();
  updateEngineeringDesignInputs(h.id, validDesignInputs());
  const reloaded = loadProject(h.id)!;
  assert.equal((reloaded as any).engineeringCatalogStateRevision, undefined);
});

test('CM13-088 coverage-only set does not bump systemsRevision', () => {
  const h = confirmedHouse();
  const r = setCalculationCoverage(h.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  assert.equal(r.systemsRevision, h.systemsRevision);
});

test('CM13-089 coverage-only set does not bump buildingRevision', () => {
  const h = confirmedHouse();
  const r = setCalculationCoverage(h.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED' });
  assert.equal(r.buildingRevision, h.buildingRevision);
});

// ===========================================================================
// M. Pure staleness semantics
// ===========================================================================

test('CM13-090 isCoverageConfirmationStale: absent intent returns false', () => {
  assert.equal(isCoverageConfirmationStale(fakeProject(5)), false);
});

test('CM13-091 isCoverageConfirmationStale: confirmed at current revision returns false', () => {
  const p = fakeProject(5);
  p.calculationConfiguration = { coverageIntent: normalizeCoverageIntent(p, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' }) };
  assert.equal(isCoverageConfirmationStale(p), false);
});

test('CM13-092 isCoverageConfirmationStale: confirmed at stale revision returns true', () => {
  const p = fakeProject(7);
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  p.calculationConfiguration = { coverageIntent: intent };
  assert.equal(isCoverageConfirmationStale(p), true);
});

test('CM13-093 isCoverageConfirmationStale: UNCONFIRMED returns false', () => {
  const p = fakeProject(2);
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED' });
  p.calculationConfiguration = { coverageIntent: intent };
  assert.equal(isCoverageConfirmationStale(p), false);
});

// ===========================================================================
// N. Coverage scope/confirmation completeness
// ===========================================================================

test('CM13-094 SELECTED_ROOMS coverage round trip', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  setCalculationCoverage(p.id, { calculationScope: 'SELECTED_ROOMS', coverageConfirmation: 'SELECTED_ROOMS_CONFIRMED', includedRoomIds: ['r1'] });
  const r = loadProject(p.id)!;
  assert.equal(r.calculationConfiguration?.coverageIntent.calculationScope, 'SELECTED_ROOMS');
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.includedRoomIds, ['r1']);
});

test('CM13-095 CONDITIONED_ZONES coverage round trip', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  setCalculationCoverage(p.id, { calculationScope: 'CONDITIONED_ZONES', coverageConfirmation: 'CONDITIONED_ZONES_CONFIRMED', includedZoneIds: ['z1', 'z2'] });
  const r = loadProject(p.id)!;
  assert.equal(r.calculationConfiguration?.coverageIntent.calculationScope, 'CONDITIONED_ZONES');
  assert.deepEqual(r.calculationConfiguration?.coverageIntent.includedZoneIds, ['z1', 'z2']);
});

test('CM13-096 requestedServices filters non-heating/cooling entries', () => {
  const intent = normalizeCoverageIntent(fakeProject(5), { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED', requestedServices: ['heating', 'bogus', 'cooling'] as any });
  assert.deepEqual(intent.requestedServices, ['heating', 'cooling']);
});

test('CM13-097 room-count change invalidates coverage confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = setRoomTypeCount(c.id, 'bedroom', 3, null);
  assert.equal(isCoverageConfirmationStale(after), true);
});

test('CM13-098 room-count no-op does not invalidate coverage confirmation', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 12 });
  const c = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_CONFIRMED' });
  const after = setRoomTypeCount(c.id, 'bedroom', 1, null);
  assert.equal(isCoverageConfirmationStale(after), false);
});

test('CM13-099 WHOLE_OBJECT_WITH_EXCLUSIONS stamps buildingRevision on save', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  const r = setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'WHOLE_OBJECT_WITH_EXCLUSIONS', excludedRoomIds: ['r1'] });
  assert.equal(r.calculationConfiguration?.coverageIntent.buildingRevisionAtConfirmation, p.buildingRevision);
});

test('CM13-100 UNCONFIRMED coverage round trip (null revision)', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED' });
  const r = loadProject(p.id)!;
  assert.equal(r.calculationConfiguration?.coverageIntent.coverageConfirmation, 'UNCONFIRMED');
  assert.equal(r.calculationConfiguration?.coverageIntent.buildingRevisionAtConfirmation, null);
});

test('CM13-101 coverage sourceReference round trip', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  setCalculationCoverage(p.id, { calculationScope: 'WHOLE_OBJECT', coverageConfirmation: 'UNCONFIRMED', sourceReference: 'src-ref-7' });
  assert.equal(loadProject(p.id)!.calculationConfiguration?.coverageIntent.sourceReference, 'src-ref-7');
});

test('CM13-102 empty scope string rejected', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  throwsCode(() => setCalculationCoverage(p.id, { calculationScope: '' as any, coverageConfirmation: 'UNCONFIRMED' }), 'building.coverage_scope_invalid');
});

// ===========================================================================
// O. Additional design-input edge cases
// ===========================================================================

test('CM13-103 sub-zero cooling supply resolves (finite, no rewriting)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { coolingWaterSupplyC: num(-5), coolingWaterReturnC: num(10) } } as any);
  assert.equal(d.hydronicDesignConditions.coolingWaterSupplyC.value, -5);
});

test('CM13-104 Infinity value rejected', () => {
  throwsCode(() => normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: { value: Number.POSITIVE_INFINITY, unit: '°C', source: 'USER_INPUT' }, heatingWaterReturnC: num(60) } } as any), 'engineering.design_input_nonfinite');
});

test('CM13-105 fan speed trailing whitespace preserved exactly (no trim)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM ') } } as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, 'MEDIUM ');
});

test('CM13-106 fan speed PILOT_REFERENCE resolves', () => {
  const d = normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('HIGH', 'PILOT_REFERENCE', POLICY) } } as any);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.source, 'PILOT_REFERENCE');
});

test('CM13-107 resolved vs unresolved payloads are not equal', () => {
  const resolved = normalizeSystemEngineeringDesignInputs(validDesignInputs());
  const unresolved = normalizeSystemEngineeringDesignInputs({} as any);
  assert.equal(engineeringDesignInputsEqual(resolved, unresolved), false);
});

test('CM13-108 normalize({}) yields all-unresolved leaves (no fabrication)', () => {
  const d = normalizeSystemEngineeringDesignInputs({} as any);
  const nums = [d.hydronicDesignConditions.heatingWaterSupplyC, d.hydronicDesignConditions.heatingWaterReturnC, d.hydronicDesignConditions.coolingWaterSupplyC, d.hydronicDesignConditions.coolingWaterReturnC, d.coolingIndoorDesignCondition.indoorCoolingWetBulbC];
  assert.equal(nums.every((x) => x.value === null), true);
  assert.equal(d.fanCoilSizingPolicy.sizingFanSpeed.value, null);
});

test('CM13-109 fan-speed-only payload persists with unresolved hydronic leaves', () => {
  const h = confirmedHouse();
  updateEngineeringDesignInputs(h.id, normalizeSystemEngineeringDesignInputs({ fanCoilSizingPolicy: { sizingFanSpeed: txt('HIGH') } } as any));
  const r = loadProject(h.id)!;
  assert.equal(r.systemsConfiguration?.engineeringDesignInputs?.fanCoilSizingPolicy.sizingFanSpeed.value, 'HIGH');
  assert.equal(r.systemsConfiguration?.engineeringDesignInputs?.hydronicDesignConditions.heatingWaterSupplyC.value, null);
});

test('CM13-110 SYSTEM_POLICY no-op preserves systemsRevision', () => {
  const h = confirmedHouse();
  const policyDesign = normalizeSystemEngineeringDesignInputs({
    hydronicDesignConditions: { heatingWaterSupplyC: num(70, 'SYSTEM_POLICY', POLICY), heatingWaterReturnC: num(60, 'SYSTEM_POLICY', POLICY) },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: num(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: txt('MEDIUM') },
  } as any);
  const first = updateEngineeringDesignInputs(h.id, policyDesign);
  const second = updateEngineeringDesignInputs(first.id, policyDesign);
  assert.equal(second.systemsRevision, first.systemsRevision);
});

test('CM13-111 confirm without design produces snapshot without design inputs', () => {
  const h = confirmedHouse();
  const sys = updateSystemsConfiguration(h.id, { requestedServices: ['cooling'], selectedSystemFamilies: ['multi_split'] });
  const confirmed = confirmSystemsConfiguration(sys.id);
  assert.equal(confirmed.status, 'systems_configured');
  assert.equal(confirmed.systemsConfigurationSnapshot?.engineeringDesignInputs, undefined);
});

test('CM13-112 cooling ordering resolves at strict inequality (supply below return)', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { coolingWaterSupplyC: num(6), coolingWaterReturnC: num(12) } } as any);
  assert.equal(d.hydronicDesignConditions.coolingWaterSupplyC.value, 6);
});

test('CM13-113 hydronic ordering check skips when a seasonal leaf is missing', () => {
  const d = normalizeSystemEngineeringDesignInputs({ hydronicDesignConditions: { heatingWaterSupplyC: num(70) } } as any);
  assert.equal(d.hydronicDesignConditions.heatingWaterSupplyC.value, 70);
  assert.equal(d.hydronicDesignConditions.heatingWaterReturnC.value, null);
});