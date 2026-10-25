/** Pure cart helpers (no browser storage access at import time). */
// Pipes added before `unit` existed (so old carts show a sensible badge).
const LEGACY_METRE_SKUS = new Set(['28107000']);

/** Badge number: pieces count as pieces, a measured-length position counts as ONE position (350 m ≠ 350 items). */
export function cartBadgeCount(cart: Array<{ quantity: number; unit?: string; sku: string }>): number {
  return cart.reduce((sum, item) => sum + (item.unit === 'м' || (!item.unit && LEGACY_METRE_SKUS.has(item.sku)) ? 1 : item.quantity), 0);
}

