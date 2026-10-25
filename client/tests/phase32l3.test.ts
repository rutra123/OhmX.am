/**
 * Phase 3.2L.3 client-side persistence/readiness regressions.
 *
 * The source-contract assertions are intentionally RED before the patch: the
 * panel currently sends complete render-time sub-objects instead of sparse
 * field patches, which makes stale sibling values overwrite persisted data.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildSteadyStateReadiness,
  loadModePrimaryLabel,
  primaryLoadModes,
  roomEditorMissingCount,
} from '../src/features/buildingProject/utils/smartLoadUx.js';
import type { BuildingProject, BuildingRoom } from '../src/features/buildingProject/types.js';

const panelSource = readFileSync(new URL('../src/features/buildingProject/components/RoomEngineeringPanel.tsx', import.meta.url), 'utf8');
const selectionsSource = readFileSync(new URL('../src/features/buildingProject/utils/engineeringSelections.ts', import.meta.url), 'utf8');
const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'l3-room',
    roomType: 'living_room',
    name: 'L3 room',
    areaM2: 20,
    floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.5, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: 'conditioned_space', spaceBelow: 'conditioned_space' },
      windows: { glazingType: 'panoramic', count: 1, areaM2: null },
      insulationOverride: null,
      conditions: [],
      notes: null,
      engineeringUse: 'stored_only',
    },
    envelope: {
      wallElements: [{ elementId: 'wall-1', areaM2: 20, widthM: 5, heightM: 4, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null }],
      windowElements: [{ elementId: 'window-1', areaM2: 2, widthM: 1.5, heightM: 1.33, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: 'E', shgc: null, shadingFactor: null, shadingProfile: 'none', source: null }],
      doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}

function project(rooms = [room()]): BuildingProject {
  return {
    id: 'l3-project', name: 'L3', status: 'draft', createdAt: 'x', updatedAt: 'x',
    objectConfirmedAt: null, objectConfirmedRevision: null, buildingRevision: 1,
    objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20,
    defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms,
    selectedSystems: [], systemsRevision: 0, systemsConfiguration: null,
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('L3.9: persisted GET values are consumed by readiness after reload', () => {
  const persisted = room({
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });
  const readiness = buildSteadyStateReadiness(project([persisted]), persisted, { requestedServices: ['heating', 'cooling'] });
  assert.equal(readiness.items.find((item) => item.key === 'air')?.status, 'ready');
  assert.equal(readiness.items.find((item) => item.key === 'internal')?.status, 'ready');
});

test('L3.10: filling the first actual missing input decrements the count', () => {
  const beforeRoom = room({ air: { ventilationBalance: null, ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' } });
  const afterRoom = room({ air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' } });
  const before = buildSteadyStateReadiness(project([beforeRoom]), beforeRoom, { requestedServices: ['heating'] });
  const after = buildSteadyStateReadiness(project([afterRoom]), afterRoom, { requestedServices: ['heating'] });
  assert.equal(roomEditorMissingCount(before), roomEditorMissingCount(after) + 1);
});

test('L3.11: filling the second air input reaches room missing count zero', () => {
  const complete = room({ air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' } });
  const readiness = buildSteadyStateReadiness(project([complete]), complete, { requestedServices: ['heating'] });
  assert.equal(roomEditorMissingCount(readiness), 0);
});

test('L3.12: Done gate keeps missing rooms open and exits at zero', () => {
  assert.match(wizardSource, /requiredMissingCount\s*>\s*0/);
  assert.match(wizardSource, /Заполните ещё \$\{requiredMissingCount\} обязательных параметров/);
  assert.match(wizardSource, /requiredMissingCount\s*===\s*0/);
});

test('L3.13: reopening a persisted complete room keeps readiness complete', () => {
  const reloaded = room();
  const readiness = buildSteadyStateReadiness(project([reloaded]), reloaded, { requestedServices: ['heating', 'cooling'] });
  assert.equal(roomEditorMissingCount(readiness), 0);
  assert.equal(readiness.ready, true);
});

test('L3.15: QUICK primary mode behavior remains unchanged', () => {
  assert.deepEqual(primaryLoadModes(['quick', 'professional', 'steady_state']), ['quick', 'steady_state']);
  assert.equal(loadModePrimaryLabel('quick'), 'Предварительный');
});

test('L3.17: client selection path exposes sparse patches for all engineering objects', () => {
  assert.match(selectionsSource, /export function sparseAirPatch/);
  assert.match(selectionsSource, /export function sparseEnvelopePatch/);
  assert.match(selectionsSource, /export function sparseGainsPatch/);
  assert.match(panelSource, /sparseAirPatch/);
  assert.match(panelSource, /sparseEnvelopePatch/);
  assert.match(panelSource, /sparseGainsPatch/);
});

test('L3.18: supply-only readiness follows the actual engine quantifier', () => {
  const supplyOnly = room({
    air: { ventilationBalance: 'supply_only', ventilationFlowM3h: 30, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null },
  });
  const readiness = buildSteadyStateReadiness(project([supplyOnly]), supplyOnly, { requestedServices: ['heating'] });
  assert.equal(readiness.items.find((item) => item.key === 'air')?.status, 'ready');
});
