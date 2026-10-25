/**
 * Phase 3.2L.4 — Air required-input / Next-button regressions.
 *
 * Reproduces the confirmed mobile defect: a room with "Приточно-вытяжная"
 * (balanced) ventilation + "Обычное" (average) airtightness still reports the
 * Air section as missing because the steady-state engine needs an explicit
 * ventilation flow (m³/h) that the consumer Air section never surfaced.
 *
 * These assertions are RED before the fix: `airRequiredInputs` does not exist
 * yet and the readiness `action` text cannot distinguish a missing flow.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  airRequiredInputs,
  buildSteadyStateReadiness,
  roomEditorMissingCount,
} from '../src/features/buildingProject/utils/smartLoadUx.js';
import {
  EMPTY_AIR,
  mergeOptimisticAirPatch,
  selectAirtightnessClass,
  selectVentilationBalance,
  sparseAirPatch,
} from '../src/features/buildingProject/utils/engineeringSelections.js';
import type { BuildingProject, BuildingRoom } from '../src/features/buildingProject/types.js';

const panelSource = readFileSync(new URL('../src/features/buildingProject/components/RoomEngineeringPanel.tsx', import.meta.url), 'utf8');
const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/features/buildingProject/store/useBuildingProjectStore.ts', import.meta.url), 'utf8');

function room(air: BuildingRoom['air']): BuildingRoom {
  return {
    id: 'l4-room',
    roomType: 'living_room',
    name: 'L4 room',
    areaM2: 20,
    floorId: null,
    extras: {
      geometry: {
        ceilingHeightM: 2.5,
        externalWallCount: 1,
        externalDoorCount: 0,
        floorPosition: null,
        spaceAbove: 'conditioned_space',
        spaceBelow: 'conditioned_space',
      },
      windows: { glazingType: null, count: 0, areaM2: 0 },
      insulationOverride: null,
      conditions: [],
      notes: null,
      engineeringUse: 'stored_only',
    },
    envelope: {
      wallElements: [{ elementId: 'wall-1', areaM2: 20, widthM: 5, heightM: 4, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null }],
      windowElements: [],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
    air,
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  };
}

function project(rooms = [room({ ventilationBalance: 'balanced', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' })]): BuildingProject {
  return {
    id: 'l4-project', name: 'L4', status: 'draft', createdAt: 'x', updatedAt: 'x',
    objectConfirmedAt: null, objectConfirmedRevision: null, buildingRevision: 1,
    objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20,
    defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms,
    selectedSystems: [], systemsRevision: 0, systemsConfiguration: null,
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

function airStatus(readiness: ReturnType<typeof buildSteadyStateReadiness>): string | undefined {
  return readiness.items.find((item) => item.key === 'air')?.status;
}

test('L4.1: balanced + airtightness with no flow is still missing (engine needs ventilation flow)', () => {
  const completed = room({ ventilationBalance: 'balanced', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' });
  const readiness = buildSteadyStateReadiness(project([completed]), completed, { requestedServices: ['heating'] });
  assert.equal(airStatus(readiness), 'missing');
  assert.equal(roomEditorMissingCount(readiness), 1);
});

test('L4.2: the missing air input is specifically the ventilation flow quantity', () => {
  const completed = room({ ventilationBalance: 'balanced', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' });
  const run = airRequiredInputs(project([completed]), completed, { requestedServices: ['heating'] });
  assert.equal(run.ready, false);
  assert.equal(run.needsVentilationFlow, true);
  assert.equal(run.needsInfiltration, false);
});

test('L4.3: a balanced room becomes ready once a ventilation flow is supplied', () => {
  const completed = room({ ventilationBalance: 'balanced', ventilationFlowM3h: 40, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' });
  const readiness = buildSteadyStateReadiness(project([completed]), completed, { requestedServices: ['heating'] });
  assert.equal(airStatus(readiness), 'ready');
  assert.equal(roomEditorMissingCount(readiness), 0);
});

test('L4.4: supply_only needs only a flow; natural needs only airtightness (mode-aware, surface the one thing that is missing)', () => {
  const supply = room({ ventilationBalance: 'supply_only', ventilationFlowM3h: 40, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null });
  assert.equal(airRequiredInputs(project([supply]), supply, { requestedServices: ['heating'] }).ready, true);
  const natural = room({ ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' });
  assert.equal(airRequiredInputs(project([natural]), natural, { requestedServices: ['heating'] }).ready, true);
});

test('L4.5: the consumer Air section surfaces a real ventilation-flow input when the mode needs one', () => {
  assert.match(panelSource, /ventilationFlowM3h/);
  assert.match(panelSource, /Производительность вентиляции/);
});

test('L4.6: fast sequential chip patches preserve Air siblings and explicit null clears', () => {
  const ventilation = sparseAirPatch(EMPTY_AIR, selectVentilationBalance(EMPTY_AIR, 'natural'));
  const afterVentilation = mergeOptimisticAirPatch(EMPTY_AIR, ventilation)!;
  assert.equal(afterVentilation.ventilationBalance, 'natural');
  assert.equal(afterVentilation.airtightnessClass, null);

  const airtightness = sparseAirPatch(afterVentilation, selectAirtightnessClass(afterVentilation, 'average'));
  const afterBoth = mergeOptimisticAirPatch(afterVentilation, airtightness)!;
  assert.equal(afterBoth.ventilationBalance, 'natural');
  assert.equal(afterBoth.airtightnessClass, 'average');

  const clearVentilation = sparseAirPatch(afterBoth, selectVentilationBalance(afterBoth, null));
  const afterClear = mergeOptimisticAirPatch(afterBoth, clearVentilation)!;
  assert.equal(afterClear.ventilationBalance, null);
  assert.equal(afterClear.airtightnessClass, 'average');
});

test('L4.7: Air chips expose immediate selected state and store serializes sparse PATCH responses', () => {
  assert.match(panelSource, /aria-pressed=\{value === o\.value\}/);
  assert.match(storeSource, /roomAirUpdateQueues/);
  assert.match(storeSource, /roomAirUpdateVersions\.get\(key\) === version/);
  assert.match(storeSource, /withOptimisticRoomAir\(before, roomId, patch\.air\)/);
});

test('L4.8: Next cannot loop back to the same still-missing section', () => {
  assert.match(wizardSource, /!sectionIsMissing\(current\)/);
  assert.match(wizardSource, /missingSections\.find\(\(section\) => section !== current\)/);
  assert.doesNotMatch(wizardSource, /\?\? missingSections\[0\]/);
});

test('L4.9: Building Project mobile containers shrink; only step tabs retain local inline scroll', () => {
  assert.match(wizardSource, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(wizardSource, /\.bp-projbar[^}]*flex-wrap: wrap/);
  assert.match(wizardSource, /\.bp-card[^}]*max-width: 100%[^}]*min-width: 0/);
  assert.match(wizardSource, /\.bp-steps[^}]*overflow-x: auto/);
  assert.doesNotMatch(wizardSource, /body\s*\{[^}]*overflow-x:\s*hidden/);
});