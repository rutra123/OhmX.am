/**
 * Building Project Phase 2 systems catalog and draft helpers.
 * Keeps source vs terminal distinctions explicit while staying permissive.
 */

import { ROOM_TYPES, WET_ROOM_TYPES, roomTypeLabel } from './buildingProjectCatalog.js';
import { computeHydronicSystemRequirements, TOWEL_RADIATOR_ROOM_PURPOSES } from './buildingProjectHydronics.js';
import {
  BuildingSystemsValidationError,
  confirmErrorForBlocker,
  engineeringFingerprint,
  registerSystemsFamilyApi,
  suggestionFamilyIdsForPreview,
  validateSystemsConfigurationForConfirmation,
} from './buildingProjectValidation.js';
import type {
  BuildingDistribution,
  BuildingDistributionId,
  BuildingProject,
  BuildingRoom,
  BuildingSourceSelection,
  BuildingSystemArchitecture,
  BuildingSystemArchitectureInput,
  BuildingSystemService,
  EngineeringRoomAssignment,
  EngineeringRoomSystemSelection,
  EngineeringSystemConfiguration,
  EngineeringSystemConfigurationInput,
  EngineeringSystemFamily,
  EngineeringSystemFamilySelection,
  ServicePreference,
  ServicePreferenceSource,
  SystemCapabilityStatus,
  SystemsBulkTarget,
  SystemsConfigurationStatus,
  SystemsNormalizeMode,
} from './buildingProjectTypes.js';

export type { SystemsNormalizeMode };
export {
  BuildingSystemsValidationError,
  engineeringFingerprint,
  suggestionFamilyIdsForPreview,
  validateSystemsConfigurationForConfirmation,
};

export type BuildingSystemRequestChoice = 'heating' | 'cooling' | 'heating_and_cooling';

export interface BuildingSystemsCatalog {
  serviceOptions: Array<{ value: BuildingSystemRequestChoice; label: string; description: string }>;
  capabilityStates: Array<{ value: SystemCapabilityStatus; label: string }>;
  systemFamilies: EngineeringSystemFamily[];
  groups: Array<{
    id: string;
    label: string;
    service: BuildingSystemService | 'heating_and_cooling';
    kind: EngineeringSystemFamily['kind'] | 'mixed';
    familyIds: string[];
    description: string;
  }>;
  roomPurposeGuidance: Array<{
    roomType: string;
    label: string;
    defaultHeating: ServicePreference;
    defaultCooling: ServicePreference;
  }>;
  dhw: { available: boolean; status: 'not_configured'; label: string; description: string };
}

const CAPABILITY_LABELS: Record<SystemCapabilityStatus, string> = {
  allowed: 'Поддерживается',
  allowed_with_warning: 'Поддерживается с предупреждением',
  unsupported: 'Не поддерживается',
  not_yet_verified: 'Расчёт в разработке',
};

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next || out.includes(next)) continue;
    out.push(next);
  }
  return out;
}

function toServicePreference(value: unknown, fallback: ServicePreference): ServicePreference {
  const raw = String(value || '').trim();
  if (raw === 'required' || raw === 'optional' || raw === 'not_required') return raw;
  return fallback;
}

export const NO_AUTO_HVAC_ROOM_TYPES = new Set([
  'balcony',
  'loggia',
  'terrace',
  'storage',
  'garage',
  'boiler_room',
  'technical',
  'basement',
]);

function defaultPreferenceForRoom(roomType: string, service: 'heating' | 'cooling'): ServicePreference {
  if (NO_AUTO_HVAC_ROOM_TYPES.has(roomType)) return 'not_required';
  if (roomType === 'server_room') return service === 'cooling' ? 'required' : 'optional';
  if (WET_ROOM_TYPES.has(roomType)) return service === 'heating' ? 'required' : 'not_required';
  return 'optional';
}

export function defaultRoomServicePreference(roomType: string, service: 'heating' | 'cooling'): ServicePreference {
  return defaultPreferenceForRoom(roomType, service);
}

function buildFamily(input: EngineeringSystemFamily): EngineeringSystemFamily {
  return {
    ...input,
    notes: [...(input.notes || [])],
  };
}

