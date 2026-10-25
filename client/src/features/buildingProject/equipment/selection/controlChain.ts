/**
 * Zone control chain: room thermostat → [controller / wiring center] → thermal actuator → manifold valve.
 *
 * Complete alternative architectures are assembled and compared as a whole (directive §13);
 * every interface of every link is checked on documented values:
 *   electrical  — voltage, output type, continuous load, inrush, actuators per output, NC/NO;
 *   mechanical  — actuator connection = manifold valve connection, documented pair;
 *   functional  — heating / cooling capability of the thermostat for the zone.
 * A voltage label alone never makes a link compatible.
 */
import { attr, catalogIndex, isVerified, num, str, type CatalogIndex } from './catalogIndex';
import { ABSENT_REASON, catalogAbsent, stockCheck, stockText, stockWeight, type InventoryInput } from './inventory';
import { CLASS_RANK, weakest, type MatchClass, type ProductProfile, type ScreeningRecord, type StockCheck } from './types';

export interface ControlZone {
  id: string;
  /** Room of the zone: one room thermostat per room, even when the room has several actuated circuits groups. */
  roomId: string;
  name: string;
  /** Actuated circuits (manifold outlets) of the zone. */
  circuits: number;
  application: 'ufh' | 'fan_coil';
  /** The zone itself must be controlled in cooling (fan coils on chilled water). */
  coolingControl: boolean;
  /** UFH zone in a 2-pipe change-over system: loops must stay closed during cooling. */
  closeInCooling: boolean;
  /** Manifold that carries the zone circuits. */
  manifoldSku: string | null;
}

export interface ChainLine {
  role: 'actuator' | 'thermostat' | 'controller' | 'expansion' | 'wiring_center';
  sku: string | null;
  name: string;
  quantity: number;
  verdict: MatchClass;
  reasons: string[];
  checks: string[];
  evidence: string[];
  stock: StockCheck | null;
  zones: string[];
}

export interface ArchitectureResult {
  id: 'ICON24_MASTER' | 'ICON230_DIRECT' | 'MIXED_230_24' | 'THIRD_PARTY_230';
  label: string;
  /** All roles resolved with a selectable product (installation still subject to the verdict). */
  complete: boolean;
  verdict: MatchClass;
  lines: ChainLine[];
  notes: string[];
  missing: string[];
  stockScore: number;
  knownCostAmd: number;
  unpricedLines: number;
  /** Lines resolved with a catalog product. */
  resolvedLines: number;
}

export interface ControlChainResult {
  selected: ArchitectureResult | null;
  options: ArchitectureResult[];
  screening: { actuators: ScreeningRecord[]; thermostats: ScreeningRecord[]; controllers: ScreeningRecord[] };
}

const inStockOf = (s: StockCheck) => (s.status === 'SUFFICIENT' || s.status === 'IN_STOCK_QTY_UNVERIFIED' ? true : s.status === 'UNKNOWN' ? null : false);
const docsOf = (p: ProductProfile) => [...new Set(Object.values(p.attrs).map((a) => a.doc).filter((d): d is string => Boolean(d)))];

// ---------------------------------------------------------------------------
// Actuator ↔ manifold valve
// ---------------------------------------------------------------------------

