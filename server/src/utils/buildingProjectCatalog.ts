/**
 * Shared catalogs for Building Project Phase 1.
 * Region/insulation are structured codes only — no invented climate or U-value coefficients.
 */

export type ObjectType = 'apartment' | 'private_house' | 'commercial';
export type InsulationLevel = 'good' | 'medium' | 'poor' | 'unknown';
export type WindowGlazingType = 'standard' | 'large' | 'panoramic' | 'stained';
export type FloorPosition = 'ground' | 'intermediate' | 'top' | 'basement' | 'unknown';

export interface CatalogOption<T extends string = string> {
  value: T;
  label: string;
}

export interface RoomTypeOption extends CatalogOption {
  group: 'living' | 'common' | 'wet' | 'extra' | 'commercial';
}

export const OBJECT_TYPES: CatalogOption<ObjectType>[] = [
  { value: 'apartment', label: 'Квартира' },
  { value: 'private_house', label: 'Собственный дом' },
  { value: 'commercial', label: 'Коммерческое помещение' },
];

/** Armenian admin regions as location codes. No climate table attached. */
export const REGIONS: CatalogOption[] = [
  { value: 'AM-ER', label: 'Ереван' },
  { value: 'AM-AR', label: 'Арарат' },
  { value: 'AM-AV', label: 'Армавир' },
  { value: 'AM-AG', label: 'Арагацотн' },
  { value: 'AM-GR', label: 'Гегаркуник' },
  { value: 'AM-KT', label: 'Котайк' },
  { value: 'AM-LO', label: 'Лори' },
  { value: 'AM-SH', label: 'Ширак' },
  { value: 'AM-SU', label: 'Сюник' },
  { value: 'AM-TV', label: 'Тавуш' },
  { value: 'AM-VD', label: 'Вайоц Дзор' },
  { value: 'AM-other', label: 'Другой / не указан' },
];

export const INSULATION_LEVELS: CatalogOption<InsulationLevel>[] = [
  { value: 'good', label: 'Хорошая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'poor', label: 'Слабая' },
  { value: 'unknown', label: 'Неизвестно' },
];

export const WINDOW_TYPES: CatalogOption<WindowGlazingType>[] = [
  { value: 'standard', label: 'Обычные окна' },
  { value: 'large', label: 'Большие окна' },
  { value: 'panoramic', label: 'Панорамные окна' },
  { value: 'stained', label: 'Витражное остекление' },
];

export const FLOOR_POSITIONS: CatalogOption<FloorPosition>[] = [
  { value: 'unknown', label: 'Не указан' },
  { value: 'ground', label: 'Первый этаж' },
  { value: 'intermediate', label: 'Промежуточный этаж' },
  { value: 'top', label: 'Последний этаж' },
  { value: 'basement', label: 'Подвал' },
];

export const ROOM_CONDITIONS: CatalogOption[] = [
  { value: 'corner_room', label: 'Угловая комната' },
  { value: 'above_unheated', label: 'Над неотапливаемым помещением' },
  { value: 'above_basement', label: 'Над подвалом' },
  { value: 'ground_floor', label: 'Первый этаж' },
  { value: 'top_floor', label: 'Последний этаж' },
  { value: 'high_humidity', label: 'Повышенная влажность' },
  { value: 'high_heat_loss', label: 'Большие теплопотери' },
  { value: 'frequent_doors', label: 'Часто открывающиеся двери' },
  { value: 'entrance_zone', label: 'Входная зона' },
  { value: 'other', label: 'Другое' },
];

export const ROOM_TYPES: RoomTypeOption[] = [
  { value: 'bedroom', label: 'Спальня', group: 'living' },
  { value: 'child_room', label: 'Детская', group: 'living' },
  { value: 'living_room', label: 'Гостиная', group: 'living' },
  { value: 'office', label: 'Кабинет', group: 'living' },
  { value: 'guest_room', label: 'Гостевая комната', group: 'living' },
  { value: 'dressing_room', label: 'Гардеробная', group: 'living' },
  { value: 'kitchen', label: 'Кухня', group: 'common' },
  { value: 'kitchen_living', label: 'Кухня-гостиная', group: 'common' },
  { value: 'corridor', label: 'Коридор', group: 'common' },
  { value: 'hallway', label: 'Прихожая', group: 'common' },
  { value: 'hall', label: 'Холл', group: 'common' },
  { value: 'stairwell', label: 'Лестничная зона', group: 'common' },
  { value: 'bathroom', label: 'Ванная', group: 'wet' },
  { value: 'shower', label: 'Душевая', group: 'wet' },
  { value: 'wc', label: 'Санузел', group: 'wet' },
  { value: 'laundry', label: 'Прачечная', group: 'wet' },
  { value: 'balcony', label: 'Балкон', group: 'extra' },
  { value: 'loggia', label: 'Лоджия', group: 'extra' },
  { value: 'terrace', label: 'Терраса', group: 'extra' },
  { value: 'basement', label: 'Подвал', group: 'extra' },
  { value: 'garage', label: 'Гараж', group: 'extra' },
  { value: 'storage', label: 'Кладовая', group: 'extra' },
  { value: 'technical', label: 'Техническое помещение', group: 'extra' },
  { value: 'boiler_room', label: 'Котельная', group: 'extra' },
  { value: 'commercial_office', label: 'Офис', group: 'commercial' },
  { value: 'sales_floor', label: 'Торговый зал', group: 'commercial' },
  { value: 'warehouse', label: 'Склад', group: 'commercial' },
  { value: 'server_room', label: 'Серверная', group: 'commercial' },
  { value: 'restaurant', label: 'Ресторан / кафе', group: 'commercial' },
  { value: 'workshop', label: 'Производственное помещение', group: 'commercial' },
  { value: 'meeting_room', label: 'Переговорная', group: 'commercial' },
  { value: 'reception', label: 'Ресепшен', group: 'commercial' },
  { value: 'other', label: 'Другое', group: 'extra' },
];

export const WET_ROOM_TYPES = new Set(['bathroom', 'shower', 'wc', 'laundry']);

export function roomTypeLabel(type: string): string {
  return ROOM_TYPES.find((t) => t.value === type)?.label || type;
}

export function regionLabel(code: string | null | undefined): string {
  if (!code) return '';
  return REGIONS.find((r) => r.value === code)?.label || code;
}

export function objectTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return OBJECT_TYPES.find((t) => t.value === type)?.label || type;
}

