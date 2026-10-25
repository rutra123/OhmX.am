/**
 * Phase 3.2H — user-friendly missing-input UX + steady-state readiness.
 *
 * Pure, framework-free helpers (no React, no browser). `*MissingInput` maps raw
 * backend missing codes to human text + a concrete action; `buildSteadyStateReadiness`
 * turns a room's collected inputs into a plain-language completeness indicator.
 * No numbers are computed here — the backend remains the sole authority.
 */
import type { BuildingLoadMode, BuildingProject, BuildingRoom, EnvelopeElement, RoomAir, VentilationBalance } from '../types';
import { roomPhysicalCompleteness } from './professionalCompleteness';

export interface MissingExplanation {
  /** Human-readable title — never contains a raw `:missing` code. */
  title: string;
  /** Concrete user action (references the wizard step + ⚙ engineering panel). */
  action: string;
  /** Raw backend code, preserved for Advanced/debug only. */
  debugCode: string;
}

const MISSING_RULES: Array<{ match: (code: string) => boolean; title: string; action: string }> = [
  {
    match: (c) => c.startsWith('duplicate_element_id'),
    title: 'В инженерных данных повторяется идентификатор элемента',
    action: 'Помещения → ⚙ → удалить дубликат окна/конструкции и сохранить каждый элемент один раз.',
  },
  {
    match: (c) => c.startsWith('climate_design_temperatures') || c.startsWith('climate_location'),
    title: 'Для региона нет подтверждённого климатического пункта',
    action: 'Объект → выбрать регион с подтверждёнными климатическими данными.',
  },
  {
    match: (c) => c.startsWith('u_value') || c.startsWith('u_values'),
    title: 'Не выбрано утепление наружных конструкций',
    action: 'Помещения → открыть комнату (⚙) → выбрать утепление стен/окон/крыши.',
  },
  {
    match: (c) => c.startsWith('envelope_areas') || c.startsWith('room_area') || c.startsWith('room_height'),
    title: 'Не указаны размеры помещения или наружных конструкций',
    action: 'Помещения → ⚙ → указать площадь, высоту и размеры ограждений/окон.',
  },
  {
    match: (c) => c.startsWith('infiltration_or_ventilation_method'),
    title: 'Не выбрана вентиляция и/или герметичность',
    action: 'Помещения → ⚙ → выбрать тип вентиляции и герметичность.',
  },
  {
    match: (c) => c.startsWith('solar_and_orientation_methodology'),
    title: 'Не указаны параметры окон для солнечных теплопритоков',
    action: 'Помещения → ⚙ → указать сторону света, тип окна и затенение.',
  },
  {
    match: (c) => c.startsWith('shgc:missing'),
    title: 'Не выбран тип стеклопакета (теплотехническое качество)',
    action: 'Помещения → ⚙ → выбрать тип окна (старое/обычное/современное/энергосберегающее).',
  },
  {
    match: (c) => c.includes('orientation') || c.includes('solar_and_orientation'),
    title: 'Не указано, куда выходят окна',
    action: 'Помещения → ⚙ → указать сторону света каждого окна.',
  },
  {
    match: (c) => c.startsWith('internal_gains_methodology') || c.startsWith('occupancy'),
    title: 'Не указано, сколько людей обычно находится в комнате',
    action: 'Помещения → ⚙ → указать количество людей.',
  },
  {
    match: (c) => c.includes('infiltration') || c.includes('ventilation'),
    title: 'Не выбрана вентиляция и/или герметичность',
    action: 'Помещения → ⚙ → выбрать тип вентиляции и герметичность.',
  },
  {
    match: (c) => c.startsWith('area:missing'),
    title: 'Не указаны размеры наружных стен или окон',
    action: 'Помещения → ⚙ → указать размеры ограждений и окон.',
  },
  {
    match: (c) => c.startsWith('envelope:missing') || c.startsWith('envelope'),
    title: 'Не описаны наружные ограждения помещения',
    action: 'Помещения → ⚙ → добавить стены/крышу/пол.',
  },
];

