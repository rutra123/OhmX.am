/**
 * Manifold role: every MANIFOLD profile of the catalog is screened, regardless of brand.
 *
 * Hard exclusions only on a proven failure (too few outlets, documented temperature limit
 * below the design). Missing data never silently excludes: it yields INSUFFICIENT_DATA.
 * A manifold with more outlets than needed is accepted when everything else holds; the unused
 * outlets become a plug requirement (plugs role).
 */
import { valveDpKPa } from '../hydraulics';
import { attr, catalogIndex, isVerified, num, str, type CatalogIndex } from './catalogIndex';
import { ABSENT_REASON, catalogAbsent, stockCheck, stockText, stockWeight, type InventoryInput } from './inventory';
import { CLASS_RANK, SELECTABLE, type MatchClass, type ProductProfile, type ScreeningRecord, type StockCheck } from './types';

export interface ManifoldRequirement {
  id: string;
  label: string;
  application: 'ufh' | 'fan_coil';
  /** Independent circuits on this manifold. */
  circuits: number;
  /** How many identical manifolds of this size the design needs (stock check). */
  quantity: number;
  maxFlowTempC: number;
  /** Chilled water through the manifold (2-pipe change-over / 4-pipe cooling). */
  chilledWater: boolean;
  /** Circuits are switched by thermal actuators (zone control). */
  needsActuators: boolean;
  /** Largest single-outlet flow, m³/h (fan coils: Kv check). */
  maxOutletFlowM3h: number | null;
  /** Reference series of the original design (exact match = this series with exactly `circuits` outlets). */
  designSeries: string;
}

export interface Evaluated {
  profile: ProductProfile;
  verdict: MatchClass;
  reasons: string[];
  checks: string[];
  stock: StockCheck;
  unusedOutlets: number;
  priceAmd: number | null;
  /** Number of open conditional points (engineering uncertainty; fewer is better). */
  uncertainties: number;
  /** Same series as the original design reference. */
  designSeries: boolean;
}

export interface PlugSelection {
  profile: ProductProfile | null;
  quantity: number;
  verdict: MatchClass;
  reasons: string[];
  checks: string[];
  stock: StockCheck | null;
  screening: ScreeningRecord[];
}

export interface ManifoldSelection {
  requirement: ManifoldRequirement;
  selected: Evaluated | null;
  /** Best candidates that were not selected (ranked), for the "why not" view. */
  alternatives: Evaluated[];
  plugs: PlugSelection | null;
  screening: ScreeningRecord[];
  population: number;
}

/** Max Δp across a manifold outlet valve used for the fan-coil Kv check (TWA table / FHF: 0.6 bar). */
const MAX_VALVE_DP_KPA = 60;