function actuatorVerdict(a: ProductProfile, voltage: 24 | 230, manifold: ProductProfile | undefined): { verdict: MatchClass; reasons: string[] } {
  const reasons: string[] = [];
  const v = num(a, 'voltage_v');
  const fn = str(a, 'function');
  if (v == null) return { verdict: 'INSUFFICIENT_DATA', reasons: ['напряжение не указано'] };
  if (v !== voltage) return { verdict: 'INCOMPATIBLE', reasons: [`${v} В ≠ ${voltage} В цепи`] };
  if (!isVerified(attr(a, 'voltage_v'))) reasons.push(`условно: ${v} В — по названию в каталоге`);
  const iface = attr(a, 'valve_interface');
  const mIface = attr(manifold, 'valve_interface');
  if (!manifold || !mIface) return { verdict: 'INSUFFICIENT_DATA', reasons: [...reasons, 'присоединение клапанов коллектора не подтверждено'] };
  if (!iface) return { verdict: 'INSUFFICIENT_DATA', reasons: [...reasons, 'присоединение привода к клапану не указано'] };
  if (isVerified(iface) && isVerified(mIface) && iface.v !== mIface.v) {
    return { verdict: 'INCOMPATIBLE', reasons: [`присоединение ${iface.v} ≠ клапаны коллектора ${mIface.v} (даташит)`] };
  }
  const documented = String(attr(manifold, 'documented_actuators')?.v ?? '').split(',').includes(a.sku);
  const modelDoc = attr(manifold, 'documented_actuator_model');
  let verdict: MatchClass;
  if (documented) {
    verdict = 'EXACT_VERIFIED';
    reasons.push(`код ${a.sku} указан в даташите коллектора как привод для его клапанов`);
  } else if (isVerified(iface) && isVerified(mIface) && iface.v === mIface.v && modelDoc && modelDoc.v === str(a, 'model')) {
    verdict = 'SUBSTITUTE_VERIFIED';
    reasons.push(`${str(a, 'model')} для коллектора по таблице совместимости ${modelDoc.doc}`);
  } else if (isVerified(iface) && isVerified(mIface) && iface.v === mIface.v) {
    verdict = 'SUBSTITUTE_CONDITIONAL';
    reasons.push(`присоединение ${iface.v} совпадает (даташиты), но пара «привод–коллектор» производителем не указана`);
  } else {
    verdict = 'SUBSTITUTE_CONDITIONAL';
    reasons.push(`присоединение ${iface.v} — по карточке каталога`);
  }
  if (fn === 'NO') {
    verdict = weakest(verdict, 'SUBSTITUTE_CONDITIONAL');
    reasons.push('нормально открытый (NO): без питания контур открыт — нужен термостат с инверсией выхода; при отключении питания пол греет без регулирования');
  } else if (fn !== 'NC') {
    verdict = weakest(verdict, 'INSUFFICIENT_DATA');
    reasons.push('функция NC/NO не указана');
  }
  if (reasons.some((r) => r.startsWith('условно'))) verdict = weakest(verdict, 'SUBSTITUTE_CONDITIONAL');
  return { verdict, reasons };
}

function pickActuator(voltage: 24 | 230, manifolds: ProductProfile[], qty: number, inv: InventoryInput, index: CatalogIndex) {
  const population = index.byType('THERMAL_ACTUATOR');
  const evals = population.map((a) => {
    // The weakest link over all manifolds the actuator must fit.
    const per = manifolds.length ? manifolds.map((m) => actuatorVerdict(a, voltage, m)) : [actuatorVerdict(a, voltage, undefined)];
    const absent = catalogAbsent(a.sku, inv);
    const verdict = absent ? 'UNAVAILABLE' as MatchClass : weakest(...per.map((x) => x.verdict));
    const reasons = absent ? [ABSENT_REASON] : [...new Set(per.flatMap((x) => x.reasons))];
    const stock = stockCheck(a.sku, qty, inv);
    return { a, verdict, reasons, stock };
  });
  const usable = evals.filter((e) => CLASS_RANK[e.verdict] <= CLASS_RANK.SUBSTITUTE_CONDITIONAL)
    .sort((x, y) => CLASS_RANK[x.verdict] - CLASS_RANK[y.verdict] || stockWeight(x.stock) - stockWeight(y.stock)
      || (inv.catalog?.get(x.a.sku)?.priceAmd ?? Infinity) - (inv.catalog?.get(y.a.sku)?.priceAmd ?? Infinity) || x.a.sku.localeCompare(y.a.sku));
  return { best: usable[0] ?? null, evals };
}

