/**
 * Commercial estimate from confirmed/consolidated specification.
 * lineTotal = purchaseQuantity × unitPrice
 * Missing prices never become 0.
 */
import type { ConsolidatedBomLine, ProjectEstimate } from './warmFloorProjectTypes.js';

export function buildEstimate(bom: ConsolidatedBomLine[], currency = 'AMD'): ProjectEstimate {
  let missingPriceCount = 0;
  let subtotal = 0;
  let anyPriced = false;
  let pricedLineCount = 0;

  const lines = bom.map((item) => {
    const purchaseQuantity = Number(item.purchaseQuantity ?? item.quantity ?? 0);
    const priceMissing = item.unitPrice == null || item.priceStatus !== 'ok' || Boolean(item.isManualLineItem);
    const priceStatus = item.priceStatus || (priceMissing ? 'missing' : 'ok');
    if (priceMissing) missingPriceCount += 1;
    const lineTotal = priceMissing || item.unitPrice == null
      ? null
      : Math.round(Number(item.unitPrice) * purchaseQuantity * 100) / 100;
    if (lineTotal != null) {
      subtotal += lineTotal;
      anyPriced = true;
      pricedLineCount += 1;
    }
    return {
      productId: item.productId,
      sku: item.sku,
      article: item.article,
      name: item.name,
      role: item.role,
      quantity: purchaseQuantity,
      requiredQuantity: Number(item.requiredQuantity ?? purchaseQuantity),
      purchaseQuantity,
      surplus: Number(item.surplus ?? 0),
      packageSize: item.packageSize ?? null,
      packageCount: item.packageCount ?? null,
      packingSource: item.packingSource,
      packingNote: item.packingNote ?? null,
      unit: item.unit,
      unitPrice: item.unitPrice,
      lineTotal,
      priceMissing: Boolean(priceMissing),
      priceStatus,
      roomDistribution: Array.isArray(item.roomDistribution) ? item.roomDistribution : [],
    };
  });

  return {
    currency,
    lines,
    equipmentSubtotal: anyPriced ? Math.round(subtotal * 100) / 100 : null,
    projectTotal: anyPriced ? Math.round(subtotal * 100) / 100 : null,
    missingPriceCount,
    incompleteCommercial: missingPriceCount > 0 || bom.length === 0,
    pricedLineCount,
    totalLineCount: bom.length,
  };
}
