import type {
  BuildingLoadMode,
  EngineeringCoverage,
  EngineeringProvenance,
  EngineeringQualityMessageCode,
  EngineeringQualityResult,
  MaximumEligibleLevel,
  QualityGateStatus,
  UseLevel,
} from '../types';

export type EngineeringQualityTone = 'success' | 'warning' | 'neutral';

export interface QualityLevelPresentation {
  level: MaximumEligibleLevel;
  label: string;
  ordinal: string;
}

export interface QualityGatePresentation {
  label: string;
  tone: EngineeringQualityTone;
}

interface ParameterPresentation {
  groupKey: string;
  groupLabel: string;
  label: string;
}

export interface QualityBlockerItemPresentation {
  parameterLabel: string;
  reasonLabel: string;
  technicalFieldId: string;
}

export interface QualityBlockerGroupPresentation {
  key: string;
  groupLabel: string;
  roomLabel: string | null;
  items: QualityBlockerItemPresentation[];
}

export interface QualityCoveragePresentation {
  warning: string | null;
  metrics: string[];
}

export interface EngineeringQualityPresentation {
  achieved: QualityLevelPresentation;
  requested: QualityLevelPresentation & { level: UseLevel };
  gate: QualityGatePresentation;
  blockerGroups: QualityBlockerGroupPresentation[];
  blockerGroupCount: number;
  coverage: QualityCoveragePresentation;
}

const LEVEL_LABELS: Record<0 | UseLevel, string> = {
  0: 'Недостаточно данных',
  1: 'Предварительный',
  2: 'Профессиональный',
  3: 'Подтверждённые данные',
};

const PARAMETER_PRESENTATION: Readonly<Record<string, ParameterPresentation>> = {
  areaM2: { groupKey: 'geometry', groupLabel: 'Геометрия помещения', label: 'Площадь помещения' },
  heightM: { groupKey: 'geometry', groupLabel: 'Геометрия помещения', label: 'Высота помещения' },
  volumeM3: { groupKey: 'geometry', groupLabel: 'Геометрия помещения', label: 'Объём помещения' },
  roomType: { groupKey: 'geometry', groupLabel: 'Геометрия помещения', label: 'Назначение помещения' },
  externalWallAreaM2: { groupKey: 'walls', groupLabel: 'Наружные стены', label: 'Площадь наружных стен' },
  U_wall: { groupKey: 'walls', groupLabel: 'Наружные стены', label: 'Теплопередача наружных стен' },
  externalDoorAreaM2: { groupKey: 'doors', groupLabel: 'Наружные двери', label: 'Площадь наружных дверей' },
  U_door: { groupKey: 'doors', groupLabel: 'Наружные двери', label: 'Теплопередача наружных дверей' },
  roofExposureAreaM2: { groupKey: 'roof', groupLabel: 'Кровля', label: 'Площадь кровли' },
  U_roof: { groupKey: 'roof', groupLabel: 'Кровля', label: 'Теплопередача кровли' },
  groundFloorAreaM2: { groupKey: 'floor', groupLabel: 'Пол / нижняя граница', label: 'Площадь пола по внешней границе' },
  U_floor: { groupKey: 'floor', groupLabel: 'Пол / нижняя граница', label: 'Теплопередача пола' },
  windowAreaM2: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Площадь окон' },
  windowDimensions: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Размеры окон' },
  frameFactor: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Доля рамы окна' },
  U_window: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Теплопередача окон' },
  SHGC: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Солнечный фактор стеклопакета' },
  windowOrientation: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Ориентация окон' },
  shadingFactor: { groupKey: 'windows', groupLabel: 'Характеристики окон', label: 'Затенение окон' },
  solarIrradiance: { groupKey: 'solar', groupLabel: 'Солнечные данные', label: 'Солнечная радиация' },
  climate: { groupKey: 'climate', groupLabel: 'Климатические данные', label: 'Климатический пункт' },
  TinHeating: { groupKey: 'climate', groupLabel: 'Климатические данные', label: 'Расчётная температура помещения для отопления' },
  ToutHeatingDesign: { groupKey: 'climate', groupLabel: 'Климатические данные', label: 'Наружная расчётная температура для отопления' },
  TinCooling: { groupKey: 'climate', groupLabel: 'Климатические данные', label: 'Расчётная температура помещения для охлаждения' },
  ToutCoolingDesign: { groupKey: 'climate', groupLabel: 'Климатические данные', label: 'Наружная расчётная температура для охлаждения' },
  ventilationFlowM3h: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Расход вентиляционного воздуха' },
  ventilationBalance: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Баланс вентиляции' },
  infiltrationMethod: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Метод определения инфильтрации' },
  infiltrationFlowM3h: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Инфильтрационный расход воздуха' },
  airChangesPerHour: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Герметичность здания / воздухообмен' },
  ach50: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Результат испытания герметичности ACH50' },
  airtightnessClass: { groupKey: 'air', groupLabel: 'Воздухообмен и герметичность', label: 'Класс герметичности здания' },
  thermalBridgePsi: { groupKey: 'bridges', groupLabel: 'Тепловые мосты', label: 'Линейная теплопередача тепловых мостов' },
  thermalBridgeLength: { groupKey: 'bridges', groupLabel: 'Тепловые мосты', label: 'Длина тепловых мостов' },
  occupancy: { groupKey: 'occupancy', groupLabel: 'Внутренние теплопритоки', label: 'Количество людей' },
  peopleGainW: { groupKey: 'occupancy', groupLabel: 'Внутренние теплопритоки', label: 'Теплопритоки от людей' },
  occupantSensibleWPerPerson: { groupKey: 'occupancy', groupLabel: 'Внутренние теплопритоки', label: 'Явные теплопритоки на человека' },
  lightingGainW: { groupKey: 'lighting', groupLabel: 'Освещение', label: 'Теплопритоки от освещения' },
  equipmentGainW: { groupKey: 'equipment', groupLabel: 'Оборудование', label: 'Теплопритоки от оборудования' },
  operatingSchedule: { groupKey: 'schedule', groupLabel: 'Режим использования', label: 'График использования помещения' },
  kitchenProcessSchedule: { groupKey: 'kitchen', groupLabel: 'Кухонные процессы', label: 'Теплопритоки кухни' },
  humidityLatentMethod: { groupKey: 'humidity', groupLabel: 'Влажностная нагрузка', label: 'Метод расчёта скрытой влажностной нагрузки' },
  calculationScope: { groupKey: 'coverage', groupLabel: 'Охват объекта', label: 'Охват помещений расчётом' },
  physicalCompleteness: { groupKey: 'completeness', groupLabel: 'Полнота данных', label: 'Полнота исходных данных' },
};

