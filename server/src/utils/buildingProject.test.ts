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
  getBuildingProjectCatalog,
  getBuildingProjectSystemsCatalog,
  getProjectView,
  loadProject,
  reopenObject,
  setRoomTypeCount,
  suggestRoomName,
  updateProjectMeta,
  updateRoom,
  updateSystemsConfiguration,
} from './buildingProjectService.js';
import {
  buildArchitectureFromSelection,
  defaultFamilyIdsForServices,
  simultaneousHeatCoolSatisfied,
  SYSTEM_FAMILIES,
  SYSTEM_GROUPS,
} from './buildingProjectSystems.js';

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

test('catalog exposes object types, regions, insulation, room types without climate coeffs', () => {
  const cat = getBuildingProjectCatalog();
  assert.ok(cat.objectTypes.some((t) => t.value === 'apartment'));
  assert.ok(cat.objectTypes.some((t) => t.value === 'private_house'));
  assert.ok(cat.objectTypes.some((t) => t.value === 'commercial'));
  assert.ok(cat.regions.some((r) => r.value === 'AM-ER'));
  assert.equal(cat.notes.climateData, 'none');
  assert.equal(cat.notes.insulationCoefficients, 'none');
  assert.equal(cat.roomTypes.filter((t) => t.value === 'bedroom').length, 1);
  assert.ok(!cat.roomTypes.some((t) => /bedroom\d/.test(t.value)));
});

test('create apartment/house/commercial with area, region, height, insulation', () => {
  const house = track(createProject({
    objectType: 'private_house',
    regionCode: 'AM-ER',
    totalAreaM2: 180,
    defaultCeilingHeightM: 2.8,
    insulationLevel: 'medium',
  }));
  assert.equal(house.objectType, 'private_house');
  assert.equal(house.region?.code, 'AM-ER');
  assert.equal(house.region?.name, 'Ереван');
  assert.equal(house.totalAreaM2, 180);
  assert.equal(house.defaultCeilingHeightM, 2.8);
  assert.equal(house.insulationLevel, 'medium');
  assert.equal(house.status, 'draft');
  assert.match(house.name, /Ереван/);

  const apt = track(createProject({ objectType: 'apartment', regionCode: 'AM-KT', totalAreaM2: 72, insulationLevel: 'good' }));
  assert.equal(apt.objectType, 'apartment');
  const comm = track(createProject({ objectType: 'commercial', insulationLevel: 'unknown' }));
  assert.equal(comm.objectType, 'commercial');
});

test('duplicate room types are independent instances with unique ids', () => {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 180 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 18 });
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  const loaded = loadProject(p.id)!;
  const beds = loaded.rooms.filter((r) => r.roomType === 'bedroom');
  assert.equal(beds.length, 3);
  assert.equal(new Set(beds.map((r) => r.id)).size, 3);
  assert.deepEqual(beds.map((r) => r.name).sort(), ['Спальня 1', 'Спальня 2', 'Спальня 3']);
  assert.ok(beds.every((r) => r.roomType === 'bedroom'));
});

test('rename keeps roomType; editing one room does not change another', () => {
  const p = track(createProject({ objectType: 'private_house' }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 18 });
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  const loaded = loadProject(p.id)!;
  const a = loaded.rooms[0];
  const b = loaded.rooms[1];
  updateRoom(p.id, b.id, { name: 'Спальня родителей' });
  updateRoom(p.id, a.id, { areaM2: 19 });
  const after = loadProject(p.id)!;
  const aa = after.rooms.find((r) => r.id === a.id)!;
  const bb = after.rooms.find((r) => r.id === b.id)!;
  assert.equal(aa.areaM2, 19);
  assert.equal(aa.name, 'Спальня 1');
  assert.equal(bb.areaM2, 16);
  assert.equal(bb.name, 'Спальня родителей');
  assert.equal(bb.roomType, 'bedroom');
});

test('advanced room extras are stored only, not applied as coefficients', () => {
  const p = track(createProject({ objectType: 'apartment' }));
  addRoom(p.id, {
    roomType: 'living_room',
    areaM2: 36,
    extras: {
      geometry: { ceilingHeightM: 3.1, externalWallCount: 2, floorPosition: 'top' },
      windows: { glazingType: 'panoramic', count: 3, areaM2: 12 },
      insulationOverride: 'poor',
      conditions: ['corner_room', 'top_floor', 'high_heat_loss'],
      notes: 'витраж на юг',
    },
  });
  const room = loadProject(p.id)!.rooms[0];
  assert.equal(room.extras.engineeringUse, 'stored_only');
  assert.equal(room.extras.windows.glazingType, 'panoramic');
  assert.equal(room.extras.insulationOverride, 'poor');
  assert.ok(room.extras.conditions.includes('corner_room'));
  assert.equal((room as any).heatLossCoefficient, undefined);
});

