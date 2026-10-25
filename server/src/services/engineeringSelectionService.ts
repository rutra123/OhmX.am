import { db } from '../db.js';
import { matchFloorHeatingProducts, type FloorBuildType, type FloorFinish, type FloorHeatingPurpose, type PreferredHeatingElement } from './floorHeatingProductMatcher.js';

export type EngineeringMode = 'heating' | 'cooling' | 'floor_heating' | 'unknown';
export type EnergySource = 'gas' | 'electric' | 'universal' | 'unknown';
export type BudgetLevel = 'economy' | 'optimal' | 'premium' | 'unknown';
export type AvailabilityStatus = 'in_stock' | 'low_stock' | 'preorder' | 'unavailable';
export type SystemType =
  | 'gas_boiler'
  | 'electric_boiler'
  | 'heat_pump'
  | 'electric_convector'
  | 'floor_heating'
  | 'infrared_heating'
  | 'air_conditioner'
  | 'fan_coil'
  | 'hvac_accessory'
  | 'floor_heating_mat'
  | 'floor_heating_cable'
  | 'thermostat'
  | 'floor_sensor'
  | 'rcd'
  | 'circuit_breaker'
  | 'mounting_accessory';

export type EngineeringRequirements = {
  mode: EngineeringMode;
  area: number | null;
  ceilingHeight: number | null;
  roomType?: 'apartment' | 'house' | 'office' | 'commercial' | 'bathroom' | 'kitchen' | 'unknown' | string;
  hasGas?: boolean | null;
  energySource?: EnergySource;
  preferredSystemTypes?: string[];
  insulation?: 'good' | 'normal' | 'poor' | 'unknown';
  windows?: 'normal' | 'large' | 'sunny' | 'unknown';
  budgetLevel?: BudgetLevel;
  includeAccessories?: boolean;
  roomAreaM2?: number | null;
  ceilingHeightM?: number | null;
  floorHeatingPurpose?: FloorHeatingPurpose | null;
  floorFinish?: FloorFinish | null;
  floorBuildType?: FloorBuildType | null;
  preferredHeatingElement?: PreferredHeatingElement | null;
  blockedZones?: string[];
  blockedAreaM2?: number | null;
  availableInstallAreaM2?: number | null;
  requiredHeatingPowerW?: number | null;
  selectedSystemPowerW?: number | null;
  powerCoveragePercent?: number | null;
  cableLengthM?: number | null;
  cableSpacingCm?: number | null;
  mountingTapeRequiredM?: number | null;
  mountingTapeRequiredWithReserveM?: number | null;
  matAreaM2?: number | null;
  matPowerPerM2?: number | null;
  stockPolicy?: 'hide_exact_stock' | 'show_availability_only';
};

export type EngineeringProduct = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article: string;
  powerKw: number | null;
  recommendedAreaM2: number | null;
  price: number | null;
  currency: string;
  image: string;
  availabilityStatus: Exclude<AvailabilityStatus, 'unavailable'>;
  availabilityLabel: string;
  preorderNote: string;
  equipmentType: string;
  energySource: string;
  systemType: string;
  aiSelectionNotes: string;
  brandQualityTier: string;
};

export type EngineeringBundle = {
  bundleType: 'economy' | 'optimal' | 'premium';
  title: string;
  description: string;
  mainProduct: EngineeringProduct | null;
  accessories: EngineeringProduct[];
  estimatedTotal: number | null;
  availabilityStatus: 'in_stock' | 'mixed' | 'preorder';
  notes: string[];
};