const PROVENANCE_LABELS: Readonly<Record<string, string>> = {
  PROFILE_DEFAULT: 'Использовано типовое значение',
  LEGACY_SEED: 'Использовано приближённое значение из старого профиля',
  INFERRED: 'Значение определено косвенно',
  FALLBACK: 'Использовано резервное значение',
  UNKNOWN: 'Значение требует уточнения',
  EXPLICIT_USER: 'Указано пользователем',
  CERTIFIED_SPEC: 'Подтверждено технической документацией',
  MEASURED: 'Получено измерением',
  AUTHORITATIVE_DATASET: 'Официальные климатические/расчётные данные',
  PROJECT_DOCUMENTATION: 'Указано в проектной документации',
  CALCULATED_FROM_LAYERS: 'Рассчитано по составу конструкции',
  VERIFIED_ASSEMBLY: 'Подтверждено по составу конструкции',
  NORMATIVE_DEFAULT: 'Использовано нормативное значение',
  DERIVED: 'Получено расчётным способом',
};

const REASON_LABELS: Readonly<Record<EngineeringQualityMessageCode, string>> = {
  physical_completeness_required: 'Сначала требуется заполнить физически необходимые данные.',
  critical_profile_default: 'Для этого параметра используется типовое значение.',
  critical_low_quality: 'Надёжность исходного значения недостаточна для выбранного уровня.',
  critical_unresolved: 'Исходное значение требует уточнения.',
  critical_below_high_quality: 'Требуется более надёжный источник исходного значения.',
  important_medium_warning: 'Допустимо для расчёта, но качество можно повысить.',
  important_below_medium: 'Надёжность важного исходного значения требует повышения.',
  coverage_unconfirmed: 'Охват объекта расчётом не подтверждён.',
  coverage_unknown: 'Не указан охват объекта расчётом.',
  coverage_invalid_combination: 'Параметры охвата объекта требуют проверки.',
  profile_default_used: 'Использовано типовое значение.',
  inferred_value_used: 'Значение определено косвенно.',
  fallback_value_used: 'Использовано резервное значение.',
  legacy_seed_used: 'Использовано приближённое значение из старого профиля.',
  unknown_value_used: 'Значение требует уточнения.',
  legacy_unassessed: 'Качество старого расчёта не оценивалось.',
  superseded_input: 'Значение заменено более актуальным источником.',
};

