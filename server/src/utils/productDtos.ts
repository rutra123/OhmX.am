import { getPublicAvailabilityLabel, getPublicAvailabilityStatus, getPublicSalesCopy, type PublicAvailabilityStatus } from './publicAvailability.js';

type ProductRow = Record<string, any>;

function text(value: unknown) {
  return String(value || '');
}

function optionalText(value: unknown) {
  const clean = text(value).trim();
  return clean || '';
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicDocumentUrl(value: unknown) {
  const url = optionalText(value);
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/storage/') || url.startsWith('/uploads/') || url.startsWith('/assets/')) return url;
  if (url.startsWith('storage/') || url.startsWith('uploads/') || url.startsWith('assets/')) return `/${url}`;
  return '';
}

function publicAvailability(row: ProductRow) {
  const showPrice = Number(row.show_price ?? 1) === 1;
  const priceAmd = showPrice ? numberValue(row.price_amd, 0) : 0;
  const derived = getPublicAvailabilityStatus(numberValue(row.available_quantity, 0), priceAmd);
  const rawStatus = optionalText(row.availability_status);
  const status = (rawStatus || derived) as PublicAvailabilityStatus;
  const salesCopy = getPublicSalesCopy(status);
  return { showPrice, priceAmd, status, salesCopy };
}

export function toPublicProductFeatureDto(row: ProductRow) {
  return {
    id: numberValue(row.id),
    feature_name: text(row.feature_name),
    feature_value: text(row.feature_value),
    feature_unit: optionalText(row.feature_unit),
    sort_order: sortValue(row.sort_order),
  };
}

export function toPublicProductImageDto(row: ProductRow) {
  return {
    id: numberValue(row.id),
    image_url: text(row.image_url),
    alt_text: optionalText(row.alt_text),
    is_cover: Number(row.is_cover || 0) ? 1 : 0,
    sort_order: sortValue(row.sort_order),
  };
}

export function toPublicProductDocumentDto(row: ProductRow) {
  return {
    id: numberValue(row.id),
    document_name: text(row.document_name),
    document_type: text(row.document_type),
    file_url: publicDocumentUrl(row.file_url),
    file_extension: optionalText(row.file_extension),
    file_size: numberValue(row.file_size, 0),
    language: optionalText(row.language) || 'ru',
    version: optionalText(row.version),
    sort_order: sortValue(row.sort_order),
  };
}

export function toPublicProductCardDto(row: ProductRow) {
  const availability = publicAvailability(row);
  const coverImage = text(row.cover_image || row.image_url || '');
  return {
    id: numberValue(row.id),
    slug: text(row.slug),
    sku: text(row.sku),
    name_ru: text(row.name_ru),
    name_hy: optionalText(row.name_hy),
    name_en: optionalText(row.name_en),
    brand_id: nullableNumber(row.brand_id),
    brand_name: optionalText(row.brand_name),
    brand_slug: optionalText(row.brand_slug),
    series_id: nullableNumber(row.series_id),
    series_name: optionalText(row.series_name),
    series_slug: optionalText(row.series_slug),
    category_id: nullableNumber(row.category_id),
    primary_category_id: nullableNumber(row.primary_category_id),
    category_name: optionalText(row.category_name),
    category_slug: optionalText(row.category_slug),
    category_ids_csv: optionalText(row.category_ids_csv),
    short_description_ru: optionalText(row.short_description_ru),
    price_amd: availability.priceAmd,
    currency: optionalText(row.currency) || 'AMD',
    unit: optionalText(row.unit) || 'шт',
    show_price: availability.showPrice ? 1 : 0,
    availability_status: availability.status,
    availability_label: getPublicAvailabilityLabel(availability.status),
    can_add_to_cart: availability.salesCopy.can_add_to_cart,
    primary_cta_label: availability.salesCopy.primary_cta_label,
    secondary_cta_label: availability.salesCopy.secondary_cta_label,
    contact_cta_label: availability.salesCopy.contact_cta_label,
    purchase_note: availability.salesCopy.purchase_note,
    cover_image: coverImage,
    images: coverImage ? [{ image_url: coverImage, alt_text: text(row.name_ru) }] : [],
    documents_count: numberValue(row.documents_count, 0),
  };
}

export function toPublicProductSearchDto(row: ProductRow) {
  const dto = toPublicProductCardDto(row);
  return {
    id: dto.id,
    slug: dto.slug,
    sku: dto.sku,
    name_ru: dto.name_ru,
    name_hy: dto.name_hy,
    name_en: dto.name_en,
    brand_id: dto.brand_id,
    brand_name: dto.brand_name,
    brand_slug: dto.brand_slug,
    series_id: dto.series_id,
    series_name: dto.series_name,
    series_slug: dto.series_slug,
    category_id: dto.category_id,
    primary_category_id: dto.primary_category_id,
    category_name: dto.category_name,
    category_slug: dto.category_slug,
    category_ids_csv: dto.category_ids_csv,
    short_description_ru: dto.short_description_ru,
    price_amd: dto.price_amd,
    currency: dto.currency,
    unit: dto.unit,
    show_price: dto.show_price,
    availability_status: dto.availability_status,
    availability_label: dto.availability_label,
    can_add_to_cart: dto.can_add_to_cart,
    primary_cta_label: dto.primary_cta_label,
    secondary_cta_label: dto.secondary_cta_label,
    contact_cta_label: dto.contact_cta_label,
    purchase_note: dto.purchase_note,
    cover_image: dto.cover_image,
    images: dto.images,
    documents_count: dto.documents_count,
    search_score: numberValue(row.search_score ?? row.score, 0),
  };
}

export function toPublicCategoryDto(row: ProductRow) {
  const dto: ProductRow = {
    id: numberValue(row.id),
    parent_id: row.parent_id == null ? null : numberValue(row.parent_id),
    name_ru: text(row.name_ru),
    name_hy: optionalText(row.name_hy),
    name_en: optionalText(row.name_en),
    slug: text(row.slug),
    description_ru: optionalText(row.description_ru),
    short_description_ru: optionalText(row.short_description_ru),
    icon: optionalText(row.icon),
    image_url: optionalText(row.image_url),
    menu_type: optionalText(row.menu_type) || 'category',
    sort_order: sortValue(row.sort_order),
  };
  if ('level' in row) dto.level = numberValue(row.level, 0);
  if ('productsCount' in row) dto.productsCount = numberValue(row.productsCount, 0);
  if ('childrenCount' in row) dto.childrenCount = numberValue(row.childrenCount, 0);
  if ('has_children' in row) dto.has_children = Boolean(row.has_children);
  delete dto.created_at;
  delete dto.updated_at;
  delete dto.is_active;
  delete dto.old_aliases;
  return dto;
}

export function toPublicBrandDto(row: ProductRow) {
  return {
    id: numberValue(row.id),
    name: text(row.name),
    country: optionalText(row.country),
    logo_url: optionalText(row.logo_url),
    description_ru: optionalText(row.description_ru),
    website_url: optionalText(row.website_url),
    slug: text(row.slug),
    sort_order: sortValue(row.sort_order),
    is_popular: Number(row.is_popular || 0) ? 1 : 0,
  };
}

export function toPublicWarehouseDto(row: ProductRow) {
  return {
    id: numberValue(row.id),
    name: text(row.name),
    slug: text(row.slug),
    address: optionalText(row.address),
    sort_order: sortValue(row.sort_order),
  };
}

const PUBLIC_PRODUCT_DETAIL_BLOCKED_FIELDS = [
  'created_at',
  'updated_at',
  'old_id',
  'price_tax_included',
  'is_active',
  'is_featured',
  'supplier_reference',
  'legacy_categories',
  'stock_quantity',
  'reserved_quantity',
  'available_quantity',
] as const;

export function toPublicProductDetailDto(row: ProductRow) {
  const dto: ProductRow = toPublicProductCardDto(row);
  for (const field of PUBLIC_PRODUCT_DETAIL_BLOCKED_FIELDS) delete dto[field];
  dto.description_ru = optionalText(row.description_ru);
  dto.seo_title_ru = optionalText(row.seo_title_ru);
  dto.seo_description_ru = optionalText(row.seo_description_ru);
  dto.cooling_power_kw = nullableNumber(row.cooling_power_kw);
  dto.heating_power_kw = nullableNumber(row.heating_power_kw);
  dto.recommended_area_m2 = nullableNumber(row.recommended_area_m2);
  dto.equipment_type = optionalText(row.equipment_type);
  dto.energy_source = optionalText(row.energy_source);
  dto.system_type = optionalText(row.system_type);
  dto.warm_floor_product_type = optionalText(row.warm_floor_product_type);
  dto.warm_floor_linear_power_wm = nullableNumber(row.warm_floor_linear_power_wm);
  dto.warm_floor_cable_length_m = nullableNumber(row.warm_floor_cable_length_m);
  dto.warm_floor_mat_area_m2 = nullableNumber(row.warm_floor_mat_area_m2);
  dto.warm_floor_voltage_v = nullableNumber(row.warm_floor_voltage_v);
  dto.warm_floor_room_types = optionalText(row.warm_floor_room_types);
  dto.warm_floor_floor_coverings = optionalText(row.warm_floor_floor_coverings);
  dto.warm_floor_substrate_types = optionalText(row.warm_floor_substrate_types);
  dto.warm_floor_wet_zone_allowed = row.warm_floor_wet_zone_allowed == null ? null : Number(row.warm_floor_wet_zone_allowed) === 1;
  dto.features = Array.isArray(row.features) ? row.features.map(toPublicProductFeatureDto) : [];
  dto.images = Array.isArray(row.images) ? row.images.map(toPublicProductImageDto) : dto.images;
  dto.documents = Array.isArray(row.documents) ? row.documents.map(toPublicProductDocumentDto).filter((item) => item.file_url) : [];
  dto.breadcrumbs = Array.isArray(row.breadcrumbs) ? row.breadcrumbs : [];
  dto.category_paths = Array.isArray(row.category_paths) ? row.category_paths : [];
  return dto;
}

export function toPublicCalculatorProductDto(row: ProductRow) {
  const availability = publicAvailability(row);
  return {
    id: numberValue(row.id),
    slug: text(row.slug),
    sku: text(row.sku),
    article: text(row.article || row.sku),
    name: text(row.name || row.name_ru),
    brand: optionalText(row.brand || row.brand_name),
    category: optionalText(row.category || row.category_name),
    price: availability.priceAmd > 0 ? availability.priceAmd : null,
    currency: optionalText(row.currency) || 'AMD',
    image: text(row.image || row.cover_image || ''),
    availabilityStatus: availability.status,
    availabilityLabel: getPublicAvailabilityLabel(availability.status),
    powerKw: row.powerKw == null ? null : nullableNumber(row.powerKw),
    recommendedAreaM2: row.recommendedAreaM2 == null ? null : nullableNumber(row.recommendedAreaM2),
    equipmentType: optionalText(row.equipmentType || row.equipment_type),
    energySource: optionalText(row.energySource || row.energy_source),
    systemType: optionalText(row.systemType || row.system_type),
  };
}