test('object confirm snapshot is immutable against later draft edits', () => {
  const p = track(createProject({
    objectType: 'private_house',
    regionCode: 'AM-ER',
    totalAreaM2: 180,
    defaultCeilingHeightM: 2.8,
    insulationLevel: 'medium',
  }));
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 1', areaM2: 18 });
  addRoom(p.id, { roomType: 'kitchen', areaM2: 20 });
  const confirmed = confirmObject(p.id);
  assert.equal(confirmed.status, 'object_confirmed');
  assert.equal(confirmed.objectConfirmedSnapshot?.roomCount, 2);
  assert.equal(confirmed.objectConfirmedSnapshot?.rooms[0].areaM2, 18);

  assert.throws(() => addRoom(p.id, { roomType: 'bathroom', areaM2: 6 }), /Confirmed object/);
  assert.throws(() => updateProjectMeta(p.id, { totalAreaM2: 200 }), /Confirmed object/);

  reopenObject(p.id);
  updateRoom(p.id, confirmed.rooms[0].id, { areaM2: 22, name: 'Спальня родителей' });
  const after = loadProject(p.id)!;
  assert.equal(after.status, 'draft');
  assert.equal(after.rooms[0].areaM2, 22);
  assert.equal(after.objectConfirmedSnapshot?.rooms[0].areaM2, 18);
  assert.equal(after.objectConfirmedSnapshot?.rooms[0].name, 'Спальня 1');
});

test('confirm requires rooms; persistence reload restores project', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 80 }));
  assert.throws(() => confirmObject(p.id), /at least one room/i);
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  confirmObject(p.id);
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.status, 'object_confirmed');
  assert.equal(reloaded.rooms.length, 1);
  assert.ok(reloaded.objectConfirmedSnapshot);
});

test('suggestRoomName never invents bedroom1 engineering types', () => {
  const names = [
    suggestRoomName('bedroom', []),
    suggestRoomName('bedroom', [{ roomType: 'bedroom', name: 'Спальня 1' }]),
    suggestRoomName('bedroom', [{ roomType: 'bedroom', name: 'Спальня 1' }, { roomType: 'bedroom', name: 'Спальня 2' }]),
  ];
  assert.deepEqual(names, ['Спальня 1', 'Спальня 2', 'Спальня 3']);
});

function confirmedHouse() {
  const p = track(createProject({
    objectType: 'private_house',
    regionCode: 'AM-ER',
    totalAreaM2: 180,
    defaultCeilingHeightM: 2.8,
    insulationLevel: 'medium',
    name: 'Собственный дом QA',
  }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 16 });
  addRoom(p.id, { roomType: 'bedroom', areaM2: 15 });
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  addRoom(p.id, { roomType: 'bathroom', areaM2: 5 });
  addRoom(p.id, { roomType: 'bathroom', areaM2: 4 });
  addRoom(p.id, { roomType: 'kitchen', areaM2: 12 });
  addRoom(p.id, { roomType: 'living_room', areaM2: 28 });
  addRoom(p.id, { roomType: 'office', areaM2: 10 });
  return confirmObject(p.id);
}

function roomByName(project: { rooms: Array<{ id: string; name: string; roomType: string }> }, name: string) {
  const room = project.rooms.find((item) => item.name === name);
  assert.ok(room, `missing room ${name}`);
  return room!;
}

test('systems catalog exposes service options, capability states, source vs terminal', () => {
  const cat = getBuildingProjectSystemsCatalog();
  assert.ok(cat.serviceOptions.some((item) => item.value === 'heating'));
  assert.ok(cat.serviceOptions.some((item) => item.value === 'cooling'));
  assert.ok(cat.serviceOptions.some((item) => item.value === 'heating_and_cooling'));
  assert.ok(cat.systemFamilies.some((item) => item.id === 'gas_condensing_boiler' && item.kind === 'source' && item.scope === 'central'));
  assert.ok(cat.systemFamilies.some((item) => item.id === 'aluminum_radiators' && item.kind === 'terminal'));
  assert.ok(cat.systemFamilies.some((item) => item.id === 'heat_pump_air_to_air' && item.capabilityStatus === 'not_yet_verified'));
  assert.ok(cat.capabilityStates.some((item) => item.value === 'allowed_with_warning'));
});

