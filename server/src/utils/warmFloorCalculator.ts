export type WarmFloorRoomPurpose = 'bathroom' | 'kitchen' | 'living_room' | 'bedroom' | 'balcony' | 'corridor' | 'local_zone' | 'other';
export type WarmFloorHeatingGoal = 'comfort_floor' | 'additional_heating' | 'main_heating' | 'local_zone';
export type WarmFloorExcludedZoneType = 'bath' | 'wardrobe' | 'appliance' | 'kitchen_set' | 'furniture_no_gap' | 'other';
export type WarmFloorSubstrateType = 'concrete_screed' | 'tile_adhesive' | 'old_tile' | 'wood' | 'insulation_board' | 'other';
export type WarmFloorCovering = 'tile' | 'porcelain' | 'stone' | 'laminate' | 'vinyl' | 'engineered_wood' | 'other';
export type WarmFloorSystemPreference = 'auto' | 'mat' | 'cable';
export type WarmFloorTargetPowerMode = 'preset' | 'custom';
export type WarmFloorProductType = 'heating_cable' | 'heating_mat' | 'mounting_tape' | 'thermostat' | 'floor_sensor' | 'corrugated_tube' | 'protection' | 'accessory';
export type PublicAvailabilityStatus = 'in_stock' | 'low_stock' | 'preorder' | 'unavailable';

export type WarmFloorExcludedZone = {
  type: WarmFloorExcludedZoneType;
  label?: string;
  areaM2: number;
};

export type WarmFloorInput = {
  roomPurpose: WarmFloorRoomPurpose;
  heatingGoal: WarmFloorHeatingGoal;
  totalAreaM2: number;
  excludedZones: WarmFloorExcludedZone[];
  heatedAreaM2?: number | null;
  substrateType: WarmFloorSubstrateType;
  floorCovering: WarmFloorCovering;
  wetZone: boolean;
  targetPowerMode: WarmFloorTargetPowerMode;
  customTargetPowerWm2?: number | null;
  systemPreference?: WarmFloorSystemPreference;
  preferredBrands?: string[];
};

export type NormalizedWarmFloorInput = Omit<WarmFloorInput, 'heatedAreaM2'> & {
  heatedAreaM2: number;
  excludedAreaM2: number;
};

export type WarmFloorSettings = {
  powerPresetsWm2: Record<WarmFloorRoomPurpose, Record<WarmFloorHeatingGoal, number>>;
  coveringCompatibility: Record<WarmFloorCovering, { cable: boolean; mat: boolean; maxPowerWm2: number; note?: string }>;
  substrateCompatibility: Record<WarmFloorSubstrateType, { cable: boolean; mat: boolean; note?: string }>;
  allowedCableSpacingCm: number[];
  mountingTape: { rowSpacingM: number; wasteFactor: number; minMeters: number };
  accessoryRules: {
    thermostat: { required: boolean; query: string[] };
    floorSensor: { required: boolean; query: string[] };
    corrugatedTube: { required: boolean; query: string[] };
    protection: { required: boolean; query: string[] };
    mountingTape: { requiredForCable: boolean; query: string[] };
  };
  warningTexts: Record<string, string>;
};

export type WarmFloorCatalogProduct = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article?: string;
  price?: number | null;
  currency?: string;
  image?: string;
  availabilityStatus: PublicAvailabilityStatus;
  availabilityLabel: string;
  productType: WarmFloorProductType;
  powerW?: number | null;
  powerKw?: number | null;
  linearPowerWm?: number | null;
  cableLengthM?: number | null;
  matAreaM2?: number | null;
  voltageV?: number | null;
  roomTypes?: WarmFloorRoomPurpose[];
  floorCoverings?: WarmFloorCovering[];
  substrateTypes?: WarmFloorSubstrateType[];
  wetZoneAllowed?: boolean | null;
  calculatorPriority?: number;
};

export type WarmFloorWarning = {
  code: string;
  severity: 'info' | 'warning' | 'danger';
  text: string;
};

export type WarmFloorBaseCalculation = {
  totalAreaM2: number;
  excludedAreaM2: number;
  heatedAreaM2: number;
  targetPowerWm2: number;
  requiredPowerW: number;
  requiredPowerKw: number;
  suggestedSystemTypes: Array<'heating_mat' | 'heating_cable'>;
  warnings: WarmFloorWarning[];
};

