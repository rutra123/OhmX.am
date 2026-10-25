/**
 * Building-wide answers entered in one room are reused for the other rooms:
 * only empty fields are filled, never explicit answers; room-specific facts are not copied.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  propagateAirtightness,
  propagateBoundaryTier,
  propagateSpaceAbove,
  propagateSpaceBelow,
  propagateWallTier,
  sameLevelRooms,
} from '../src/features/buildingProject/utils/roomPropagation';
import type { BuildingProject, BuildingRoom } from '../src/features/buildingProject/types';

function room(id: string, over: Partial<BuildingRoom> = {}, geometry: Record<string, unknown> = {}): BuildingRoom {
  return {
    id, roomType: 'living_room', name: id, areaM2: 20, floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.7, externalWallCount: 1, externalDoorCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null, ...geometry },
      windows: { glazingType: 'standard', count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    envelope: { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] },
    air: { ventilationBalance: null, ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null },
    internalGains: { occupancy: null, occupancySource: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  } as BuildingRoom;
}

function project(rooms: BuildingRoom[], over: Partial<BuildingProject> = {}): BuildingProject {
  return { id: 'p1', objectType: 'apartment', topology: null, rooms, ...over } as unknown as BuildingProject;
}

test('apartment: "what is above" fills the other rooms that are still empty, not explicit ones', () => {
  const a = room('a');
  const b = room('b');
  const c = room('c', {}, { spaceAbove: 'outdoors' });
  const result = propagateSpaceAbove(project([a, b, c]), a, 'conditioned_space');
  assert.equal(result.certain, true);
  assert.deepEqual(result.patches.map((p) => p.roomId), ['b']);
  assert.equal((result.patches[0].patch.extras as any).geometry.spaceAbove, 'conditioned_space');
  // the rest of the target's extras is preserved
  assert.equal((result.patches[0].patch.extras as any).geometry.ceilingHeightM, 2.7);
});

test('below = heated space clears a stale floor element in the target, like the source room', () => {
  const a = room('a');
  const b = room('b', { envelope: { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [{ elementId: 'f1' } as any] } });
  const result = propagateSpaceBelow(project([a, b]), a, 'conditioned_space');
  assert.deepEqual(result.patches[0].patch.envelope, { floorElements: [] });
});

test('multi-storey house: only rooms on the same floor are filled automatically', () => {
  const a = room('a', { floorId: 'f1' });
  const b = room('b', { floorId: 'f1' });
  const up = room('up', { floorId: 'f2' });
  const result = propagateSpaceBelow(project([a, b, up], { objectType: 'private_house' }), a, 'ground');
  assert.equal(result.certain, true);
  assert.deepEqual(result.patches.map((p) => p.roomId), ['b']);
});

test('unknown storeys (commercial, no floor data): offered, not auto-applied', () => {
  const a = room('a');
  const b = room('b');
  const scope = sameLevelRooms(project([a, b], { objectType: 'commercial' }), a);
  assert.equal(scope.certain, false);
  assert.equal(propagateSpaceAbove(project([a, b], { objectType: 'commercial' }), a, 'outdoors').certain, false);
});

test('single-floor topology counts as one level', () => {
  const a = room('a');
  const b = room('b');
  const p = project([a, b], { objectType: 'commercial', topology: { floorCount: 1, floors: [], basementType: 'none', topBoundaryType: 'direct_roof', plantLocation: { kind: 'not_defined', floorId: null, roomId: null } } as any });
  assert.equal(sameLevelRooms(p, a).certain, true);
});

test('wall insulation goes to rooms with external walls, never to rooms declared without them', () => {
  const a = room('a');
  const withWalls = room('walls', {}, { externalWallCount: 2 });
  const noWalls = room('inner', {}, { externalWallCount: 0 });
  const unknown = room('unknown', {}, { externalWallCount: null });
  const explicit = room('explicit', { envelope: { wallElements: [{ elementId: 'w', constructionTier: 'good' } as any], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const patches = propagateWallTier(project([a, withWalls, noWalls, unknown, explicit]), a, 'poor');
  assert.deepEqual(patches.map((p) => p.roomId), ['walls']);
  assert.equal((patches[0].patch.envelope as any).wallElements[0].constructionTier, 'poor');
});

test('roof insulation only for rooms under the same kind of roof boundary', () => {
  const a = room('a', {}, { spaceAbove: 'unheated_attic' });
  const attic = room('attic', {}, { spaceAbove: 'unheated_attic' });
  const heatedAbove = room('heated', {}, { spaceAbove: 'conditioned_space' });
  const patches = propagateBoundaryTier(project([a, attic, heatedAbove]), a, 'roof', 'good');
  assert.deepEqual(patches.map((p) => p.roomId), ['attic']);
  assert.equal((patches[0].patch.envelope as any).roofElements[0].constructionTier, 'good');
  // a room with heated space above has nothing to share
  assert.deepEqual(propagateBoundaryTier(project([heatedAbove, attic]), heatedAbove, 'roof', 'good'), []);
});

test('airtightness is building-wide; explicit values and ACH50 overrides are kept', () => {
  const a = room('a');
  const empty = room('empty');
  const set = room('set', { air: { ...room('x').air, airtightnessClass: 'good' } as any });
  const measured = room('measured', { air: { ...room('x').air, ach50: 3 } as any });
  const patches = propagateAirtightness(project([a, empty, set, measured]), a, 'average');
  assert.deepEqual(patches.map((p) => p.roomId), ['empty']);
  assert.equal((patches[0].patch.air as any).airtightnessClass, 'average');
});

test('clearing a value ("Не указано") never propagates', () => {
  const a = room('a');
  const b = room('b');
  assert.deepEqual(propagateSpaceAbove(project([a, b]), a, null).patches, []);
  assert.deepEqual(propagateWallTier(project([a, b]), a, null), []);
  assert.deepEqual(propagateAirtightness(project([a, b]), a, null), []);
});