test('systems require object confirmation and support heating / cooling / both', () => {
  const draft = track(createProject({ objectType: 'private_house' }));
  addRoom(draft.id, { roomType: 'bedroom', areaM2: 12 });
  assert.throws(() => updateSystemsConfiguration(draft.id, { requestedServices: ['heating'] }), /Confirm the object/);

  const heating = confirmedHouse();
  const heatingOnly = updateSystemsConfiguration(heating.id, {
    requestedService: 'heating',
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators'],
  });
  assert.deepEqual(heatingOnly.systemsConfiguration?.requestedServices, ['heating']);

  const cooling = confirmedHouse();
  const coolingOnly = updateSystemsConfiguration(cooling.id, {
    requestedService: 'cooling',
    selectedSystemFamilies: ['split_wall'],
  });
  assert.deepEqual(coolingOnly.systemsConfiguration?.requestedServices, ['cooling']);

  const both = confirmedHouse();
  const bothCfg = updateSystemsConfiguration(both.id, {
    requestedService: 'heating_and_cooling',
    selectedSystemFamilies: ['gas_condensing_boiler', 'split_wall'],
  });
  assert.deepEqual(bothCfg.systemsConfiguration?.requestedServices, ['heating', 'cooling']);
});

test('duplicate rooms keep independent assignments after bulk apply', () => {
  const project = confirmedHouse();
  const bed1 = roomByName(project, 'Спальня 1');
  const bed2 = roomByName(project, 'Спальня 2');
  const bed3 = roomByName(project, 'Спальня 3');
  const afterBulk = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators', 'split_wall'],
    roomAssignments: [{
      roomId: bed1.id,
      sourceSystemIds: { heating: 'gas_condensing_boiler', cooling: null },
      heatingSystems: ['aluminum_radiators'],
      coolingSystems: ['split_wall'],
    }],
    bulk: { sourceRoomId: bed1.id, target: 'bedrooms' },
  });
  const assignments = afterBulk.systemsConfiguration!.roomAssignments;
  const a1 = assignments.find((item) => item.roomId === bed1.id)!;
  const a2 = assignments.find((item) => item.roomId === bed2.id)!;
  const a3 = assignments.find((item) => item.roomId === bed3.id)!;
  assert.equal(a1.heatingSystems[0]?.familyId, 'aluminum_radiators');
  assert.equal(a2.heatingSystems[0]?.familyId, 'aluminum_radiators');
  assert.equal(a3.heatingSystems[0]?.familyId, 'aluminum_radiators');
  assert.equal(a1.sourceSystemIds.heating, 'gas_condensing_boiler');
  assert.equal(a2.sourceSystemIds.heating, 'gas_condensing_boiler');

  const afterEdit = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    roomAssignments: afterBulk.systemsConfiguration!.roomAssignments.map((item) => (
      item.roomId === bed2.id
        ? { ...item, heatingSystems: ['steel_panel_radiators'], coolingSystems: ['cassette_ac'] }
        : item
    )),
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators', 'steel_panel_radiators', 'split_wall', 'cassette_ac'],
  });
  const next = afterEdit.systemsConfiguration!.roomAssignments;
  assert.equal(next.find((item) => item.roomId === bed1.id)?.heatingSystems[0]?.familyId, 'aluminum_radiators');
  assert.equal(next.find((item) => item.roomId === bed2.id)?.heatingSystems[0]?.familyId, 'steel_panel_radiators');
  assert.equal(next.find((item) => item.roomId === bed3.id)?.heatingSystems[0]?.familyId, 'aluminum_radiators');
  assert.equal(next.find((item) => item.roomId === bed1.id)?.coolingSystems[0]?.familyId, 'split_wall');
  assert.equal(next.find((item) => item.roomId === bed2.id)?.coolingSystems[0]?.familyId, 'cassette_ac');
});