export const SYSTEM_FAMILIES: EngineeringSystemFamily[] = [
  buildFamily({
    id: 'gas_boiler',
    label: 'Газовый котёл',
    service: 'heating',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Центральный источник тепла для водяного контура.', 'Терминалы подбираются отдельно.'],
  }),
  buildFamily({
    id: 'gas_condensing_boiler',
    label: 'Конденсационный газовый котёл',
    service: 'heating',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Центральный источник тепла для водяного контура.', 'Подходит для водяных терминалов и комбинированных схем.'],
  }),
  buildFamily({
    id: 'electric_boiler',
    label: 'Электрический котёл',
    service: 'heating',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Центральный источник для водяной системы.', 'Нужны терминалы отопления.'],
  }),
  buildFamily({
    id: 'heat_pump_air_to_water',
    label: 'Тепловой насос воздух–вода',
    service: 'heating',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Центральный источник для водяной системы.', 'Для полной схемы нужны терминалы и дальнейшая инженерная проверка.'],
  }),
  buildFamily({
    id: 'reversible_air_to_water_heat_pump',
    label: 'Реверсивный тепловой насос воздух–вода',
    service: 'heating_and_cooling',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: [
      'Один центральный источник отопления и охлаждения.',
      'Работает через водяной контур. Модель и мощность выбираются позже.',
    ],
  }),
  buildFamily({
    id: 'electric_convector',
    label: 'Электрический конвектор',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Комнатный локальный прибор.', 'Подходит для быстрого электрического отопления.'],
  }),
  buildFamily({
    id: 'heating_cable',
    label: 'Нагревательный кабель',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Электрический тёплый пол на кабеле.', 'Комнатный локальный терминал отопления.'],
  }),
  buildFamily({
    id: 'heating_mat',
    label: 'Нагревательный мат',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Электрический тёплый пол на мате.', 'Комнатный локальный терминал отопления.'],
  }),
  buildFamily({
    id: 'electric_underfloor_heating',
    label: 'Электрический тёплый пол',
    service: 'heating',
    kind: 'solution_template',
    scope: 'room_local',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Универсальная электрическая схема локального отопления.', 'Нагревательный кабель или мат подбираются дальше.'],
  }),
  buildFamily({
    id: 'hydronic_floor_heating',
    label: 'Водяной тёплый пол',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Терминал водяной системы отопления.', 'Подходит как один из нескольких терминалов комнаты.'],
  }),
  buildFamily({
    id: 'aluminum_radiators',
    label: 'Алюминиевые радиаторы',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Комнатный терминал водяного отопления.', 'Допустим как самостоятельный или дополнительный источник тепла.'],
  }),
  buildFamily({
    id: 'bimetal_radiators',
    label: 'Биметаллические радиаторы',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Комнатный терминал водяного отопления.', 'Подходит для комбинаций с тёплым полом.'],
  }),
  buildFamily({
    id: 'steel_panel_radiators',
    label: 'Стальные панельные радиаторы',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Комнатный терминал водяного отопления.', 'Хорошо работает в комнатных схемах.'],
  }),
  buildFamily({
    id: 'fan_coils',
    label: 'Фанкойлы',
    service: 'heating_and_cooling',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Подходит для водяного отопления и охлаждения.', 'Требует дальнейшей инженерной проверки по объекту.'],
  }),
  buildFamily({
    id: 'infloor_convectors',
    label: 'Внутрипольные конвекторы',
    service: 'heating',
    kind: 'terminal',
    scope: 'room_local',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Комнатный терминал отопления.', 'Обычно используется как дополнительный или архитектурный элемент.'],
  }),
  buildFamily({
    id: 'heat_pump_air_to_air',
    label: 'Тепловой насос воздух–воздух',
    service: 'heating_and_cooling',
    kind: 'combined',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема отопления и охлаждения.', 'Расчёт и инженерная проверка в разработке.'],
  }),
  buildFamily({
    id: 'split_wall',
    label: 'Настенный split',
    service: 'cooling',
    kind: 'combined',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Direct expansion система для одной комнаты.', 'Подходит как локальное охлаждение.'],
  }),
  buildFamily({
    id: 'multi_split',
    label: 'Multi-split',
    service: 'cooling',
    kind: 'combined',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Direct expansion система с одним наружным блоком.', 'Обслуживает несколько комнат.'],
  }),
  buildFamily({
    id: 'cassette_ac',
    label: 'Кассетный кондиционер',
    service: 'cooling',
    kind: 'combined',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Direct expansion система для помещений с потолочным пространством.', 'Хороша для коммерческих и больших комнат.'],
  }),
  buildFamily({
    id: 'ducted_ac',
    label: 'Канальный кондиционер',
    service: 'cooling',
    kind: 'combined',
    scope: 'central',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Direct expansion система с распределением по каналам.', 'Требует дальнейшей инженерной проверки.'],
  }),
  buildFamily({
    id: 'floor_ceiling_ac',
    label: 'Напольно-потолочный кондиционер',
    service: 'cooling',
    kind: 'combined',
    scope: 'room_local',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    notes: ['Direct expansion система для гибкой установки в комнате.', 'Подходит для локального охлаждения.'],
  }),
  buildFamily({
    id: 'column_ac',
    label: 'Колонный кондиционер',
    service: 'cooling',
    kind: 'combined',
    scope: 'room_local',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Direct expansion система для высоких теплопритоков.', 'Требует проверки по помещению.'],
  }),
  buildFamily({
    id: 'vrf_vrv',
    label: 'VRF / VRV',
    service: 'cooling',
    kind: 'combined',
    scope: 'central',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Многозональная Direct Expansion система.', 'Требует инженерной проверки и дальнейшего расчёта.'],
  }),
  buildFamily({
    id: 'chiller_fan_coils',
    label: 'Чиллер + фанкойлы',
    service: 'cooling',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed_with_warning',
    statusLabel: CAPABILITY_LABELS.allowed_with_warning,
    notes: ['Hydronic схема охлаждения с центральным источником.', 'Фанкойлы назначаются по комнатам отдельно.'],
  }),
  buildFamily({
    id: 'external_building_heating_supply',
    label: 'Центральное отопление здания',
    service: 'heating',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    external: true,
    notes: [
      'Источник тепла — центральная система здания (вне квартиры).',
      'Оборудование источника не подбирается OhmX; подбираются квартирные терминалы и гидравлика.',
    ],
  }),
  buildFamily({
    id: 'external_building_cooling_supply',
    label: 'Центральное охлаждение здания',
    service: 'cooling',
    kind: 'source',
    scope: 'central',
    capabilityStatus: 'allowed',
    statusLabel: CAPABILITY_LABELS.allowed,
    external: true,
    notes: [
      'Источник холода — центральная система здания (вне квартиры).',
      'Оборудование источника не подбирается OhmX; подбираются квартирные терминалы и гидравлика.',
    ],
  }),
  buildFamily({
    id: 'heat_pump_air_to_water_fan_coils',
    label: 'Тепловой насос воздух–вода + фанкойлы',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированное водяное отопление/охлаждение.', 'Фанкойлы и центральный источник проверяются дальше.'],
  }),
  buildFamily({
    id: 'gas_boiler_split_multi_split',
    label: 'Газовый котёл + split/multi-split',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема отопления и кондиционирования.', 'Техническая совместимость проверяется позже.'],
  }),
  buildFamily({
    id: 'gas_boiler_vrf',
    label: 'Газовый котёл + VRF',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема отопления и VRF охлаждения.', 'Техническая совместимость проверяется позже.'],
  }),
  buildFamily({
    id: 'radiators_plus_ac',
    label: 'Радиаторы + кондиционеры',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема отопления и охлаждения.', 'Нагрузки и количество аппаратов будут считаться в следующих фазах.'],
  }),
  buildFamily({
    id: 'hydronic_floor_heating_plus_ac',
    label: 'Водяной тёплый пол + кондиционеры',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема с тёплым полом и охлаждением.', 'Совместимость и нагрузка считаются позже.'],
  }),
  buildFamily({
    id: 'hydronic_floor_heating_plus_fan_coils',
    label: 'Тёплый пол + фанкойлы',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная водяная схема отопления/охлаждения.', 'Расчёт и совместимость в следующей фазе.'],
  }),
  buildFamily({
    id: 'electric_heating_plus_cooling',
    label: 'Электрическое отопление + кондиционирование',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Комбинированная схема с электрическим отоплением.', 'Нагрузка и оборудование считаются позже.'],
  }),
  buildFamily({
    id: 'individual_combined_scheme',
    label: 'Индивидуальная комбинированная схема',
    service: 'heating_and_cooling',
    kind: 'solution_template',
    scope: 'hybrid',
    capabilityStatus: 'not_yet_verified',
    statusLabel: CAPABILITY_LABELS.not_yet_verified,
    notes: ['Свободная схема, которую позже уточнит инженер.', 'Здесь фиксируется только намерение пользователя.'],
  }),
];

export const SYSTEM_GROUPS = [
  {
    id: 'heating_sources',
    label: 'Источники тепла',
    service: 'heating' as const,
    kind: 'source' as const,
    familyIds: ['gas_boiler', 'gas_condensing_boiler', 'electric_boiler', 'heat_pump_air_to_water', 'reversible_air_to_water_heat_pump', 'external_building_heating_supply'],
    description: 'Центральные источники тепла для водяных и комбинированных схем. Внешняя система здания — без подбора оборудования источника.',
  },
  {
    id: 'heating_terminals',
    label: 'Способы распределения тепла',
    service: 'heating' as const,
    kind: 'terminal' as const,
    familyIds: ['electric_convector', 'heating_cable', 'heating_mat', 'electric_underfloor_heating', 'hydronic_floor_heating', 'aluminum_radiators', 'bimetal_radiators', 'steel_panel_radiators', 'fan_coils', 'infloor_convectors'],
    description: 'Комнатные терминалы отопления и локальные электрические решения.',
  },
  {
    id: 'cooling_direct_expansion',
    label: 'Direct Expansion',
    service: 'cooling' as const,
    kind: 'combined' as const,
    familyIds: ['split_wall', 'multi_split', 'cassette_ac', 'ducted_ac', 'floor_ceiling_ac', 'column_ac', 'vrf_vrv', 'heat_pump_air_to_air'],
    description: 'Готовые системы охлаждения и отопления/охлаждения air-to-air.',
  },
  {
    id: 'cooling_hydronic',
    label: 'Hydronic',
    service: 'cooling' as const,
    kind: 'source' as const,
    familyIds: ['chiller_fan_coils', 'heat_pump_air_to_water_fan_coils', 'fan_coils', 'external_building_cooling_supply'],
    description: 'Центральные водяные схемы охлаждения, внешняя система здания и терминалы fan coils.',
  },
  {
    id: 'combined_solutions',
    label: 'Отопление + охлаждение',
    service: 'heating_and_cooling' as const,
    kind: 'mixed' as const,
    familyIds: ['heat_pump_air_to_air', 'reversible_air_to_water_heat_pump', 'heat_pump_air_to_water_fan_coils', 'gas_boiler_split_multi_split', 'gas_boiler_vrf', 'radiators_plus_ac', 'hydronic_floor_heating_plus_ac', 'hydronic_floor_heating_plus_fan_coils', 'electric_heating_plus_cooling', 'individual_combined_scheme'],
    description: 'Комбинированные решения для одновременного отопления и охлаждения.',
  },
];

function familyById(id: string): EngineeringSystemFamily | null {
  return SYSTEM_FAMILIES.find((family) => family.id === id) || null;
}