const coolingRanges = [
  { max: 2.1, label: 'до 2.1 кВт', minKw: 0, maxKw: 2.1 },
  { max: 2.6, label: '2.1–2.6 кВт', minKw: 2.1, maxKw: 2.6 },
  { max: 3.5, label: '2.6–3.5 кВт', minKw: 2.6, maxKw: 3.5 },
  { max: 5.0, label: '3.5–5.0 кВт', minKw: 3.5, maxKw: 5.0 },
  { max: 7.0, label: '5.0–7.0 кВт', minKw: 5.0, maxKw: 7.0 },
  { max: Infinity, label: 'выше 7.0 кВт', minKw: 7.0, maxKw: null },
];
const heatingRanges = [
  { max: 1.5, label: 'до 1.5 кВт', minKw: 0, maxKw: 1.5 },
  { max: 2.0, label: '1.5–2.0 кВт', minKw: 1.5, maxKw: 2.0 },
  { max: 3.0, label: '2.0–3.0 кВт', minKw: 2.0, maxKw: 3.0 },
  { max: 5.0, label: '3.0–5.0 кВт', minKw: 3.0, maxKw: 5.0 },
  { max: 7.0, label: '5.0–7.0 кВт', minKw: 5.0, maxKw: 7.0 },
  { max: Infinity, label: 'выше 7.0 кВт', minKw: 7.0, maxKw: null },
];

function cleanText(value: unknown) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function availabilityRank(status: AvailabilityStatus) {
  if (status === 'in_stock') return 0;
  if (status === 'low_stock') return 1;
  if (status === 'preorder') return 2;
  return 99;
}

function normalizeAvailability(rawStatus: unknown, availableQuantity: number): AvailabilityStatus {
  const raw = cleanText(rawStatus).replace(/[-\s]+/g, '_');
  if (['in_stock', 'low_stock', 'preorder', 'unavailable'].includes(raw)) return raw as AvailabilityStatus;
  if (raw.includes('заказ') || raw.includes('preorder')) return 'preorder';
  if (raw.includes('нет') || raw.includes('unavailable')) return 'unavailable';
  if (availableQuantity > 2) return 'in_stock';
  if (availableQuantity > 0) return 'low_stock';
  return 'preorder';
}

/** Exported read-only for the full catalog export audit. */
export function parsePowerKw(row: Record<string, unknown>, mode: EngineeringMode): number | null {
  const explicit = Number(mode === 'cooling' ? row.cooling_power_kw : row.heating_power_kw);
  if (Number.isFinite(explicit) && explicit > 0) return round2(explicit);
  const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text, row.series_name].join(' '));
  const modeSpecific = mode === 'cooling'
    ? text.match(/(?:охл\.?|охлажд\w*)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*квт/)
    : text.match(/(?:нагр\.?|отопл\w*)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*квт/);
  if (modeSpecific) return round2(Number(modeSpecific[1].replace(',', '.')));
  const kw = text.match(/(\d+(?:[.,]\d+)?)\s*квт/);
  if (kw) return round2(Number(kw[1].replace(',', '.')));
  const watt = text.match(/(\d{3,5})\s*w\b|(?<!\d)(\d{3,5})\s*вт/);
  const watts = Number(watt?.[1] || watt?.[2] || 0);
  if (watts > 0 && watts <= 30000) return round2(watts / 1000);
  return null;
}

function productRows() {
  return db.prepare(`
    SELECT
      p.id, p.sku, p.name_ru, p.slug, p.short_description_ru, p.description_ru,
      p.price_amd, p.currency, p.show_price, p.availability_status,
      p.cooling_power_kw, p.heating_power_kw, p.recommended_area_m2,
      p.equipment_type, p.suitable_for_cooling, p.suitable_for_heating,
      p.is_calculator_accessory, p.accessory_group, p.accessory_default_enabled,
      p.energy_source, p.system_type, p.calculator_priority,
      b.name as brand_name, c.name_ru as category_name, s.name as series_name,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order, i.id LIMIT 1) AS cover_image,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity,
      COALESCE((SELECT GROUP_CONCAT(feature_name || ' ' || feature_value || ' ' || COALESCE(feature_unit, ''), ' ') FROM product_features pf WHERE pf.product_id = p.id), '') AS feature_text
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE p.is_active = 1 AND COALESCE(p.ai_selectable, 1) = 1
  `).all() as Record<string, unknown>[];
}

