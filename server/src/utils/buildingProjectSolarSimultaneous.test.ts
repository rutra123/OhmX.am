/**
 * Phase 3.2f — Simultaneous solar design-peak regression tests + dataset QA.
 * Run: cd server && npx tsx --test src/utils/buildingProjectSolarSimultaneous.test.ts
 *
 * Locks the fix: multi-orientation rooms use max_t sum_windows(A·SHGC·I(t)·shading),
 * NOT the sum of independent per-orientation maxima. Yerevan audit fixtures:
 *   E       1102.2  (unchanged)
 *   S        838.7  (unchanged)
 *   E+W     1274.3  (was 2126 → -66.8%)
 *   E+S     1481.2  (was 1941 → -31.0%)
 *   N+E+S+W 1931.7  (was 3391 → -75.5%)
 * Canonical fixture: A=2.0 m², SHGC=0.7, shading=1.0 (none) per window → coeff 1.4.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getSolarIrradiance, loadSolarDataset, SOLAR_ORIENTATION_ORDER, SOLAR_DATASET_VERSION } from './buildingProjectSolarData.js';
import { computeRoomSolar } from './buildingProjectSolar.js';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import type {
  BuildingProject,
  BuildingRoom,
  BuildingSystemArchitecture,
  EnvelopeElement,
  EngineeringRoomAssignment,
  WindowOrientation,
} from './buildingProjectTypes.js';

const FIX = 1.4; // A=2.0 × SHGC=0.7 × shading=1.0

// ---------- Dataset QA (Phase 3.2f section 6) ----------

test('dataset v2: id + version + 29 locations + source/transposition provenance', () => {
  const ds = loadSolarDataset();
  assert.equal(ds.datasetId, 'ohmx-solar-irradiance');
  assert.equal(ds.datasetVersion, SOLAR_DATASET_VERSION); // '2.0.0'
  assert.equal(Object.keys(ds.locations).length, 29);
  assert.ok(/PVGIS/i.test(ds.source), 'source names PVGIS');
  assert.ok(/JRC|EU/i.test(ds.source), 'source names EU JRC');
  assert.ok(/isotropic/i.test(ds.transposition), 'transposition method documented');
  assert.ok(/simultaneous/i.test(ds.aggregation), 'simultaneous aggregation documented');
});

test('dataset: shared time axis + consistent 2208×8 hourly matrix for every location', () => {
  const ds = loadSolarDataset();
  const T = ds.timeAxisUtc.length;
  assert.equal(T, 2208, 'JJA hourly length');
  assert.deepEqual([...SOLAR_ORIENTATION_ORDER], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  for (const [id, entry] of Object.entries(ds.locations)) {
    assert.equal(entry.hourly.length, T, `hourly row count @ ${id}`);
    for (const row of entry.hourly) assert.equal(row.length, 8, `row width @ ${id}`);
  }
});

test('dataset: all hourly + peak values finite, non-negative, no NaN/Infinity', () => {
  const ds = loadSolarDataset();
  for (const [id, entry] of Object.entries(ds.locations)) {
    for (const row of entry.hourly) {
      for (const v of row) {
        assert.ok(Number.isFinite(v) && v >= 0, `irradiance invalid @ ${id}: ${v}`);
      }
    }
    for (const o of SOLAR_ORIENTATION_ORDER) {
      const p = entry.values[o];
      assert.ok(Number.isFinite(p) && p >= 0, `peak invalid @ ${id}.${o}: ${p}`);
    }
  }
});

test('dataset: deterministic reload (same object) + Yerevan peaks stable', () => {
  const a = getSolarIrradiance('yerevan-agro')!;
  const b = getSolarIrradiance('yerevan-agro')!;
  assert.deepEqual(a.values, b.values);
  assert.equal(a.values.S, 599.1);
  assert.equal(a.values.E, 787.3);
  assert.equal(a.values.W, 731.3);
  assert.equal(a.values.N, 304.5);
  assert.equal(a.hourly!.irradianceWm2.length, 2208);
});

test('dataset: mutating returned values/hourly does not corrupt the cache', () => {
  const a = getSolarIrradiance('yerevan-agro')!;
  a.values.S = 999999;
  a.hourly!.irradianceWm2[0][0] = 999999;
  const b = getSolarIrradiance('yerevan-agro')!;
  assert.equal(b.values.S, 599.1);
  assert.equal(b.hourly!.irradianceWm2[0][0], 0); // first hour col 0 (N) is night = 0, not the mutated 999999
});

// ---------- Solar engine fixtures ----------

function yerevanLoc() {
  return {
    id: 'yerevan-agro', labelRu: 'Ереван', labelHy: 'Երևան', station: 'Ագրո', elevationM: 942, climateZone: 'X', regionId: 'AM-ER',
    observationPeriod: 'X', heatingOutdoorDesignC: -18, coolingOutdoorDesignC: 33,
    sourceTableHeating: 'T', sourceRowHeating: 1, sourceTableCooling: 'T', sourceRowCooling: 1,
    solarIrradianceByOrientation: getSolarIrradiance('yerevan-agro'),
  };
}

function el(id: string, orientation: WindowOrientation | null, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return { elementId: id, areaM2: 2, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation, shgc: 0.7, shadingFactor: 1.0,
    shadingProfile: null, source: null, ...over };
}

function roomWith(windows: EnvelopeElement[], name = 'Room'): BuildingRoom {
  return { id: 'r1', roomType: 'living_room', name, areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: { wallElements: [], windowElements: windows, doorElements: [], roofElements: [], floorElements: [] } };
}

function project(): BuildingProject {
  return { id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '', objectConfirmedAt: 'x', objectConfirmedRevision: 1,
    buildingRevision: 1, objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: null, defaultCeilingHeightM: 2.5,
    insulationLevel: 'unknown', topology: null, rooms: [], selectedSystems: [], systemsRevision: 1,
    systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null };
}

function win(id: string, o: WindowOrientation): EnvelopeElement { return el(id, o); }
function solarOf(orientations: WindowOrientation[]) {
  return computeRoomSolar(project(), roomWith(orientations.map((o, i) => win(`w${i}`, o))), yerevanLoc());
}

// A/B: single orientation unchanged
test('A/B: single E and single S match their orientation peak (Δ=0%)', () => {
  assert.equal(solarOf(['E']).totalCoolingW, FIX * 787.3);
  assert.equal(solarOf(['S']).totalCoolingW, FIX * 599.1);
});

// C: two identical-orientation windows sum, simultaneous peak
test('C: two same-orientation windows sum and peak simultaneously', () => {
  const r = solarOf(['E', 'E']);
  assert.equal(r.totalCoolingW, 2 * FIX * 787.3); // 2204.4
  // both windows share irradiance at the peak hour
  assert.equal(r.windows[0].irradianceWm2, r.windows[1].irradianceWm2);
});

// D/E/F: multi-orientation = simultaneous peak (not sum of independent maxima)
test('D: E+W ≈ 1274 (NOT 2126)', () => {
  const r = solarOf(['E', 'W']);
  assert.ok(Math.abs(r.totalCoolingW! - 1274.3) < 0.5, `got ${r.totalCoolingW}`);
  assert.ok(r.totalCoolingW! < 1500, 'must not be near the 2126 independent-max sum');
  assert.ok(r.warnings.some((w) => w === 'solar_aggregation:simultaneous_room_peak'));
});

test('E: E+S ≈ 1481 (NOT 1941)', () => {
  const r = solarOf(['E', 'S']);
  assert.ok(Math.abs(r.totalCoolingW! - 1481.2) < 0.5, `got ${r.totalCoolingW}`);
});

test('F: N+E+S+W ≈ 1932 (NOT 3391)', () => {
  const r = solarOf(['N', 'E', 'S', 'W']);
  assert.ok(Math.abs(r.totalCoolingW! - 1931.7) < 0.5, `got ${r.totalCoolingW}`);
});

// G: reorder-invariant
test('G: reordering windows does not change the result', () => {
  const a = solarOf(['E', 'W', 'S', 'N']);
  const b = solarOf(['N', 'S', 'W', 'E']);
  assert.equal(a.totalCoolingW, b.totalCoolingW);
});

// H: rename-invariant
test('H: renaming the room does not change the result', () => {
  const a = computeRoomSolar(project(), roomWith([win('w0', 'E'), win('w1', 'W')], 'First'), yerevanLoc());
  const b = computeRoomSolar(project(), roomWith([win('w0', 'E'), win('w1', 'W')], 'Second'), yerevanLoc());
  assert.equal(a.totalCoolingW, b.totalCoolingW);
});

// I: deterministic
test('I: same input → same result (deterministic)', () => {
  const a = solarOf(['E', 'S']);
  const b = solarOf(['E', 'S']);
  assert.equal(a.totalCoolingW, b.totalCoolingW);
  assert.deepEqual(a.windows, b.windows);
});

// Per-window contributions sum to the room total at the peak hour
test('per-window cooling sums to the simultaneous room total', () => {
  const r = solarOf(['E', 'W']);
  const sum = r.windows.reduce((s, w) => s + (w.coolingW ?? 0), 0);
  assert.ok(Math.abs(sum - r.totalCoolingW!) < 0.05);
});

// L: missing/invalid never fabricated
test('L: missing orientation / irradiance / shading still resolve to missing', () => {
  const noOrient = computeRoomSolar(project(), roomWith([el('w', null, { shgc: 0.7, shadingFactor: 1.0 })]), yerevanLoc());
  assert.equal(noOrient.status, 'missing_input');
  assert.ok(noOrient.missingInputs.some((m) => m.startsWith('orientation:missing')));

  const noSolarLoc = { ...yerevanLoc(), solarIrradianceByOrientation: null };
  const noSolar = computeRoomSolar(project(), roomWith([win('w', 'S')]), noSolarLoc);
  assert.equal(noSolar.status, 'missing_input');
  assert.ok(noSolar.missingInputs.includes('solar_irradiance:missing'));

  const noShade = computeRoomSolar(project(), roomWith([el('w', 'S', { shadingFactor: null, shadingProfile: null })]), yerevanLoc());
  assert.equal(noShade.status, 'missing_input');
  assert.ok(noShade.missingInputs.some((m) => m.startsWith('shading:missing')));
});

test('duplicate window elementId -> missing, never a corrupted calculated breakdown', () => {
  const result = computeRoomSolar(project(), roomWith([win('same', 'E'), win('same', 'W')]), yerevanLoc());
  assert.equal(result.status, 'missing_input');
  assert.equal(result.totalCoolingW, null);
  assert.ok(result.missingInputs.includes('duplicate_element_id:same'));
  assert.ok(result.windows.every((window) => window.coolingW == null));
});

// J/K: heating & QUICK isolation at the integration level
function fullProjectEw(): BuildingProject {
  const wall = el('wall-1', null, { areaM2: 10, uValue: 1.0 });
  const room: BuildingRoom = { id: 'room-1', roomType: 'bedroom', name: 'R1', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: { wallElements: [wall], windowElements: [el('e', 'E', { uValue: 2.0 }), el('w', 'W', { uValue: 2.0 })], doorElements: [], roofElements: [], floorElements: [] },
    air: { ventilationBalance: 'none', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: 0.5, ach50: null, airtightnessClass: null },
    internalGains: { occupancy: 2, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null } };
  const assignment: EngineeringRoomAssignment = { roomId: 'room-1', roomName: 'R1', roomPurpose: 'bedroom', sourceSystemId: null, sourceSystemIds: { heating: null, cooling: null },
    userPreference: null, servicePreferences: { heating: 'required', cooling: 'required' }, servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required', towelRadiatorPreferenceSource: 'default', heatingSystems: [], coolingSystems: [], status: 'allowed', warnings: [], reasons: [] };
  const arch: BuildingSystemArchitecture = { spaceHeatingSourceId: null, spaceCoolingSourceId: null, spaceCombinedSourceId: null, sources: [],
    distribution: { id: 'independent_dx', label: '', circuitKind: 'independent', simultaneousHeatCool: false, notes: [] },
    dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] }, simultaneousHeatCoolSupported: false, warnings: [] };
  return { id: 'p', name: 'p', status: 'systems_configured', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '', objectConfirmedAt: 'x', objectConfirmedRevision: 1, buildingRevision: 3,
    objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20, defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms: [room],
    selectedSystems: [], systemsRevision: 5,
    systemsConfiguration: { projectId: 'p', requestedServices: ['heating', 'cooling'], simultaneousHeatCoolRequired: false, selectedSystemFamilies: [], architecture: arch, roomAssignments: [assignment], configurationStatus: 'confirmed', warnings: [], confirmedAt: 'x', buildingRevisionAtConfirmation: 3, systemsRevisionAtConfirmation: 5, systemsRevision: 5 },
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null };
}

test('J: heating unchanged by the solar fix (transmission+air only)', () => {
  const calc = computeBuildingLoads(fullProjectEw(), 'steady_state');
  const rr = calc.roomResults[0];
  assert.equal(rr.heating.demandW, rr.transmissionBreakdown!.heatingW! + rr.airBreakdown!.heatingW!);
});

test('K: QUICK method unchanged', () => {
  const calc = computeBuildingLoads(fullProjectEw(), 'quick');
  assert.equal(calc.methodId, 'ohmx.quick-load.v1');
});