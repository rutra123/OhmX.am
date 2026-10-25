/**
 * Availability for the selection layer.
 *
 * Two sources, never mixed up:
 *   - public status (live public API): in stock yes/no, no quantity;
 *   - quantity records: available-to-sell quantity with a timestamp and a source label.
 *     Today only test fixtures provide them (the authenticated inventory endpoint is pending
 *     server source restoration); a record with live=false is never presented as warehouse stock.
 */
import type { CatalogProduct } from '../equipmentEngine';
import type { FunctionalType, StockCheck } from './types';

export interface QuantityRecord {
  /** Available-to-sell = physical − reserved. */
  available: number;
  physical?: number | null;
  reserved?: number | null;
  asOf: string;
  sourceLabel: string;
  /** true only for a live authenticated inventory source. */
  live: boolean;
}

export interface InventoryInput {
  catalog?: Map<string, CatalogProduct | null>;
  quantities?: Map<string, QuantityRecord>;
}

/** The live catalog answered and the SKU is not an active product: never selectable. */
export function catalogAbsent(sku: string, inv: InventoryInput): boolean {
  return inv.catalog?.has(sku) === true && inv.catalog.get(sku) === null;
}

export const ABSENT_REASON = 'нет в действующем каталоге (товар неактивен или удалён)';

export function inStockFlag(sku: string, inv: InventoryInput): boolean | null {
  const q = inv.quantities?.get(sku);
  if (q) return q.available > 0;
  const p = inv.catalog?.get(sku);
  return p ? p.inStock ?? null : null;
}

export function stockCheck(sku: string, required: number | null, inv: InventoryInput): StockCheck {
  const q = inv.quantities?.get(sku);
  if (q) {
    const status = required == null
      ? (q.available > 0 ? 'IN_STOCK_QTY_UNVERIFIED' : 'NOT_IN_STOCK')
      : q.available >= required ? 'SUFFICIENT' : q.available > 0 ? 'INSUFFICIENT' : 'NOT_IN_STOCK';
    return { status, required, available: q.available, source: 'quantity', asOf: q.asOf, sourceLabel: q.sourceLabel };
  }
  const flag = inStockFlag(sku, inv);
  return {
    status: flag === true ? 'IN_STOCK_QTY_UNVERIFIED' : flag === false ? 'NOT_IN_STOCK' : 'UNKNOWN',
    required, available: null, source: flag == null ? 'none' : 'public-status', asOf: null,
  };
}

/** Sort weight: enough confirmed > in stock (qty unknown) > partly > unknown > not in stock. */
export function stockWeight(s: StockCheck): number {
  switch (s.status) {
    case 'SUFFICIENT': return 0;
    case 'IN_STOCK_QTY_UNVERIFIED': return 1;
    case 'INSUFFICIENT': return 2;
    case 'UNKNOWN': return 3;
    default: return 4;
  }
}

export function stockText(s: StockCheck): string {
  const src = s.source === 'quantity' && s.sourceLabel ? ` (${s.sourceLabel}${s.asOf ? `, ${s.asOf}` : ''})` : '';
  switch (s.status) {
    case 'SUFFICIENT': return `на складе достаточно: ${s.available} шт. при потребности ${s.required}${src}`;
    case 'INSUFFICIENT': return `на складе ${s.available} шт., нужно ${s.required} — не хватает ${(s.required ?? 0) - (s.available ?? 0)}${src}`;
    case 'IN_STOCK_QTY_UNVERIFIED': return 'в наличии; количество на складе не подтверждено';
    case 'NOT_IN_STOCK': return 'нет на складе (под заказ)';
    default: return 'наличие неизвестно';
  }
}

// ---------------------------------------------------------------------------
// Selection policy: commercial preferences are tie-breakers only, never eligibility rules.
// ---------------------------------------------------------------------------

export interface SelectionPolicy {
  /** Manufacturer preference per functional type — applied after engineering, stock and cost. */
  brandPreference: Partial<Record<FunctionalType, string[]>>;
}

export const DEFAULT_SELECTION_POLICY: SelectionPolicy = {
  // Owner decision 2026-10-15: Riello → DAB → others only as the last tie-breaker for pumps.
  brandPreference: { CIRCULATION_PUMP: ['Riello', 'DAB'] },
};

export function brandRank(policy: SelectionPolicy, type: FunctionalType, brand: string | null): number {
  const list = policy.brandPreference[type] ?? [];
  const i = brand ? list.findIndex((b) => brand.toLowerCase().startsWith(b.toLowerCase())) : -1;
  return i < 0 ? list.length : i;
}
