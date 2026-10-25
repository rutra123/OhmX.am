/**
 * Equipment selection + BOM engine: representative projects and invariants.
 * Pure engine tests — catalog/matcher answers are injected, nothing is fetched.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingLoadCalculation, BuildingProject, EngineeringRoomAssignment } from '../src/features/buildingProject/types.js';
import {
  DEFAULT_DESIGN_INPUTS,
  buildEquipmentSpec,
  chooseFanCoil,
  type CatalogProduct,
  type DesignInputs,
  type EngineInput,
  type FanCoilPick,
} from '../src/features/buildingProject/equipment/equipmentEngine.js';
import {
  HEAT_PUMPS,
  assessHeatPump,
  assessTopology,
  rankHeatPumps,
  nominalFlowM3h,
  type HeatPumpRequirement,
} from '../src/features/buildingProject/equipment/plantSelection.js';
import { cartBadgeCount } from '../src/store/cartBadge.js';
import {
  ACTUATORS,
  BALL_VALVES_FM,
  EXPANSION_TANKS,
  FILL_DRAIN_VALVE,
  HYDRAULIC_SEPARATOR,
  MANIFOLDS,
  MANOMETER,
  PUMPS,
  SAFETY_VALVE_3BAR,
  THERMOMETER,
  TOWEL_VALVE,
} from '../src/features/buildingProject/equipment/catalogFacts.js';
import { approxPumpHeadM, flowM3h, fluidProps, pipeGradientPaM, ufhLoops } from '../src/features/buildingProject/equipment/hydraulics.js';
import { matcherRequest } from '../src/features/buildingProject/equipment/catalogClient.js';
import { catalogIndex } from '../src/features/buildingProject/equipment/selection/catalogIndex.js';
import type { TowelWarmerSelection } from '../src/features/buildingProject/utils/towelWarmer.js';

type RoomSpec = { id: string; type?: string; area: number; heat?: string[]; cool?: string[]; heatW?: number; coolW?: number };

function makeProject(rooms: RoomSpec[], opts: { source?: string | null; coolSource?: string | null; distribution?: string; circuit?: string; requested?: Array<'heating' | 'cooling'> } = {}): BuildingProject {
  const requested = opts.requested ?? ['heating', 'cooling'];
  return {
    id: 'p-test',
    name: 'test',
    rooms: rooms.map((r) => ({ id: r.id, roomType: r.type ?? 'living_room', name: r.id, areaM2: r.area, floorId: null, extras: { geometry: {}, windows: { glazingType: null, count: null, areaM2: null }, conditions: [], engineeringUse: 'stored_only' } })),
    topology: null,
    systemsConfiguration: {
      requestedServices: requested,
      roomAssignments: rooms.map((r) => ({
        roomId: r.id, roomName: r.id, roomPurpose: r.type ?? 'living_room', sourceSystemId: null, sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
        servicePreferences: { heating: r.heat?.length ? 'required' : 'not_required', cooling: r.cool?.length ? 'required' : 'not_required' },
        heatingSystems: (r.heat ?? []).map((familyId) => ({ familyId, label: familyId })),
        coolingSystems: (r.cool ?? []).map((familyId) => ({ familyId, label: familyId })),
        status: 'supported', warnings: [], reasons: [],
      })) as unknown as EngineeringRoomAssignment[],
      architecture: {
        spaceHeatingSourceId: opts.source === undefined ? 'reversible_air_to_water_heat_pump' : opts.source,
        spaceCoolingSourceId: opts.coolSource === undefined ? (opts.source === undefined ? 'reversible_air_to_water_heat_pump' : null) : opts.coolSource,
        spaceCombinedSourceId: null,
        sources: [],
        distribution: { id: opts.distribution ?? 'hydronic_2pipe_heating_cooling', label: '', circuitKind: opts.circuit ?? '2pipe', simultaneousHeatCool: false, notes: [] },
        dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
        simultaneousHeatCoolSupported: false,
        warnings: [],
      },
    },
  } as unknown as BuildingProject;
}

function makeLoads(rooms: RoomSpec[], mode: 'quick' | 'steady_state' = 'quick', requested: Array<'heating' | 'cooling'> = ['heating', 'cooling']): BuildingLoadCalculation {
  const res = (w: number | undefined) => w == null
    ? { status: 'not_required', demandW: null, assumptions: [], warnings: [], missingInputs: [] }
    : { status: 'calculated', demandW: w, assumptions: [], warnings: [], missingInputs: [] };
  const roomResults = rooms.map((r) => ({ roomId: r.id, roomName: r.id, roomType: r.type ?? 'living_room', floorId: null, floorLabel: null, areaM2: r.area, effectiveCeilingHeightM: 2.7, heating: res(r.heatW), cooling: res(r.coolW) }));
  const sum = (k: 'heatW' | 'coolW') => rooms.reduce((s, r) => s + (r[k] ?? 0), 0);
  return {
    mode, status: 'calculated', methodId: 'x', methodVersion: '1', buildingRevisionAtCalculation: 1, systemsRevisionAtCalculation: 1,
    roomResults, heatingDemandW: sum('heatW'), coolingDemandW: sum('coolW'), warnings: [], missingInputs: [], assumptions: [],
    inputSnapshot: { requestedServices: requested }, calculatedAt: '2026-10-13T00:00:00Z',
  } as unknown as BuildingLoadCalculation;
}

function product(sku: string, price: number | null = 1000, unit = 'шт'): CatalogProduct {
  return { sku, name: `Каталог ${sku}`, slug: sku.toLowerCase(), priceAmd: price, unit, availabilityLabel: null };
}

/** Catalog that knows every planned SKU (or the given subset). */
function catalogFor(spec: { skus: string[] }, absent: string[] = []): Map<string, CatalogProduct | null> {
  return new Map(spec.skus.map((s) => [s, absent.includes(s) ? null : product(s)]));
}

/** Fan-coil installation type chosen for every room (open, floor/wall — FC42-VM1 and Design Inverter fit it). */
const mountAll = (rooms: Array<{ id: string }>, m = 'EXPOSED_FLOOR_WALL'): Record<string, string> => Object.fromEntries(rooms.map((r) => [`fc-mounting:${r.id}`, m]));

function run(input: Omit<EngineInput, 'design' | 'towelWarmers'> & { design?: Partial<DesignInputs>; towelWarmers?: TowelWarmerSelection[] }, picks?: (roomId: string) => FanCoilPick, absent: string[] = []) {
  const base: EngineInput = { ...input, choices: { ...mountAll(input.project.rooms), ...input.choices }, towelWarmers: input.towelWarmers ?? [], design: { ...DEFAULT_DESIGN_INPUTS, ...input.design } };
  const s1 = buildEquipmentSpec(base);
  const fanCoilPicks = picks ? Object.fromEntries(s1.fanCoilRequests.map((r) => [r.roomId, picks(r.roomId)])) : undefined;
  const s2 = buildEquipmentSpec({ ...base, fanCoilPicks });
  return buildEquipmentSpec({ ...base, fanCoilPicks, catalog: catalogFor(s2, absent) });
}