/**
 * Phase 2.7 — apartment external (central) building supply family ids.
 * The source EXISTS but is OUTSIDE the project (building plant); OhmX selects
 * only apartment-side terminals/hydraulics, never the source equipment.
 */
export const EXTERNAL_BUILDING_HEATING_SUPPLY_ID = 'external_building_heating_supply';
export const EXTERNAL_BUILDING_COOLING_SUPPLY_ID = 'external_building_cooling_supply';
export const EXTERNAL_BUILDING_SUPPLY_IDS = [EXTERNAL_BUILDING_HEATING_SUPPLY_ID, EXTERNAL_BUILDING_COOLING_SUPPLY_ID] as const;

/** True when the family represents an external building (central) supply. */
export function isExternalBuildingSupplyFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return Boolean(family && (EXTERNAL_BUILDING_SUPPLY_IDS as readonly string[]).includes(family.id));
}

/**
 * Project-wide shared source semantics: a source/combined family that is NOT
 * room-local equipment. Room-local systems stay in room assignments and never
 * define the project-wide architecture by themselves.
 */
export function isProjectSharedSourceFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return Boolean(family && (family.kind === 'source' || family.kind === 'combined') && family.scope !== 'room_local');
}

/** Room-local system semantics: per-room equipment (terminals and room-local DX). */
export function isRoomLocalSystemFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return Boolean(family && family.scope === 'room_local');
}

/** Set of services a family can serve (typed, not label-based). */
export function servicesSupportedByFamily(family: EngineeringSystemFamily | null | undefined): Set<'heating' | 'cooling'> {
  const out = new Set<'heating' | 'cooling'>();
  if (!family) return out;
  if (family.service === 'heating' || family.service === 'heating_and_cooling') out.add('heating');
  if (family.service === 'cooling' || family.service === 'heating_and_cooling') out.add('cooling');
  return out;
}

export function expandRequestedServices(value: unknown): Array<'heating' | 'cooling'> {
  const raw = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const result: Array<'heating' | 'cooling'> = [];
  for (const item of raw) {
    const next = String(item || '').trim();
    if (next === 'heating_and_cooling') {
      if (!result.includes('heating')) result.push('heating');
      if (!result.includes('cooling')) result.push('cooling');
      continue;
    }
    if ((next === 'heating' || next === 'cooling') && !result.includes(next)) result.push(next);
  }
  return result;
}

function normalizeRequestedServices(value: unknown, fallback: Array<'heating' | 'cooling'>): Array<'heating' | 'cooling'> {
  const result = expandRequestedServices(value);
  if (!result.length) return [...fallback];
  return result;
}

function roomMatchesBulkTarget(room: BuildingRoom, target: SystemsBulkTarget): boolean {
  if (target === 'all_rooms') return true;
  if (target === 'bedrooms') return room.roomType === 'bedroom';
  if (target === 'wet_rooms') return WET_ROOM_TYPES.has(room.roomType);
  if (target === 'living_rooms') {
    return ['bedroom', 'child_room', 'living_room', 'office', 'guest_room', 'dressing_room'].includes(room.roomType);
  }
  return false;
}

export function assignmentHasCopyableSystems(source: Partial<EngineeringRoomAssignment> | EngineeringRoomAssignment | null | undefined): boolean {
  if (!source) return false;
  const heating = Array.isArray(source.heatingSystems) && source.heatingSystems.length > 0;
  const cooling = Array.isArray(source.coolingSystems) && source.coolingSystems.length > 0;
  const sourceId = source.sourceSystemId || source.sourceSystemIds?.heating || source.sourceSystemIds?.cooling;
  return Boolean(heating || cooling || sourceId);
}

export function applyBulkRoomAssignments(
  project: BuildingProject,
  assignments: Array<Partial<EngineeringRoomAssignment> | EngineeringRoomAssignment>,
  sourceRoomId: string,
  target: SystemsBulkTarget,
  requestedServices: Array<'heating' | 'cooling'>,
): EngineeringRoomAssignment[] {
  const source = assignments.find((assignment) => String((assignment as any)?.roomId || '') === sourceRoomId) || null;
  if (!assignmentHasCopyableSystems(source)) {
    return project.rooms.map((room) => {
      const existing = assignments.find((assignment) => String((assignment as any)?.roomId || '') === room.id) || null;
      return normalizeRoomAssignment(room, requestedServices, existing);
    });
  }
  return project.rooms.map((room) => {
    const existing = assignments.find((assignment) => String((assignment as any)?.roomId || '') === room.id) || null;
    if (room.id === sourceRoomId || !roomMatchesBulkTarget(room, target)) {
      return normalizeRoomAssignment(room, requestedServices, existing);
    }
    return normalizeRoomAssignment(room, requestedServices, {
      ...source,
      roomId: room.id,
      roomName: room.name,
      roomPurpose: room.roomType,
    });
  });
}

export function countBulkTargets(project: BuildingProject, sourceRoomId: string, target: SystemsBulkTarget): number {
  return project.rooms.filter((room) => room.id !== sourceRoomId && roomMatchesBulkTarget(room, target)).length;
}

const BOILER_SOURCE_IDS = ['gas_condensing_boiler', 'gas_boiler', 'electric_boiler'];
const HEATING_ONLY_HYDRONIC_SOURCE_IDS = [...BOILER_SOURCE_IDS, 'heat_pump_air_to_water'];
const REVERSIBLE_HYDRONIC_SOURCE_ID = 'reversible_air_to_water_heat_pump';
const CENTRAL_DX_IDS = ['multi_split', 'ducted_ac', 'vrf_vrv'];
const ROOM_LOCAL_DX_IDS = ['split_wall', 'cassette_ac', 'floor_ceiling_ac', 'column_ac', 'heat_pump_air_to_air'];
const DX_COOLING_IDS = [...ROOM_LOCAL_DX_IDS, ...CENTRAL_DX_IDS];
const TWO_PIPE_WARNING = '2-трубная сеть фанкойлов работает в одном сезонном режиме: одновременный обогрев одной комнаты и охлаждение другой от одного контура не поддерживается.';
const FOUR_PIPE_NOTE = 'Отдельные контуры отопления и охлаждения позволяют одновременно обслуживать разные зоны.';

/** Canonical distribution definitions (architecture capability only — no equipment sizing). */
const DISTRIBUTIONS: Record<BuildingDistributionId, BuildingDistribution> = {
  hydronic_heating_only: {
    id: 'hydronic_heating_only',
    label: 'Водяное отопление',
    circuitKind: 'none',
    simultaneousHeatCool: false,
    notes: ['Только отопление. Охлаждение не запрошено.'],
  },
  hydronic_2pipe_heating_cooling: {
    id: 'hydronic_2pipe_heating_cooling',
    label: '2-трубная гидравлика отопления/охлаждения',
    circuitKind: '2pipe',
    simultaneousHeatCool: false,
    notes: [TWO_PIPE_WARNING],
  },
  hydronic_4pipe_heating_cooling: {
    id: 'hydronic_4pipe_heating_cooling',
    label: '4-трубная гидравлика отопления/охлаждения',
    circuitKind: '4pipe',
    simultaneousHeatCool: true,
    notes: [FOUR_PIPE_NOTE],
  },
  independent_dx: {
    id: 'independent_dx',
    label: 'Direct expansion охлаждение',
    circuitKind: 'independent',
    simultaneousHeatCool: false,
    notes: ['Комнатное или мультизональное охлаждение без общего 2-трубного контура.'],
  },
  hybrid_hydronic_plus_dx: {
    id: 'hybrid_hydronic_plus_dx',
    label: 'Водяное отопление + независимое охлаждение',
    circuitKind: 'independent',
    simultaneousHeatCool: true,
    notes: ['Источник тепла и охлаждение независимы. Одновременный режим возможен только как две разные системы.'],
  },
};

function makeDistribution(id: BuildingDistributionId): BuildingDistribution {
  const def = DISTRIBUTIONS[id];
  return { ...def, notes: [...def.notes] };
}

