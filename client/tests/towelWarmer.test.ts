/**
 * Bathroom towel warmer defaults: one device per bathroom, type from the
 * heating system, user choices preserved, never duplicated, never in a
 * cooling-only project, never added to the room heat load.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingProject, BuildingRoom, EngineeringRoomAssignment } from '../src/features/buildingProject/types.js';
import {
  defaultTowelWarmerKind,
  loadTowelWarmerOverrides,
  resolveProjectTowelWarmers,
  resolveTowelWarmer,
  saveTowelWarmerOverrides,
  towelWarmerTotals,
} from '../src/features/buildingProject/utils/towelWarmer.js';

function room(id: string, roomType: string): BuildingRoom {
  return { id, roomType, name: `${roomType} ${id}`, areaM2: 10, floorId: null, extras: { geometry: {}, windows: { glazingType: null, count: null, areaM2: null }, conditions: [], engineeringUse: 'stored_only' } } as BuildingRoom;
}

function assignment(roomId: string, heatingFamilies: string[], extra: Partial<EngineeringRoomAssignment> = {}): EngineeringRoomAssignment {
  return {
    roomId,
    roomName: roomId,
    roomPurpose: 'bathroom',
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: { heating: 'required', cooling: 'not_required' },
    heatingSystems: heatingFamilies.map((familyId) => ({ familyId, label: familyId, role: 'terminal' })) as EngineeringRoomAssignment['heatingSystems'],
    coolingSystems: [],
    status: 'supported',
    warnings: [],
    reasons: [],
    ...extra,
  } as EngineeringRoomAssignment;
}

function project(rooms: BuildingRoom[], assignments: EngineeringRoomAssignment[], requested: Array<'heating' | 'cooling'>, sourceId: string | null = null): BuildingProject {
  return {
    id: 'p1',
    rooms,
    systemsConfiguration: {
      requestedServices: requested,
      roomAssignments: assignments,
      architecture: { spaceHeatingSourceId: sourceId, spaceCoolingSourceId: null, spaceCombinedSourceId: null },
    },
  } as unknown as BuildingProject;
}

test('hydronic room heating → one water towel warmer', () => {
  const t = resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: assignment('b', ['hydronic_floor_heating']), requestedServices: ['heating'] })!;
  assert.equal(t.kind, 'water');
  assert.equal(t.kindSource, 'heating_system');
  assert.equal(t.quantity, 1);
  assert.equal(t.capacityW, null, 'no assumed device output');
});

test('electric room heating → one electric towel warmer', () => {
  const t = resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: assignment('b', ['heating_mat']), requestedServices: ['heating'] })!;
  assert.equal(t.kind, 'electric');
  assert.equal(t.kindSource, 'heating_system');
});

test('mixed water + electric terminals → exactly one device (water), never both', () => {
  const p = project([room('b', 'bathroom')], [assignment('b', ['heating_mat', 'aluminum_radiators'])], ['heating']);
  const list = resolveProjectTowelWarmers(p);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'water');
});

test('project water source decides when the room has no terminal', () => {
  assert.deepEqual(defaultTowelWarmerKind(assignment('b', []), 'gas_boiler'), { kind: 'water', source: 'heating_system' });
});

test('undetermined heating type → clearly marked editable default', () => {
  const t = resolveTowelWarmer({ room: room('b', 'shower'), assignment: assignment('b', []), requestedServices: ['heating'] })!;
  assert.equal(t.kind, 'electric');
  assert.equal(t.kindSource, 'default');
});

test('only bathrooms/showers; not in cooling-only projects; not in unheated rooms', () => {
  assert.equal(resolveTowelWarmer({ room: room('k', 'kitchen'), assignment: assignment('k', ['aluminum_radiators']), requestedServices: ['heating'] }), null);
  assert.equal(resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: assignment('b', []), requestedServices: ['cooling'] }), null);
  const unheated = assignment('b', [], { servicePreferences: { heating: 'not_required', cooling: 'required' } });
  assert.equal(resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: unheated, requestedServices: ['heating', 'cooling'] }), null);
});

test('server default "not_required" does not hide the device; user removal does', () => {
  const serverDefault = assignment('b', ['heating_mat'], { towelRadiatorPreference: 'not_required', towelRadiatorPreferenceSource: 'default' });
  assert.ok(resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: serverDefault, requestedServices: ['heating'] }));
  const removed = assignment('b', ['heating_mat'], { towelRadiatorPreference: 'not_required', towelRadiatorPreferenceSource: 'user' });
  assert.equal(resolveTowelWarmer({ room: room('b', 'bathroom'), assignment: removed, requestedServices: ['heating'] }), null);
});

test('user kind/quantity overrides win and are clamped', () => {
  const p = project([room('b', 'bathroom')], [assignment('b', ['hydronic_floor_heating'])], ['heating']);
  const [t] = resolveProjectTowelWarmers(p, { b: { kind: 'electric', quantity: 2 } });
  assert.equal(t.kind, 'electric');
  assert.equal(t.kindSource, 'user');
  assert.equal(t.quantity, 2);
  assert.equal(resolveProjectTowelWarmers(p, { b: { quantity: 99 } })[0].quantity, 4);
  assert.equal(resolveProjectTowelWarmers(p, { b: { quantity: 0 } })[0].quantity, 1);
});

test('repeated recalculation: same choices, no duplicates', () => {
  const p = project(
    [room('b1', 'bathroom'), room('b2', 'shower'), room('l', 'living_room')],
    [assignment('b1', ['hydronic_floor_heating']), assignment('b2', ['electric_convector']), assignment('l', ['aluminum_radiators'])],
    ['heating', 'cooling'],
  );
  const overrides = { b1: { quantity: 2 } };
  const first = resolveProjectTowelWarmers(p, overrides);
  const again = resolveProjectTowelWarmers(structuredClone(p), overrides);
  const third = resolveProjectTowelWarmers(structuredClone(p), overrides);
  assert.deepEqual(first, again);
  assert.deepEqual(first, third);
  assert.equal(first.length, 2);
  assert.deepEqual(towelWarmerTotals(first), { water: 2, electric: 1 });
});

test('overrides persist per project in browser storage (and survive unavailable storage)', () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    saveTowelWarmerOverrides('p1', { b: { kind: 'electric', quantity: 3 } });
    assert.deepEqual(loadTowelWarmerOverrides('p1'), { b: { kind: 'electric', quantity: 3 } });
    assert.deepEqual(loadTowelWarmerOverrides('p2'), {});
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.deepEqual(loadTowelWarmerOverrides('p1'), {});
    assert.doesNotThrow(() => saveTowelWarmerOverrides('p1', {}));
  } finally {
    g.localStorage = prev;
  }
});