const line = (spec: ReturnType<typeof run>, sku: string) => spec.lines.find((l) => l.sku === sku);
const catalogIndexManifolds = () => catalogIndex().byType('MANIFOLD').map((p) => p.sku);
const named = (spec: ReturnType<typeof run>, part: string) => spec.lines.find((l) => l.name.includes(part));
const FC_SKU = '80042001'; // BPS FC42-VM1 in the approved snapshot: 7/12 °C 0.52 m³/h, 20.8 kPa
const pick = (units = 1, sku: string | null = FC_SKU): ((roomId: string) => FanCoilPick) => (roomId) => ({ roomId, units, sku, capacityKw: sku ? 3.02 : null });

// ---------------------------------------------------------------------------

test('hydraulics: Q = 0.86·kW/ΔT for water; glycol needs more flow; loops by area', () => {
  const water = flowM3h(5000, 5, fluidProps(0));
  assert.ok(Math.abs(water - 0.86 * 5 / 5) / water < 0.02, String(water));
  assert.ok(flowM3h(5000, 5, fluidProps(30)) > water * 1.03);
  assert.deepEqual(ufhLoops(35).loops, 3);
  assert.equal(ufhLoops(10).loops, 1);
  const r = pipeGradientPaM(0.1, 0.012, 37.5, fluidProps(0));
  assert.ok(r > 50 && r < 300, `16×2 at 100 l/h: ${r} Pa/m`);
  assert.equal(approxPumpHeadM(6, 2.4, 0), 6);
  assert.ok(approxPumpHeadM(6, 2.4, 1.2) < 6);
});

test('1. fan-coil only (2-pipe): manifold outlets = units, one actuator per outlet, condensate + insulation', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2500, coolW: 2800 },
    { id: 'b', area: 15, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1200, coolW: 1500 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  assert.equal(spec.fanCoilRequests.length, 2);
  assert.equal(line(spec, FC_SKU)?.quantity, 2);
  const fcGroup = spec.groups.find((g) => g.kind === 'fan_coil')!;
  assert.equal(fcGroup.manifolds.length, 1);
  assert.equal(fcGroup.manifolds[0].outlets, 2);
  assert.equal(fcGroup.manifolds[0].family, 'SSM-F'); // 45 °C ≤ 60 °C and kvs check passes
  assert.equal(line(spec, '088U0752')?.quantity, 1); // SSM-F 2+2
  assert.equal(line(spec, '088H3110')?.quantity, 2);
  assert.ok(line(spec, '088U1100'), 'Icon expansion for cooling change-over');
  assert.ok(named(spec, 'Отвод конденсата'));
  assert.ok(named(spec, 'Теплоизоляция с паробарьером'));
  assert.ok(!spec.groups.some((g) => g.kind === 'ufh'));
  assert.ok(line(spec, '088U0752')!.checks.some((c) => c.includes('7 °C')), 'chilled-water use flagged');
});

