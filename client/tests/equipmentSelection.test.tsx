/** Equipment selection redesign: icon mapping completeness, selection-rule parity, accessible markup. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EngineeringRoomAssignment, EngineeringSystemFamily } from '../src/features/buildingProject/types.js';
import { roomServiceOptions } from '../src/features/buildingProject/systemsSourceModes.js';
import {
  EQUIPMENT_PRESENTATION,
  equipmentDisplayGroup,
  equipmentGlyphs,
  groupEquipmentOptions,
  hasEquipmentPresentation,
  isRoomOptionSelected,
  roomServiceSummary,
} from '../src/features/buildingProject/utils/equipmentPresentation.js';
import { EQUIPMENT_GLYPH_KEYS, EquipmentGlyph } from '../src/features/buildingProject/components/equipmentSelection/EquipmentIcon.js';
import { RoomEquipmentSelector, RoomNavigator } from '../src/features/buildingProject/components/equipmentSelection/EquipmentSelection.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/systemsCatalog.2026-10-14.json', import.meta.url), 'utf8')) as { systemFamilies: EngineeringSystemFamily[] };
const families = catalog.systemFamilies;
const SERVICES = ['heating', 'cooling'] as const;

function assignment(patch: Partial<EngineeringRoomAssignment> = {}): EngineeringRoomAssignment {
  return {
    roomId: 'r1', roomName: 'Гостиная 1', roomPurpose: 'living_room', sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
    servicePreferences: { heating: 'optional', cooling: 'optional' },
    heatingSystems: [], coolingSystems: [],
    ...patch,
  } as EngineeringRoomAssignment;
}
const sel = (familyId: string) => {
  const f = families.find((x) => x.id === familyId)!;
  return { familyId, label: f.label, service: f.service, kind: f.kind, scope: f.scope } as EngineeringRoomAssignment['heatingSystems'][number];
};

// The pre-redesign label function, kept verbatim as the parity oracle.
function legacyAssignmentLabel(a: EngineeringRoomAssignment | undefined, service: 'heating' | 'cooling') {
  if (!a || a.servicePreferences[service] === 'not_required') return 'нет';
  const systems = service === 'heating' ? a.heatingSystems : a.coolingSystems;
  const sourceId = a.sourceSystemIds[service];
  const parts: string[] = [];
  if (sourceId) parts.push(families.find((f) => f.id === sourceId)?.label || sourceId);
  for (const item of systems) if (item.familyId !== sourceId) parts.push(item.label);
  return parts.length ? parts.join(' + ') : '—';
}

test('every catalog family has a purpose-built pictogram (no fallback)', () => {
  assert.equal(families.length, 34);
  for (const f of families) {
    assert.ok(hasEquipmentPresentation(f.id), `unmapped family ${f.id}`);
    for (const g of equipmentGlyphs(f.id)) {
      assert.notEqual(g, 'fallback', `${f.id} uses the fallback glyph`);
      assert.ok(EQUIPMENT_GLYPH_KEYS.includes(g), `${f.id} → unknown glyph ${g}`);
    }
    assert.ok(EQUIPMENT_PRESENTATION[f.id].subtitle.length > 0);
  }
});

test('combined schemes show two pictograms; individual scheme and single devices show one', () => {
  for (const f of families.filter((x) => x.kind === 'solution_template' && x.service === 'heating_and_cooling')) {
    const n = equipmentGlyphs(f.id).length;
    assert.equal(n, f.id === 'individual_combined_scheme' ? 1 : 2, f.id);
  }
  for (const f of families.filter((x) => x.kind !== 'solution_template')) assert.equal(equipmentGlyphs(f.id).length, 1, f.id);
});

test('distinct devices never share a glyph; documented shared glyphs only', () => {
  const owners = new Map<string, string[]>();
  for (const f of families) {
    const g = equipmentGlyphs(f.id);
    if (g.length !== 1) continue;
    owners.set(g[0], [...(owners.get(g[0]) || []), f.id]);
  }
  const shared = [...owners.entries()].filter(([, ids]) => ids.length > 1);
  // Building supply is genuinely the same concept for both services.
  assert.deepEqual(shared, [['building_supply', ['external_building_heating_supply', 'external_building_cooling_supply']]]);
});

test('unknown family falls back to the generic glyph and the "other" group', () => {
  assert.deepEqual(equipmentGlyphs('brand_new_family'), ['fallback']);
  assert.equal(equipmentDisplayGroup({ id: 'brand_new_family', kind: 'terminal', service: 'heating' }, 'heating'), 'other');
  assert.equal(equipmentDisplayGroup({ id: 'new_template', kind: 'solution_template', service: 'heating_and_cooling' }, 'cooling'), 'combined');
  const markup = renderToStaticMarkup(createElement(EquipmentGlyph, { glyph: 'nope' as never }));
  assert.match(markup, /data-glyph="nope"/);
  assert.match(markup, /<path/);
});

test('grouping preserves every room option exactly once, per service', () => {
  for (const service of SERVICES) {
    const options = roomServiceOptions(families, service);
    const grouped = groupEquipmentOptions(options, service).flatMap((g) => g.items.map((i) => i.family.id));
    assert.deepEqual([...grouped].sort(), options.map((o) => o.family.id).sort(), service);
    assert.ok(!grouped.includes('other' as never));
  }
  assert.equal(roomServiceOptions(families, 'heating').length, 19);
  assert.equal(roomServiceOptions(families, 'cooling').length, 14);
  const heating = groupEquipmentOptions(roomServiceOptions(families, 'heating'), 'heating').map((g) => [g.group, g.items.length]);
  assert.deepEqual(heating, [['radiators', 5], ['floor', 4], ['air_hydronic', 2], ['combined', 8]]);
  const cooling = groupEquipmentOptions(roomServiceOptions(families, 'cooling'), 'cooling').map((g) => [g.group, g.items.length]);
  assert.deepEqual(cooling, [['air_conditioners', 4], ['air_hydronic', 2], ['combined', 8]]);
});

test('selection state is the legacy rule (source by sourceSystemIds, terminal by system list)', () => {
  const a = assignment({
    sourceSystemIds: { heating: 'reversible_air_to_water_heat_pump', cooling: null },
    heatingSystems: [sel('fan_coils'), sel('hydronic_floor_heating')],
    coolingSystems: [sel('fan_coils')],
  });
  for (const service of SERVICES) {
    for (const f of families) {
      for (const role of ['source', 'terminal'] as const) {
        const legacy = role === 'source'
          ? a.sourceSystemIds[service] === f.id
          : (service === 'heating' ? a.heatingSystems : a.coolingSystems).some((i) => i.familyId === f.id);
        assert.equal(isRoomOptionSelected(a, service, f.id, role), legacy, `${service}/${f.id}/${role}`);
      }
    }
  }
  // heating and cooling are independent
  assert.equal(isRoomOptionSelected(a, 'heating', 'hydronic_floor_heating', 'terminal'), true);
  assert.equal(isRoomOptionSelected(a, 'cooling', 'hydronic_floor_heating', 'terminal'), false);
});

test('room summary carries exactly the legacy label content', () => {
  const cases: Array<EngineeringRoomAssignment | undefined> = [
    undefined,
    assignment(),
    assignment({ servicePreferences: { heating: 'not_required', cooling: 'optional' }, heatingSystems: [sel('fan_coils')] }),
    assignment({ sourceSystemIds: { heating: 'reversible_air_to_water_heat_pump', cooling: 'reversible_air_to_water_heat_pump' }, heatingSystems: [sel('fan_coils'), sel('hydronic_floor_heating')], coolingSystems: [sel('fan_coils')] }),
    assignment({ sourceSystemIds: { heating: 'unknown_source', cooling: null }, heatingSystems: [sel('steel_panel_radiators')] }),
    assignment({ sourceSystemIds: { heating: 'fan_coils', cooling: null }, heatingSystems: [sel('fan_coils')] }),
  ];
  for (const a of cases) {
    for (const service of SERVICES) {
      const s = roomServiceSummary(a, service, families);
      const legacy = legacyAssignmentLabel(a, service);
      if (s.state === 'selected') assert.equal(s.items.map((i) => i.label).join(' + '), legacy);
      else if (s.state === 'not_required') assert.equal(legacy, 'нет');
      else assert.ok(legacy === '—' || (a === undefined && legacy === 'нет'));
    }
  }
});

function renderSelector(a: EngineeringRoomAssignment, requested: Array<'heating' | 'cooling'>) {
  return renderToStaticMarkup(createElement(RoomEquipmentSelector, {
    roomId: a.roomId, assignment: a, requested, families,
    summaries: { heating: roomServiceSummary(a, 'heating', families), cooling: roomServiceSummary(a, 'cooling', families) },
    onToggle: () => undefined, onNotRequired: () => undefined,
  }));
}

test('selector: tabs for both services, real checkboxes, checked state, accessible names', () => {
  const a = assignment({ heatingSystems: [sel('fan_coils'), sel('hydronic_floor_heating')], coolingSystems: [sel('fan_coils')] });
  const html = renderSelector(a, ['heating', 'cooling']);
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-selected="true"[^>]*data-service="heating"/);
  // only the active (heating) panel is rendered: 19 options as checkboxes
  assert.equal((html.match(/type="checkbox"/g) || []).length, 19);
  assert.equal((html.match(/<input type="checkbox"[^>]*checked=""/g) || []).length, 2);
  assert.equal((html.match(/class="eq-card is-on/g) || []).length, 2);
  for (const id of roomServiceOptions(families, 'heating').map((o) => o.family.id)) assert.match(html, new RegExp(`data-family="${id}"`));
  assert.match(html, /aria-labelledby="[^"]+-name"/);
  assert.match(html, /<legend class="eq-group-title">Радиаторы и конвекторы/);
  assert.match(html, /aria-pressed="false"/); // «Не требуется» toggle
  assert.doesNotMatch(html, /[🔥❄♻🌬▮▦≡]/u, 'no emoji/glyph characters as icons');
  // combined schemes collapsed when none is selected
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /hidden=""/);
});

test('selector: selected combined scheme opens its section; not-required is pressed', () => {
  const a = assignment({ servicePreferences: { heating: 'optional', cooling: 'not_required' }, heatingSystems: [sel('radiators_plus_ac')] });
  const html = renderSelector(a, ['heating']);
  assert.equal((html.match(/role="tab"/g) || []).length, 0, 'single service → no tabs');
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-family="radiators_plus_ac"[^>]*>[^]*?checked=""/);
  const cool = renderSelector(a, ['cooling']);
  assert.match(cool, /class="eq-card eq-none is-on"[^>]*aria-pressed="true"/);
});

test('room navigator: current room, glyph summary and screen-reader text', () => {
  const a = assignment({ heatingSystems: [sel('hydronic_floor_heating')] });
  const html = renderToStaticMarkup(createElement(RoomNavigator, {
    activeId: 'r2',
    onSelect: () => undefined,
    rooms: [
      { id: 'r1', name: 'Гостиная 1', icon: '•', areaM2: 20, summaries: { heating: roomServiceSummary(a, 'heating', families), cooling: roomServiceSummary(a, 'cooling', families) } },
      { id: 'r2', name: 'Спальня 1', icon: '•', areaM2: 15, summaries: { heating: roomServiceSummary(undefined, 'heating', families) } },
    ],
  }));
  assert.match(html, /aria-label="Комнаты"/);
  assert.match(html, /data-eq-room="r2" aria-current="true"/);
  assert.match(html, /2 из 2/);
  assert.match(html, /Отопление: Водяной тёплый пол\. Охлаждение: не выбрано/);
  assert.match(html, /data-glyph="floor_water"/);
  assert.match(html, /aria-label="Следующая комната" disabled=""/);
});
