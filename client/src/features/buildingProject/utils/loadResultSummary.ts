/**
 * Customer-facing load result summary + plain-Russian room explanations.
 *
 * The backend stays the only authority for load numbers: this module never
 * recomputes a heat loss. It only
 *   - derives the required heating capacity = base load × (1 + reserve),
 *     where the 20% reserve is an OhmX commercial margin (NOT a normative
 *     requirement) applied to the preliminary (QUICK) heating result only;
 *   - aggregates room values for the compact summary;
 *   - turns the server's methodInputs / coefficientTrace into simple steps,
 *     mentioning only factors the engine actually reported.
 *
 * The reserve is always derived from the raw server value at render time and
 * is never written back, so repeated recalculation cannot double-count it.
 */
import type { BuildingLoadCalculation, BuildingLoadMode, RoomLoadResult, ServiceLoadResult } from '../types';

/** OhmX commercial heating reserve for the preliminary calculation. */
export const HEATING_RESERVE_RATIO = 0.2;

export function heatingReserveRatio(mode: BuildingLoadMode | string | null | undefined): number {
  return mode === 'quick' ? HEATING_RESERVE_RATIO : 0;
}

export interface HeatingCapacity {
  /** Raw engine heating load, W (unchanged). */
  baseW: number;
  /** Reserve added on top, W. */
  reserveW: number;
  /** Required heating capacity = baseW + reserveW, W. */
  requiredW: number;
  reserveRatio: number;
}

export function heatingCapacity(baseW: number | null | undefined, reserveRatio: number): HeatingCapacity | null {
  if (baseW == null || !Number.isFinite(baseW)) return null;
  const reserveW = baseW * reserveRatio;
  return { baseW, reserveW, requiredW: baseW + reserveW, reserveRatio };
}

/** < 1000 W -> whole W; >= 1000 W -> kW with 2 decimals. Same rule as the Loads UI. */
export function formatPower(watts: number | null | undefined): string {
  if (watts == null || !Number.isFinite(watts)) return '—';
  if (watts < 1000) return `${Math.round(watts)} Вт`;
  return `${(watts / 1000).toFixed(2)} кВт`;
}

function formatNumber(value: number, maxDecimals = 2): string {
  return String(Number(value.toFixed(maxDecimals)));
}

function formatTemp(value: number): string {
  if (value > 0) return `+${formatNumber(value, 1)} °C`;
  if (value < 0) return `−${formatNumber(Math.abs(value), 1)} °C`;
  return '0 °C';
}

function formatFactor(value: number): string {
  return `×${value.toFixed(2)}`;
}

/** "Ереван, Агро (Երևան «Ագրո»)" -> "Ереван, Агро": drop the Armenian duplicate for customers. */
export function climateLabelRu(label: string | null | undefined): string | null {
  if (!label) return null;
  const cleaned = label.replace(/\s*\([^()]*[԰-֏][^()]*\)\s*$/u, '').trim();
  return cleaned || null;
}

export interface RoomResultSummary {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLabel: string | null;
  areaM2: number | null;
  heating: HeatingCapacity | null;
  heatingStatus: ServiceLoadResult['status'];
  coolingW: number | null;
  coolingStatus: ServiceLoadResult['status'];
}

export interface LoadResultSummary {
  totalAreaM2: number | null;
  roomCount: number;
  reserveRatio: number;
  showHeating: boolean;
  showCooling: boolean;
  heating: HeatingCapacity | null;
  coolingW: number | null;
  rooms: RoomResultSummary[];
}

function serviceShown(loads: BuildingLoadCalculation, service: 'heating' | 'cooling'): boolean {
  const requested = loads.inputSnapshot?.requestedServices;
  if (Array.isArray(requested) && requested.length > 0) return requested.includes(service);
  return loads.roomResults.some((room) => room[service].status !== 'not_requested');
}

function calculatedDemand(res: ServiceLoadResult): number | null {
  return res.status === 'calculated' && res.demandW != null && Number.isFinite(res.demandW) ? res.demandW : null;
}