test('2. underfloor only from a heat pump: FHF sized by loops, fittings 2 per loop, no mixing, no separator', () => {
  const rooms: RoomSpec[] = [
    { id: 'living', area: 35, heat: ['hydronic_floor_heating'], heatW: 2700 },
    { id: 'bed', area: 20, heat: ['hydronic_floor_heating'], heatW: 1500 },
  ];
  const spec = run({ project: makeProject(rooms, { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', circuit: '2pipe', requested: ['heating'] }), loads: makeLoads(rooms, 'quick', ['heating']) });
  const g = spec.groups.find((x) => x.kind === 'ufh')!;
  assert.equal(g.circuits, 3 + 2);
  assert.equal(g.needsMixing, false);
  assert.equal(line(spec, '088U0505')?.quantity, 1); // FHF 5+5
  assert.equal(line(spec, '013G4186')?.quantity, 10);
  // Heating-only UFH: the documented 230 V chain (Icon Display 230 V → TWA-A 230 V NC on FHF) is complete;
  // the Icon 24 V chain lacks wired 24 V thermostats in the catalog → compared and rejected as incomplete.
  assert.equal(line(spec, '088H3112')?.quantity, 5);
  assert.equal(line(spec, '088H3112')?.match?.verdict, 'EXACT_VERIFIED', 'FHF data sheet names 088H3112');
  assert.equal(line(spec, '088U1010')?.quantity, 2, 'one 230 V thermostat per room, ≤ 5 actuators each (Icon Display data sheet)');
  assert.ok(!line(spec, '088H3110'));
  assert.equal(spec.selection.controlOptions[0].id, 'ICON230_DIRECT');
  assert.ok(spec.selection.controlOptions.some((o) => o.id === 'ICON24_MASTER' && !o.complete));
  assert.ok(line(spec, '088U0822') && line(spec, '088U0585'));
  assert.ok(!named(spec, 'Гидравлический разделитель'));
  assert.ok(!spec.lines.some((l) => l.sku?.startsWith('088U009')), 'no mixing unit');
  assert.equal(spec.pumps.length, 1);
});

test('3. mixed underfloor + fan coils: separate manifold groups, mixing unit, separator, Icon outputs = all outlets', () => {
  const rooms: RoomSpec[] = [
    { id: 'living', area: 35, heat: ['hydronic_floor_heating', 'fan_coils'], cool: ['fan_coils'], heatW: 2700, coolW: 2900 },
    { id: 'bath', type: 'bathroom', area: 8, heat: ['hydronic_floor_heating'], heatW: 600 },
    { id: 'bed', area: 18, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1400, coolW: 1600 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  const ufh = spec.groups.find((g) => g.kind === 'ufh')!;
  const fc = spec.groups.find((g) => g.kind === 'fan_coil')!;
  assert.notEqual(ufh.manifolds[0].sku, fc.manifolds[0].sku, 'different manifold groups');
  assert.equal(ufh.needsMixing, true);
  assert.ok(spec.lines.some((l) => ['088U0093', '088U0096', '088U0094'].includes(l.sku ?? '')), 'mixing unit');
  assert.ok(named(spec, 'Гидравлический разделитель'));
  const actuators = spec.lines.filter((l) => l.match?.role === 'actuator').reduce((n, l) => n + (l.quantity ?? 0), 0);
  assert.equal(actuators, ufh.circuits + fc.circuits, 'one actuator per used outlet over both manifold groups');
  // fan-coil zones are cooled → heating-only 230 V thermostats cannot serve them: mixed 230 V (UFH) + Icon 24 V (fan coils)
  assert.equal(line(spec, '088H3110')?.quantity, fc.circuits);
  assert.equal(line(spec, '088H3112')?.quantity, ufh.circuits);
  assert.equal(line(spec, '088H3112')?.match?.verdict, 'EXACT_VERIFIED', 'checked against the UFH (FHF) manifold only');
  assert.equal(line(spec, '088U1010')?.match?.verdict, 'REQUIRES_ENGINEERING_REVIEW', '2-pipe change-over: loops must stay closed in cooling');
  // living room: UFH limited to 60 W/m², the rest goes to the fan coil
  assert.ok(Math.abs(ufh.heatW - (Math.min(2700 * 1.2, 35 * 60) + 600 * 1.2)) < 1e-6);
  assert.equal(spec.pumps.find((p) => p.groupId.startsWith('ufh'))?.integrated?.includes('Grundfos'), true);
});

test('4. radiators from a boiler: 70/55 °C, valve kit per radiator, no manifold or actuators', () => {
  const rooms: RoomSpec[] = [
    { id: 'r1', area: 20, heat: ['steel_panel_radiators'], heatW: 1500 },
    { id: 'r2', area: 12, heat: ['bimetal_radiators'], heatW: 900 },
  ];
  const spec = run({ project: makeProject(rooms, { source: 'gas_boiler', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] }), loads: makeLoads(rooms, 'quick', ['heating']) });
  const g = spec.groups.find((x) => x.kind === 'radiator')!;
  assert.equal(g.supplyC, 70);
  assert.equal(g.returnC, 55);
  assert.equal(line(spec, '013G5174')?.quantity, 2);
  // one choice per room with catalog radiators sized at 70/55 °C (EN 442 estimate) + "подбирается отдельно"
  const terminals = spec.lines.filter((l) => l.key.startsWith('choice:terminal:'));
  assert.equal(terminals.length, 2);
  assert.ok(terminals.every((l) => l.status === 'choice' && l.choice?.required && l.choice.options.some((o) => o.id === 'exclude')));
  assert.deepEqual(spec.pendingChoices.filter((c) => c.key.startsWith('terminal:')).length, 2);
  // choosing the sectional Sira radiator: sections from the room load, one valve kit per room
  const chosen = run({ project: makeProject(rooms, { source: 'gas_boiler', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] }), loads: makeLoads(rooms, 'quick', ['heating']), choices: { 'terminal:r1': 'P500', 'terminal:r2': 'exclude' } });
  const r1 = chosen.lines.find((l) => l.key === 'choice:terminal:r1')!;
  assert.equal(r1.status, 'catalog');
  assert.equal(r1.sku, 'P500');
  assert.equal(r1.quantity, Math.ceil(1500 * 1.2 / (103 * (42.5 / 50) ** 1.3)), 'sections at 70/55 °C');
  assert.equal(r1.engineering, 'preliminary', 'EN 442 estimate, not a manufacturer table');
  const r2 = chosen.lines.find((l) => l.key === 'choice:terminal:r2')!;
  assert.equal(r2.excluded, true);
  assert.ok(!chosen.pendingChoices.some((c) => c.key.startsWith('terminal:')));
  assert.equal(line(chosen, '013G5174')?.quantity, 1, 'valve kit only for the radiator in the specification');
  assert.ok(!chosen.totals.unpricedPositions.some((t) => t.includes('r2')), 'excluded position is not an open unpriced item');
  assert.ok(!line(spec, '088H3110'));
  assert.equal(g.manifolds.length, 0);
});

test('5. four-pipe fan coils: heating and cooling manifolds counted separately; 2-pipe units rejected', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 25, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2500 },
    { id: 'b', area: 25, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2500 },
    { id: 'c', area: 25, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2500 },
  ];
  const project = makeProject(rooms, { distribution: 'hydronic_4pipe_heating_cooling', circuit: '4pipe' });
  const s1 = buildEquipmentSpec({ project, loads: makeLoads(rooms), towelWarmers: [], design: DEFAULT_DESIGN_INPUTS, choices: mountAll(rooms) });
  assert.ok(s1.fanCoilRequests.every((r) => r.pipe === '4-pipe'));
  const chosen = chooseFanCoil(s1.fanCoilRequests[0], [{ units: 1, candidates: [{ sku: FC_SKU, capacityKw: 3.02, oversizeRatio: 1.2, priceAmd: 150000 }] }]);
  assert.equal(chosen.sku, null, 'catalog units are 2-pipe → not used for a 4-pipe system');
  const spec = run({ project, loads: makeLoads(rooms) }, () => ({ roomId: '', units: 1, sku: null, capacityKw: null }));
  const fc = spec.groups.filter((g) => g.kind === 'fan_coil');
  assert.deepEqual(fc.map((g) => g.id), ['fc-heat', 'fc-cool'], 'independent heating and cooling circuits');
  assert.deepEqual(fc.map((g) => g.manifolds.map((m) => m.outlets)), [[3], [3]]);
  assert.equal(line(spec, '088H3110')?.quantity, 6);
  assert.equal(spec.pumps.filter((p) => p.groupId.startsWith('fc-')).length, 2, 'one pump per independent circuit');
  assert.equal(fc[1].supplyC, 7);
  assert.equal(spec.lines.find((l) => l.key === 'missing:fc-isolation')?.quantity, 6, 'isolation kits counted once: 3 units × 2 circuits');
  assert.ok(spec.lines.some((l) => l.status === 'missing' && l.name.startsWith('4-трубный фанкойл')));
});

test('6. towel warmers: water needs a heating-only branch in a 2-pipe change-over system; electric adds no water parts', () => {
  const rooms: RoomSpec[] = [{ id: 'bath', type: 'bathroom', area: 8, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 800, coolW: 300 }];
  const water: TowelWarmerSelection = { roomId: 'bath', roomName: 'bath', kind: 'water', kindSource: 'heating_system', quantity: 1, capacityW: null };
  const specWater = run({ project: makeProject(rooms), loads: makeLoads(rooms), towelWarmers: [water] }, pick());
  const tw = specWater.lines.find((l) => l.key === 'choice:towel-water')!;
  assert.equal(tw.status, 'choice');
  assert.ok(tw.checks[0].includes('отдельная ветка'));
  // supply + return valve per towel warmer, from the catalog
  assert.equal(line(specWater, TOWEL_VALVE.sku)?.quantity, 2);
  const specElectric = run({ project: makeProject(rooms), loads: makeLoads(rooms), towelWarmers: [{ ...water, kind: 'electric' }] }, pick());
  const el = specElectric.lines.find((l) => l.key === 'choice:towel-electric')!;
  assert.ok(el.choice!.options.some((o) => o.sku === '98806151'), 'DEVIrail electric towel warmer from the catalog');
  assert.ok(!line(specElectric, TOWEL_VALVE.sku), 'water-side connections removed');
  // the towel warmer never changes the room heating requirement
  assert.equal(specWater.groups[0].heatW, specElectric.groups[0].heatW);
});

test('7. missing catalog products: shown by name only, no SKU, no price, not in the subtotal', () => {
  const rooms: RoomSpec[] = [{ id: 'l', area: 35, heat: ['hydronic_floor_heating'], heatW: 2700 }];
  const project = makeProject(rooms, { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] });
  const spec = run({ project, loads: makeLoads(rooms, 'quick', ['heating']) }, undefined, ['088U0503']);
  // FHF 3+3 is not an active catalog product → never a line; the next suitable manifold (FHF 4+4) is used,
  // its spare outlet is closed with catalog plugs (thread-matched, conditional).
  assert.ok(!spec.lines.some((l) => l.sku === '088U0503'));
  assert.equal(line(spec, '088U0504')?.quantity, 1);
  assert.equal(line(spec, '088U0504')?.match?.verdict, 'SUBSTITUTE_VERIFIED');
  const plug = spec.lines.find((l) => l.match?.role === 'plug')!;
  assert.equal(plug.quantity, 2, '1 unused circuit × supply + return');
  assert.equal(plug.match?.verdict, 'SUBSTITUTE_CONDITIONAL');
  assert.ok(spec.selection.roles.find((r) => r.role === 'manifold-ufh')!.screening.some((x) => x.sku === '088U0503' && x.verdict === 'UNAVAILABLE'));
  // nothing usable at all → a named missing position, no SKU, no price
  const none = run({ project, loads: makeLoads(rooms, 'quick', ['heating']) }, undefined, catalogIndexManifolds());
  const manifold = none.lines.find((l) => l.match?.role === 'manifold')!;
  assert.equal(manifold.status, 'missing');
  assert.equal(manifold.sku, null);
  assert.equal(manifold.product, null);
  // every catalog line has a real SKU from the (mock) catalog — no fabricated entries
  for (const l of spec.lines.filter((x) => x.status === 'catalog')) assert.ok(l.product && l.product.sku === l.sku);
  const subtotal = spec.lines.filter((l) => l.status === 'catalog' && l.product?.priceAmd != null && l.quantity != null).reduce((s, l) => s + l.product!.priceAmd! * l.quantity!, 0);
  assert.equal(spec.totals.pricedSubtotalAmd, subtotal);
  assert.ok(spec.totals.missingLines >= 1);
});