export function qualityLevelPresentation(level: MaximumEligibleLevel): QualityLevelPresentation {
  if (level == null) return { level: null, label: 'Не оценено', ordinal: 'Уровень не оценён' };
  return { level, label: LEVEL_LABELS[level], ordinal: `Уровень ${level} из 3` };
}

export function qualityGatePresentation(status: QualityGateStatus): QualityGatePresentation {
  if (status === 'PASS') return { label: 'Уровень подтверждён', tone: 'success' };
  if (status === 'PASS_WITH_WARNINGS') return { label: 'Уровень подтверждён, есть замечания', tone: 'warning' };
  if (status === 'BLOCKED') return { label: 'Для выбранного уровня нужно уточнить данные', tone: 'warning' };
  return { label: 'Качество старого расчёта не оценено', tone: 'neutral' };
}

export function engineeringParameterPresentation(parameter: string): ParameterPresentation {
  return PARAMETER_PRESENTATION[parameter] ?? {
    groupKey: 'other',
    groupLabel: 'Другие исходные данные',
    label: 'Требуется уточнение одного из исходных параметров',
  };
}

export function engineeringProvenanceLabel(provenance: string | undefined): string {
  if (!provenance) return 'Значение требует уточнения';
  return PROVENANCE_LABELS[provenance] ?? 'Источник значения требует уточнения';
}

export function engineeringQualityMessageLabel(code: EngineeringQualityMessageCode): string {
  return REASON_LABELS[code];
}

function blockerReasonLabel(
  reasonCode: EngineeringQualityMessageCode,
  provenance: EngineeringProvenance | undefined,
): string {
  if (provenance && PROVENANCE_LABELS[provenance]) return engineeringProvenanceLabel(provenance);
  return engineeringQualityMessageLabel(reasonCode);
}

function coveragePresentation(coverage: EngineeringCoverage): QualityCoveragePresentation {
  const warning = coverage.scope === 'UNKNOWN' || coverage.confirmation === 'UNCONFIRMED'
    ? 'Не подтверждено, что расчёт охватывает весь объект.'
    : null;
  const metrics: string[] = [];
  if (coverage.declaredAreaM2 != null) metrics.push(`Площадь объекта: ${coverage.declaredAreaM2} м²`);
  if (coverage.modeledAreaM2 != null) metrics.push(`Площадь помещений в расчёте: ${coverage.modeledAreaM2} м²`);
  return { warning, metrics };
}

function blockerGroups(
  quality: EngineeringQualityResult,
  rooms: ReadonlyArray<{ id: string; name: string }>,
): QualityBlockerGroupPresentation[] {
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const fields = new Map(quality.fields.map((field) => [field.fieldId, field]));
  const groups = new Map<string, QualityBlockerGroupPresentation>();

  for (const blocker of quality.blockingFields) {
    const parameter = engineeringParameterPresentation(blocker.parameter);
    const roomLabel = blocker.roomId ? (roomNames.get(blocker.roomId) ?? 'Помещение') : null;
    const key = `${blocker.roomId ?? 'project'}:${parameter.groupKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, groupLabel: parameter.groupLabel, roomLabel, items: [] };
      groups.set(key, group);
    }
    const field = fields.get(blocker.fieldId);
    group.items.push({
      parameterLabel: parameter.label,
      reasonLabel: blockerReasonLabel(blocker.reasonCode, field?.effectiveProvenance),
      technicalFieldId: blocker.fieldId,
    });
  }

  return Array.from(groups.values());
}

export function buildEngineeringQualityPresentation(
  quality: EngineeringQualityResult,
  rooms: ReadonlyArray<{ id: string; name: string }>,
): EngineeringQualityPresentation {
  const requested = qualityLevelPresentation(quality.requestedLevel);
  const groups = blockerGroups(quality, rooms);
  return {
    achieved: qualityLevelPresentation(quality.maximumEligibleLevel),
    requested: { ...requested, level: quality.requestedLevel },
    gate: qualityGatePresentation(quality.gateStatus),
    blockerGroups: groups,
    blockerGroupCount: groups.length,
    coverage: coveragePresentation(quality.coverage),
  };
}

export function shouldShowEngineeringQuality(mode: BuildingLoadMode): boolean {
  return mode === 'steady_state';
}
