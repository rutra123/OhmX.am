/**
 * Phase 3.2I — roomType-based occupancy profile defaults with provenance.
 * Priority: explicit user value > profile default > missing.
 * The default is only applied when occupancy is null (never overwrites a user value).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { computeRoomInternal, OCCUPANCY_BY_ROOM_TYPE, OCCUPANT_SENSIBLE_W_PER_PERSON } from './buildingProjectInternal.js';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import type { BuildingProject, BuildingRoom, BuildingSystemArchitecture, EngineeringRoomAssignment, RoomInternalGains } from './buildingProjectTypes.js';

const PROJECT = { objectType: 'apartment' } as BuildingProject;

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1',
    roomType: 'living_room',
    name: 'Гостиная',
    areaM2: 20,
    floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null,
      conditions: [],
      notes: null,
      engineeringUse: 'stored_only',
    },
    ...over,
  };
}

function ig(over: Partial<RoomInternalGains> = {}): RoomInternalGains {
  return { occupancy: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null, ...over };
}

test('null occupancy + living_room → profile default (2 people, source profile_default)', () => {
  const res = computeRoomInternal(PROJECT, room({ internalGains: ig() }));
  assert.equal(res.occupancy, 2);
  assert.equal(res.occupancySource, 'profile_default');
  assert.equal(res.peopleW, 2 * OCCUPANT_SENSIBLE_W_PER_PERSON);
  assert.equal(res.peopleSource, 'profile');
});

test('explicit user occupancy overrides profile default and is never re-derived', () => {
  // living_room default is 2; the user typed 3 — explicit wins, provenance user_explicit.
  const res = computeRoomInternal(PROJECT, room({ internalGains: ig({ occupancy: 3, occupancySource: 'user_explicit' }) }));
  assert.equal(res.occupancy, 3);
  assert.equal(res.occupancySource, 'user_explicit');
  assert.equal(res.peopleW, 3 * OCCUPANT_SENSIBLE_W_PER_PERSON);
});

test('explicit occupancy stays explicit even when the roomType default would differ', () => {
  // Same explicit value 3 under a roomType with a different default (office default 1).
  const res = computeRoomInternal(PROJECT, room({ roomType: 'office', internalGains: ig({ occupancy: 3, occupancySource: 'user_explicit' }) }));
  assert.equal(res.occupancy, 3);
  assert.equal(res.occupancySource, 'user_explicit');
});

test('different room types resolve different defaults', () => {
  const living = computeRoomInternal(PROJECT, room({ roomType: 'living_room', internalGains: ig() }));
  const office = computeRoomInternal(PROJECT, room({ roomType: 'office', internalGains: ig() }));
  assert.equal(living.occupancy, 2);
  assert.equal(office.occupancy, 1);
});

test('room type without a default stays missing (no fabricated number)', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'unknown_room', internalGains: ig() }));
  assert.equal(res.occupancy, null);
  assert.equal(res.occupancySource, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('zero-person room type (garage) resolves to a real 0, not missing/fabricated', () => {
  assert.equal(OCCUPANCY_BY_ROOM_TYPE['garage'], 0);
  const res = computeRoomInternal(PROJECT, room({ roomType: 'garage', internalGains: ig() }));
  assert.equal(res.occupancy, 0);
  assert.equal(res.occupancySource, 'profile_default');
  assert.equal(res.peopleW, 0);
});

test('legacy occupancy (no provenance field) is treated as user_explicit', () => {
  const res = computeRoomInternal(PROJECT, room({ internalGains: ig({ occupancy: 4 }) }));
  assert.equal(res.occupancy, 4);
  assert.equal(res.occupancySource, 'user_explicit');
});

// End-to-end: occupancy default flows into the steady_state internal-gain breakdown.
function assignment(roomId: string): EngineeringRoomAssignment {
  return {
    roomId, roomName: 'Гостиная', roomPurpose: 'living_room', sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
    servicePreferences: { heating: 'required', cooling: 'required' }, servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required', towelRadiatorPreferenceSource: 'default',
    heatingSystems: [], coolingSystems: [], status: 'allowed', warnings: [], reasons: [],
  };
}
function fullProject(r: BuildingRoom): BuildingProject {
  const a = assignment(r.id);
  const arch: BuildingSystemArchitecture = {
    spaceHeatingSourceId: null, spaceCoolingSourceId: null, spaceCombinedSourceId: null, sources: [],
    distribution: { id: 'independent_dx', label: '', circuitKind: 'independent', simultaneousHeatCool: false, notes: [] },
    dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
    simultaneousHeatCoolSupported: false, warnings: [],
  };
  return {
    id: 'p', name: 'P', status: 'systems_configured', createdAt: 'x', updatedAt: 'x', objectConfirmedAt: 'x', objectConfirmedRevision: 1,
    objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20, defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms: [r],
    selectedSystems: [], systemsRevision: 1, buildingRevision: 1,
    systemsConfiguration: { projectId: 'p', requestedServices: ['cooling'], simultaneousHeatCoolRequired: false, selectedSystemFamilies: [], architecture: arch, roomAssignments: [a], configurationStatus: 'confirmed', warnings: [], confirmedAt: 'x', buildingRevisionAtConfirmation: 1, systemsRevisionAtConfirmation: 1, systemsRevision: 1 },
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('steady_state internal gains use the roomType occupancy default end-to-end', () => {
  const calc = computeBuildingLoads(fullProject(room({ internalGains: ig() })), 'steady_state');
  const breakdown = calc.roomResults[0].internalGainsBreakdown!;
  assert.equal(breakdown.occupancy, 2);
  assert.equal(breakdown.occupancySource, 'profile_default');
});

// --- Phase 3.2I.2 — status correction + residential/commercial/bathroom/shower semantics ---
const COMMERCIAL = { objectType: 'commercial' } as BuildingProject;

test('residential bedroom empty → profile_default 2', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'bedroom', internalGains: ig() }));
  assert.equal(res.occupancy, 2);
  assert.equal(res.occupancySource, 'profile_default');
});

test('residential child_room → profile_default 1', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'child_room', internalGains: ig() }));
  assert.equal(res.occupancy, 1);
  assert.equal(res.occupancySource, 'profile_default');
});

test('explicit 0 overrides a non-zero profile default', () => {
  const res = computeRoomInternal(PROJECT, room({ internalGains: ig({ occupancy: 0, occupancySource: 'user_explicit' }) }));
  assert.equal(res.occupancy, 0);
  assert.equal(res.occupancySource, 'user_explicit');
  assert.equal(res.peopleW, 0);
});

test('commercial office empty → missing (no fixed residential default)', () => {
  const res = computeRoomInternal(COMMERCIAL, room({ roomType: 'office', internalGains: ig() }));
  assert.equal(res.occupancy, null);
  assert.equal(res.occupancySource, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('commercial living_room empty → missing', () => {
  const res = computeRoomInternal(COMMERCIAL, room({ roomType: 'living_room', internalGains: ig() }));
  assert.equal(res.occupancy, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('bathroom empty → missing (suggestion-only, not auto-applied)', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'bathroom', internalGains: ig() }));
  assert.equal(res.occupancy, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('bathroom confirmed 1 → user_explicit', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'bathroom', internalGains: ig({ occupancy: 1, occupancySource: 'user_explicit' }) }));
  assert.equal(res.occupancy, 1);
  assert.equal(res.occupancySource, 'user_explicit');
});

test('shower empty → missing (suggestion-only)', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'shower', internalGains: ig() }));
  assert.equal(res.occupancy, null);
  assert.ok(res.missingInputs.includes('occupancy:missing'));
});

test('zero profile ≠ missing: corridor is a real 0, a calculated result', () => {
  const res = computeRoomInternal(PROJECT, room({ roomType: 'corridor', internalGains: ig() }));
  assert.equal(res.occupancy, 0);
  assert.equal(res.occupancySource, 'profile_default');
  assert.equal(res.peopleW, 0);
  assert.equal(res.status, 'calculated');
  assert.ok(!res.missingInputs.includes('occupancy:missing'));
});