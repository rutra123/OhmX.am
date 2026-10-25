/**
 * Phase 3.2H — frontend smart missing UX/readiness tests.
 * Pure helper tests: no React renderer, no browser, no build artifacts.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  explainMissingInput,
  friendlyMissingList,
  buildSteadyStateReadiness,
  getRoomOccupancySuggestion,
  loadModeLabel,
} from './smartLoadUx';
import type { BuildingProject, BuildingRoom } from '../types';

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Гостиная', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: 'conditioned_space', spaceBelow: 'conditioned_space' }, windows: { glazingType: 'panoramic', count: 2, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: {
      wallElements: [{ elementId: 'wall-1', areaM2: 12, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null }],
      windowElements: [
        { elementId: 'win-1', areaM2: null, widthM: 1.5, heightM: 1.4, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: 'E', shgc: null, shadingFactor: null, shadingProfile: 'none', source: null },
        { elementId: 'win-2', areaM2: null, widthM: 1.5, heightM: 1.4, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: 'W', shgc: null, shadingFactor: null, shadingProfile: 'interior', source: null },
      ],
      doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}

function project(rooms = [room()]): BuildingProject {
  return {
    id: 'p', name: 'P', status: 'draft', createdAt: 'x', updatedAt: 'x', objectConfirmedAt: null, objectConfirmedRevision: 0,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20, defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms,
    selectedSystems: [], systemsRevision: 0, buildingRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('raw missing code maps to human explanation and action', () => {
  const item = explainMissingInput('u_value:missing:wall-1');
  assert.equal(item.title, 'Не выбрано утепление наружных конструкций');
  assert.match(item.action, /Помещения.*⚙/);
  assert.equal(item.debugCode, 'u_value:missing:wall-1');
});

test('friendly missing list hides raw codes in primary text', () => {
  const items = friendlyMissingList(['u_value:missing:wall-1', 'orientation:missing:win-1', 'internal_gains_methodology:missing']);
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => !item.title.includes(':missing')));
  assert.ok(items.some((item) => item.title.includes('куда выходят окна')));
});

test('readiness indicator is ready for a fully populated normal room', () => {
  const readiness = buildSteadyStateReadiness(project(), room());
  assert.equal(readiness.ready, true);
  assert.equal(readiness.missingCount, 0);
  assert.ok(readiness.items.every((item) => item.status === 'ready'));
});

test('readiness counts actionable missing blocks for a partial room', () => {
  // unknown_room has no occupancy default, so "Люди" stays genuinely missing.
  const partial = room({ roomType: 'unknown_room', envelope: null, air: { ventilationBalance: 'balanced', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null }, internalGains: null });
  const readiness = buildSteadyStateReadiness(project([partial]), partial);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missingCount >= 3);
  assert.ok(readiness.summary.includes('Нужно заполнить'));
  assert.ok(readiness.items.some((item) => item.key === 'air' && item.status === 'missing'));
});

test('glazing size type is not treated as thermal quality readiness', () => {
  const partial = room({ envelope: { ...room().envelope!, windowElements: [{ ...room().envelope!.windowElements[0], constructionTier: null, uValue: null, shgc: null }] } });
  const readiness = buildSteadyStateReadiness(project([partial]), partial);
  const windows = readiness.items.find((item) => item.key === 'windows');
  assert.equal(windows?.status, 'missing');
  assert.match(windows?.action || '', /тип окна/i);
});

test('occupancy roomType default is a reference profile (residential only)', () => {
  const suggestion = getRoomOccupancySuggestion('living_room', 'apartment');
  assert.equal(suggestion?.suggestedPeople, 2);
  assert.equal(suggestion?.status, 'REFERENCE_PROFILE');
  assert.equal(suggestion?.calculationInput, true);
  assert.equal(suggestion?.userConfirmationRequired, false);
});

test('bathroom occupancy is suggestion-only (requires confirmation), not auto', () => {
  const s = getRoomOccupancySuggestion('bathroom', 'apartment');
  assert.equal(s?.suggestedPeople, 1);
  assert.equal(s?.userConfirmationRequired, true);
  assert.equal(s?.calculationInput, false);
});

test('commercial has no fixed residential occupancy suggestion', () => {
  assert.equal(getRoomOccupancySuggestion('office', 'commercial'), null);
  assert.equal(getRoomOccupancySuggestion('living_room', 'commercial'), null);
});

test('zero-profile occupancy is flagged as "no constant occupant", not missing', () => {
  const s = getRoomOccupancySuggestion('garage', 'apartment');
  assert.equal(s?.suggestedPeople, 0);
  assert.equal(s?.zeroOccupancy, true);
  assert.equal(s?.calculationInput, true);
});

test('readiness treats "Люди" as ready via roomType default when occupancy is empty', () => {
  const r = room({ internalGains: { occupancy: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null } });
  const readiness = buildSteadyStateReadiness(project([r]), r);
  const people = readiness.items.find((item) => item.key === 'internal');
  assert.equal(people?.status, 'ready');
});

test('readiness does not mark a window ready without area or dimensions', () => {
  const base = room();
  const partial = room({
    envelope: {
      ...base.envelope!,
      windowElements: [{ ...base.envelope!.windowElements[0], areaM2: null, widthM: null, heightM: null, grossAreaM2: null }],
    },
  });
  const readiness = buildSteadyStateReadiness(project([partial]), partial);
  assert.equal(readiness.items.find((item) => item.key === 'windows')?.status, 'missing');
});

test('readiness does not mark natural ventilation ready from supply flow alone', () => {
  const partial = room({
    air: { ventilationBalance: 'natural', ventilationFlowM3h: 30, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null },
  });
  const readiness = buildSteadyStateReadiness(project([partial]), partial);
  assert.equal(readiness.items.find((item) => item.key === 'air')?.status, 'missing');
});

test('readiness marks an uncovered climate region as missing', () => {
  const p = { ...project(), region: { code: 'AM-AR', name: 'Арарат' } };
  const readiness = buildSteadyStateReadiness(p, p.rooms[0]);
  assert.equal(readiness.items.find((item) => item.key === 'climate')?.status, 'missing');
});

test('readiness rejects invalid explicit occupancy instead of showing ready', () => {
  const partial = room({ internalGains: { occupancy: -1, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null } });
  const readiness = buildSteadyStateReadiness(project([partial]), partial);
  assert.equal(readiness.items.find((item) => item.key === 'internal')?.status, 'missing');
});

test('readiness honors invalid explicit values over lower-priority profiles', () => {
  const base = room();
  const invalidEnvelope = room({
    envelope: { ...base.envelope!, wallElements: [{ ...base.envelope!.wallElements[0], uValue: -1, constructionTier: 'average' }] },
  });
  assert.equal(buildSteadyStateReadiness(project([invalidEnvelope]), invalidEnvelope).items.find((item) => item.key === 'envelope')?.status, 'missing');

  const invalidAir = room({
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: -1, airChangesPerHour: 0.5, ach50: null, airtightnessClass: 'average' },
  });
  assert.equal(buildSteadyStateReadiness(project([invalidAir]), invalidAir).items.find((item) => item.key === 'air')?.status, 'missing');

  const invalidSolar = room({
    envelope: { ...base.envelope!, windowElements: [{ ...base.envelope!.windowElements[0], shgc: 2, constructionTier: 'average' }] },
  });
  assert.equal(buildSteadyStateReadiness(project([invalidSolar]), invalidSolar).items.find((item) => item.key === 'windows')?.status, 'missing');
});

test('steady_state has a user-facing professional label distinct from legacy professional', () => {
  assert.equal(loadModeLabel('steady_state'), 'Профессиональный steady-state');
  assert.equal(loadModeLabel('professional'), 'Legacy professional (limited)');
});