export function insulationLabel(level: string | null | undefined): string {
  if (!level) return '';
  return INSULATION_LEVELS.find((t) => t.value === level)?.label || level;
}

export function suggestRoomName(roomType: string, existing: Array<{ roomType?: string; name?: string }>): string {
  const base = roomTypeLabel(roomType);
  const same = existing.filter((r) => r.roomType === roomType);
  if (same.length === 0) return `${base} 1`;
  const used = new Set<number>();
  for (const r of same) {
    const n = String(r.name || '').trim();
    if (n === base) {
      used.add(1);
      continue;
    }
    if (n.startsWith(`${base} `)) {
      const tail = n.slice(base.length + 1).trim();
      const num = Number(tail);
      if (Number.isFinite(num) && num > 0) used.add(num);
    }
  }
  let i = 1;
  while (used.has(i)) i += 1;
  return `${base} ${i}`;
}

export function defaultProjectName(objectType: ObjectType, regionCode?: string | null): string {
  const kind = objectTypeLabel(objectType);
  const region = regionLabel(regionCode || '');
  return region ? `${kind} — ${region}` : kind;
}

export function getBuildingProjectCatalog() {
  return {
    objectTypes: OBJECT_TYPES,
    regions: REGIONS,
    insulationLevels: INSULATION_LEVELS,
    windowTypes: WINDOW_TYPES,
    floorPositions: FLOOR_POSITIONS,
    roomConditions: ROOM_CONDITIONS,
    roomTypes: ROOM_TYPES,
    // Phase 2.6 topology options (facts only, no coefficients).
    basementTypes: [
      { value: 'none', label: 'Нет подвала' },
      { value: 'heated', label: 'Отапливаемый подвал/цоколь' },
      { value: 'unheated', label: 'Неотапливаемый подвал/цоколь' },
    ],
    topBoundaryTypes: [
      { value: 'direct_roof', label: 'Непосредственно кровля' },
      { value: 'unheated_attic', label: 'Неотапливаемый чердак' },
    ],
    plantLocationKinds: [
      { value: 'not_defined', label: 'Не определено' },
      { value: 'floor', label: 'На этаже' },
      { value: 'room', label: 'В помещении' },
      { value: 'external', label: 'Снаружи' },
    ],
    notes: {
      climateData: 'none',
      insulationCoefficients: 'none',
      extrasEngineeringUse: 'stored_only_until_model_exists',
      heatLossMode: 'LIMITED',
    },
  };
}
