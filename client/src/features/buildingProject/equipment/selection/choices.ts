/**
 * Customer choices inside the specification ("нужен выбор" positions).
 *
 * Every choice position carries its options (catalog products with the quantity the room needs, or an
 * explicit decision such as "подбирается отдельно"). A choice is resolved only by an explicit selection;
 * the PDF export requires all required choices to be resolved. Nothing is pre-selected silently.
 */
import { catalogIndex, num, str } from './catalogIndex';
import type { InventoryInput } from './inventory';
import type { ProductProfile } from './types';

export interface ChoiceOption {
  id: string;
  label: string;
  /** Short engineering note shown under the option (estimate basis, limits). */
  detail?: string;
  /** Catalog product of the option (kind 'product'). */
  sku?: string;
  /** Quantity this option needs (e.g. units / sections for the room load). */
  quantity?: number | null;
  /** Shown but not selectable (with the reason in `detail`). */
  disabled?: boolean;
  /** 'exclude' = not part of this specification (bought separately / included elsewhere); 'confirm' = decision without a product. */
  kind: 'product' | 'exclude' | 'confirm' | 'value';
  /** Extra checks the line gets when this option is chosen. */
  checks?: string[];
}

export interface LineChoice {
  key: string;
  prompt: string;
  options: ChoiceOption[];
  selectedId: string | null;
  /** A choice that blocks the final document until resolved. */
  required: boolean;
}

export const EXCLUDE_ID = 'exclude';
export const CONFIRM_ID = 'confirm';

export function excludeOption(label = 'Не включать — подбирается отдельно'): ChoiceOption {
  return { id: EXCLUDE_ID, label, kind: 'exclude' };
}

export function confirmOption(label: string): ChoiceOption {
  return { id: CONFIRM_ID, label, kind: 'confirm' };
}

/** Selected option, only when it still exists and is selectable (stale selections are ignored). */
export function selectedOption(choice: LineChoice | undefined): ChoiceOption | null {
  if (!choice?.selectedId) return null;
  const o = choice.options.find((x) => x.id === choice.selectedId);
  return o && !o.disabled ? o : null;
}

// ---------------------------------------------------------------------------
// Room heating terminals: output at design temperatures (EN 442 conversion, estimate)
// ---------------------------------------------------------------------------

const ROOM_AIR_C = 20;

/**
 * Rated output converted to the design mean water temperature with the EN 442 characteristic
 * Q = Qrated · (ΔT / ΔTrated)^n. The exponent n is model-specific; typical values are used
 * (radiators 1.3, natural convectors 1.4) — always an estimate. Fan-assisted convectors are not
 * converted (their output depends on the fan speed): null.
 */
export function designOutputW(p: ProductProfile, supplyC: number, returnC: number): number | null {
  const rated = num(p, 'rated_w');
  const ratedDt = num(p, 'rated_dt');
  if (rated == null || ratedDt == null || p.attrs.fan_assisted?.v === true) return null;
  const dt = (supplyC + returnC) / 2 - ROOM_AIR_C;
  if (dt <= 0) return 0;
  return rated * (dt / ratedDt) ** exponentOf(p).n;
}

/**
 * EN 442 exponent: from two rating points of the same product in the catalog when available
 * (n = ln(Q2/Q1) / ln(Δt2/Δt1)), otherwise the typical value for the device type.
 */
export function exponentOf(p: ProductProfile): { n: number; basis: string } {
  const q1 = num(p, 'rated_w');
  const t1 = num(p, 'rated_dt');
  const q2 = num(p, 'rated2_w');
  const t2 = num(p, 'rated2_dt');
  if (q1 && t1 && q2 && t2 && t1 !== t2 && q1 > 0 && q2 > 0) {
    const n = Math.log(q2 / q1) / Math.log(t2 / t1);
    if (Number.isFinite(n) && n >= 1 && n <= 1.8) return { n, basis: `n ${n.toFixed(2)} по двум паспортным точкам (Δt ${t1} и ${t2})` };
  }
  return p.type === 'CONVECTOR' ? { n: 1.4, basis: 'n 1,4 — типовое для конвекторов' } : { n: 1.3, basis: 'n 1,3 — типовое для радиаторов' };
}

/** Above this many units / sections for one room the model is offered as unsuitable (mounting impractical). */
const MAX_UNITS_PER_ROOM = 6;
const MAX_SECTIONS_PER_ROOM = 24;

