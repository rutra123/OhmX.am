/** Configurator redesign: step navigation, grouped validation, room/object glyph coverage, source + towel controls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BuildingProject, EngineeringRoomAssignment, EngineeringSystemFamily } from '../src/features/buildingProject/types.js';
import { groupValidationIssues, hydronicValueText, wizardSteps } from '../src/features/buildingProject/utils/configuratorPresentation.js';
import { hasRoomGlyph, OBJECT_GLYPH_TYPES, ObjectGlyph, RoomGlyph } from '../src/features/buildingProject/components/equipmentSelection/RoomIcon.js';
import { RoomEquipmentSelector, SourceChoiceList, TowelWarmerPanel } from '../src/features/buildingProject/components/equipmentSelection/EquipmentSelection.js';
import { Notice, StepNav } from '../src/features/buildingProject/components/configurator/ConfiguratorUi.js';
import { roomServiceSummary } from '../src/features/buildingProject/utils/equipmentPresentation.js';

const buildingCatalog = JSON.parse(readFileSync(new URL('./fixtures/buildingCatalog.2026-10-14.json', import.meta.url), 'utf8')) as { roomTypes: Array<{ value: string }>; objectTypes: Array<{ value: string }> };
const families = (JSON.parse(readFileSync(new URL('./fixtures/systemsCatalog.2026-10-14.json', import.meta.url), 'utf8')) as { systemFamilies: EngineeringSystemFamily[] }).systemFamilies;
const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const specSource = readFileSync(new URL('../src/features/buildingProject/components/EquipmentSpecPanel.tsx', import.meta.url), 'utf8');

test('every catalog room type and object type has its own pictogram', () => {
  assert.equal(buildingCatalog.roomTypes.length, 33);
  for (const t of buildingCatalog.roomTypes) assert.ok(hasRoomGlyph(t.value), `room type without glyph: ${t.value}`);
  assert.deepEqual([...OBJECT_GLYPH_TYPES].sort(), buildingCatalog.objectTypes.map((t) => t.value).sort());
  const unknown = renderToStaticMarkup(createElement(RoomGlyph, { roomType: 'something_new' }));
  assert.match(unknown, /<path/);
  assert.match(renderToStaticMarkup(createElement(ObjectGlyph, { objectType: 'private_house' })), /data-glyph="object-private_house"/);
});

test('wizard and spec panel no longer use emoji pictograms', () => {
  assert.doesNotMatch(wizardSource, /[🔥❄🛋🛏🍽🚿🚽🥾🧸💼🌙👔🍳🚪🏛🪜💧🧺🌿🪟☀🚗📦🏭🖧☕🔧🗣🎫♻🌬]/u);
  assert.doesNotMatch(specSource, /[🔥❄🛒⬇]/u);
});

test('step rules are unchanged; done flags derive from project status only', () => {
  const none = wizardSteps(null, false);
  assert.deepEqual(none.map((s) => [s.id, s.enabled, s.done]), [['object', true, false], ['rooms', false, false], ['systems', false, false], ['review', false, false], ['loads', false, false]]);
  const draft = wizardSteps({ status: 'draft' } as BuildingProject, false);
  assert.deepEqual(draft.map((s) => s.enabled), [true, true, false, false, false]);
  const confirmed = wizardSteps({ status: 'object_confirmed' } as BuildingProject, false);
  assert.deepEqual(confirmed.map((s) => s.enabled), [true, true, true, true, false]);
  assert.deepEqual(confirmed.map((s) => s.done), [true, true, false, false, false]);
  const configured = wizardSteps({ status: 'systems_configured' } as BuildingProject, true);
  assert.deepEqual(configured.map((s) => s.enabled), [true, true, true, true, true]);
  assert.deepEqual(configured.map((s) => s.done), [true, true, true, true, true]);
  assert.equal(wizardSteps({ status: 'systems_configured' } as BuildingProject, false)[4].done, false, 'stale/missing loads are not done');
});

test('step navigation: current step, locked steps and accessible names', () => {
  const html = renderToStaticMarkup(createElement(StepNav, { steps: wizardSteps({ status: 'object_confirmed' } as BuildingProject, false), current: 'systems', onSelect: () => undefined }));
  assert.equal((html.match(/<button/g) || []).length, 5);
  assert.match(html, /aria-current="step" aria-label="3\. Системы"/);
  assert.match(html, /disabled="" aria-label="5\. Нагрузки, станет доступно позже"/);
  assert.match(html, /aria-label="1\. Объект, выполнено"/);
  assert.match(html, /Шаг 3 из 5/);
});

test('validation issues are grouped by message with their rooms; nothing is dropped', () => {
  const rooms = [{ id: 'a', name: 'Гостиная' }, { id: 'b', name: 'Кухня' }, { id: 'c', name: 'Спальня' }];
  const issues = [
    { code: 'room_warning', message: 'Система Фанкойлы требует инженерной проверки.', roomId: 'a' },
    { code: 'room_warning', message: 'Система Фанкойлы требует инженерной проверки.', roomId: 'b' },
    { code: 'room_warning', message: 'Другая проверка.', roomId: 'c', service: 'cooling' as const },
    { code: 'project', message: 'Без помещения.' },
    { code: 'room_warning', message: 'Система Фанкойлы требует инженерной проверки.', roomId: 'a' },
  ];
  const grouped = groupValidationIssues(issues, rooms);
  assert.equal(grouped.length, 3);
  assert.deepEqual(grouped[0].rooms, ['Гостиная', 'Кухня']);
  assert.equal(grouped.reduce((n, g) => n + g.count, 0), issues.length);
  assert.equal(grouped[1].service, 'cooling');
  assert.deepEqual(grouped[2].rooms, []);
});

test('internal hydronic codes are shown in plain language', () => {
  assert.equal(hydronicValueText('pending_design'), 'определится при проектировании');
  assert.equal(hydronicValueText('требуется'), 'требуется');
  assert.doesNotMatch(wizardSource, /value: 'pending_design'/);
  assert.doesNotMatch(wizardSource, /\(pending_design\)/);
});

test('source list: all options visible by default; a chosen option adds a fold toggle; nothing chosen shows all', () => {
  // SourceChoiceList is expanded by default (see the comment on the component), so the customer sees every
  // source option; "Скрыть другие варианты" only appears once something is chosen. The collapsed state
  // needs a click, which static markup cannot exercise, so only the default state is asserted here.
  const opts = (pressedKey: string | null) => ['a', 'b', 'c'].map((key) => ({ key, familyId: null, glyph: 'gas_boiler' as const, label: `L-${key}`, pressed: key === pressedKey, onPress: () => undefined }));
  const chosen = renderToStaticMarkup(createElement(SourceChoiceList, { service: 'heating', options: opts('b') }));
  assert.equal((chosen.match(/class="eq-card /g) || []).length, 3);
  assert.match(chosen, /aria-pressed="true"/);
  assert.match(chosen, /aria-expanded="true"[^>]*>Скрыть другие варианты/);
  const open = renderToStaticMarkup(createElement(SourceChoiceList, { service: 'heating', options: opts(null) }));
  assert.equal((open.match(/class="eq-card /g) || []).length, 3);
  assert.doesNotMatch(open, /Показать другие варианты|Скрыть другие варианты/);
});

test('towel warmer: kind is a radio group, quantity + remove available; absent shows add', () => {
  const html = renderToStaticMarkup(createElement(TowelWarmerPanel, {
    roomName: 'Ванная', selection: { kind: 'electric', quantity: 2 }, quantityControl: createElement('output', null, '2'),
    onKind: () => undefined, onRemove: () => undefined, onAdd: () => undefined,
  }));
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/type="radio"/g) || []).length, 2);
  assert.match(html, /<input type="radio"[^>]*checked=""/);
  assert.match(html, /data-glyph="towel_rail_electric"/);
  assert.match(html, /Убрать полотенцесушитель/);
  const none = renderToStaticMarkup(createElement(TowelWarmerPanel, { roomName: 'Ванная', selection: null, quantityControl: null, onKind: () => undefined, onRemove: () => undefined, onAdd: () => undefined }));
  assert.match(none, /Добавить полотенцесушитель/);
  assert.doesNotMatch(none, /type="radio"/);
});

test('recommended badge marks the suggested scheme without selecting it', () => {
  const a = {
    roomId: 'r', roomName: 'Гостиная', roomPurpose: 'living_room', sourceSystemId: null, sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
    servicePreferences: { heating: 'optional', cooling: 'optional' }, heatingSystems: [], coolingSystems: [],
  } as unknown as EngineeringRoomAssignment;
  const html = renderToStaticMarkup(createElement(RoomEquipmentSelector, {
    roomId: 'r', assignment: a, requested: ['heating'], families,
    summaries: { heating: roomServiceSummary(a, 'heating', families), cooling: roomServiceSummary(a, 'cooling', families) },
    onToggle: () => undefined, onNotRequired: () => undefined, recommended: { heating: ['fan_coils'] },
  }));
  assert.equal((html.match(/eq-badge-rec/g) || []).length, 1);
  assert.match(html, /data-family="fan_coils"[^]*?Рекомендуем/);
  assert.doesNotMatch(html, /<input type="checkbox"[^>]*checked=""/, 'recommended ≠ selected');
});

test('notices carry a tone and an icon (not colour alone)', () => {
  const html = renderToStaticMarkup(createElement(Notice, { tone: 'danger', title: 'Нужно исправить (1)' }, 'текст'));
  assert.match(html, /data-tone="danger"/);
  assert.match(html, /<svg/);
  assert.match(html, /Нужно исправить \(1\)/);
});

test('shared plant is separated from room equipment (display only, data untouched)', async () => {
  const { roomTerminalView, sharedRoomSource } = await import('../src/features/buildingProject/utils/equipmentPresentation.js');
  const fam = (id: string) => ({ familyId: id, label: families.find((f) => f.id === id)!.label }) as EngineeringRoomAssignment['heatingSystems'][number];
  const room = (heating: string[], source: string | null) => ({
    servicePreferences: { heating: 'optional', cooling: 'not_required' }, sourceSystemIds: { heating: source, cooling: null },
    heatingSystems: heating.map(fam), coolingSystems: [],
  }) as unknown as EngineeringRoomAssignment;
  const living = room(['fan_coils', 'hydronic_floor_heating'], 'reversible_air_to_water_heat_pump');
  const snapshot = JSON.stringify(living);
  const v = roomTerminalView(living, 'heating', families);
  assert.deepEqual(v.items.map((i) => i.familyId), ['fan_coils', 'hydronic_floor_heating']);
  assert.equal(v.source?.familyId, 'reversible_air_to_water_heat_pump');
  assert.equal(JSON.stringify(living), snapshot, 'assignment not mutated');
  assert.equal(roomTerminalView(living, 'cooling', families).state, 'not_required');
  assert.equal(roomTerminalView(room([], 'gas_boiler'), 'heating', families).state, 'empty', 'a source alone is not room equipment');
  const views = [v, roomTerminalView(room(['fan_coils'], 'reversible_air_to_water_heat_pump'), 'heating', families)];
  assert.equal(sharedRoomSource(views)?.familyId, 'reversible_air_to_water_heat_pump');
  assert.equal(sharedRoomSource([...views, roomTerminalView(room(['fan_coils'], 'gas_boiler'), 'heating', families)]), null, 'mixed sources are not collapsed');
  const html = renderToStaticMarkup(createElement(RoomEquipmentSelector, {
    roomId: 'r', assignment: living, requested: ['heating'], families,
    summaries: { heating: roomServiceSummary(living, 'heating', families), cooling: roomServiceSummary(living, 'cooling', families) },
    onToggle: () => undefined, onNotRequired: () => undefined,
  }));
  assert.match(html, /class="eq-source-note"/);
  assert.match(html, /общий для объекта/);
});

test('every BOM group heading has an equipment pictogram', () => {
  for (const g of ['manifold', 'circ_pump', 'controller', 'pipe_valve', 'hp_air_water']) assert.match(specSource, new RegExp(`'${g}'`));
  assert.match(specSource, /className="bp-h bp-bom-head"/);
});
