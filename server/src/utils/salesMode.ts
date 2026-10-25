export type SalesMode = 'buy_now' | 'price_request' | 'preorder' | 'price_eta_request';

export function appendSalesModeWhere(where: string[], params: any[], saleModeRaw: unknown) {
  const saleMode = String(saleModeRaw || '').trim() as SalesMode | '';
  const qtyExpr = 'COALESCE((SELECT SUM(s.available_quantity) FROM stock s WHERE s.product_id = p.id), 0)';
  const priceExpr = 'COALESCE(p.price_amd, 0)';

  switch (saleMode) {
    case 'buy_now':
      where.push(`${qtyExpr} > 0 AND ${priceExpr} > 0`);
      break;
    case 'price_request':
      where.push(`${qtyExpr} > 0 AND ${priceExpr} <= 0`);
      break;
    case 'preorder':
      where.push(`${qtyExpr} <= 0 AND ${priceExpr} > 0`);
      break;
    case 'price_eta_request':
      where.push(`${qtyExpr} <= 0 AND ${priceExpr} <= 0`);
      break;
    default:
      break;
  }

  return saleMode;
}