export function explainMissingInput(code: string): MissingExplanation {
  for (const rule of MISSING_RULES) {
    if (rule.match(code)) {
      return { title: rule.title, action: rule.action, debugCode: code };
    }
  }
  return {
    title: 'Не заполнены инженерные данные помещения',
    action: 'Помещения → ⚙ → заполнить недостающие параметры.',
    debugCode: code,
  };
}

export function friendlyMissingList(codes: string[]): MissingExplanation[] {
  const seen = new Set<string>();
  const out: MissingExplanation[] = [];
  for (const code of codes) {
    const item = explainMissingInput(code);
    if (!seen.has(item.title)) {
      seen.add(item.title);
      out.push(item);
    }
  }
  return out;
}

/** Phase 3.2I.2 — roomType → typical occupancy REFERENCE profile (residential only). */
const OCCUPANCY_SUGGESTIONS: Record<string, number> = {
  living_room: 2,
  bedroom: 2,
  child_room: 1,
  office: 1,
  kitchen: 1,
  bathroom: 1,
  shower: 1,
  guest_room: 1,
  corridor: 0,
  hall: 0,
  dressing_room: 0,
  storage: 0,
  technical: 0,
  boiler_room: 0,
  garage: 0,
};

/** Room types whose count is a suggestion the user must confirm (never auto-applied). */
const OCCUPANCY_SUGGESTION_ONLY: ReadonlySet<string> = new Set(['bathroom', 'shower']);

export interface OccupancySuggestion {
  suggestedPeople: number;
  status: 'REFERENCE_PROFILE';
  calculationInput: boolean;
  userConfirmationRequired: boolean;
  zeroOccupancy: boolean;
}

export function getRoomOccupancySuggestion(roomType: string, objectType: string): OccupancySuggestion | null {
  if (objectType === 'commercial') return null; // no fixed residential default for commercial
  if (!(roomType in OCCUPANCY_SUGGESTIONS)) return null;
  const n = OCCUPANCY_SUGGESTIONS[roomType];
  const suggestionOnly = OCCUPANCY_SUGGESTION_ONLY.has(roomType);
  return {
    suggestedPeople: n,
    status: 'REFERENCE_PROFILE',
    calculationInput: !suggestionOnly,
    userConfirmationRequired: suggestionOnly,
    zeroOccupancy: n === 0,
  };
}

export function loadModeLabel(mode: BuildingLoadMode): string {
  switch (mode) {
    case 'steady_state':
      return 'Профессиональный steady-state';
    case 'professional':
      return 'Legacy professional (limited)';
    default:
      return 'Предварительный (QUICK)';
  }
}

/**
 * Short, mobile-friendly label for the PRIMARY mode buttons. The technical
 * "steady-state" term is kept out of the button and shown as secondary text,
 * so a normal user only sees "Предварительный" vs "Профессиональный".
 */
export function loadModePrimaryLabel(mode: BuildingLoadMode): string {
  if (mode === 'quick') return 'Предварительный';
  if (mode === 'steady_state') return 'Профессиональный';
  return 'Legacy professional';
}

export type ServiceChoice = 'heating' | 'cooling' | 'heating_and_cooling';

export function serviceChoiceFromServices(services: Array<'heating' | 'cooling'>): ServiceChoice | null {
  if (services.includes('heating') && services.includes('cooling')) return 'heating_and_cooling';
  if (services.includes('heating')) return 'heating';
  if (services.includes('cooling')) return 'cooling';
  return null;
}

export function serviceChoiceLabel(choice: ServiceChoice | null): string {
  switch (choice) {
    case 'heating_and_cooling': return 'Отопление + охлаждение';
    case 'cooling': return 'Охлаждение';
    case 'heating': return 'Отопление';
    default: return '—';
  }
}

export function serviceChoiceEmoji(choice: ServiceChoice | null): string {
  switch (choice) {
    case 'heating_and_cooling': return '🔥❄';
    case 'cooling': return '❄';
    case 'heating': return '🔥';
    default: return '•';
  }
}

/**
 * Primary user-facing load modes. `professional` (legacy) is kept only for
 * backward compatibility and must never compete with the normal user modes.
 */