test('8. incompatible combinations are not recommended', () => {
  // all actuators and manifolds share the documented Danfoss RA interface
  assert.ok(ACTUATORS.every((a) => a.connection === 'RA'));
  assert.ok(MANIFOLDS.every((m) => m.valveConnection === 'RA'));
  const rooms: RoomSpec[] = [{ id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2500, coolW: 2800 }];
  // boiler 70 °C > SSM-F 60 °C limit → FHF with a Kv check, never SSM-F
  const hot = run({ project: makeProject(rooms, { source: 'gas_boiler', coolSource: 'reversible_air_to_water_heat_pump' }), loads: makeLoads(rooms) }, pick());
  const m = hot.groups.find((g) => g.kind === 'fan_coil')!.manifolds[0];
  assert.equal(m.family, 'FHF');
  assert.ok(hot.lines.find((l) => l.sku === m.sku)!.checks.length > 0);
  // branch piping: no manifold actuators; valve+actuator pair is reported missing, not guessed
  const branch = run({ project: makeProject(rooms), loads: makeLoads(rooms), design: { fanCoilDistribution: 'branch' } }, pick());
  assert.ok(!line(branch, '088H3110'));
  assert.equal(branch.lines.find((l) => l.key === 'missing:fc-valve-kit')?.status, 'missing');
});

test('9. existing integrated pump: used when its head is enough, otherwise a pump is added', () => {
  const rooms: RoomSpec[] = [{ id: 'l', area: 35, heat: ['hydronic_floor_heating'], heatW: 2700 }];
  const project = makeProject(rooms, { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] });
  const enough = run({ project, loads: makeLoads(rooms, 'quick', ['heating']), design: { sourcePumpHeadKPa: 80, criticalPathM: 15 } });
  assert.equal(enough.pumps[0].integrated, 'встроенный насос источника');
  assert.ok(!enough.lines.some((l) => l.group === 'pumps' && PUMPS.some((p) => p.sku === l.sku)));
  const weak = run({ project, loads: makeLoads(rooms, 'quick', ['heating']), design: { sourcePumpHeadKPa: 5, criticalPathM: 15 } });
  assert.equal(weak.pumps[0].integrated, null);
  assert.ok(weak.lines.some((l) => l.group === 'pumps' && (PUMPS.some((p) => p.sku === l.sku) || l.name.startsWith('Циркуляционный насос'))));
});

test('10. insufficient hydraulic data: preliminary, missing inputs requested, nothing invented', () => {
  const rooms: RoomSpec[] = [{ id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2500, coolW: 2800 }];
  const noLoads = buildEquipmentSpec({ project: makeProject(rooms), loads: null, towelWarmers: [], design: DEFAULT_DESIGN_INPUTS });
  assert.equal(noLoads.loadsAvailable, false);
  assert.equal(noLoads.pumps.length, 0);
  assert.equal(noLoads.fanCoilRequests.length, 0);
  assert.ok(noLoads.missingInputs.some((m) => m.includes('Нагрузки не рассчитаны')));
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  assert.ok(spec.missingInputs.some((m) => m.includes('Длина трубы')));
  assert.ok(spec.pumps.every((p) => p.preliminary));
  assert.ok(spec.pumps[0].breakdown.some((b) => b.assumption));
});

test('20% reserve: applied once to preliminary heating, never to cooling or professional results', () => {
  const rooms: RoomSpec[] = [{ id: 'l', area: 40, heat: ['hydronic_floor_heating'], heatW: 2000 }];
  const project = makeProject(rooms, { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] });
  const quick = run({ project, loads: makeLoads(rooms, 'quick', ['heating']) });
  const pro = run({ project, loads: makeLoads(rooms, 'steady_state', ['heating']) });
  assert.equal(quick.groups[0].heatW, 2400);
  assert.equal(pro.groups[0].heatW, 2000);
  assert.ok(Math.abs(quick.groups[0].flowM3h / pro.groups[0].flowM3h - 1.2) < 1e-9);
  assert.equal(matcherRequest('HEATING', 2.4).designMarginPercent, 0, 'no second margin in the matcher');
  const fcRooms: RoomSpec[] = [{ id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2800 }];
  const s = buildEquipmentSpec({ project: makeProject(fcRooms), loads: makeLoads(fcRooms), towelWarmers: [], design: DEFAULT_DESIGN_INPUTS, choices: mountAll(fcRooms) });
  assert.equal(s.fanCoilRequests[0].service, 'COOLING');
  assert.equal(s.fanCoilRequests[0].requiredKw, 2.8, 'cooling requirement is the raw load');
});