function defaultDhwSubsystem(): BuildingSystemArchitecture['dhw'] {
  return {
    status: 'not_configured',
    sourceFamilyId: null,
    architectureId: null,
    notes: ['ГВС настраивается отдельно и не наследует источник отопления/охлаждения.'],
  };
}

export function defaultFamilyIdsForServices(services: Array<'heating' | 'cooling'>): string[] {
  const ids: string[] = [];
  const heating = services.includes('heating');
  const cooling = services.includes('cooling');
  if (heating && cooling) ids.push(REVERSIBLE_HYDRONIC_SOURCE_ID, 'fan_coils', 'hydronic_floor_heating');
  else if (heating) ids.push('gas_condensing_boiler', 'aluminum_radiators', 'hydronic_floor_heating');
  else if (cooling) ids.push('split_wall', 'ducted_ac', 'multi_split');
  return ids.filter((id) => Boolean(familyById(id)));
}

function firstFamily(ids: string[]): EngineeringSystemFamily | null {
  for (const id of ids) {
    const family = familyById(id);
    if (family) return family;
  }
  return null;
}

function selectedIdSet(families: EngineeringSystemFamilySelection[]): Set<string> {
  return new Set(families.map((item) => item.id));
}

function makeSourceSelection(family: EngineeringSystemFamily, role: BuildingSourceSelection['role'], selectedAt: string): BuildingSourceSelection {
  return {
    familyId: family.id,
    label: family.label,
    role,
    kind: family.kind,
    scope: family.scope,
    capabilityStatus: family.capabilityStatus,
    selectedAt,
  };
}

export function buildArchitectureFromSelection(
  requestedServices: Array<'heating' | 'cooling'>,
  selectedFamilies: EngineeringSystemFamilySelection[],
  explicit?: BuildingSystemArchitectureInput | null,
): BuildingSystemArchitecture {
  const selectedAt = nowIso();
  const ids = selectedIdSet(selectedFamilies);
  const heating = requestedServices.includes('heating');
  const cooling = requestedServices.includes('cooling');
  const reversible = firstFamily([REVERSIBLE_HYDRONIC_SOURCE_ID].filter((id) => ids.has(id)));
  const boiler = firstFamily(BOILER_SOURCE_IDS.filter((id) => ids.has(id)));
  const heatingOnlyPump = firstFamily(['heat_pump_air_to_water'].filter((id) => ids.has(id)));
  const externalHeating = firstFamily([EXTERNAL_BUILDING_HEATING_SUPPLY_ID].filter((id) => ids.has(id)));
  const externalCooling = firstFamily([EXTERNAL_BUILDING_COOLING_SUPPLY_ID].filter((id) => ids.has(id)));
  const centralDx = firstFamily(CENTRAL_DX_IDS.filter((id) => ids.has(id)));
  const localDx = firstFamily(ROOM_LOCAL_DX_IDS.filter((id) => ids.has(id)));
  const chiller = firstFamily(['chiller_fan_coils'].filter((id) => ids.has(id)));

  // Phase 2.8 — shared/project sources win over room-local DX. A wall split that
  // leaked into selected families must not steal an external/chiller cooling source.
  // Explicit room-local DX may still be the cooling source when no dedicated
  // shared cooling source exists (CS-D / CS-F).
  const heat = boiler || heatingOnlyPump || reversible || externalHeating;
  const dedicatedSharedCold = chiller || externalCooling || centralDx;
  const cold = dedicatedSharedCold || localDx || reversible;

  let spaceHeatingSourceId: string | null = null;
  let spaceCoolingSourceId: string | null = null;
  let spaceCombinedSourceId: string | null = null;
  let distribution: BuildingDistribution;
  const sources: BuildingSourceSelection[] = [];
  const warnings: string[] = [];

  if (heating && cooling) {
    if (heat && cold && heat.id === cold.id) {
      // One combined hydronic source (reversible heat pump) serves both services.
      spaceCombinedSourceId = heat.id;
      spaceHeatingSourceId = heat.id;
      spaceCoolingSourceId = heat.id;
      sources.push(makeSourceSelection(heat, 'space_heating_and_cooling', selectedAt));
      distribution = makeDistribution('hydronic_2pipe_heating_cooling');
      warnings.push(TWO_PIPE_WARNING);
    } else if (heat && cold) {
      // Two independent shared sources: hydronic heating + DX cooling, or
      // central building heating + central building cooling (fan-coil network).
      spaceHeatingSourceId = heat.id;
      spaceCoolingSourceId = cold.id;
      sources.push(makeSourceSelection(heat, 'space_heating', selectedAt));
      sources.push(makeSourceSelection(cold, cold.service === 'heating_and_cooling' ? 'space_heating_and_cooling' : 'space_cooling', selectedAt));
      distribution = DX_COOLING_IDS.includes(cold.id)
        ? makeDistribution('hybrid_hydronic_plus_dx')
        : makeDistribution('hydronic_2pipe_heating_cooling');
    } else if (heat) {
      // Heating has a shared source; cooling is room-local or not yet chosen.
      spaceHeatingSourceId = heat.id;
      sources.push(makeSourceSelection(heat, 'space_heating', selectedAt));
      distribution = makeDistribution('hybrid_hydronic_plus_dx');
    } else if (cold) {
      // Cooling has a shared source; heating is room-local or not yet chosen.
      spaceCoolingSourceId = cold.id;
      sources.push(makeSourceSelection(cold, cold.service === 'heating_and_cooling' ? 'space_heating_and_cooling' : 'space_cooling', selectedAt));
      distribution = DX_COOLING_IDS.includes(cold.id)
        ? makeDistribution('independent_dx')
        : makeDistribution('hydronic_2pipe_heating_cooling');
    } else {
      distribution = makeDistribution('independent_dx');
    }
  } else if (heating) {
    const heatSource = boiler || heatingOnlyPump || reversible || externalHeating;
    spaceHeatingSourceId = heatSource?.id || null;
    if (heatSource) sources.push(makeSourceSelection(heatSource, 'space_heating', selectedAt));
    distribution = makeDistribution('hydronic_heating_only');
  } else {
    const coldSource = dedicatedSharedCold || localDx || reversible;
    spaceCoolingSourceId = coldSource?.id || null;
    if (coldSource) {
      sources.push(makeSourceSelection(coldSource, coldSource.service === 'heating_and_cooling' ? 'space_heating_and_cooling' : 'space_cooling', selectedAt));
    }
    distribution = DX_COOLING_IDS.includes(coldSource?.id || '')
      ? makeDistribution('independent_dx')
      : makeDistribution('hydronic_2pipe_heating_cooling');
  }

  const dhw = {
    status: explicit?.dhw?.status === 'draft' || explicit?.dhw?.status === 'configured' ? explicit.dhw.status : 'not_configured',
    sourceFamilyId: explicit?.dhw?.sourceFamilyId && familyById(explicit.dhw.sourceFamilyId) ? explicit.dhw.sourceFamilyId : null,
    architectureId: explicit?.dhw?.architectureId || null,
    notes: explicit?.dhw?.notes?.length ? [...explicit.dhw.notes] : defaultDhwSubsystem().notes,
  } as BuildingSystemArchitecture['dhw'];

  if (dhw.sourceFamilyId && (dhw.sourceFamilyId === spaceHeatingSourceId || dhw.sourceFamilyId === spaceCombinedSourceId) && dhw.status === 'not_configured') {
    dhw.sourceFamilyId = null;
  }

  // An explicit distribution override affects ONLY the distribution fields. It must
  // NOT silently override simultaneousHeatCoolSupported, which is ARCHITECTURE
  // CAPABILITY derived below from the actual sources + effective distribution.
  const baseDistribution = explicit?.distribution?.id
    ? makeDistribution(explicit.distribution.id)
    : distribution;
  const effectiveDistribution: BuildingDistribution = explicit?.distribution?.id
    ? {
        id: baseDistribution.id,
        label: explicit.distribution.label || baseDistribution.label,
        circuitKind: explicit.distribution.circuitKind || baseDistribution.circuitKind,
        simultaneousHeatCool: explicit.distribution.simultaneousHeatCool !== undefined
          ? Boolean(explicit.distribution.simultaneousHeatCool)
          : baseDistribution.simultaneousHeatCool,
        notes: Array.isArray(explicit.distribution.notes) ? explicit.distribution.notes : baseDistribution.notes,
      }
    : distribution;

  // simultaneousHeatCoolSupported = ARCHITECTURE CAPABILITY: can the whole
  // architecture serve heating and cooling in different zones at the same time.
  // It is NOT implied by requesting ['heating','cooling'] and NOT derived from the
  // project requirement flag (that is simultaneousHeatCoolRequired, stored elsewhere).
  // - single reversible source: capability follows the hydronic circuit (2-pipe
  //   seasonal -> false; 4-pipe -> true).
  // - independent heating + cooling sources: two subsystems can run at once -> true.
  let architectureSimultaneousHeatCool = false;
  if (heating && cooling) {
    if (spaceCombinedSourceId) {
      architectureSimultaneousHeatCool = effectiveDistribution.simultaneousHeatCool;
    } else if (spaceHeatingSourceId && spaceCoolingSourceId) {
      architectureSimultaneousHeatCool = true;
    }
  }

  return {
    spaceHeatingSourceId: explicit?.spaceHeatingSourceId && familyById(explicit.spaceHeatingSourceId) ? explicit.spaceHeatingSourceId : spaceHeatingSourceId,
    spaceCoolingSourceId: explicit?.spaceCoolingSourceId && familyById(explicit.spaceCoolingSourceId) ? explicit.spaceCoolingSourceId : spaceCoolingSourceId,
    spaceCombinedSourceId: explicit?.spaceCombinedSourceId && familyById(explicit.spaceCombinedSourceId) ? explicit.spaceCombinedSourceId : spaceCombinedSourceId,
    sources,
    distribution: effectiveDistribution,
    dhw,
    simultaneousHeatCoolSupported: architectureSimultaneousHeatCool,
    warnings: dedupeStrings([...(explicit?.warnings || []), ...warnings]),
  };
}

