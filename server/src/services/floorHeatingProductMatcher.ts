import { warmFloorProductRows } from '../utils/warmFloorProducts.js';
import type { WarmFloorCatalogProduct } from '../utils/warmFloorCalculator.js';

export type FloorHeatingPurpose = 'comfort' | 'primary_heating' | 'additional_heating' | 'unknown';
export type FloorFinish = 'tile' | 'porcelain_tile' | 'laminate' | 'wood' | 'vinyl_spc' | 'other' | 'unknown';
export type FloorBuildType = 'new_screed' | 'tile_adhesive' | 'minimal_height' | 'existing_floor' | 'unknown';
export type PreferredHeatingElement = 'heating_cable' | 'heating_mat' | 'thin_mat' | 'auto';

export type FloorHeatingMatcherRequirements = {
  roomAreaM2: number;
  ceilingHeightM: number;
  roomType?: string;
  insulationLevel?: string;
  windowType?: string;
  budgetLevel?: string;
  floorHeatingPurpose: FloorHeatingPurpose;
  floorFinish: FloorFinish;
  floorBuildType: FloorBuildType;
  preferredHeatingElement: PreferredHeatingElement;
  blockedZones: string[];
  blockedAreaM2?: number | null;
  availableInstallAreaM2: number;
  requiredHeatingPowerW: number;
  includeAccessories?: boolean;
};

export type PublicEngineeringProduct = {
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
  availabilityStatus: 'in_stock' | 'low_stock' | 'preorder';
  availabilityLabel: string;
  preorderNote: string;
  equipmentType: string;
  energySource: string;
  systemType: string;
  aiSelectionNotes: string;
  brandQualityTier: string;
};

export type FloorHeatingMatchedBundle = {
  bundleType: 'economy' | 'optimal' | 'premium';
  title: string;
  description: string;
  mainProduct: PublicEngineeringProduct | null;
  accessories: PublicEngineeringProduct[];
  estimatedTotal: number | null;
  availabilityStatus: 'in_stock' | 'mixed' | 'preorder';
  notes: string[];
};

export type FloorHeatingEngineeringAnalysis = {
  recommendedSolution: string;
  selectedSystemType: 'heating_cable' | 'heating_mat' | 'thin_mat' | 'none';
  availableInstallAreaM2: number;
  requiredHeatingPowerW: number;
  selectedSystemPowerW: number;
  selectedSystemPowerKw: number;
  specificPowerWm2: number;
  powerCoveragePercent: number;
  powerBalancePercent: number;
  cableLengthM: number | null;
  cableSpacingCm: number | null;
  cableSpacingStatus: string | null;
  mountingTapeRequiredM: number | null;
  mountingTapeRequiredWithReserveM: number | null;
  matAreaM2: number | null;
  matPowerPerM2: number | null;
  engineeringConclusion: string;
  warnings: string[];
  missingClarifications: string[];
  installationRecommendations: string[];
  mainProduct: PublicEngineeringProduct | null;
  accessories: PublicEngineeringProduct[];
  alternativeProducts: PublicEngineeringProduct[];
  bundles: FloorHeatingMatchedBundle[];
};

export const FLOOR_HEATING_ENGINEERING_CONFIG = {
  minCableSpacingCm: 7.5,
  idealCableSpacingMinCm: 7.5,
  idealCableSpacingMaxCm: 12.5,
  maxCableSpacingCm: 15,
  mountingTapePerM2: 1.5,
  mountingTapeReserveFactor: 1.1,
  comfortPowerWm2: 150,
};

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clean(value: unknown) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function toPublicProduct(product: WarmFloorCatalogProduct, systemType?: string): PublicEngineeringProduct | null {
  if (product.availabilityStatus === 'unavailable') return null;
  return {
    id: product.id,
    slug: String(product.slug || ''),
    sku: String(product.sku || ''),
    name: String(product.name || ''),
    brand: String(product.brand || ''),
    article: String(product.article || product.sku || ''),
    powerKw: product.powerW ? round(product.powerW / 1000) : product.powerKw || null,
    recommendedAreaM2: product.matAreaM2 || null,
    price: product.price ?? null,
    currency: product.currency || 'AMD',
    image: product.image || '',
    availabilityStatus: product.availabilityStatus,
    availabilityLabel: product.availabilityLabel,
    preorderNote: product.availabilityStatus === 'preorder' ? 'Поставка под заказ, срок уточняется' : '',
    equipmentType: product.productType,
    energySource: 'electric',
    systemType: systemType || product.productType,
    aiSelectionNotes: '',
    brandQualityTier: '',
  };
}

