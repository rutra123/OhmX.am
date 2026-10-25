/**
 * Inventory-aware selection layer: substitutions, stock, cross-brand screening, control chain, audit.
 * Pure tests on the bundled catalog snapshot; stock comes from labelled test fixtures, never from the live warehouse.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogProduct } from '../src/features/buildingProject/equipment/equipmentEngine.js';
import { auditSpecification } from '../src/features/buildingProject/equipment/selection/audit.js';
import { catalogIndex } from '../src/features/buildingProject/equipment/selection/catalogIndex.js';
import { selectControlChain, type ControlZone } from '../src/features/buildingProject/equipment/selection/controlChain.js';
import { DEFAULT_SELECTION_POLICY, stockCheck, type InventoryInput, type QuantityRecord } from '../src/features/buildingProject/equipment/selection/inventory.js';
import { selectManifold, type ManifoldRequirement } from '../src/features/buildingProject/equipment/selection/manifolds.js';
import { selectPump, type PumpRequirement } from '../src/features/buildingProject/equipment/selection/pumps.js';

const index = catalogIndex();
const product = (sku: string, inStock: boolean | null = null, priceAmd: number | null = 1000): CatalogProduct =>
  ({ sku, name: sku, slug: sku, priceAmd, unit: 'шт', availabilityLabel: null, inStock });
/** Public-status catalog: every snapshot product known, the listed ones in stock. */
function catalog(inStock: string[] = [], absent: string[] = []): Map<string, CatalogProduct | null> {
  return new Map(index.all().map((p) => [p.sku, absent.includes(p.sku) ? null : product(p.sku, inStock.includes(p.sku))]));
}
const qty = (entries: Record<string, number>): Map<string, QuantityRecord> =>
  new Map(Object.entries(entries).map(([sku, available]) => [sku, { available, asOf: '2026-10-15T00:00:00Z', sourceLabel: 'test fixture', live: false }]));

const ufhReq = (circuits: number, over: Partial<ManifoldRequirement> = {}): ManifoldRequirement => ({
  id: 'm', label: 'UFH', application: 'ufh', circuits, quantity: 1, maxFlowTempC: 40, chilledWater: false,
  needsActuators: true, maxOutletFlowM3h: null, designSeries: 'FHF', ...over,
});

test('snapshot: built from a read-only catalog copy; every manifold, pump, actuator and thermostat is profiled', () => {
  assert.equal(index.meta.schema, 'ohmx.equipment-catalog-profiles.v1');
  assert.match(index.meta.dbSha256, /^[0-9a-f]{64}$/);
  assert.ok(index.byType('MANIFOLD').length >= 40);
  assert.ok(index.byType('CIRCULATION_PUMP').length >= 30);
  // datasheet facts override catalog wording and keep their document
  const twa = index.get('088H3112')!;
  assert.equal(twa.attrs.inrush_ma.src, 'datasheet');
  assert.equal(twa.attrs.inrush_ma.doc, 'DAN-TWA-2025');
  assert.equal(index.get('088U1010')!.attrs.max_actuators.v, 5);
});

test('coverage: every manifold profile gets a screening verdict with a reason (nothing silently dropped)', () => {
  const sel = selectManifold(ufhReq(6), { catalog: catalog() });
  assert.equal(sel.screening.length, index.byType('MANIFOLD').length);
  for (const s of sel.screening) assert.ok(s.reasons.length > 0, s.sku);
  // Carlo Poletti valve manifolds are screened (other brand), not ignored: ≤ 5 outlets → proven failure for 6 circuits,
  // and for 4 circuits the unknown valve type (shut-off or actuator-ready) → insufficient data, never silently dropped
  assert.ok(sel.screening.filter((s) => s.brand?.startsWith('Carlo Poletti')).every((s) => s.verdict === 'INCOMPATIBLE'));
  const four = selectManifold(ufhReq(4), { catalog: catalog() });
  assert.ok(four.screening.some((s) => s.brand?.startsWith('Carlo Poletti') && s.verdict === 'INSUFFICIENT_DATA'));
  // a 5-outlet manifold is a proven failure for 6 circuits
  assert.equal(sel.screening.find((s) => s.sku === '088U0505')!.verdict, 'INCOMPATIBLE');
});

