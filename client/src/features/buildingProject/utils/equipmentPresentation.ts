/**
 * Presentation-only metadata for engineering system families.
 *
 * Maps the server's family ids (authoritative: /tools/building-project/
 * systems-catalog) to a pictogram, a one-line customer explanation and a
 * DISPLAY group. Groups are presentation categories only — they never change
 * the family's kind/scope/service, ids, labels, selection rules or
 * calculations. Unknown ids fall back to the generic glyph and the "other"
 * group so a new server family is always rendered and selectable.
 */
import type { EquipmentGlyphKey } from '../components/equipmentSelection/EquipmentIcon';
import type { EngineeringRoomAssignment, EngineeringSystemFamily } from '../types';

export type EquipmentService = 'heating' | 'cooling';

export type EquipmentDisplayGroup =
  | 'radiators' | 'floor' | 'air_hydronic' | 'air_conditioners' | 'combined' | 'other';

export type EquipmentPresentation = {
  /** One or two pictograms; two = a combined scheme shown as "A + B". */
  glyphs: [EquipmentGlyphKey] | [EquipmentGlyphKey, EquipmentGlyphKey];
  subtitle: string;
  /** Display group per service (a dual-service device can sit in a different group per service). */
  group: Partial<Record<EquipmentService, EquipmentDisplayGroup>>;
};

export const EQUIPMENT_PRESENTATION: Record<string, EquipmentPresentation> = {
  // ---- project / apartment sources ----
  gas_boiler: { glyphs: ['gas_boiler'], subtitle: 'Настенный котёл для водяного отопления', group: {} },
  gas_condensing_boiler: { glyphs: ['gas_condensing_boiler'], subtitle: 'Экономичный котёл с отводом конденсата', group: {} },
  electric_boiler: { glyphs: ['electric_boiler'], subtitle: 'Котёл на электричестве, без газа', group: {} },
  heat_pump_air_to_water: { glyphs: ['hp_air_water'], subtitle: 'Берёт тепло из уличного воздуха, греет воду', group: {} },
  reversible_air_to_water_heat_pump: { glyphs: ['hp_reversible'], subtitle: 'Тепло зимой и холод летом через водяной контур', group: {} },
  chiller_fan_coils: { glyphs: ['chiller'], subtitle: 'Охлаждённая вода к фанкойлам в комнатах', group: {} },
  external_building_heating_supply: { glyphs: ['building_supply'], subtitle: 'Тепло поступает от системы здания', group: {} },
  external_building_cooling_supply: { glyphs: ['building_supply'], subtitle: 'Холод поступает от системы здания', group: {} },

  // ---- heating terminals ----
  steel_panel_radiators: { glyphs: ['radiator_panel'], subtitle: 'Плоская панель, водяное отопление', group: { heating: 'radiators' } },
  aluminum_radiators: { glyphs: ['radiator_aluminum'], subtitle: 'Секционные, быстро нагреваются', group: { heating: 'radiators' } },
  bimetal_radiators: { glyphs: ['radiator_bimetal'], subtitle: 'Стальной сердечник — для высокого давления', group: { heating: 'radiators' } },
  electric_convector: { glyphs: ['convector'], subtitle: 'Настенный электрический прибор', group: { heating: 'radiators' } },
  infloor_convectors: { glyphs: ['trench_convector'], subtitle: 'Решётка в полу у панорамных окон', group: { heating: 'radiators' } },
  hydronic_floor_heating: { glyphs: ['floor_water'], subtitle: 'Трубы с тёплой водой в стяжке пола', group: { heating: 'floor' } },
  electric_underfloor_heating: { glyphs: ['floor_electric'], subtitle: 'Кабель или мат — тип уточняется при подборе', group: { heating: 'floor' } },
  heating_cable: { glyphs: ['heating_cable'], subtitle: 'Электрический кабель в стяжке пола', group: { heating: 'floor' } },
  heating_mat: { glyphs: ['heating_mat'], subtitle: 'Тонкий мат под плитку', group: { heating: 'floor' } },

  // ---- dual-service room devices ----
  fan_coils: { glyphs: ['fan_coil'], subtitle: 'Водяной прибор с вентилятором: тепло и холод', group: { heating: 'air_hydronic', cooling: 'air_hydronic' } },
  heat_pump_air_to_air: { glyphs: ['hp_air_air'], subtitle: 'Сплит-система на обогрев и охлаждение', group: { heating: 'air_hydronic', cooling: 'air_hydronic' } },

  // ---- cooling (direct expansion) ----
  split_wall: { glyphs: ['split_wall'], subtitle: 'Внутренний блок на стене', group: { cooling: 'air_conditioners' } },
  cassette_ac: { glyphs: ['cassette'], subtitle: 'Встраивается в потолок, обдув на 4 стороны', group: { cooling: 'air_conditioners' } },
  floor_ceiling_ac: { glyphs: ['floor_ceiling'], subtitle: 'Под потолком или у пола, для больших комнат', group: { cooling: 'air_conditioners' } },
  column_ac: { glyphs: ['column'], subtitle: 'Напольная колонна для больших залов', group: { cooling: 'air_conditioners' } },
  multi_split: { glyphs: ['multi_split'], subtitle: 'Один наружный блок на несколько комнат', group: { cooling: 'air_conditioners' } },
  ducted_ac: { glyphs: ['ducted'], subtitle: 'Скрыт за потолком, воздух по каналам', group: { cooling: 'air_conditioners' } },
  vrf_vrv: { glyphs: ['vrf'], subtitle: 'Многозональная система для больших объектов', group: { cooling: 'air_conditioners' } },

  // ---- predefined combined schemes (solution templates) ----
  heat_pump_air_to_water_fan_coils: { glyphs: ['hp_air_water', 'fan_coil'], subtitle: 'Один источник на тепло и холод', group: { heating: 'combined', cooling: 'combined' } },
  gas_boiler_split_multi_split: { glyphs: ['gas_boiler', 'split_wall'], subtitle: 'Котёл греет, кондиционеры охлаждают', group: { heating: 'combined', cooling: 'combined' } },
  gas_boiler_vrf: { glyphs: ['gas_boiler', 'vrf'], subtitle: 'Котёл греет, VRF охлаждает', group: { heating: 'combined', cooling: 'combined' } },
  radiators_plus_ac: { glyphs: ['radiator_panel', 'split_wall'], subtitle: 'Радиаторы зимой, кондиционер летом', group: { heating: 'combined', cooling: 'combined' } },
  hydronic_floor_heating_plus_ac: { glyphs: ['floor_water', 'split_wall'], subtitle: 'Тёплый пол зимой, кондиционер летом', group: { heating: 'combined', cooling: 'combined' } },
  hydronic_floor_heating_plus_fan_coils: { glyphs: ['floor_water', 'fan_coil'], subtitle: 'Пол греет, фанкойлы охлаждают', group: { heating: 'combined', cooling: 'combined' } },
  electric_heating_plus_cooling: { glyphs: ['convector', 'split_wall'], subtitle: 'Электроотопление и кондиционер', group: { heating: 'combined', cooling: 'combined' } },
  individual_combined_scheme: { glyphs: ['custom_scheme'], subtitle: 'Свободная схема — уточнит инженер', group: { heating: 'combined', cooling: 'combined' } },
};

