/**
 * Fan-coil installation type, customer choices in the specification, PDF gating.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingLoadCalculation, BuildingProject } from '../src/features/buildingProject/types.js';
import { DEFAULT_DESIGN_INPUTS, buildEquipmentSpec, chooseFanCoil, type CatalogProduct, type EngineInput } from '../src/features/buildingProject/equipment/equipmentEngine.js';
import { fanCoilCountByMounting, fanCoilMountingInfo } from '../src/features/buildingProject/equipment/fanCoilMounting.js';
import { designOutputW, selectedOption, terminalOptions } from '../src/features/buildingProject/equipment/selection/choices.js';
import { catalogIndex } from '../src/features/buildingProject/equipment/selection/catalogIndex.js';
import { cartItemsFromSpec, downloadSpecPdf } from '../src/features/buildingProject/equipment/specExport.js';
import { fanCoilMountingOf, loadEquipmentChoices, roomUsesFanCoils, saveEquipmentChoices, withChoice } from '../src/features/buildingProject/utils/equipmentChoices.js';

function project(rooms: Array<{ id: string; heat: string[]; cool?: string[] }>, distribution = 'hydronic_2pipe_heating_cooling'): BuildingProject {
  return {
    id: 'p-choice', name: 'test', topology: null,
    rooms: rooms.map((r) => ({ id: r.id, roomType: 'living_room', name: r.id, areaM2: 20, floorId: null, extras: {} })),
    systemsConfiguration: {
      requestedServices: ['heating', 'cooling'],
      roomAssignments: rooms.map((r) => ({
        roomId: r.id, roomName: r.id, roomPurpose: 'living_room', sourceSystemId: null, sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
        servicePreferences: { heating: 'required', cooling: r.cool?.length ? 'required' : 'not_required' },
        heatingSystems: r.heat.map((familyId) => ({ familyId, label: familyId })),
        coolingSystems: (r.cool ?? []).map((familyId) => ({ familyId, label: familyId })),
        status: 'supported', warnings: [], reasons: [],
      })),
      architecture: {
        spaceHeatingSourceId: 'reversible_air_to_water_heat_pump', spaceCoolingSourceId: 'reversible_air_to_water_heat_pump', spaceCombinedSourceId: null, sources: [],
        distribution: { id: distribution, label: '', circuitKind: '2pipe', simultaneousHeatCool: false, notes: [] },
        dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] }, simultaneousHeatCoolSupported: false, warnings: [],
      },
    },
  } as unknown as BuildingProject;
}

function loads(ids: string[], heatW = 2000, coolW = 2500): BuildingLoadCalculation {
  const res = (w: number) => ({ status: 'calculated', demandW: w, assumptions: [], warnings: [], missingInputs: [] });
  return {
    mode: 'quick', status: 'calculated', methodId: 'x', methodVersion: '1', buildingRevisionAtCalculation: 1, systemsRevisionAtCalculation: 1,
    roomResults: ids.map((id) => ({ roomId: id, roomName: id, roomType: 'living_room', floorId: null, floorLabel: null, areaM2: 20, effectiveCeilingHeightM: 2.7, heating: res(heatW), cooling: res(coolW) })),
    heatingDemandW: heatW * ids.length, coolingDemandW: coolW * ids.length, warnings: [], missingInputs: [], assumptions: [],
    inputSnapshot: { requestedServices: ['heating', 'cooling'] }, calculatedAt: '2026-10-16T00:00:00Z',
  } as unknown as BuildingLoadCalculation;
}

const base = (choices: Record<string, string> = {}): EngineInput => ({
  project: project([{ id: 'a', heat: ['fan_coils'], cool: ['fan_coils'] }]), loads: loads(['a']), towelWarmers: [], design: DEFAULT_DESIGN_INPUTS, choices,
});

test('installation type per series follows the manufacturer documents', () => {
  const firstOf = (series: string, model?: RegExp) => catalogIndex().byType('FAN_COIL').find((p) => p.attrs.series?.v === series && (!model || model.test(String(p.attrs.model?.v ?? ''))))!.sku;
  assert.deepEqual(fanCoilMountingInfo(firstOf('MV')).mountings, ['EXPOSED_FLOOR_WALL']);
  assert.deepEqual(fanCoilMountingInfo(firstOf('MO')).mountings, ['EXPOSED_CEILING']);
  assert.deepEqual(fanCoilMountingInfo(firstOf('IVO')).mountings, ['CONCEALED_WALL', 'CONCEALED_CEILING']);
  assert.deepEqual(fanCoilMountingInfo(firstOf('FC', /-IO/)).mountings, ['CONCEALED_CEILING']);
  assert.deepEqual(fanCoilMountingInfo(firstOf('RK N')).mountings, ['CASSETTE']);
  assert.ok(fanCoilMountingInfo(firstOf('UTO')).note?.includes('Канальный'));
  assert.equal(fanCoilMountingInfo(firstOf('Design Inverter')).source, 'CARD');
  const counts = fanCoilCountByMounting();
  for (const n of Object.values(counts)) assert.ok(n > 0);
});

test('no installation type → no fan-coil model is picked; a required choice blocks the PDF', async () => {
  const spec = buildEquipmentSpec(base());
  assert.equal(spec.fanCoilRequests.length, 0);
  const line = spec.lines.find((l) => l.key === 'choice:fc-mounting:a')!;
  assert.equal(line.status, 'choice');
  assert.equal(line.choice!.options.length, 5);
  assert.ok(spec.pendingChoices.some((c) => c.key === 'fc-mounting:a'));
  await assert.rejects(downloadSpecPdf(spec, { projectName: 'x', serviceLabel: 'x' }), /не сделан выбор/);
  // with the type chosen the request carries it
  const chosen = buildEquipmentSpec(base({ 'fc-mounting:a': 'EXPOSED_CEILING' }));
  assert.equal(chosen.fanCoilRequests[0].mounting, 'EXPOSED_CEILING');
  assert.ok(!chosen.pendingChoices.some((c) => c.key === 'fc-mounting:a'));
});

test('model selection only among units of the chosen type; other fitting types are reported', () => {
  const req = { roomId: 'a', roomName: 'a', service: 'COOLING' as const, requiredKw: 2.8, pipe: '2-pipe' as const, mounting: 'CASSETTE' as const };
  // FC42-VM1 (open, floor/wall) and In Inverter 33 (concealed) fit by capacity but not by type
  const pick = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: '80042001', capacityKw: 3.02, oversizeRatio: 1.08, priceAmd: 1000, inStock: true },
    { sku: '20069371', capacityKw: 3.31, oversizeRatio: 1.18, priceAmd: 1000, inStock: true },
  ] }]);
  assert.equal(pick.sku, null);
  assert.deepEqual(pick.otherMountings, ['EXPOSED_FLOOR_WALL', 'CONCEALED_WALL', 'CONCEALED_CEILING']);
  const spec = buildEquipmentSpec({ ...base({ 'fc-mounting:a': 'CASSETTE' }), fanCoilPicks: { a: pick } });
  const missing = spec.lines.find((l) => l.key === 'missing:fc-a')!;
  assert.match(missing.reason, /Подходят другие типы установки: открытый, пол\/стена/);
});

test('EN 442 conversion: rated Δt 50 output scaled to the design mean temperature, estimate only', () => {
  const sira = catalogIndex().get('P500')!;
  assert.ok(Math.abs(designOutputW(sira, 70, 55)! - 103 * (42.5 / 50) ** 1.3) < 1e-9);
  assert.ok(designOutputW(sira, 45, 40)! < 40, 'low-temperature heat pump water: a sectional radiator gives a third of its rating');
  const opts = terminalOptions('radiator', 1800, 45, 40, {});
  assert.ok(opts.find((o) => o.sku === 'P500')!.disabled, 'more than 24 sections for the room → offered as unsuitable');
});

test('chosen product enters the BOM with price; "not included" is resolved but never priced or sent to the cart', () => {
  const towelWarmers = [{ roomId: 'a', roomName: 'a', kind: 'water' as const, kindSource: 'user' as const, quantity: 1, capacityW: null }];
  const inp = { ...base({ 'fc-mounting:a': 'EXPOSED_FLOOR_WALL', 'towel-water': 'P16/1000/500/SW', 'fc-control': 'exclude' }), towelWarmers };
  const s1 = buildEquipmentSpec(inp);
  const catalog = new Map<string, CatalogProduct | null>(s1.skus.map((sku) => [sku, { sku, name: sku, slug: sku, priceAmd: 1000, unit: 'шт', availabilityLabel: null, inStock: true, canAddToCart: true, id: 1 }]));
  const spec = buildEquipmentSpec({ ...inp, catalog });
  const towel = spec.lines.find((l) => l.key === 'choice:towel-water')!;
  assert.equal(towel.status, 'catalog');
  assert.equal(towel.product?.sku, 'P16/1000/500/SW');
  const control = spec.lines.find((l) => l.key === 'choice:fc-control');
  if (control) {
    assert.equal(control.excluded, true);
    assert.equal(selectedOption(control.choice)?.kind, 'exclude');
    assert.ok(!cartItemsFromSpec(spec, { includePreliminary: true }).items.some((i) => i.sku === control.sku));
  }
  assert.ok(cartItemsFromSpec(spec).items.some((i) => i.sku === 'P16/1000/500/SW'));
});

test('a stale or disabled selection is ignored (never silently resolved)', () => {
  const spec = buildEquipmentSpec(base({ 'fc-mounting:a': 'EXPOSED_FLOOR_WALL', 'cool-source': 'no-such-option' }));
  const cool = spec.lines.find((l) => l.key === 'choice:cool-source');
  if (cool) assert.equal(cool.choice!.selectedId, null);
});

test('choices storage: per project, broadcast, fan-coil helpers', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as unknown as Storage;
  let next = withChoice({}, 'fc-mounting:a', 'CASSETTE');
  next = withChoice(next, 'towel-water', 'P12/800/450/SW');
  saveEquipmentChoices('p1', next);
  assert.deepEqual(loadEquipmentChoices('p1'), next);
  assert.deepEqual(loadEquipmentChoices('p2'), {});
  assert.equal(fanCoilMountingOf(next, 'a'), 'CASSETTE');
  assert.equal(fanCoilMountingOf({ 'fc-mounting:a': 'nonsense' }, 'a'), null);
  assert.deepEqual(withChoice(next, 'towel-water', null), { 'fc-mounting:a': 'CASSETTE' });
  assert.equal(roomUsesFanCoils({ heatingSystems: [{ familyId: 'fan_coils' }], coolingSystems: [] } as never), true);
  assert.equal(roomUsesFanCoils({ heatingSystems: [{ familyId: 'hydronic_floor_heating' }], coolingSystems: [] } as never), false);
});

test('choices sync: server wins; browser-only or unsynced choices are uploaded; offline keeps the local value', async () => {
  const { syncEquipmentChoices, saveEquipmentChoices: save, loadEquipmentChoices: load } = await import('../src/features/buildingProject/utils/equipmentChoices.js');
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } as unknown as Storage;
  const server: { choices: Record<string, string>; updatedAt: string | null } = { choices: {}, updatedAt: null };
  let online = true;
  const fetcher = (async (_path: string, init?: RequestInit) => {
    if (!online) throw new Error('offline');
    if (init?.method === 'PUT') { server.choices = JSON.parse(String(init.body)).choices; server.updatedAt = '2026-10-16T00:00:00Z'; return server; }
    return server;
  }) as never;
  // browser-only choices (made before server storage) are uploaded on first sync
  store.set('ohmx.bp.equipmentChoices.p9', JSON.stringify({ 'fc-mounting:a': 'CASSETTE' }));
  assert.deepEqual(await syncEquipmentChoices('p9', fetcher), { 'fc-mounting:a': 'CASSETTE' });
  assert.deepEqual(server.choices, { 'fc-mounting:a': 'CASSETTE' });
  // server wins over a stale cache
  server.choices = { 'fc-mounting:a': 'EXPOSED_CEILING' };
  assert.deepEqual(await syncEquipmentChoices('p9', fetcher), { 'fc-mounting:a': 'EXPOSED_CEILING' });
  assert.deepEqual(load('p9'), { 'fc-mounting:a': 'EXPOSED_CEILING' });
  // offline change survives and is uploaded when back online
  online = false;
  await save('p9', { 'fc-mounting:a': 'CONCEALED_WALL' }, fetcher);
  online = true;
  assert.deepEqual(await syncEquipmentChoices('p9', fetcher), { 'fc-mounting:a': 'CONCEALED_WALL' });
  assert.deepEqual(server.choices, { 'fc-mounting:a': 'CONCEALED_WALL' });
});

test('EN 442 exponent from two catalog rating points; typical only when one point exists', async () => {
  const { exponentOf } = await import('../src/features/buildingProject/equipment/selection/choices.js');
  const kvz = catalogIndex().get('KVZ 230-80-2000-UA.')!;
  assert.ok(Math.abs(exponentOf(kvz).n - Math.log(643 / 510) / Math.log(60 / 50)) < 1e-9);
  assert.match(exponentOf(kvz).basis, /двум паспортным точкам/);
  assert.equal(exponentOf(catalogIndex().get('P500')!).n, 1.3);
});

test('boiler as heat source: useful output, undersized offered but not selectable, fuel follows the chosen source', async () => {
  const { boilerOptions, boilerUsefulKw } = await import('../src/features/buildingProject/equipment/selection/choices.js');
  // Riello Start 24 KIS: stated useful output 23.9 kW is used, never the 25.8 kW input rating
  assert.equal(boilerUsefulKw(catalogIndex().get('20122798')!).kw, 23.9);
  // NOVELLA 35E: only input 38 kW and efficiency 90 % → useful = 34.2 kW
  assert.ok(Math.abs(boilerUsefulKw(catalogIndex().get('20088999')!).kw! - 38 * 0.9) < 1e-9);
  const gas = boilerOptions('gas_condensing_boiler', 30, {});
  assert.ok(gas.length > 5);
  assert.ok(gas.every((o) => catalogIndex().get(o.sku!)!.attrs.fuel?.v === 'GAS_CONDENSING'));
  const small = gas.find((o) => o.sku === '20187761')!; // CIAO X 25C: 19 kW
  assert.equal(small.disabled, true);
  assert.match(small.detail!, /заведомо меньше требуемых 30/, 'only the 19 kW input is stated: proven too small');
  const electric = boilerOptions('electric_boiler', 8, {});
  assert.ok(electric.find((o) => o.sku === '286' && !o.disabled), 'SKAT 12 kW fits 8 kW');
  assert.ok(electric.find((o) => o.sku === '285')!.disabled, 'SKAT 6 kW is too small');
});
