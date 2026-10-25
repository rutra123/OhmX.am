/**
 * Loads result redesign: 20% heating reserve, compact summary, plain-Russian
 * room explanations, towel warmer in results, mobile-safe markup.
 *
 * Fixture mirrors the screenshot project (Yerevan, QUICK v1, medium insulation,
 * h = 2.7 m, indoor 20 °C, outdoor −18 °C → 0.75 × V × 38).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BuildingLoadCalculation, RoomLoadResult } from '../src/features/buildingProject/types.js';
import {
  HEATING_RESERVE_RATIO,
  buildLoadResultSummary,
  climateLabelRu,
  explainRoomCooling,
  explainRoomHeating,
  heatingCapacity,
  heatingReserveRatio,
} from '../src/features/buildingProject/utils/loadResultSummary.js';
import { PrimaryLoadResult, RoomResultsList } from '../src/features/buildingProject/components/BuildingProjectWizard.js';
import type { TowelWarmerSelection } from '../src/features/buildingProject/utils/towelWarmer.js';

function quickRoom(id: string, name: string, roomType: string, area: number, coolingW: number | null): RoomLoadResult {
  const volume = area * 2.7;
  const heatingW = volume * 38 * 0.75;
  return {
    roomId: id,
    roomName: name,
    roomType,
    floorId: null,
    floorLabel: null,
    areaM2: area,
    effectiveCeilingHeightM: 2.7,
    heating: {
      status: 'calculated',
      demandW: heatingW,
      demandRangeW: { min: heatingW * 0.7, max: heatingW * 1.3 },
      assumptions: ['Количество наружных стен неизвестно — коэффициент 1.00.'],
      warnings: ['external_wall_count_not_provided', 'floor_exposure_not_provided'],
      missingInputs: [],
      methodInputs: {
        areaM2: area, effectiveHeightM: 2.7, volumeM3: volume, indoorDesignC: 20, outdoorDesignC: -18,
        insulationLevel: 'medium', externalWallCount: null, floorExposure: 'unknown', glazingType: null,
      },
      coefficientTrace: {
        kEnvelope: 0.75, kExternal: 1, kFloor: 1, kGlazing: 1, kSolarHeating: 1,
        envelopeCoefficientId: 'quick.heating.envelope.medium',
      },
    },
    cooling: coolingW == null
      ? { status: 'not_required', demandW: null, assumptions: [], warnings: [], missingInputs: [] }
      : {
        status: 'calculated',
        demandW: coolingW,
        assumptions: [],
        warnings: ['solar_orientation_not_collected'],
        missingInputs: [],
        methodInputs: { areaM2: area, effectiveHeightM: 2.7, indoorDesignC: 24, outdoorDesignC: 33, insulationLevel: 'medium' },
        coefficientTrace: { baseWm2: 100, kHeight: 1, kInsulation: 1, kExternal: 1, kFloor: 1, kGlazing: 1, kSolar: 1, kClimateCooling: 0.818 },
      },
  };
}

function fixture(): BuildingLoadCalculation {
  const rooms = [
    quickRoom('r1', 'Гостиная 1', 'living_room', 35, 2860),
    quickRoom('r2', 'Спальня 1', 'bedroom', 20, 1640),
    quickRoom('r3', 'Кухня 1', 'kitchen', 25, 2050),
    quickRoom('r4', 'Ванная 1', 'bathroom', 10, null),
    quickRoom('r5', 'Прихожая 1', 'hallway', 5, 409),
  ];
  const heatingDemandW = rooms.reduce((s, r) => s + (r.heating.demandW || 0), 0);
  const coolingDemandW = rooms.reduce((s, r) => s + (r.cooling.demandW || 0), 0);
  return {
    mode: 'quick',
    status: 'calculated',
    methodId: 'ohmx.quick-load.v1',
    methodVersion: '1.0.0',
    buildingRevisionAtCalculation: 6,
    systemsRevisionAtCalculation: 4,
    roomResults: rooms,
    heatingDemandW,
    coolingDemandW,
    climateLocationLabel: 'Ереван, Агро (Երևան «Ագրո»)',
    climateDatasetId: 'armenia-hhsn-22-01-2024',
    climateDatasetVersion: '1.0.0',
    warnings: [],
    missingInputs: [],
    assumptions: [],
    inputSnapshot: { requestedServices: ['heating', 'cooling'] } as BuildingLoadCalculation['inputSnapshot'],
    calculatedAt: '2026-10-13T00:00:00.000Z',
  } as BuildingLoadCalculation;
}

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('reserve: 20% applied to QUICK heating, example 7.35 kW → 8.82 kW', () => {
  assert.equal(HEATING_RESERVE_RATIO, 0.2);
  const c = heatingCapacity(7350, heatingReserveRatio('quick'))!;
  close(c.baseW, 7350);
  close(c.reserveW, 1470);
  close(c.requiredW, 8820);
});

test('reserve: professional methodology unchanged (no reserve for steady_state / legacy)', () => {
  assert.equal(heatingReserveRatio('steady_state'), 0);
  assert.equal(heatingReserveRatio('professional'), 0);
  assert.equal(heatingCapacity(null, 0.2), null);
});

test('summary: totals, area, room count; cooling has no reserve', () => {
  const loads = fixture();
  const s = buildLoadResultSummary(loads);
  close(s.totalAreaM2!, 95);
  assert.equal(s.roomCount, 5);
  close(s.heating!.baseW, loads.heatingDemandW!);
  close(s.heating!.requiredW, loads.heatingDemandW! * 1.2);
  close(s.coolingW!, 6959);
  assert.equal(s.coolingW, loads.coolingDemandW, 'cooling total is the raw server value');
  assert.ok(s.showHeating && s.showCooling);
});

test('summary: room values are independent and aggregate exactly to the object total', () => {
  const s = buildLoadResultSummary(fixture());
  const living = s.rooms.find((r) => r.roomId === 'r1')!;
  close(living.heating!.baseW, 35 * 2.7 * 38 * 0.75);
  close(living.heating!.requiredW, 35 * 2.7 * 38 * 0.75 * 1.2);
  assert.equal(living.coolingW, 2860);
  const bath = s.rooms.find((r) => r.roomId === 'r4')!;
  assert.equal(bath.coolingW, null);
  const sumRequired = s.rooms.reduce((sum, r) => sum + (r.heating?.requiredW || 0), 0);
  const sumReserve = s.rooms.reduce((sum, r) => sum + (r.heating?.reserveW || 0), 0);
  close(sumRequired, s.heating!.requiredW);
  close(sumReserve, s.heating!.reserveW);
});

test('no double counting: summary is pure and repeated recalculation stays ×1.2', () => {
  const loads = fixture();
  const before = structuredClone(loads);
  const a = buildLoadResultSummary(loads);
  const b = buildLoadResultSummary(loads);
  assert.deepEqual(a, b);
  assert.deepEqual(loads, before, 'server result is never mutated');
  // A recalculation returns a fresh server object with the same raw load.
  const recalculated = structuredClone(before);
  close(buildLoadResultSummary(recalculated).heating!.requiredW, before.heatingDemandW! * 1.2);
});

test('incomplete server total stays null (no fabricated reserve)', () => {
  const loads = { ...fixture(), heatingDemandW: null, status: 'limited' } as BuildingLoadCalculation;
  assert.equal(buildLoadResultSummary(loads).heating, null);
});

test('heating-only project hides cooling', () => {
  const loads = fixture();
  loads.inputSnapshot = { requestedServices: ['heating'] } as BuildingLoadCalculation['inputSnapshot'];
  assert.equal(buildLoadResultSummary(loads).showCooling, false);
});

test('explanation: plain Russian, actual numbers, no internal identifiers', () => {
  const room = fixture().roomResults[0];
  const ex = explainRoomHeating(room, 'quick')!;
  const text = ex.steps.join('\n');
  assert.match(text, /Площадь помещения: 35 м², высота потолка: 2\.7 м, объём: 94\.5 м³/);
  assert.match(text, /\+20 °C.*−18 °C — разница 38 °C/);
  assert.match(text, /Утепление: среднее — потери 0\.75 Вт/);
  assert.match(text, /Исходная потребность в отоплении: 2\.69 кВт \(94\.5 м³ × 38 °C × 0\.75\)/);
  assert.match(text, /Дополнительный запас 20%: 539 Вт/);
  assert.match(text, /Итоговая необходимая мощность отопления: 3\.23 кВт/);
  assert.match(text, /Не указано, принято без поправки: количество наружных стен, положение по этажу, тип окон/);
  const all = [...ex.steps, ...ex.refine, ex.note || ''].join(' ');
  assert.doesNotMatch(all, /_not_provided|quick\.|kEnvelope|QUICK|Ksolar/);
});

test('explanation: applied factors only when the engine reported them', () => {
  const room = fixture().roomResults[1];
  room.heating.methodInputs = { ...room.heating.methodInputs, externalWallCount: 2, floorExposure: 'top', glazingType: 'large' };
  room.heating.coefficientTrace = { ...room.heating.coefficientTrace, kExternal: 1.08, kFloor: 1.08, kGlazing: 1.1 };
  room.heating.demandW = 20 * 2.7 * 38 * 0.75 * 1.08 * 1.08 * 1.1;
  const text = explainRoomHeating(room, 'quick')!.steps.join('\n');
  assert.match(text, /Учтено: 2 наружные стены ×1\.08; помещение под кровлей ×1\.08; большие окна ×1\.10/);
  assert.match(text, /× поправки\)/);
  assert.doesNotMatch(text, /Не указано/);
});

test('explanation: cooling has no reserve; steady_state has no reserve', () => {
  const room = fixture().roomResults[0];
  const cool = explainRoomCooling(room, 'quick')!.steps.join('\n');
  assert.match(cool, /Необходимая мощность охлаждения: 2\.86 кВт \(запас не добавляется\)/);
  assert.match(cool, /климат ×0\.82/);
  const steady: RoomLoadResult = {
    ...room,
    heating: { status: 'calculated', demandW: 2318.76, assumptions: [], warnings: [], missingInputs: [], methodInputs: { indoorC: 20, outdoorC: -18, transmissionHeatingW: 923.4, airHeatingW: 1395.36 } },
  };
  const text = explainRoomHeating(steady, 'steady_state')!.steps.join('\n');
  assert.match(text, /через стены, окна, пол и потолок: 923 Вт/);
  assert.match(text, /Необходимая мощность отопления: 2\.32 кВт \(запас в этом расчёте не добавляется\)/);
});

test('climate label drops the Armenian duplicate for customers', () => {
  assert.equal(climateLabelRu('Ереван, Агро (Երևան «Ագրո»)'), 'Ереван, Агро');
  assert.equal(climateLabelRu('Амасия'), 'Амасия');
});

test('render: compact summary is visible and rooms are collapsed', () => {
  const loads = fixture();
  const summary = renderToStaticMarkup(createElement(PrimaryLoadResult, { loads }));
  assert.match(summary, /Общая площадь<\/dt><dd>95 м²/);
  assert.match(summary, /Требуемая мощность отопления<\/dt><dd[^>]*>8\.77 кВт/);
  assert.match(summary, /в том числе запас 20%<\/dt><dd[^>]*>1\.46 кВт/);
  assert.match(summary, /Требуемая мощность охлаждения<\/dt><dd[^>]*>6\.96 кВт/);
  assert.match(summary, /Количество помещений<\/dt><dd>5/);

  const towel: TowelWarmerSelection = { roomId: 'r4', roomName: 'Ванная 1', kind: 'water', kindSource: 'heating_system', quantity: 1, capacityW: null };
  const list = renderToStaticMarkup(createElement(RoomResultsList, { loads, towelWarmers: [towel] }));
  assert.equal((list.match(/<details/g) || []).length, 5);
  assert.doesNotMatch(list, /<details[^>]*\sopen/, 'every room starts collapsed');
  assert.match(list, /Гостиная 1 — 35 м² — Отопление: 3\.23 кВт — Охлаждение: 2\.86 кВт/);
  assert.match(list, /Ванная 1 — 10 м² — Отопление: 923 Вт</);
  assert.match(list, /Полотенцесушитель водяной — 1 шт\./);
  assert.match(list, /Климат: Ереван, Агро</);
  assert.doesNotMatch(list, /external_wall_count|floor_exposure|solar_orientation|armenia-hhsn|Երևան/);
});

test('mobile: result markup wraps instead of scrolling horizontally', () => {
  const src = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
  assert.match(src, /\.bp-kv \{ display: grid; grid-template-columns: minmax\(8em, 1fr\) minmax\(0, auto\);/);
  assert.match(src, /\.bp-room-result > summary \{[^}]*overflow-wrap: anywhere;/);
  assert.match(src, /\.bp-explain \{[^}]*overflow-wrap: anywhere;/);
  assert.doesNotMatch(src, /\.bp-room-result[^{]*\{[^}]*nowrap/);
});