export function buildSuggestedSystemsConfiguration(
  project: BuildingProject,
  requestedServicesInput: unknown,
  selectedFamilyIds: string[] = [],
): EngineeringSystemConfiguration {
  const requestedServices = expandRequestedServices(requestedServicesInput);
  const selected = new Set(selectedFamilyIds.filter((id) => Boolean(familyById(id))));
  if (selected.size === 0) {
    for (const id of defaultFamilyIdsForServices(requestedServices)) selected.add(id);
  }
  const selectedAt = nowIso();
  const selectedSystemFamilies: EngineeringSystemFamilySelection[] = Array.from(selected)
    .map((id) => normalizeFamilySelection(id, selectedAt))
    .filter((item): item is EngineeringSystemFamilySelection => Boolean(item));
  const architecture = buildArchitectureFromSelection(requestedServices, selectedSystemFamilies);
  const plantId = architecture.spaceCombinedSourceId || architecture.spaceHeatingSourceId;
  const heating = requestedServices.includes('heating');
  const cooling = requestedServices.includes('cooling');
  const integratedHydronic = Boolean(heating && cooling && architecture.distribution.id === 'hydronic_2pipe_heating_cooling');

  const roomAssignments: EngineeringRoomAssignment[] = project.rooms.map((room) => {
    const heatingPref = heating ? defaultPreferenceForRoom(room.roomType, 'heating') : 'not_required';
    const coolingPref = cooling ? defaultPreferenceForRoom(room.roomType, 'cooling') : 'not_required';
    const heatingSystems: string[] = [];
    const coolingSystems: string[] = [];

    if (heatingPref === 'required' || (heatingPref === 'optional' && !NO_AUTO_HVAC_ROOM_TYPES.has(room.roomType))) {
      if (integratedHydronic) {
        if (WET_ROOM_TYPES.has(room.roomType)) heatingSystems.push('hydronic_floor_heating');
        else {
          heatingSystems.push('fan_coils');
          if (room.roomType === 'living_room') heatingSystems.push('hydronic_floor_heating');
        }
      } else if (architecture.distribution.id === 'hydronic_heating_only' || architecture.distribution.id === 'hybrid_hydronic_plus_dx') {
        if (WET_ROOM_TYPES.has(room.roomType) || room.roomType === 'living_room') heatingSystems.push('hydronic_floor_heating');
        else heatingSystems.push('aluminum_radiators');
      } else {
        heatingSystems.push('electric_convector');
      }
    }
    if (coolingPref === 'required' || (coolingPref === 'optional' && !NO_AUTO_HVAC_ROOM_TYPES.has(room.roomType))) {
      if (integratedHydronic) coolingSystems.push('fan_coils');
      else if (room.roomType === 'living_room') coolingSystems.push('ducted_ac');
      else coolingSystems.push('split_wall');
    }

    return normalizeRoomAssignment(room, requestedServices, {
      roomId: room.id,
      roomName: room.name,
      roomPurpose: room.roomType,
      sourceSystemId: null,
      sourceSystemIds: {
        heating: heatingPref !== 'not_required' && heatingSystems.some((id) => id === 'fan_coils' || id === 'hydronic_floor_heating' || id === 'aluminum_radiators')
          ? plantId
          : null,
        cooling: coolingPref !== 'not_required' && coolingSystems.includes('fan_coils')
          ? (architecture.spaceCombinedSourceId || architecture.spaceCoolingSourceId)
          : null,
      },
      userPreference: null,
      servicePreferences: { heating: heatingPref, cooling: coolingPref },
      servicePreferenceSource: { heating: 'default', cooling: 'default' },
      heatingSystems,
      coolingSystems,
    });
  });

  return normalizeSystemsConfiguration(project, {
    requestedServices,
    selectedSystemFamilies,
    architecture,
    roomAssignments,
    configurationStatus: 'draft',
  }, requestedServices);
}

function normalizeFamilySelection(input: unknown, selectedAtFallback = nowIso()): EngineeringSystemFamilySelection | null {
  if (!input) return null;
  const familyId = typeof input === 'string' ? input : String((input as any).familyId || (input as any).id || '').trim();
  const family = familyById(familyId);
  if (!family) return null;
  return {
    ...family,
    selectedAt: typeof input === 'object' && input && 'selectedAt' in input && String((input as any).selectedAt || '').trim()
      ? String((input as any).selectedAt)
      : selectedAtFallback,
  };
}

function normalizeRoomSystemSelection(input: unknown): EngineeringRoomSystemSelection | null {
  if (!input) return null;
  const familyId = typeof input === 'string' ? input : String((input as any).familyId || (input as any).id || '').trim();
  const family = familyById(familyId);
  if (!family) return null;
  const rawReasons = Array.isArray((input as any)?.reasons) ? (input as any).reasons as unknown[] : [];
  const reasons = dedupeStrings(rawReasons.map((item) => String(item)));
  const sourceSystemId = typeof input === 'object' && input && 'sourceSystemId' in input && String((input as any).sourceSystemId || '').trim()
    ? String((input as any).sourceSystemId)
    : family.kind === 'source' || family.kind === 'combined'
      ? family.id
      : null;
  return {
    familyId: family.id,
    label: family.label,
    service: family.service,
    kind: family.kind,
    scope: family.scope,
    capabilityStatus: family.capabilityStatus,
    sourceSystemId,
    selectedAt: typeof input === 'object' && input && 'selectedAt' in input && String((input as any).selectedAt || '').trim()
      ? String((input as any).selectedAt)
      : nowIso(),
    userPreference: typeof input === 'object' && input && 'userPreference' in input && String((input as any).userPreference || '').trim()
      ? String((input as any).userPreference)
      : null,
    reasons,
  };
}

