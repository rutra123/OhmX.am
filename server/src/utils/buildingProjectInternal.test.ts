/**
 * Phase 3.2c — Internal gains regression tests.
 * Run: cd server && npx tsx --test src/utils/buildingProjectInternal.test.ts
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { computeRoomInternal, OCCUPANT_SENSIBLE_W_PER_PERSON } from './buildingProjectInternal.js';
import type { BuildingProject, BuildingRoom, RoomInternalGains } from './buildingProjectTypes.js';

function project(objectType: 'apartment' | 'private_house' | 'commercial' = 'private_house'): BuildingProject {
  return {
    id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '', objectConfirmedAt: 'x',
    objectConfirmedRevision: 1, buildingRevision: 1, objectType, region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null, defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms: [],
    selectedSystems: [], systemsRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
}

function ig(over: Partial<RoomInternalGains> = {}): RoomInternalGains {
  return { occupancy: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null, ...over };
}

function room(igInput: RoomInternalGains | null, areaM2 = 20, roomType = 'living_room'): BuildingRoom {
  return {
    id: 'r1', roomType, name: 'R1', areaM2, floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    internalGains: igInput,
  };
}

test('exact: 20 m² residential, 2 people → 150 + 100 + 100 = 350 W', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2 })));
  assert.equal(res.status, 'calculated');
  assert.equal(res.occupancy, 2);
  assert.equal(res.occupantSensibleWPerPerson, OCCUPANT_SENSIBLE_W_PER_PERSON);
  assert.equal(res.peopleW, 2 * 75);
  assert.equal(res.lightingW, 5 * 20);
  assert.equal(res.equipmentW, 5 * 20);
  assert.equal(res.totalCoolingW, 350);
});

test('occupancy ↑ → internal ↑', () => {
  const a = computeRoomInternal(project(), room(ig({ occupancy: 2 })));
  const b = computeRoomInternal(project(), room(ig({ occupancy: 4 })));
  assert.equal(a.peopleW, 150);
  assert.equal(b.peopleW, 300);
  assert.ok((b.totalCoolingW as number) > (a.totalCoolingW as number));
});

test('area ↑ → lighting/equipment ↑ (profile mode)', () => {
  const a = computeRoomInternal(project(), room(ig({ occupancy: 2 }), 20));
  const b = computeRoomInternal(project(), room(ig({ occupancy: 2 }), 40));
  assert.equal(a.lightingW, 100);
  assert.equal(b.lightingW, 200);
  assert.equal(a.equipmentW, 100);
  assert.equal(b.equipmentW, 200);
  assert.equal(a.peopleW, b.peopleW);
});

test('explicit lighting overrides profile', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2, lightingGainW: 200 })));
  assert.equal(res.lightingW, 200);
  assert.equal(res.lightingSource, 'explicit');
  assert.equal(res.totalCoolingW, 150 + 200 + 100);
});

test('explicit equipment overrides profile', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2, equipmentGainW: 250 })));
  assert.equal(res.equipmentW, 250);
  assert.equal(res.equipmentSource, 'explicit');
  assert.equal(res.totalCoolingW, 150 + 100 + 250);
});

test('explicit peopleW overrides occupancy', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 5, peopleW: 180 })));
  assert.equal(res.peopleW, 180);
  assert.equal(res.peopleSource, 'explicit');
});

test('editable occupantSensibleWPerPerson', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2, occupantSensibleWPerPerson: 100 })));
  assert.equal(res.peopleW, 200);
  assert.equal(res.occupantSensibleWPerPerson, 100);
});

test('residential ≠ commercial profiles', () => {
  const res = computeRoomInternal(project('commercial'), room(ig({ occupancy: 2 })));
  assert.equal(res.lightingW, 8 * 20);
  assert.equal(res.equipmentW, 15 * 20);
  assert.equal(res.totalCoolingW, 150 + 160 + 300); // 610
  assert.ok(res.warnings.some((w) => w.startsWith('lighting_profile:commercial')));
  assert.ok(res.warnings.some((w) => w.startsWith('equipment_profile:commercial')));
});

test('apartment uses residential profile', () => {
  const res = computeRoomInternal(project('apartment'), room(ig({ occupancy: 2 })));
  assert.equal(res.lightingW, 5 * 20);
  assert.equal(res.equipmentW, 5 * 20);
});

test('missing occupancy → people missing, total null (roomType without Phase 3.2I default)', () => {
  const res = computeRoomInternal(project(), room(ig({}), 20, 'unknown_room'));
  assert.equal(res.status, 'missing_input');
  assert.equal(res.peopleW, null);
  assert.equal(res.lightingW, 100); // profile still resolves
  assert.equal(res.equipmentW, 100);
  assert.equal(res.totalCoolingW, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('negative occupancy → invalid', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: -1 })));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('occupancy:invalid'));
});

test('non-integer occupancy → invalid', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2.5 })));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('occupancy:invalid'));
});

test('NaN peopleW → invalid', () => {
  const res = computeRoomInternal(project(), room(ig({ peopleW: NaN })));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('people_gain:invalid'));
});

test('Infinity equipment → invalid', () => {
  const res = computeRoomInternal(project(), room(ig({ occupancy: 2, equipmentGainW: Infinity })));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('equipment_gain:invalid'));
});

test('null internalGains input → people missing, lighting/equipment via profile (no roomType default)', () => {
  const res = computeRoomInternal(project(), room(null, 20, 'unknown_room')); // area still known → profile resolves
  assert.equal(res.status, 'missing_input');
  assert.equal(res.peopleW, null);
  assert.equal(res.lightingW, 100);
  assert.equal(res.equipmentW, 100);
});

test('deterministic: same input → same result', () => {
  const a = computeRoomInternal(project(), room(ig({ occupancy: 3, lightingGainW: 120 })));
  const b = computeRoomInternal(project(), room(ig({ occupancy: 3, lightingGainW: 120 })));
  assert.equal(a.totalCoolingW, b.totalCoolingW);
  assert.deepEqual(a, b);
});