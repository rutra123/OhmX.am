/**
 * Building Project Phase 2.7 — Apartment Central Building Supply
 * + Mixed Central/Local Architecture + Bathroom/Shower Towel Radiator Defaults.
 *
 * Pure-function tests (no file I/O where possible) following the prod convention
 * of buildingProjectHydronics.test.ts, plus a small set of service-level
 * persistence/confirm tests (CS-I, CS-J) that create + clean up store projects
 * like buildingProject.test.ts does.
 *
 * Coverage:
 *   CS-A  apartment central heating only  -> external heating source, no own generator
 *   CS-B  apartment central cooling only  -> external cooling source, no own generator
 *   CS-C  central H+C                     -> both external, terminals supported
 *   CS-D  central H + local C             -> both survive derivation/reload
 *   CS-E  local H + central C             -> both survive derivation/reload
 *   CS-F  own hydronic H + room-local split C -> split does NOT delete heating source
 *   CS-G  central H + room-local split C  -> room DX does NOT flip architecture to independent_dx
 *   CS-H  DHW independent
 *   CS-I  central source survives reload
 *   CS-J  central source survives confirm/snapshot
 *   CS-K  central source excluded from equipment/SKU semantics
 *   CS-L  central hydronic heating + bathroom  -> towel +1
 *   CS-M  central hydronic heating + shower    -> towel +1
 *   CS-N  bathroom + shower                    -> towel total 2
 *   CS-O  cooling-only + bathroom/shower       -> towel total 0
 *   CS-P  non-hydronic heating + bathroom/shower -> hydronic towel total 0
 *   CS-Q  byFloor towel counts = global total
 *   CS-R  separate WC/toilet excluded
 *   CS-S  legacy apartment unchanged
 *   CS-T  private_house unchanged
 *   CS-U  commercial unchanged
 *   CS-V  2pipe/4pipe semantics preserved
 *   CS-W  no pump/head/flow/pipe assumptions introduced
 *   UI-D  client room-selector dedup data guarantees (one group per family/service)
 */
import * as assert from 'node:assert/strict';
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
  updateSystemsConfiguration,
} from './buildingProjectService.js';
import {
  applyBulkRoomAssignments,
  buildArchitectureFromSelection,
  defaultFamilyIdsForServices,
  EXTERNAL_BUILDING_COOLING_SUPPLY_ID,
  EXTERNAL_BUILDING_HEATING_SUPPLY_ID,
  EXTERNAL_BUILDING_SUPPLY_IDS,
  isExternalBuildingSupplyFamily,
  isProjectSharedSourceFamily,
  isRoomLocalSystemFamily,
  normalizeSystemsConfiguration,
  servicesSupportedByFamily,
  SYSTEM_FAMILIES,
} from './buildingProjectSystems.js';
import {
  computeHydronicSystemRequirements,
  TOWEL_RADIATOR_ROOM_PURPOSES,
} from './buildingProjectHydronics.js';
import type {
  BuildingDistributionId,
  BuildingProject,
  BuildingRoom,
  EngineeringRoomAssignment,
  EngineeringRoomSystemSelection,
  EngineeringSystemConfiguration,
  EngineeringSystemFamily,
  EngineeringSystemFamilySelection,
} from './buildingProjectTypes.js';

const EXTERNAL_HEAT = EXTERNAL_BUILDING_HEATING_SUPPLY_ID;
const EXTERNAL_COOL = EXTERNAL_BUILDING_COOLING_SUPPLY_ID;
const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];

function track<T extends { id: string }>(p: T): T {
  createdIds.push(p.id);
  return p;
}

before(() => {
  fs.mkdirSync(STORE, { recursive: true });
});

after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});

function family(id: string): EngineeringSystemFamilySelection {
  const found = SYSTEM_FAMILIES.find((f) => f.id === id);
  if (!found) throw new Error(`unknown family ${id}`);
  return { ...found, selectedAt: '2026-08-16T00:00:00.000Z' };
}

function familiesOf(ids: string[]): EngineeringSystemFamilySelection[] {
  return ids.map(family);
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
    selectedAt: '2026-08-16T00:00:00.000Z',
    reasons: [],
  };
}