// ---------------------------------------------------------------------------
// Thermostat (230 V direct switching) ↔ actuators
// ---------------------------------------------------------------------------

function thermostat230Verdict(t: ProductProfile, zone: ControlZone, act: ProductProfile, inv: InventoryInput = {}): { verdict: MatchClass; reasons: string[]; checks: string[] } {
  const reasons: string[] = [];
  const checks: string[] = [];
  if (catalogAbsent(t.sku, inv)) return { verdict: 'UNAVAILABLE', reasons: [ABSENT_REASON], checks };
  const out = attr(t, 'output');
  const maxAct = num(t, 'max_actuators');
  if (!out || !isVerified(out) || maxAct == null) {
    const rated = attr(t, 'rated_current_a');
    return {
      verdict: 'INSUFFICIENT_DATA',
      reasons: [
        'тип выхода (питающий 230 В / сухой контакт), допустимая нагрузка и число приводов производителем не подтверждены',
        ...(rated ? [`в названии указано ${rated.raw ?? rated.v} — это ток контактов, а не допустимое число термоприводов`] : []),
      ],
      checks,
    };
  }
  if (zone.circuits > maxAct) {
    return { verdict: 'INCOMPATIBLE', reasons: [`в зоне ${zone.circuits} приводов > ${maxAct} на один термостат (${attr(t, 'max_actuators')?.doc}) — нужен коммутационный центр`], checks };
  }
  const pW = num(act, 'power_w');
  const inrushMa = num(act, 'inrush_ma');
  const maxW = num(t, 'max_continuous_w');
  const maxInrushA = num(t, 'max_inrush_a');
  if (pW == null || inrushMa == null || !isVerified(attr(act, 'power_w')) || !isVerified(attr(act, 'inrush_ma'))) {
    return { verdict: 'INSUFFICIENT_DATA', reasons: ['мощность / пусковой ток привода не подтверждены даташитом'], checks };
  }
  const totalW = pW * zone.circuits;
  const totalInrushA = (inrushMa * zone.circuits) / 1000;
  if (maxW != null && totalW > maxW) return { verdict: 'INCOMPATIBLE', reasons: [`${zone.circuits} × ${pW} Вт = ${totalW} Вт > ${maxW} Вт выхода`], checks };
  if (maxInrushA != null && totalInrushA > maxInrushA) return { verdict: 'INCOMPATIBLE', reasons: [`пусковой ток ${totalInrushA.toFixed(2)} А > ${maxInrushA} А`], checks };
  reasons.push(`${zone.circuits} привод(ов) ≤ ${maxAct}; ${totalW} Вт ≤ ${maxW} Вт; пуск ${totalInrushA.toFixed(2)} А ≤ ${maxInrushA} А (даташиты)`);
  const actFn = str(act, 'function');
  const supported = String(attr(t, 'actuator_function')?.v ?? '');
  if (actFn && supported && !supported.split(',').includes(actFn)) return { verdict: 'INCOMPATIBLE', reasons: [`термостат не поддерживает приводы ${actFn}`], checks };
  const modes = String(attr(t, 'modes')?.v ?? '');
  let verdict: MatchClass = 'SUBSTITUTE_VERIFIED';
  if (zone.coolingControl && !modes.includes('COOLING')) {
    return { verdict: 'INCOMPATIBLE', reasons: ['термостат только для отопления, а зону нужно регулировать и в режиме охлаждения'], checks };
  }
  if (zone.closeInCooling) {
    verdict = 'REQUIRES_ENGINEERING_REVIEW';
    reasons.push('термостат только для отопления: в режиме охлаждения NC-приводы без питания держат петли закрытыми, пока в комнате теплее уставки');
    checks.push('2-трубная система с охлаждением: подтвердить, что в режиме охлаждения петли тёплого пола гарантированно закрыты (уставка / отсечной клапан на подаче тёплого пола).');
  }
  return { verdict, reasons, checks };
}