export function terminalOptions(
  kind: 'radiator' | 'convector',
  requiredW: number | null,
  supplyC: number,
  returnC: number,
  inv: InventoryInput,
): ChoiceOption[] {
  const list = catalogIndex().byType(kind === 'radiator' ? 'RADIATOR' : 'CONVECTOR');
  const temps = `${supplyC}/${returnC} °C`;
  const opts = list.map((p): ChoiceOption & { sortKey: number[] } => {
    const sectional = p.attrs.sectional?.v === true;
    const q = designOutputW(p, supplyC, returnC);
    const inStock = inv.catalog?.get(p.sku)?.inStock === true;
    const absent = inv.catalog?.has(p.sku) === true && inv.catalog.get(p.sku) === null;
    if (absent) return { id: p.sku, sku: p.sku, kind: 'product', label: p.name, detail: 'нет в действующем каталоге', disabled: true, sortKey: [9] };
    if (q == null || requiredW == null || requiredW <= 0) {
      return {
        id: p.sku, sku: p.sku, kind: 'product', quantity: 1, label: `${p.name} — 1 шт.`,
        detail: p.attrs.fan_assisted?.v === true ? 'с вентилятором: мощность зависит от скорости — проверить по паспорту' : `мощность при ${temps} в карточке не указана — проверить по паспорту`,
        checks: [`Мощность при ${temps} не подтверждена — проверить по паспорту производителя.`],
        sortKey: [2, inStock ? 0 : 1, 0],
      };
    }
    const units = Math.max(1, Math.ceil(requiredW / q));
    const limit = sectional ? MAX_SECTIONS_PER_ROOM : MAX_UNITS_PER_ROOM;
    const unitName = sectional ? 'секц.' : 'шт.';
    const exp = exponentOf(p);
    const detail = `≈ ${Math.round(q)} Вт/${sectional ? 'секцию' : 'шт.'} при ${temps} (EN 442 от ${num(p, 'rated_w')} Вт при Δt ${num(p, 'rated_dt')}, ${exp.basis}) → ${units} ${unitName} на ${Math.round(requiredW)} Вт${inStock ? ' · в наличии' : ''}`;
    if (units > limit) {
      return { id: p.sku, sku: p.sku, kind: 'product', label: `${p.name} — нужно ${units} ${unitName}`, detail: `${detail}: слишком мало мощности для помещения`, disabled: true, sortKey: [3, units] };
    }
    return {
      id: p.sku, sku: p.sku, kind: 'product', quantity: units, label: `${p.name} — ${units} ${unitName}`, detail,
      checks: [`Мощность при ${temps} — пересчёт по EN 442 (${exp.basis}); подтвердить по паспорту ${p.brand ?? 'производителя'}.`],
      sortKey: [0, inStock ? 0 : 1, units * q - requiredW],
    };
  });
  return opts.sort((a, b) => {
    for (let i = 0; i < Math.max(a.sortKey.length, b.sortKey.length); i += 1) {
      const d = (a.sortKey[i] ?? 0) - (b.sortKey[i] ?? 0);
      if (d) return d;
    }
    return a.id.localeCompare(b.id);
  }).map(({ sortKey: _s, ...o }) => o);
}

export function electricHeaterOptions(requiredW: number | null, inv: InventoryInput): ChoiceOption[] {
  return catalogIndex().byType('ELECTRIC_CONVECTOR').map((p): ChoiceOption => {
    const w = num(p, 'electric_w');
    if (w == null || requiredW == null || requiredW <= 0) return { id: p.sku, sku: p.sku, kind: 'product', quantity: 1, label: `${p.name} — 1 шт.`, detail: 'мощность не указана' };
    const units = Math.max(1, Math.ceil(requiredW / w));
    const inStock = inv.catalog?.get(p.sku)?.inStock === true;
    return { id: p.sku, sku: p.sku, kind: 'product', quantity: units, label: `${p.name} — ${units} шт.`, detail: `${w} Вт/шт. → ${units * w} Вт на ${Math.round(requiredW)} Вт${inStock ? ' · в наличии' : ''}` };
  }).sort((a, b) => (a.quantity ?? 0) * 1 - (b.quantity ?? 0) || a.id.localeCompare(b.id));
}