export const EQUIPMENT_GROUP_LABEL: Record<EquipmentDisplayGroup, string> = {
  radiators: 'Радиаторы и конвекторы',
  floor: 'Тёплый пол',
  air_hydronic: 'Фанкойлы и тепловые насосы',
  air_conditioners: 'Кондиционеры',
  combined: 'Готовые комбинированные схемы',
  other: 'Другие варианты',
};

const GROUP_ORDER: Record<EquipmentService, EquipmentDisplayGroup[]> = {
  heating: ['radiators', 'floor', 'air_hydronic', 'other', 'combined'],
  cooling: ['air_conditioners', 'air_hydronic', 'other', 'combined'],
};

const PRESENTATION_ORDER = Object.keys(EQUIPMENT_PRESENTATION);

export const NO_SERVICE_GLYPH: Record<EquipmentService, EquipmentGlyphKey> = {
  heating: 'none_heating',
  cooling: 'none_cooling',
};

export function hasEquipmentPresentation(familyId: string): boolean {
  return Object.prototype.hasOwnProperty.call(EQUIPMENT_PRESENTATION, familyId);
}

export function equipmentGlyphs(familyId: string): EquipmentPresentation['glyphs'] {
  return EQUIPMENT_PRESENTATION[familyId]?.glyphs ?? ['fallback'];
}

/** Customer one-liner; falls back to the server's first note for unmapped families. */
export function equipmentSubtitle(family: Pick<EngineeringSystemFamily, 'id'> & { notes?: string[] }): string {
  return EQUIPMENT_PRESENTATION[family.id]?.subtitle ?? family.notes?.[0] ?? '';
}

export function equipmentDisplayGroup(family: Pick<EngineeringSystemFamily, 'id' | 'kind' | 'service'>, service: EquipmentService): EquipmentDisplayGroup {
  const mapped = EQUIPMENT_PRESENTATION[family.id]?.group[service];
  if (mapped) return mapped;
  if (family.kind === 'solution_template' && family.service === 'heating_and_cooling') return 'combined';
  return 'other';
}

export type EquipmentGroupSection<T> = { group: EquipmentDisplayGroup; label: string; items: T[] };

/**
 * Bucket an already-filtered option list (e.g. roomServiceOptions output) into
 * display groups. Every input item lands in exactly one group; empty groups are
 * omitted. Within a group, known families follow the presentation order and
 * unknown ones keep their server order after them.
 */