function worstStatus(statuses: SystemCapabilityStatus[]): SystemCapabilityStatus {
  if (statuses.includes('unsupported')) return 'unsupported';
  if (statuses.includes('not_yet_verified')) return 'not_yet_verified';
  if (statuses.includes('allowed_with_warning')) return 'allowed_with_warning';
  return 'allowed';
}

function roomCapabilityAdjustment(room: BuildingRoom, family: EngineeringSystemFamily): { status: SystemCapabilityStatus; warning?: string } {
  const wet = WET_ROOM_TYPES.has(room.roomType);
  const commercialLike = ['commercial_office', 'sales_floor', 'warehouse', 'server_room', 'restaurant', 'workshop', 'meeting_room', 'reception'].includes(room.roomType);
  if (family.capabilityStatus === 'unsupported') return { status: 'unsupported', warning: 'Технология пока не поддерживается для этой схемы.' };
  if (family.capabilityStatus === 'not_yet_verified') return { status: 'not_yet_verified', warning: 'Расчёт в разработке — инженерная проверка понадобится позже.' };
  if (family.capabilityStatus === 'allowed_with_warning') return { status: 'allowed_with_warning', warning: 'Требуется инженерная проверка по объекту.' };
  if (family.service === 'cooling' && wet) return { status: 'allowed_with_warning', warning: 'Для влажного помещения требуется отдельная инженерная проверка.' };
  if (family.service === 'cooling' && room.roomType === 'server_room') return { status: 'allowed', warning: 'Серверная обычно требует отдельной оценки теплопритоков.' };
  if (family.service === 'heating' && commercialLike) return { status: 'allowed_with_warning', warning: 'Для коммерческого помещения нужна отдельная проверка по объекту.' };
  if (family.kind === 'solution_template') return { status: 'not_yet_verified', warning: 'Комбинированная схема фиксирует только намерение; расчёт позже.' };
  return { status: family.capabilityStatus };
}

function buildRoomSystemSelection(room: BuildingRoom, family: EngineeringSystemFamily, service: 'heating' | 'cooling'): EngineeringRoomSystemSelection {
  const adjustment = roomCapabilityAdjustment(room, family);
  const reasons = dedupeStrings([
    `Выбрано для ${service === 'heating' ? 'отопления' : 'охлаждения'}.`,
    family.statusLabel,
    adjustment.warning || '',
  ]);
  return {
    familyId: family.id,
    label: family.label,
    service: family.service,
    kind: family.kind,
    scope: family.scope,
    capabilityStatus: adjustment.status,
    sourceSystemId: family.kind === 'source' || family.kind === 'combined' ? family.id : null,
    selectedAt: nowIso(),
    userPreference: null,
    reasons,
  };
}

/**
 * Phase 2.7 — stable per-room uniqueness by typed system id. Repeated edits,
 * bulk assignment and normalization must never accumulate duplicate systems in
 * one room/service list. Uniqueness is by familyId, never by display label.
 */
function dedupeRoomSystemSelections(list: EngineeringRoomSystemSelection[]): EngineeringRoomSystemSelection[] {
  const seen = new Set<string>();
  const out: EngineeringRoomSystemSelection[] = [];
  for (const item of list) {
    if (seen.has(item.familyId)) continue;
    seen.add(item.familyId);
    out.push(item);
  }
  return out;
}

function resolveServicePreference(
  room: BuildingRoom,
  service: 'heating' | 'cooling',
  requestedServices: Array<'heating' | 'cooling'>,
  existing: Partial<EngineeringRoomAssignment>,
): { preference: ServicePreference; source: ServicePreferenceSource } {
  const fallback = defaultPreferenceForRoom(room.roomType, service);
  const storedPref = toServicePreference(existing.servicePreferences?.[service], fallback);
  const storedSourceRaw = existing.servicePreferenceSource?.[service];
  const storedSource: ServicePreferenceSource | null = storedSourceRaw === 'user' || storedSourceRaw === 'default' ? storedSourceRaw : null;

  if (!requestedServices.includes(service)) {
    if (storedSource === 'user') return { preference: storedPref, source: 'user' };
    return { preference: fallback, source: 'default' };
  }

  if (storedSource === 'user') return { preference: storedPref, source: 'user' };
  if (storedSource === 'default') return { preference: toServicePreference(existing.servicePreferences?.[service], fallback), source: 'default' };

  // Legacy: no provenance. If the stored value differs from the default, treat it
  // as a user decision. If it matches the default (or is missing), keep default.
  if (existing.servicePreferences && existing.servicePreferences[service] && storedPref !== fallback) {
    return { preference: storedPref, source: 'user' };
  }
  return { preference: fallback, source: 'default' };
}

function defaultTowelPreference(room: BuildingRoom, heatingSystems: EngineeringRoomSystemSelection[]): ServicePreference {
  if (TOWEL_RADIATOR_ROOM_PURPOSES.has(room.roomType) && heatingSystems.some((item) => ['hydronic_floor_heating', 'aluminum_radiators', 'bimetal_radiators', 'steel_panel_radiators', 'fan_coils', 'infloor_convectors'].includes(item.familyId))) {
    return 'optional';
  }
  return 'not_required';
}

function familySupportsService(family: EngineeringSystemFamily, service: 'heating' | 'cooling'): boolean {
  return servicesSupportedByFamily(family).has(service);
}

export interface NormalizeRoomAssignmentOptions {
  mode?: SystemsNormalizeMode;
  mismatches?: Array<{ roomId: string; service: 'heating' | 'cooling'; familyId: string; label: string }>;
}