test('example A: 6 circuits, FHF 6+6 out of stock, 8+8 in stock → 8+8 verified substitute + 4 plugs (conditional)', () => {
  const inv: InventoryInput = { catalog: catalog(['088U0508', 'A50902Q', 'A51000Q']) };
  const sel = selectManifold(ufhReq(6), inv);
  assert.equal(sel.selected?.profile.sku, '088U0508');
  assert.equal(sel.selected?.verdict, 'SUBSTITUTE_VERIFIED');
  assert.equal(sel.selected?.unusedOutlets, 2);
  assert.equal(sel.plugs?.quantity, 4, '2 unused circuits × supply + return');
  assert.equal(sel.plugs?.verdict, 'SUBSTITUTE_CONDITIONAL', 'thread matches by catalog cards; sealing not confirmed by manufacturers');
  assert.equal(sel.plugs?.profile?.sku, 'A50902Q', 'manifold plug with eurocone seat preferred');
  // with the exact size in stock the exact product wins
  const exact = selectManifold(ufhReq(6), { catalog: catalog(['088U0506', '088U0508']) });
  assert.equal(exact.selected?.profile.sku, '088U0506');
  assert.equal(exact.selected?.verdict, 'EXACT_VERIFIED');
  assert.equal(exact.plugs, null);
});

test('engineering before stock: a conditional manifold on stock never beats a verified one to order', () => {
  // 088U0616 (no presetting, code not in the FHF data sheet) is on stock; verified FHF/SSM are not
  const sel = selectManifold(ufhReq(6), { catalog: catalog(['088U0616']) });
  assert.notEqual(sel.selected?.profile.sku, '088U0616');
  assert.ok(['EXACT_VERIFIED', 'SUBSTITUTE_VERIFIED'].includes(sel.selected!.verdict));
  const rec = sel.screening.find((s) => s.sku === '088U0616')!;
  assert.equal(rec.verdict, 'INSUFFICIENT_DATA', 'code not in the FHF data sheet: actuator-ready valves not documented');
  assert.ok(rec.inStock);
  assert.ok(rec.reasons.some((r) => r.includes('термопривод')));
});

test('quantity: 12 needed, 8 available → INSUFFICIENT with the shortage; public status alone never claims sufficiency', () => {
  const s = stockCheck('088H3112', 12, { quantities: qty({ '088H3112': 8 }) });
  assert.equal(s.status, 'INSUFFICIENT');
  assert.equal(s.available, 8);
  assert.equal(s.sourceLabel, 'test fixture');
  const pub = stockCheck('088H3112', 12, { catalog: catalog(['088H3112']) });
  assert.equal(pub.status, 'IN_STOCK_QTY_UNVERIFIED');
  assert.equal(pub.available, null);
});