export type WarmFloorCableCalculation = {
  requiredPowerW: number;
  selectedPowerW: number;
  selectedPowerKw: number;
  lengthRequiredM: number | null;
  selectedCableLengthM: number | null;
  linearPowerWm: number | null;
  actualPowerWm2: number;
  spacingCm: number | null;
  spacingByTargetCm: number | null;
  nearestAllowedSpacingCm: number | null;
  spacingDeltaCm: number | null;
  mountingTapeM: number;
};

export type WarmFloorMatCalculation = {
  requiredPowerW: number;
  selectedPowerW: number;
  coveredAreaM2: number;
  actualPowerWm2: number;
  coveragePercent: number;
};

export type WarmFloorCandidate = {
  role: 'optimal' | 'economy' | 'boosted';
  label: string;
  systemType: 'heating_cable' | 'heating_mat';
  product: WarmFloorCatalogProduct;
  calculation: WarmFloorCableCalculation | WarmFloorMatCalculation;
  compatible: boolean;
  score: number;
  warnings: WarmFloorWarning[];
  accessories: WarmFloorCatalogProduct[];
  mountingTapeMeters?: number;
};

export const DEFAULT_WARM_FLOOR_SETTINGS: WarmFloorSettings = {
  powerPresetsWm2: {
    bathroom: { comfort_floor: 150, additional_heating: 170, main_heating: 200, local_zone: 150 },
    kitchen: { comfort_floor: 140, additional_heating: 160, main_heating: 190, local_zone: 140 },
    living_room: { comfort_floor: 130, additional_heating: 150, main_heating: 180, local_zone: 130 },
    bedroom: { comfort_floor: 120, additional_heating: 140, main_heating: 170, local_zone: 120 },
    balcony: { comfort_floor: 170, additional_heating: 190, main_heating: 220, local_zone: 170 },
    corridor: { comfort_floor: 130, additional_heating: 150, main_heating: 180, local_zone: 130 },
    local_zone: { comfort_floor: 140, additional_heating: 160, main_heating: 190, local_zone: 140 },
    other: { comfort_floor: 140, additional_heating: 160, main_heating: 190, local_zone: 140 },
  },
  coveringCompatibility: {
    tile: { cable: true, mat: true, maxPowerWm2: 220 },
    porcelain: { cable: true, mat: true, maxPowerWm2: 220 },
    stone: { cable: true, mat: true, maxPowerWm2: 220 },
    laminate: { cable: true, mat: false, maxPowerWm2: 150, note: 'Для ламината нужен совместимый датчик пола и ограничение температуры покрытия.' },
    vinyl: { cable: true, mat: false, maxPowerWm2: 140, note: 'Для винила проверьте паспорт покрытия и ограничьте температуру пола.' },
    engineered_wood: { cable: true, mat: false, maxPowerWm2: 140, note: 'Деревянные покрытия требуют ограничения температуры и согласования пирога пола.' },
    other: { cable: true, mat: false, maxPowerWm2: 150, note: 'Совместимость покрытия нужно подтвердить по паспорту производителя.' },
  },
  substrateCompatibility: {
    concrete_screed: { cable: true, mat: true },
    tile_adhesive: { cable: false, mat: true, note: 'В тонкий слой клея обычно выбирают мат, а не свободный кабель.' },
    old_tile: { cable: false, mat: true, note: 'Поверх старой плитки обычно удобнее мат в клеевой слой.' },
    wood: { cable: false, mat: false, note: 'Деревянное основание требует отдельного проектного решения.' },
    insulation_board: { cable: true, mat: true },
    other: { cable: true, mat: true, note: 'Основание нужно проверить перед подбором.' },
  },
  allowedCableSpacingCm: [7.5, 10, 12.5, 15, 17.5, 20],
  mountingTape: { rowSpacingM: 0.5, wasteFactor: 1, minMeters: 2 },
  accessoryRules: {
    thermostat: { required: true, query: ['терморегулятор', 'термостат', 'devireg', 'oj'] },
    floorSensor: { required: true, query: ['датчик пола', 'floor sensor', 'датчик'] },
    corrugatedTube: { required: true, query: ['гофра', 'гофротруб', 'corrugated'] },
    protection: { required: true, query: ['узо', 'дифавтомат', 'автомат'] },
    mountingTape: { requiredForCable: true, query: ['монтажная лента', 'крепежная лента', 'лента'] },
  },
  warningTexts: {
    NO_SHORTEN_CABLE: 'Нагревательный кабель нельзя укорачивать: выбирайте заводскую длину и мощность.',
    NO_STATIONARY_FURNITURE: 'Не укладывайте кабель/мат под ванну, кухонный гарнитур, технику и мебель без вентиляционного зазора.',
    NO_CROSSING: 'Кабель нельзя пересекать или укладывать витками вплотную друг к другу.',
    STEP_OUT_OF_RANGE: 'Расчётный шаг укладки вне допустимого диапазона — нужен другой кабель или изменение площади.',
    HEAT_LOSS_REQUIRED: 'Для основного отопления нужен отдельный расчёт теплопотерь помещения.',
    ELECTRICIAN_REQUIRED: 'Финальное подключение терморегулятора, УЗО/автомата и питания выполняет квалифицированный электрик.',
    WET_ZONE_RCD: 'Для влажной зоны обязательно предусмотреть защиту и корректный монтаж датчика/терморегулятора.',
    COVERING_LIMIT: 'Целевая мощность выше рекомендованной для выбранного покрытия.',
  },
};

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numberOr(value: unknown, fallback: number) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}

