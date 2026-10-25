export type PublicAvailabilityStatus = 'available_to_order' | 'price_on_request' | 'preorder' | 'request_price_and_eta' | 'unavailable';

export function getPublicAvailabilityStatus(totalAvailableQuantity: number, priceAmd: number): PublicAvailabilityStatus {
  const hasQty = totalAvailableQuantity > 0;
  const hasPrice = priceAmd > 0;

  if (hasQty && hasPrice) return 'available_to_order';
  if (hasQty && !hasPrice) return 'price_on_request';
  if (!hasQty && hasPrice) return 'preorder';
  if (!hasQty && !hasPrice) return 'request_price_and_eta';
  return 'unavailable';
}

export function getPublicAvailabilityLabel(status: PublicAvailabilityStatus) {
  switch (status) {
    case 'available_to_order':
      return 'В наличии';
    case 'price_on_request':
      return 'По запросу';
    case 'preorder':
      return 'Под заказ';
    case 'request_price_and_eta':
      return 'По запросу';
    case 'unavailable':
      return 'Нет в наличии';
    default:
      return 'Уточнить наличие';
  }
}

export function getPublicSalesCopy(status: PublicAvailabilityStatus) {
  switch (status) {
    case 'available_to_order':
      return {
        can_add_to_cart: true,
        primary_cta_label: 'В корзину',
        secondary_cta_label: 'Купить в 1 клик',
        contact_cta_label: 'Уточнить наличие',
        purchase_note: 'Товар можно оформить онлайн. Наличие и детали заказа подтверждает менеджер после обработки.'
      };
    case 'price_on_request':
      return {
        can_add_to_cart: false,
        primary_cta_label: 'Запросить цену',
        secondary_cta_label: 'Уточнить условия продажи',
        contact_cta_label: 'Запросить цену',
        purchase_note: 'Товар есть в наличии, но цена не опубликована. Отправьте запрос — менеджер подтвердит цену и условия продажи.'
      };
    case 'preorder':
      return {
        can_add_to_cart: false,
        primary_cta_label: 'Запросить срок поставки',
        secondary_cta_label: 'Запросить поставку',
        contact_cta_label: 'Уточнить срок поставки',
        purchase_note: 'Цена известна, но складской остаток не подтверждён. Отправьте запрос — менеджер уточнит срок поставки и подтвердит заказ.'
      };
    case 'request_price_and_eta':
      return {
        can_add_to_cart: false,
        primary_cta_label: 'Запросить цену и срок',
        secondary_cta_label: 'Отправить запрос',
        contact_cta_label: 'Запросить цену и срок',
        purchase_note: 'Для этого товара нужно отдельно подтвердить цену и срок поставки. После согласования менеджер оформит продажу.'
      };
    default:
      return {
        can_add_to_cart: false,
        primary_cta_label: 'Связаться',
        secondary_cta_label: 'Отправить запрос',
        contact_cta_label: 'Связаться',
        purchase_note: 'Статус продажи уточняется у менеджера.'
      };
  }
}

export function sanitizePublicProduct<T extends Record<string, any>>(product: T) {
  const totalAvailableQuantity = Number(product.available_quantity || 0);
  const showPrice = Number(product.show_price ?? 1) === 1;
  const priceAmd = showPrice ? Number(product.price_amd || 0) : 0;
  const availability_status = (product.availability_status || '').trim() || getPublicAvailabilityStatus(totalAvailableQuantity, priceAmd);
  const { available_quantity, stock_quantity, stock, quantity, reserved_quantity, ...safeProduct } = product;
  return {
    ...safeProduct,
    show_price: showPrice ? 1 : 0,
    price_amd: priceAmd,
    availability_status,
    availability_label: getPublicAvailabilityLabel(availability_status),
    ...getPublicSalesCopy(availability_status),
  };
}