test('example B: pumps of every brand are screened; wrong kinds excluded with a reason; brand only breaks ties', () => {
  const req: PumpRequirement = { id: 'g', label: 'g', flowM3h: 1.2, headM: 3, maxFluidTempC: 45, chilledWater: false };
  const sel = selectPump(req, { catalog: catalog() }, DEFAULT_SELECTION_POLICY);
  const brands = new Set(sel.screening.map((s) => s.brand));
  for (const b of ['Riello', 'DAB', 'Krats', 'Calpeda']) assert.ok([...brands].some((x) => x?.startsWith(b)), b);
  assert.equal(sel.screening.find((s) => s.sku === '20125035')!.verdict, 'INCOMPATIBLE', 'boiler spare pump');
  assert.equal(sel.screening.find((s) => s.sku === '72S50250006')!.verdict, 'INCOMPATIBLE', 'borehole pump');
  // never verified without a manufacturer Q–H curve
  assert.equal(sel.selected?.verdict, 'SUBSTITUTE_CONDITIONAL');
  assert.ok(sel.screening.every((s) => s.verdict !== 'SUBSTITUTE_VERIFIED' && s.verdict !== 'EXACT_VERIFIED'));
  // a higher Hmax is not a reason to pick a pump: the smallest passing envelope wins among equals
  const h = (sku: string) => index.get(sku)!;
  const chosen = h(sel.selected!.profile.sku);
  for (const alt of sel.alternatives.filter((a) => a.efficiency === sel.selected!.efficiency && a.stock.status === sel.selected!.stock.status)) {
    const env = (p: typeof chosen) => (p.attrs.h_max_m.v as number) * (p.attrs.q_max_m3h.v as number);
    assert.ok(env(chosen) <= env(alt.profile), `${chosen.sku} vs ${alt.profile.sku}`);
  }
  // Hmax below the requirement is a proven failure
  const tooHigh = selectPump({ ...req, headM: 30 }, { catalog: catalog() }, DEFAULT_SELECTION_POLICY);
  assert.equal(tooHigh.screening.find((s) => s.sku === 'CRS 25/4')!.verdict, 'INCOMPATIBLE');
});

test('brand preference is a configurable last tie-breaker, not an eligibility rule', () => {
  const req: PumpRequirement = { id: 'g', label: 'g', flowM3h: 0.8, headM: 2.5, maxFluidTempC: 45, chilledWater: false };
  const none = selectPump(req, { catalog: catalog() }, { brandPreference: {} });
  const riello = selectPump(req, { catalog: catalog() }, DEFAULT_SELECTION_POLICY);
  // the same eligible set either way
  assert.deepEqual(none.screening.map((s) => [s.sku, s.verdict]).sort(), riello.screening.map((s) => [s.sku, s.verdict]).sort());
  // an efficient pump on stock beats a preferred brand that must be ordered
  const stocked = selectPump(req, { catalog: catalog(['60186087']) }, DEFAULT_SELECTION_POLICY);
  assert.equal(stocked.selected?.profile.sku, '60186087', 'DAB Evosta 3 (electronic) on stock');
});

const zone = (id: string, circuits: number, over: Partial<ControlZone> = {}): ControlZone => ({
  id, roomId: id, name: id, circuits, application: 'ufh', coolingControl: false, closeInCooling: false, manifoldSku: '088U0508', ...over,
});

test('example C: thermostat unavailable → 230 V chain verified on documented limits (≤ 5 actuators, 10 W, 3 A inrush)', () => {
  const inv: InventoryInput = { catalog: catalog(['088H3112', '088U1010']) };
  const r = selectControlChain([zone('a', 4), zone('b', 3)], inv, { coolingSwitch: false });
  assert.equal(r.selected?.id, 'ICON230_DIRECT');
  assert.equal(r.selected?.complete, true);
  const act = r.selected!.lines.find((l) => l.role === 'actuator')!;
  const th = r.selected!.lines.find((l) => l.role === 'thermostat')!;
  assert.equal(act.sku, '088H3112');
  assert.equal(act.quantity, 7);
  assert.equal(th.sku, '088U1010');
  assert.equal(th.quantity, 2);
  assert.ok(th.reasons.some((x) => x.includes('4 привод(ов) ≤ 5') || x.includes('≤ 5')));
  // the 24 V chain is evaluated too and is incomplete (no wired Icon 24 V thermostat in the catalog)
  const a24 = r.options.find((o) => o.id === 'ICON24_MASTER')!;
  assert.equal(a24.complete, false);
  assert.ok(a24.missing.some((m) => m.includes('24 В')));
});