test('central source can serve many rooms; local systems stay independent; room can have multiple terminals', () => {
  const project = confirmedHouse();
  const bed1 = roomByName(project, 'Спальня 1');
  const bath1 = roomByName(project, 'Ванная 1');
  const living = roomByName(project, 'Гостиная 1');
  const updated = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators', 'hydronic_floor_heating', 'split_wall', 'heating_mat'],
    roomAssignments: [
      {
        roomId: bed1.id,
        sourceSystemIds: { heating: 'gas_condensing_boiler', cooling: null },
        heatingSystems: ['aluminum_radiators'],
        coolingSystems: ['split_wall'],
      },
      {
        roomId: bath1.id,
        sourceSystemIds: { heating: 'gas_condensing_boiler', cooling: null },
        heatingSystems: ['hydronic_floor_heating', 'aluminum_radiators'],
        servicePreferences: { heating: 'required', cooling: 'not_required' },
        coolingSystems: [],
      },
      {
        roomId: living.id,
        sourceSystemIds: { heating: 'gas_condensing_boiler', cooling: null },
        heatingSystems: ['hydronic_floor_heating', 'infloor_convectors'],
        coolingSystems: ['ducted_ac'],
      },
    ],
  });
  const cfg = updated.systemsConfiguration!;
  const bath = cfg.roomAssignments.find((item) => item.roomId === bath1.id)!;
  const live = cfg.roomAssignments.find((item) => item.roomId === living.id)!;
  const bed = cfg.roomAssignments.find((item) => item.roomId === bed1.id)!;
  assert.equal(bed.sourceSystemIds.heating, 'gas_condensing_boiler');
  assert.equal(bath.sourceSystemIds.heating, 'gas_condensing_boiler');
  assert.equal(live.sourceSystemIds.heating, 'gas_condensing_boiler');
  assert.equal(bath.heatingSystems.length, 2);
  assert.equal(bath.servicePreferences.cooling, 'not_required');
  assert.equal(bed.coolingSystems[0]?.familyId, 'split_wall');
  assert.notEqual(bed.coolingSystems[0]?.familyId, live.coolingSystems[0]?.familyId);
});

test('systems confirmation snapshot is stable; later draft edits do not mutate snapshot', () => {
  const project = confirmedHouse();
  const bed1 = roomByName(project, 'Спальня 1');
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: ['electric_convector'],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['electric_convector'],
      servicePreferences: {
        heating: ['bathroom', 'shower', 'wc', 'laundry'].includes(room.roomType) ? 'required' : 'optional',
        cooling: 'not_required',
      },
    })),
  });
  const confirmed = confirmSystemsConfiguration(project.id);
  assert.equal(confirmed.status, 'systems_configured');
  assert.equal(confirmed.systemsConfigurationSnapshot?.configurationStatus, 'confirmed');
  assert.equal(confirmed.systemsConfigurationSnapshot?.selectedSystemFamilies[0]?.id, 'electric_convector');
  const snapshotRev = confirmed.systemsConfigurationSnapshot?.systemsRevision;

  const edited = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: ['heating_mat'],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: room.id === bed1.id ? ['heating_mat'] : ['electric_convector'],
      servicePreferences: {
        heating: ['bathroom', 'shower', 'wc', 'laundry'].includes(room.roomType) ? 'required' : 'optional',
        cooling: 'not_required',
      },
    })),
  });
  assert.equal(edited.status, 'object_confirmed');
  assert.equal(edited.systemsConfiguration?.selectedSystemFamilies[0]?.id, 'heating_mat');
  assert.equal(edited.systemsConfigurationSnapshot?.selectedSystemFamilies[0]?.id, 'electric_convector');
  assert.equal(edited.systemsConfigurationSnapshot?.systemsRevision, snapshotRev);
});

test('building revision stale-marks confirmed systems; persistence reload keeps Phase 1 object', () => {
  const project = confirmedHouse();
  const objectRevision = project.buildingRevision;
  updateSystemsConfiguration(project.id, {
    requestedService: 'heating_and_cooling',
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators', 'split_wall'],
    roomAssignments: project.rooms.map((room) => ({
      roomId: room.id,
      heatingSystems: ['bathroom', 'shower', 'wc', 'laundry'].includes(room.roomType) ? ['aluminum_radiators'] : [],
      coolingSystems: [],
      sourceSystemIds: { heating: 'gas_condensing_boiler', cooling: null },
      servicePreferences: {
        heating: ['bathroom', 'shower', 'wc', 'laundry'].includes(room.roomType) ? 'required' : 'optional',
        cooling: 'optional',
      },
    })),
  });
  const confirmed = confirmSystemsConfiguration(project.id);
  assert.equal(confirmed.systemsConfigurationSnapshot?.buildingRevisionAtConfirmation, objectRevision);

  reopenObject(project.id);
  const firstRoom = loadProject(project.id)!.rooms[0];
  updateRoom(project.id, firstRoom.id, { areaM2: 17.5 });
  const afterEdit = loadProject(project.id)!;
  assert.ok(afterEdit.buildingRevision > objectRevision);
  assert.equal(afterEdit.systemsConfiguration?.configurationStatus, 'stale');
  assert.equal(afterEdit.rooms[0].areaM2, 17.5);
  assert.equal(afterEdit.objectConfirmedSnapshot?.rooms[0].areaM2, firstRoom.areaM2);
  assert.ok(afterEdit.objectConfirmedSnapshot);
  assert.notEqual(afterEdit.buildingRevision, afterEdit.systemsConfigurationSnapshot?.buildingRevisionAtConfirmation);

  const view = getProjectView(project.id);
  assert.equal(view.systems.isStale, true);
  assert.ok(view.project.rooms.length >= 8);
});