function productDto(row: Record<string, unknown>, mode: EngineeringMode, kind: 'main' | 'accessory'): EngineeringProduct | null {
  const availabilityStatus = normalizeAvailability(row.availability_status, Number(row.available_quantity || 0));
  if (availabilityStatus === 'unavailable') return null;
  return {
    id: Number(row.id),
    slug: String(row.slug || ''),
    sku: String(row.sku || ''),
    name: String(row.name_ru || ''),
    brand: String(row.brand_name || ''),
    article: String(row.supplier_reference || row.sku || ''),
    powerKw: kind === 'main' ? parsePowerKw(row, mode) : null,
    recommendedAreaM2: Number.isFinite(Number(row.recommended_area_m2)) ? Number(row.recommended_area_m2) : null,
    price: Number(row.show_price ?? 1) === 1 && Number(row.price_amd || 0) > 0 ? Number(row.price_amd) : null,
    currency: String(row.currency || 'AMD'),
    image: String(row.cover_image || ''),
    availabilityStatus,
    availabilityLabel: availabilityStatus === 'in_stock' ? 'В наличии' : availabilityStatus === 'low_stock' ? 'Мало' : 'Под заказ',
    preorderNote: availabilityStatus === 'preorder' ? 'Поставка под заказ, срок уточняется' : '',
    equipmentType: String(row.equipment_type || ''),
    energySource: String(row.energy_source || ''),
    systemType: String(row.system_type || ''),
    aiSelectionNotes: String(row.ai_selection_notes || ''),
    brandQualityTier: String(row.brand_quality_tier || ''),
  };
}

export function calculateRequiredPower(requirements: EngineeringRequirements) {
  const mode = requirements.mode === 'cooling' ? 'cooling' : 'heating';
  const area = Number(requirements.area);
  const ceilingHeight = Number(requirements.ceilingHeight || 2.7);
  const volumeM3 = round2(area * ceilingHeight);
  const baseRate = mode === 'cooling' ? 0.04 : 0.045;
  const optionCoefficient = round2(
    (requirements.insulation === 'poor' ? 0.2 : 0)
    + (requirements.windows === 'large' || requirements.windows === 'sunny' ? 0.15 : 0),
  );
  const coefficient = round2(1 + optionCoefficient);
  const requiredPowerKw = round2(volumeM3 * baseRate * coefficient);
  const ranges = mode === 'cooling' ? coolingRanges : heatingRanges;
  const range = ranges.find((item) => requiredPowerKw <= item.max) || ranges[ranges.length - 1];
  return { requiredPowerKw, recommendedRange: range.label, calculationDetails: { mode, area, ceilingHeight, volumeM3, baseRate, coefficient, range } };
}

function inferSystemTypes(requirements: EngineeringRequirements): SystemType[] {
  const preferred = (requirements.preferredSystemTypes || []).filter(Boolean) as SystemType[];
  if (preferred.length) return preferred;
  if (requirements.mode === 'cooling') return ['air_conditioner', 'heat_pump', 'fan_coil'];
  if (requirements.mode === 'floor_heating') return ['floor_heating_mat', 'floor_heating_cable'];
  if (requirements.hasGas === true || requirements.energySource === 'gas') return ['gas_boiler'];
  if (requirements.hasGas === false || requirements.energySource === 'electric') return ['heat_pump', 'electric_convector', 'electric_boiler', 'floor_heating', 'infrared_heating'];
  return ['heat_pump', 'electric_convector', 'gas_boiler', 'electric_boiler'];
}

