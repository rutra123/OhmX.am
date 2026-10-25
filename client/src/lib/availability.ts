export function availabilityTone(status?: string) {
  if (status === 'available_to_order') return 'text-ok';
  if (status === 'preorder') return 'text-sky-300';
  if (status === 'price_on_request' || status === 'request_price_and_eta') return 'text-warn';
  if (status === 'unavailable') return 'text-red-300';
  return 'text-warn';
}

export function buildInquiryPath(product: { sku?: string; name_ru?: string; brand_name?: string; availability_status?: string }) {
  const params = new URLSearchParams();
  if (product.sku) params.set('sku', product.sku);
  if (product.name_ru) params.set('product', product.name_ru);
  if (product.brand_name) params.set('brand', product.brand_name);
  if (product.availability_status === 'price_on_request') params.set('intent', 'price');
  else if (product.availability_status === 'preorder') params.set('intent', 'eta');
  else params.set('intent', 'price_eta');
  return `/contacts?${params.toString()}`;
}