function productPowerW(product: WarmFloorCatalogProduct) {
  return product.powerW || (product.powerKw ? Math.round(product.powerKw * 1000) : 0);
}

function price(product: WarmFloorCatalogProduct) {
  return Number(product.price || Number.MAX_SAFE_INTEGER);
}

function availabilityRank(product: WarmFloorCatalogProduct) {
  if (product.availabilityStatus === 'in_stock') return 0;
  if (product.availabilityStatus === 'low_stock') return 1;
  if (product.availabilityStatus === 'preorder') return 2;
  return 99;
}

function isTileLike(finish: FloorFinish) {
  return finish === 'tile' || finish === 'porcelain_tile';
}

function sensitiveFinish(finish: FloorFinish) {
  return finish === 'laminate' || finish === 'wood' || finish === 'vinyl_spc' || finish === 'other' || finish === 'unknown';
}

function allowedMainTypes(req: FloorHeatingMatcherRequirements): Array<'heating_cable' | 'heating_mat'> {
  if (req.floorBuildType === 'new_screed') return req.preferredHeatingElement === 'heating_mat' ? ['heating_cable', 'heating_mat'] : ['heating_cable'];
  if (req.floorBuildType === 'tile_adhesive' || req.floorBuildType === 'minimal_height') {
    if (!isTileLike(req.floorFinish)) return [];
    return ['heating_mat', 'heating_cable'];
  }
  if (req.preferredHeatingElement === 'heating_cable') return ['heating_cable'];
  if (req.preferredHeatingElement === 'heating_mat' || req.preferredHeatingElement === 'thin_mat') return ['heating_mat'];
  return ['heating_mat', 'heating_cable'];
}

function spacingStatus(spacingCm: number | null) {
  if (!spacingCm) return null;
  const cfg = FLOOR_HEATING_ENGINEERING_CONFIG;
  if (spacingCm < cfg.minCableSpacingCm) return 'Кабель слишком длинный для этой площади: шаг меньше 7.5 см.';
  if (spacingCm <= cfg.idealCableSpacingMaxCm) return 'Хороший диапазон шага укладки.';
  if (spacingCm <= cfg.maxCableSpacingCm) return 'Допустимо, но прогрев может быть менее равномерным.';
  return 'Шаг слишком большой: возможны холодные зоны.';
}

function mountingTape(areaM2: number) {
  const raw = round(areaM2 * FLOOR_HEATING_ENGINEERING_CONFIG.mountingTapePerM2, 2);
  const withReserve = Math.ceil(raw * FLOOR_HEATING_ENGINEERING_CONFIG.mountingTapeReserveFactor);
  return { raw, withReserve };
}

function candidateScore(product: WarmFloorCatalogProduct, req: FloorHeatingMatcherRequirements, type: 'heating_cable' | 'heating_mat') {
  const powerW = productPowerW(product);
  const powerDistance = Math.abs(powerW - targetPowerForSelection(req)) / Math.max(targetPowerForSelection(req), 1);
  let technicalPenalty = 0;
  if (type === 'heating_mat') {
    const matArea = product.matAreaM2 || (powerW ? powerW / FLOOR_HEATING_ENGINEERING_CONFIG.comfortPowerWm2 : 0);
    if (matArea > req.availableInstallAreaM2) technicalPenalty += 10000;
    technicalPenalty += Math.abs(req.availableInstallAreaM2 - matArea) * 4;
  } else {
    const length = product.cableLengthM || (product.linearPowerWm ? powerW / product.linearPowerWm : null);
    const spacing = length ? (req.availableInstallAreaM2 * 100) / length : null;
    if (!spacing || spacing < FLOOR_HEATING_ENGINEERING_CONFIG.minCableSpacingCm || spacing > FLOOR_HEATING_ENGINEERING_CONFIG.maxCableSpacingCm) technicalPenalty += 5000;
    technicalPenalty += spacing ? Math.abs(10 - spacing) * 4 : 100;
  }
  return availabilityRank(product) * 1000 + technicalPenalty + powerDistance * 100 + price(product) / 1000000 - Number(product.calculatorPriority || 0) * 0.1;
}