/** Pure: never mutates `loads`. */
export function buildLoadResultSummary(loads: BuildingLoadCalculation): LoadResultSummary {
  const reserveRatio = heatingReserveRatio(loads.mode);
  const areas = loads.roomResults.map((room) => room.areaM2).filter((a): a is number => a != null && Number.isFinite(a));
  const rooms = loads.roomResults.map<RoomResultSummary>((room) => ({
    roomId: room.roomId,
    roomName: room.roomName,
    roomType: room.roomType,
    floorLabel: room.floorLabel,
    areaM2: room.areaM2,
    heating: heatingCapacity(calculatedDemand(room.heating), reserveRatio),
    heatingStatus: room.heating.status,
    coolingW: calculatedDemand(room.cooling),
    coolingStatus: room.cooling.status,
  }));
  return {
    totalAreaM2: areas.length ? areas.reduce((sum, a) => sum + a, 0) : null,
    roomCount: loads.roomResults.length,
    reserveRatio,
    showHeating: serviceShown(loads, 'heating'),
    showCooling: serviceShown(loads, 'cooling'),
    // Object totals come from the server (sum of eligible rooms, null when
    // incomplete); reserve is linear, so it equals the sum of room reserves.
    heating: heatingCapacity(loads.heatingDemandW, reserveRatio),
    coolingW: loads.coolingDemandW ?? null,
    rooms,
  };
}

// ---------------------------------------------------------------------------
// Plain-Russian explanations
// ---------------------------------------------------------------------------

export interface RoomExplanation {
  steps: string[];
  /** What the customer may specify to get a more accurate result. */
  refine: string[];
  note: string | null;
}

function num(source: Record<string, unknown> | undefined, key: string): number | null {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value ? value : null;
}

const INSULATION_RU: Record<string, string> = {
  good: 'хорошее',
  medium: 'среднее',
  poor: 'слабое',
  unknown: 'не указано, принято типовое',
};

const FLOOR_EXPOSURE_RU: Record<string, string> = {
  top: 'помещение под кровлей',
  ground: 'помещение над грунтом или неотапливаемым помещением',
  roof_plus_unheated_below: 'помещение под кровлей и над неотапливаемым помещением',
  middle: 'помещение между отапливаемыми этажами',
};

const GLAZING_RU: Record<string, string> = {
  standard: 'обычные окна',
  large: 'большие окна',
  panoramic: 'панорамное остекление',
  stained: 'витражное остекление',
};

function wallsRu(count: number): string {
  if (count === 0) return 'нет наружных стен';
  if (count === 1) return '1 наружная стена';
  if (count < 5) return `${count} наружные стены`;
  return `${count} наружных стен`;
}

const REFINE_HINTS: Record<string, string> = {
  external_wall_count_not_provided: 'количество наружных стен',
  floor_exposure_not_provided: 'положение помещения (под кровлей, над грунтом или между этажами)',
  quick_default_indoor_temperature: 'назначение помещения (от него зависит температура внутри)',
  quick_specific_load_outlier: 'площадь и высоту потолка — результат на 1 м² необычно большой или маленький',
  height_outside_quick_reference_range: 'высоту потолка — она вне типового диапазона упрощённой оценки',
};

function refineList(res: ServiceLoadResult): string[] {
  const out: string[] = [];
  for (const code of res.warnings || []) {
    const hint = REFINE_HINTS[code];
    if (hint && !out.includes(hint)) out.push(hint);
  }
  return out;
}

function reserveSteps(capacity: HeatingCapacity, steps: string[]) {
  if (capacity.reserveRatio > 0) {
    steps.push(`Дополнительный запас ${Math.round(capacity.reserveRatio * 100)}%: ${formatPower(capacity.reserveW)}.`);
    steps.push(`Итоговая необходимая мощность отопления: ${formatPower(capacity.requiredW)}.`);
  } else {
    steps.push(`Необходимая мощность отопления: ${formatPower(capacity.requiredW)} (запас в этом расчёте не добавляется).`);
  }
}

function areaStep(room: RoomLoadResult, inputs: Record<string, unknown> | undefined): string | null {
  const area = num(inputs, 'areaM2') ?? room.areaM2;
  const height = num(inputs, 'effectiveHeightM') ?? room.effectiveCeilingHeightM;
  const volume = num(inputs, 'volumeM3');
  if (area == null) return null;
  const parts = [`Площадь помещения: ${formatNumber(area, 1)} м²`];
  if (height != null) parts.push(`высота потолка: ${formatNumber(height, 2)} м`);
  if (volume != null) parts.push(`объём: ${formatNumber(volume, 1)} м³`);
  return `${parts.join(', ')}.`;
}