export function groupEquipmentOptions<T extends { family: Pick<EngineeringSystemFamily, 'id' | 'kind' | 'service'> }>(
  options: T[],
  service: EquipmentService,
): Array<EquipmentGroupSection<T>> {
  const buckets = new Map<EquipmentDisplayGroup, T[]>();
  for (const option of options) {
    const group = equipmentDisplayGroup(option.family, service);
    const list = buckets.get(group) || [];
    list.push(option);
    buckets.set(group, list);
  }
  const rank = (id: string) => {
    const i = PRESENTATION_ORDER.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return GROUP_ORDER[service]
    .filter((group) => buckets.has(group))
    .map((group) => ({
      group,
      label: EQUIPMENT_GROUP_LABEL[group],
      // Array.prototype.sort is stable: unknown ids keep their server order.
      items: [...(buckets.get(group) || [])].sort((a, b) => rank(a.family.id) - rank(b.family.id)),
    }));
}

/** Short status badge for families whose calculation is not yet verified by the server. */
export function equipmentStatusBadge(family: Pick<EngineeringSystemFamily, 'capabilityStatus'> & { statusLabel?: string }): string | null {
  if (family.capabilityStatus === 'not_yet_verified') return family.statusLabel || 'Расчёт в разработке';
  if (family.capabilityStatus === 'unsupported') return family.statusLabel || 'Не поддерживается';
  return null;
}

/**
 * Selected state of ONE room option — the exact rule the room editor has always
 * used: a 'source' role compares sourceSystemIds[service], a 'terminal' role
 * looks the family up in that service's system list.
 */
export function isRoomOptionSelected(
  assignment: Pick<EngineeringRoomAssignment, 'sourceSystemIds' | 'heatingSystems' | 'coolingSystems'>,
  service: EquipmentService,
  familyId: string,
  role: 'source' | 'terminal',
): boolean {
  if (role === 'source') return assignment.sourceSystemIds[service] === familyId;
  const list = service === 'heating' ? assignment.heatingSystems : assignment.coolingSystems;
  return list.some((item) => item.familyId === familyId);
}

export type RoomServiceSummary = {
  state: 'not_required' | 'empty' | 'selected';
  items: Array<{ familyId: string; label: string }>;
};

/**
 * Structured equivalent of the wizard's assignmentLabel(): source first, then
 * the service's systems (without repeating the source). Display only.
 */
export function roomServiceSummary(
  assignment: Pick<EngineeringRoomAssignment, 'servicePreferences' | 'sourceSystemIds' | 'heatingSystems' | 'coolingSystems'> | null | undefined,
  service: EquipmentService,
  families: Array<Pick<EngineeringSystemFamily, 'id' | 'label'>>,
): RoomServiceSummary {
  if (!assignment) return { state: 'empty', items: [] };
  if (assignment.servicePreferences[service] === 'not_required') return { state: 'not_required', items: [] };
  const items: RoomServiceSummary['items'] = [];
  const sourceId = assignment.sourceSystemIds[service];
  if (sourceId) items.push({ familyId: sourceId, label: families.find((f) => f.id === sourceId)?.label || sourceId });
  const systems = service === 'heating' ? assignment.heatingSystems : assignment.coolingSystems;
  for (const item of systems) {
    if (item.familyId !== sourceId) items.push({ familyId: item.familyId, label: item.label });
  }
  return { state: items.length ? 'selected' : 'empty', items };
}

export type RoomTerminalView = {
  /** Room-level equipment only (the shared source removed). */
  state: 'not_required' | 'empty' | 'selected';
  items: RoomServiceSummary['items'];
  /** The plant/source this room draws from for the service, if any (shared, not a room device). */
  source: RoomServiceSummary['items'][number] | null;
};

/**
 * Display split of a room summary: the source referenced by sourceSystemIds is
 * a project-level plant shared by rooms, not one unit per room. Display only —
 * the stored assignment is untouched.
 */
export function roomTerminalView(
  assignment: Pick<EngineeringRoomAssignment, 'servicePreferences' | 'sourceSystemIds' | 'heatingSystems' | 'coolingSystems'> | null | undefined,
  service: EquipmentService,
  families: Array<Pick<EngineeringSystemFamily, 'id' | 'label'>>,
): RoomTerminalView {
  const summary = roomServiceSummary(assignment, service, families);
  if (summary.state === 'not_required') return { state: 'not_required', items: [], source: null };
  const sourceId = assignment?.sourceSystemIds[service] ?? null;
  const source = sourceId ? summary.items.find((i) => i.familyId === sourceId) ?? null : null;
  const items = summary.items.filter((i) => i.familyId !== sourceId);
  return { state: items.length ? 'selected' : 'empty', items, source };
}

/** The single source shared by every room that uses one for this service (null if none or mixed). */
export function sharedRoomSource(views: RoomTerminalView[]): RoomTerminalView['source'] {
  const withSource = views.filter((v) => v.source);
  if (!withSource.length) return null;
  const first = withSource[0].source!;
  return withSource.every((v) => v.source!.familyId === first.familyId) ? first : null;
}