export function evaluateManifold(p: ProductProfile, req: ManifoldRequirement, inv: InventoryInput): Evaluated {
  const reasons: string[] = [];
  const checks: string[] = [];
  const fail: string[] = [];
  const unknown: string[] = [];
  const conditional: string[] = [];

  const outlets = num(p, 'outlets');
  if (outlets == null) unknown.push('число выходов не указано');
  else if (outlets < req.circuits) fail.push(`${outlets} выходов < нужно ${req.circuits}`);
  else if (!isVerified(attr(p, 'outlets'))) conditional.push(`число выходов ${outlets} — по названию в каталоге`);
  else reasons.push(`${outlets} выходов (${str(p, 'series')}, даташит) ≥ ${req.circuits}`);

  const tMax = num(p, 'max_temp_c');
  if (tMax == null) unknown.push('максимальная температура не указана');
  else if (tMax < req.maxFlowTempC) fail.push(`макс. температура ${tMax} °C < подача ${req.maxFlowTempC} °C`);
  else if (!isVerified(attr(p, 'max_temp_c'))) conditional.push(`макс. температура ${tMax} °C — по карточке каталога`);
  else reasons.push(`до ${tMax} °C ≥ ${req.maxFlowTempC} °C`);

  if (req.needsActuators) {
    const iface = attr(p, 'valve_interface');
    if (iface && isVerified(iface)) reasons.push(`клапаны выходов с присоединением ${iface.v} под термоприводы (даташит)`);
    else if (str(p, 'outlet_valve') === 'SHUTOFF') unknown.push('на выходах вентили — запорные или под термопривод, в карточке не указано');
    else unknown.push('присоединение клапанов выходов под термопривод не подтверждено');
  }

  if (req.application === 'fan_coil' && req.maxOutletFlowM3h != null && req.maxOutletFlowM3h > 0) {
    const kvs = num(p, 'kvs_max');
    if (kvs != null) {
      const dp = valveDpKPa(req.maxOutletFlowM3h, kvs);
      if (dp > MAX_VALVE_DP_KPA) fail.push(`расход ${req.maxOutletFlowM3h.toFixed(2)} м³/ч на выход: Δp клапана ${dp.toFixed(0)} кПа > ${MAX_VALVE_DP_KPA} кПа при kvs ${kvs}`);
      else reasons.push(`Δp клапана ${dp.toFixed(1)} кПа ≤ ${MAX_VALVE_DP_KPA} кПа (kvs ${kvs})`);
    } else {
      conditional.push('Kv клапанов выходов для расхода фанкойла не подтверждён');
    }
  }
  if (req.chilledWater) {
    conditional.push('работа с охлаждённой водой 7 °C в документации не указана — нужна теплоизоляция и подтверждение применимости');
  }
  if (attr(p, 'presetting')?.v === false && req.application === 'ufh') {
    checks.push('Коллектор без преднастройки: петли разной длины не сбалансировать — допустимо только при близких длинах петель.');
  }

  const stock = stockCheck(p.sku, req.quantity, inv);
  const priceAmd = inv.catalog?.get(p.sku)?.priceAmd ?? null;
  const unusedOutlets = outlets != null ? Math.max(0, outlets - req.circuits) : 0;

  let verdict: MatchClass;
  if (catalogAbsent(p.sku, inv)) { verdict = 'UNAVAILABLE'; fail.push(ABSENT_REASON); }
  else if (fail.length) verdict = 'INCOMPATIBLE';
  else if (unknown.length) verdict = 'INSUFFICIENT_DATA';
  else if (conditional.length) verdict = 'SUBSTITUTE_CONDITIONAL';
  else verdict = str(p, 'series') === req.designSeries && unusedOutlets === 0 ? 'EXACT_VERIFIED' : 'SUBSTITUTE_VERIFIED';

  if (unusedOutlets > 0 && verdict !== 'INCOMPATIBLE') reasons.push(`${unusedOutlets} лишн. ${unusedOutlets === 1 ? 'выход' : 'выхода(ов)'} — закрыть заглушками`);
  return {
    profile: p, verdict, stock, unusedOutlets, priceAmd,
    uncertainties: conditional.length + unknown.length,
    designSeries: str(p, 'series') === req.designSeries,
    reasons: [...fail, ...unknown, ...conditional.map((c) => `условно: ${c}`), ...reasons, stockText(stock)],
    checks: [...conditional, ...checks],
  };
}

/** Verified tiers are engineering-equivalent; conditional is a lower tier (never preferred for stock). */
const tier = (v: MatchClass) => (v === 'EXACT_VERIFIED' || v === 'SUBSTITUTE_VERIFIED' ? 0 : v === 'SUBSTITUTE_CONDITIONAL' ? 1 : 2);

export function rankEvaluated(a: Evaluated, b: Evaluated): number {
  return tier(a.verdict) - tier(b.verdict)
    || a.uncertainties - b.uncertainties
    || Number(b.designSeries) - Number(a.designSeries)
    || stockWeight(a.stock) - stockWeight(b.stock)
    || a.unusedOutlets - b.unusedOutlets
    || (a.priceAmd ?? Number.POSITIVE_INFINITY) - (b.priceAmd ?? Number.POSITIVE_INFINITY)
    || CLASS_RANK[a.verdict] - CLASS_RANK[b.verdict]
    || a.profile.sku.localeCompare(b.profile.sku);
}

export function selectManifold(req: ManifoldRequirement, inv: InventoryInput, index: CatalogIndex = catalogIndex()): ManifoldSelection {
  const population = index.byType('MANIFOLD');
  const evaluated = population.map((p) => evaluateManifold(p, req, inv));
  const eligible = evaluated.filter((e) => SELECTABLE.has(e.verdict)).sort(rankEvaluated);
  const selected = eligible[0] ?? null;
  const screening: ScreeningRecord[] = evaluated
    .slice()
    .sort((a, b) => CLASS_RANK[a.verdict] - CLASS_RANK[b.verdict] || rankEvaluated(a, b))
    .map((e) => ({
      sku: e.profile.sku, name: e.profile.name, brand: e.profile.brand, verdict: e.verdict, reasons: e.reasons,
      inStock: e.stock.status === 'SUFFICIENT' || e.stock.status === 'IN_STOCK_QTY_UNVERIFIED' ? true : e.stock.status === 'UNKNOWN' ? null : false,
      selected: e === selected,
    }));
  const plugs = selected && selected.unusedOutlets > 0 ? selectPlugs(selected, req, inv, index) : null;
  return { requirement: req, selected, alternatives: eligible.slice(1, 6), plugs, screening, population: population.length };
}