function quickHeatingSteps(room: RoomLoadResult, capacity: HeatingCapacity): RoomExplanation {
  const res = room.heating;
  const inputs = res.methodInputs as Record<string, unknown> | undefined;
  const trace = res.coefficientTrace as Record<string, unknown> | undefined;
  const steps: string[] = [];
  const area = areaStep(room, inputs);
  if (area) steps.push(area);

  const indoor = num(inputs, 'indoorDesignC');
  const outdoor = num(inputs, 'outdoorDesignC');
  const volume = num(inputs, 'volumeM3');
  const kEnvelope = num(trace, 'kEnvelope');
  if (indoor != null && outdoor != null) {
    steps.push(`Температура в помещении: ${formatTemp(indoor)}, расчётная зимняя температура на улице: ${formatTemp(outdoor)} — разница ${formatNumber(indoor - outdoor, 1)} °C.`);
  }
  const insulation = str(inputs, 'insulationLevel');
  if (kEnvelope != null) {
    steps.push(`Утепление: ${INSULATION_RU[insulation || 'unknown'] || INSULATION_RU.unknown} — потери ${formatNumber(kEnvelope)} Вт на каждый м³ объёма и каждый градус разницы температур.`);
  }

  const applied: Array<{ label: string; k: number }> = [];
  const unknown: string[] = [];
  const walls = num(inputs, 'externalWallCount');
  const kExternal = num(trace, 'kExternal');
  if (walls != null && kExternal != null) applied.push({ label: wallsRu(walls), k: kExternal });
  else unknown.push('количество наружных стен');
  const exposure = str(inputs, 'floorExposure');
  const kFloor = num(trace, 'kFloor');
  if (exposure && exposure !== 'unknown' && kFloor != null) applied.push({ label: FLOOR_EXPOSURE_RU[exposure] || exposure, k: kFloor });
  else unknown.push('положение по этажу');
  const glazing = str(inputs, 'glazingType');
  const kGlazing = num(trace, 'kGlazing');
  if (glazing && kGlazing != null) applied.push({ label: GLAZING_RU[glazing] || glazing, k: kGlazing });
  else unknown.push('тип окон');
  if (applied.length) {
    steps.push(`Учтено: ${applied.map((a) => `${a.label} ${formatFactor(a.k)}`).join('; ')}.`);
  }
  if (unknown.length) steps.push(`Не указано, принято без поправки: ${unknown.join(', ')}.`);

  // Show the arithmetic only when the reported inputs reproduce the server value.
  const factors = [kExternal ?? 1, kFloor ?? 1, kGlazing ?? 1, num(trace, 'kSolarHeating') ?? 1];
  let formula = '';
  if (volume != null && indoor != null && outdoor != null && kEnvelope != null) {
    const product = volume * (indoor - outdoor) * kEnvelope * factors.reduce((p, k) => p * k, 1);
    if (Math.abs(product - capacity.baseW) <= Math.max(1, capacity.baseW * 0.005)) {
      const extra = factors.some((k) => k !== 1) ? ' × поправки' : '';
      formula = ` (${formatNumber(volume, 1)} м³ × ${formatNumber(indoor - outdoor, 1)} °C × ${formatNumber(kEnvelope)}${extra})`;
    }
  }
  steps.push(`Исходная потребность в отоплении: ${formatPower(capacity.baseW)}${formula}.`);
  reserveSteps(capacity, steps);
  return {
    steps,
    refine: refineList(res),
    note: 'Упрощённая оценка по объёму помещения и разнице температур. Потери через каждую стену, окно, пол и вентиляцию отдельно не считаются — для этого есть профессиональный расчёт.',
  };
}