export function towelWarmerOptions(medium: 'WATER' | 'ELECTRIC', quantity: number): ChoiceOption[] {
  return catalogIndex().byType('TOWEL_WARMER')
    .filter((p) => str(p, 'medium') === medium)
    .map((p): ChoiceOption => ({
      id: p.sku, sku: p.sku, kind: 'product', quantity, label: p.name,
      detail: medium === 'ELECTRIC' && num(p, 'rated_w') != null ? `${num(p, 'rated_w')} Вт` : 'тепловая мощность в карточке не указана',
    }));
}

export function productOptions(profiles: ProductProfile[], quantity: number | null, detail?: (p: ProductProfile) => string | undefined): ChoiceOption[] {
  return profiles.map((p) => ({ id: p.sku, sku: p.sku, kind: 'product' as const, quantity, label: p.name, detail: detail?.(p) }));
}

// ---------------------------------------------------------------------------
// Boilers as the heat source (gas / condensing / electric)
// ---------------------------------------------------------------------------

/** Useful heat output, kW: stated output; else input × stated efficiency (≤ 100 %). */
export function boilerUsefulKw(p: ProductProfile): { kw: number | null; basis: string } {
  const out = num(p, 'output_kw');
  if (out != null) return { kw: out, basis: 'полезная мощность по карточке' };
  const input = num(p, 'input_kw');
  const eff = num(p, 'efficiency_pct');
  if (input != null && eff != null && eff > 0) return { kw: input * Math.min(eff, 100) / 100, basis: `входная ${input} кВт × КПД ${Math.min(eff, 100)} %` };
  if (input != null) return { kw: null, basis: `в карточке только входная мощность ${input} кВт` };
  return { kw: null, basis: 'мощность в карточке не указана' };
}

const BOILER_FUELS: Record<string, string[]> = {
  gas_boiler: ['GAS', 'GAS_CONDENSING'],
  gas_condensing_boiler: ['GAS_CONDENSING'],
  electric_boiler: ['ELECTRIC'],
};

export function boilerOptions(sourceId: string, requiredKw: number | null, inv: InventoryInput): ChoiceOption[] {
  const fuels = BOILER_FUELS[sourceId] ?? [];
  const list = catalogIndex().byType('BOILER').filter((p) => fuels.includes(str(p, 'fuel') ?? ''));
  const rows = list.map((p) => {
    const { kw, basis } = boilerUsefulKw(p);
    const inStock = inv.catalog?.get(p.sku)?.inStock === true;
    const absent = inv.catalog?.has(p.sku) === true && inv.catalog.get(p.sku) === null;
    const checks = ['Подтвердить полезную мощность и режим работы по паспорту котла; ГВС в расчёте не учтено.'];
    if (num(p, 'phases') === 3) checks.push('Электрокотёл трёхфазный: нужен ввод 400 В.');
    let disabled = absent;
    let detail = absent ? 'нет в действующем каталоге' : '';
    if (!absent && kw != null && requiredKw != null) {
      if (kw < requiredKw) { disabled = true; detail = `${kw.toFixed(1)} кВт < требуемых ${requiredKw.toFixed(1)} кВт (${basis})`; }
      else {
        detail = `${kw.toFixed(1)} кВт ≥ ${requiredKw.toFixed(1)} кВт (${basis})${kw > requiredKw * 3 ? ' — значительно мощнее требуемого: частые включения, проверить диапазон модуляции' : ''}`;
      }
    } else if (!absent && requiredKw != null && num(p, 'input_kw') != null && num(p, 'input_kw')! * 1.1 < requiredKw) {
      // useful output never exceeds the input by more than ~10 % (condensing, net calorific value): proven too small
      disabled = true;
      detail = `входная мощность ${num(p, 'input_kw')} кВт — полезная заведомо меньше требуемых ${requiredKw.toFixed(1)} кВт`;
    } else if (!absent) {
      detail = `${basis} — подтвердить по паспорту`;
      checks.unshift('Мощность котла в карточке каталога не указана — соответствие нагрузке не проверено.');
    }
    if (inStock && !disabled) detail += ' · в наличии';
    const option: ChoiceOption = { id: p.sku, sku: p.sku, kind: 'product', quantity: 1, label: p.name, detail, disabled, checks };
    return { option, key: [disabled ? 2 : kw == null ? 1 : 0, inStock ? 0 : 1, kw ?? 1e9] };
  });
  return rows.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.option.id.localeCompare(b.option.id)).map((r) => r.option);
}