function systemMainScore(row: Record<string, unknown>, systemType: SystemType, mode: EngineeringMode) {
  const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type, row.system_type, row.energy_source, row.compatible_system_types].join(' '));
  if (String(row.system_type || '') === systemType || text.includes(systemType.replace(/_/g, ' '))) return 0;
  if (systemType === 'air_conditioner' && ['кондиционер', 'сплит', 'охлажд'].some((n) => text.includes(n))) return 1;
  if (systemType === 'fan_coil' && ['фанкойл', 'fan coil'].some((n) => text.includes(n))) return 1;
  if (systemType === 'gas_boiler') {
    if (['электр', 'конвектор', 'нагревательный кабель', 'теплый пол'].some((n) => text.includes(n))) return -1;
    if ((text.includes('газ') || ['beretta', 'riello', 'baltur'].some((n) => text.includes(n))) && (text.includes('котел') || text.includes('котёл'))) return 1;
  }
  if (systemType === 'electric_boiler') {
    if (text.includes('газ') || text.includes('конвектор')) return -1;
    if (text.includes('электр') && (text.includes('котел') || text.includes('котёл'))) return 1;
  }
  if (systemType === 'heat_pump' && ['тепловой насос', 'heat pump'].some((n) => text.includes(n))) return 1;
  if (systemType === 'electric_convector' && text.includes('конвектор') && !text.includes('водян')) return 1;
  if ((systemType === 'floor_heating' || systemType === 'floor_heating_mat') && ['нагревательный мат', 'теплый пол', 'тёплый пол', 'devimat'].some((n) => text.includes(n))) return 1;
  if (systemType === 'floor_heating_cable' && ['нагревательный кабель', 'deviflex'].some((n) => text.includes(n))) return 1;
  if (systemType === 'infrared_heating' && ['инфракрас', 'ик-', 'ir heater'].some((n) => text.includes(n))) return 1;
  if (mode === 'cooling' && Number(row.suitable_for_cooling || 0) === 1) return 8;
  if (mode === 'heating' && Number(row.suitable_for_heating || 0) === 1) return 8;
  return -1;
}

function accessoryScore(row: Record<string, unknown>, systemTypes: SystemType[]) {
  const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type, row.accessory_group, row.system_type, row.compatible_system_types].join(' '));
  if (Number(row.accessory_default_enabled ?? 1) === 0) return -1;
  if (['маркер', 'cab 3', 'бирка', 'маркиров', 'цифра', 'заглавная буква'].some((needle) => text.includes(needle))) return -1;
  if (Number(row.is_calculator_accessory || 0) === 1) return 0;
  const keywords: Record<string, string[]> = {
    gas_boiler: ['дымоход', 'коаксиал', 'фильтр', 'кран', 'группа безопасности', 'расширительный бак', 'насос', 'термостат', 'стабилизатор', 'ups'],
    electric_boiler: ['автомат', 'дифавтомат', 'узо', 'кабель', 'термостат', 'насос', 'расширительный бак', 'группа безопасности'],
    heat_pump: ['кронштейн', 'дренаж', 'кабель', 'автомат', 'термостат', 'монтажн'],
    electric_convector: ['термостат', 'кабель', 'вилка', 'розетк', 'автомат', 'креплен'],
    floor_heating: ['терморегулятор', 'термостат', 'датчик', 'гофра', 'монтажная лента', 'автомат', 'узо', 'дифавтомат'],
    floor_heating_mat: ['терморегулятор', 'термостат', 'датчик', 'гофра', 'автомат', 'узо'],
    floor_heating_cable: ['терморегулятор', 'термостат', 'датчик', 'монтажная лента', 'гофра', 'автомат', 'узо'],
    air_conditioner: ['кронштейн', 'медн', 'дренаж', 'кабель', 'автомат', 'монтажн'],
    fan_coil: ['клапан', 'термостат', 'фитинг', 'насос', 'кран'],
  };
  let best = -1;
  systemTypes.forEach((systemType) => {
    const list = keywords[systemType] || ['кабель', 'автомат', 'термостат', 'монтажн'];
    const idx = list.findIndex((needle) => text.includes(needle));
    if (idx >= 0) best = best < 0 ? idx + 1 : Math.min(best, idx + 1);
  });
  if (best < 0 && text.includes('аксесс')) return 30;
  return best;
}

