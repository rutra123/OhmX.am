/**
 * Phase 3.2P-B4A — Engineering quality UI presentation contracts.
 *
 * Presentation-only tests. The server remains authoritative for levels,
 * gateStatus, coverage, criticality, provenance and blocking fields.
 * Intentionally not executed by the agent per the B4A handoff boundary.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildEngineeringQualityPresentation,
  engineeringParameterPresentation,
  engineeringProvenanceLabel,
  qualityGatePresentation,
  qualityLevelPresentation,
  shouldShowEngineeringQuality,
} from '../src/features/buildingProject/utils/engineeringQualityPresentation.js';
import type {
  BuildingRoom,
  EngineeringQualityResult,
} from '../src/features/buildingProject/types.js';

const wizardSource = readFileSync(
  new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url),
  'utf8',
);
const panelSource = readFileSync(
  new URL('../src/features/buildingProject/components/EngineeringQualityPanel.tsx', import.meta.url),
  'utf8',
);

const rooms: Pick<BuildingRoom, 'id' | 'name'>[] = [
  { id: '8a2a6bd3-112e-4d68-9bb0-663f797719bd', name: 'Кухня-гостиная 1' },
];

function quality(overrides: Partial<EngineeringQualityResult> = {}): EngineeringQualityResult {
  return {
    qualityModelId: 'ohmx.professional-quality.v1',
    qualityModelVersion: '1.0.0',
    evaluatedAt: '2026-09-02T00:00:00.000Z',
    requestedLevel: 2,
    maximumEligibleLevel: 1,
    gateStatus: 'BLOCKED',
    coverage: {
      declaredAreaM2: 180,
      modeledAreaM2: 50,
      ratio: 50 / 180,
      scope: 'UNKNOWN',
      confirmation: 'UNCONFIRMED',
    },
    fields: [],
    blockingFields: [],
    warnings: [],
    assumptions: [],
    ...overrides,
  };
}

test('B4A-01: Level 1 is presented as Предварительный', () => {
  assert.equal(qualityLevelPresentation(1).label, 'Предварительный');
});

test('B4A-02: requested Level 2 is presented as Professional requirement', () => {
  const view = buildEngineeringQualityPresentation(quality(), rooms);
  assert.equal(view.requested.label, 'Профессиональный');
  assert.equal(view.requested.level, 2);
});

test('B4A-03: BLOCKED quality does not conditionally hide numeric result card', () => {
  assert.match(wizardSource, /<PrimaryLoadResult loads=\{loads\} \/>/);
  assert.match(wizardSource, /<EngineeringQualityPanel loads=\{loads\} rooms=\{project\.rooms\} \/>/);
  assert.ok(wizardSource.indexOf('<PrimaryLoadResult loads={loads} />') < wizardSource.indexOf('<EngineeringQualityPanel loads={loads} rooms={project.rooms} />'));
});

test('B4A-04: BLOCKED is not worded as calculation failure', () => {
  assert.equal(qualityGatePresentation('BLOCKED').label, 'Для выбранного уровня нужно уточнить данные');
  assert.doesNotMatch(panelSource, /Расч[её]т не выполнен|Ошибка расч[её]та/);
});

test('B4A-05: PASS confirms requested quality level', () => {
  assert.equal(qualityGatePresentation('PASS').label, 'Уровень подтверждён');
});

test('B4A-06: PASS_WITH_WARNINGS is confirmed with remarks', () => {
  assert.equal(qualityGatePresentation('PASS_WITH_WARNINGS').label, 'Уровень подтверждён, есть замечания');
});

test('B4A-07: maximumEligibleLevel zero is insufficient data', () => {
  assert.deepEqual(qualityLevelPresentation(0), {
    level: 0,
    label: 'Недостаточно данных',
    ordinal: 'Уровень 0 из 3',
  });
});

test('B4A-08: missing engineeringQuality has explicit legacy unassessed message', () => {
  assert.match(panelSource, /Качество исходных данных для этого старого расчёта не оценивалось\./);
});

test('B4A-09: legacy/unassessed is not assigned Level 1', () => {
  const legacyGuardIndex = panelSource.indexOf('if (!quality) return <LegacyQualityNotice />;');
  const qualityPresentationIndex = panelSource.indexOf('const presentation = buildEngineeringQualityPresentation');
  const legacyNoticeSource = panelSource.slice(
    panelSource.indexOf('function LegacyQualityNotice()'),
    panelSource.indexOf('export function EngineeringQualityPanel'),
  );

  assert.notEqual(legacyGuardIndex, -1);
  assert.notEqual(qualityPresentationIndex, -1);
  assert.ok(legacyGuardIndex < qualityPresentationIndex);
  assert.doesNotMatch(legacyNoticeSource, /Предварительный|Уровень\s*1/);
});

test('B4A-10: QUICK does not show Professional quality status', () => {
  assert.equal(shouldShowEngineeringQuality('quick'), false);
  assert.equal(shouldShowEngineeringQuality('steady_state'), true);
});

test('B4A-11: canonical blocking parameters have readable labels', () => {
  assert.equal(engineeringParameterPresentation('U_wall').label, 'Теплопередача наружных стен');
  assert.equal(engineeringParameterPresentation('SHGC').label, 'Солнечный фактор стеклопакета');
  assert.equal(engineeringParameterPresentation('airChangesPerHour').label, 'Герметичность здания / воздухообмен');
});

test('B4A-12: UUID is not used as primary room label', () => {
  const fieldId = 'room:8a2a6bd3-112e-4d68-9bb0-663f797719bd:heating:air:ach';
  const q = quality({
    fields: [{
      fieldId,
      roomId: rooms[0].id,
      parameter: 'airChangesPerHour',
      service: 'heating',
      effectiveValue: 0.5,
      unit: '1/h',
      effectiveProvenance: 'PROFILE_DEFAULT',
      userConfirmed: false,
      quality: 'LOW',
      criticality: 'CRITICAL',
      requiredQuality: 'HIGH',
      status: 'blocked',
      messageCode: 'critical_profile_default',
    }],
    blockingFields: [{
      fieldId,
      roomId: rooms[0].id,
      service: 'heating',
      parameter: 'airChangesPerHour',
      reasonCode: 'critical_profile_default',
      requiredQuality: 'HIGH',
    }],
  });
  const group = buildEngineeringQualityPresentation(q, rooms).blockerGroups[0];
  assert.equal(group.roomLabel, 'Кухня-гостиная 1');
  assert.doesNotMatch(group.roomLabel ?? '', /8a2a6bd3/);
});

test('B4A-13: unknown parameter uses safe generic fallback', () => {
  assert.equal(
    engineeringParameterPresentation('futureParameter').label,
    'Требуется уточнение одного из исходных параметров',
  );
});

test('B4A-14: PROFILE_DEFAULT is described as a typical value', () => {
  assert.equal(engineeringProvenanceLabel('PROFILE_DEFAULT'), 'Использовано типовое значение');
});

test('B4A-15: CERTIFIED_SPEC uses confirmed documentation wording', () => {
  assert.equal(engineeringProvenanceLabel('CERTIFIED_SPEC'), 'Подтверждено технической документацией');
});

test('B4A-16: MEASURED uses measurement wording', () => {
  assert.equal(engineeringProvenanceLabel('MEASURED'), 'Получено измерением');
});

test('B4A-17: unknown/unconfirmed coverage produces warning', () => {
  const coverage = buildEngineeringQualityPresentation(quality(), rooms).coverage;
  assert.equal(coverage.warning, 'Не подтверждено, что расчёт охватывает весь объект.');
});

test('B4A-18: coverage 180/50 never becomes an accuracy percentage claim', () => {
  const coverage = buildEngineeringQualityPresentation(quality(), rooms).coverage;
  assert.deepEqual(coverage.metrics, ['Площадь объекта: 180 м²', 'Площадь помещений в расчёте: 50 м²']);
  assert.doesNotMatch(JSON.stringify(coverage), /%|точност|нагрузк.*процент/i);
});

test('B4A-19: numeric output remains visible for BLOCKED gate', () => {
  assert.match(wizardSource, /loads && storedLoadPhysicallyComplete && <PrimaryLoadResult/);
  assert.doesNotMatch(wizardSource, /gateStatus\s*===\s*['"]BLOCKED['"][\s\S]{0,160}PrimaryLoadResult/);
});

test('B4A-20: mobile quality presentation uses stacked wrapping blocks, not a table', () => {
  assert.match(panelSource, /display: 'grid'/);
  assert.match(panelSource, /minWidth: 0/);
  assert.doesNotMatch(panelSource, /<table|gridTemplateColumns:\s*['"][^'"]*repeat\(/);
});

test('B4A-21: optional technical details display model and version', () => {
  assert.match(panelSource, /Подробнее о качестве данных/);
  assert.match(panelSource, /qualityModelId/);
  assert.match(panelSource, /qualityModelVersion/);
});

test('B4A-22: raw BLOCKED is not the primary user-facing status', () => {
  assert.equal(buildEngineeringQualityPresentation(quality(), rooms).gate.label, 'Для выбранного уровня нужно уточнить данные');
});

test('B4A-23: calculation success and quality status are separate UI sections', () => {
  assert.match(wizardSource, /Расчёт выполнен/);
  assert.match(panelSource, /Качество исходных данных/);
});

test('B4A-24: old misleading Professional-complete phrase is removed', () => {
  assert.doesNotMatch(wizardSource, /Все данные для профессионального расчёта заполнены/);
  assert.doesNotMatch(panelSource, /Все данные для профессионального расчёта заполнены/);
});
