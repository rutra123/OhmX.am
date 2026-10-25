/**
 * Phase 3.2L.2 — focused room editor + required-input gate.
 *
 * The repository has no React component-test harness, so this targeted suite
 * combines source-contract smoke assertions with the existing pure readiness
 * resolver. It must fail before the UI patch (RED), then pass after it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSteadyStateReadiness } from '../src/features/buildingProject/utils/smartLoadUx.js';
import type { BuildingProject, BuildingRoom } from '../src/features/buildingProject/types.js';

const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/features/buildingProject/components/RoomEngineeringPanel.tsx', import.meta.url), 'utf8');
const mobileNavSource = readFileSync(new URL('../src/features/buildingProject/utils/mobileNav.ts', import.meta.url), 'utf8');
const focusedEditorSource = wizardSource.slice(
  wizardSource.indexOf('function FocusedRoomEditor'),
  wizardSource.indexOf('function HydronicRequirementsBlock'),
);

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Кухня-гостиная', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null }, windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
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

test('L2.1: focused room editor hides all project-level navigation and chrome', () => {
  assert.match(wizardSource, /\{focusedRoom\s*\?\s*\(/);
  assert.match(wizardSource, /<FocusedRoomEditor/);
  assert.match(wizardSource, /!focusedRoom\s*&&\s*<div className="bp-steps"/);
  assert.match(wizardSource, /!focusedRoom\s*&&\s*project\s*&&/);
});

test('L2.2: project tabs are absent while editing a room', () => {
  assert.match(wizardSource, /!focusedRoom\s*&&\s*<div className="bp-steps" aria-label="Шаги">/);
});

test('L2.3: project service summary is absent while editing a room', () => {
  assert.match(wizardSource, /!focusedRoom\s*&&\s*project\s*&&\s*\(\s*<div className="bp-projbar"/s);
});

test('L2.4: focused required count is derived from buildSteadyStateReadiness', () => {
  assert.match(wizardSource, /buildSteadyStateReadiness\(project, focusedRoom/);
  assert.match(wizardSource, /roomEditorMissingCount|requiredMissingCount/);
  assert.doesNotMatch(wizardSource, /const\s+FOCUSED_REQUIRED_FIELDS\s*=/);
});

test('L2.5: heating-only does not require cooling-only room fields', () => {
  const readiness = buildSteadyStateReadiness(project(), room(), { requestedServices: ['heating'] });
  assert.equal(readiness.items.find((item) => item.key === 'windows')?.status, 'na');
  assert.equal(readiness.items.find((item) => item.key === 'internal')?.status, 'na');
});

test('L2.6: cooling marks relevant incomplete window and internal inputs', () => {
  const partial = room({
    roomType: 'unknown_room',
    envelope: {
      ...room().envelope!,
      windowElements: [{ ...room().envelope!.windowElements[0], elementId: 'window-1', orientation: null, constructionTier: null, shadingProfile: null, widthM: null, heightM: null }],
    },
    internalGains: null,
  });
  const readiness = buildSteadyStateReadiness(project([partial]), partial, { requestedServices: ['cooling'] });
  assert.equal(readiness.items.find((item) => item.key === 'windows')?.status, 'missing');
  assert.equal(readiness.items.find((item) => item.key === 'internal')?.status, 'missing');
});

test('L2.7: inherited height and profile-resolved occupancy are not marked missing', () => {
  const inherited = room({
    extras: { ...room().extras, geometry: { ...room().extras.geometry, ceilingHeightM: null } },
    internalGains: null,
  });
  const readiness = buildSteadyStateReadiness(project([inherited]), inherited, { requestedServices: ['cooling'] });
  assert.equal(readiness.items.find((item) => item.key === 'air')?.status, 'ready');
  assert.equal(readiness.items.find((item) => item.key === 'internal')?.status, 'ready');
});

test('L2.8: requiredMissingCount decreases immediately when a required field is filled', () => {
  const incomplete = room({ areaM2: null });
  const before = buildSteadyStateReadiness(project([incomplete]), incomplete, { requestedServices: ['heating'] });
  const complete = { ...incomplete, areaM2: 20 };
  const after = buildSteadyStateReadiness(project([complete]), complete, { requestedServices: ['heating'] });
  assert.equal(before.missingCount, after.missingCount + 1);
  assert.equal(after.items.find((item) => item.key === 'area')?.status, 'ready');
});

test('L2.9: Done with missing inputs stays in the editor and shows inline guidance', () => {
  assert.match(wizardSource, /requiredMissingCount\s*>\s*0/);
  assert.match(wizardSource, /Заполните ещё \$\{requiredMissingCount\} обязательных параметров/);
  assert.match(wizardSource, /setRoomDoneMessage/);
});

test('L2.10: Done with zero missing inputs exits the focused editor', () => {
  assert.match(wizardSource, /requiredMissingCount\s*===\s*0/);
  assert.match(wizardSource, /if \(missingEdit\) await returnToLoadsAfterEdit\(\);/);
  assert.match(wizardSource, /else closeRoomEditor\(\);/);
});

test('L2.11: Professional missing-flow editor returns to Loads with its mode', () => {
  assert.match(wizardSource, /Готово — вернуться к расчёту/);
  assert.match(wizardSource, /resolveReturnTarget\(missingEdit, loadMode\)/);
  assert.match(wizardSource, /setStep\(target\.step\)/);
});

test('L2.12: normal room editor returns to the compact Rooms list', () => {
  assert.match(wizardSource, /onBack=\{closeRoomEditor\}/);
  assert.match(wizardSource, /onDone=\{\(\) => void doneRoomEditor\(\)\}/);
  assert.match(wizardSource, /setEngRoomId\(null\)/);
});

test('L2.13: first required/missing section is opened by default', () => {
  assert.match(wizardSource, /firstMissingSection\(readiness\)/);
  assert.match(wizardSource, /defaultOpenSection/);
});

test('L2.14: the room accordion has one shared open section and a next-section action', () => {
  assert.match(wizardSource, /type RoomEditorSectionKey =/);
  assert.match(wizardSource, /setOpenSection\(\(current\) => current === key \? null : key\)/);
  assert.match(panelSource, /onNext\?\.\(\)/);
  assert.match(panelSource, /title="Ограждения"/);
  assert.match(panelSource, /title="Расширенные"/);
});

test('L2.15: the patch remains presentation/navigation-only', () => {
  assert.doesNotMatch(focusedEditorSource, /roomId\s*=|floorId\s*=|buildingRevision\s*=|systemsRevision\s*=/);
  assert.doesNotMatch(focusedEditorSource, /calculateSteadyState|Q_tr|Q_air|PVGIS|CONSTRUCTION_U_VALUES/);
  assert.doesNotMatch(panelSource, /fetch\(|fetchLoadState|confirmObject|saveSystemsConfiguration/);
  assert.match(mobileNavSource, /returnStep: 'loads'/);
});