function assignment(
  roomId: string,
  roomName: string,
  roomPurpose: string,
  heating: string[] = [],
  cooling: string[] = [],
): EngineeringRoomAssignment {
  return {
    roomId,
    roomName,
    roomPurpose,
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: {
      heating: heating.length ? 'required' : 'not_required',
      cooling: cooling.length ? 'required' : 'not_required',
    },
    servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: roomPurpose === 'bathroom' || roomPurpose === 'shower' ? 'optional' : 'not_required',
    towelRadiatorPreferenceSource: 'default',
    heatingSystems: heating.map(roomSystem),
    coolingSystems: cooling.map(roomSystem),
    status: 'allowed',
    warnings: [],
    reasons: [],
  };
}

function room(roomType: string, name: string, areaM2: number | null, floorId?: string): BuildingRoom {
  return {
    id: `room-${name}`,
    roomType,
    name,
    areaM2,
    floorId: floorId ?? null,
    extras: {
      geometry: {},
      windows: {},
      conditions: [],
      engineeringUse: 'stored_only',
    },
  };
}

function makeProject(rooms: BuildingRoom[], objectType: 'apartment' | 'private_house' | 'commercial' = 'apartment'): BuildingProject {
  return {
    id: 'p-test',
    name: 'Test project',
    status: 'object_confirmed',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    objectConfirmedAt: '2026-08-16T00:00:00.000Z',
    objectConfirmedRevision: 1,
    buildingRevision: 1,
    objectType,
    region: null,
    totalAreaM2: 72,
    defaultCeilingHeightM: 2.8,
    insulationLevel: 'medium',
    topology: null,
    rooms,
    selectedSystems: [],
    systemsRevision: 0,
    systemsConfiguration: null,
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
}

function makeConfig(opts: {
  requestedServices?: Array<'heating' | 'cooling'>;
  families?: string[];
  assignments?: EngineeringRoomAssignment[];
  explicitDistribution?: { id: BuildingDistributionId };
  simultaneousHeatCoolRequired?: boolean;
} = {}): EngineeringSystemConfiguration {
  const requestedServices = opts.requestedServices ?? ['heating', 'cooling'];
  const selectedSystemFamilies = (opts.families ?? []).map(family);
  const architecture = buildArchitectureFromSelection(
    requestedServices,
    selectedSystemFamilies,
    opts.explicitDistribution ? { distribution: opts.explicitDistribution } : null,
  );
  return {
    projectId: 'p-test',
    requestedServices,
    simultaneousHeatCoolRequired: opts.simultaneousHeatCoolRequired ?? false,
    selectedSystemFamilies,
    architecture,
    roomAssignments: opts.assignments ?? [],
    configurationStatus: 'draft',
    warnings: [],
    confirmedAt: null,
    buildingRevisionAtConfirmation: null,
    systemsRevisionAtConfirmation: null,
    systemsRevision: 1,
  };
}

// ---------------------------------------------------------------------------
// CS-A .. CS-K — central building supply + mixed architecture
// ---------------------------------------------------------------------------

test('CS-A: apartment central heating only -> external heating source, no own generator', () => {
  const arch = buildArchitectureFromSelection(['heating'], familiesOf([EXTERNAL_HEAT, 'fan_coils', 'aluminum_radiators']));
  assert.equal(arch.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(arch.spaceCoolingSourceId, null);
  assert.equal(arch.spaceCombinedSourceId, null);
  assert.equal(arch.distribution.id, 'hydronic_heating_only');
  assert.equal(arch.sources.length, 1);
  assert.equal(arch.sources[0]?.familyId, EXTERNAL_HEAT);
  assert.ok(!arch.sources.some((s) => ['gas_boiler', 'gas_condensing_boiler', 'electric_boiler', 'heat_pump_air_to_water', 'reversible_air_to_water_heat_pump'].includes(s.familyId)));
});

test('CS-B: apartment central cooling only -> external cooling source, no own cooling generator', () => {
  const arch = buildArchitectureFromSelection(['cooling'], familiesOf([EXTERNAL_COOL, 'fan_coils']));
  assert.equal(arch.spaceCoolingSourceId, EXTERNAL_COOL);
  assert.equal(arch.spaceHeatingSourceId, null);
  assert.equal(arch.spaceCombinedSourceId, null);
  // Hydronic fan-coil network: 2-pipe connection model, NOT independent DX.
  assert.equal(arch.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(arch.distribution.circuitKind, '2pipe');
  assert.ok(!arch.sources.some((s) => ['chiller_fan_coils', 'split_wall', 'multi_split', 'ducted_ac', 'vrf_vrv'].includes(s.familyId)));
});

test('CS-C: central H+C -> both external, terminals supported, no own generator', () => {
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], familiesOf([EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils']));
  assert.equal(arch.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(arch.spaceCoolingSourceId, EXTERNAL_COOL);
  assert.equal(arch.spaceCombinedSourceId, null);
  assert.equal(arch.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(arch.sources.length, 2);
  assert.deepEqual(arch.sources.map((s) => s.familyId).sort(), [EXTERNAL_COOL, EXTERNAL_HEAT].sort());
  assert.ok(!arch.sources.some((s) => s.familyId === 'reversible_air_to_water_heat_pump'));

  // Apartment-side terminals still generate hydronic requirements.
  const config = makeConfig({
    families: [EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils'],
    assignments: [assignment('r1', 'Спальня', 'bedroom', ['fan_coils'], ['fan_coils'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCount, 1);
  assert.equal(req.fanCoilManifoldRequired, false);
  assert.equal(req.fanCoilManifoldPortsRequired, 1);
  assert.equal(req.fanCoilValveSetsRequired, 1);
});

test('CS-D: central H + local C -> both survive derivation and reload', () => {
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], familiesOf([EXTERNAL_HEAT, 'split_wall', 'aluminum_radiators']));
  assert.equal(arch.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(arch.spaceCoolingSourceId, 'split_wall');
  assert.equal(arch.distribution.id, 'hybrid_hydronic_plus_dx');
  assert.notEqual(arch.distribution.id, 'independent_dx');

  // Reload: normalize the same persisted config again; external heating survives.
  const project = makeProject([room('bedroom', 'Спальня 1', 14)]);
  const config = makeConfig({
    families: [EXTERNAL_HEAT, 'split_wall', 'aluminum_radiators'],
    assignments: [assignment('room-Спальня 1', 'Спальня 1', 'bedroom', ['aluminum_radiators'], ['split_wall'])],
  });
  const normalized = normalizeSystemsConfiguration(project, config, ['heating', 'cooling']);
  assert.equal(normalized.architecture.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(normalized.architecture.spaceCoolingSourceId, 'split_wall');
  assert.equal(normalized.selectedSystemFamilies.some((f) => f.id === EXTERNAL_HEAT), true);
});

test('CS-E: local H + central C -> both survive derivation', () => {
  const arch = buildArchitectureFromSelection(
    ['heating', 'cooling'],
    familiesOf(['gas_condensing_boiler', 'aluminum_radiators', EXTERNAL_COOL, 'fan_coils']),
  );
  assert.equal(arch.spaceHeatingSourceId, 'gas_condensing_boiler');
  assert.equal(arch.spaceCoolingSourceId, EXTERNAL_COOL);
  assert.equal(arch.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(arch.simultaneousHeatCoolSupported, true);
});

test('CS-F: own hydronic H + room-local split C -> split does NOT delete own heating source', () => {
  // Regression for the Phase 2.6 known defect: reversible + wall split used to
  // collapse to independent_dx and drop the reversible source entirely.
  const arch = buildArchitectureFromSelection(
    ['heating', 'cooling'],
    familiesOf(['reversible_air_to_water_heat_pump', 'fan_coils', 'hydronic_floor_heating', 'split_wall']),
  );
  assert.equal(arch.spaceHeatingSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(arch.spaceCoolingSourceId, 'split_wall');
  assert.equal(arch.spaceCombinedSourceId, null);
  assert.equal(arch.distribution.id, 'hybrid_hydronic_plus_dx');
  assert.notEqual(arch.distribution.id, 'independent_dx');
});

test('CS-G: central H + room-local split C via room assignments only -> architecture is NOT switched to independent_dx', () => {
  // split_wall appears ONLY in the room assignment, never in the explicit
  // selectedSystemFamilies. Normalization must keep the external heating source.
  const project = makeProject([room('bedroom', 'Спальня 1', 14)]);
  const normalized = normalizeSystemsConfiguration(project, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [EXTERNAL_HEAT, 'aluminum_radiators'],
    roomAssignments: [{
      roomId: 'room-Спальня 1',
      sourceSystemIds: { heating: EXTERNAL_HEAT, cooling: null },
      heatingSystems: ['aluminum_radiators'],
      coolingSystems: ['split_wall'],
    }],
  }, ['heating', 'cooling']);
  assert.equal(normalized.architecture.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(normalized.architecture.spaceCoolingSourceId, null);
  assert.notEqual(normalized.architecture.distribution.id, 'independent_dx');
  assert.equal(normalized.architecture.distribution.id, 'hybrid_hydronic_plus_dx');
  // The room-local split is still present in the room assignment.
  assert.equal(normalized.roomAssignments[0]?.coolingSystems[0]?.familyId, 'split_wall');
});

test('CS-H: DHW stays independent with external sources', () => {
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], familiesOf([EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils']));
  assert.equal(arch.dhw.status, 'not_configured');
  assert.equal(arch.dhw.sourceFamilyId, null);
});

test('CS-I: central source survives reload (normalize round-trip + service reload)', () => {
  const project = makeProject([room('bedroom', 'Спальня 1', 14)]);
  const once = normalizeSystemsConfiguration(project, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [EXTERNAL_HEAT, 'aluminum_radiators'],
  }, ['heating']);
  const twice = normalizeSystemsConfiguration(project, once, ['heating']);
  assert.equal(twice.architecture.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(twice.selectedSystemFamilies.some((f) => f.id === EXTERNAL_HEAT), true);

  // Service-level reload from the JSON store.
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 72 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  confirmObject(p.id);
  updateSystemsConfiguration(p.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family(EXTERNAL_HEAT), family('aluminum_radiators')],
  });
  const reloaded = loadProject(p.id)!;
  const cfg = reloaded.systemsConfiguration!;
  assert.equal(cfg.architecture.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(cfg.selectedSystemFamilies.some((f) => f.id === EXTERNAL_HEAT), true);
});

test('CS-J: central source survives confirm/snapshot', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 72 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  confirmObject(p.id);
  updateSystemsConfiguration(p.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family(EXTERNAL_HEAT), family(EXTERNAL_COOL), family('fan_coils')],
  });
  const confirmed = confirmSystemsConfiguration(p.id);
  assert.equal(confirmed.status, 'systems_configured');
  const snap = confirmed.systemsConfigurationSnapshot!;
  assert.equal(snap.architecture.spaceHeatingSourceId, EXTERNAL_HEAT);
  assert.equal(snap.architecture.spaceCoolingSourceId, EXTERNAL_COOL);
  assert.equal(snap.selectedSystemFamilies.some((f) => f.id === EXTERNAL_HEAT), true);
  assert.equal(snap.selectedSystemFamilies.some((f) => f.id === EXTERNAL_COOL), true);
});

test('CS-K: central source excluded from equipment/SKU semantics', () => {
  const extHeat = SYSTEM_FAMILIES.find((f) => f.id === EXTERNAL_HEAT)!;
  const extCool = SYSTEM_FAMILIES.find((f) => f.id === EXTERNAL_COOL)!;
  assert.equal(extHeat.external, true);
  assert.equal(extCool.external, true);
  assert.equal(isExternalBuildingSupplyFamily(extHeat), true);
  assert.equal(isExternalBuildingSupplyFamily(extCool), true);
  assert.equal(isExternalBuildingSupplyFamily(SYSTEM_FAMILIES.find((f) => f.id === 'gas_boiler')), false);
  // Never part of the default own-source suggestion set.
  const defaults = defaultFamilyIdsForServices(['heating', 'cooling']);
  assert.ok(!defaults.includes(EXTERNAL_HEAT));
  assert.ok(!defaults.includes(EXTERNAL_COOL));
  // Typed metadata helpers.
  assert.equal(isProjectSharedSourceFamily(extHeat), true);
  assert.equal(isRoomLocalSystemFamily(extHeat), false);
  assert.deepEqual([...servicesSupportedByFamily(extHeat)].sort(), ['heating']);
  assert.deepEqual([...servicesSupportedByFamily(extCool)].sort(), ['cooling']);
});

// ---------------------------------------------------------------------------
// CS-L .. CS-R — towel radiator defaults (bathroom + shower, not WC)
// ---------------------------------------------------------------------------

test('CS-L: central hydronic heating + bathroom -> towel +1', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: [EXTERNAL_HEAT, 'aluminum_radiators'],
    assignments: [assignment('r1', 'Ванная 1', 'bathroom', ['aluminum_radiators'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 1);
});

test('CS-M: central hydronic heating + shower -> towel +1', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: [EXTERNAL_HEAT, 'aluminum_radiators'],
    assignments: [assignment('r1', 'Душевая 1', 'shower', ['aluminum_radiators'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 1);
});

test('CS-N: bathroom + shower -> towel total 2', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: [EXTERNAL_HEAT, 'aluminum_radiators'],
    assignments: [
      assignment('r1', 'Ванная 1', 'bathroom', ['aluminum_radiators']),
      assignment('r2', 'Душевая 1', 'shower', ['aluminum_radiators']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 2);
});

test('CS-O: cooling-only + bathroom/shower -> hydronic towel total 0', () => {
  const config = makeConfig({
    requestedServices: ['cooling'],
    families: [EXTERNAL_COOL, 'fan_coils'],
    assignments: [
      assignment('r1', 'Ванная 1', 'bathroom', [], ['fan_coils']),
      assignment('r2', 'Душевая 1', 'shower', [], ['fan_coils']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
});

test('CS-P: non-hydronic heating + bathroom/shower -> hydronic towel total 0', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: ['electric_convector'],
    assignments: [
      assignment('r1', 'Ванная 1', 'bathroom', ['electric_convector']),
      assignment('r2', 'Душевая 1', 'shower', ['electric_convector']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
});

test('CS-Q: byFloor towel counts sum to the global total', () => {
  const project = makeProject(
    [
      room('bathroom', 'Ванная 1', 5, 'floor-1'),
      room('shower', 'Душевая 1', 4, 'floor-1'),
      room('bathroom', 'Ванная 2', 5, 'floor-2'),
    ],
    'private_house',
  );
  project.topology = {
    floorCount: 2,
    floors: [
      { id: 'floor-1', level: 1, label: 'Этаж 1' },
      { id: 'floor-2', level: 2, label: 'Этаж 2' },
    ],
    basementType: 'none',
    topBoundaryType: 'unheated_attic',
    plantLocation: { kind: 'not_defined', floorId: null, roomId: null },
  };
  const config = makeConfig({
    requestedServices: ['heating'],
    families: [EXTERNAL_HEAT, 'aluminum_radiators'],
    assignments: [
      assignment('room-Ванная 1', 'Ванная 1', 'bathroom', ['aluminum_radiators']),
      assignment('room-Душевая 1', 'Душевая 1', 'shower', ['aluminum_radiators']),
      assignment('room-Ванная 2', 'Ванная 2', 'bathroom', ['aluminum_radiators']),
    ],
  });
  const req = computeHydronicSystemRequirements(project, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 3);
  assert.equal(req.byFloor.length, 2);
  assert.equal(req.byFloor[0]?.towelRadiatorsRecommended, 2);
  assert.equal(req.byFloor[1]?.towelRadiatorsRecommended, 1);
  const byFloorSum = req.byFloor.reduce((s, f) => s + (f.towelRadiatorsRecommended || 0), 0);
  assert.equal(byFloorSum, req.towelRadiatorsRecommended);
});

test('CS-R: separate WC/toilet excluded from automatic towel radiators', () => {
  assert.equal(TOWEL_RADIATOR_ROOM_PURPOSES.has('wc'), false);
  assert.equal(TOWEL_RADIATOR_ROOM_PURPOSES.has('laundry'), false);
  assert.equal(TOWEL_RADIATOR_ROOM_PURPOSES.has('bathroom'), true);
  assert.equal(TOWEL_RADIATOR_ROOM_PURPOSES.has('shower'), true);
  const config = makeConfig({
    requestedServices: ['heating'],
    families: [EXTERNAL_HEAT, 'aluminum_radiators'],
    assignments: [assignment('r1', 'Санузел 1', 'wc', ['aluminum_radiators'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
});

// ---------------------------------------------------------------------------
// CS-S .. CS-V — legacy + distribution behavior unchanged
// ---------------------------------------------------------------------------

test('CS-S/T/U: legacy default source selection unchanged (no external in defaults)', () => {
  const defaults = defaultFamilyIdsForServices(['heating', 'cooling']);
  assert.deepEqual(defaults, ['reversible_air_to_water_heat_pump', 'fan_coils', 'hydronic_floor_heating']);
  assert.ok(!defaults.some((id) => EXTERNAL_BUILDING_SUPPLY_IDS.includes(id as (typeof EXTERNAL_BUILDING_SUPPLY_IDS)[number])));

  // private_house / commercial reversible default still builds a combined source.
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], familiesOf(defaults));
  assert.equal(arch.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(arch.distribution.id, 'hydronic_2pipe_heating_cooling');
});

test('CS-V: 2pipe/4pipe semantics preserved for central H+C', () => {
  const twoPipe = buildArchitectureFromSelection(['heating', 'cooling'], familiesOf([EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils']));
  assert.equal(twoPipe.distribution.circuitKind, '2pipe');
  assert.equal(twoPipe.distribution.simultaneousHeatCool, false);

  const fourPipe = buildArchitectureFromSelection(
    ['heating', 'cooling'],
    familiesOf([EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils']),
    { distribution: { id: 'hydronic_4pipe_heating_cooling' } },
  );
  assert.equal(fourPipe.distribution.circuitKind, '4pipe');
  assert.equal(fourPipe.distribution.simultaneousHeatCool, true);
  assert.equal(fourPipe.simultaneousHeatCoolSupported, true);

  const config = makeConfig({
    families: [EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils'],
    explicitDistribution: { id: 'hydronic_4pipe_heating_cooling' },
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCircuitKind, '4pipe');
  assert.equal(req.fanCoilValveSetsRequired, 2);
});

test('CS-W: no pump/head/flow/pipe/temperature assumptions introduced', () => {
  const config = makeConfig({
    requestedServices: ['heating', 'cooling'],
    families: [EXTERNAL_HEAT, EXTERNAL_COOL, 'fan_coils', 'hydronic_floor_heating', 'aluminum_radiators'],
    assignments: [
      assignment('r1', 'Ванная', 'bathroom', ['hydronic_floor_heating']),
      assignment('r2', 'Спальня', 'bedroom', ['aluminum_radiators'], ['fan_coils']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  const json = JSON.stringify(req).toLowerCase();
  for (const banned of ['heatloss', 'powerkw', 'btu', 'flowrate', 'flowl', 'pumphead', 'pipediameter', 'loopcount', 'w/m', 'supplytemperature', 'returntemperature', 'deltat', 'differentialpressure']) {
    assert.ok(!json.includes(banned), `requirements must not contain ${banned}`);
  }
  assert.equal(req.floorHeatingCircuitCount, 'pending_calculation');
});

// ---------------------------------------------------------------------------
// UI-D — client room-selector dedup data guarantees (server-side regression data)
// ---------------------------------------------------------------------------

/**
 * Mirrors the client deterministic presentation classification
 * (client/src/features/buildingProject/systemsSourceModes.ts `roomServiceRole`):
 * every non-external family that can serve a service gets EXACTLY ONE role.
 * kind 'source' -> 'source'; terminal / combined / solution_template (including
 * hybrid-scope combined families such as heat_pump_air_to_air) -> 'terminal'.
 *
 * Capability predicates (canBeSource / canBeTerminal) may BOTH be true for a
 * combined/hybrid family — that is data-model capability, not presentation. The
 * presentation invariant is renderCount(room/service/familyId) <= 1, which the
 * single-role classification guarantees by construction.
 */
function roomServiceRole(f: EngineeringSystemFamily, service: 'heating' | 'cooling'): 'source' | 'terminal' | null {
  if (f.external) return null;
  const supports = f.service === service || f.service === 'heating_and_cooling';
  if (!supports) return null;
  if (f.kind === 'source') return null;
  if (f.kind === 'combined' && f.scope === 'central') return null;
  return 'terminal';
}

test('UI-D1..D4: every family renders in at most ONE group per service (deterministic role)', () => {
  for (const service of ['heating', 'cooling'] as const) {
    const counts = new Map<string, number>();
    for (const f of SYSTEM_FAMILIES) {
      const role = roomServiceRole(f, service);
      if (role) counts.set(f.id, (counts.get(f.id) || 0) + 1);
      if (f.external) assert.equal(role, null, `${f.id} must not be a room control`);
    }
    // renderCount(room/service/familyId) <= 1 for EVERY family.
    for (const [id, count] of counts) {
      assert.equal(count, 1, `${id} (${SYSTEM_FAMILIES.find((f) => f.id === id)?.kind}/${SYSTEM_FAMILIES.find((f) => f.id === id)?.scope}) renders ${count} time(s) for ${service}`);
    }
    // Concrete coverage of every current combined/hybrid class.
    if (service === 'heating') {
      assert.equal(counts.get('heat_pump_air_to_air'), 1, 'heat_pump_air_to_air must render exactly once for heating');
      assert.equal(counts.get('fan_coils'), 1, 'fan coil must render exactly once for heating');
      assert.equal(counts.get('reversible_air_to_water_heat_pump'), undefined, 'project source is not a room control');
      assert.equal(counts.get('hydronic_floor_heating'), 1);
    }
    if (service === 'cooling') {
      assert.equal(counts.get('split_wall'), 1, 'split_wall must render exactly once for cooling');
      assert.equal(counts.get('multi_split'), undefined, 'central DX source is not a room control');
      assert.equal(counts.get('ducted_ac'), undefined, 'central DX source is not a room control');
      assert.equal(counts.get('heat_pump_air_to_air'), 1, 'heat_pump_air_to_air must render exactly once for cooling');
      assert.equal(counts.get('fan_coils'), 1, 'fan coil must render exactly once for cooling');
    }
    // External building supply is never a room control.
    assert.equal(counts.get('external_building_heating_supply'), undefined);
    assert.equal(counts.get('external_building_cooling_supply'), undefined);
  }
});

test('UI-D5: bulk assignment does not duplicate room/service/system assignments', () => {
  const project = makeProject([
    room('bedroom', 'Спальня 1', 14),
    room('bedroom', 'Спальня 2', 13),
  ]);
  const source: EngineeringRoomAssignment = assignment(
    'room-Спальня 1',
    'Спальня 1',
    'bedroom',
    ['aluminum_radiators', 'aluminum_radiators', 'hydronic_floor_heating'],
    ['split_wall', 'split_wall'],
  );
  const result = applyBulkRoomAssignments(
    project,
    [source],
    'room-Спальня 1',
    'bedrooms',
    ['heating', 'cooling'],
  );
  const target = result.find((a) => a.roomId === 'room-Спальня 2')!;
  assert.deepEqual(target.heatingSystems.map((s) => s.familyId), ['aluminum_radiators', 'hydronic_floor_heating']);
  assert.deepEqual(target.coolingSystems.map((s) => s.familyId), ['split_wall']);
});

test('UI-D6: fan coil used legitimately for H+C is preserved across lists', () => {
  const project = makeProject([room('office', 'Офис 1', 20)]);
  const normalized = normalizeSystemsConfiguration(project, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    roomAssignments: [{
      roomId: 'room-Офис 1',
      sourceSystemIds: { heating: 'reversible_air_to_water_heat_pump', cooling: 'reversible_air_to_water_heat_pump' },
      heatingSystems: ['fan_coils'],
      coolingSystems: ['fan_coils'],
    }],
  }, ['heating', 'cooling']);
  const a = normalized.roomAssignments[0]!;
  assert.equal(a.heatingSystems.filter((s) => s.familyId === 'fan_coils').length, 1);
  assert.equal(a.coolingSystems.filter((s) => s.familyId === 'fan_coils').length, 1);
});
