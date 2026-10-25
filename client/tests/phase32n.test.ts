/**
 * Phase 3.2N — Professional physical-completeness regressions.
 * Intentionally not executed in the corrective pass; user runs it after review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  projectPhysicalCompleteness,
  resolveRoomPhysicalBoundaries,
  roomPhysicalCompleteness,
} from '../src/features/buildingProject/utils/professionalCompleteness.js';
import { buildSteadyStateReadiness } from '../src/features/buildingProject/utils/smartLoadUx.js';
import { sparseEnvelopePatch } from '../src/features/buildingProject/utils/engineeringSelections.js';
import type { BuildingProject, BuildingRoom, EnvelopeElement, RoomEnvelope } from '../src/features/buildingProject/types.js';

const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/features/buildingProject/components/RoomEngineeringPanel.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/features/buildingProject/types.ts', import.meta.url), 'utf8');

function element(elementId: string): EnvelopeElement {
  return {
    elementId, areaM2: 10, widthM: null, heightM: null, grossAreaM2: null,
    openingIds: null, count: null, uValue: null, constructionTier: 'average',
    uValueSource: 'construction_profile', orientation: null, shgc: null,
    shadingFactor: null, shadingProfile: null, source: null,
  };
}

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'room-1', roomType: 'bedroom', name: 'Комната', areaM2: 20, floorId: 'floor-1',
    extras: {
      geometry: { ceilingHeightM: 2.7, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    envelope: {
      wallElements: [element('wall-1')], windowElements: [], doorElements: [],
      roofElements: [], floorElements: [element('floor-1')],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}

function project(rooms: BuildingRoom[]): BuildingProject {
  return {
    id: 'project-1', name: 'Дом', status: 'systems_configured', createdAt: '', updatedAt: '',
    objectConfirmedAt: '', objectConfirmedRevision: 1, buildingRevision: 1,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20,
    defaultCeilingHeightM: 2.7, insulationLevel: 'medium',
    topology: {
      floorCount: 2,
      floors: [{ id: 'floor-1', level: 1, label: 'Этаж 1' }, { id: 'floor-2', level: 2, label: 'Этаж 2' }],
      basementType: 'none', topBoundaryType: 'direct_roof',
      plantLocation: { kind: 'not_defined', floorId: null, roomId: null },
    },
    rooms, selectedSystems: [], systemsRevision: 1,
    systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('3.2N: missing windows declaration is not equivalent to explicitly no windows', () => {
  const unknown = room();
  const p = project([unknown]);
  assert.ok(roomPhysicalCompleteness(p, unknown).some((issue) => issue.key === 'windows_declaration'));

  const explicitNone = room({ extras: { ...unknown.extras, windows: { ...unknown.extras.windows, count: 0 } } });
  assert.ok(!roomPhysicalCompleteness(project([explicitNone]), explicitNone).some((issue) => issue.key === 'windows_declaration'));
});

test('3.2N: empty exterior-door array is unknown until explicitly declared absent', () => {
  const base = room();
  const unknown = room({ extras: { ...base.extras, geometry: { ...base.extras.geometry, externalDoorCount: null } } });
  const unknownIssues = roomPhysicalCompleteness(project([unknown]), unknown);
  assert.ok(unknownIssues.some((issue) => issue.key === 'external_doors_declaration'));
  const explicitIssues = roomPhysicalCompleteness(project([base]), base);
  assert.ok(!explicitIssues.some((issue) => issue.key === 'external_doors_declaration'));
});

test('3.2N: conditioned intermediate boundary does not require roof automatically', () => {
  const r = room({ extras: { ...room().extras, windows: { count: 0, glazingType: null, areaM2: null } } });
  const p = project([r]);
  assert.equal(resolveRoomPhysicalBoundaries(p, r).above, 'conditioned_space');
  assert.ok(!roomPhysicalCompleteness(p, r).some((issue) => issue.key === 'upper_boundary'));
});

test('3.2N: top-floor room requires an exposed upper element but not an exposed floor', () => {
  const base = room();
  const r = room({
    floorId: 'floor-2',
    extras: { ...base.extras, windows: { ...base.extras.windows, count: 0 } },
    envelope: { ...base.envelope!, floorElements: [], roofElements: [] },
  });
  const issues = roomPhysicalCompleteness(project([r]), r);
  assert.ok(issues.some((issue) => issue.key === 'upper_boundary'));
  assert.ok(!issues.some((issue) => issue.key === 'lower_boundary'));
});

test('3.2N: unknown significant boundary keeps Professional readiness incomplete', () => {
  const base = room();
  const apartment = project([base]) as BuildingProject;
  apartment.objectType = 'apartment';
  apartment.topology = null;
  base.extras = {
    ...base.extras,
    geometry: { ...base.extras.geometry, floorPosition: null, spaceAbove: null, spaceBelow: null },
    windows: { ...base.extras.windows, count: 0 },
  };
  const readiness = buildSteadyStateReadiness(apartment, base, { requestedServices: ['heating', 'cooling'] });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.items.some((item) => item.key === 'upper_boundary' && item.status === 'missing'));
  assert.ok(readiness.items.some((item) => item.key === 'lower_boundary' && item.status === 'missing'));
});

test('3.2N: physically described room becomes complete', () => {
  const base = room();
  const complete = room({ extras: { ...base.extras, windows: { ...base.extras.windows, count: 0 } } });
  assert.deepEqual(roomPhysicalCompleteness(project([complete]), complete), []);
  assert.deepEqual(projectPhysicalCompleteness(project([complete])), []);
});

test('3.2N: Professional action is blocked by physical completeness, QUICK action is not', () => {
  assert.match(wizardSource, /disabled=\{!gate\.ok \|\| !physicalInputsReady\}/);
  assert.match(wizardSource, /loadMode !== 'steady_state'/);
  assert.match(wizardSource, /buildProjectMissingSummary/);
});

test('3.2N: no-windows declaration is persisted separately from an empty array', () => {
  assert.match(panelSource, /count: explicitNone \? null : 0/);
  assert.match(panelSource, /Пустой список не считается подтверждением отсутствия окон/);
});

test('3.2N post-QA: envelope PATCH is typed sparsely without RoomEnvelope casts', () => {
  assert.match(typesSource, /export type RoomEnvelopePatch/);
  assert.match(typesSource, /envelope\?: RoomEnvelopePatch \| null/);
  assert.doesNotMatch(panelSource, /as BuildingRoomInput\['envelope'\]/);
});

test('3.2N post-QA: clearing one envelope category omits every sibling array', () => {
  const before: RoomEnvelope = {
    wallElements: [element('wall')],
    windowElements: [element('window')],
    doorElements: [element('door')],
    roofElements: [element('roof')],
    floorElements: [element('floor')],
  };
  const keys: Array<keyof RoomEnvelope> = [
    'wallElements', 'windowElements', 'doorElements', 'roofElements', 'floorElements',
  ];
  for (const key of keys) {
    const patch = sparseEnvelopePatch(before, { ...before, [key]: [] });
    assert.deepEqual(patch, { [key]: [] });
    for (const sibling of keys.filter((candidate) => candidate !== key)) {
      assert.equal(sibling in patch, false);
    }
  }
});

test('3.2N: result explanation aggregates room components for heating and cooling', () => {
  assert.match(wizardSource, /sumObjectComponent/);
  assert.match(wizardSource, /Ограждения \{demandDisplay\(heating\.transmission\)\} \+ Воздух/);
  assert.match(wizardSource, /Солнце \{demandDisplay\(cooling\.solar\)\} \+ Внутренние теплопритоки/);
});