test('phase 1 json without systems fields still loads', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER', totalAreaM2: 72 }));
  addRoom(p.id, { roomType: 'bedroom', areaM2: 14 });
  const rawPath = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  delete raw.systemsConfiguration;
  delete raw.systemsConfigurationSnapshot;
  delete raw.systemsRevision;
  delete raw.selectedSystems;
  delete raw.buildingRevision;
  fs.writeFileSync(rawPath, JSON.stringify(raw));
  const loaded = loadProject(p.id)!;
  assert.equal(loaded.rooms.length, 1);
  assert.equal(loaded.systemsConfiguration, null);
  assert.equal(loaded.buildingRevision, 1);
  assert.equal(loaded.status, 'draft');
});

test('confirm systems rejects empty selection; view exposes systems summary', () => {
  const project = confirmedHouse();
  assert.throws(() => confirmSystemsConfiguration(project.id), /Choose heating, cooling, or both|Choose at least one system family/i);
  updateSystemsConfiguration(project.id, { requestedServices: ['cooling'] });
  assert.throws(() => confirmSystemsConfiguration(project.id), /Choose at least one system family/i);
  updateSystemsConfiguration(project.id, {
    requestedServices: ['cooling'],
    selectedSystemFamilies: ['multi_split'],
  });
  const confirmed = confirmSystemsConfiguration(project.id);
  const view = getProjectView(confirmed.id);
  assert.equal(view.summary.status, 'systems_configured');
  assert.deepEqual(view.systems.requestedServices, ['cooling']);
  assert.equal(view.systems.configurationStatus, 'confirmed');
  assert.equal(view.systems.isStale, false);
});

test('batch room counters create independent rooms without requiring area', () => {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 180 }));
  setRoomTypeCount(p.id, 'bedroom', 3);
  setRoomTypeCount(p.id, 'bathroom', 2);
  setRoomTypeCount(p.id, 'living_room', 1);
  const loaded = loadProject(p.id)!;
  const beds = loaded.rooms.filter((r) => r.roomType === 'bedroom');
  assert.equal(beds.length, 3);
  assert.equal(new Set(beds.map((r) => r.id)).size, 3);
  assert.ok(beds.every((r) => r.areaM2 == null));
  assert.deepEqual(beds.map((r) => r.name), ['Спальня 1', 'Спальня 2', 'Спальня 3']);
  assert.throws(() => confirmObject(p.id), /Set area for every room/i);
  for (const room of loaded.rooms) updateRoom(p.id, room.id, { areaM2: 12 });
  const confirmed = confirmObject(p.id);
  assert.equal(confirmed.status, 'object_confirmed');
  assert.equal(confirmed.rooms.length, 6);
});