function selectMainProducts(requirements: EngineeringRequirements, requiredPowerKw: number, systemTypes: SystemType[]) {
  const mode = requirements.mode === 'cooling' ? 'cooling' : requirements.mode === 'floor_heating' ? 'heating' : 'heating';
  return productRows()
    .filter((row) => Number(row.is_calculator_accessory || 0) !== 1)
    .map((row) => ({
      row,
      systemScore: Math.min(...systemTypes.map((systemType) => {
        const score = systemMainScore(row, systemType, requirements.mode);
        return score < 0 ? 999 : score;
      })),
      powerKw: parsePowerKw(row, mode),
      status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)),
    }))
    .filter((item) => item.systemScore < 999 && item.status !== 'unavailable')
    .map((item) => {
      const powerDistance = item.powerKw && item.powerKw > 0 ? Math.abs(requiredPowerKw - item.powerKw) : 12;
      const underPenalty = item.powerKw && item.powerKw < requiredPowerKw ? 8 : 0;
      const priority = Number(item.row.calculator_priority || 0);
      const price = Number(item.row.price_amd || 999999999);
      return { ...item, score: priority * 0.1 + availabilityRank(item.status) * 100 + item.systemScore * 10 + underPenalty + powerDistance, price };
    })
    .sort((a, b) => a.score - b.score || a.price - b.price)
    .slice(0, 12)
    .map((item) => productDto(item.row, mode, 'main'))
    .filter((item): item is EngineeringProduct => Boolean(item));
}

function selectAccessories(requirements: EngineeringRequirements, systemTypes: SystemType[]) {
  const mode = requirements.mode === 'cooling' ? 'cooling' : 'heating';
  return productRows()
    .map((row) => ({ row, score: accessoryScore(row, systemTypes), status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)) }))
    .filter((item) => item.score >= 0 && item.status !== 'unavailable')
    .sort((a, b) => availabilityRank(a.status) - availabilityRank(b.status) || a.score - b.score || Number(a.row.price_amd || 999999999) - Number(b.row.price_amd || 999999999))
    .slice(0, 10)
    .map((item) => productDto(item.row, mode, 'accessory'))
    .filter((item): item is EngineeringProduct => Boolean(item));
}

function bundleAvailability(items: EngineeringProduct[]): 'in_stock' | 'mixed' | 'preorder' {
  if (!items.length) return 'preorder';
  if (items.every((item) => item.availabilityStatus === 'in_stock')) return 'in_stock';
  if (items.every((item) => item.availabilityStatus === 'preorder')) return 'preorder';
  return 'mixed';
}