function targetPowerForSelection(req: FloorHeatingMatcherRequirements) {
  if (req.floorHeatingPurpose === 'comfort') return Math.round(req.availableInstallAreaM2 * FLOOR_HEATING_ENGINEERING_CONFIG.comfortPowerWm2);
  return req.requiredHeatingPowerW;
}

function accessoryProducts(products: WarmFloorCatalogProduct[], mainType: 'heating_cable' | 'heating_mat' | 'thin_mat' | 'none', includeAccessories: boolean) {
  if (!includeAccessories) return [];
  const wanted = new Set(['thermostat', 'floor_sensor', 'corrugated_tube', 'protection', 'accessory']);
  if (mainType === 'heating_cable') wanted.add('mounting_tape');
  return products
    .filter((product) => wanted.has(product.productType) && product.availabilityStatus !== 'unavailable')
    .sort((a, b) => availabilityRank(a) - availabilityRank(b) || price(a) - price(b))
    .slice(0, mainType === 'heating_cable' ? 7 : 6)
    .map((product) => toPublicProduct(product, product.productType))
    .filter((product): product is PublicEngineeringProduct => Boolean(product));
}

function bundleAvailability(items: PublicEngineeringProduct[]): 'in_stock' | 'mixed' | 'preorder' {
  if (!items.length) return 'preorder';
  if (items.every((item) => item.availabilityStatus === 'in_stock')) return 'in_stock';
  if (items.every((item) => item.availabilityStatus === 'preorder')) return 'preorder';
  return 'mixed';
}

