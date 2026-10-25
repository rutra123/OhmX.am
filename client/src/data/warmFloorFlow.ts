export type WarmFloorRoomPurpose = 'bathroom' | 'kitchen' | 'living_room' | 'bedroom' | 'balcony' | 'corridor' | 'local_zone' | 'other';
export type WarmFloorHeatingGoal = 'comfort_floor' | 'additional_heating' | 'main_heating' | 'local_zone';
export type WarmFloorExcludedZoneType = 'bath' | 'wardrobe' | 'appliance' | 'kitchen_set' | 'furniture_no_gap' | 'other';
export type WarmFloorSubstrateType = 'concrete_screed' | 'tile_adhesive' | 'old_tile' | 'wood' | 'insulation_board' | 'other';
export type WarmFloorCovering = 'tile' | 'porcelain' | 'stone' | 'laminate' | 'vinyl' | 'engineered_wood' | 'other';
export type WarmFloorTargetPowerMode = 'preset' | 'custom';
export type WarmFloorSystemPreference = 'auto' | 'mat' | 'cable';

export type WarmFloorExcludedZone = {
  type: WarmFloorExcludedZoneType;
  label: string;
  areaM2: string;
};

export type WarmFloorSelections = {
  roomPurpose: WarmFloorRoomPurpose | '';
  heatingGoal: WarmFloorHeatingGoal | '';
  totalAreaM2: string;
  excludedZones: WarmFloorExcludedZone[];
  heatedAreaM2: string;
  substrateType: WarmFloorSubstrateType | '';
  floorCovering: WarmFloorCovering | '';
  wetZone: boolean | null;
  targetPowerMode: WarmFloorTargetPowerMode;
  customTargetPowerWm2: string;
  systemPreference: WarmFloorSystemPreference;
};

export type WarmFloorWizardStepId = 'room' | 'goal' | 'area' | 'exclusions' | 'heatedArea' | 'substrate' | 'covering' | 'wetZone' | 'power' | 'system' | 'result';

export type WarmFloorProduct = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article?: string;
  price?: number | null;
  currency?: string;
  image?: string;
  availabilityStatus: 'in_stock' | 'low_stock' | 'preorder' | 'unavailable';
  availabilityLabel: string;
  productType: string;
  powerW?: number | null;
  powerKw?: number | null;
  linearPowerWm?: number | null;
  cableLengthM?: number | null;
  matAreaM2?: number | null;
  voltageV?: number | null;
};

export type WarmFloorWarning = { code: string; severity: 'info' | 'warning' | 'danger'; text: string };

export type WarmFloorCandidate = {
  role: 'optimal' | 'economy' | 'boosted';
  label: string;
  systemType: 'heating_cable' | 'heating_mat';
  product: WarmFloorProduct;
  calculation: any;
  compatible: boolean;
  score: number;
  warnings: WarmFloorWarning[];
  accessories: WarmFloorProduct[];
  mountingTapeMeters?: number;
};

export type WarmFloorRecommendation = {
  input: any;
  calculation: {
    totalAreaM2: number;
    excludedAreaM2: number;
    heatedAreaM2: number;
    targetPowerWm2: number;
    requiredPowerW: number;
    requiredPowerKw: number;
    suggestedSystemTypes: Array<'heating_mat' | 'heating_cable'>;
    warnings: WarmFloorWarning[];
  };
  suggestedSystemTypes: Array<'heating_mat' | 'heating_cable'>;
  variants: WarmFloorCandidate[];
  accessories: WarmFloorProduct[];
  warnings: WarmFloorWarning[];
};

export type WarmFloorWizardState = {
  step: WarmFloorWizardStepId;
  selections: WarmFloorSelections;
  result: WarmFloorRecommendation | null;
  lastUpdated: string;
};

export const WARM_FLOOR_STATE_KEY = 'ohmx:warm-floor-wizard:v2';

export const WARM_FLOOR_STEPS: Array<{ id: WarmFloorWizardStepId; title: string }> = [
  { id: 'room', title: 'Назначение помещения' },
  { id: 'goal', title: 'Цель отопления' },
  { id: 'area', title: 'Общая площадь' },
  { id: 'exclusions', title: 'Исключаемые зоны' },
  { id: 'heatedArea', title: 'Обогреваемая площадь' },
  { id: 'substrate', title: 'Тип основания' },
  { id: 'covering', title: 'Финишное покрытие' },
  { id: 'wetZone', title: 'Влажная зона' },
  { id: 'power', title: 'Мощность Вт/м²' },
  { id: 'system', title: 'Тип системы' },
  { id: 'result', title: 'Результат' },
];

export const roomOptions: Array<{ id: WarmFloorRoomPurpose; label: string; subtitle?: string }> = [
  { id: 'bathroom', label: 'Ванная', subtitle: 'Высокая влажность, нужен датчик и защита.' },
  { id: 'kitchen', label: 'Кухня', subtitle: 'Исключаем гарнитур и технику.' },
  { id: 'living_room', label: 'Гостиная / комната' },
  { id: 'bedroom', label: 'Спальня' },
  { id: 'balcony', label: 'Балкон / лоджия', subtitle: 'Обычно нужен повышенный Вт/м².' },
  { id: 'corridor', label: 'Коридор / прихожая' },
  { id: 'local_zone', label: 'Локальная зона' },
  { id: 'other', label: 'Другое' },
];