export function primaryLoadModes(available: BuildingLoadMode[]): BuildingLoadMode[] {
  return available.filter((mode) => mode !== 'professional');
}

/** Legacy-only modes (currently just `professional`). */
export function legacyLoadModes(available: BuildingLoadMode[]): BuildingLoadMode[] {
  return available.includes('professional') ? ['professional'] : [];
}

export type MissingSectionKey = 'climate' | 'area' | 'envelope' | 'windows' | 'air' | 'internal';

export interface ReadinessItem {
  key: string;
  label: string;
  status: 'ready' | 'missing' | 'na';
  action?: string;
  /** UI section to open when the user taps the missing item. */
  sectionKey: MissingSectionKey;
}

export interface SteadyStateReadiness {
  ready: boolean;
  missingCount: number;
  summary: string;
  items: ReadinessItem[];
}

/**
 * The climate item is a project-level prerequisite. It is intentionally not
 * rendered inside the focused room form, which is restricted to room fields;
 * the existing readiness resolver remains the only source of item status.
 */
export function roomEditorReadinessItems(readiness: SteadyStateReadiness): ReadinessItem[] {
  return readiness.items.filter((item) => item.sectionKey !== 'climate');
}

export function roomEditorMissingCount(readiness: SteadyStateReadiness): number {
  return roomEditorReadinessItems(readiness).filter((item) => item.status === 'missing').length;
}

export function firstMissingSection(readiness: SteadyStateReadiness): MissingSectionKey | null {
  return roomEditorReadinessItems(readiness).find((item) => item.status === 'missing')?.sectionKey ?? null;
}

/** Primary UX labels for the three readiness states. Raw engineering codes stay Advanced-only. */
export function readinessStatusLabel(
  item: ReadinessItem | null | undefined,
  requestedServices: ReadonlyArray<'heating' | 'cooling'>,
): string {
  if (!item || item.status === 'na') return '— Не требуется';
  if (item.status === 'ready') return '✓ Готово';
  if (item.sectionKey === 'windows' && requestedServices.includes('cooling')) return '⚠ Обязательно для охлаждения';
  return '⚠ Обязательно';
}

/** Aggregate the actionable status of one editor section without hiding any
 * individual project-level completeness item. */
export function readinessItemForSection(
  readiness: SteadyStateReadiness | null | undefined,
  sectionKey: MissingSectionKey,
): ReadinessItem | undefined {
  const items = readiness?.items.filter((item) => item.sectionKey === sectionKey) ?? [];
  return items.find((item) => item.status === 'missing')
    ?? items.find((item) => item.status === 'ready')
    ?? items[0];
}

// The current steady-state climate dataset intentionally covers only these
// unambiguous region mappings. Keep readiness aligned with the backend rather
// than treating every catalog region as numerically supported.
const SUPPORTED_STEADY_STATE_CLIMATE_REGIONS = new Set(['AM-ER', 'AM-AV']);

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasElementArea(el: EnvelopeElement): boolean {
  if (el.areaM2 != null) return finiteNonNegative(el.areaM2);
  if (el.grossAreaM2 != null) return finiteNonNegative(el.grossAreaM2);
  return finiteNonNegative(el.widthM) && finiteNonNegative(el.heightM);
}

function hasElementU(el: EnvelopeElement, project: BuildingProject): boolean {
  if (el.uValue != null) return typeof el.uValue === 'number' && Number.isFinite(el.uValue) && el.uValue > 0;
  return el.constructionTier != null || project.insulationLevel !== 'unknown';
}