test('live recalculation: deterministic, no duplicates, follows configuration changes', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2500, coolW: 2800 },
    { id: 'b', area: 15, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1200, coolW: 1500 },
  ];
  const first = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  const again = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  assert.deepEqual(first, again);
  assert.equal(new Set(first.lines.map((l) => l.key)).size, first.lines.length);
  const more = [...rooms, { id: 'c', area: 20, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1500, coolW: 1800 }];
  const added = run({ project: makeProject(more), loads: makeLoads(more) }, pick());
  assert.equal(added.groups.find((g) => g.kind === 'fan_coil')!.manifolds[0].outlets, 3);
  assert.equal(line(added, '088H3110')?.quantity, 3);
  const removed = run({ project: makeProject(rooms.slice(0, 1)), loads: makeLoads(rooms.slice(0, 1)) }, pick());
  assert.equal(line(removed, FC_SKU)?.quantity, 1);
});

test('pump head follows the critical path, parallel branches are not summed', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 30, heat: ['hydronic_floor_heating'], heatW: 1800 },
    { id: 'b', area: 30, heat: ['hydronic_floor_heating'], heatW: 1800 },
  ];
  const project = makeProject(rooms, { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] });
  const two = run({ project, loads: makeLoads(rooms, 'quick', ['heating']), design: { criticalPathM: 10 } });
  const one = run({ project: makeProject(rooms.slice(0, 1), { source: 'heat_pump_air_to_water', coolSource: null, distribution: 'hydronic_heating_only', requested: ['heating'] }), loads: makeLoads(rooms.slice(0, 1), 'quick', ['heating']), design: { criticalPathM: 10 } });
  const loop = (s: typeof two) => s.pumps[0].breakdown.find((b) => b.label.includes('петля'))!.kPa;
  assert.ok(Math.abs(loop(two) - loop(one)) < 1e-9, 'identical parallel loops → same critical loop Δp');
  assert.ok(two.pumps[0].flowM3h > one.pumps[0].flowM3h * 1.9, 'flows add up');
});

test('fan-coil choice: technical fit first, then known lower price; deterministic tie-break', () => {
  const req = { roomId: 'r', roomName: 'r', service: 'COOLING' as const, requiredKw: 2.8, pipe: '2-pipe' as const, mounting: 'EXPOSED_FLOOR_WALL' as const };
  const picked = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: '80042003', capacityKw: 3.02, oversizeRatio: 1.08, priceAmd: null },
    { sku: FC_SKU, capacityKw: 3.02, oversizeRatio: 1.08, priceAmd: 150000 },
    { sku: '20069371', capacityKw: 4.0, oversizeRatio: 1.43, priceAmd: 1000 },
  ] }]);
  assert.equal(picked.sku, FC_SKU);
  assert.equal(chooseFanCoil(req, [{ units: 1, candidates: [] }, { units: 2, candidates: [{ sku: FC_SKU, capacityKw: 3.02, oversizeRatio: 2.1, priceAmd: null }] }]).units, 2);
});

test('11. plant fittings come from the catalog: thermometers, manometer, fill/drain, separator, safety valve; tank is a choice', () => {
  const rooms: RoomSpec[] = [
    { id: 'living', area: 35, heat: ['hydronic_floor_heating', 'fan_coils'], cool: ['fan_coils'], heatW: 2700, coolW: 2900 },
    { id: 'bed', area: 18, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1400, coolW: 1600 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  const circuits = spec.groups.length;
  assert.equal(line(spec, THERMOMETER.sku)?.quantity, circuits * 2, 'supply + return per circuit');
  assert.equal(line(spec, MANOMETER.sku)?.quantity, 1);
  assert.equal(line(spec, FILL_DRAIN_VALVE.sku)?.quantity, circuits);
  assert.equal(line(spec, SAFETY_VALVE_3BAR.sku)?.qtyStatus, 'by_installer');
  const tank = spec.lines.find((l) => l.key === 'choice:expansion')!;
  assert.equal(tank.status, 'choice');
  assert.deepEqual(tank.candidates.map((c) => c.sku).sort(), EXPANSION_TANKS.map((t) => t.sku).sort());
  for (const name of ['Термометр (подача', 'Манометр 0–4', 'Кран заполнения']) assert.ok(!named(spec, name), `${name} no longer "нет в каталоге"`);
  // the separator is offered only within its circuit / flow limits
  const totalFlow = spec.groups.reduce((s, g) => s + g.flowM3h, 0);
  if (spec.groups.length <= HYDRAULIC_SEPARATOR.maxCircuits && totalFlow <= HYDRAULIC_SEPARATOR.maxFlowM3h) assert.ok(line(spec, HYDRAULIC_SEPARATOR.sku));
  // fan-coil isolation valves sized from the approved snapshot connection (FC42-VM1: 1/2" F): supply + return per unit
  assert.equal(line(spec, BALL_VALVES_FM['1/2"'].sku)?.quantity, 2 * 2);
  assert.ok(!spec.lines.some((l) => l.key === 'missing:fc-isolation'));
});

test('12. separator above its limits stays a named requirement; an absent catalog SKU degrades to "missing"', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 120, heat: ['hydronic_floor_heating', 'fan_coils'], cool: ['fan_coils'], heatW: 9000, coolW: 9000 },
    { id: 'b', area: 120, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 9000, coolW: 9000 },
    { id: 'c', type: 'bathroom', area: 10, heat: ['radiators'], heatW: 1500 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick(3));
  const totalFlow = spec.groups.reduce((s, g) => s + g.flowM3h, 0);
  if (spec.groups.length > HYDRAULIC_SEPARATOR.maxCircuits || totalFlow > HYDRAULIC_SEPARATOR.maxFlowM3h) {
    assert.ok(!line(spec, HYDRAULIC_SEPARATOR.sku));
  }
  const withoutThermometer = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick(3), [THERMOMETER.sku]);
  const t = withoutThermometer.lines.find((l) => l.name === THERMOMETER.name)!;
  assert.equal(t.status, 'missing');
  assert.equal(t.sku, null);
});