test('a zone with 7 loops exceeds 5 actuators per 230 V thermostat → never accepted by the voltage label', () => {
  const r = selectControlChain([zone('big', 7), zone('small', 2)], { catalog: catalog() }, { coolingSwitch: false });
  const direct = r.options.find((o) => o.id === 'ICON230_DIRECT' || o.id === 'MIXED_230_24')!;
  assert.ok(direct.notes.some((n) => n.includes('7 приводов > 5')), JSON.stringify(direct.notes));
  for (const o of r.options) {
    const th = o.lines.find((l) => l.role === 'thermostat');
    if (th) assert.ok(!th.zones.includes('big'));
  }
});

test('third-party 230 V thermostats: contact rating in the name is not proof of actuator compatibility', () => {
  const r = selectControlChain([zone('a', 3)], { catalog: catalog() }, { coolingSwitch: false });
  const wf = r.screening.thermostats.find((t) => t.sku === 'WF11-3A1-b')!;
  assert.equal(wf.verdict, 'INSUFFICIENT_DATA');
  assert.ok(wf.reasons.some((x) => x.includes('ток контактов')));
  // refrigeration thermostats are not in the zone-control population at all
  assert.ok(!r.screening.thermostats.some((t) => t.sku === '077B7005'));
});

test('cooled fan-coil zones: heating-only 230 V thermostats are incompatible; 24 V Icon with expansion is used', () => {
  const r = selectControlChain([zone('fc', 2, { application: 'fan_coil', coolingControl: true, manifoldSku: '088U0752' })], { catalog: catalog() }, { coolingSwitch: true });
  assert.equal(r.selected?.id, 'ICON24_MASTER');
  assert.ok(r.selected!.lines.some((l) => l.role === 'expansion' && l.sku === '088U1100'));
  assert.ok(r.screening.thermostats.find((t) => t.sku === '088U1010')!.reasons.some((x) => x.includes('только для отопления')));
});

test('actuator ↔ valve: a documented different connection is incompatible even at the right voltage', () => {
  const r = selectControlChain([zone('a', 2)], { catalog: catalog() }, { coolingSwitch: false });
  const twaV = r.screening.actuators.find((a) => a.sku === '088H3122')!; // TWA-V: RAV/VMT connection
  assert.equal(twaV.verdict, 'INCOMPATIBLE');
  const amv = r.screening.actuators.find((a) => a.sku === '082H0163')!;
  assert.equal(amv.verdict, 'INCOMPATIBLE', 'motorised actuator for control valves');
});

test('audit: re-derives quantities and catches duplicates, actuator mismatch and missing roles', () => {
  const lines = [
    { key: 'a', sku: '088H3112', name: 'act', quantity: 5, status: 'catalog' as const, group: 'automation', engineering: null, match: { verdict: 'EXACT_VERIFIED' as const, role: 'actuator' } },
    { key: 'b', sku: '088H3112', name: 'act', quantity: 2, status: 'catalog' as const, group: 'automation', engineering: null, match: { verdict: 'EXACT_VERIFIED' as const, role: 'actuator' } },
    { key: 'c', sku: '088U1010', name: 'th', quantity: 1, status: 'catalog' as const, group: 'automation', engineering: null, match: { verdict: 'SUBSTITUTE_VERIFIED' as const, role: 'thermostat' } },
  ];
  const r = auditSpecification({
    lines, actuatedCircuits: 9, zones: [{ id: 'z', circuits: 6 }], plugOutlets: 0,
    requiredRoles: [{ role: 'pump', label: 'насос', satisfiedBy: (l) => l.match?.role === 'pump' }],
  }, { quantities: qty({ '088H3112': 6, '088U1010': 1 }) });
  const text = r.findings.map((f) => `${f.severity}:${f.message}`).join('\n');
  assert.match(text, /error:Термоприводов 7, а контуров с регулированием 9/);
  assert.match(text, /error:Код 088H3112 встречается в 2 строках/);
  assert.match(text, /error:Термостат 088U1010: в зоне 6 приводов > 5/);
  assert.match(text, /error:Нет позиции для обязательной функции: насос/);
  assert.match(text, /warning:«act»: нужно 7, на складе 6/);
  assert.equal(r.installationReady, false);
});