function hasResolvableEnvelope(project: BuildingProject, room: BuildingRoom): boolean {
  const env = room.envelope;
  if (!env) return false;
  const elements = [
    ...env.wallElements,
    ...env.windowElements,
    ...env.doorElements,
    ...env.roofElements,
    ...env.floorElements,
  ];
  if (elements.length === 0 || new Set(elements.map((el) => el.elementId)).size !== elements.length) return false;

  const openingAreas = new Map(
    [...env.windowElements, ...env.doorElements]
      .filter(hasElementArea)
      .map((el) => [el.elementId, el.areaM2 ?? el.grossAreaM2 ?? (el.widthM! * el.heightM!)] as const),
  );
  return elements.every((el) => {
    if (!hasElementArea(el) || !hasElementU(el, project)) return false;
    // A derived wall area is gross and must be able to subtract every hosted
    // opening without producing the backend's negative-area blocker.
    if (el.areaM2 == null && el.openingIds?.length) {
      const gross = el.grossAreaM2 ?? (el.widthM! * el.heightM!);
      const openings = el.openingIds.map((id) => openingAreas.get(id));
      return Number.isFinite(gross) && openings.every((value) => value != null)
        && openings.reduce((sum, value) => sum + (value || 0), 0) <= gross;
    }
    return true;
  });
}

function hasWindowArea(el: EnvelopeElement): boolean {
  return hasElementArea(el);
}

function windowNeedsThermal(el: EnvelopeElement): boolean {
  const shgc = el.shgc != null
    ? (typeof el.shgc === 'number' && Number.isFinite(el.shgc) && el.shgc >= 0 && el.shgc <= 1)
    : el.constructionTier != null;
  const shading = el.shadingFactor != null
    ? (typeof el.shadingFactor === 'number' && Number.isFinite(el.shadingFactor) && el.shadingFactor >= 0 && el.shadingFactor <= 1)
    : el.shadingProfile != null;
  return hasWindowArea(el) && el.orientation != null && shgc && shading;
}

