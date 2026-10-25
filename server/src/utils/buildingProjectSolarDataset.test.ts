/**
 * Phase 3.2e — Solar Irradiance Dataset + integration regression tests.
 * Run: cd server && npx tsx --test src/utils/buildingProjectSolarDataset.test.ts
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getSolarDatasetMeta, getSolarIrradiance, loadSolarDataset } from './buildingProjectSolarData.js';
import { computeRoomSolar } from './buildingProjectSolar.js';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import type { BuildingProject, BuildingRoom, BuildingSystemArchitecture, EnvelopeElement, EngineeringRoomAssignment } from './buildingProjectTypes.js';

const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

// ---------- Dataset QA ----------

test('dataset schema valid (29 locations, versioned)', () => {
  const ds = loadSolarDataset();
  assert.equal(ds.datasetId, 'ohmx-solar-irradiance');
  assert.equal(ds.datasetVersion, '2.0.0');
  assert.equal(typeof ds.source, 'string');
  assert.equal(typeof ds.method, 'string');
  assert.equal(Object.keys(ds.locations).length, 29);
});

test('all location ids unique', () => {
  const ds = loadSolarDataset();
  const keys = Object.keys(ds.locations);
  assert.equal(new Set(keys).size, keys.length);
});

test('all values finite + non-negative', () => {
  const ds = loadSolarDataset();
  for (const entry of Object.values(ds.locations)) {
    for (const o of ORIENTATIONS) {
      const v = entry.values[o];
      assert.ok(Number.isFinite(v), `${o} not finite`);
      assert.ok(v >= 0, `${o} negative: ${v}`);
    }
  }
});

test('every location has all 8 orientations', () => {
  const ds = loadSolarDataset();
  for (const [id, entry] of Object.entries(ds.locations)) {
    assert.deepEqual(Object.keys(entry.values).sort(), [...ORIENTATIONS].sort(), `missing orientation at ${id}`);
  }
});

test('deterministic: repeated loads give identical values', () => {
  const a = getSolarIrradiance('gyumri');
  const b = getSolarIrradiance('gyumri');
  assert.deepEqual(a, b);
});

test('Yerevan exact fixture stable', () => {
  const y = getSolarIrradiance('yerevan-agro')!.values;
  assert.equal(y.S, 599.1);
  assert.equal(y.N, 304.5);
  assert.equal(y.E, 787.3);
  assert.equal(y.W, 731.3);
  assert.equal(y.SE, 690.3);
  assert.equal(y.SW, 634.3);
  assert.equal(y.NE, 635.2);
  assert.equal(y.NW, 572.7);
});

test('mutating a returned values object does not corrupt the dataset', () => {
  const a = getSolarIrradiance('yerevan-agro')!;
  a.values.S = 999999;
  const b = getSolarIrradiance('yerevan-agro')!.values;
  assert.equal(b.S, 599.1);
});

test('uncovered location -> null (solar missing, no borrowed data)', () => {
  assert.equal(getSolarIrradiance('no-such-location'), null);
  assert.equal(getSolarIrradiance(null), null);
  assert.equal(getSolarIrradiance(undefined), null);
});

test('dataset meta (id + version) exposed', () => {
  assert.deepEqual(getSolarDatasetMeta(), { datasetId: 'ohmx-solar-irradiance', datasetVersion: '2.0.0' });
});

// ---------- Solar engine uses the dataset value ----------

function el(id: string, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return { elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation: null, shgc: null, shadingFactor: null,
    shadingProfile: null, source: null, ...over };
}
function roomW(windows: EnvelopeElement[]): BuildingRoom {
  return { id: 'r1', roomType: 'living_room', name: 'R1', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: { wallElements: [], windowElements: windows, doorElements: [], roofElements: [], floorElements: [] } };
}
function proj(): BuildingProject {
  return { id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '', objectConfirmedAt: 'x', objectConfirmedRevision: 1,
    buildingRevision: 1, objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: null, defaultCeilingHeightM: 2.5,
    insulationLevel: 'unknown', topology: null, rooms: [], selectedSystems: [], systemsRevision: 1,
    systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null };
}
function yerevanLocation() {
  return {
    id: 'yerevan-agro', labelRu: 'Ереван', labelHy: 'Երևան', station: 'Ագրո', elevationM: 942, climateZone: 'X', regionId: 'AM-ER',
    observationPeriod: 'X', heatingOutdoorDesignC: -18, coolingOutdoorDesignC: 33,
    sourceTableHeating: 'T', sourceRowHeating: 1, sourceTableCooling: 'T', sourceRowCooling: 1,
    solarIrradianceByOrientation: getSolarIrradiance('yerevan-agro'),
  };
}

test('solar engine uses the dataset value for the window orientation (S = 599.1)', () => {
  const res = computeRoomSolar(proj(), roomW([el('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), yerevanLocation());
  assert.equal(res.status, 'calculated');
  assert.equal(res.totalCoolingW, 2 * 0.5 * 599.1 * 0.5);
  assert.equal(res.windows[0].irradianceWm2, 599.1);
});

test('solar missing when the location carries no solar data', () => {
  const loc = { ...yerevanLocation(), solarIrradianceByOrientation: null };
  const res = computeRoomSolar(proj(), roomW([el('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), loc);
  assert.equal(res.status, 'missing_input');
  assert.equal(res.totalCoolingW, null);
  assert.ok(res.missingInputs.includes('solar_irradiance:missing'));
});

// ---------- Full steady-state integration ----------

function fullProject(): BuildingProject {
  const wall = el('wall-1', { areaM2: 10, uValue: 1.0 });
  const window = el('win-1', { areaM2: 2, uValue: 2.0, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const room: BuildingRoom = { id: 'room-1', roomType: 'bedroom', name: 'R1', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: { wallElements: [wall], windowElements: [window], doorElements: [], roofElements: [], floorElements: [] },
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

test('integration: cooling is CALCULATED (numeric) with solar dataset present', () => {
  const calc = computeBuildingLoads(fullProject(), 'steady_state');
  const rr = calc.roomResults[0];
  assert.equal(rr.cooling.status, 'calculated');
  assert.ok(rr.cooling.demandW != null && rr.cooling.demandW > 0);
  const trC = rr.transmissionBreakdown!.coolingW!;
  const airC = rr.airBreakdown!.coolingW!;
  const solarC = rr.solarBreakdown!.totalCoolingW!;
  const intW = rr.internalGainsBreakdown!.totalCoolingW!;
  assert.equal(rr.cooling.demandW, trC + airC + solarC + intW);
  assert.equal(Math.round(solarC), Math.round(2 * 0.5 * 599.1 * 0.5)); // 299.55
});

test('integration: heating is transmission+air only (unchanged by solar/internal)', () => {
  const calc = computeBuildingLoads(fullProject(), 'steady_state');
  const rr = calc.roomResults[0];
  assert.equal(rr.heating.status, 'calculated');
  assert.equal(rr.heating.demandW, rr.transmissionBreakdown!.heatingW! + rr.airBreakdown!.heatingW!);
  assert.equal(rr.heating.coefficientTrace!.components, 'transmission,air');
});

test('integration: QUICK method unchanged', () => {
  const calc = computeBuildingLoads(fullProject(), 'quick');
  assert.equal(calc.methodId, 'ohmx.quick-load.v1');
});