/** Plugs for unused outlets: thread of the outlet, opposite gender; sealing geometry is a check. */
export function selectPlugs(m: Evaluated, req: ManifoldRequirement, inv: InventoryInput, index: CatalogIndex = catalogIndex()): PlugSelection {
  // N+N manifold sets: each unused circuit leaves one supply and one return outlet open.
  const quantity = m.unusedOutlets * 2 * req.quantity;
  const thread = str(m.profile, 'outlet_thread');
  const gender = str(m.profile, 'outlet_gender');
  const population = index.byType('MANIFOLD_PLUG');
  const screening: ScreeningRecord[] = [];
  const ok: Array<{ p: ProductProfile; stock: StockCheck; price: number | null }> = [];
  for (const p of population) {
    const reasons: string[] = [];
    let verdict: MatchClass = 'SUBSTITUTE_CONDITIONAL';
    const pt = str(p, 'thread');
    const pg = str(p, 'gender');
    if (catalogAbsent(p.sku, inv)) { verdict = 'UNAVAILABLE'; reasons.push(ABSENT_REASON); }
    else if (!thread) { verdict = 'INSUFFICIENT_DATA'; reasons.push('резьба выходов коллектора не подтверждена'); }
    else if (!pt) { verdict = 'INSUFFICIENT_DATA'; reasons.push('резьба заглушки не указана'); }
    else if (pt !== thread) { verdict = 'INCOMPATIBLE'; reasons.push(`резьба ${pt} ≠ выход ${thread}`); }
    else if (gender && pg && pg === gender) { verdict = 'INCOMPATIBLE'; reasons.push(`заглушка ${pg === 'M' ? 'с наружной' : 'с внутренней'} резьбой на выход с такой же резьбой`); }
    else if (gender && !pg) { verdict = 'INSUFFICIENT_DATA'; reasons.push('тип резьбы заглушки (внутр./наруж.) не указан'); }
    else reasons.push(`резьба ${pt}${pg ? (pg === 'F' ? ' внутренняя' : ' наружная') : ''} — совпадает с выходом (карточки каталога)`);
    const stock = stockCheck(p.sku, quantity, inv);
    if (verdict === 'SUBSTITUTE_CONDITIONAL') ok.push({ p, stock, price: inv.catalog?.get(p.sku)?.priceAmd ?? null });
    screening.push({ sku: p.sku, name: p.name, brand: p.brand, verdict, reasons: [...reasons, stockText(stock)], inStock: stock.status === 'SUFFICIENT' || stock.status === 'IN_STOCK_QTY_UNVERIFIED' ? true : stock.status === 'UNKNOWN' ? null : false, selected: false });
  }
  ok.sort((a, b) => stockWeight(a.stock) - stockWeight(b.stock)
    // a plug intended for manifolds and an eurocone seat first: closest to the outlet geometry
    || Number(str(b.p, 'purpose') === 'MANIFOLD') - Number(str(a.p, 'purpose') === 'MANIFOLD')
    || Number(attr(b.p, 'eurocone')?.v === true) - Number(attr(a.p, 'eurocone')?.v === true)
    || (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY) || a.p.sku.localeCompare(b.p.sku));
  const best = ok[0];
  if (best) screening.find((s) => s.sku === best.p.sku)!.selected = true;
  screening.sort((a, b) => Number(b.selected) - Number(a.selected) || CLASS_RANK[a.verdict] - CLASS_RANK[b.verdict] || a.sku.localeCompare(b.sku));
  const mBrand = m.profile.brand ?? '';
  return {
    profile: best?.p ?? null,
    quantity,
    verdict: best ? 'SUBSTITUTE_CONDITIONAL' : 'UNAVAILABLE',
    reasons: best
      ? [`${m.unusedOutlets} неиспользуемых контура × 2 выхода (подача и обратка)${req.quantity > 1 ? ` × ${req.quantity} коллектора` : ''}`]
      : [thread ? `В каталоге нет заглушки ${thread} с подходящим типом резьбы` : `Резьба выходов коллектора ${m.profile.sku} документально не подтверждена — заглушку подобрать по месту`],
    checks: best
      ? [`Заглушка ${best.p.brand ?? ''} на выход ${mBrand} ${thread ?? ''}: резьба совпадает по карточкам, уплотнение (евроконус / плоская прокладка) производителями не подтверждено — проверить при монтаже.`]
      : [],
    stock: best?.stock ?? null,
    screening,
  };
}