function normalizeRoomAssignment(
  room: BuildingRoom,
  requestedServices: Array<'heating' | 'cooling'>,
  input: unknown,
  options: NormalizeRoomAssignmentOptions = {},
): EngineeringRoomAssignment {
  const existing = typeof input === 'object' && input ? (input as Partial<EngineeringRoomAssignment> & { heatingSystems?: unknown[]; coolingSystems?: unknown[] }) : {};
  const mode = options.mode || 'load';

  const takeList = (raw: unknown, service: 'heating' | 'cooling'): EngineeringRoomSystemSelection[] => {
    const items = Array.isArray(raw) ? raw : [];
    const out: EngineeringRoomSystemSelection[] = [];
    for (const item of items) {
      const selection = normalizeRoomSystemSelection(item);
      if (!selection) continue;
      const family = familyById(selection.familyId);
      if (!family) continue;
      if (!familySupportsService(family, service)) {
        options.mismatches?.push({ roomId: room.id, service, familyId: family.id, label: family.label });
        if (mode === 'write') continue;
        continue;
      }
      out.push(selection);
    }
    return dedupeRoomSystemSelections(out);
  };

  const heatingSystems = takeList(existing.heatingSystems, 'heating');
  const coolingSystems = takeList(existing.coolingSystems, 'cooling');

  const heatingResolved = resolveServicePreference(room, 'heating', requestedServices, existing);
  const coolingResolved = resolveServicePreference(room, 'cooling', requestedServices, existing);

  const sourceSystemId = typeof existing.sourceSystemId === 'string' && existing.sourceSystemId.trim() ? existing.sourceSystemId.trim() : null;
  const sourceHeating = typeof existing.sourceSystemIds?.heating === 'string' && existing.sourceSystemIds.heating.trim()
    ? existing.sourceSystemIds.heating.trim()
    : heatingSystems.find((item) => item.kind === 'source' || item.kind === 'combined')?.familyId || null;
  const sourceCooling = typeof existing.sourceSystemIds?.cooling === 'string' && existing.sourceSystemIds.cooling.trim()
    ? existing.sourceSystemIds.cooling.trim()
    : coolingSystems.find((item) => item.kind === 'source' || item.kind === 'combined')?.familyId || null;

  const towelFallback = defaultTowelPreference(room, heatingSystems);
  const towelSourceRaw = existing.towelRadiatorPreferenceSource;
  const towelSource: ServicePreferenceSource = towelSourceRaw === 'user' || towelSourceRaw === 'default' ? towelSourceRaw : 'default';
  const towelPreference = towelSource === 'user'
    ? toServicePreference(existing.towelRadiatorPreference, towelFallback)
    : towelFallback;

  const warnings: string[] = [];
  if (requestedServices.includes('heating') && heatingResolved.preference === 'required' && !heatingSystems.length) {
    warnings.push('Требуется выбрать систему отопления для помещения.');
  }
  if (requestedServices.includes('cooling') && coolingResolved.preference === 'required' && !coolingSystems.length) {
    warnings.push('Требуется выбрать систему охлаждения для помещения.');
  }

  const statuses: SystemCapabilityStatus[] = [];
  for (const item of heatingSystems) {
    statuses.push(item.capabilityStatus);
    if (item.capabilityStatus === 'allowed_with_warning') warnings.push(`Система ${item.label} требует инженерной проверки.`);
    if (item.capabilityStatus === 'not_yet_verified') warnings.push(`Система ${item.label}: расчёт в разработке.`);
    if (item.capabilityStatus === 'unsupported') warnings.push(`Система ${item.label} пока не поддерживается.`);
  }
  for (const item of coolingSystems) {
    statuses.push(item.capabilityStatus);
    if (item.capabilityStatus === 'allowed_with_warning') warnings.push(`Система ${item.label} требует инженерной проверки.`);
    if (item.capabilityStatus === 'not_yet_verified') warnings.push(`Система ${item.label}: расчёт в разработке.`);
    if (item.capabilityStatus === 'unsupported') warnings.push(`Система ${item.label} пока не поддерживается.`);
  }

  const reasons: string[] = [];
  if (heatingSystems.length) reasons.push(`Отопление: ${heatingSystems.map((item) => item.label).join(', ')}`);
  if (coolingSystems.length) reasons.push(`Охлаждение: ${coolingSystems.map((item) => item.label).join(', ')}`);
  if (sourceHeating) reasons.push(`Источник отопления: ${sourceHeating}`);
  if (sourceCooling) reasons.push(`Источник охлаждения: ${sourceCooling}`);
  if (sourceSystemId) reasons.push(`Общий источник: ${sourceSystemId}`);
  if (towelPreference === 'optional' && TOWEL_RADIATOR_ROOM_PURPOSES.has(room.roomType)) {
    reasons.push('Полотенцесушитель: рекомендация, не обязательное требование.');
  }

  return {
    roomId: room.id,
    roomName: room.name,
    roomPurpose: room.roomType,
    sourceSystemId,
    sourceSystemIds: { heating: sourceHeating, cooling: sourceCooling },
    userPreference: typeof existing.userPreference === 'string' && existing.userPreference.trim() ? existing.userPreference.trim() : null,
    servicePreferences: {
      heating: heatingResolved.preference,
      cooling: coolingResolved.preference,
    },
    servicePreferenceSource: {
      heating: heatingResolved.source,
      cooling: coolingResolved.source,
    },
    towelRadiatorPreference: towelPreference,
    towelRadiatorPreferenceSource: towelSource,
    heatingSystems,
    coolingSystems,
    status: statuses.length ? worstStatus(statuses) : 'not_yet_verified',
    warnings: dedupeStrings(warnings),
    reasons: dedupeStrings(reasons),
  };
}

function unionSharedSourcesFromAssignments(roomAssignments: EngineeringRoomAssignment[]): EngineeringSystemFamilySelection[] {
  const out: EngineeringSystemFamilySelection[] = [];
  const seen = new Set<string>();
  const add = (familyId: string | null | undefined, selectedAt: string | undefined) => {
    if (!familyId || seen.has(familyId)) return;
    const family = familyById(familyId);
    if (!family || !isProjectSharedSourceFamily(family)) return;
    seen.add(family.id);
    out.push({ ...family, selectedAt: selectedAt || nowIso() });
  };
  for (const assignment of roomAssignments) {
    add(assignment.sourceSystemId, undefined);
    add(assignment.sourceSystemIds.heating, undefined);
    add(assignment.sourceSystemIds.cooling, undefined);
  }
  return out;
}

function buildConfigurationWarnings(config: EngineeringSystemConfiguration, project?: BuildingProject): string[] {
  const warnings: string[] = [];
  if (!config.requestedServices.length) warnings.push('Выберите отопление, охлаждение или обе задачи проектирования.');
  // Phase 2.8A: coverage must also count room-local families actually in use.
  // selectedSystemFamilies deliberately excludes unused room-local terminals, so
  // a valid room-local architecture (e.g. split_wall cooling in every room) must
  // not produce a false "technology not selected" warning.
  const usedLocal = usedRoomLocalFamilyIds(config.roomAssignments);
  for (const service of config.requestedServices) {
    const hasFamily = config.selectedSystemFamilies.some((item) => item.service === service || item.service === 'heating_and_cooling')
      || [...usedLocal].some((id) => {
        const family = familyById(id);
        return Boolean(family && familySupportsService(family, service));
      });
    if (!hasFamily) warnings.push(`Для ${service === 'heating' ? 'отопления' : 'охлаждения'} не выбрана технология.`);
  }
  if (config.simultaneousHeatCoolRequired && !config.architecture.simultaneousHeatCoolSupported) {
    warnings.push('Требуется одновременное отопление и охлаждение разных зон, но выбранная архитектура это не поддерживает. Выберите 4-трубную или независимую схему.');
  }
  if (project) {
    for (const room of project.rooms) {
      const assignment = config.roomAssignments.find((item) => item.roomId === room.id);
      if (assignment) warnings.push(...assignment.warnings);
    }
  } else {
    for (const assignment of config.roomAssignments) warnings.push(...assignment.warnings);
  }
  return dedupeStrings(warnings);
}

function usedRoomLocalFamilyIds(roomAssignments: EngineeringRoomAssignment[]): Set<string> {
  const ids = new Set<string>();
  for (const assignment of roomAssignments) {
    for (const item of assignment.heatingSystems) {
      const family = familyById(item.familyId);
      if (family && isRoomLocalSystemFamily(family)) ids.add(family.id);
    }
    for (const item of assignment.coolingSystems) {
      const family = familyById(item.familyId);
      if (family && isRoomLocalSystemFamily(family)) ids.add(family.id);
    }
  }
  return ids;
}

