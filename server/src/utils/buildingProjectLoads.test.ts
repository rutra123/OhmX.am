/**
 * Building Project Phase 3 + 3.1 — Loads Engine v1 (focused tests).
 *
 * LOAD-01..LOAD-23 + QUICK method + invariant tests. The engine is pure and
 * deterministic; a small service-level section exercises the store-backed
 * gates and persistence (same track/after cleanup convention as
 * buildingProjectIntegrity.test.ts — created test projects are deleted).
 *
 * Phase 3.1 method state: OhmX QUICK Load v1 (`ohmx.quick-load.v1`, 1.0.0) is
 * ACTIVE and numeric when an official climate location resolves (fixtures use
 * AM-ER → Yerevan). Uncovered regions produce missing_climate_location.
 * Professional remains LIMITED.
 */
import * as assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  calculateLoads,
  confirmObject,
  confirmSystemsConfiguration,
  createProject,
  deleteProject,
  getLoadState,
  loadProject,
  reopenObject,
  updateRoom,
  updateSystemsConfiguration,
} from './buildingProjectService.js';
import {
  PROFESSIONAL_METHOD_LIMITED,
  PROFESSIONAL_MISSING_INPUTS,
  checkLoadPrerequisites,
  computeBuildingLoads,
  isLoadStale,
  sumEligibleRoomLoads,
} from './buildingProjectLoads.js';
import { SYSTEM_FAMILIES } from './buildingProjectSystems.js';
import type {
  BuildingLoadCalculation,
  BuildingProject,
  BuildingRoom,
  BuildingSystemArchitecture,
  EngineeringRoomAssignment,
  EngineeringRoomSystemSelection,
  EngineeringSystemFamilySelection,
  RoomLoadResult,
  ServiceLoadStatus,
} from './buildingProjectTypes.js';

const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];

function track<T extends { id: string }>(p: T): T {
  createdIds.push(p.id);
  return p;
}

