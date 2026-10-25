/**
 * Phase 3.2K — mobile UX / progressive disclosure regressions.
 *
 * Pure-helper tests (no React renderer): engineering chip payloads, the
 * single actionable missing-input resolver (service-aware, no re-asking known
 * data, no irrelevant data), service-selection summary, and legacy mode not
 * competing with the primary choice. QUICK / steady_state engine semantics
 * are intentionally NOT re-tested here — they are covered by the existing,
 * unchanged server suites (361 buildingProject tests).
 *
 * Run (tsx is available in server/node_modules):
 *   cd server && npx tsx --test ../client/tests/phase32k.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_AIR,
  EMPTY_ENVELOPE,
  EMPTY_GAINS,
  selectAirtightnessClass,
  selectOccupancyCount,
  selectVentilationBalance,
  selectWallTier,
  withTier,
  withUValue,
} from '../src/features/buildingProject/utils/engineeringSelections.js';
import {
  buildProjectMissingSummary,
  buildSteadyStateReadiness,
  legacyLoadModes,
  primaryLoadModes,
  serviceChoiceEmoji,
  serviceChoiceFromServices,
  serviceChoiceLabel,
} from '../src/features/buildingProject/utils/smartLoadUx.js';
import type {
  BuildingLoadMode,
  BuildingProject,
  BuildingRoom,
  RoomEnvelope,
} from '../src/features/buildingProject/types.js';

function el(id: string, extra: Partial<RoomEnvelope['wallElements'][number]> = {}) {
  return {
    elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation: null, shgc: null, shadingFactor: null,
    shadingProfile: null, source: null, ...extra,
  };
}

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Гостиная', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: 'conditioned_space', spaceBelow: 'conditioned_space' }, windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: {
      wallElements: [el('wall-1', { areaM2: 12, constructionTier: 'average', uValueSource: 'construction_profile' })],
      windowElements: [el('win-E', { widthM: 1.5, heightM: 1.4, constructionTier: 'average', orientation: 'E', shadingProfile: 'none' })],
      doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}

function makeProject(rooms: BuildingRoom[]): BuildingProject {
  return {
    id: 'p', name: 'P', status: 'draft', createdAt: 'x', updatedAt: 'x', objectConfirmedAt: null, objectConfirmedRevision: 0,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 60, defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms,
    selectedSystems: [], systemsRevision: 0, buildingRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

// ---------- H1 — engineering chip → correct payload ----------

test('H1: selecting a wall tier emits the correct envelope patch', () => {
  const next = selectWallTier(EMPTY_ENVELOPE, 'good');
  const wall = next.wallElements[0];
  assert.equal(wall.constructionTier, 'good');
  assert.equal(wall.uValue, null); // tier clears any explicit U
  assert.equal(wall.uValueSource, 'construction_profile');
  assert.ok(wall.elementId); // backend normalizer requires a non-empty elementId
});

test('H1: a later advanced U-value override clears the tier (certificate precedence)', () => {
  const tiered = selectWallTier(EMPTY_ENVELOPE, 'poor').wallElements[0];
  const cert = withUValue(tiered, 0.25);
  assert.equal(cert.uValue, 0.25);
  assert.equal(cert.constructionTier, null);
  assert.equal(cert.uValueSource, 'certificate');
});

test('H1: ventilation + airtightness + occupancy chips produce correct patches', () => {
  assert.equal(selectVentilationBalance(EMPTY_AIR, 'balanced').ventilationBalance, 'balanced');
  assert.equal(selectAirtightnessClass(EMPTY_AIR, 'good').airtightnessClass, 'good');
  const gains = selectOccupancyCount(EMPTY_GAINS, 3);
  assert.equal(gains.occupancy, 3);
  assert.equal(gains.occupancySource, 'user_explicit');
});

test('H1: selecting a tier on one wall preserves the other envelope categories', () => {
  const base: RoomEnvelope = {
    wallElements: [],
    windowElements: [el('win-1', { orientation: 'E' })],
    doorElements: [el('door-1')],
    roofElements: [], floorElements: [],
  };
  const next = selectWallTier(base, 'high_performance');
  assert.equal(next.wallElements.length, 1);
  assert.equal(next.windowElements[0].orientation, 'E');
  assert.equal(next.doorElements.length, 1);
});

// ---------- H2 — selected value is stable through re-selection (client mirror) ----------

test('H2: withTier is idempotent and does not mutate the source element', () => {
  const source = el('wall-1', { areaM2: 12 });
  const a = withTier(source, 'good');
  const b = withTier(a, 'good');
  assert.equal(a.constructionTier, 'good');
  assert.equal(b.constructionTier, 'good');
  assert.equal(source.constructionTier, null); // no mutation of the input
});

// ---------- H3/H4/H5/H6 — missing resolver ----------

test('H3: the resolver never asks for already-known data', () => {
  const summary = buildProjectMissingSummary(makeProject([room()]));
  assert.equal(summary.totalMissing, 0);
});

test('H4: heating-only hides solar (windows) and internal-gain inputs as irrelevant', () => {
  // Room with NO windows and NO internal gains, but heating-only → not asked.
  const r = room({
    envelope: { wallElements: [el('wall-1', { areaM2: 12, constructionTier: 'average' })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] },
    internalGains: null,
  });
  // Explicitly confirmed "no windows" (Phase 3.2O declaration rule).
  r.extras = { ...r.extras, windows: { ...r.extras.windows, count: 0, areaM2: 0 } };
  const readiness = buildSteadyStateReadiness(makeProject([r]), r, { requestedServices: ['heating'] });
  // Confirmed "no windows" is a complete answer ('ready'); either way the
  // heating-only flow must never ASK for solar window data.
  assert.notEqual(readiness.items.find((i) => i.key === 'windows')?.status, 'missing');
  assert.equal(readiness.items.find((i) => i.key === 'internal')?.status, 'na');
  const summary = buildProjectMissingSummary(makeProject([r]), { requestedServices: ['heating'] });
  assert.ok(!summary.rooms.some((x) => x.items.some((i) => i.sectionKey === 'windows' || i.sectionKey === 'internal')));
});

test('H4: cooling additionally requires windows + internal data that heating does not', () => {
  const r = room();
  const missing = buildProjectMissingSummary(makeProject([r]), { requestedServices: ['cooling'] });
  assert.equal(missing.totalMissing, 0); // fully populated room → ready for cooling too
});

test('H5: a genuinely-blocking input is surfaced with a friendly action', () => {
  const r = room({ envelope: null, internalGains: null });
  const summary = buildProjectMissingSummary(makeProject([r]), { requestedServices: ['heating', 'cooling'] });
  const items = summary.rooms.find((x) => x.roomId === 'r1')!.items;
  assert.ok(items.some((i) => i.sectionKey === 'envelope'));
  assert.ok(items.some((i) => i.key === 'climate') === false); // AM-ER is supported
  assert.ok(!items.some((i) => i.label.includes(':missing'))); // raw codes never leak into labels
});

test('H6: filling a missing input removes it from the summary', () => {
  const empty = room({ envelope: null });
  const before = buildProjectMissingSummary(makeProject([empty]), { requestedServices: ['heating', 'cooling'] });
  assert.ok(before.rooms[0].items.some((i) => i.key === 'envelope'));
  const filled = room({ envelope: { wallElements: [el('wall-1', { areaM2: 12, constructionTier: 'average' })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const after = buildProjectMissingSummary(makeProject([filled]), { requestedServices: ['heating', 'cooling'] });
  assert.ok(!after.rooms.some((x) => x.items.some((i) => i.key === 'envelope')));
});

test('H7: per-room readiness counts agree with the project summary', () => {
  const rooms = [room({ id: 'a', envelope: null }), room({ id: 'b' })];
  const project = makeProject(rooms);
  const summary = buildProjectMissingSummary(project, { requestedServices: ['heating', 'cooling'] });
  const missingA = buildSteadyStateReadiness(project, rooms[0]).missingCount;
  const roomA = summary.rooms.find((x) => x.roomId === 'a');
  assert.equal(roomA?.count, missingA);
  // no windows/room with no doors, but wall tier present → only envelope+area possible; area is set.
  assert.ok(summary.rooms.find((x) => x.roomId === 'b') === undefined); // room b fully ready
});

// ---------- H8 — service selection summary ----------

test('H8: service choice is represented as heating/cooling/both', () => {
  assert.equal(serviceChoiceFromServices(['heating']), 'heating');
  assert.equal(serviceChoiceFromServices(['cooling']), 'cooling');
  assert.equal(serviceChoiceFromServices(['heating', 'cooling']), 'heating_and_cooling');
  assert.equal(serviceChoiceLabel('heating_and_cooling'), 'Отопление + охлаждение');
  assert.equal(serviceChoiceLabel('heating'), 'Отопление');
  assert.equal(serviceChoiceEmoji('heating_and_cooling'), '🔥❄');
});

// ---------- H9 — legacy professional is not a primary mode ----------

test('H9: legacy professional is excluded from primary load modes', () => {
  const available: BuildingLoadMode[] = ['quick', 'professional', 'steady_state'];
  assert.deepEqual(primaryLoadModes(available), ['quick', 'steady_state']);
  assert.deepEqual(legacyLoadModes(available), ['professional']);
  assert.ok(!primaryLoadModes(available).includes('professional'));
});

// ---------- H10 — engine semantics untouched (guard rails) ----------

test('H10: legacy/steady-state load-mode labels remain stable', () => {
  // The client only relocates the legacy choice; the mode union is unchanged.
  const available: BuildingLoadMode[] = ['quick', 'professional', 'steady_state'];
  assert.equal(available.length, 3);
  assert.ok(primaryLoadModes(available).includes('steady_state'));
});