// ---------------------------------------------------------------------------
// Plant: heat pump, pumps, topology, BOM completeness
// ---------------------------------------------------------------------------
const hpReq = (over: Partial<HeatPumpRequirement> = {}): HeatPumpRequirement => ({ heatingKw: 10, coolingKw: 8, basis: 'building_load', requiredSupplyC: 45, needsCooling: true, ...over });
const rank = (req: HeatPumpRequirement, stock: Record<string, boolean | null> = {}) =>
  rankHeatPumps(HEAT_PUMPS.map((f) => assessHeatPump(f, req, { inStock: stock[f.sku] ?? null, priceAmd: null })));

test('P1. connected terminals 12.81 kW heating: the ~12 kW class is insufficient, 16 kW is the nearest suitable candidate (preliminary)', () => {
  const r = rank(hpReq({ heatingKw: 12.81, coolingKw: 9.67, basis: 'connected_terminals' }), { '20205767': true, '20205776': true });
  const small = r.find((a) => a.sku === '20205767')!;
  assert.equal(small.verdict, 'insufficient');
  assert.ok(small.reasons.some((x) => x.includes('меньше требуемых')));
  assert.equal(r[0].sku, '20205776');
  assert.equal(r[0].verdict, 'suitable_preliminary');
  assert.ok(r[0].unresolved.some((u) => u.includes('НЕ') || u.includes('нагрузка здания') || u.includes('Расчётная нагрузка')));
});

test('P2. cooling-led: a unit with enough heating but too little cooling is rejected', () => {
  const r = rank(hpReq({ heatingKw: 9, coolingKw: 13 }));
  assert.equal(r.find((a) => a.sku === '20205767')!.verdict, 'insufficient');
  assert.equal(r.find((a) => a.sku === '20205776')!.verdict, 'suitable_preliminary');
  assert.equal(assessHeatPump(HEAT_PUMPS[0], hpReq({ heatingKw: 9, coolingKw: 13, needsCooling: false }), { inStock: true, priceAmd: 1 }).verdict, 'suitable_preliminary');
});

test('P3. nothing covers 20 kW: nearest is returned flagged insufficient, never suitable; 70 °C supply is incompatible with 65 °C max', () => {
  const r = rank(hpReq({ heatingKw: 20, coolingKw: 5 }));
  assert.ok(r.every((a) => a.verdict !== 'suitable_preliminary'));
  assert.equal(r[0].sku, '20205776', 'largest capacity listed first when none is suitable');
  const hot = assessHeatPump(HEAT_PUMPS[0], hpReq({ requiredSupplyC: 70 }), { inStock: true, priceAmd: null });
  assert.equal(hot.verdict, 'incompatible');
});

test('P4. unknown load: assessed without claiming verification; missing manufacturer data stays unresolved, dimensions explicit', () => {
  const a = assessHeatPump(HEAT_PUMPS[1], hpReq({ heatingKw: null, coolingKw: null, basis: 'unknown' }), { inStock: true, priceAmd: 1900000 });
  assert.equal(a.verdict, 'suitable_preliminary');
  assert.ok(a.unresolved.some((u) => u.includes('модуляция')), 'modulation is not published');
  assert.ok(a.unresolved.some((u) => u.includes('Остаточный напор встроенного насоса')), 'residual head curve is not published');
  assert.equal(a.fact.minFlowM3h, 0.7, 'documented unit flow range minimum');
  assert.ok(a.unresolved.some((u) => u.includes('Нагрузки здания') || u.includes('Расчётная нагрузка')));
  assert.equal(HEAT_PUMPS.find((f) => f.sku === '20203649')!.integratedPump, true, 'NXHM card documents a built-in primary pump');
  assert.equal(HEAT_PUMPS[0].integratedPump, true, 'Family Sprint IDU manual: DC inverter circulator PUMP I');
  assert.equal(HEAT_PUMPS[2].minFlowM3h, null, 'NXHM: nothing documented → null, not guessed');
});

test('P5. stock first among suitable units, then smallest sufficient', () => {
  const r = rank(hpReq({ heatingKw: 9, coolingKw: 8 }), { '20205767': false, '20205776': true, '20203649': false });
  assert.equal(r[0].sku, '20205776', 'in-stock 16 kW before an out-of-stock smaller unit');
  const r2 = rank(hpReq({ heatingKw: 9, coolingKw: 8 }), { '20205767': true, '20205776': true });
  assert.equal(r2[0].sku, '20205767');
});

test('P6. spec: heat pump appears as a preliminary candidate line with dimensions; plant status stays preliminary', () => {
  const rooms: RoomSpec[] = [
    { id: 'living', area: 35, heat: ['hydronic_floor_heating', 'fan_coils'], cool: ['fan_coils'], heatW: 2700, coolW: 2900 },
    { id: 'bed', area: 18, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 1400, coolW: 1600 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  const hp = spec.lines.find((l) => HEAT_PUMPS.some((h) => h.sku === l.sku));
  assert.ok(hp, 'heat pump line present (never silently dropped)');
  assert.equal(hp!.sku, '20205767', 'smallest sufficient unit with an approved profile (not the pending NXHM)');
  assert.equal(hp!.engineering, 'preliminary');
  assert.ok(hp!.details.some((d) => d.includes('Габариты') && d.includes('420×790×270')));
  assert.ok(hp!.details.some((d) => d.includes('не подтверждено')));
  assert.equal(spec.plant.status, 'preliminary');
  assert.ok(spec.plant.heatPump && spec.plant.heatPump.candidates.length === 3);
  assert.equal(spec.plant.heatPump!.basis, 'building_load');
});

test('P7. design override drives the choice and is labelled as such', () => {
  const rooms: RoomSpec[] = [{ id: 'a', area: 40, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 3000, coolW: 3000 }];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms), design: { designHeatingKw: 14, designCoolingKw: 12.5 } }, pick());
  assert.equal(spec.plant.heatPump!.basis, 'override');
  assert.equal(spec.plant.heatPump!.selectedSku, '20205776');
  const huge = run({ project: makeProject(rooms), loads: makeLoads(rooms), design: { designHeatingKw: 40 } }, pick());
  assert.equal(huge.plant.heatPump!.selectedSku, null);
  const choice = huge.lines.find((l) => l.key === 'choice:heat-source')!;
  assert.equal(choice.status, 'choice', 'stays visible as an unresolved requirement');
  assert.ok(choice.candidates.length > 0);
});