// ---------------------------------------------------------------------------
// Architectures
// ---------------------------------------------------------------------------

function summarize(id: ArchitectureResult['id'], label: string, lines: ChainLine[], notesIn: string[], missing: string[], inv: InventoryInput): ArchitectureResult {
  const notes = [...new Set(notesIn)];
  const priced = lines.filter((l) => l.sku && inv.catalog?.get(l.sku)?.priceAmd != null);
  return {
    id, label, lines, notes, missing,
    complete: missing.length === 0 && lines.every((l) => l.sku),
    verdict: lines.length ? weakest(...lines.map((l) => l.verdict), ...(missing.length ? ['UNAVAILABLE' as MatchClass] : [])) : 'UNAVAILABLE',
    stockScore: lines.reduce((s, l) => s + (l.stock ? stockWeight(l.stock) : 4), 0),
    resolvedLines: lines.filter((l) => l.sku).length,
    knownCostAmd: priced.reduce((s, l) => s + (inv.catalog!.get(l.sku!)!.priceAmd! * l.quantity), 0),
    unpricedLines: lines.length - priced.length,
  };
}

function icon24For(zones: ControlZone[], manifolds: ProductProfile[], inv: InventoryInput, index: CatalogIndex, coolingSwitch: boolean) {
  const lines: ChainLine[] = [];
  const missing: string[] = [];
  const n = zones.reduce((s, z) => s + z.circuits, 0);
  const { best: act } = pickActuator(24, manifolds, n, inv, index);
  if (act) {
    lines.push({ role: 'actuator', sku: act.a.sku, name: act.a.name, quantity: n, verdict: act.verdict, reasons: [...act.reasons, stockText(act.stock)], checks: [], evidence: docsOf(act.a), stock: act.stock, zones: zones.map((z) => z.id) });
  } else missing.push('Термопривод 24 В под клапаны коллектора');
  // Icon 24 V master: 1 actuator per output (DAN-ICON24-2020); 10 or 15 outputs.
  const masters = index.byType('ZONE_CONTROLLER').filter((c) => !catalogAbsent(c.sku, inv) && num(c, 'output_voltage_v') === 24 && num(c, 'channels') != null && isVerified(attr(c, 'channels')));
  const big = masters.slice().sort((a, b) => (num(b, 'channels') ?? 0) - (num(a, 'channels') ?? 0))[0];
  if (big) {
    const count = Math.ceil(n / (num(big, 'channels') ?? 1));
    const perMaster = Math.ceil(n / count);
    const m = masters.filter((c) => (num(c, 'channels') ?? 0) >= perMaster).sort((a, b) => (num(a, 'channels') ?? 0) - (num(b, 'channels') ?? 0))[0] ?? big;
    const stock = stockCheck(m.sku, count, inv);
    lines.push({
      role: 'controller', sku: m.sku, name: m.name, quantity: count, verdict: 'EXACT_VERIFIED',
      reasons: [`1 привод на выход, ${num(m, 'channels')} выходов; приводов ${n} → ${count} шт.`, `24 В DC, ≤ 2 Вт на выход ≥ 2 Вт TWA (даташиты)`, stockText(stock)],
      checks: [], evidence: docsOf(m), stock, zones: zones.map((z) => z.id),
    });
    if (coolingSwitch) {
      const expSku = String(attr(m, 'cooling_requires')?.v ?? '');
      const exp = catalogAbsent(expSku, inv) ? undefined : index.get(expSku);
      const es = exp ? stockCheck(exp.sku, count, inv) : null;
      if (exp) lines.push({ role: 'expansion', sku: exp.sku, name: exp.name, quantity: count, verdict: 'EXACT_VERIFIED', reasons: ['переключение отопление/охлаждение в Icon 24 В (даташит мастер-контроллера)', stockText(es!)], checks: [], evidence: ['DAN-ICON24-2020'], stock: es, zones: [] });
      else missing.push('Модуль расширения Icon для охлаждения');
    }
  } else missing.push('Мастер-контроллер 24 В');
  // Wired Icon 24 V room thermostats: none in the catalog (all catalog Icon thermostats are 230 V or wireless).
  const t24 = index.byType('ROOM_THERMOSTAT').filter((t) => str(t, 'family')?.includes('24 V'));
  const rooms = new Set(zones.map((z) => z.roomId)).size;
  if (!t24.length) missing.push(`Комнатный термостат Danfoss Icon 24 В, проводной — ${rooms} шт., по одному на помещение (в каталоге нет: 088U1051/088U1055)`);
  return { lines, missing };
}