test('suggested assignment is deterministic by room purpose and does not invent loads', () => {
  const project = confirmedHouse();
  const suggested = applySuggestedSystemsConfiguration(project.id, ['heating', 'cooling']);
  const cfg = suggested.systemsConfiguration!;
  const bed = cfg.roomAssignments.find((item) => item.roomPurpose === 'bedroom')!;
  const bath = cfg.roomAssignments.find((item) => item.roomPurpose === 'bathroom')!;
  const living = cfg.roomAssignments.find((item) => item.roomPurpose === 'living_room')!;
  // Default for integrated heating+cooling: reversible HP → 2-pipe → fan coils
  assert.equal(bed.heatingSystems[0]?.familyId, 'fan_coils');
  assert.equal(bath.heatingSystems[0]?.familyId, 'hydronic_floor_heating');
  assert.equal(living.heatingSystems[0]?.familyId, 'fan_coils');
  assert.equal(bed.sourceSystemIds.heating, 'reversible_air_to_water_heat_pump');
  assert.equal(bed.sourceSystemIds.cooling, 'reversible_air_to_water_heat_pump');
  assert.equal(cfg.architecture.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(cfg.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(cfg.architecture.distribution.simultaneousHeatCool, false);
  assert.equal(cfg.architecture.simultaneousHeatCoolSupported, false);
  assert.equal((cfg as any).requiredPowerKw, undefined);
});

test('bulk assignment targets only intended rooms and empty source does not wipe others', () => {
  const project = confirmedHouse();
  const bed1 = roomByName(project, 'Спальня 1');
  const bed2 = roomByName(project, 'Спальня 2');
  const bed3 = roomByName(project, 'Спальня 3');
  const kitchen = roomByName(project, 'Кухня 1');
  const bath1 = roomByName(project, 'Ванная 1');
  const living = roomByName(project, 'Гостиная 1');
  const seeded = applySuggestedSystemsConfiguration(project.id, ['heating', 'cooling']);
  const kitchenBefore = seeded.systemsConfiguration!.roomAssignments.find((item) => item.roomId === kitchen.id)!;

  const afterEmpty = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    roomAssignments: seeded.systemsConfiguration!.roomAssignments,
    bulk: { sourceRoomId: 'missing-room', target: 'all_rooms' },
  });
  assert.equal(
    afterEmpty.systemsConfiguration!.roomAssignments.find((item) => item.roomId === kitchen.id)?.heatingSystems[0]?.familyId,
    kitchenBefore.heatingSystems[0]?.familyId,
  );

  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'steel_panel_radiators', 'cassette_ac', 'hydronic_floor_heating'],
    roomAssignments: afterEmpty.systemsConfiguration!.roomAssignments.map((item) => (
      item.roomId === bed1.id
        ? { ...item, heatingSystems: ['steel_panel_radiators'], coolingSystems: ['cassette_ac'] }
        : item
    )),
  });
  const afterBeds = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    bulk: { sourceRoomId: bed1.id, target: 'bedrooms' },
  });
  const beds = afterBeds.systemsConfiguration!.roomAssignments.filter((item) => [bed1.id, bed2.id, bed3.id].includes(item.roomId));
  assert.ok(beds.every((item) => item.heatingSystems[0]?.familyId === 'steel_panel_radiators'));
  assert.ok(beds.every((item) => item.coolingSystems[0]?.familyId === 'cassette_ac'));
  assert.equal(afterBeds.systemsConfiguration!.roomAssignments.find((item) => item.roomId === kitchen.id)?.heatingSystems[0]?.familyId, kitchenBefore.heatingSystems[0]?.familyId);

  const afterWet = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'steel_panel_radiators', 'cassette_ac', 'hydronic_floor_heating', 'fan_coils', 'split_wall'],
    roomAssignments: afterBeds.systemsConfiguration!.roomAssignments.map((item) => (
      item.roomId === bath1.id
        ? { ...item, heatingSystems: ['heating_mat'], servicePreferences: { heating: 'required', cooling: 'not_required' }, coolingSystems: [] }
        : item
    )),
    bulk: { sourceRoomId: bath1.id, target: 'wet_rooms' },
  });
  const baths = afterWet.systemsConfiguration!.roomAssignments.filter((item) => item.roomPurpose === 'bathroom');
  assert.ok(baths.every((item) => item.heatingSystems[0]?.familyId === 'heating_mat'));
  assert.equal(afterWet.systemsConfiguration!.roomAssignments.find((item) => item.roomId === living.id)?.heatingSystems[0]?.familyId, 'fan_coils');

  const afterAll = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    bulk: { sourceRoomId: bed1.id, target: 'all_rooms' },
  });
  assert.ok(afterAll.systemsConfiguration!.roomAssignments.every((item) => item.roomId === bed1.id || item.heatingSystems[0]?.familyId === 'steel_panel_radiators'));

  const reloaded = loadProject(project.id)!;
  assert.equal(reloaded.systemsConfiguration!.roomAssignments.find((item) => item.roomId === bed2.id)?.heatingSystems[0]?.familyId, 'steel_panel_radiators');
  assert.equal(reloaded.rooms.length, project.rooms.length);
});

test('architecture default family ids for integrated heating+cooling use reversible heat pump', () => {
  const ids = defaultFamilyIdsForServices(['heating', 'cooling']);
  assert.ok(ids.includes('reversible_air_to_water_heat_pump'), 'reversible heat pump must be default for integrated heating+cooling');
  assert.ok(!ids.includes('gas_condensing_boiler'), 'gas boiler must NOT be default for integrated heating+cooling');
  assert.ok(ids.includes('fan_coils'), 'fan_coils must be default terminal');
});

test('architecture: heating+cooling default builds reversible HP -> 2-pipe -> fan coils', () => {
  const ids = defaultFamilyIdsForServices(['heating', 'cooling']);
  const families = ids.map((id) => SYSTEM_FAMILIES.find((f) => f.id === id)).filter(Boolean) as any[];
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], families);
  assert.equal(arch.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(arch.spaceHeatingSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(arch.spaceCoolingSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(arch.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(arch.distribution.circuitKind, '2pipe');
  assert.equal(arch.distribution.simultaneousHeatCool, false);
  assert.equal(arch.simultaneousHeatCoolSupported, false);
  assert.equal(arch.dhw.status, 'not_configured');
  assert.equal(arch.dhw.sourceFamilyId, null);
});

test('architecture: 2-pipe distribution sets simultaneousHeatCool=false and architecture unsupported', () => {
  const families = SYSTEM_FAMILIES.filter((f) => ['reversible_air_to_water_heat_pump', 'fan_coils'].includes(f.id));
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], families);
  assert.equal(arch.distribution.circuitKind, '2pipe');
  assert.equal(arch.distribution.simultaneousHeatCool, false);
  assert.equal(arch.simultaneousHeatCoolSupported, false);
  assert.ok(arch.warnings.some((w) => /2-трубн/.test(w)));
});