export const goalOptions: Array<{ id: WarmFloorHeatingGoal; label: string; subtitle?: string }> = [
  { id: 'comfort_floor', label: 'Комфортный пол', subtitle: 'Чтобы плитка не была холодной.' },
  { id: 'additional_heating', label: 'Дополнительное отопление', subtitle: 'Помогает основной системе.' },
  { id: 'main_heating', label: 'Основное отопление', subtitle: 'Покажем предупреждение о расчёте теплопотерь.' },
  { id: 'local_zone', label: 'Локальная зона', subtitle: 'Например, у рабочего места или зеркала.' },
];

export const exclusionOptions: Array<{ id: WarmFloorExcludedZoneType; label: string }> = [
  { id: 'bath', label: 'Ванна / душевая' },
  { id: 'wardrobe', label: 'Шкаф' },
  { id: 'appliance', label: 'Техника' },
  { id: 'kitchen_set', label: 'Кухонный гарнитур' },
  { id: 'furniture_no_gap', label: 'Мебель без зазора' },
  { id: 'other', label: 'Другая зона' },
];

export const substrateOptions: Array<{ id: WarmFloorSubstrateType; label: string; subtitle?: string }> = [
  { id: 'concrete_screed', label: 'Стяжка / бетон' },
  { id: 'tile_adhesive', label: 'Только плиточный клей', subtitle: 'Чаще подходит мат.' },
  { id: 'old_tile', label: 'Старая плитка' },
  { id: 'wood', label: 'Деревянное основание', subtitle: 'Нужно отдельное проектное решение.' },
  { id: 'insulation_board', label: 'Теплоизоляционная плита' },
  { id: 'other', label: 'Другое' },
];

export const coveringOptions: Array<{ id: WarmFloorCovering; label: string; subtitle?: string }> = [
  { id: 'tile', label: 'Плитка' },
  { id: 'porcelain', label: 'Керамогранит' },
  { id: 'stone', label: 'Камень' },
  { id: 'laminate', label: 'Ламинат', subtitle: 'Нужен лимит температуры.' },
  { id: 'vinyl', label: 'Винил / LVT' },
  { id: 'engineered_wood', label: 'Инженерная доска' },
  { id: 'other', label: 'Другое покрытие' },
];

export function defaultWarmFloorSelections(): WarmFloorSelections {
  return {
    roomPurpose: '',
    heatingGoal: '',
    totalAreaM2: '',
    excludedZones: [],
    heatedAreaM2: '',
    substrateType: '',
    floorCovering: '',
    wetZone: null,
    targetPowerMode: 'preset',
    customTargetPowerWm2: '',
    systemPreference: 'auto',
  };
}

export function parseArea(value: string) {
  const number = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function excludedArea(selections: Pick<WarmFloorSelections, 'excludedZones'>) {
  return Math.round(selections.excludedZones.reduce((sum, zone) => sum + parseArea(zone.areaM2), 0) * 100) / 100;
}

export function computedHeatedArea(selections: Pick<WarmFloorSelections, 'totalAreaM2' | 'excludedZones' | 'heatedAreaM2'>) {
  const explicit = parseArea(selections.heatedAreaM2);
  if (explicit > 0) return explicit;
  return Math.max(0, Math.round((parseArea(selections.totalAreaM2) - excludedArea(selections)) * 100) / 100);
}

export function warmFloorPayload(selections: WarmFloorSelections) {
  return {
    ...selections,
    totalAreaM2: parseArea(selections.totalAreaM2),
    excludedZones: selections.excludedZones.map((zone) => ({ ...zone, areaM2: parseArea(zone.areaM2) })).filter((zone) => zone.areaM2 > 0),
    heatedAreaM2: computedHeatedArea(selections),
    customTargetPowerWm2: selections.targetPowerMode === 'custom' ? parseArea(selections.customTargetPowerWm2) : null,
  };
}

export function isWarmFloorComplete(selections: WarmFloorSelections) {
  const payload = warmFloorPayload(selections);
  return Boolean(
    selections.roomPurpose
    && selections.heatingGoal
    && payload.totalAreaM2 > 0
    && payload.heatedAreaM2 > 0
    && payload.heatedAreaM2 <= payload.totalAreaM2
    && selections.substrateType
    && selections.floorCovering
    && selections.wetZone !== null
    && (selections.targetPowerMode === 'preset' || Number(payload.customTargetPowerWm2 || 0) > 0)
    && selections.systemPreference
  );
}

export function safeWarmFloorState(value: unknown): WarmFloorWizardState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WarmFloorWizardState>;
  return {
    step: candidate.step || 'room',
    selections: { ...defaultWarmFloorSelections(), ...(candidate.selections || {}) },
    result: candidate.result || null,
    lastUpdated: candidate.lastUpdated || new Date().toISOString(),
  };
}

export function buildWarmFloorSummary(selections: WarmFloorSelections): string[] {
  return [
    `Общая площадь: ${parseArea(selections.totalAreaM2) || '—'} м²`,
    `Исключено: ${excludedArea(selections) || 0} м²`,
    `Обогреваемая площадь: ${computedHeatedArea(selections) || '—'} м²`,
    `Мощность: ${selections.targetPowerMode === 'custom' ? `${parseArea(selections.customTargetPowerWm2)} Вт/м²` : 'авто-пресет'}`,
  ];
}