function icon230For(zones: ControlZone[], manifolds: ProductProfile[], inv: InventoryInput, index: CatalogIndex, manifoldsOf: (zs: ControlZone[]) => ProductProfile[]) {
  const lines: ChainLine[] = [];
  const missing: string[] = [];
  const unsupported: Array<{ zone: ControlZone; reason: string }> = [];
  const n = zones.reduce((s, z) => s + z.circuits, 0);
  const { best: act } = pickActuator(230, manifolds, n, inv, index);
  if (!act) return { lines, missing: ['Термопривод 230 В под клапаны коллектора'], unsupported: zones.map((zone) => ({ zone, reason: 'нет привода 230 В' })) };
  const thermostats = index.byType('ROOM_THERMOSTAT', 'WATER_UFH_THERMOSTAT');
  const chosen = new Map<string, { t: ProductProfile; zones: ControlZone[]; verdict: MatchClass; reasons: string[]; checks: string[] }>();
  for (const zone of zones) {
    const evals = thermostats.map((t) => ({ t, ...thermostat230Verdict(t, zone, act.a, inv) }))
      .filter((e) => CLASS_RANK[e.verdict] <= CLASS_RANK.REQUIRES_ENGINEERING_REVIEW && e.verdict !== 'INSUFFICIENT_QUANTITY')
      .sort((x, y) => CLASS_RANK[x.verdict] - CLASS_RANK[y.verdict] || stockWeight(stockCheck(x.t.sku, 1, inv)) - stockWeight(stockCheck(y.t.sku, 1, inv))
        || (inv.catalog?.get(x.t.sku)?.priceAmd ?? Infinity) - (inv.catalog?.get(y.t.sku)?.priceAmd ?? Infinity) || x.t.sku.localeCompare(y.t.sku));
    const best = evals[0];
    if (!best) {
      const anyLimit = thermostats.map((t) => thermostat230Verdict(t, zone, act.a, inv)).find((v) => v.verdict === 'INCOMPATIBLE');
      unsupported.push({ zone, reason: anyLimit?.reasons[0] ?? 'нет термостата 230 В с подтверждённой нагрузкой выхода' });
      continue;
    }
    const cur = chosen.get(best.t.sku) ?? { t: best.t, zones: [], verdict: best.verdict, reasons: [], checks: [] };
    cur.zones.push(zone);
    cur.verdict = weakest(cur.verdict, best.verdict);
    for (const r of best.reasons) if (!cur.reasons.includes(r)) cur.reasons.push(r);
    for (const c of best.checks) if (!cur.checks.includes(c)) cur.checks.push(c);
    chosen.set(best.t.sku, cur);
  }
  const covered = zones.filter((z) => !unsupported.some((u) => u.zone === z));
  const nCovered = covered.reduce((s, z) => s + z.circuits, 0);
  // The actuator line is checked only against the manifolds of the zones this architecture serves.
  const actCovered = nCovered > 0 ? pickActuator(230, manifoldsOf(covered), nCovered, inv, index).best : null;
  if (nCovered > 0 && !actCovered) missing.push('Термопривод 230 В под клапаны коллектора');
  if (nCovered > 0 && actCovered) {
    const stock = stockCheck(actCovered.a.sku, nCovered, inv);
    lines.push({
      role: 'actuator', sku: actCovered.a.sku, name: actCovered.a.name, quantity: nCovered, verdict: actCovered.verdict,
      reasons: [...actCovered.reasons, stockText(stock)],
      checks: [`Цепь 230 В приводов: предохранитель не более ${num(actCovered.a, 'prefuse_max_a') ?? 3} А (даташит TWA); кабель к термостату 3×1,5 мм².`],
      evidence: docsOf(actCovered.a), stock, zones: covered.map((z) => z.id),
    });
  }
  for (const c of chosen.values()) {
    const stock = stockCheck(c.t.sku, c.zones.length, inv);
    lines.push({
      role: 'thermostat', sku: c.t.sku, name: c.t.name, quantity: c.zones.length, verdict: c.verdict,
      reasons: [`по одному на зону: ${c.zones.map((z) => `«${z.name}» (${z.circuits})`).join(', ')}`, ...c.reasons, stockText(stock)],
      checks: c.checks, evidence: docsOf(c.t), stock, zones: c.zones.map((z) => z.id),
    });
  }
  return { lines, missing, unsupported };
}