function effectiveHeightReady(project: BuildingProject, room: BuildingRoom): boolean {
  const height = room.extras?.geometry?.ceilingHeightM ?? project.defaultCeilingHeightM;
  return typeof height === 'number' && Number.isFinite(height) && height > 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Which air inputs the steady-state engine still needs for this room, broken
 * down per ventilation mode so the consumer UI can ask for the exact missing
 * quantity instead of repeating "select ventilation and airtightness".
 *
 * Mirrors `computeRoomAir` (server):
 *   - natural / none → infiltration only;
 *   - supply_only → ventilation flow only;
 *   - exhaust_only / balanced → ventilation flow AND infiltration;
 *   - unknown/no choice → neither is resolvable yet (show the choice question).
 *
 * A resolved airtightness profile satisfies infiltration; a resolved
 * ventilation flow satisfies the fan/flow requirement. No flow/ACH value is
 * invented here — the engine remains the sole numeric authority.
 */
export interface AirRequiredInputs {
  ready: boolean;
  /** True when the engine's outdoor-air model needs an explicit ventilation flow (m³/h). */
  needsVentilationFlow: boolean;
  /** True when the engine needs an infiltration quantifier (ACH50 / ACH / airtightness). */
  needsInfiltration: boolean;
  /** True when the ventilation balance has not been chosen in a resolvable way. */
  missingMethod: boolean;
}

function hasInfiltrationQuantifier(air: RoomAir): boolean {
  return air.infiltrationFlowM3h != null
    ? finitePositive(air.infiltrationFlowM3h)
    : air.ach50 != null
      ? finitePositive(air.ach50)
      : air.airChangesPerHour != null
        ? finiteNonNegative(air.airChangesPerHour)
        : air.airtightnessClass != null;
}

export function airRequiredInputs(
  project: BuildingProject,
  room: BuildingRoom,
  _options: ReadinessOptions = {},
): AirRequiredInputs {
  const air: RoomAir | null = room.air ?? null;
  const heightReady = effectiveHeightReady(project, room);
  const balance: VentilationBalance = air?.ventilationBalance ?? 'unknown';
  const ventilation = air != null && finiteNonNegative(air.ventilationFlowM3h);
  const infiltration = air != null && hasInfiltrationQuantifier(air);

  let needsVentilationFlow = false;
  let needsInfiltration = false;
  let missingMethod = false;

  if (balance === 'none' || balance === 'natural') {
    needsInfiltration = true;
  } else if (balance === 'supply_only') {
    needsVentilationFlow = true;
  } else if (balance === 'exhaust_only' || balance === 'balanced') {
    needsVentilationFlow = true;
    needsInfiltration = true;
  } else {
    // unknown / no choice
    missingMethod = true;
  }

  const ventilationResolved = ventilation || !needsVentilationFlow;
  const infiltrationResolved = infiltration || !needsInfiltration;

  // Volume is required to turn a quantifier into a flow; without it nothing
  // resolves, so the gate stays incomplete (mirrors `resolveInfiltration`).
  const quantifierReady = heightReady && ventilationResolved && infiltrationResolved && !missingMethod;

  return {
    ready: quantifierReady,
    needsVentilationFlow: quantifierReady ? false : needsVentilationFlow && !ventilation,
    needsInfiltration: quantifierReady ? false : needsInfiltration && !infiltration,
    missingMethod: !quantifierReady && missingMethod,
  };
}

function hasAirQuantifier(project: BuildingProject, room: BuildingRoom): boolean {
  return airRequiredInputs(project, room).ready;
}

function hasInternalGains(project: BuildingProject, room: BuildingRoom): boolean {
  const input = room.internalGains;
  const areaReady = typeof room.areaM2 === 'number' && Number.isFinite(room.areaM2) && room.areaM2 > 0;
  const peopleReady = input?.peopleW != null
    ? finiteNonNegative(input.peopleW)
    : input?.occupancy != null
      ? Number.isInteger(input.occupancy) && input.occupancy >= 0
        && (input.occupantSensibleWPerPerson == null || (typeof input.occupantSensibleWPerPerson === 'number' && Number.isFinite(input.occupantSensibleWPerPerson) && input.occupantSensibleWPerPerson > 0))
      : getRoomOccupancySuggestion(room.roomType, project.objectType)?.calculationInput === true;
  const lightingReady = input?.lightingGainW == null ? areaReady : finiteNonNegative(input.lightingGainW);
  const equipmentReady = input?.equipmentGainW == null ? areaReady : finiteNonNegative(input.equipmentGainW);
  return peopleReady && lightingReady && equipmentReady;
}

export interface ReadinessOptions {
  /** Which services the calculation needs. Defaults to both (heating + cooling). */
  requestedServices?: Array<'heating' | 'cooling'>;
}

export function buildSteadyStateReadiness(project: BuildingProject, room: BuildingRoom, options: ReadinessOptions = {}): SteadyStateReadiness {
  // Solar and internal gains feed only the COOLING load in steady_state.v1
  // (heating = Q_tr + Q_air). Inputs the selected services cannot use are
  // `na`, never `missing`, so the user is never asked for irrelevant data.
  const coolingRequested = (options.requestedServices ?? ['heating', 'cooling']).includes('cooling');
  const items: ReadinessItem[] = [];

  const climateReady = project.region?.code != null && SUPPORTED_STEADY_STATE_CLIMATE_REGIONS.has(project.region.code);
  items.push({
    key: 'climate',
    sectionKey: 'climate',
    label: 'Климат',
    status: climateReady ? 'ready' : 'missing',
    action: climateReady ? undefined : 'Объект → выбрать регион.',
  });

  const areaReady = typeof room.areaM2 === 'number' && Number.isFinite(room.areaM2) && room.areaM2 > 0;
  items.push({
    key: 'area',
    sectionKey: 'area',
    label: 'Размеры помещения',
    status: areaReady ? 'ready' : 'missing',
    action: areaReady ? undefined : 'Помещения → указать площадь комнаты.',
  });

  const envelopeReady = hasResolvableEnvelope(project, room);
  items.push({
    key: 'envelope',
    sectionKey: 'envelope',
    label: 'Наружные ограждения',
    status: envelopeReady ? 'ready' : 'missing',
    action: envelopeReady ? undefined : 'Помещения → ⚙ → добавить и описать наружные ограждения.',
  });

  // Resolvable answers only "can the engine calculate the entered arrays?".
  // These declarations answer the separate question "did the user describe all
  // physically significant boundaries?". Missing arrays are never treated as
  // an implicit statement that the boundary/window does not exist.
  for (const issue of roomPhysicalCompleteness(project, room)) {
    items.push({
      key: issue.key,
      sectionKey: issue.sectionKey,
      label: issue.label,
      status: 'missing',
      action: issue.action,
    });
  }

  const windows = room.envelope?.windowElements ?? [];
  const windowsExplicitNone = room.extras?.windows?.count === 0 && windows.length === 0;
  let windowsStatus: ReadinessItem['status'] = windowsExplicitNone ? 'ready' : 'na';
  let windowsAction: string | undefined;
  if (coolingRequested && windows.length > 0) {
    if (new Set(windows.map((window) => window.elementId)).size === windows.length && windows.every(windowNeedsThermal)) {
      windowsStatus = 'ready';
    } else {
      windowsStatus = 'missing';
      windowsAction = 'Помещения → ⚙ → указать сторону света, размеры, тип окна и затенение.';
    }
  }
  items.push({ key: 'windows', sectionKey: 'windows', label: 'Параметры окон', status: windowsStatus, action: windowsAction });

  const airCheck = airRequiredInputs(project, room);
  items.push({
    key: 'air',
    sectionKey: 'air',
    label: 'Вентиляция',
    status: airCheck.ready ? 'ready' : 'missing',
    action: airCheck.ready
      ? undefined
      : airCheck.missingMethod
        ? 'Помещения → ⚙ → выбрать тип вентиляции и герметичность.'
        : airCheck.needsVentilationFlow
          ? 'Помещения → ⚙ → указать производительность вентиляции (м³/ч).'
          : 'Помещения → ⚙ → указать герметичность здания.',
  });

  const internalReady = hasInternalGains(project, room);
  items.push({
    key: 'internal',
    sectionKey: 'internal',
    label: 'Люди',
    status: coolingRequested ? (internalReady ? 'ready' : 'missing') : 'na',
    action: coolingRequested && !internalReady ? 'Помещения → ⚙ → указать количество людей.' : undefined,
  });

  const missingCount = items.filter((item) => item.status === 'missing').length;
  const ready = missingCount === 0;
  const unit = missingCount % 10 === 1 && missingCount % 100 !== 11
    ? 'пункт'
    : missingCount % 10 >= 2 && missingCount % 10 <= 4 && (missingCount % 100 < 10 || missingCount % 100 >= 20)
      ? 'пункта'
      : 'пунктов';

  return {
    ready,
    missingCount,
    summary: ready ? 'Готово к профессиональному расчёту' : `Нужно заполнить ${missingCount} ${unit}.`,
    items,
  };
}

export interface ProjectMissingItem {
  roomId: string;
  key: string;
  label: string;
  action?: string;
  sectionKey: MissingSectionKey;
}

export interface ProjectMissingRoom {
  roomId: string;
  roomName: string;
  roomType: string;
  count: number;
  items: ProjectMissingItem[];
}

export interface ProjectMissingSummary {
  totalMissing: number;
  rooms: ProjectMissingRoom[];
}

/**
 * Single actionable project-level summary of genuinely-blocking missing inputs.
 * Only `missing` readiness items are surfaced; `na` (irrelevant for the chosen
 * services) and `ready` (already known/inherited/derived/profile-resolved) are
 * never shown, so the user is not repeatedly asked for known data or for data
 * the selected calculation cannot use.
 */
export function buildProjectMissingSummary(
  project: BuildingProject,
  options: { requestedServices?: Array<'heating' | 'cooling'> } = {},
): ProjectMissingSummary {
  const rooms: ProjectMissingRoom[] = [];
  let totalMissing = 0;
  for (const room of project.rooms) {
    const readiness = buildSteadyStateReadiness(project, room, options);
    const items: ProjectMissingItem[] = readiness.items
      .filter((item) => item.status === 'missing')
      .map((item) => ({ roomId: room.id, key: item.key, label: item.label, action: item.action, sectionKey: item.sectionKey }));
    if (items.length) {
      totalMissing += items.length;
      rooms.push({ roomId: room.id, roomName: room.name, roomType: room.roomType, count: items.length, items });
    }
  }
  return { totalMissing, rooms };
}