function warning(settings: WarmFloorSettings, code: string, severity: WarmFloorWarning['severity'] = 'warning'): WarmFloorWarning {
  return { code, severity, text: settings.warningTexts[code] || code };
}

export function normalizeWarmFloorInput(raw: Partial<WarmFloorInput>): NormalizedWarmFloorInput {
  const excludedZones = Array.isArray(raw.excludedZones) ? raw.excludedZones
    .map((zone) => ({ type: zone.type || 'other', label: zone.label || '', areaM2: Math.max(0, numberOr(zone.areaM2, 0)) }))
    .filter((zone) => zone.areaM2 > 0) : [];
  const totalAreaM2 = Math.max(0, numberOr(raw.totalAreaM2, 0));
  const excludedAreaM2 = round(excludedZones.reduce((sum, zone) => sum + zone.areaM2, 0));
  const calculatedHeated = Math.max(0, totalAreaM2 - excludedAreaM2);
  const explicitHeated = raw.heatedAreaM2 === null || raw.heatedAreaM2 === undefined || String(raw.heatedAreaM2).trim() === '' ? null : numberOr(raw.heatedAreaM2, calculatedHeated);
  const heatedAreaM2 = round(Math.max(0, explicitHeated && explicitHeated > 0 ? explicitHeated : calculatedHeated));
  return {
    roomPurpose: raw.roomPurpose || 'other',
    heatingGoal: raw.heatingGoal || 'comfort_floor',
    totalAreaM2: round(totalAreaM2),
    excludedZones,
    excludedAreaM2,
    heatedAreaM2,
    substrateType: raw.substrateType || 'concrete_screed',
    floorCovering: raw.floorCovering || 'tile',
    wetZone: Boolean(raw.wetZone),
    targetPowerMode: raw.targetPowerMode || 'preset',
    customTargetPowerWm2: raw.customTargetPowerWm2 ?? null,
    systemPreference: raw.systemPreference || 'auto',
    preferredBrands: Array.isArray(raw.preferredBrands) ? raw.preferredBrands.map(String).filter(Boolean) : [],
  };
}

