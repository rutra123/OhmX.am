/**
 * Circulation pump role. All pump profiles of the catalog are screened, brand-neutral.
 *
 * The catalog has no manufacturer Q–H curves, only Hmax / Qmax per card. Therefore:
 *   - proven failures are excluded (Hmax below the required head, flow at/above Qmax,
 *     fluid temperature limit below the supply, wrong pump kind);
 *   - the duty point is screened with the usual wet-rotor approximation
 *     H(Q) = Hmax·(1 − (Q/Qmax)²) and Q ≤ 0.85·Qmax — an estimate, never a verification;
 *   - a pump that passes is at best SUBSTITUTE_CONDITIONAL ("preliminary").
 * Order: efficiency (variable speed / permanent-magnet first) → stock → smallest pump that passes
 * (least oversizing: smallest Hmax·Qmax envelope) → known price → manufacturer preference (configurable, last).
 */
import { approxPumpHeadM } from '../hydraulics';
import { attr, catalogIndex, num, sourceLabel, str, type CatalogIndex } from './catalogIndex';
import { ABSENT_REASON, brandRank, catalogAbsent, stockCheck, stockText, stockWeight, type InventoryInput, type SelectionPolicy } from './inventory';
import { CLASS_RANK, type MatchClass, type ProductProfile, type ScreeningRecord, type StockCheck } from './types';

export interface PumpRequirement {
  id: string;
  label: string;
  flowM3h: number;
  headM: number;
  maxFluidTempC: number;
  chilledWater: boolean;
}

export interface PumpEvaluated {
  profile: ProductProfile;
  verdict: MatchClass;
  reasons: string[];
  headAtFlowM: number | null;
  stock: StockCheck;
  efficiency: 0 | 1 | 2;
}

export interface PumpSelection {
  selected: PumpEvaluated | null;
  evaluated: PumpEvaluated[];
  alternatives: PumpEvaluated[];
  screening: ScreeningRecord[];
  population: number;
}

/** Usual upper flow limit on the approximate curve (avoid the run-out end). */
export const PUMP_MAX_FLOW_SHARE = 0.85;

const r2 = (n: number) => Math.round(n * 100) / 100;
const envelope = (p: ProductProfile) => (num(p, 'h_max_m') ?? 0) * (num(p, 'q_max_m3h') ?? 0);

function efficiencyClass(p: ProductProfile): 0 | 1 | 2 {
  if (str(p, 'speed_control') === 'ELECTRONIC' || str(p, 'motor') === 'PERMANENT_MAGNET') return 0;
  if (str(p, 'motor') === 'ASYNCHRONOUS' || str(p, 'speed_control') === 'FIXED_SPEEDS') return 2;
  return 1;
}