test('architecture: gas boiler + independent DX has simultaneousHeatCoolSupported=true', () => {
  const families = SYSTEM_FAMILIES.filter((f) => ['gas_condensing_boiler', 'aluminum_radiators', 'split_wall'].includes(f.id));
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], families);
  assert.equal(arch.distribution.id, 'hybrid_hydronic_plus_dx');
  assert.equal(arch.distribution.simultaneousHeatCool, true);
  assert.equal(arch.simultaneousHeatCoolSupported, true);
  assert.equal(arch.spaceHeatingSourceId, 'gas_condensing_boiler');
  assert.equal(arch.spaceCoolingSourceId, 'split_wall');
});

test('architecture: gas boiler is valid for heating-only but not default for integrated', () => {
  const heatingOnly = defaultFamilyIdsForServices(['heating']);
  assert.ok(heatingOnly.includes('gas_condensing_boiler'), 'gas boiler should be default for heating-only');

  const integrated = defaultFamilyIdsForServices(['heating', 'cooling']);
  assert.ok(!integrated.includes('gas_condensing_boiler'), 'gas boiler must NOT be in integrated default');
  assert.ok(integrated.includes('reversible_air_to_water_heat_pump'), 'reversible HP must be in integrated default');
});

test('architecture: solution_template heat_pump_air_to_water_fan_coils is not_yet_verified and not default', () => {
  const template = SYSTEM_FAMILIES.find((f) => f.id === 'heat_pump_air_to_water_fan_coils');
  assert.ok(template, 'template must exist');
  assert.equal(template?.capabilityStatus, 'not_yet_verified');
  assert.equal(template?.kind, 'solution_template');

  const ids = defaultFamilyIdsForServices(['heating', 'cooling']);
  assert.ok(!ids.includes('heat_pump_air_to_water_fan_coils'), 'not_yet_verified template must not be in default');

  const families = ids.map((id) => SYSTEM_FAMILIES.find((f) => f.id === id)).filter(Boolean) as any[];
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], families);
  assert.equal(arch.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
});

test('architecture: heating-only uses hydronic heating only distribution', () => {
  const families = SYSTEM_FAMILIES.filter((f) => ['gas_condensing_boiler', 'aluminum_radiators'].includes(f.id));
  const arch = buildArchitectureFromSelection(['heating'], families);
  assert.equal(arch.spaceHeatingSourceId, 'gas_condensing_boiler');
  assert.equal(arch.spaceCoolingSourceId, null);
  assert.equal(arch.distribution.id, 'hydronic_heating_only');
  assert.equal(arch.distribution.circuitKind, 'none');
  assert.equal(arch.distribution.simultaneousHeatCool, false);
  assert.equal(arch.simultaneousHeatCoolSupported, false);
});

test('architecture: DHW remains not_configured with null source even when heating+cooling', () => {
  const families = SYSTEM_FAMILIES.filter((f) => ['reversible_air_to_water_heat_pump', 'fan_coils'].includes(f.id));
  const arch = buildArchitectureFromSelection(['heating', 'cooling'], families);
  assert.equal(arch.dhw.status, 'not_configured');
  assert.equal(arch.dhw.sourceFamilyId, null);
});

test('architecture: legacy saved project without architecture hydrates safely', () => {
  const project = confirmedHouse();
  const rawPath = path.join(STORE, `${project.id}.json`);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  // Remove architecture from systemsConfiguration
  if (raw.systemsConfiguration) {
    delete raw.systemsConfiguration.architecture;
  }
  fs.writeFileSync(rawPath, JSON.stringify(raw));

  // Set systems config without architecture
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
  });

  const loaded = loadProject(project.id)!;
  const cfg = loaded.systemsConfiguration!;
  assert.ok(cfg);
  assert.ok(cfg.architecture, 'architecture should be built during normalization');
  assert.equal(cfg.architecture.spaceCombinedSourceId, 'reversible_air_to_water_heat_pump');
  assert.equal(cfg.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
});