function steadyHeatingSteps(room: RoomLoadResult, capacity: HeatingCapacity): RoomExplanation {
  const res = room.heating;
  const inputs = res.methodInputs as Record<string, unknown> | undefined;
  const steps: string[] = [];
  const area = areaStep(room, inputs);
  if (area) steps.push(area);
  const indoor = num(inputs, 'indoorC');
  const outdoor = num(inputs, 'outdoorC');
  if (indoor != null && outdoor != null) {
    steps.push(`Температура в помещении: ${formatTemp(indoor)}, расчётная зимняя температура на улице: ${formatTemp(outdoor)}.`);
  }
  const trans = num(inputs, 'transmissionHeatingW');
  const air = num(inputs, 'airHeatingW');
  if (trans != null) steps.push(`Теплопотери через стены, окна, пол и потолок: ${formatPower(trans)}.`);
  if (air != null) steps.push(`Нагрев наружного воздуха (вентиляция и щели): ${formatPower(air)}.`);
  steps.push(`Исходная потребность в отоплении: ${formatPower(capacity.baseW)}.`);
  reserveSteps(capacity, steps);
  return { steps, refine: [], note: null };
}

function genericHeatingSteps(room: RoomLoadResult, capacity: HeatingCapacity): RoomExplanation {
  const steps: string[] = [];
  const area = areaStep(room, room.heating.methodInputs as Record<string, unknown> | undefined);
  if (area) steps.push(area);
  steps.push(`Исходная потребность в отоплении: ${formatPower(capacity.baseW)}.`);
  reserveSteps(capacity, steps);
  return { steps, refine: refineList(room.heating), note: null };
}

export function explainRoomHeating(room: RoomLoadResult, mode: BuildingLoadMode | string): RoomExplanation | null {
  const capacity = heatingCapacity(calculatedDemand(room.heating), heatingReserveRatio(mode));
  if (!capacity) return null;
  if (mode === 'quick' && room.heating.methodInputs) return quickHeatingSteps(room, capacity);
  if (mode === 'steady_state' && room.heating.methodInputs) return steadyHeatingSteps(room, capacity);
  return genericHeatingSteps(room, capacity);
}

export function explainRoomCooling(room: RoomLoadResult, mode: BuildingLoadMode | string): RoomExplanation | null {
  const demandW = calculatedDemand(room.cooling);
  if (demandW == null) return null;
  const res = room.cooling;
  const inputs = res.methodInputs as Record<string, unknown> | undefined;
  const trace = res.coefficientTrace as Record<string, unknown> | undefined;
  const steps: string[] = [];
  const indoor = num(inputs, 'indoorDesignC') ?? num(inputs, 'indoorC');
  const outdoor = num(inputs, 'outdoorDesignC') ?? num(inputs, 'outdoorC');
  if (indoor != null && outdoor != null) {
    steps.push(`Летом: в помещении ${formatTemp(indoor)}, на улице ${formatTemp(outdoor)}.`);
  }
  let note: string | null = null;
  if (mode === 'quick') {
    const base = num(trace, 'baseWm2');
    if (base != null) steps.push(`Базовая нагрузка: ${formatNumber(base)} Вт на 1 м², далее поправки на высоту, утепление, стены, этаж, окна и климат.`);
    const factors = [
      ['высота', num(trace, 'kHeight')],
      ['утепление', num(trace, 'kInsulation')],
      ['наружные стены', num(trace, 'kExternal')],
      ['этаж', num(trace, 'kFloor')],
      ['окна', num(trace, 'kGlazing')],
      ['климат', num(trace, 'kClimateCooling')],
    ].filter((item): item is [string, number] => item[1] != null && item[1] !== 1);
    if (factors.length) steps.push(`Поправки: ${factors.map(([label, k]) => `${label} ${formatFactor(k)}`).join('; ')}.`);
    note = 'Тепло от людей и техники, стороны света окон и вентиляция в упрощённой оценке охлаждения отдельно не учитываются.';
  } else if (mode === 'steady_state') {
    const parts = [
      ['через стены, окна и перекрытия', num(inputs, 'transmissionCoolingW')],
      ['с наружным воздухом', num(inputs, 'airCoolingW')],
      ['от солнца через окна', num(inputs, 'solarCoolingW')],
      ['от людей, освещения и техники', num(inputs, 'internalCoolingW')],
    ].filter((item): item is [string, number] => item[1] != null);
    for (const [label, w] of parts) steps.push(`Теплопритоки ${label}: ${formatPower(w)}.`);
  }
  steps.push(`Необходимая мощность охлаждения: ${formatPower(demandW)} (запас не добавляется).`);
  return { steps, refine: refineList(res), note };
}