export function evaluatePump(p: ProductProfile, req: PumpRequirement, inv: InventoryInput): PumpEvaluated {
  const stock = stockCheck(p.sku, 1, inv);
  const efficiency = efficiencyClass(p);
  const base = { profile: p, stock, efficiency, headAtFlowM: null as number | null };
  if (catalogAbsent(p.sku, inv)) return { ...base, verdict: 'UNAVAILABLE', reasons: [ABSENT_REASON] };
  if (p.type === 'BOILER_SPARE_PUMP') return { ...base, verdict: 'INCOMPATIBLE', reasons: ['насос-запчасть для конкретной модели котла, не отдельный циркуляционный насос'] };
  if (p.type === 'OTHER_PUMP') return { ...base, verdict: 'INCOMPATIBLE', reasons: ['не циркуляционный насос (скважинный / дренажный / насосная станция)'] };
  const h = num(p, 'h_max_m');
  const q = num(p, 'q_max_m3h');
  if (h == null || q == null) {
    return { ...base, verdict: 'INSUFFICIENT_DATA', reasons: [`в каталоге нет ${[h == null ? 'макс. напора' : '', q == null ? 'макс. расхода' : ''].filter(Boolean).join(' и ')} — рабочую точку не проверить`] };
  }
  const src = `Hmax ${h} м, Qmax ${q} м³/ч (${sourceLabel(attr(p, 'h_max_m'))})`;
  if (h < req.headM) return { ...base, verdict: 'INCOMPATIBLE', reasons: [`Hmax ${h} м < требуемого напора ${r2(req.headM)} м`] };
  if (req.flowM3h >= q) return { ...base, verdict: 'INCOMPATIBLE', reasons: [`расход ${r2(req.flowM3h)} м³/ч ≥ Qmax ${q} м³/ч`] };
  const tMax = num(p, 'fluid_temp_max_c');
  if (tMax != null && tMax < req.maxFluidTempC) return { ...base, verdict: 'INCOMPATIBLE', reasons: [`макс. температура жидкости ${tMax} °C < ${req.maxFluidTempC} °C`] };
  const headAt = approxPumpHeadM(h, q, req.flowM3h);
  if (req.flowM3h > PUMP_MAX_FLOW_SHARE * q || headAt < req.headM) {
    return {
      ...base, headAtFlowM: headAt, verdict: 'INSUFFICIENT_DATA',
      reasons: [`по приближённой кривой: ≈${r2(headAt)} м при ${r2(req.flowM3h)} м³/ч (нужно ${r2(req.headM)} м) — проверка только по кривой Q–H производителя`, src],
    };
  }
  const reasons = [`≈${r2(headAt)} м при ${r2(req.flowM3h)} м³/ч ≥ ${r2(req.headM)} м — оценка H = Hmax·(1−(Q/Qmax)²), кривая Q–H производителя не подтверждена`, src];
  if (num(p, 'phases') === 3 || (num(p, 'voltage_v') ?? 0) >= 380) reasons.push('условно: трёхфазное питание 400 В');
  if (tMax == null) reasons.push('условно: температурный предел жидкости не указан');
  if (req.chilledWater) reasons.push('условно: работа с охлаждённой водой (конденсат на корпусе) — по паспорту насоса');
  reasons.push(efficiency === 0 ? 'энергоэффективный (регулируемая скорость / синхронный двигатель)' : efficiency === 2 ? 'асинхронный, ступенчатые скорости — менее энергоэффективен' : 'тип двигателя не указан');
  return { ...base, headAtFlowM: headAt, verdict: 'SUBSTITUTE_CONDITIONAL', reasons };
}

export function selectPump(req: PumpRequirement, inv: InventoryInput, policy: SelectionPolicy, index: CatalogIndex = catalogIndex()): PumpSelection {
  const population = index.byType('CIRCULATION_PUMP', 'BOILER_SPARE_PUMP', 'OTHER_PUMP');
  const evaluated = population.map((p) => evaluatePump(p, req, inv));
  const price = (e: PumpEvaluated) => inv.catalog?.get(e.profile.sku)?.priceAmd ?? Number.POSITIVE_INFINITY;
  const ranked = evaluated.filter((e) => e.verdict === 'SUBSTITUTE_CONDITIONAL').sort((a, b) =>
    a.efficiency - b.efficiency
    || stockWeight(a.stock) - stockWeight(b.stock)
    // least oversizing: smallest curve envelope Hmax·Qmax (a pump far larger by flow runs at the far left of its curve)
    || envelope(a.profile) - envelope(b.profile)
    || (num(a.profile, 'h_max_m') ?? 0) - (num(b.profile, 'h_max_m') ?? 0)
    || price(a) - price(b)
    || brandRank(policy, 'CIRCULATION_PUMP', a.profile.brand) - brandRank(policy, 'CIRCULATION_PUMP', b.profile.brand)
    || a.profile.sku.localeCompare(b.profile.sku));
  const selected = ranked[0] ?? null;
  const screening = evaluated
    .slice()
    .sort((a, b) => Number(b === selected) - Number(a === selected) || CLASS_RANK[a.verdict] - CLASS_RANK[b.verdict] || a.profile.sku.localeCompare(b.profile.sku))
    .map((e) => ({
      sku: e.profile.sku, name: e.profile.name, brand: e.profile.brand, verdict: e.verdict,
      reasons: [...e.reasons, stockText(e.stock)],
      inStock: e.stock.status === 'SUFFICIENT' || e.stock.status === 'IN_STOCK_QTY_UNVERIFIED' ? true : e.stock.status === 'UNKNOWN' ? null : false,
      selected: e === selected,
    }));
  return { selected, evaluated, alternatives: ranked.slice(1, 6), screening, population: population.length };
}
