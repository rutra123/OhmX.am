/**
 * Phase 3.2L — mobile flow / no-scroll navigation regressions.
 *
 * Red-then-green over `mobileNav.ts` (pure navigation + scroll-policy model).
 * This is the only new behavioural logic; the Wizard wires these helpers into
 * the UI. Engineering inputs / provenance / resolver / service summary /
 * primary modes are NOT re-implemented here, only re-asserted.
 *
 * Run (tsx is available in server/node_modules):
 *   cd server && npx tsx --test ../client/tests/phase32l.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  missingEditTarget,
  resolveReturnTarget,
  roomsDefaultCompactState,
  stepChangeResetsScroll,
} from '../src/features/buildingProject/utils/mobileNav.js';
import {
  buildProjectMissingSummary,
  primaryLoadModes,
  serviceChoiceEmoji,
  serviceChoiceLabel,
} from '../src/features/buildingProject/utils/smartLoadUx.js';
import type { BuildingLoadMode, BuildingProject, BuildingRoom } from '../src/features/buildingProject/types.js';

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Гостиная', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: 'conditioned_space', spaceBelow: 'conditioned_space' }, windows: { glazingType: null, count: 0, areaM2: 0 }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: {
      wallElements: [{ elementId: 'wall-1', areaM2: 12, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null }],
      windowElements: [], doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}
function project(rooms: BuildingRoom[] = [room()]): BuildingProject {
  return {
    id: 'p', name: 'P', status: 'draft', createdAt: 'x', updatedAt: 'x', objectConfirmedAt: null, objectConfirmedRevision: 0,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20, defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms,
    selectedSystems: [], systemsRevision: 0, buildingRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('L1: a manual step change resets the wizard scroll target', () => {
  assert.equal(stepChangeResetsScroll('rooms', 'systems'), true);
  assert.equal(stepChangeResetsScroll('loads', 'review'), true);
  assert.equal(stepChangeResetsScroll('systems', 'systems'), false); // no-op
  assert.equal(stepChangeResetsScroll(null, 'object'), false); // initial mount
});

test('L2: a Professional missing item records returnStep = Loads', () => {
  const t = missingEditTarget('room-1', 'air');
  assert.equal(t.roomId, 'room-1');
  assert.equal(t.sectionKey, 'air');
  assert.equal(t.returnStep, 'loads');
});

test('L3: returning from a focused engineering edit restores Professional mode', () => {
  const t = missingEditTarget('room-1', 'air');
  assert.deepEqual(resolveReturnTarget(t, 'steady_state'), { step: 'loads', loadMode: 'steady_state' });
  assert.equal(resolveReturnTarget(null, 'steady_state'), null);
});

test('L4: only the targeted room is active in a focused edit', () => {
  assert.equal(missingEditTarget('room-7', 'windows').roomId, 'room-7');
});

test('L5: add-room catalogue is collapsed by default', () => {
  assert.equal(roomsDefaultCompactState().addRoomOpen, false);
});

test('L6: room list starts compact (no editor open)', () => {
  assert.equal(roomsDefaultCompactState().editingRoomId, null);
});

// No-regression re-assertions of Phase 3.2K behaviour.
test('L7: primary load modes unchanged (legacy not primary)', () => {
  const modes: BuildingLoadMode[] = ['quick', 'professional', 'steady_state'];
  assert.deepEqual(primaryLoadModes(modes), ['quick', 'steady_state']);
});

test('L8: service summary heating/cooling/both unchanged', () => {
  assert.equal(serviceChoiceLabel('heating_and_cooling'), 'Отопление + охлаждение');
  assert.equal(serviceChoiceEmoji('cooling'), '❄');
});

test('L9: missing resolver semantics unchanged (no re-ask of known data)', () => {
  const summary = buildProjectMissingSummary(project(), { requestedServices: ['heating', 'cooling'] });
  assert.equal(summary.totalMissing, 0);
});

const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/features/buildingProject/store/useBuildingProjectStore.ts', import.meta.url), 'utf8');
const roomPickerHandler = wizardSource.slice(
  wizardSource.indexOf('const addRoomOfType ='),
  wizardSource.indexOf('\n\n  // Stable id-derived key', wizardSource.indexOf('const addRoomOfType =')),
);
const roomPickerBlock = wizardSource.slice(
  wizardSource.indexOf('{addRoomOpen && !focusedRoom && ('),
  wizardSource.indexOf('\n          )}', wizardSource.indexOf('{addRoomOpen && !focusedRoom && (')),
);

test('L10: opening the picker sets addRoomOpen=true', () => {
  assert.match(wizardSource, /onClick=\{\(\) => setAddRoomOpen\(true\)\}/);
});

test('L11: adding a room keeps the picker open', () => {
  assert.doesNotMatch(roomPickerHandler, /setAddRoomOpen\(false\)/);
});

test('L12: adding a room does not activate the focused room editor', () => {
  assert.doesNotMatch(roomPickerHandler, /setEngRoomId|openRoomEditor|setFocusSectionKey/);
});

test('L13: repeated additions remain available without reopening the picker', () => {
  assert.match(roomPickerBlock, /addRoomOfType\(type\.value\)/);
  assert.match(wizardSource, /addRoomOpen && !focusedRoom/);
});

test('L14: explicit Done closes the picker', () => {
  assert.match(roomPickerBlock, /onClick=\{\(\) => setAddRoomOpen\(false\)\}>Готово<\/button>/);
});

test('L15: adding a room does not trigger step-change scroll reset', () => {
  assert.doesNotMatch(roomPickerHandler, /setStep|scrollWizardToTop/);
  assert.equal(stepChangeResetsScroll('rooms', 'rooms'), false);
});

test('L16: room count/list update still uses the existing room-type count path', () => {
  assert.match(roomPickerHandler, /setRoomTypeCount\(roomType, count \+ 1/);
  assert.match(wizardSource, /<strong>\{rooms\.length\}<\/strong>/);
});

test('L17: existing floorId rules are passed through unchanged', () => {
  assert.match(roomPickerHandler, /isHouseObject && floors\.length \? selectedFloor\?\.id \|\| null : null/);
});

test('L18: existing roomId generation remains owned by the existing store/API path', () => {
  assert.doesNotMatch(roomPickerHandler, /roomId|id\s*=/);
  assert.match(storeSource, /setBuildingRoomTypeCount\(id, roomType, count, floorId\)/);
});

test('L19: picker addition does not touch engineering configuration or schema state', () => {
  assert.doesNotMatch(roomPickerHandler, /systemsConfiguration|selectedSystemFamilies|buildingRevision|persistSystems/);
});

test('L20: picker addition preserves the .mobile-scroll-content owner after DOM update', () => {
  assert.match(roomPickerHandler, /getWizardScrollContainer/);
  assert.match(roomPickerHandler, /scrollTop/);
  assert.match(roomPickerHandler, /requestAnimationFrame/);
});