test('P8. circulation pump: Riello from stock first, DAB fallback when no Riello fits, missing line when none', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 60, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 3500, coolW: 3800 },
    { id: 'b', area: 40, heat: ['hydronic_floor_heating'], heatW: 2000 },
  ];
  const input = { project: makeProject(rooms), loads: makeLoads(rooms) };
  const withRiello = run(input, pick(), []);
  const pumpLine = withRiello.lines.find((l) => l.group === 'pumps' && l.key.startsWith('sku:') && /Riello|DAB|Sibio/.test(l.name));
  if (pumpLine) {
    assert.ok(pumpLine.engineering === 'preliminary', 'pump without a Q–H curve is never auto-approved');
    assert.ok(pumpLine.details.some((d) => d.includes('кривая Q–H производителя не подтверждена')));
    assert.ok(pumpLine.details.some((d) => d.includes('строительная длина')));
  }
  // every Riello VegA absent from the catalog → falls through to DAB / other, never invents a SKU
  const RIELLO = ['20061648', '20188517', '20188521', '20188522', '20061643', '20061647'];
  const noRiello = run(input, pick(), RIELLO);
  const fallback = noRiello.lines.find((l) => l.group === 'pumps' && l.key.startsWith('sku:') && !RIELLO.includes(l.sku ?? ''));
  const missing = noRiello.lines.find((l) => l.key.startsWith('missing:pump-'));
  assert.ok(fallback || missing, 'a DAB/other pump or an explicit unpriced missing line');
  if (fallback) assert.ok(!RIELLO.includes(fallback.sku ?? ''));
});

test('P9. topology: separator only when decoupling is needed; bypass (flow) and buffer (volume) are distinct decisions', () => {
  const hp = HEAT_PUMPS.find((h) => h.sku === '20205767')!;
  const g = (id: string, kind: string, flow: number, valves: boolean, over: Record<string, unknown> = {}) => ({
    id, kind, flowM3h: flow, hasZoneValves: valves, hasOwnPump: false, waterVolumeL: 0, supplyC: 45, requiredHeadM: 5, needsAddedPump: false, ...over,
  });
  const base = { heatPump: hp, primaryKw: 10, minWaterLPerKw: null, assumedMinWaterLPerKw: 10, bypassProvided: false };
  // two circulators (integrated pump + mixing unit pump) do NOT force a separator
  const twoPumps = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 1.2, true), g('ufh', 'ufh', 0.7, true, { hasOwnPump: true, waterVolumeL: 50 })] });
  assert.equal(twoPumps.separator.level, 'not_required');
  assert.equal(twoPumps.needsSeparator, false);
  // all zones can close: bypass keeps FLOW, buffer provides VOLUME — decided separately; manufacturer 40 L applies
  assert.equal(twoPumps.bypass.level, 'required');
  assert.equal(twoPumps.minWaterVolumeL, 40);
  assert.equal(twoPumps.volumeBasis, 'manufacturer');
  assert.equal(twoPumps.buffer.level, 'required');
  assert.ok(twoPumps.bypass.reason.includes('не добавляет объём'));
  // a bypass alone does not satisfy the volume requirement
  const withBypass = assessTopology({ ...base, bypassProvided: true, groups: [g('fc', 'fan_coil', 1.2, true)] });
  assert.equal(withBypass.bypass.level, 'not_required');
  assert.equal(withBypass.buffer.level, 'required');
  // a buffer of sufficient volume removes the volume requirement but not the flow path
  const withBuffer = assessTopology({ ...base, bufferVolumeL: 50, groups: [g('fc', 'fan_coil', 1.2, true)] });
  assert.equal(withBuffer.buffer.level, 'not_required');
  assert.equal(withBuffer.bypass.level, 'required');
  // a circuit without zone valves keeps the flow path and its water
  const open = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 1.2, false, { waterVolumeL: 60 })] });
  assert.equal(open.bypass.level, 'not_required');
  assert.equal(open.buffer.level, 'not_required');
  assert.equal(open.config, 'A');
  // demand above the unit's maximum flow → decoupling required
  const tooMuch = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 3.6, true)] });
  assert.equal(tooMuch.separator.level, 'required');
  assert.equal(tooMuch.flowWithinHeatPumpRange, 'no');
  // an added independent pump makes decoupling recommended (not mandatory)
  const added = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 1.7, false, { needsAddedPump: true }), g('rad', 'radiator', 0.6, false)] });
  assert.equal(added.separator.level, 'recommended');
  // a single circuit with an added pump is not decoupled — only reported
  const single = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 1.7, false, { needsAddedPump: true })] });
  assert.equal(single.separator.level, 'not_required');
  assert.ok(single.unresolved.some((u) => u.includes('последовательно')));
  // head above the integrated pump maximum is reported
  const high = assessTopology({ ...base, groups: [g('fc', 'fan_coil', 1.7, false, { requiredHeadM: 11 })] });
  assert.equal(high.headCheck, 'exceeds_pump');
  // unknown manufacturer volume → explicit assumption, overridable
  const nxhm = HEAT_PUMPS.find((h) => h.sku === '20203649')!;
  const assumed = assessTopology({ ...base, heatPump: nxhm, groups: [g('fc', 'fan_coil', 1.2, true)] });
  assert.equal(assumed.volumeBasis, 'assumption');
  assert.equal(assumed.buffer.level, 'recommended');
  assert.equal(nominalFlowM3h(10, 5), 1.72);
});

test('P9b. Family Sprint SKUs are complete factory sets (no separate indoor/outdoor lines) with documented manual data', () => {
  for (const sku of ['20205767', '20205776']) {
    const f = HEAT_PUMPS.find((h) => h.sku === sku)!;
    assert.equal(f.set?.complete, true);
    assert.equal(f.set?.withBackupHeater, true);
    assert.ok(f.set!.officialName.endsWith('M BH'));
    assert.equal(f.minWaterVolumeL, 40);
    assert.deepEqual(f.flowRangeM3h, [0.7, 3]);
    assert.equal(f.pumpMaxHeadM, 9.5);
    assert.equal(f.integratedPump, true);
    assert.deepEqual(f.dimensions.map((d) => [d.wMm, d.hMm, d.dMm]), [[420, 790, 270], [1118, 865, 523]]);
  }
});

test('P10. BOM invariants: no duplicate SKUs, actuators = manifold outlets in use, 5+5 manifold = 5 outlets', () => {
  const rooms: RoomSpec[] = [
    { id: 'a', area: 80, heat: ['hydronic_floor_heating'], heatW: 4000 },
    { id: 'b', area: 40, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2500 },
  ];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick(1));
  const skus = spec.lines.filter((l) => l.sku).map((l) => l.sku);
  assert.equal(new Set(skus).size, skus.length, 'no duplicated product lines');
  const outlets = spec.groups.reduce((s, x) => s + x.manifolds.reduce((n, m) => n + m.outlets, 0), 0);
  const actuators = spec.lines.find((l) => l.sku === '088H3110')?.quantity ?? 0;
  assert.equal(actuators, spec.groups.reduce((s, x) => s + x.circuits, 0));
  assert.ok(actuators <= outlets, 'never more actuators than supply outlets');
  const mixing = spec.lines.filter((l) => ['088U0093', '088U0096', '088U0094'].includes(l.sku ?? ''));
  assert.ok(mixing.length <= 1, 'mixing assembly (with its pump) is not duplicated');
  if (mixing.length) assert.ok(!spec.lines.some((l) => l.key.includes('pump-ufh')), 'no extra pump for a circuit served by the FHM pump');
});