function estimatedTotal(items: PublicEngineeringProduct[]) {
  const priced = items.filter((item) => typeof item.price === 'number');
  if (!priced.length) return null;
  return priced.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function makeBundles(main: PublicEngineeringProduct | null, alternatives: PublicEngineeringProduct[], accessories: PublicEngineeringProduct[], notes: string[]): FloorHeatingMatchedBundle[] {
  const mains = [main, ...alternatives].filter((item): item is PublicEngineeringProduct => Boolean(item)).slice(0, 3);
  const fallbackTitles = ['Оптимальный комплект', 'Альтернативный комплект', 'Усиленный / другой вариант'];
  return (['optimal', 'economy', 'premium'] as const).map((bundleType, index) => {
    const mainProduct = mains[index] || mains[0] || null;
    const bundleAccessories = accessories.slice(0, bundleType === 'economy' ? 4 : bundleType === 'optimal' ? 6 : 7);
    const items = [mainProduct, ...bundleAccessories].filter((item): item is PublicEngineeringProduct => Boolean(item));
    return {
      bundleType,
      title: fallbackTitles[index] || 'Комплект',
      description: index === 0 ? 'Основной технически корректный комплект по условиям монтажа.' : 'Техническая альтернатива из доступной базы товаров.',
      mainProduct,
      accessories: bundleAccessories,
      estimatedTotal: estimatedTotal(items),
      availabilityStatus: bundleAvailability(items),
      notes: notes.slice(0, 3),
    };
  });
}

export function matchFloorHeatingProducts(req: FloorHeatingMatcherRequirements): FloorHeatingEngineeringAnalysis {
  const warnings: string[] = [];
  const missingClarifications: string[] = [];
  const products = warmFloorProductRows().filter((product) => product.availabilityStatus !== 'unavailable');
  const allowedTypes = allowedMainTypes(req);
  if (req.floorBuildType === 'unknown') missingClarifications.push('Нужно подтвердить конструкцию пола: стяжка, плиточный клей или минимальная высота.');
  if (!req.availableInstallAreaM2 || req.availableInstallAreaM2 <= 0) missingClarifications.push('Нужно указать доступную площадь укладки.');
  if (sensitiveFinish(req.floorFinish)) warnings.push('Для ламината, дерева, винила/SPC и неизвестных покрытий нужен терморегулятор с датчиком пола и ограничением температуры пола. Совместимость покрытия нужно проверить по паспорту.');
  if (req.floorBuildType === 'tile_adhesive' && !isTileLike(req.floorFinish)) warnings.push('Стандартный мат в плиточный клей нельзя автоматически рекомендовать для выбранного покрытия без проверки совместимости.');

  const mainCandidates = products
    .filter((product) => allowedTypes.includes(product.productType as 'heating_cable' | 'heating_mat'))
    .filter((product) => {
      if (product.productType === 'heating_mat') {
        const area = product.matAreaM2 || (productPowerW(product) ? productPowerW(product) / FLOOR_HEATING_ENGINEERING_CONFIG.comfortPowerWm2 : 0);
        return area > 0 && area <= req.availableInstallAreaM2;
      }
      if (product.productType === 'heating_cable') {
        if (req.floorBuildType !== 'new_screed') {
          const text = clean([product.name, product.sku, product.article].join(' '));
          if (!['тонк', 'thin', 'adhesive', 'клей', 'плитк'].some((needle) => text.includes(needle))) return false;
        }
        return Boolean(product.cableLengthM || product.linearPowerWm || productPowerW(product));
      }
      return false;
    })
    .sort((a, b) => candidateScore(a, req, a.productType as 'heating_cable' | 'heating_mat') - candidateScore(b, req, b.productType as 'heating_cable' | 'heating_mat'));

  const selected = mainCandidates[0] || null;
  const selectedType = selected?.productType === 'heating_cable' ? 'heating_cable' : selected?.productType === 'heating_mat' ? (req.preferredHeatingElement === 'thin_mat' || req.floorBuildType === 'minimal_height' ? 'thin_mat' : 'heating_mat') : 'none';
  const selectedPowerW = selected ? productPowerW(selected) : 0;
  const selectedPowerKw = round(selectedPowerW / 1000);
  const specificPowerWm2 = req.availableInstallAreaM2 > 0 && selectedPowerW > 0 ? round(selectedPowerW / req.availableInstallAreaM2, 1) : 0;
  const powerCoveragePercent = req.requiredHeatingPowerW > 0 && selectedPowerW > 0 ? round((selectedPowerW / req.requiredHeatingPowerW) * 100, 1) : 0;
  const powerBalancePercent = round(powerCoveragePercent - 100, 1);
  let cableLengthM: number | null = null;
  let cableSpacingCm: number | null = null;
  let cableSpacingText: string | null = null;
  let mountingTapeRequiredM: number | null = null;
  let mountingTapeRequiredWithReserveM: number | null = null;
  let matAreaM2: number | null = null;
  let matPowerPerM2: number | null = null;

  if (selected?.productType === 'heating_cable') {
    cableLengthM = selected.cableLengthM || (selected.linearPowerWm && selectedPowerW ? round(selectedPowerW / selected.linearPowerWm, 2) : null);
    cableSpacingCm = cableLengthM ? round((req.availableInstallAreaM2 * 100) / cableLengthM, 1) : null;
    cableSpacingText = spacingStatus(cableSpacingCm);
    const tape = mountingTape(req.availableInstallAreaM2);
    mountingTapeRequiredM = tape.raw;
    mountingTapeRequiredWithReserveM = tape.withReserve;
    if (cableSpacingText && !cableSpacingText.includes('Хороший')) warnings.push(cableSpacingText);
  }
  if (selected?.productType === 'heating_mat') {
    matAreaM2 = selected.matAreaM2 || (selectedPowerW ? round(selectedPowerW / FLOOR_HEATING_ENGINEERING_CONFIG.comfortPowerWm2) : null);
    matPowerPerM2 = matAreaM2 && selectedPowerW ? round(selectedPowerW / matAreaM2, 1) : null;
  }

  if (!selected && allowedTypes.includes('heating_mat')) warnings.push('В наличии нет корректного размера мата под вашу площадь. Ближайший мат больше доступной зоны, его нельзя просто укоротить. Лучше подобрать меньший мат, комбинацию матов или перейти на кабельную систему.');
  if (!selected) warnings.push('Не найден технически корректный основной товар в базе OhmX.am по текущим условиям. Нужна альтернатива или заявка менеджеру.');
  if (req.floorHeatingPurpose === 'primary_heating' && selectedPowerW > 0 && powerCoveragePercent < 90) warnings.push('Один тёплый пол на доступной площади не перекрывает требуемую мощность помещения. Его можно использовать как комфортный или дополнительный обогрев. Для основного отопления нужен дополнительный источник.');
  if (powerCoveragePercent > 120) warnings.push('Установленная мощность заметно выше расчётной: нужно проверить ограничение температуры покрытия, терморегулятор и допустимую удельную мощность.');
  if (selected?.productType === 'heating_mat' && matAreaM2 && matAreaM2 > req.availableInstallAreaM2) warnings.push('Мат больше доступной зоны: его нельзя укорачивать по кабелю или укладывать под мебель без теплоотвода.');
  if (selected?.productType === 'heating_cable' && req.floorBuildType === 'new_screed' && !mountingTapeRequiredWithReserveM) warnings.push('Для кабеля в стяжку обязательна монтажная лента.');

  const accessories = accessoryProducts(products, selectedType, req.includeAccessories !== false);
  const publicMain = selected ? toPublicProduct(selected, selectedType) : null;
  const alternatives = mainCandidates.slice(1, 4).map((product) => toPublicProduct(product, product.productType)).filter((product): product is PublicEngineeringProduct => Boolean(product));
  const notes = [
    selectedType === 'heating_cable' ? `Шаг кабеля: ${cableSpacingCm ? `${cableSpacingCm} см` : 'нужно уточнить длину кабеля'}.` : selectedType === 'none' ? 'Основной товар не выбран.' : `Площадь мата: ${matAreaM2 || 'нужно уточнить'} м².`,
    `Покрытие мощности: ${powerCoveragePercent || 0}%.`,
    'Точные остатки скрыты: показывается только публичный статус наличия.',
  ];

  const solution = selectedType === 'heating_cable'
    ? 'кабель в стяжку с монтажной лентой, терморегулятором, датчиком пола и гофротрубкой'
    : selectedType === 'thin_mat'
      ? 'тонкий нагревательный мат для минимальной высоты под плитку'
      : selectedType === 'heating_mat'
        ? 'нагревательный мат под плитку / керамогранит в плиточный клей'
        : 'технически корректный комплект не найден по текущим условиям';

  const conclusion = selectedPowerW > 0
    ? `Требуемая мощность помещения — ${round(req.requiredHeatingPowerW / 1000)} кВт. На доступной площади ${req.availableInstallAreaM2} м² выбранная система даст около ${selectedPowerKw} кВт (${specificPowerWm2} Вт/м²), покрытие мощности — ${powerCoveragePercent}%.`
    : `Требуемая мощность помещения — ${round(req.requiredHeatingPowerW / 1000)} кВт. Для доступной площади ${req.availableInstallAreaM2} м² в базе не найден корректный основной товар.`;

  return {
    recommendedSolution: solution,
    selectedSystemType: selectedType,
    availableInstallAreaM2: req.availableInstallAreaM2,
    requiredHeatingPowerW: Math.round(req.requiredHeatingPowerW),
    selectedSystemPowerW: Math.round(selectedPowerW),
    selectedSystemPowerKw: selectedPowerKw,
    specificPowerWm2,
    powerCoveragePercent,
    powerBalancePercent,
    cableLengthM,
    cableSpacingCm,
    cableSpacingStatus: cableSpacingText,
    mountingTapeRequiredM,
    mountingTapeRequiredWithReserveM,
    matAreaM2,
    matPowerPerM2,
    engineeringConclusion: conclusion,
    warnings: Array.from(new Set(warnings)),
    missingClarifications,
    installationRecommendations: [
      'Не укладывать нагревательный элемент под мебель без ножек, кухню, ванну, душевую, шкафы и зоны без теплоотвода.',
      'Нагревательный кабель нельзя резать или укорачивать.',
      'Мат можно разворачивать по сетке, но нельзя резать сам кабель.',
      'Датчик пола установить в гофротрубке с заглушкой на конце.',
      'Проверить сопротивление до монтажа, после укладки и перед заливкой / закрытием плиткой.',
      'Подключение выполнять через защиту по проекту; для влажных помещений учитывать требования электробезопасности.',
    ],
    mainProduct: publicMain,
    accessories,
    alternativeProducts: alternatives,
    bundles: makeBundles(publicMain, alternatives, accessories, notes),
  };
}