function estimatedTotal(items: EngineeringProduct[]) {
  const priced = items.filter((item) => typeof item.price === 'number');
  if (!priced.length) return null;
  return priced.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function makeBundles(mainProducts: EngineeringProduct[], accessories: EngineeringProduct[], budgetLevel: BudgetLevel, includeAccessories: boolean): EngineeringBundle[] {
  const byPrice = [...mainProducts].sort((a, b) => Number(a.price || 999999999) - Number(b.price || 999999999));
  const byQuality = [...mainProducts].sort((a, b) => {
    const tierScore = (item: EngineeringProduct) => item.brandQualityTier === 'premium' ? 0 : item.brandQualityTier === 'optimal' ? 1 : 2;
    return tierScore(a) - tierScore(b) || Number(b.price || 0) - Number(a.price || 0);
  });
  const picks = {
    economy: byPrice[0] || mainProducts[0] || null,
    optimal: mainProducts[Math.min(1, mainProducts.length - 1)] || mainProducts[0] || null,
    premium: byQuality[0] || mainProducts[2] || mainProducts[0] || null,
  };
  const descriptions = {
    economy: 'Минимально рабочий комплект с приоритетом цены и базовых аксессуаров.',
    optimal: 'Баланс цены, наличия и правильной комплектации.',
    premium: 'Более сильная комплектация: автоматика, защита и товары более высокого класса, если они есть в базе.',
  };
  return (['economy', 'optimal', 'premium'] as const).map((bundleType) => {
    const mainProduct = picks[bundleType];
    const accCount = bundleType === 'economy' ? 3 : bundleType === 'optimal' ? 6 : 8;
    const bundleAccessories = includeAccessories ? accessories.slice(0, accCount) : [];
    const items = [mainProduct, ...bundleAccessories].filter((item): item is EngineeringProduct => Boolean(item));
    return {
      bundleType,
      title: bundleType === 'economy' ? 'Эконом комплект' : bundleType === 'optimal' ? 'Оптимальный комплект' : 'Премиум комплект',
      description: descriptions[bundleType],
      mainProduct,
      accessories: bundleAccessories,
      estimatedTotal: estimatedTotal(items),
      availabilityStatus: bundleAvailability(items),
      notes: [
        budgetLevel === bundleType ? 'Соответствует выбранному уровню бюджета.' : 'Альтернативный уровень комплектации.',
        'Предварительная комплектация; совместимость аксессуаров нужно подтвердить перед монтажом.',
      ],
    };
  });
}

export function generateEngineeringSelection(input: EngineeringRequirements) {
  const requirements: EngineeringRequirements = {
    ...input,
    ceilingHeight: input.ceilingHeight || 2.7,
    energySource: input.energySource || (input.hasGas === true ? 'gas' : input.hasGas === false ? 'electric' : 'unknown'),
    budgetLevel: input.budgetLevel || 'optimal',
    includeAccessories: input.includeAccessories !== false,
  };
  if (!requirements.area || !Number.isFinite(requirements.area) || requirements.area <= 0) {
    throw new Error('area must be a positive number');
  }
  if (!['heating', 'cooling', 'floor_heating'].includes(requirements.mode)) {
    throw new Error('mode must be heating, cooling or floor_heating');
  }
  const calculationMode = requirements.mode === 'floor_heating' ? 'heating' : requirements.mode;
  const calculation = calculateRequiredPower({ ...requirements, mode: calculationMode });

  if (requirements.mode === 'floor_heating') {
    const availableInstallAreaM2 = Number(requirements.availableInstallAreaM2 || requirements.area || 0);
    const floorHeating = matchFloorHeatingProducts({
      roomAreaM2: Number(requirements.roomAreaM2 || requirements.area || 0),
      ceilingHeightM: Number(requirements.ceilingHeightM || requirements.ceilingHeight || 2.7),
      roomType: requirements.roomType || 'unknown',
      insulationLevel: requirements.insulation || 'unknown',
      windowType: requirements.windows || 'unknown',
      budgetLevel: requirements.budgetLevel || 'optimal',
      floorHeatingPurpose: requirements.floorHeatingPurpose || 'unknown',
      floorFinish: requirements.floorFinish || 'unknown',
      floorBuildType: requirements.floorBuildType || 'unknown',
      preferredHeatingElement: requirements.preferredHeatingElement || 'auto',
      blockedZones: Array.isArray(requirements.blockedZones) ? requirements.blockedZones : [],
      blockedAreaM2: requirements.blockedAreaM2 || null,
      availableInstallAreaM2,
      requiredHeatingPowerW: Math.round(calculation.requiredPowerKw * 1000),
      includeAccessories: requirements.includeAccessories !== false,
    });
    const systemTypes = floorHeating.selectedSystemType === 'heating_cable'
      ? ['floor_heating_cable' as SystemType]
      : floorHeating.selectedSystemType === 'none'
        ? ['floor_heating_mat' as SystemType, 'floor_heating_cable' as SystemType]
        : ['floor_heating_mat' as SystemType];
    return {
      requiredPowerKw: calculation.requiredPowerKw,
      recommendedRange: calculation.recommendedRange,
      recommendedSystems: systemTypes.map((systemType) => ({ systemType, label: systemLabel(systemType), reason: systemReason(systemType) })),
      bundles: floorHeating.bundles,
      mainProducts: floorHeating.mainProduct ? [floorHeating.mainProduct] : [],
      accessories: floorHeating.accessories,
      warnings: Array.from(new Set([
        floorHeating.engineeringConclusion,
        ...floorHeating.warnings,
        ...floorHeating.installationRecommendations,
      ])),
      floorHeating,
      calculationDetails: {
        ...calculation.calculationDetails,
        mode: requirements.mode,
        area: requirements.area,
        ceilingHeight: requirements.ceilingHeight,
        energySource: requirements.energySource,
        systemTypes,
        budgetLevel: requirements.budgetLevel,
        includeAccessories: requirements.includeAccessories,
        availableInstallAreaM2: floorHeating.availableInstallAreaM2,
        requiredHeatingPowerW: floorHeating.requiredHeatingPowerW,
        selectedSystemPowerW: floorHeating.selectedSystemPowerW,
        selectedSystemPowerKw: floorHeating.selectedSystemPowerKw,
        specificPowerWm2: floorHeating.specificPowerWm2,
        powerCoveragePercent: floorHeating.powerCoveragePercent,
        powerBalancePercent: floorHeating.powerBalancePercent,
        cableLengthM: floorHeating.cableLengthM,
        cableSpacingCm: floorHeating.cableSpacingCm,
        mountingTapeRequiredM: floorHeating.mountingTapeRequiredM,
        mountingTapeRequiredWithReserveM: floorHeating.mountingTapeRequiredWithReserveM,
        matAreaM2: floorHeating.matAreaM2,
        matPowerPerM2: floorHeating.matPowerPerM2,
      },
      disclaimer: 'Предварительный инженерный подбор. Перед монтажом проверьте паспорт покрытия, схему укладки, сопротивление кабеля/мата и электрозащиту по проекту.',
    };
  }

  const systemTypes = inferSystemTypes(requirements);
  const mainProducts = selectMainProducts(requirements, calculation.requiredPowerKw, systemTypes);
  const accessories = requirements.includeAccessories ? selectAccessories(requirements, systemTypes) : [];
  const warnings: string[] = [];
  if (!mainProducts.length) warnings.push('По заданным параметрам нет точного совпадения. Можно предложить ближайшие варианты или отправить заявку менеджеру.');
  if (requirements.mode === 'heating' && requirements.hasGas === null) warnings.push('Наличие газа не уточнено — подбор энергосистемы предварительный.');
  return {
    requiredPowerKw: calculation.requiredPowerKw,
    recommendedRange: calculation.recommendedRange,
    recommendedSystems: systemTypes.map((systemType) => ({ systemType, label: systemLabel(systemType), reason: systemReason(systemType) })),
    bundles: makeBundles(mainProducts, accessories, requirements.budgetLevel || 'optimal', requirements.includeAccessories !== false),
    mainProducts,
    accessories,
    warnings,
    calculationDetails: {
      ...calculation.calculationDetails,
      mode: requirements.mode,
      area: requirements.area,
      ceilingHeight: requirements.ceilingHeight,
      energySource: requirements.energySource,
      systemTypes,
      budgetLevel: requirements.budgetLevel,
      includeAccessories: requirements.includeAccessories,
    },
    disclaimer: 'Предварительный подбор. Для точного проекта требуется консультация специалиста.',
  };
}

function systemLabel(systemType: SystemType) {
  const labels: Record<string, string> = {
    gas_boiler: 'Газовый котёл', electric_boiler: 'Электрический котёл', heat_pump: 'Heat pump / тепловой насос', electric_convector: 'Электрический конвектор', floor_heating: 'Тёплый пол', infrared_heating: 'Инфракрасное отопление', air_conditioner: 'Кондиционер', fan_coil: 'Фанкойл', floor_heating_mat: 'Нагревательный мат', floor_heating_cable: 'Нагревательный кабель',
  };
  return labels[systemType] || systemType;
}

function systemReason(systemType: SystemType) {
  if (systemType === 'heat_pump') return 'Энергоэффективно для отопления и охлаждения.';
  if (systemType === 'electric_convector') return 'Просто и быстро для помещений без газа.';
  if (systemType === 'floor_heating' || systemType.startsWith('floor_heating')) return 'Комфортный локальный обогрев.';
  if (systemType === 'gas_boiler') return 'Рационально при наличии газа и водяной системы.';
  if (systemType === 'air_conditioner') return 'Базовый вариант охлаждения помещения.';
  return 'Подходит как инженерная альтернатива по заданным условиям.';
}