export function selectControlChain(zones: ControlZone[], inv: InventoryInput, opts: { coolingSwitch: boolean }, index: CatalogIndex = catalogIndex()): ControlChainResult {
  const manifoldOf = (z: ControlZone) => (z.manifoldSku ? index.get(z.manifoldSku) : undefined);
  const manifolds = (zs: ControlZone[]) => [...new Map(zs.map(manifoldOf).filter((m): m is ProductProfile => Boolean(m)).map((m) => [m.sku, m])).values()];
  const options: ArchitectureResult[] = [];
  if (!zones.length) return { selected: null, options, screening: { actuators: [], thermostats: [], controllers: [] } };

  // A: everything on Icon 24 V
  const a = icon24For(zones, manifolds(zones), inv, index, opts.coolingSwitch);
  options.push(summarize('ICON24_MASTER', 'Danfoss Icon 24 В: мастер-контроллер + приводы 24 В', a.lines, [], a.missing, inv));

  // B: 230 V thermostats switch the actuators directly; zones they cannot serve fall back to Icon 24 V (mixed).
  const b = icon230For(zones, manifolds(zones), inv, index, manifolds);
  const rest = b.unsupported.map((u) => u.zone);
  if (!rest.length) {
    options.push(summarize('ICON230_DIRECT', 'Термостаты 230 В напрямую управляют приводами 230 В', b.lines, [], b.missing, inv));
  } else if (rest.length < zones.length) {
    const r = icon24For(rest, manifolds(rest), inv, index, opts.coolingSwitch && rest.some((z) => z.coolingControl));
    options.push(summarize('MIXED_230_24', 'Смешанная: 230 В напрямую + Icon 24 В для остальных зон', [...b.lines, ...r.lines],
      b.unsupported.map((u) => `«${u.zone.name}»: ${u.reason}`), [...b.missing, ...r.missing], inv));
  } else {
    options.push(summarize('ICON230_DIRECT', 'Термостаты 230 В напрямую управляют приводами 230 В', b.lines,
      b.unsupported.map((u) => `«${u.zone.name}»: ${u.reason}`), ['Термостат 230 В с подтверждённой нагрузкой для зон', ...b.missing], inv));
  }

  // Complete before incomplete; then the weakest link; then fewer missing roles and more resolved lines; then stock; then known cost.
  const ranked = options.slice().sort((x, y) => Number(y.complete) - Number(x.complete)
    || CLASS_RANK[x.verdict] - CLASS_RANK[y.verdict]
    || x.missing.length - y.missing.length || y.resolvedLines - x.resolvedLines
    || x.stockScore - y.stockScore || x.knownCostAmd - y.knownCostAmd);

  // Screening of every actuator / thermostat / controller profile (coverage, "why not")
  const allManifolds = manifolds(zones);
  const n = zones.reduce((s, z) => s + z.circuits, 0);
  const sampleZone = zones.reduce((m, z) => (z.circuits > m.circuits ? z : m), zones[0]);
  const actScreen = (v: 24 | 230) => pickActuator(v, allManifolds, n, inv, index).evals;
  const act230 = pickActuator(230, allManifolds, n, inv, index).best;
  const selectedSkus = new Set(ranked[0]?.lines.map((l) => l.sku).filter(Boolean) as string[]);
  const actuators = index.byType('THERMAL_ACTUATOR', 'MOTOR_ACTUATOR').map((p) => {
    if (p.type === 'MOTOR_ACTUATOR') {
      return { sku: p.sku, name: p.name, brand: p.brand, verdict: 'INCOMPATIBLE' as MatchClass, reasons: ['моторный привод для регулирующих клапанов (ход/усилие других клапанов), не для клапанов коллектора тёплого пола'], inStock: inStockOf(stockCheck(p.sku, null, inv)), selected: false };
    }
    const e24 = actScreen(24).find((e) => e.a.sku === p.sku)!;
    const e230 = actScreen(230).find((e) => e.a.sku === p.sku)!;
    const e = CLASS_RANK[e24.verdict] <= CLASS_RANK[e230.verdict] ? e24 : e230;
    return { sku: p.sku, name: p.name, brand: p.brand, verdict: e.verdict, reasons: [...e.reasons, stockText(e.stock)], inStock: inStockOf(e.stock), selected: selectedSkus.has(p.sku) };
  });
  const thermostats = index.byType('ROOM_THERMOSTAT', 'WATER_UFH_THERMOSTAT', 'ELECTRIC_UFH_THERMOSTAT', 'THERMOSTAT_OTHER').map((t) => {
    const stock = stockCheck(t.sku, null, inv);
    if (t.type === 'ELECTRIC_UFH_THERMOSTAT') {
      return { sku: t.sku, name: t.name, brand: t.brand, verdict: 'INSUFFICIENT_DATA' as MatchClass, reasons: ['терморегулятор для электрического тёплого пола: работа с термоприводами водяного пола производителем не подтверждена', stockText(stock)], inStock: inStockOf(stock), selected: false };
    }
    const v = act230 ? thermostat230Verdict(t, sampleZone, act230.a, inv) : { verdict: 'INSUFFICIENT_DATA' as MatchClass, reasons: ['нет привода 230 В для проверки'] };
    return { sku: t.sku, name: t.name, brand: t.brand, verdict: v.verdict, reasons: [...v.reasons, stockText(stock)], inStock: inStockOf(stock), selected: selectedSkus.has(t.sku) };
  });
  const controllers = index.byType('ZONE_CONTROLLER', 'CONTROL_ACCESSORY').map((c) => {
    const stock = stockCheck(c.sku, null, inv);
    const documented = isVerified(attr(c, 'channels'));
    return {
      sku: c.sku, name: c.name, brand: c.brand,
      verdict: (documented ? 'EXACT_VERIFIED' : 'INSUFFICIENT_DATA') as MatchClass,
      reasons: [documented ? 'характеристики по даташиту' : 'напряжение выходов, число каналов и совместимость не подтверждены документом', stockText(stock)],
      inStock: inStockOf(stock), selected: selectedSkus.has(c.sku),
    };
  });
  const order = (a: ScreeningRecord, b: ScreeningRecord) => Number(b.selected) - Number(a.selected) || CLASS_RANK[a.verdict] - CLASS_RANK[b.verdict] || a.sku.localeCompare(b.sku);
  return {
    selected: ranked[0] ?? null,
    options: ranked,
    screening: { actuators: actuators.sort(order), thermostats: thermostats.sort(order), controllers: controllers.sort(order) },
  };
}