function normalizeConfigurationBase(
  project: BuildingProject,
  input: EngineeringSystemConfigurationInput | null | undefined,
  fallbackRequestedServices: Array<'heating' | 'cooling'>,
  options: { mode?: SystemsNormalizeMode; bumpRevision?: boolean } = {},
) {
  const current = project.systemsConfiguration || project.systemsConfigurationSnapshot || null;
  const mode: SystemsNormalizeMode = options.mode || 'load';
  const requestedServices = normalizeRequestedServices(input?.requestedServices, normalizeRequestedServices(current?.requestedServices, fallbackRequestedServices));
  const roomAssignmentsInput = Array.isArray(input?.roomAssignments) ? input.roomAssignments : current?.roomAssignments || [];
  const selectedFamiliesInput = Array.isArray(input?.selectedSystemFamilies) ? input.selectedSystemFamilies : current?.selectedSystemFamilies || [];
  const mismatches: Array<{ roomId: string; service: 'heating' | 'cooling'; familyId: string; label: string }> = [];

  const roomAssignments = project.rooms.map((room) => {
    const existing = roomAssignmentsInput.find((assignment) => String((assignment as any)?.roomId || '') === room.id) || null;
    return normalizeRoomAssignment(room, requestedServices, existing, { mode, mismatches });
  });

  if (mode === 'write' && mismatches.length) {
    throw new BuildingSystemsValidationError(
      'building.systems_service_mismatch',
      `Нельзя назначить ${mismatches[0].label} на ${mismatches[0].service === 'heating' ? 'отопление' : 'охлаждение'}.`,
      { mismatches },
    );
  }

  const usedLocal = usedRoomLocalFamilyIds(roomAssignments);
  const selectedSystemFamilies: EngineeringSystemFamilySelection[] = [];
  const seen = new Set<string>();
  const addFamily = (inputValue: unknown) => {
    const family = normalizeFamilySelection(inputValue);
    if (!family || seen.has(family.id)) return;
    if (isRoomLocalSystemFamily(family) && family.kind === 'terminal' && !usedLocal.has(family.id)) return;
    seen.add(family.id);
    selectedSystemFamilies.push(family);
  };

  for (const item of selectedFamiliesInput) addFamily(item);
  for (const item of unionSharedSourcesFromAssignments(roomAssignments)) addFamily(item);

  const explicitFamilies = selectedFamiliesInput
    .map((item) => normalizeFamilySelection(item))
    .filter((item): item is EngineeringSystemFamilySelection => Boolean(item));

  const previousRevision = Number((input as any)?.systemsRevision ?? current?.systemsRevision ?? 0);
  const systemsRevision = options.bumpRevision ? previousRevision + 1 : previousRevision;
  const simultaneousHeatCoolRequired = typeof input?.simultaneousHeatCoolRequired === 'boolean'
    ? input.simultaneousHeatCoolRequired
    : Boolean(current?.simultaneousHeatCoolRequired);
  const configurationStatus = input?.configurationStatus || current?.configurationStatus || 'draft';
  const confirmedAt = input?.confirmedAt ?? current?.confirmedAt ?? null;
  const buildingRevisionAtConfirmation = input?.buildingRevisionAtConfirmation ?? current?.buildingRevisionAtConfirmation ?? null;
  const systemsRevisionAtConfirmation = input?.systemsRevisionAtConfirmation ?? current?.systemsRevisionAtConfirmation ?? null;


  const config: EngineeringSystemConfiguration = {
    projectId: project.id,
    requestedServices,
    simultaneousHeatCoolRequired,
    selectedSystemFamilies,
    architecture: buildArchitectureFromSelection(requestedServices, explicitFamilies, input?.architecture || null),
    roomAssignments,
    configurationStatus,
    warnings: [],
    confirmedAt,
    buildingRevisionAtConfirmation,
    systemsRevisionAtConfirmation,
    systemsRevision,
  };
  if (mismatches.length) {
    for (const item of mismatches) {
      config.warnings.push(`Нормализовано: ${item.label} убран из ${item.service === 'heating' ? 'отопления' : 'охлаждения'} (несовместимый сервис).`);
    }
  }
  config.warnings = dedupeStrings([...config.warnings, ...buildConfigurationWarnings(config, project)]);
  config.hydronicRequirements = computeHydronicSystemRequirements(project, config);
  config.validation = validateSystemsConfigurationForConfirmation(project, config);
  return config;
}

export function getBuildingProjectSystemsCatalog(): BuildingSystemsCatalog {
  const roomPurposeGuidance = ROOM_TYPES.map((roomType) => ({
    roomType: roomType.value,
    label: roomType.label,
    defaultHeating: defaultPreferenceForRoom(roomType.value, 'heating'),
    defaultCooling: defaultPreferenceForRoom(roomType.value, 'cooling'),
  }));

  return {
    serviceOptions: [
      { value: 'heating', label: 'Отопление', description: 'Только отопление.' },
      { value: 'cooling', label: 'Охлаждение', description: 'Только охлаждение.' },
      { value: 'heating_and_cooling', label: 'Отопление + охлаждение', description: 'Обе задачи в одном проекте.' },
    ],
    capabilityStates: [
      { value: 'allowed', label: CAPABILITY_LABELS.allowed },
      { value: 'allowed_with_warning', label: CAPABILITY_LABELS.allowed_with_warning },
      { value: 'unsupported', label: CAPABILITY_LABELS.unsupported },
      { value: 'not_yet_verified', label: CAPABILITY_LABELS.not_yet_verified },
    ],
    systemFamilies: SYSTEM_FAMILIES.map((family) => clone(family)),
    groups: SYSTEM_GROUPS.map((group) => ({ ...group, familyIds: [...group.familyIds] })),
    roomPurposeGuidance,
    dhw: { available: true, status: 'not_configured', label: 'ГВС', description: 'Горячее водоснабжение настраивается отдельно.' },
  };
}

export function getSystemFamilyById(familyId: string): EngineeringSystemFamily | null {
  return familyById(familyId);
}

export function systemCapabilityLabel(status: SystemCapabilityStatus): string {
  return CAPABILITY_LABELS[status];
}

export function defaultRequestedServices(choice: BuildingSystemRequestChoice): Array<'heating' | 'cooling'> {
  if (choice === 'heating_and_cooling') return ['heating', 'cooling'];
  return [choice];
}

/**
 * Validation semantics for the four requirement/capability combinations:
 * required=false -> PASS regardless of support; required=true -> PASS only if supported.
 */
export function simultaneousHeatCoolSatisfied(required: boolean, supported: boolean): boolean {
  return !required || supported;
}

export function createDefaultSystemsConfiguration(project: BuildingProject, requestedServices: Array<'heating' | 'cooling'> = []): EngineeringSystemConfiguration {
  return normalizeSystemsConfiguration(project, {
    requestedServices,
    selectedSystemFamilies: [],
    roomAssignments: [],
    configurationStatus: 'draft',
  }, requestedServices);
}

export function normalizeSystemsConfiguration(
  project: BuildingProject,
  input: EngineeringSystemConfigurationInput | null | undefined,
  fallbackRequestedServices: Array<'heating' | 'cooling'> = [],
  options: { mode?: SystemsNormalizeMode; bumpRevision?: boolean } = {},
): EngineeringSystemConfiguration {
  return normalizeConfigurationBase(project, input, fallbackRequestedServices, options);
}

export function isSystemsConfigurationStale(project: BuildingProject): boolean {
  if (!project.systemsConfigurationSnapshot) return false;
  return Number(project.buildingRevision || 0) !== Number(project.systemsConfigurationSnapshot.buildingRevisionAtConfirmation || 0);
}

export function markSystemsConfigurationStale(project: BuildingProject) {
  if (project.systemsConfiguration) {
    project.systemsConfiguration.configurationStatus = 'stale';
    project.systemsConfiguration.confirmedAt = null;
    project.systemsConfiguration.warnings = buildConfigurationWarnings(project.systemsConfiguration, project);
  }
  if (project.status === 'systems_configured') {
    project.status = 'object_confirmed';
  }
}

export function buildSystemsSummary(project: BuildingProject) {
  const config = project.status === 'systems_configured' && project.systemsConfigurationSnapshot
    ? project.systemsConfigurationSnapshot
    : project.systemsConfiguration;
  if (!config) {
    return {
      requestedServices: [] as Array<'heating' | 'cooling'>,
      selectedSourceFamilies: [] as EngineeringSystemFamilySelection[],
      roomAssignments: [] as EngineeringRoomAssignment[],
      configurationStatus: 'draft' as SystemsConfigurationStatus,
      warnings: [] as string[],
      isStale: false,
    };
  }

  const selectedSourceFamilies = config.selectedSystemFamilies.filter((item) => item.kind === 'source' || item.kind === 'combined');
  return {
    requestedServices: [...config.requestedServices],
    selectedSourceFamilies,
    roomAssignments: config.roomAssignments.map((assignment) => clone(assignment)),
    configurationStatus: config.configurationStatus,
    warnings: [...config.warnings],
    isStale: isSystemsConfigurationStale(project),
  };
}

export function roomCapabilityLabel(roomType: string): string {
  return roomTypeLabel(roomType);
}

registerSystemsFamilyApi({
  familyById,
  isProjectSharedSourceFamily,
  isRoomLocalSystemFamily,
  servicesSupportedByFamily,
});

export { confirmErrorForBlocker };
