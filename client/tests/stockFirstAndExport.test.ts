/**
 * Sales rule "what is on our stock first" + specification export (cart items, PDF definition).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAN_COIL_STOCK_MAX_OVERSIZE, chooseFanCoil, type BomLine, type EquipmentSpec } from '../src/features/buildingProject/equipment/equipmentEngine';
import { toCatalogProduct } from '../src/features/buildingProject/equipment/catalogClient';
import { buildSpecPdfDefinition, cartItemsFromSpec, specPdfFileName } from '../src/features/buildingProject/equipment/specExport';

// A/B/C are Riello RK N cassette units → the request asks for a cassette installation
const req = { roomId: 'r', roomName: 'r', service: 'COOLING' as const, requiredKw: 2.8, pipe: '2-pipe' as const, mounting: 'CASSETTE' as const };
// 2-pipe units from the approved hydraulic snapshot
const A = '20051794';
const B = '20051795';
const C = '20051796';

test('fan coil: an in-stock unit in the best-fit band wins over a cheaper unit to order', () => {
  const pick = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: A, capacityKw: 3.0, oversizeRatio: 1.07, priceAmd: 100000, inStock: false },
    { sku: B, capacityKw: 3.0, oversizeRatio: 1.08, priceAmd: 150000, inStock: true },
  ] }]);
  assert.equal(pick.sku, B);
  assert.equal(pick.inStock, true);
});

test(`fan coil: a larger unit on stock is NOT auto-selected over a closer fit; it is offered as a reviewed alternative (≤ ${FAN_COIL_STOCK_MAX_OVERSIZE}×)`, () => {
  const ok = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: A, capacityKw: 2.9, oversizeRatio: 1.03, priceAmd: 90000, inStock: false },
    { sku: B, capacityKw: 4.2, oversizeRatio: 1.5, priceAmd: 200000, inStock: true },
  ] }]);
  assert.equal(ok.sku, A, 'engineering fit first (directive 2026-10-15)');
  assert.equal(ok.inStock, false);
  assert.deepEqual(ok.stockAlternative, { sku: B, capacityKw: 4.2, oversizeRatio: 1.5 });
  const tooBig = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: A, capacityKw: 2.9, oversizeRatio: 1.03, priceAmd: 90000, inStock: false },
    { sku: C, capacityKw: 6.0, oversizeRatio: 2.1, priceAmd: 200000, inStock: true },
  ] }]);
  assert.equal(tooBig.sku, A);
  assert.equal(tooBig.stockAlternative, undefined, 'beyond the review range nothing is offered');
});

test('fan coil: in-stock units outside the best-fit band are alternatives only; unknown stock keeps the closest fit', () => {
  const pick = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: A, capacityKw: 4.2, oversizeRatio: 1.5, priceAmd: 100000, inStock: true },
    { sku: B, capacityKw: 3.6, oversizeRatio: 1.3, priceAmd: 180000, inStock: true },
    { sku: C, capacityKw: 2.9, oversizeRatio: 1.04, priceAmd: 80000, inStock: false },
  ] }]);
  assert.equal(pick.sku, C);
  assert.equal(pick.stockAlternative?.sku, B, 'closest in-stock unit is the alternative');
  const unknown = chooseFanCoil(req, [{ units: 1, candidates: [
    { sku: A, capacityKw: 3.0, oversizeRatio: 1.07, priceAmd: 100000 },
    { sku: B, capacityKw: 3.0, oversizeRatio: 1.08, priceAmd: 150000 },
  ] }]);
  assert.equal(unknown.sku, A);
});

test('catalog card → product: stock status and cart fields', () => {
  const card = { id: 7, sku: 'X', slug: 'x', name_ru: 'X', price_amd: 1000, show_price: 1, unit: 'шт', availability_status: 'available_to_order', can_add_to_cart: true, cover_image: '/i.jpg' };
  const inStock = toCatalogProduct(card);
  assert.equal(inStock.inStock, true);
  assert.equal(inStock.id, 7);
  assert.equal(inStock.canAddToCart, true);
  assert.equal(toCatalogProduct({ ...card, availability_status: 'preorder', can_add_to_cart: false }).inStock, false);
  assert.equal(toCatalogProduct({ ...card, availability_status: 'price_on_request' }).inStock, true);
  assert.equal(toCatalogProduct({ ...card, availability_status: null }).inStock, null);
});

function line(over: Partial<BomLine>): BomLine {
  return {
    key: 'k', group: 'fittings', name: 'Позиция', sku: null, quantity: 1, unit: 'шт', qtyStatus: 'confirmed', status: 'catalog', reason: '',
    candidates: [], checks: [], tech: [], evidence: [], product: null, pending: false, details: [], engineering: null, ...over,
  } as BomLine;
}
const product = (sku: string, over: Record<string, unknown> = {}) => ({ sku, name: `Товар ${sku}`, slug: sku, priceAmd: 1000, unit: 'шт', availabilityLabel: 'В наличии', id: 10, image: '', inStock: true, canAddToCart: true, ...over });

function spec(lines: BomLine[]): EquipmentSpec {
  return {
    lines,
    summary: { totalAreaM2: 50, heatingRequiredW: 4000, heatingReserveRatio: 0.2, coolingW: 3000, configuration: 'фанкойлы 2-трубные', circuits: 2, manifoldText: '—' },
    totals: { pricedSubtotalAmd: 5000, pricedLines: 2, unpricedLines: 1, choiceLines: 1, missingLines: 1, unpricedPositions: ['Теплоизоляция'] },
    groups: [], pumps: [], warnings: [], missingInputs: [], assumptions: [], fanCoilRequests: [], skus: [], ready: true,
    plant: { status: 'preliminary', statusReasons: [], heatPump: null, topology: null, completeness: { total: 3, fromCatalog: 1, candidatesToVerify: 0, missing: 1, choices: 1, percent: 33 } },
  } as unknown as EquipmentSpec;
}

test('"Всё в корзину": only priced in-stock catalog lines with a known quantity; fractional metres rounded up', () => {
  const s = spec([
    line({ key: 'a', sku: 'A', quantity: 2, product: product('A', { id: 1 }) as any }),
    line({ key: 'pipe', sku: 'P', quantity: 37.4, unit: 'м', product: product('P', { id: 2 }) as any }),
    line({ key: 'order', sku: 'O', quantity: 1, product: product('O', { id: 3, inStock: false, canAddToCart: false }) as any }),
    line({ key: 'noprice', sku: 'N', quantity: 1, product: product('N', { id: 4, priceAmd: null }) as any }),
    line({ key: 'site', sku: 'S', quantity: null, qtyStatus: 'by_installer', product: product('S', { id: 5 }) as any }),
    line({ key: 'missing', status: 'missing', name: 'Нет в каталоге' }),
  ]);
  const { items, skipped } = cartItemsFromSpec(s);
  assert.deepEqual(items.map((i) => [i.sku, i.quantity]), [['A', 2], ['P', 38]]);
  assert.deepEqual(skipped.map((l) => l.key), ['order', 'noprice', 'site']);
});

test('PDF definition: groups, numbering, missing section, totals; file name is safe', () => {
  const s = spec([
    line({ key: 'fc', group: 'main', sku: 'FC', quantity: 2, product: product('FC') as any }),
    line({ key: 'tank', group: 'pumps', status: 'choice', name: 'Расширительный бак', candidates: [product('VEMS-0019') as any] }),
    line({ key: 'm', status: 'missing', name: 'Теплоизоляция', quantity: null, qtyStatus: 'by_installer' }),
  ]);
  const doc = buildSpecPdfDefinition(s, { projectName: 'Квартира / Ереван', date: new Date('2026-10-14T00:00:00Z') });
  const text = JSON.stringify(doc);
  assert.ok(text.includes('1. Тепловой источник и терминальные приборы'));
  assert.ok(text.includes('3. Циркуляция, разделение и безопасность'));
  assert.ok(text.includes('6. Нужно для монтажа, нет в каталоге'));
  assert.ok(text.includes('в наличии'));
  assert.ok(text.includes('VEMS-0019 (в наличии)'));
  assert.ok(text.includes('5 000 драм') || text.includes('5 000 драм') || text.includes('5 000 драм'));
  assert.equal(specPdfFileName('Квартира / Ереван', new Date('2026-10-14T00:00:00Z')), 'Спецификация Квартира Ереван 2026-10-14.pdf');
});
