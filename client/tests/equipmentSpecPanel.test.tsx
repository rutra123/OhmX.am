/** Customer specification markup: grouped cards, no tables, missing items separated, mobile-safe CSS. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BuildingLoadCalculation, BuildingProject } from '../src/features/buildingProject/types.js';
import { EquipmentSpecPanel } from '../src/features/buildingProject/components/EquipmentSpecPanel.js';

const project = {
  id: 'p-render', rooms: [
    { id: 'l', roomType: 'living_room', name: 'Гостиная', areaM2: 35, floorId: null, extras: {} },
    { id: 'b', roomType: 'bedroom', name: 'Спальня', areaM2: 18, floorId: null, extras: {} },
  ],
  topology: null,
  systemsConfiguration: {
    requestedServices: ['heating', 'cooling'],
    roomAssignments: [
      { roomId: 'l', servicePreferences: { heating: 'required', cooling: 'required' }, heatingSystems: [{ familyId: 'hydronic_floor_heating' }, { familyId: 'fan_coils' }], coolingSystems: [{ familyId: 'fan_coils' }] },
      { roomId: 'b', servicePreferences: { heating: 'required', cooling: 'required' }, heatingSystems: [{ familyId: 'fan_coils' }], coolingSystems: [{ familyId: 'fan_coils' }] },
    ],
    architecture: { spaceHeatingSourceId: 'reversible_air_to_water_heat_pump', spaceCoolingSourceId: 'reversible_air_to_water_heat_pump', spaceCombinedSourceId: null, distribution: { id: 'hydronic_2pipe_heating_cooling', circuitKind: '2pipe' } },
  },
} as unknown as BuildingProject;

test('full specification renders grouped cards without tables', () => {
  const html = renderToStaticMarkup(createElement(EquipmentSpecPanel, { project, loads: null as BuildingLoadCalculation | null, towelWarmers: [] }));
  assert.match(html, /Спецификация оборудования/);
  assert.match(html, /2\. Гидравлическое распределение/);
  assert.match(html, /6\. Необходимое оборудование, которого нет в каталоге/);
  assert.match(html, /Это не полная стоимость проекта/);
  assert.match(html, /Для инженера: допущения, гидравлика, исходные данные/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('compact progressive summary in the systems step', () => {
  const html = renderToStaticMarkup(createElement(EquipmentSpecPanel, { project, loads: null, towelWarmers: [], compact: true }));
  assert.match(html, /Предварительная спецификация оборудования/);
  assert.match(html, /Водяных контуров<\/dt><dd>\d+/);
  assert.match(html, /после расчёта нагрузок/);
});

test('mobile CSS: BOM rows wrap, no fixed widths', () => {
  const src = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
  assert.match(src, /\.bp-bom-line \{[^}]*overflow-wrap: anywhere;/);
  assert.match(src, /\.bp-bom-meta \{[^}]*flex-wrap: wrap;/);
  assert.match(src, /\.bp-kv dd\.bp-kv-wrap \{[^}]*white-space: normal;/);
});

test('mobile CSS: label column keeps a minimum width when values wrap', () => {
  const src = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
  assert.match(src, /\.bp-kv \{ display: grid; grid-template-columns: minmax\(8em, 1fr\)/);
});
