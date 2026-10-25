/**
 * Building Project Phase 2.8 — integrity / confirmation / topology regressions.
 *
 * Mix of pure-function and service-level tests. Created projects are tracked
 * and deleted. Do not sweep data/building-projects.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  applySuggestedSystemsConfiguration,
  confirmObject,
  confirmSystemsConfiguration,
  createProject,
  deleteProject,
  loadProject,
  previewSuggestedSystemsConfiguration,
  removeRoom,
  setRoomTypeCount,
  updateProjectMeta,
  updateSystemsConfiguration,
} from './buildingProjectService.js';
import {
  engineeringFingerprint,
  normalizeSystemsConfiguration,
  SYSTEM_FAMILIES,
  validateSystemsConfigurationForConfirmation,
} from './buildingProjectSystems.js';
import type { EngineeringSystemFamilySelection } from './buildingProjectTypes.js';

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

function confirmedApartment() {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 80 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  addRoom(p.id, { roomType: 'bathroom', areaM2: 5 });
  return confirmObject(p.id);
}

function confirmedHouse() {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 180, floorCount: 2 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16, floorId: 'floor-1' });
  addRoom(p.id, { roomType: 'bathroom', areaM2: 5, floorId: 'floor-1' });
  return confirmObject(p.id);
}

before(() => {
  fs.mkdirSync(STORE, { recursive: true });
});

after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});

test('P28-01: H+C + only gas boiler -> Confirm reject', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['aluminum_radiators'],
      coolingSystems: [],
      servicePreferences: { heating: 'required', cooling: 'required' },
      servicePreferenceSource: { heating: 'user', cooling: 'user' },
    })),
  });
  assert.throws(
    () => confirmSystemsConfiguration(project.id),
    (err: any) => err?.code === 'building.systems_not_ready' || /охлажден/i.test(String(err?.message || '')),
  );
});

test('P28-02: Radiators + no heating source -> reject', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['aluminum_radiators'],
      servicePreferences: { heating: 'required', cooling: 'not_required' },
    })),
  });
  assert.throws(() => confirmSystemsConfiguration(project.id), (err: any) => err?.code === 'building.systems_not_ready');
});

test('P28-03: Heating + only split_wall -> reject', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('split_wall')],
    roomAssignments: [{ roomId: project.rooms[0].id, coolingSystems: ['split_wall'] }],
  });
  assert.throws(() => confirmSystemsConfiguration(project.id));
});

test('P28-04: split_wall inside heatingSystems -> write reject', () => {
  const project = confirmedApartment();
  assert.throws(
    () => updateSystemsConfiguration(project.id, {
      requestedServices: ['heating'],
      selectedSystemFamilies: [family('split_wall')],
      roomAssignments: [{ roomId: project.rooms[0].id, heatingSystems: ['split_wall'] }],
    }),
    (err: any) => err?.code === 'building.systems_service_mismatch',
  );
});

test('P28-05: Required room without terminal -> reject', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: [],
      servicePreferences: { heating: 'required', cooling: 'not_required' },
      servicePreferenceSource: { heating: 'user', cooling: 'default' },
    })),
  });
  assert.throws(() => confirmSystemsConfiguration(project.id), (err: any) => err?.code === 'building.systems_not_ready');
});

test('P28-06: Optional room without terminal -> allowed', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('electric_convector')],
    roomAssignments: [
      {
        roomId: bedroom.id,
        heatingSystems: [],
        servicePreferences: { heating: 'optional', cooling: 'not_required' },
        servicePreferenceSource: { heating: 'user', cooling: 'default' },
      },
      {
        roomId: bath.id,
        heatingSystems: ['electric_convector'],
        servicePreferences: { heating: 'required', cooling: 'not_required' },
        servicePreferenceSource: { heating: 'user', cooling: 'default' },
      },
    ],
  });
  const confirmed = confirmSystemsConfiguration(project.id);
  assert.equal(confirmed.status, 'systems_configured');
});

test('P28-07: not_yet_verified active system -> Confirm reject', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('heat_pump_air_to_air')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['heat_pump_air_to_air'],
      coolingSystems: ['heat_pump_air_to_air'],
      servicePreferences: { heating: 'required', cooling: 'required' },
      servicePreferenceSource: { heating: 'user', cooling: 'user' },
    })),
  });
  assert.throws(() => confirmSystemsConfiguration(project.id), (err: any) => err?.code === 'building.systems_not_ready');
});

test('P28-08: newly enabled service gets default preferences unless user overrode', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('electric_convector')],
    roomAssignments: [{
      roomId: bedroom.id,
      heatingSystems: ['electric_convector'],
      servicePreferences: { heating: 'optional', cooling: 'not_required' },
      servicePreferenceSource: { heating: 'default', cooling: 'default' },
    }],
  });
  const enabled = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('electric_convector'), family('split_wall')],
  });
  const bed = enabled.systemsConfiguration!.roomAssignments.find((a) => a.roomId === bedroom.id)!;
  assert.equal(bed.servicePreferences.cooling, 'optional');
  assert.equal(bed.servicePreferenceSource.cooling, 'default');
});

test('P28-09: user explicit not_required is preserved', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('electric_convector'), family('split_wall')],
    roomAssignments: [{
      roomId: bedroom.id,
      servicePreferences: { heating: 'not_required', cooling: 'not_required' },
      servicePreferenceSource: { heating: 'user', cooling: 'user' },
      heatingSystems: [],
      coolingSystems: [],
    }],
  });
  const again = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('electric_convector'), family('split_wall')],
  });
  const bed = again.systemsConfiguration!.roomAssignments.find((a) => a.roomId === bedroom.id)!;
  assert.equal(bed.servicePreferences.heating, 'not_required');
  assert.equal(bed.servicePreferences.cooling, 'not_required');
  assert.equal(bed.servicePreferenceSource.heating, 'user');
});

test('P28-10: external H + external C + local split survives repeated round-trips', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('external_building_heating_supply'), family('external_building_cooling_supply'), family('aluminum_radiators')],
    roomAssignments: [
      {
        roomId: bedroom.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: ['split_wall'],
        sourceSystemIds: { heating: 'external_building_heating_supply', cooling: null },
        servicePreferences: { heating: 'required', cooling: 'optional' },
      },
      {
        roomId: bath.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: [],
        sourceSystemIds: { heating: 'external_building_heating_supply', cooling: null },
        servicePreferences: { heating: 'required', cooling: 'not_required' },
      },
    ],
  });
  for (let i = 0; i < 3; i += 1) {
    const loaded = loadProject(project.id)!;
    const cfg = loaded.systemsConfiguration!;
    assert.equal(cfg.architecture.spaceHeatingSourceId, 'external_building_heating_supply');
    assert.equal(cfg.architecture.spaceCoolingSourceId, 'external_building_cooling_supply');
    assert.notEqual(cfg.architecture.spaceCoolingSourceId, 'split_wall');
    assert.equal(cfg.roomAssignments.find((a) => a.roomId === bedroom.id)?.coolingSystems[0]?.familyId, 'split_wall');
    updateSystemsConfiguration(project.id, {
      requestedServices: cfg.requestedServices,
      selectedSystemFamilies: cfg.selectedSystemFamilies,
      roomAssignments: cfg.roomAssignments,
    });
  }
});

test('P28-11: two conflicting central heating sources -> blocker', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('electric_boiler'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['aluminum_radiators'],
      servicePreferences: { heating: 'required', cooling: 'not_required' },
    })),
  });
  const cfg = loadProject(project.id)!.systemsConfiguration!;
  const result = validateSystemsConfigurationForConfirmation(loadProject(project.id)!, cfg);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === 'conflicting_central_sources'));
});

test('P28-12: architecture gas boiler + room source electric boiler -> blocker', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['aluminum_radiators'],
      sourceSystemIds: { heating: 'electric_boiler', cooling: null },
      servicePreferences: { heating: 'required', cooling: 'not_required' },
    })),
  });
  const loaded = loadProject(project.id)!;
  const result = validateSystemsConfigurationForConfirmation(loaded, loaded.systemsConfiguration!);
  assert.ok(result.blockers.some((item) => item.code === 'room_source_conflicts_project' || item.code === 'unknown_source_id' || item.code === 'source_missing_required_service'));
});

test('P28-13: pure split cooling -> no hydronic pump/separation requirements', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['cooling'],
    selectedSystemFamilies: [family('split_wall')],
    roomAssignments: [
      { roomId: bedroom.id, coolingSystems: ['split_wall'], servicePreferences: { heating: 'not_required', cooling: 'optional' } },
      { roomId: bath.id, coolingSystems: [], servicePreferences: { heating: 'not_required', cooling: 'not_required' } },
    ],
  });
  const req = loadProject(project.id)!.systemsConfiguration!.hydronicRequirements!;
  assert.equal(req.hydronicCircuitPresent, false);
  assert.ok(!req.unresolvedRequirements.some((item) => item.startsWith('pumpGroups:')));
  assert.ok(!req.unresolvedRequirements.some((item) => item.startsWith('hydraulicSeparation:')));
});

test('P28-14: invalid floorId in setRoomTypeCount -> error', () => {
  const p = track(createProject({ objectType: 'private_house', floorCount: 2, totalAreaM2: 120 }));
  assert.throws(
    () => setRoomTypeCount(p.id, 'bedroom', 1, 'floor-99'),
    (err: any) => err?.code === 'building.invalid_floor',
  );
});

test('P28-15: private_house -> apartment clears house topology', () => {
  const p = track(createProject({ objectType: 'private_house', floorCount: 2, totalAreaM2: 120 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16, floorId: 'floor-2' });
  const after = updateProjectMeta(p.id, { objectType: 'apartment' });
  assert.equal(after.objectType, 'apartment');
  assert.equal(after.topology, null);
  assert.ok(after.rooms.every((room) => !room.floorId));
});

test('P28-16: normalization is idempotent for engineering fields', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('external_building_heating_supply'), family('external_building_cooling_supply'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['aluminum_radiators'],
      coolingSystems: room.roomType === 'bedroom' ? ['split_wall'] : [],
      servicePreferences: { heating: 'required', cooling: room.roomType === 'bathroom' ? 'not_required' : 'optional' },
    })),
  });
  const loaded = loadProject(project.id)!;
  const once = normalizeSystemsConfiguration(loaded, loaded.systemsConfiguration, ['heating', 'cooling']);
  const twice = normalizeSystemsConfiguration({ ...loaded, systemsConfiguration: once }, once, ['heating', 'cooling']);
  assert.equal(engineeringFingerprint(twice), engineeringFingerprint(once));
});

test('P28-17: Preview Suggestion = Apply Suggestion for same inputs', () => {
  const project = confirmedApartment();
  const preview = previewSuggestedSystemsConfiguration(project.id, ['heating', 'cooling'], []);
  const applied = applySuggestedSystemsConfiguration(project.id, ['heating', 'cooling'], []);
  assert.equal(engineeringFingerprint(applied.systemsConfiguration!), engineeringFingerprint(preview));
});

test('P28-18: required wet-room heating survives a room-family replace', () => {
  const project = confirmedApartment();
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: room.id === bath.id ? ['aluminum_radiators'] : ['electric_convector'],
      servicePreferences: { heating: room.id === bath.id ? 'required' : 'optional', cooling: 'not_required' },
      servicePreferenceSource: { heating: room.id === bath.id ? 'default' : 'user', cooling: 'default' },
    })),
  });
  const replaced = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('hydronic_floor_heating')],
    roomAssignments: loadProject(project.id)!.systemsConfiguration!.roomAssignments.map((item) => (
      item.roomId === bath.id
        ? { ...item, heatingSystems: ['hydronic_floor_heating'] }
        : item
    )),
  });
  const after = replaced.systemsConfiguration!.roomAssignments.find((item) => item.roomId === bath.id)!;
  assert.equal(after.servicePreferences.heating, 'required');
  assert.equal(after.heatingSystems[0]?.familyId, 'hydronic_floor_heating');
});

test('P28-19: legacy Building Project JSON still loads safely', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 72 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  confirmObject(p.id);
  updateSystemsConfiguration(p.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: [family('electric_convector')],
    roomAssignments: [{ roomId: loadProject(p.id)!.rooms[0].id, heatingSystems: ['electric_convector'] }],
  });
  const rawPath = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  delete raw.systemsConfiguration.validation;
  delete raw.systemsConfiguration.hydronicRequirements;
  if (raw.systemsConfiguration.roomAssignments?.[0]) {
    delete raw.systemsConfiguration.roomAssignments[0].servicePreferenceSource;
    delete raw.systemsConfiguration.roomAssignments[0].towelRadiatorPreference;
  }
  fs.writeFileSync(rawPath, JSON.stringify(raw));
  const loaded = loadProject(p.id)!;
  assert.ok(loaded.systemsConfiguration);
  assert.ok(loaded.systemsConfiguration?.validation);
  assert.ok(loaded.systemsConfiguration?.hydronicRequirements);
  assert.equal(loaded.systemsConfiguration?.roomAssignments[0]?.servicePreferenceSource.heating, 'default');
});

test('P28-20: existing 2-pipe / 4-pipe / reversible HP scenarios remain compatible', () => {
  const twoPipe = confirmedApartment();
  updateSystemsConfiguration(twoPipe.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('reversible_air_to_water_heat_pump'), family('fan_coils')],
    roomAssignments: twoPipe.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['fan_coils'],
      coolingSystems: ['fan_coils'],
      servicePreferences: { heating: room.roomType === 'bathroom' ? 'required' : 'optional', cooling: 'optional' },
    })),
  });
  const twoCfg = loadProject(twoPipe.id)!.systemsConfiguration!;
  assert.equal(twoCfg.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(twoCfg.architecture.simultaneousHeatCoolSupported, false);
  confirmSystemsConfiguration(twoPipe.id);

  const four = track(createProject({ objectType: 'commercial', totalAreaM2: 200 }));
  addRoom(four.id, { roomType: 'commercial_office', areaM2: 40 });
  confirmObject(four.id);
  updateSystemsConfiguration(four.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('reversible_air_to_water_heat_pump'), family('fan_coils')],
    simultaneousHeatCoolRequired: true,
    architecture: { distribution: { id: 'hydronic_4pipe_heating_cooling' } },
    roomAssignments: [{
      roomId: loadProject(four.id)!.rooms[0].id,
      heatingSystems: ['fan_coils'],
      coolingSystems: ['fan_coils'],
    }],
  });
  const fourCfg = loadProject(four.id)!.systemsConfiguration!;
  assert.equal(fourCfg.architecture.distribution.circuitKind, '4pipe');
  assert.equal(fourCfg.hydronicRequirements?.fanCoilHeatingCircuit?.present, true);
  assert.equal(fourCfg.hydronicRequirements?.fanCoilCoolingCircuit?.present, true);
  confirmSystemsConfiguration(four.id);
});

test('P28-plant: deleting plant-location room clears the reference', () => {
  const p = track(createProject({ objectType: 'private_house', floorCount: 1, totalAreaM2: 80 }));
  addRoom(p.id, { roomType: 'boiler_room', areaM2: 6, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-1', roomId } });
  assert.equal(loadProject(p.id)!.topology?.plantLocation.roomId, roomId);
  removeRoom(p.id, roomId);
  const after = loadProject(p.id)!;
  assert.equal(after.topology?.plantLocation.kind, 'not_defined');
  assert.equal(after.topology?.plantLocation.roomId, null);
});

test('P28A-P0-2: stale room own-source ids after central external -> confirm blocker (setBothCentral invariant)', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  // Simulates what the client setBothCentral used to leave behind: building-level
  // external supply selected, but rooms still carry an old own source id.
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('external_building_heating_supply'), family('external_building_cooling_supply'), family('aluminum_radiators')],
    roomAssignments: [
      {
        roomId: bedroom.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: ['split_wall'],
        sourceSystemIds: { heating: 'gas_boiler', cooling: null },
        servicePreferences: { heating: 'required', cooling: 'optional' },
      },
      {
        roomId: bath.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: [],
        sourceSystemIds: { heating: 'gas_boiler', cooling: null },
        servicePreferences: { heating: 'required', cooling: 'not_required' },
      },
    ],
  });
  const loaded = loadProject(project.id)!;
  const result = validateSystemsConfigurationForConfirmation(loaded, loaded.systemsConfiguration!);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === 'room_source_conflicts_project' || item.code === 'unknown_source_id' || item.code === 'source_missing_required_service'));
});

test('P28A-P0-1: single combined reversible source serves both services without conflicts', () => {
  const project = confirmedApartment();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('reversible_air_to_water_heat_pump'), family('fan_coils')],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['fan_coils'],
      coolingSystems: ['fan_coils'],
      servicePreferences: { heating: 'required', cooling: room.roomType === 'bathroom' ? 'not_required' : 'optional' },
    })),
  });
  const loaded = loadProject(project.id)!;
  const cfg = loaded.systemsConfiguration!;
  assert.equal(cfg.architecture.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(cfg.architecture.spaceHeatingSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(cfg.architecture.spaceCoolingSourceId, 'reversible_air_to_water_heat_pump');
  const result = validateSystemsConfigurationForConfirmation(loaded, cfg);
  assert.equal(result.ready, true);
  assert.ok(!result.blockers.some((item) => item.code === 'conflicting_central_sources'));
});

test('P28A-P1-2: setRoomTypeCount decrease clears plantLocation when the plant room is removed', () => {
  const p = track(createProject({ objectType: 'private_house', floorCount: 1, totalAreaM2: 80 }));
  addRoom(p.id, { roomType: 'boiler_room', areaM2: 6, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-1', roomId } });
  assert.equal(loadProject(p.id)!.topology?.plantLocation.roomId, roomId);
  // Decrease path removes rooms directly (NOT via removeRoom) — must still clear.
  setRoomTypeCount(p.id, 'boiler_room', 0);
  const after = loadProject(p.id)!;
  assert.equal(after.topology?.plantLocation.kind, 'not_defined');
  assert.equal(after.topology?.plantLocation.roomId, null);
});

test('P28A-P1-4: valid room-local cooling architecture gets no false "no technology" warning', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  // Project-level families contain ONLY heating (gas boiler); cooling is served
  // room-locally by split_wall in the bedroom.
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    roomAssignments: [
      {
        roomId: bedroom.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: ['split_wall'],
        servicePreferences: { heating: 'required', cooling: 'optional' },
      },
      {
        roomId: bath.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: [],
        servicePreferences: { heating: 'required', cooling: 'not_required' },
      },
    ],
  });
  const loaded = loadProject(project.id)!;
  const cfg = loaded.systemsConfiguration!;
  assert.ok(cfg.roomAssignments.some((a) => a.coolingSystems.some((item) => item.familyId === 'split_wall')));
  assert.ok(!cfg.warnings.some((w) => /Для охлаждения не выбрана технология/.test(w)), `unexpected warning: ${cfg.warnings.join('; ')}`);
});

test('P28A-A: confirmed systems snapshot stays historical after rooms change', () => {
  const project = confirmedApartment();
  const bedroom = project.rooms.find((r) => r.roomType === 'bedroom')!;
  const bath = project.rooms.find((r) => r.roomType === 'bathroom')!;
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: [family('external_building_heating_supply'), family('external_building_cooling_supply'), family('aluminum_radiators')],
    roomAssignments: [
      {
        roomId: bedroom.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: ['split_wall'],
        servicePreferences: { heating: 'required', cooling: 'optional' },
      },
      {
        roomId: bath.id,
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: [],
        servicePreferences: { heating: 'required', cooling: 'not_required' },
      },
    ],
  });
  confirmSystemsConfiguration(project.id);
  // Building changes AFTER confirmation: the bathroom is removed from the store.
  const rawPath = path.join(STORE, `${project.id}.json`);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  raw.rooms = raw.rooms.filter((room: any) => room.id !== bath.id);
  fs.writeFileSync(rawPath, JSON.stringify(raw));
  const loaded = loadProject(project.id)!;
  assert.ok(
    loaded.systemsConfigurationSnapshot?.roomAssignments.some((a) => a.roomId === bath.id),
    'snapshot must keep the deleted room assignment (historical confirmation state)',
  );
  assert.ok(
    !loaded.systemsConfiguration?.roomAssignments.some((a) => a.roomId === bath.id),
    'live config must track the current rooms',
  );
});