function confirmedCommercial() {
  const p = track(createProject({ objectType: 'commercial', totalAreaM2: 300 }));
  addRoom(p.id, { roomType: 'commercial_office', areaM2: 40 });
  return confirmObject(p.id);
}

test('simultaneousHeatCoolRequired vs Supported: the four validation cases', () => {
  // A: required=false supported=false -> PASS (normal residential 2-pipe)
  assert.equal(simultaneousHeatCoolSatisfied(false, false), true);
  // B: required=true supported=false -> BLOCKED
  assert.equal(simultaneousHeatCoolSatisfied(true, false), false);
  // C: required=true supported=true -> PASS
  assert.equal(simultaneousHeatCoolSatisfied(true, true), true);
  // D: required=false supported=true -> PASS (extra capability, not required)
  assert.equal(simultaneousHeatCoolSatisfied(false, true), true);
});

test('heating+cooling request does not imply simultaneous requirement', () => {
  const project = confirmedHouse();
  const updated = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
  });
  assert.equal(updated.systemsConfiguration?.simultaneousHeatCoolRequired, false);
  assert.equal(updated.systemsConfiguration?.architecture.simultaneousHeatCoolSupported, false);
  assert.equal(updated.systemsConfiguration?.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
});

test('commercial default stays seasonal 2-pipe and does not require simultaneous', () => {
  const project = confirmedCommercial();
  const updated = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
  });
  const cfg = updated.systemsConfiguration!;
  assert.equal(cfg.simultaneousHeatCoolRequired, false);
  assert.equal(cfg.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(cfg.architecture.distribution.simultaneousHeatCool, false);
  assert.equal(cfg.architecture.simultaneousHeatCoolSupported, false);
});

test('commercial explicit simultaneous requirement on 2-pipe is blocked on confirm', () => {
  const project = confirmedCommercial();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    simultaneousHeatCoolRequired: true,
  });
  const cfg = loadProject(project.id)!.systemsConfiguration!;
  assert.equal(cfg.simultaneousHeatCoolRequired, true);
  assert.equal(cfg.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
  assert.equal(cfg.architecture.simultaneousHeatCoolSupported, false);
  assert.ok(cfg.warnings.some((w) => /одновременн/i.test(w)), 'should warn about incompatible architecture');
  assert.throws(
    () => confirmSystemsConfiguration(project.id),
    (err: any) => err?.code === 'building.systems_incompatible_architecture',
  );
});

test('commercial explicit simultaneous requirement with 4-pipe architecture passes', () => {
  const project = confirmedCommercial();
  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    simultaneousHeatCoolRequired: true,
    architecture: {
      distribution: {
        id: 'hydronic_4pipe_heating_cooling',
        label: '4-трубная гидравлика отопления/охлаждения',
        circuitKind: '4pipe',
        simultaneousHeatCool: true,
        notes: [],
      },
    },
  });
  const cfg = loadProject(project.id)!.systemsConfiguration!;
  assert.equal(cfg.architecture.distribution.id, 'hydronic_4pipe_heating_cooling');
  assert.equal(cfg.architecture.distribution.circuitKind, '4pipe');
  assert.equal(cfg.architecture.distribution.simultaneousHeatCool, true);
  assert.equal(cfg.architecture.simultaneousHeatCoolSupported, true);
  const confirmed = confirmSystemsConfiguration(project.id);
  assert.equal(confirmed.status, 'systems_configured');
});

test('DHW stays independent: heating+cooling source does not populate DHW source', () => {
  const project = confirmedHouse();
  const updated = updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
  });
  const cfg = updated.systemsConfiguration!;
  assert.equal(cfg.architecture.dhw.status, 'not_configured');
  assert.equal(cfg.architecture.dhw.sourceFamilyId, null);
  assert.notEqual(cfg.architecture.dhw.sourceFamilyId, cfg.architecture.spaceCombinedSourceId);
});

test('legacy project missing simultaneousHeatCoolRequired normalizes to false', () => {
  const project = confirmedHouse();
  const rawPath = path.join(STORE, `${project.id}.json`);

  updateSystemsConfiguration(project.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
  });

  // Simulate a project saved before the requirement field existed.
  const withConfig = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  if (withConfig.systemsConfiguration) {
    delete withConfig.systemsConfiguration.simultaneousHeatCoolRequired;
  }
  fs.writeFileSync(rawPath, JSON.stringify(withConfig));

  const loaded = loadProject(project.id)!;
  assert.equal(loaded.systemsConfiguration?.simultaneousHeatCoolRequired, false);
  assert.equal(loaded.systemsConfiguration?.architecture.distribution.id, 'hydronic_2pipe_heating_cooling');
});