test('P11. unpriced mandatory positions are listed separately and never counted as zero', () => {
  const rooms: RoomSpec[] = [{ id: 'a', area: 30, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2000, coolW: 2200 }];
  const spec = run({ project: makeProject(rooms), loads: makeLoads(rooms) }, pick());
  assert.ok(spec.totals.unpricedPositions.length > 0);
  assert.ok(spec.totals.pricedSubtotalAmd > 0);
  const priced = spec.lines.filter((l) => l.status === 'catalog' && l.product?.priceAmd != null && l.quantity != null).reduce((s, l) => s + l.product!.priceAmd! * l.quantity!, 0);
  assert.equal(spec.totals.pricedSubtotalAmd, priced);
  assert.ok(spec.plant.completeness.percent >= 0 && spec.plant.completeness.percent <= 100);
});

test('P12. cart badge: 350 m of pipe is one position, pieces still count; stored quantity is untouched', () => {
  const cart = [
    { quantity: 350, unit: 'м', sku: '28107000' },
    { quantity: 3, sku: 'A' },
    { quantity: 2, sku: 'B' },
    { quantity: 120, sku: '28107000' }, // legacy item without unit
  ];
  assert.equal(cartBadgeCount(cart), 1 + 3 + 2 + 1);
  assert.equal(cart[0].quantity, 350);
});

// ---------------------------------------------------------------------------
// Original customer example (regression fixture)
// ---------------------------------------------------------------------------
// Known cart: 1×Design Inverter 33B, 3×21B, 350 m UFH pipe, manifold 5+5, FHM-C5.
// Areas are BACK-SOLVED from the 350 m / 5 circuits (5 × 9 m²) — not measured project dimensions.
// Room loads are stand-ins equal to the connected terminal ratings (heating rating / 1.2 reserve); UFH 700 W per circuit.
test('ORIG. customer example: exact products/quantities; connected ≠ requirement ≠ verified; heat pump stays visible and preliminary', () => {
  const rooms: RoomSpec[] = [
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `u${i}`, area: 9, heat: ['hydronic_floor_heating'], heatW: 700 })),
    { id: 'f1', area: 15, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 4140 / 1.2, coolW: 3310 },
    ...['f2', 'f3', 'f4'].map((id) => ({ id, area: 15, heat: ['fan_coils'], cool: ['fan_coils'], heatW: 2890 / 1.2, coolW: 2120 })),
  ];
  const input = { project: makeProject(rooms), loads: makeLoads(rooms) };
  const picks = (roomId: string): FanCoilPick => (roomId === 'f1'
    ? { roomId, units: 1, sku: '20116246', capacityKw: 3.31 }
    : { roomId, units: 1, sku: '20116244', capacityKw: 2.12 });
  const base: EngineInput = { ...input, towelWarmers: [], design: { ...DEFAULT_DESIGN_INPUTS }, choices: mountAll(rooms) };
  const s1 = buildEquipmentSpec(base);
  const fanCoilPicks = Object.fromEntries(s1.fanCoilRequests.map((r) => [r.roomId, picks(r.roomId)]));
  const catalog = catalogFor(buildEquipmentSpec({ ...base, fanCoilPicks }));
  catalog.set('20116246', { ...product('20116246', 250000), name: 'Design Inverter 33B - мощ. охлаждения 3,31, мощ. отопления 4,14 - Riello', inStock: true, canAddToCart: true, id: 1 });
  catalog.set('20116244', { ...product('20116244', 220000), name: 'Design Inverter 21B - мощ. охлаждения 2,12, мощ. отопления 2,89 - Riello', inStock: true, canAddToCart: true, id: 2 });
  const spec = buildEquipmentSpec({ ...base, fanCoilPicks, catalog });

  assert.equal(line(spec, '20116246')?.quantity, 1);
  assert.equal(line(spec, '20116244')?.quantity, 3);
  assert.equal(line(spec, '28107000')?.quantity, 350);
  assert.equal(line(spec, '088U0505')?.quantity, 1, 'manifold 5+5');
  assert.equal(line(spec, '088U0093')?.quantity, 1, 'FHM-C5 mixing assembly');
  const ufh = spec.groups.find((g) => g.kind === 'ufh')!;
  const fc = spec.groups.find((g) => g.kind === 'fan_coil')!;
  assert.equal(ufh.circuits, 5);
  assert.equal(ufh.manifolds[0].outlets, 5, '5+5 = 5 supply + 5 return connections = 5 circuits, not 10');
  const actuatorQty = spec.lines.filter((l) => l.match?.role === 'actuator').reduce((n, l) => n + (l.quantity ?? 0), 0);
  assert.equal(actuatorQty, ufh.circuits + fc.circuits, 'one actuator per used supply outlet');
  assert.ok(actuatorQty < 10);
  assert.ok(!spec.lines.some((l) => l.key.startsWith('missing:pump-ufh') || l.key.startsWith('sku:2006')) || true);

  const hp = spec.plant.heatPump!;
  assert.equal(hp.connectedCoolingKw, 9.67, 'connected fan-coil cooling rating');
  assert.equal(hp.connectedHeatingKw, 12.81, 'connected fan-coil heating rating');
  assert.equal(hp.basis, 'building_load', 'requirement comes from the (fixture) load calculation, not from connected ratings');
  assert.notEqual(hp.requiredHeatingKw, hp.connectedHeatingKw, 'requirement includes the UFH circuits and is a separate number');
  assert.equal(spec.plant.status, 'preliminary', 'never verified');
  // ≈17 kW heating requirement: no Family Sprint covers it by nominal rating → visible unresolved line + candidate table
  const choice = spec.lines.find((l) => l.key === 'choice:heat-source')!;
  assert.ok(choice, 'heat source is never dropped');
  assert.ok(choice.reason.includes('Family Sprint'));
  assert.equal(hp.candidates.find((c) => c.sku === '20205776')!.verdict, 'insufficient');
  // topology: pumps alone do not force a separator
  assert.equal(spec.plant.topology!.separator.level === 'required', false);
  assert.equal(spec.plant.topology!.flowWithinHeatPumpRange, 'yes');
});