function family(id: string): EngineeringSystemFamilySelection {
  const found = SYSTEM_FAMILIES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown family ${id}`);
  return { ...found, selectedAt: '2026-08-17T00:00:00.000Z' };
}

function roomSystem(id: string): EngineeringRoomSystemSelection {
  const f = family(id);
  return {
    familyId: f.id,
    label: f.label,
    service: f.service,
    kind: f.kind,
    scope: f.scope,
    capabilityStatus: f.capabilityStatus,
    sourceSystemId: null,
    selectedAt: '2026-08-17T00:00:00.000Z',
    reasons: [],
  };
}

function makeRoom(
  id: string,
  roomType: string,
  name: string,
  areaM2: number | null,
  floorId: string | null = null,
  heightOverrideM: number | null = null,
): BuildingRoom {
  return {
    id,
    roomType,
    name,
    areaM2,
    floorId: floorId ?? undefined,
    extras: {
      geometry: { ceilingHeightM: heightOverrideM, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null,
      conditions: [],
      notes: null,
      engineeringUse: 'stored_only',
    },
  };
}

function makeAssignment(room: BuildingRoom, heating: string[], cooling: string[]): EngineeringRoomAssignment {
  return {
    roomId: room.id,
    roomName: room.name,
    roomPurpose: room.roomType,
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: {
      heating: heating.length ? 'required' : 'not_required',
      cooling: cooling.length ? 'required' : 'not_required',
    },
    servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required',
    towelRadiatorPreferenceSource: 'default',
    heatingSystems: heating.map(roomSystem),
    coolingSystems: cooling.map(roomSystem),
    status: 'allowed',
    warnings: [],
    reasons: [],
  };
}

const ARCH: BuildingSystemArchitecture = {
  spaceHeatingSourceId: 'gas_condensing_boiler',
  spaceCoolingSourceId: null,
  spaceCombinedSourceId: null,
  sources: [],
  distribution: {
    id: 'hydronic_heating_only',
    label: 'Гидравлика отопления',
    circuitKind: '2pipe',
    simultaneousHeatCool: false,
    notes: [],
  },
  dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
  simultaneousHeatCoolSupported: false,
  warnings: [],
};

/** Pure in-memory BuildingProject fixture (no store, no service). */
function makeProject(overrides: Partial<BuildingProject> = {}): BuildingProject {
  const rooms = [
    makeRoom('room-1', 'bedroom', 'Спальня 1', 16),
    makeRoom('room-2', 'bathroom', 'Ванная', 5),
  ];
  const assignments = rooms.map((room) => makeAssignment(room, ['aluminum_radiators'], []));
  const base: BuildingProject = {
    id: 'test-project',
    name: 'Test project',
    status: 'systems_configured',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    objectConfirmedAt: '2026-08-17T00:00:00.000Z',
    objectConfirmedRevision: 1,
    buildingRevision: 3,
    objectType: 'apartment',
    region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: 80,
    defaultCeilingHeightM: 2.7,
    insulationLevel: 'medium',
    topology: null,
    rooms,
    selectedSystems: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    systemsRevision: 5,
    systemsConfiguration: {
      projectId: 'test-project',
      requestedServices: ['heating'],
      simultaneousHeatCoolRequired: false,
      selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
      architecture: ARCH,
      roomAssignments: assignments,
      configurationStatus: 'confirmed',
      warnings: [],
      confirmedAt: '2026-08-17T00:00:00.000Z',
      buildingRevisionAtConfirmation: 3,
      systemsRevisionAtConfirmation: 5,
      systemsRevision: 5,
      hydronicRequirements: null,
      validation: { ready: true, blockers: [], warnings: [], info: [] },
    },
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
  return { ...base, ...overrides };
}

function numericRoomResult(roomId: string, hW: number | null, cW: number | null): RoomLoadResult {
  const hStatus: ServiceLoadStatus = hW == null ? 'missing_input' : 'calculated';
  const cStatus: ServiceLoadStatus = cW == null ? 'missing_input' : 'calculated';
  return {
    roomId,
    roomName: roomId,
    roomType: 'bedroom',
    floorId: null,
    floorLabel: null,
    areaM2: 16,
    effectiveCeilingHeightM: 2.7,
    heating: {
      status: hStatus,
      demandW: hW,
      demandRangeW: null,
      assumptions: [],
      warnings: [],
      missingInputs: hW == null ? ['room_area:missing'] : [],
    },
    cooling: {
      status: cStatus,
      demandW: cW,
      demandRangeW: null,
      assumptions: [],
      warnings: [],
      missingInputs: cW == null ? ['room_area:missing'] : [],
    },
  };
}

function engineeringJson(calc: BuildingLoadCalculation) {
  const copy = JSON.parse(JSON.stringify(calc)) as BuildingLoadCalculation;
  delete (copy as { calculatedAt?: string }).calculatedAt;
  return JSON.stringify(copy);
}

before(() => {
  fs.mkdirSync(STORE, { recursive: true });
});

after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});

// ---------- Service helpers (store-backed) ----------

function confirmedApartment() {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 80 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  addRoom(p.id, { roomType: 'bathroom', areaM2: 5 });
  return confirmObject(p.id);
}

function confirmHeatingSystems(project: BuildingProject) {
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      ...makeAssignment(room, ['aluminum_radiators'], []),
      servicePreferences: { heating: 'required', cooling: 'not_required' } as const,
      servicePreferenceSource: { heating: 'user', cooling: 'default' } as const,
    })),
  });
  return confirmSystemsConfiguration(project.id);
}

// ---------- LOAD-01..03 — state gates (service-level) ----------

test('LOAD-01: cannot calculate before object confirmation', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 80 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  assert.throws(
    () => calculateLoads(p.id, 'quick'),
    (err: any) => err?.code === 'building.object_not_confirmed',
  );
  const gate = checkLoadPrerequisites(loadProject(p.id)!);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'building.object_not_confirmed');
});

test('LOAD-02: cannot calculate before systems confirmation', () => {
  const project = confirmedApartment();
  assert.throws(
    () => calculateLoads(project.id, 'quick'),
    (err: any) => err?.code === 'building.systems_not_confirmed',
  );
  const state = getLoadState(project.id);
  assert.equal(state.prerequisites.systemsConfirmed, false);
  assert.equal(state.gate.code, 'building.systems_not_confirmed');
});

test('LOAD-03: cannot calculate with stale systems', () => {
  const project = confirmHeatingSystems(confirmedApartment());
  assert.equal(loadProject(project.id)!.status, 'systems_configured');
  // Reopen -> change a room area -> reconfirm object. Systems snapshot now
  // carries old revision stamps -> stale, even though the object is confirmed.
  reopenObject(project.id);
  const room = loadProject(project.id)!.rooms[0];
  updateRoom(project.id, room.id, { areaM2: 18 });
  confirmObject(project.id);
  const reloaded = loadProject(project.id)!;
  assert.equal(reloaded.status, 'object_confirmed');
  assert.throws(
    () => calculateLoads(project.id, 'quick'),
    (err: any) => err?.code === 'building.systems_stale',
  );
});

// ---------- LOAD-04..07 — valid state + determinism ----------

test('LOAD-04: valid confirmed project creates a Phase 3.1 numeric QUICK result', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  assert.equal(calc.status, 'calculated');
  assert.equal(calc.mode, 'quick');
  assert.equal(calc.methodId, 'ohmx.quick-load.v1');
  assert.equal(calc.methodVersion, '1.0.0');
  assert.equal(calc.buildingRevisionAtCalculation, 3);
  assert.equal(calc.systemsRevisionAtCalculation, 5);
  assert.equal(calc.roomResults.length, 2);
  assert.equal(typeof calc.heatingDemandW, 'number');
  assert.ok(calc.heatingDemandW! > 0);
  assert.equal(calc.coolingDemandW, null); // cooling not requested
  assert.equal(calc.climateLocationId, 'yerevan-agro');
  assert.equal(calc.climateDatasetId, 'armenia-hhsn-22-01-2024');
  assert.ok(calc.inputSnapshot);
  assert.equal(calc.inputSnapshot.buildingRevision, 3);
  assert.equal(calc.inputSnapshot.systemsRevision, 5);
});

test('LOAD-05: legacy Phase 2.8A JSON without loads field loads safely', () => {
  const project = confirmHeatingSystems(confirmedApartment());
  // simulate a legacy project that has no Phase 3 field at all
  const loaded = loadProject(project.id)!;
  assert.equal(loaded.loads, undefined);
  // engine still works on legacy-shaped project (no loads field)
  const calc = computeBuildingLoads(loaded, 'quick');
  assert.equal(calc.status, 'calculated');
  assert.equal(calc.methodId, 'ohmx.quick-load.v1');
});

test('LOAD-06: calculation saves and reloads without changing the result', () => {
  const project = confirmHeatingSystems(confirmedApartment());
  calculateLoads(project.id, 'quick');
  const first = loadProject(project.id)!.loads!;
  const reloaded = loadProject(project.id)!.loads!;
  assert.equal(engineeringJson(reloaded), engineeringJson(first));
  assert.equal(reloaded.buildingRevisionAtCalculation, loadProject(project.id)!.buildingRevision);
  // result survives round-trip; not re-derived; canonical Phase 3.1 method identity persists
  const afterReopen = loadProject(project.id)!;
  assert.equal(afterReopen.loads?.methodId, 'ohmx.quick-load.v1');
  assert.equal(afterReopen.loads?.methodVersion, '1.0.0');
  assert.equal(afterReopen.loads?.mode, 'quick');
});

test('LOAD-07: repeated calculation is deterministic/idempotent by engineering fields', () => {
  const project = makeProject();
  const a = computeBuildingLoads(project, 'quick');
  const b = computeBuildingLoads(project, 'quick');
  assert.equal(engineeringJson(a), engineeringJson(b));
  assert.equal(a.status, b.status);
  assert.equal(a.heatingDemandW, b.heatingDemandW);
  assert.deepEqual(a.roomResults, b.roomResults);
});

// ---------- LOAD-08..11 — revision / stale semantics ----------

test('LOAD-08: buildingRevision change makes the previous load stale', () => {
  const project = makeProject();
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(isLoadStale(project, calc), false);
  const changed = makeProject({ buildingRevision: 4 });
  assert.equal(isLoadStale(changed, calc), true);
});

test('LOAD-09: systemsRevision change makes the previous load stale', () => {
  const project = makeProject();
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(isLoadStale(project, calc), false);
  const changed = makeProject({ systemsRevision: 6 });
  assert.equal(isLoadStale(changed, calc), true);
});

test('LOAD-10: recalculate after a new valid confirmation updates revision stamps', () => {
  const project = confirmHeatingSystems(confirmedApartment());
  calculateLoads(project.id, 'quick');
  const first = loadProject(project.id)!.loads!;
  assert.equal(first.buildingRevisionAtCalculation, loadProject(project.id)!.buildingRevision);
  assert.equal(first.systemsRevisionAtCalculation, loadProject(project.id)!.systemsRevision);
  // object + systems change -> old result becomes stale
  reopenObject(project.id);
  const room = loadProject(project.id)!.rooms[0];
  updateRoom(project.id, room.id, { areaM2: 20 });
  confirmObject(project.id);
  const staleCheck = loadProject(project.id)!.loads!;
  assert.equal(isLoadStale(loadProject(project.id)!, staleCheck), true);
  // re-apply the valid systems config (as the UI does after an object edit)
  // and reconfirm, then recalculate
  const reloaded = loadProject(project.id)!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: reloaded.rooms.map((r) => ({
      ...makeAssignment(r, ['aluminum_radiators'], []),
      servicePreferences: { heating: 'required', cooling: 'not_required' } as const,
      servicePreferenceSource: { heating: 'user', cooling: 'default' } as const,
    })),
  });
  confirmSystemsConfiguration(project.id);
  calculateLoads(project.id, 'quick');
  const second = loadProject(project.id)!.loads!;
  assert.equal(second.buildingRevisionAtCalculation, loadProject(project.id)!.buildingRevision);
  assert.equal(second.systemsRevisionAtCalculation, loadProject(project.id)!.systemsRevision);
  assert.notEqual(second.buildingRevisionAtCalculation, first.buildingRevisionAtCalculation);
  assert.equal(isLoadStale(loadProject(project.id)!, second), false);
});

test('LOAD-11: historical calculation input/result is not mutated by a later room edit', () => {
  const project = makeProject();
  const calc = computeBuildingLoads(project, 'quick');
  const snapshotBefore = engineeringJson(calc);
  // simulate a later room edit on a NEW project state
  const edited = makeProject({ rooms: [makeRoom('room-1', 'bedroom', 'Спальня 1', 20), makeRoom('room-2', 'bathroom', 'Ванная', 5)] });
  computeBuildingLoads(edited, 'quick');
  assert.equal(engineeringJson(calc), snapshotBefore);
  assert.equal(calc.inputSnapshot.rooms[0].areaM2, 16);
});

// ---------- LOAD-12..19 — rooms / totals ----------

test('LOAD-12: duplicate bedrooms keep independent results by roomId', () => {
  const rooms = [makeRoom('b1', 'bedroom', 'Спальня 1', 16), makeRoom('b2', 'bedroom', 'Спальня 2', 18)];
  const project = makeProject({ rooms, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const calc = computeBuildingLoads(project, 'quick');
  assert.deepEqual(calc.roomResults.map((r) => r.roomId), ['b1', 'b2']);
  const [r1, r2] = calc.roomResults;
  assert.equal(r1.roomId, 'b1');
  assert.equal(r2.roomId, 'b2');
  assert.equal(r1.areaM2, 16);
  assert.equal(r2.areaM2, 18);
  // both rooms are independently calculated with the active QUICK method
  assert.equal(r1.heating.status, 'calculated');
  assert.equal(r2.heating.status, 'calculated');
  assert.ok(r1.heating.demandW! > 0);
  assert.ok(r2.heating.demandW! > 0);
});

test('LOAD-13: multi-floor house preserves floor/room mapping', () => {
  const rooms = [
    makeRoom('f1r1', 'bedroom', 'Спальня', 16, 'floor-1'),
    makeRoom('f2r1', 'living_room', 'Гостиная', 30, 'floor-2'),
  ];
  const project = makeProject({
    objectType: 'private_house',
    topology: {
      floorCount: 2,
      floors: [
        { id: 'floor-1', level: 1, label: 'Этаж 1' },
        { id: 'floor-2', level: 2, label: 'Этаж 2' },
      ],
      basementType: 'none',
      topBoundaryType: 'direct_roof',
      plantLocation: { kind: 'not_defined', floorId: null, roomId: null },
    },
    rooms,
    systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) },
  });
  const calc = computeBuildingLoads(project, 'quick');
  const byId = new Map(calc.roomResults.map((r) => [r.roomId, r]));
  assert.equal(byId.get('f1r1')?.floorId, 'floor-1');
  assert.equal(byId.get('f1r1')?.floorLabel, 'Этаж 1');
  assert.equal(byId.get('f2r1')?.floorId, 'floor-2');
  assert.equal(byId.get('f2r1')?.floorLabel, 'Этаж 2');
});

test('LOAD-14: object total equals the sum of eligible room raw results', () => {
  const results = [numericRoomResult('r1', 1000, 800), numericRoomResult('r2', 500, 300)];
  const h = sumEligibleRoomLoads(results, 'heating');
  const c = sumEligibleRoomLoads(results, 'cooling');
  assert.equal(h.complete, true);
  assert.equal(h.demandW, 1500);
  assert.equal(c.demandW, 1100);
});

test('LOAD-15: required room with missing load makes the object total incomplete', () => {
  const results = [numericRoomResult('r1', 1000, 800), numericRoomResult('r2', null, 300)];
  const h = sumEligibleRoomLoads(results, 'heating');
  assert.equal(h.complete, false);
  assert.equal(h.demandW, null);
  // cooling is fully numeric
  const c = sumEligibleRoomLoads(results, 'cooling');
  assert.equal(c.complete, true);
  assert.equal(c.demandW, 1100);
});

test('LOAD-16: room not_required never becomes a proven 0 W', () => {
  // Case A — service globally absent from requestedServices -> not_requested (never 0 W).
  const heatingOnly = makeProject(); // base fixture: requestedServices ['heating']
  const calcA = computeBuildingLoads(heatingOnly, 'quick');
  const coolingA = calcA.roomResults[0].cooling;
  assert.equal(coolingA.status, 'not_requested');
  assert.equal(coolingA.demandW, null);
  assert.equal(coolingA.demandW === 0, false);

  // Case B — service globally REQUESTED for the project, this specific room has
  // an explicit servicePreferences[service] === 'not_required' -> not_required.
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 16)];
  const assignment: EngineeringRoomAssignment = {
    ...makeAssignment(rooms[0], ['aluminum_radiators'], []),
    servicePreferences: { heating: 'required', cooling: 'not_required' } as const,
  };
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      requestedServices: ['heating', 'cooling'],
      roomAssignments: [assignment],
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  const cooling = calc.roomResults[0].cooling;
  assert.equal(cooling.status, 'not_required');
  assert.equal(cooling.demandW, null);
  assert.equal(cooling.demandW === 0, false);
  // the room's heating remains independent and numerically calculated (Yerevan climate)
  assert.equal(calc.roomResults[0].heating.status, 'calculated');
  assert.ok(calc.roomResults[0].heating.demandW! > 0);
});

test('LOAD-17: cooling-only project does not create a heating numeric result', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 16)];
  const assignment = makeAssignment(rooms[0], [], ['split_wall']);
  const project = makeProject({ rooms, systemsConfiguration: { ...makeProject().systemsConfiguration!, requestedServices: ['cooling'], roomAssignments: [assignment] } });
  const calc = computeBuildingLoads(project, 'quick');
  const heating = calc.roomResults[0].heating;
  const cooling = calc.roomResults[0].cooling;
  assert.equal(heating.status, 'not_requested');
  assert.equal(heating.demandW, null);
  assert.equal(cooling.status, 'calculated');
  assert.ok(cooling.demandW! > 0);
  assert.equal(calc.heatingDemandW, null);
});

test('LOAD-18: heating-only project does not create a cooling numeric result', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 16)];
  const project = makeProject({ rooms, systemsConfiguration: { ...makeProject().systemsConfiguration!, requestedServices: ['heating'], roomAssignments: rooms.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(calc.roomResults[0].cooling.status, 'not_requested');
  assert.equal(calc.roomResults[0].cooling.demandW, null);
  assert.equal(calc.coolingDemandW, null);
});

test('LOAD-19: H+C keeps independent heating and cooling results', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 16)];
  const assignment = makeAssignment(rooms[0], ['fan_coils'], ['fan_coils']);
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      requestedServices: ['heating', 'cooling'],
      roomAssignments: [assignment],
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  const room = calc.roomResults[0];
  assert.equal(room.heating.status, 'calculated');
  assert.equal(room.cooling.status, 'calculated');
  assert.notEqual(room.heating, room.cooling);
  assert.notEqual(room.heating.demandW, room.cooling.demandW);
});

// ---------- LOAD-20..21 — professional limited ----------

test('LOAD-20: professional mode without a real coefficient set stays limited', () => {
  const calc = computeBuildingLoads(makeProject(), 'professional');
  assert.equal(calc.status, 'limited');
  assert.equal(calc.mode, 'professional');
  assert.equal(calc.methodId, 'building.loads.professional');
  assert.equal(calc.methodVersion, '0-limited');
  assert.equal(calc.heatingDemandW, null);
  assert.equal(calc.coolingDemandW, null);
  assert.ok(calc.warnings.some((w) => w.includes(PROFESSIONAL_METHOD_LIMITED)));
  for (const missing of PROFESSIONAL_MISSING_INPUTS) {
    assert.ok(calc.missingInputs.includes(missing), `missing ${missing}`);
  }
});

test('LOAD-21: no VALUE-BEARING invented professional coefficients appear in output', () => {
  const calc = computeBuildingLoads(makeProject(), 'professional');
  const serialized = JSON.stringify(calc).toLowerCase();
  // Semantic missing-input markers are honest and allowed (e.g. the string
  // "u_values:missing" in missingInputs). What is forbidden is a VALUE-BEARING
  // invented professional coefficient: a numeric field/key such as uValue,
  // wallUValue, SHGC, ACH, infiltration rate, degree-days, etc.
  const inventedValueKeys = [
    '"uvalue":', '"uvalues":', '"u_value":', '"u-value":',
    '"walluvalue":', '"windowuvalue":', '"shgc":', '"ach":',
    '"infiltrationrate":', '"infiltration_rate":', '"solarcoefficient":',
    '"solar_coeff":', '"degree_days":', '"hdd":', '"cdd":',
  ];
  for (const key of inventedValueKeys) {
    assert.ok(!serialized.includes(key), `invented value-bearing coefficient leaked: ${key}`);
  }
  // Safety invariant stays: professional honestly reports the absence of U-values
  // (semantic missing-input markers are NOT invented coefficients).
  assert.ok(calc.missingInputs.includes('u_values:missing'));
  for (const missing of PROFESSIONAL_MISSING_INPUTS) {
    assert.ok(calc.missingInputs.includes(missing), `missing ${missing}`);
  }
});

// ---------- LOAD-22..23 — no Phase 4 leak ----------

test('LOAD-22: load output contains no Phase 4 equipment/sizing/BOM data', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  const serialized = JSON.stringify(calc).toLowerCase();
  const phase4 = [
    'productid', 'sku', 'boilermodel', 'chillermodel', 'radiatorcount', 'btu',
    'pipedn', 'pumphead', 'flowrate', 'flow_l_s', 'bom', 'estimate', 'price',
  ];
  for (const key of phase4) {
    assert.ok(!serialized.includes(key), `Phase 4 leak: ${key}`);
  }
});

test('LOAD-23: hydronic requirements do not change just because loads are calculated', () => {
  const project = makeProject();
  const hydronicBefore = JSON.stringify(project.systemsConfiguration?.hydronicRequirements);
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(JSON.stringify(project.systemsConfiguration?.hydronicRequirements), hydronicBefore);
  assert.ok(!('hydronicRequirements' in calc));
});

// ---------- QUICK method tests (Phase 3.1: active when climate resolves) ----------

test('QUICK-M-1: quick is active with an official climate location and limited/missing for uncovered regions', () => {
  // Covered region (AM-ER -> Yerevan Agro) -> numeric result.
  const covered = computeBuildingLoads(makeProject(), 'quick');
  assert.equal(covered.status, 'calculated');
  assert.equal(covered.methodId, 'ohmx.quick-load.v1');
  assert.equal(covered.methodVersion, '1.0.0');
  assert.ok(covered.heatingDemandW! > 0);
  assert.equal(covered.climateLocationId, 'yerevan-agro');

  // Uncovered region (e.g. AM-LO has several stations with different heights) -> no invented number.
  const uncovered = computeBuildingLoads(
    makeProject({ region: { code: 'AM-LO', name: 'Лори' } }),
    'quick',
  );
  assert.equal(uncovered.status, 'incomplete');
  assert.equal(uncovered.heatingDemandW, null);
  assert.ok(uncovered.roomResults.every((r) => r.heating.demandW === null && r.cooling.demandW === null));
  assert.ok(uncovered.roomResults[0].heating.missingInputs.includes('climate_location:missing_climate_location'));
  assert.ok(uncovered.warnings.includes('climate_location:missing_climate_location'));
});

// ---------- invariant / property tests ----------

test('INV-1: totals are never negative and limited mode never fabricates numbers', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  for (const value of [calc.heatingDemandW, calc.coolingDemandW]) {
    assert.ok(value === null || value >= 0);
  }
  const numeric = sumEligibleRoomLoads([numericRoomResult('r1', 0, 0)], 'heating');
  assert.equal(numeric.demandW, 0); // explicit 0 result is legitimate; null is the no-result marker
});

test('INV-2: same input -> same engineering output (determinism)', () => {
  const project = makeProject();
  const a = computeBuildingLoads(project, 'professional');
  const b = computeBuildingLoads(project, 'professional');
  assert.equal(engineeringJson(a), engineeringJson(b));
});

test('INV-3: reordered rooms do not change the object total', () => {
  const rooms1 = [makeRoom('r1', 'bedroom', 'Спальня 1', 16), makeRoom('r2', 'bathroom', 'Ванная', 5)];
  const rooms2 = [rooms1[1], rooms1[0]];
  const p1 = makeProject({ rooms: rooms1, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms1.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const p2 = makeProject({ rooms: rooms2, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms2.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  assert.equal(c1.coolingDemandW, c2.coolingDemandW);
  const order1 = sumEligibleRoomLoads([numericRoomResult('r1', 100, 50), numericRoomResult('r2', 200, 60)], 'heating');
  const order2 = sumEligibleRoomLoads([numericRoomResult('r2', 200, 60), numericRoomResult('r1', 100, 50)], 'heating');
  assert.equal(order1.demandW, order2.demandW);
});

test('INV-4: room name change does not change the engineering result', () => {
  const rooms1 = [makeRoom('room-1', 'bedroom', 'Спальня 1', 16)];
  const rooms2 = [makeRoom('room-1', 'bedroom', 'Спальня (переименована)', 16)];
  const p1 = makeProject({ rooms: rooms1, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms1.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const p2 = makeProject({ rooms: rooms2, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms2.map((r) => makeAssignment(r, ['aluminum_radiators'], [])) } });
  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  assert.equal(c1.coolingDemandW, c2.coolingDemandW);
  assert.equal(c1.roomResults[0].heating.status, c2.roomResults[0].heating.status);
  assert.equal(c2.roomResults[0].roomName, 'Спальня (переименована)');
});

test('INV-5: unrelated source-system change does not alter the physical load result', () => {
  const p1 = makeProject();
  const p2 = makeProject({
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      selectedSystemFamilies: [family('electric_boiler'), family('electric_convector')],
    },
  });
  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c1.status, c2.status);
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  assert.equal(c1.coolingDemandW, c2.coolingDemandW);
  assert.deepEqual(c1.roomResults.map((r) => r.heating.status), c2.roomResults.map((r) => r.heating.status));
});

test('LOAD-extra: getLoadState exposes honest method status for all modes', () => {
  const project = confirmHeatingSystems(confirmedApartment());
  const state = getLoadState(project.id);
  assert.deepEqual(state.availableModes, ['quick', 'professional', 'steady_state']);
  assert.equal(state.methodStatus.quick.status, 'active');
  assert.equal(state.methodStatus.quick.methodId, 'ohmx.quick-load.v1');
  assert.equal(state.methodStatus.quick.methodVersion, '1.0.0');
  assert.equal(state.methodStatus.professional.status, 'limited');
  assert.ok(state.methodStatus.quick.supportedRegions.includes('AM-ER'));
  assert.equal(state.loads, null);
  assert.equal(state.isStale, false);
  assert.equal(state.prerequisites.systemsConfirmed, true);
  assert.equal(state.prerequisites.systemsReady, true);
  // after calculation the state carries the numeric result
  calculateLoads(project.id, 'quick');
  const after = getLoadState(project.id);
  assert.equal(after.loads?.status, 'calculated');
  assert.equal(after.loads?.methodId, 'ohmx.quick-load.v1');
  assert.equal(after.loads?.methodVersion, '1.0.0');
  assert.ok(after.loads?.heatingDemandW! > 0);
});