export function calculateWarmFloorBase(input: NormalizedWarmFloorInput, settings: WarmFloorSettings = DEFAULT_WARM_FLOOR_SETTINGS): WarmFloorBaseCalculation {
  const preset = settings.powerPresetsWm2[input.roomPurpose]?.[input.heatingGoal] || settings.powerPresetsWm2.other[input.heatingGoal] || 150;
  const custom = numberOr(input.customTargetPowerWm2, preset);
  const targetPowerWm2 = input.targetPowerMode === 'custom' ? Math.max(60, Math.min(250, custom)) : preset;
  const requiredPowerW = Math.round(input.heatedAreaM2 * targetPowerWm2);
  const covering = settings.coveringCompatibility[input.floorCovering] || settings.coveringCompatibility.other;
  const substrate = settings.substrateCompatibility[input.substrateType] || settings.substrateCompatibility.other;
  const suggestedSystemTypes: WarmFloorBaseCalculation['suggestedSystemTypes'] = [];
  if (covering.mat && substrate.mat) suggestedSystemTypes.push('heating_mat');
  if (covering.cable && substrate.cable) suggestedSystemTypes.push('heating_cable');
  if (!suggestedSystemTypes.length) suggestedSystemTypes.push('heating_cable');
  const warnings: WarmFloorWarning[] = [
    warning(settings, 'NO_SHORTEN_CABLE', 'danger'),
    warning(settings, 'NO_STATIONARY_FURNITURE', 'danger'),
    warning(settings, 'NO_CROSSING', 'danger'),
    warning(settings, 'ELECTRICIAN_REQUIRED', 'danger'),
  ];
  if (input.heatingGoal === 'main_heating') warnings.push(warning(settings, 'HEAT_LOSS_REQUIRED', 'warning'));
  if (input.wetZone) warnings.push(warning(settings, 'WET_ZONE_RCD', 'warning'));
  if (targetPowerWm2 > covering.maxPowerWm2) warnings.push(warning(settings, 'COVERING_LIMIT', 'warning'));
  if (covering.note) warnings.push({ code: 'COVERING_NOTE', severity: 'info', text: covering.note });
  if (substrate.note) warnings.push({ code: 'SUBSTRATE_NOTE', severity: 'info', text: substrate.note });
  return {
    totalAreaM2: input.totalAreaM2,
    excludedAreaM2: input.excludedAreaM2,
    heatedAreaM2: input.heatedAreaM2,
    targetPowerWm2,
    requiredPowerW,
    requiredPowerKw: round(requiredPowerW / 1000),
    suggestedSystemTypes,
    warnings,
  };
}

export function nearestAllowedStep(value: number | null, allowed: number[]) {
  if (!value || !Number.isFinite(value) || !allowed.length) return { step: null, delta: null };
  const step = [...allowed].sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0];
  return { step, delta: round(Math.abs(step - value)) };
}

export function calculateMountingTapeMeters(areaM2: number, settings: WarmFloorSettings = DEFAULT_WARM_FLOOR_SETTINGS) {
  const raw = (areaM2 / settings.mountingTape.rowSpacingM) * settings.mountingTape.wasteFactor;
  return Math.max(settings.mountingTape.minMeters, Math.ceil(raw));
}

export function calculateCableCandidate(product: WarmFloorCatalogProduct, base: WarmFloorBaseCalculation, settings: WarmFloorSettings = DEFAULT_WARM_FLOOR_SETTINGS): WarmFloorCandidate {
  const selectedPowerW = product.powerW || (product.powerKw ? product.powerKw * 1000 : 0);
  const linearPowerWm = product.linearPowerWm || (selectedPowerW && product.cableLengthM ? selectedPowerW / product.cableLengthM : null);
  const lengthRequiredM = linearPowerWm ? round(base.requiredPowerW / linearPowerWm, 2) : null;
  const selectedCableLengthM = product.cableLengthM || (selectedPowerW && linearPowerWm ? selectedPowerW / linearPowerWm : null);
  const actualPowerWm2 = base.heatedAreaM2 > 0 ? round(selectedPowerW / base.heatedAreaM2, 1) : 0;
  const spacingCm = selectedCableLengthM && base.heatedAreaM2 > 0 ? round((base.heatedAreaM2 * 100) / selectedCableLengthM, 1) : null;
  const spacingByTargetCm = linearPowerWm ? round((linearPowerWm * 100) / base.targetPowerWm2, 1) : null;
  const nearest = nearestAllowedStep(spacingCm, settings.allowedCableSpacingCm);
  const warnings: WarmFloorWarning[] = [];
  const minStep = Math.min(...settings.allowedCableSpacingCm);
  const maxStep = Math.max(...settings.allowedCableSpacingCm);
  if (!spacingCm || spacingCm < minStep || spacingCm > maxStep) warnings.push(warning(settings, 'STEP_OUT_OF_RANGE', 'danger'));
  const powerDistance = Math.abs(selectedPowerW - base.requiredPowerW) / Math.max(base.requiredPowerW, 1);
  const stepPenalty = nearest.delta ?? 10;
  const score = powerDistance * 100 + stepPenalty * 2;
  return {
    role: 'optimal',
    label: 'Оптимальный',
    systemType: 'heating_cable',
    product,
    calculation: {
      requiredPowerW: base.requiredPowerW,
      selectedPowerW: Math.round(selectedPowerW),
      selectedPowerKw: round(selectedPowerW / 1000),
      lengthRequiredM,
      selectedCableLengthM: selectedCableLengthM ? round(selectedCableLengthM, 2) : null,
      linearPowerWm: linearPowerWm ? round(linearPowerWm, 2) : null,
      actualPowerWm2,
      spacingCm,
      spacingByTargetCm,
      nearestAllowedSpacingCm: nearest.step,
      spacingDeltaCm: nearest.delta,
      mountingTapeM: calculateMountingTapeMeters(base.heatedAreaM2, settings),
    },
    compatible: warnings.every((item) => item.severity !== 'danger'),
    score,
    warnings,
    accessories: [],
    mountingTapeMeters: calculateMountingTapeMeters(base.heatedAreaM2, settings),
  };
}

