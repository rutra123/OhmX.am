/**
 * Building Project Phase 2.5 — Hydronic System Completeness (focused tests).
 *
 * Pure-function tests (no file I/O, no service, no DB) so they run in the prod
 * tree where server/src is intentionally not fully buildable (paths.ts etc. live
 * only in the recovery workspace). Imports are limited to the self-contained
 * building-project modules.
 *
 * CASE A–J test the pure requirements derivation; CASE K verifies deterministic
 * restore for a legacy Phase 2 configuration (no hydronicRequirements field).
 *
 * A  bathroom + hydronic heating -> towel radiator per bathroom
 * B  bathroom + electric-only heating -> NO hydronic towel radiator
 * C  hydronic_floor_heating present -> floor manifold + mixing unit + pump
 * D  hydronic_floor_heating absent -> those components are not added
 * E  6 hydronic fan coils -> count 6, manifold >= 6 ports, 6 valve/actuator sets
 * F  duplicate rooms/terminals counted independently
 * G  2-pipe architecture -> 2-pipe fan coil connection model
 * H  4-pipe commercial -> 4-pipe model, never 2-pipe quantities
 * I  DHW stays independent
 * J  no heat loss / kW / BTU / flow / head / pipe diameter / invented loop count
 * K  legacy Phase 2 config without hydronicRequirements normalizes and the
 *    requirements are restored deterministically
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildArchitectureFromSelection, normalizeSystemsConfiguration, SYSTEM_FAMILIES } from './buildingProjectSystems.js';
import { computeHydronicSystemRequirements, isFanCoilManifoldRequired } from './buildingProjectHydronics.js';
import type {
  BuildingDistributionId,
  BuildingProject,
  BuildingRoom,
  EngineeringRoomAssignment,
  EngineeringRoomSystemSelection,
  EngineeringSystemConfiguration,
  EngineeringSystemFamilySelection,
} from './buildingProjectTypes.js';

function family(id: string): EngineeringSystemFamilySelection {
  const found = SYSTEM_FAMILIES.find((f) => f.id === id);
  if (!found) throw new Error(`unknown family ${id}`);
  return { ...found, selectedAt: '2026-08-16T00:00:00.000Z' };
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

function room(roomType: string, name: string, areaM2: number | null): BuildingRoom {
  return {
    id: `room-${name}`,
    roomType,
    name,
    areaM2,
    extras: {
      geometry: {},
      windows: {},
      conditions: [],
      engineeringUse: 'stored_only',
    },
  };
}

function makeProject(rooms: BuildingRoom[]): BuildingProject {
  return {
    id: 'p-test',
    name: 'Test project',
    status: 'object_confirmed',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    objectConfirmedAt: '2026-08-16T00:00:00.000Z',
    objectConfirmedRevision: 1,
    buildingRevision: 1,
    objectType: 'private_house',
    region: null,
    totalAreaM2: 160,
    defaultCeilingHeightM: 2.8,
    insulationLevel: 'medium',
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

test('CASE A: 2 bathrooms with hydronic heating -> towel recommended, not automatically required', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils', 'hydronic_floor_heating'],
    assignments: [
      assignment('r1', 'Ванная 1', 'bathroom', ['hydronic_floor_heating']),
      assignment('r2', 'Ванная 2', 'bathroom', ['aluminum_radiators']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 2);
});

test('CASE B: bathroom with electric-only heating -> no hydronic towel radiator', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: ['electric_boiler'],
    assignments: [
      assignment('r1', 'Ванная 1', 'bathroom', ['heating_cable']),
      assignment('r2', 'Ванная 2', 'bathroom', ['electric_convector']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.towelRadiatorsRequired, 0);
});

test('CASE C: hydronic_floor_heating present -> manifold present; mixing/pump pending_design', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: ['gas_condensing_boiler', 'hydronic_floor_heating'],
    assignments: [assignment('r1', 'Гостиная', 'living_room', ['hydronic_floor_heating'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.hydronicFloorHeatingPresent, true);
  assert.equal(req.floorHeatingManifoldRequired, true);
  assert.equal(req.mixingUnitRequired, false);
  assert.equal(req.circulationPumpRequired, false);
  assert.equal(req.mixingUnitStatus, 'pending_design');
  assert.equal(req.circulationPumpStatus, 'pending_design');
});

test('CASE D: no hydronic_floor_heating -> those components are not added', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: ['gas_condensing_boiler', 'aluminum_radiators'],
    assignments: [assignment('r1', 'Спальня', 'bedroom', ['aluminum_radiators'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.hydronicFloorHeatingPresent, false);
  assert.equal(req.floorHeatingManifoldRequired, false);
  assert.equal(req.mixingUnitRequired, false);
  assert.equal(req.circulationPumpRequired, false);
});

test('CASE E: 6 hydronic fan coils -> count 6, distribution pending, manifold not required', () => {
  const assignments = Array.from({ length: 6 }, (_, i) =>
    assignment(`fc${i + 1}`, `Офис ${i + 1}`, 'commercial_office', ['fan_coils'], ['fan_coils']),
  );
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments,
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCount, 6);
  assert.equal(req.fanCoilManifoldRequired, false);
  assert.equal(req.fanCoilDistribution, 'pending_design');
  assert.ok(req.fanCoilManifoldPortsRequired >= 6);
  assert.equal(req.fanCoilValveSetsRequired, 6);
  assert.equal(req.actuatorCountRequired, 6);
});

test('CASE F: duplicate rooms/terminals are counted independently (one unit per room)', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [
      assignment('b1', 'Спальня 1', 'bedroom', ['fan_coils'], ['fan_coils']),
      assignment('b2', 'Спальня 2', 'bedroom', ['fan_coils']),
      assignment('b3', 'Спальня 3', 'bedroom', ['fan_coils']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  // Three bedrooms, each with one physical fan coil (heating+cooling on the same unit).
  assert.equal(req.fanCoilCount, 3);
});

test('CASE G: 2-pipe architecture gets the 2-pipe fan coil connection model', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  assert.equal(config.architecture.distribution.circuitKind, '2pipe');
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCircuitKind, '2pipe');
  assert.equal(req.fanCoilValveSetsRequired, 1);
  assert.equal(req.actuatorCountRequired, 1);
});

test('CASE H: 4-pipe commercial architecture never gets the 2-pipe connection model', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    explicitDistribution: { id: 'hydronic_4pipe_heating_cooling' },
    simultaneousHeatCoolRequired: true,
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  assert.equal(config.architecture.distribution.circuitKind, '4pipe');
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCircuitKind, '4pipe');
  // 4-pipe = two independent circuits per fan coil -> two control valve sets.
  assert.equal(req.fanCoilValveSetsRequired, 2);
  assert.equal(req.actuatorCountRequired, 2);
  assert.notEqual(req.fanCoilCircuitKind, '2pipe');
});

test('CASE I: DHW stays independent (requirements never auto-assign a DHW source)', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'])],
  });
  const before = JSON.stringify(config.architecture.dhw);
  computeHydronicSystemRequirements(null, config);
  const after = JSON.stringify(config.architecture.dhw);
  assert.equal(after, before);
  assert.equal(config.architecture.dhw.status, 'not_configured');
  assert.equal(config.architecture.dhw.sourceFamilyId, null);
});

test('CASE J: requirements layer never creates heat loss / kW / BTU / flow / head / pipe diameter / invented loop count', () => {
  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils', 'hydronic_floor_heating'],
    assignments: [
      assignment('r1', 'Ванная', 'bathroom', ['hydronic_floor_heating']),
      assignment('r2', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils']),
    ],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  const json = JSON.stringify(req).toLowerCase();
  for (const banned of ['heatloss', 'powerkw', 'btu', 'flowrate', 'flowl', 'pumphead', 'pipediameter', 'loopcount', 'w/m']) {
    assert.ok(!json.includes(banned), `requirements must not contain ${banned}`);
  }
  assert.equal(req.floorHeatingCircuitCount, 'pending_calculation');
  assert.ok(req.unresolvedRequirements.includes('floorHeatingCircuitCount:pending_calculation'));
});

test('CASE K: legacy Phase 2 config without hydronicRequirements normalizes and requirements restore deterministically', () => {
  const rooms = [
    room('bathroom', 'Ванная 1', 5),
    room('bedroom', 'Спальня 1', 16),
  ];
  const project = makeProject(rooms);
  const legacyConfig = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [
      assignment('room-Ванная 1', 'Ванная 1', 'bathroom', ['aluminum_radiators']),
      assignment('room-Спальня 1', 'Спальня 1', 'bedroom', ['fan_coils'], ['fan_coils']),
    ],
  }) as unknown as Record<string, unknown>;
  // Strip the field to simulate a Phase 2 file saved before Phase 2.5.
  delete legacyConfig.hydronicRequirements;

  const normalized = normalizeSystemsConfiguration(project, legacyConfig as never, ['heating', 'cooling']);
  assert.ok(normalized.hydronicRequirements, 'normalized config must carry hydronicRequirements');
  assert.equal(normalized.hydronicRequirements!.towelRadiatorsRequired, 0);
  assert.equal(normalized.hydronicRequirements!.towelRadiatorsRecommended, 1);
  assert.equal(normalized.hydronicRequirements!.fanCoilCount, 1);
  assert.equal(normalized.hydronicRequirements!.fanCoilCircuitKind, '2pipe');
});

test('null config -> null requirements (no systems configured yet)', () => {
  assert.equal(computeHydronicSystemRequirements(null, null), null);
  assert.equal(computeHydronicSystemRequirements(undefined, undefined), null);
});

test('P28: fan-coil manifold required only for explicit home-run, never while pending_design', () => {
  assert.equal(isFanCoilManifoldRequired('pending_design', 6), false);
  assert.equal(isFanCoilManifoldRequired('branch_riser', 6), false);
  assert.equal(isFanCoilManifoldRequired('home_run_manifold', 0), false);
  assert.equal(isFanCoilManifoldRequired('home_run_manifold', 6), true);

  const config = makeConfig({
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCount, 1);
  assert.equal(req.fanCoilDistribution, 'pending_design');
  assert.equal(req.fanCoilManifoldRequired, false);
  assert.equal(isFanCoilManifoldRequired(req.fanCoilDistribution, req.fanCoilCount), false);
});

test('P28A-P1-3-A: cooling-only fan coils (chiller) -> cooling circuit, NOT a heating circuit', () => {
  const config = makeConfig({
    requestedServices: ['cooling'],
    families: ['chiller_fan_coils', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', [], ['fan_coils'])],
  });
  assert.equal(config.architecture.distribution.circuitKind, '2pipe');
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilCount, 1);
  assert.equal(req.fanCoilCircuitKind, '2pipe');
  assert.equal(req.fanCoilHeatingCircuit.present, false, 'cooling-only fan coil must NOT claim an active heating circuit');
  assert.equal(req.fanCoilCoolingCircuit.present, true, 'cooling-only fan coil must report the cooling circuit');
  assert.equal(req.fanCoilValveSetsRequired, 1);
  assert.equal(req.actuatorCountRequired, 1);
});

test('P28A-P1-3-B: heating-only fan coils (boiler) -> heating circuit present, cooling absent', () => {
  const config = makeConfig({
    requestedServices: ['heating'],
    families: ['gas_condensing_boiler', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'])],
  });
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilHeatingCircuit.present, true);
  assert.equal(req.fanCoilCoolingCircuit.present, false);
});

test('P28A-P1-3-C: H+C 2-pipe seasonal = ONE shared changeover circuit serving both seasons', () => {
  const config = makeConfig({
    requestedServices: ['heating', 'cooling'],
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  assert.equal(config.architecture.distribution.circuitKind, '2pipe');
  assert.equal(config.architecture.simultaneousHeatCoolSupported, false, '2-pipe seasonal cannot heat and cool different zones at the same time');
  const req = computeHydronicSystemRequirements(null, config)!;
  // ONE physical changeover circuit: it serves BOTH services seasonally (both
  // present flags true), but carries a SINGLE valve set per fan coil — never
  // two independent simultaneous circuits (that is 4-pipe only).
  assert.equal(req.fanCoilCircuitKind, '2pipe');
  assert.equal(req.fanCoilHeatingCircuit.present, true, 'the changeover circuit serves heating in the heating season');
  assert.equal(req.fanCoilCoolingCircuit.present, true, 'the changeover circuit serves cooling in the cooling season');
  assert.equal(req.fanCoilValveSetsRequired, 1, 'one valve set for the single seasonal circuit, not two');
  assert.equal(req.actuatorCountRequired, 1);
});

test('P28A-P1-3-D: H+C 4-pipe keeps heating and cooling circuits separate', () => {
  const config = makeConfig({
    requestedServices: ['heating', 'cooling'],
    families: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    explicitDistribution: { id: 'hydronic_4pipe_heating_cooling' },
    simultaneousHeatCoolRequired: true,
    assignments: [assignment('r1', 'Офис', 'commercial_office', ['fan_coils'], ['fan_coils'])],
  });
  assert.equal(config.architecture.distribution.circuitKind, '4pipe');
  const req = computeHydronicSystemRequirements(null, config)!;
  assert.equal(req.fanCoilHeatingCircuit.present, true);
  assert.equal(req.fanCoilCoolingCircuit.present, true);
  assert.equal(req.fanCoilValveSetsRequired, 2);
  assert.equal(req.actuatorCountRequired, 2);
});
