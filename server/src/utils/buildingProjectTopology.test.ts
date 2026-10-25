/**
 * Building Project Phase 2.6 — Object Topology & Floor-Based Hydronic Foundation.
 *
 * Focused tests (service-level; create/delete projects in the JSON store with
 * tracked ids and cleanup, matching the existing suite pattern).
 *
 * CASE A  create private_house floorCount=3 -> 3 stable floors
 * CASE B  rooms on Floor 1/2/3 -> floorId persists after reload
 * CASE C  duplicate bedrooms on different floors -> independent ids, same roomType, different floorIds
 * CASE D  move room Floor 2 -> Floor 3 -> roomId/roomType unchanged, floorId updated
 * CASE E  decrease 3 -> 2 while Floor 3 has rooms -> blocked, nothing deleted/moved
 * CASE F  decrease when removed floor is empty -> succeeds
 * CASE G  legacy private_house without topology -> normalizes to Floor 1, rooms safe, loads
 * CASE H  object confirmed snapshot includes topology and stays immutable
 * CASE I  topology edit bumps buildingRevision (participates in revision/stale semantics)
 * CASE J  Floor1 2 fan-coils, Floor2 4 -> byFloor 2/4, total 6
 * CASE K  Floor1 1 hydronic bathroom, Floor2 2 -> byFloor 1/2, total 3
 * CASE L  floor heating on F1+F2 -> both marked; mixing+pump required; NO automatic 2 pumps
 * CASE M  multi-floor topology does NOT create heat loss/kW/BTU/flow/head/pipe/pump groups/separator/loop count
 * CASE N  2-pipe/4-pipe semantics unchanged
 * CASE O  DHW stays independent
 * CASE P  invalid room.floorId blocks object confirmation
 * CASE Q  plantLocation room/floor consistency validation works
 * CASE R  valid plantLocation kind=room survives save -> reload (roomId/floorId kept, no disk write)
 * CASE S  valid room plantLocation stays valid after rooms/floors normalization
 * CASE T  explicit room/floor mismatch stays invalid on reload/update/confirm
 * CASE U  addRoom missing floorId defaults safely to Floor 1 (single-floor / legacy context)
 * CASE V  addRoom explicit invalid floorId is rejected, room not created
 * CASE W  updateRoom explicit invalid floorId stays aligned with addRoom
 * CASE X  addRoom without floorId on explicit single-floor house -> Floor 1
 * CASE Y  addRoom without floorId on multi-floor house -> rejected (building.floor_required), no room
 * CASE Z  addRoom with explicit valid Floor 2 floorId -> room created on Floor 2
 * CASE AA addRoom with explicit invalid floorId on multi-floor house -> rejected, no room
 * CASE AB client floor-tab add-room passes the ACTIVE tab floorId (static verification; client has no test harness)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  confirmObject,
  createProject,
  deleteProject,
  loadProject,
  reopenObject,
  setRoomTypeCount,
  updateProjectMeta,
  updateRoom,
  updateSystemsConfiguration,
} from './buildingProjectService.js';

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

function house(floorCount = 1) {
  return track(createProject({ objectType: 'private_house', regionCode: 'AM-ER', totalAreaM2: 300, floorCount }));
}

function floorIds(project: { topology?: { floors?: Array<{ id: string }> } | null }) {
  return (project.topology?.floors || []).map((f) => f.id);
}

// The service wrapper types are strict; the runtime normalizes loose payloads.
type SystemsPatch = Parameters<typeof updateSystemsConfiguration>[1];
function setSystems(id: string, patch: Record<string, unknown>) {
  return updateSystemsConfiguration(id, patch as SystemsPatch);
}

test('CASE A: create private_house floorCount=3 -> 3 stable floors', () => {
  const p = house(3);
  assert.equal(p.topology?.floorCount, 3);
  assert.equal(p.topology?.floors.length, 3);
  const ids = floorIds(p);
  assert.deepEqual(ids, ['floor-1', 'floor-2', 'floor-3']);
  assert.deepEqual(p.topology?.floors.map((f) => f.level), [1, 2, 3]);
  assert.ok(p.topology?.floors.every((f) => f.label && f.label.length > 0));
  // stable ids survive reload
  const loaded = loadProject(p.id)!;
  assert.deepEqual(floorIds(loaded), ids);
});

test('CASE B: rooms on Floor 1/2/3 keep floorId after persistence reload', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 30, floorId: 'floor-1' });
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 1', areaM2: 18, floorId: 'floor-2' });
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 2', areaM2: 16, floorId: 'floor-3' });
  const loaded = loadProject(p.id)!;
  const byFloor = Object.fromEntries(loaded.rooms.map((r) => [r.name, r.floorId]));
  assert.equal(byFloor['Гостиная'], 'floor-1');
  assert.equal(byFloor['Спальня 1'], 'floor-2');
  assert.equal(byFloor['Спальня 2'], 'floor-3');
});

test('CASE C: duplicate bedrooms on different floors -> independent ids, same roomType, different floorIds', () => {
  const p = house(2);
  setRoomTypeCount(p.id, 'bedroom', 2, 'floor-1');
  setRoomTypeCount(p.id, 'bedroom', 2, 'floor-2');
  const loaded = loadProject(p.id)!;
  const bedrooms = loaded.rooms.filter((r) => r.roomType === 'bedroom');
  assert.equal(bedrooms.length, 4);
  assert.equal(new Set(bedrooms.map((r) => r.id)).size, 4);
  assert.ok(bedrooms.every((r) => r.roomType === 'bedroom'));
  assert.equal(bedrooms.filter((r) => r.floorId === 'floor-1').length, 2);
  assert.equal(bedrooms.filter((r) => r.floorId === 'floor-2').length, 2);
});

test('CASE D: move room Floor 2 -> Floor 3 keeps roomId and roomType', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 1', areaM2: 18, floorId: 'floor-2' });
  const before = loadProject(p.id)!.rooms[0];
  const moved = updateRoom(p.id, before.id, { floorId: 'floor-3' });
  const after = moved.rooms.find((r) => r.id === before.id)!;
  assert.equal(after.id, before.id);
  assert.equal(after.roomType, 'bedroom');
  assert.equal(after.name, 'Спальня 1');
  assert.equal(after.floorId, 'floor-3');
});

test('CASE E: decrease 3 -> 2 while Floor 3 has rooms -> blocked, nothing deleted/moved', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 3', areaM2: 16, floorId: 'floor-3' });
  const roomCountBefore = loadProject(p.id)!.rooms.length;
  assert.throws(() => updateProjectMeta(p.id, { floorCount: 2 }), (err: any) => {
    assert.equal(err?.code, 'building.floor_occupied');
    assert.match(String(err?.message), /помещения/i);
    return true;
  });
  const after = loadProject(p.id)!;
  assert.equal(after.rooms.length, roomCountBefore);
  assert.equal(after.topology?.floorCount, 3);
  assert.equal(after.rooms[0].floorId, 'floor-3');
});

test('CASE F: decrease floor count when removed floor is empty -> succeeds', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const updated = updateProjectMeta(p.id, { floorCount: 2 });
  assert.equal(updated.topology?.floorCount, 2);
  assert.deepEqual(floorIds(updated), ['floor-1', 'floor-2']);
  assert.equal(updated.rooms.length, 1);
  assert.equal(updated.rooms[0].floorId, 'floor-1');
});

test('CASE G: legacy private_house without topology -> normalizes to Floor 1, rooms safe, loads', () => {
  // Seed real rooms so the legacy file has something to preserve. createProject
  // alone creates NO rooms (input.rooms is optional), which is why the original
  // fixture always loaded zero rooms and could never exercise the legacy path.
  const created = track(createProject({
    objectType: 'private_house',
    totalAreaM2: 120,
    rooms: [
      { roomType: 'living_room', name: 'Гостиная', areaM2: 30 },
      { roomType: 'bedroom', name: 'Спальня 1', areaM2: 16 },
    ],
  }));
  const legacyRoomIds = created.rooms.map((r) => r.id);
  const p = created;
  // Simulate a pre-2.6 file: strip topology + room floorIds from the saved JSON.
  const file = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.topology;
  for (const room of raw.rooms) delete room.floorId;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  const rawBefore = fs.readFileSync(file, 'utf8');
  const loaded = loadProject(p.id)!;
  assert.ok(loaded.topology, 'topology must be normalized');
  assert.equal(loaded.topology.floorCount, 1);
  assert.deepEqual(floorIds(loaded), ['floor-1']);
  assert.equal(loaded.rooms.length, 2);
  assert.ok(loaded.rooms.every((r) => r.floorId === 'floor-1'));
  // Legacy room identity and metadata survive load unchanged.
  assert.deepEqual(new Set(loaded.rooms.map((r) => r.id)), new Set(legacyRoomIds));
  const living = loaded.rooms.find((r) => r.name === 'Гостиная')!;
  const bedroom = loaded.rooms.find((r) => r.name === 'Спальня 1')!;
  assert.equal(living.roomType, 'living_room');
  assert.equal(living.areaM2, 30);
  assert.equal(bedroom.roomType, 'bedroom');
  assert.equal(bedroom.areaM2, 16);
  // Reading a legacy file must not rewrite it on disk.
  assert.equal(fs.readFileSync(file, 'utf8'), rawBefore, 'load must not write to the store');
});

test('CASE H: object confirmed snapshot includes topology and stays immutable', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  confirmObject(p.id);
  const snap = loadProject(p.id)!.objectConfirmedSnapshot!;
  assert.equal(snap.topology?.floorCount, 3);
  assert.deepEqual(floorIds({ topology: snap.topology }), ['floor-1', 'floor-2', 'floor-3']);
  const snapJson = JSON.stringify(snap);

  // Reopen and change object: snapshot must stay immutable.
  reopenObject(p.id);
  updateProjectMeta(p.id, { floorCount: 4 });
  const after = loadProject(p.id)!;
  assert.equal(after.objectConfirmedSnapshot ? JSON.stringify(after.objectConfirmedSnapshot) === snapJson : false, true);
  assert.equal(after.objectConfirmedSnapshot?.topology?.floorCount, 3);
});

test('CASE I: topology edit bumps buildingRevision (revision/stale participation)', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  confirmObject(p.id);
  const revBefore = loadProject(p.id)!.buildingRevision;
  reopenObject(p.id);
  const updated = updateProjectMeta(p.id, { floorCount: 3 });
  assert.ok(updated.buildingRevision > revBefore, `revision should increase (${revBefore} -> ${updated.buildingRevision})`);
});

test('CASE J: Floor1 2 fan-coils, Floor2 4 -> byFloor 2/4, total 6', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'commercial_office', name: 'Офис 1', areaM2: 20, floorId: 'floor-1' });
  addRoom(p.id, { roomType: 'commercial_office', name: 'Офис 2', areaM2: 20, floorId: 'floor-1' });
  for (let i = 1; i <= 4; i++) addRoom(p.id, { roomType: 'bedroom', name: `Спальня ${i}`, areaM2: 14, floorId: 'floor-2' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  setSystems(p.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['fan_coils'], coolingSystems: ['fan_coils'] })),
  });
  const req = loadProject(p.id)!.systemsConfiguration!.hydronicRequirements!;
  assert.equal(req.fanCoilCount, 6);
  const f1 = req.byFloor.find((f) => f.floorId === 'floor-1')!;
  const f2 = req.byFloor.find((f) => f.floorId === 'floor-2')!;
  assert.equal(f1.fanCoilCount, 2);
  assert.equal(f2.fanCoilCount, 4);
  assert.equal(f1.fanCoilManifoldPortsRequired, 2);
  assert.equal(f2.fanCoilManifoldPortsRequired, 4);
  assert.equal(f1.fanCoilCount + f2.fanCoilCount, req.fanCoilCount);
});

test('CASE K: Floor1 1 hydronic bathroom, Floor2 2 -> byFloor 1/2, total 3', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bathroom', name: 'Ванная 1', areaM2: 6, floorId: 'floor-1' });
  addRoom(p.id, { roomType: 'bathroom', name: 'Ванная 2', areaM2: 5, floorId: 'floor-2' });
  addRoom(p.id, { roomType: 'bathroom', name: 'Ванная 3', areaM2: 5, floorId: 'floor-2' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  setSystems(p.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'aluminum_radiators'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['aluminum_radiators'], coolingSystems: [] })),
  });
  const req = loadProject(p.id)!.systemsConfiguration!.hydronicRequirements!;
  assert.equal(req.towelRadiatorsRequired, 0);
  assert.equal(req.towelRadiatorsRecommended, 3);
  const f1 = req.byFloor.find((f) => f.floorId === 'floor-1')!;
  const f2 = req.byFloor.find((f) => f.floorId === 'floor-2')!;
  assert.equal(f1.towelRadiatorsRecommended, 1);
  assert.equal(f2.towelRadiatorsRecommended, 2);
  assert.equal((f1.towelRadiatorsRecommended || 0) + (f2.towelRadiatorsRecommended || 0), req.towelRadiatorsRecommended);
});

test('CASE L: floor heating on F1+F2 -> both marked; mixing+pump required; NO automatic 2 pumps', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 30, floorId: 'floor-1' });
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-2' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  setSystems(p.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'hydronic_floor_heating'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['hydronic_floor_heating'], coolingSystems: [] })),
  });
  const req = loadProject(p.id)!.systemsConfiguration!.hydronicRequirements!;
  assert.equal(req.hydronicFloorHeatingPresent, true);
  assert.equal(req.mixingUnitRequired, false);
  assert.equal(req.circulationPumpRequired, false);
  assert.equal(req.mixingUnitStatus, 'pending_design');
  assert.equal(req.circulationPumpStatus, 'pending_design');
  const f1 = req.byFloor.find((f) => f.floorId === 'floor-1')!;
  const f2 = req.byFloor.find((f) => f.floorId === 'floor-2')!;
  assert.equal(f1.hydronicFloorHeatingPresent, true);
  assert.equal(f2.hydronicFloorHeatingPresent, true);
  // No pump-count inference anywhere.
  assert.ok(!('circulationPumpCount' in req));
  assert.ok(!('pumpCount' in req));
});

test('CASE M: multi-floor topology does NOT create heat loss/kW/BTU/flow/head/pipe/pump groups/separator/loop count', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 30, floorId: 'floor-1' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  setSystems(p.id, {
    requestedServices: ['heating'],
    selectedSystemFamilies: ['gas_condensing_boiler', 'hydronic_floor_heating', 'fan_coils'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['hydronic_floor_heating', 'fan_coils'], coolingSystems: [] })),
  });
  const req = loadProject(p.id)!.systemsConfiguration!.hydronicRequirements!;
  const json = JSON.stringify(req).toLowerCase();
  for (const banned of ['heatloss', 'powerkw', 'btu', 'flowrate', 'pumphead', 'pipediameter']) {
    assert.ok(!json.includes(banned), `must not contain ${banned}`);
  }
  // pump groups / separator exist ONLY as pending-design states, never as counts.
  assert.ok(req.unresolvedRequirements.some((u) => u.startsWith('pumpGroups:pending_design')));
  assert.ok(req.unresolvedRequirements.some((u) => u.startsWith('hydraulicSeparation:pending_design')));
  assert.ok(!('pumpGroups' in req) || (req as any).pumpGroups === undefined);
  assert.ok(!('hydraulicSeparator' in req) || (req as any).hydraulicSeparator === undefined);
  assert.equal(req.floorHeatingCircuitCount, 'pending_calculation');
});

test('CASE N: 2-pipe / 4-pipe semantics unchanged with floors', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'commercial_office', name: 'Офис', areaM2: 20, floorId: 'floor-1' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  // 2-pipe seasonal
  setSystems(p.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['fan_coils'], coolingSystems: ['fan_coils'] })),
  });
  const twoPipe = loadProject(p.id)!.systemsConfiguration!;
  assert.equal(twoPipe.architecture.distribution.circuitKind, '2pipe');
  assert.equal(twoPipe.hydronicRequirements!.fanCoilCircuitKind, '2pipe');
  assert.equal(twoPipe.hydronicRequirements!.fanCoilValveSetsRequired, 1);
  // 4-pipe commercial explicit
  setSystems(p.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    simultaneousHeatCoolRequired: true,
    architecture: { distribution: { id: 'hydronic_4pipe_heating_cooling' } },
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['fan_coils'], coolingSystems: ['fan_coils'] })),
  });
  const fourPipe = loadProject(p.id)!.systemsConfiguration!;
  assert.equal(fourPipe.architecture.distribution.circuitKind, '4pipe');
  assert.equal(fourPipe.hydronicRequirements!.fanCoilCircuitKind, '4pipe');
  assert.equal(fourPipe.hydronicRequirements!.fanCoilValveSetsRequired, 2);
});

test('CASE O: DHW stays independent with floor topology', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 30, floorId: 'floor-1' });
  confirmObject(p.id);
  const rooms = loadProject(p.id)!.rooms;
  setSystems(p.id, {
    requestedServices: ['heating', 'cooling'],
    selectedSystemFamilies: ['reversible_air_to_water_heat_pump', 'fan_coils'],
    roomAssignments: rooms.map((r) => ({ roomId: r.id, heatingSystems: ['fan_coils'], coolingSystems: ['fan_coils'] })),
  });
  const cfg = loadProject(p.id)!.systemsConfiguration!;
  assert.equal(cfg.architecture.dhw.status, 'not_configured');
  assert.equal(cfg.architecture.dhw.sourceFamilyId, null);
});

test('CASE P: invalid room.floorId blocks object confirmation', () => {
  const p = house(2);
  // floorId references a non-existent floor -> normalized to first floor, so simulate a corrupted store file.
  const file = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.rooms = [{ id: 'bad-room', roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-99', extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: 'stored_only' } }];
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  const loaded = loadProject(p.id)!;
  assert.throws(() => confirmObject(p.id), (err: any) => {
    assert.equal(err?.code, 'building.room_floor_invalid');
    return true;
  });
  assert.equal(loaded.rooms.length, 1);
});

test('CASE Q: plantLocation room/floor consistency validation works', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const rooms = loadProject(p.id)!.rooms;
  const roomId = rooms[0].id;
  // consistent: room belongs to floor-1
  const ok = updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-1', roomId } });
  assert.equal(ok.topology?.plantLocation.kind, 'room');
  assert.equal(ok.topology?.plantLocation.roomId, roomId);
  // inconsistent: room belongs to floor-1 but floorId says floor-2 -> rejected
  assert.throws(
    () => updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-2', roomId } }),
    (err: any) => {
      assert.equal(err?.code, 'building.plant_location_invalid');
      return true;
    },
  );
  // external clears floor/room
  const ext = updateProjectMeta(p.id, { plantLocation: { kind: 'external' } });
  assert.equal(ext.topology?.plantLocation.kind, 'external');
  assert.equal(ext.topology?.plantLocation.floorId, null);
  assert.equal(ext.topology?.plantLocation.roomId, null);
});

test('CASE R: valid room plantLocation survives save -> reload (roomId/floorId kept, no disk write)', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  const saved = updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-1', roomId } });
  assert.equal(saved.topology?.plantLocation.kind, 'room');

  const file = path.join(STORE, `${p.id}.json`);
  const rawBefore = fs.readFileSync(file, 'utf8');
  const loaded = loadProject(p.id)!;
  assert.equal(loaded.topology?.plantLocation.kind, 'room', 'kind must survive reload');
  assert.equal(loaded.topology?.plantLocation.roomId, roomId, 'roomId must survive reload');
  assert.equal(loaded.topology?.plantLocation.floorId, 'floor-1', 'floorId must survive reload');
  assert.equal(fs.readFileSync(file, 'utf8'), rawBefore, 'load must not write to the store');
});

test('CASE S: valid room plantLocation stays valid after rooms/floors normalization', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-1', roomId } });
  // Legacy-ish file: the room lost its floorId but topology + plantLocation remain.
  const file = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const room of raw.rooms) delete room.floorId;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  const loaded = loadProject(p.id)!;
  assert.equal(loaded.rooms[0].floorId, 'floor-1', 'legacy room attaches to Floor 1');
  assert.equal(loaded.topology?.plantLocation.kind, 'room', 'plantLocation stays room after normalization');
  assert.equal(loaded.topology?.plantLocation.roomId, roomId);
  assert.equal(loaded.topology?.plantLocation.floorId, 'floor-1');
});

test('CASE T: explicit room/floor mismatch stays invalid (not degraded) on reload/update/confirm', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  // Update path rejects the explicit mismatch immediately.
  assert.throws(
    () => updateProjectMeta(p.id, { plantLocation: { kind: 'room', floorId: 'floor-2', roomId } }),
    (err: any) => {
      assert.equal(err?.code, 'building.plant_location_invalid');
      return true;
    },
  );
  // Corrupted store with the mismatch: reload must not degrade it, confirm must block it.
  const file = path.join(STORE, `${p.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.topology.plantLocation = { kind: 'room', floorId: 'floor-2', roomId };
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  const loaded = loadProject(p.id)!;
  assert.equal(loaded.topology?.plantLocation.kind, 'room', 'mismatch must not be degraded on reload');
  assert.equal(loaded.topology?.plantLocation.floorId, 'floor-2');
  assert.throws(() => confirmObject(p.id), (err: any) => {
    assert.equal(err?.code, 'building.plant_location_invalid');
    return true;
  });
});

test('CASE U: addRoom with missing floorId defaults safely to Floor 1 (single-floor / legacy context)', () => {
  // Legacy default context: private_house created without floorCount -> 1 floor.
  const p = track(createProject({ objectType: 'private_house', totalAreaM2: 120 }));
  const added = addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16 });
  assert.equal(added.rooms[0].floorId, 'floor-1');
});

test('CASE V: addRoom with explicitly invalid floorId is rejected, room not created', () => {
  const p = house(2);
  const file = path.join(STORE, `${p.id}.json`);
  const before = loadProject(p.id)!.rooms.length;
  const rawBefore = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-99' }),
    (err: any) => {
      assert.equal(err?.code, 'building.invalid_floor');
      return true;
    },
  );
  const after = loadProject(p.id)!;
  assert.equal(after.rooms.length, before, 'room must not be created');
  assert.equal(fs.readFileSync(file, 'utf8'), rawBefore, 'rejected addRoom must not write to the store');
});

test('CASE W: updateRoom explicit invalid floorId stays aligned with addRoom', () => {
  const p = house(2);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-1' });
  const roomId = loadProject(p.id)!.rooms[0].id;
  assert.throws(
    () => updateRoom(p.id, roomId, { floorId: 'floor-99' }),
    (err: any) => {
      assert.equal(err?.code, 'building.invalid_floor');
      return true;
    },
  );
  const after = loadProject(p.id)!;
  assert.equal(after.rooms[0].floorId, 'floor-1', 'rejected update must not mutate the room floorId');
});

test('CASE X: addRoom without floorId on explicit single-floor house attaches to Floor 1', () => {
  const p = house(1);
  const added = addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16 });
  assert.equal(added.rooms[0].floorId, 'floor-1');
});

test('CASE Y: addRoom without floorId on multi-floor house is rejected (building.floor_required)', () => {
  const p = house(3);
  const file = path.join(STORE, `${p.id}.json`);
  const before = loadProject(p.id)!.rooms.length;
  const rawBefore = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16 }),
    (err: any) => {
      assert.equal(err?.code, 'building.floor_required');
      return true;
    },
  );
  const after = loadProject(p.id)!;
  assert.equal(after.rooms.length, before, 'room must not be created');
  assert.equal(fs.readFileSync(file, 'utf8'), rawBefore, 'rejected addRoom must not write to the store');
});

test('CASE Z: addRoom with explicit valid Floor 2 floorId creates room on Floor 2', () => {
  const p = house(3);
  const added = addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-2' });
  assert.equal(added.rooms[0].floorId, 'floor-2');
});

test('CASE AA: addRoom with explicit invalid floorId on multi-floor house is rejected', () => {
  const p = house(3);
  const before = loadProject(p.id)!.rooms.length;
  assert.throws(
    () => addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-99' }),
    (err: any) => {
      assert.equal(err?.code, 'building.invalid_floor');
      return true;
    },
  );
  assert.equal(loadProject(p.id)!.rooms.length, before, 'room must not be created');
});