export function calculateMatCandidate(product: WarmFloorCatalogProduct, base: WarmFloorBaseCalculation, settings: WarmFloorSettings = DEFAULT_WARM_FLOOR_SETTINGS): WarmFloorCandidate {
  const selectedPowerW = product.powerW || (product.powerKw ? product.powerKw * 1000 : 0);
  const coveredAreaM2 = product.matAreaM2 || (selectedPowerW ? selectedPowerW / base.targetPowerWm2 : 0);
  const actualPowerWm2 = coveredAreaM2 > 0 ? round(selectedPowerW / coveredAreaM2, 1) : 0;
  const coveragePercent = base.heatedAreaM2 > 0 ? round((coveredAreaM2 / base.heatedAreaM2) * 100, 1) : 0;
  const warnings: WarmFloorWarning[] = [];
  if (coveragePercent < 70) warnings.push({ code: 'MAT_UNDER_COVERAGE', severity: 'danger', text: 'Мат покрывает слишком малую часть полезной площади.' });
  else if (coveragePercent < 80) warnings.push({ code: 'MAT_UNDER_COVERAGE', severity: 'warning', text: 'Мат покрывает меньше 80% полезной площади.' });
  if (coveragePercent > 125) warnings.push({ code: 'MAT_OVER_COVERAGE', severity: 'danger', text: 'Площадь мата слишком больше полезной зоны: мат нельзя укладывать под стационарную мебель.' });
  else if (coveragePercent > 115) warnings.push({ code: 'MAT_OVER_COVERAGE', severity: 'warning', text: 'Площадь мата больше полезной зоны: мат нельзя укладывать под стационарную мебель.' });
  const powerDistance = Math.abs(selectedPowerW - base.requiredPowerW) / Math.max(base.requiredPowerW, 1);
  const coverageDistance = Math.abs(100 - coveragePercent) / 10;
  return {
    role: 'optimal',
    label: 'Оптимальный',
    systemType: 'heating_mat',
    product,
    calculation: {
      requiredPowerW: base.requiredPowerW,
      selectedPowerW: Math.round(selectedPowerW),
      coveredAreaM2: round(coveredAreaM2, 2),
      actualPowerWm2,
      coveragePercent,
    },
    compatible: warnings.every((item) => item.severity !== 'danger'),
    score: powerDistance * 100 + coverageDistance,
    warnings,
    accessories: [],
  };
}

export function applyVariantRoles(candidates: WarmFloorCandidate[]): WarmFloorCandidate[] {
  const compatible = candidates.filter((candidate) => candidate.compatible).sort((a, b) => a.score - b.score);
  const pool = compatible.length ? compatible : candidates.sort((a, b) => a.score - b.score);
  const byCheap = [...pool].sort((a, b) => Number(a.product.price || Number.MAX_SAFE_INTEGER) - Number(b.product.price || Number.MAX_SAFE_INTEGER));
  const byPower = [...pool].sort((a, b) => b.calculation.selectedPowerW - a.calculation.selectedPowerW);
  const picks: WarmFloorCandidate[] = [];
  const push = (candidate: WarmFloorCandidate | undefined, role: WarmFloorCandidate['role'], label: string) => {
    if (!candidate) return;
    const existing = picks.find((item) => item.product.id === candidate.product.id && item.systemType === candidate.systemType);
    if (existing) return;
    picks.push({ ...candidate, role, label });
  };
  push(pool[0], 'optimal', 'Оптимальный');
  push(byCheap[0], 'economy', 'Экономичный');
  push(byPower[0], 'boosted', 'Усиленный');
  for (const candidate of pool) {
    if (picks.length >= 3) break;
    push(candidate, picks.length === 1 ? 'economy' : 'boosted', picks.length === 1 ? 'Экономичный' : 'Усиленный');
  }
  return picks.slice(0, 3);
}
