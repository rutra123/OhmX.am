/**
 * Building Project Phase 3 + 3.1 — Loads Engine v1 (QUICK numeric).
 *
 * Loads = heating/cooling DEMAND of the object and its rooms. This layer NEVER
 * selects equipment, never sizes boilers/chillers/radiators/pipes/pumps and
 * never emits SKUs. Equipment sizing is a downstream (Phase 4) concern.
 *
 * PHASE 3 (base): gate order, stale semantics, null-vs-zero, object-total
 * invariant, input snapshots, professional-mode honesty.
 *
 * PHASE 3.1 (this file): OhmX QUICK Load v1 (`ohmx.quick-load.v1`, 1.0.0) is
 * ACTIVE as a numeric preliminary estimate when a verified official climate
 * location resolves for the project region. The numeric math lives in
 * buildingProjectQuickLoadV1.ts (pure; coefficients single source of truth +
 * vendored climate dataset armenia-hhsn-22-01-2024). Regions without an
 * unambiguous official mapping produce `missing_climate_location` — never an
 * invented number.
 *
 * PROFESSIONAL remains LIMITED: no U-values, envelope areas, window U/SHGC,
 * infiltration/ventilation, solar, internal gains, latent model, detailed
 * thermal zones. QUICK coefficients are never reused inside Professional.
 *
 * Determinism: same project + mode -> identical engineering fields. The only
 * timestamp is calculatedAt (metadata, not engineering).
 */
import { isSystemsConfigurationStale } from './buildingProjectSystems.js';
import {
  climateDatasetSupportedRegions,
  getClimateDatasetMeta,
  QUICK_METHOD_ID,
  QUICK_METHOD_VERSION,
  quickServiceResult,
  resolveClimateLocation,
} from './buildingProjectQuickLoadV1.js';
import {
  computeRoomTransmission,
  roomTransmissionBreakdown,
  STEADY_STATE_METHOD_ID,
  STEADY_STATE_METHOD_VERSION,
  type RoomTransmissionResult,
} from './buildingProjectTransmission.js';
import { computeRoomAir, type RoomAirResult } from './buildingProjectAir.js';
import {
  computeRoomSolar,
  roomSolarBreakdown,
  type RoomSolarResult,
} from './buildingProjectSolar.js';
import {
  computeRoomInternal,
  roomInternalBreakdown,
  type RoomInternalResult,
} from './buildingProjectInternal.js';
import { getSolarIrradiance } from './buildingProjectSolarData.js';
import type {
  BuildingLoadCalculation,
  BuildingLoadInputSnapshot,
  BuildingLoadMode,
  BuildingProject,
  BuildingRoom,
  EngineeringRoomAssignment,
  RoomLoadResult,
  ServiceLoadResult,
  ServicePreference,
  TransmissionBreakdown,
} from './buildingProjectTypes.js';

/** Canonical method registry — QUICK is active (Phase 3.1), Professional stays limited. */
export const LOAD_METHODS = {
  quick: {
    id: QUICK_METHOD_ID,
    version: QUICK_METHOD_VERSION,
    status: 'active' as const,
  },
  professional: {
    id: 'building.loads.professional',
    version: '0-limited',
    status: 'limited' as const,
  },
  steadyState: {
    id: STEADY_STATE_METHOD_ID,
    version: STEADY_STATE_METHOD_VERSION,
    status: 'active' as const,
  },
} as const;

/**
 * @deprecated Phase 3.1 activates QUICK. Kept for import compatibility; the
 * blocker text no longer describes the QUICK method state.
 */
export const QUICK_METHOD_BLOCKED =
  'QUICK NUMERIC METHOD BLOCKED: no approved Building Project coefficient set found.';

/** Professional-mode blocker: honest, no fake precision. */
export const PROFESSIONAL_METHOD_LIMITED =
  'Профессиональный теплотехнический расчёт ограничен до заполнения/подключения необходимых исходных коэффициентов.';

/** Inputs a professional method would need before any numeric result. */
export const PROFESSIONAL_MISSING_INPUTS = [
  'climate_design_temperatures:missing',
  'u_values:missing',
  'envelope_areas:missing',
  'infiltration_or_ventilation_method:missing',
  'solar_and_orientation_methodology:missing',
  'internal_gains_methodology:missing',
];

/** Inputs the QUICK v1 method may report as missing for a numeric result. */
export const QUICK_MISSING_INPUTS = [
  'climate_location:missing_climate_location',
  'room_area:missing',
  'room_height:missing',
];

export interface LoadPrerequisitesResult {
  ok: boolean;
  code: string | null;
  message: string | null;
  details?: unknown;
}

/**
 * Structured prerequisite gate (backend authority). The service converts a
 * failing result into BuildingProjectError; the route maps it to a 409.
 * Order: object confirmed -> systems confirmed -> systems not stale ->
 * systems validation has no blockers.
 */
export function checkLoadPrerequisites(project: BuildingProject): LoadPrerequisitesResult {
  if (project.status === 'draft' || !project.objectConfirmedAt) {
    return { ok: false, code: 'building.object_not_confirmed', message: 'Confirm the object before calculating loads' };
  }
  const systemsConfirmed = project.status === 'systems_configured' && Boolean(project.systemsConfigurationSnapshot);
  if (isSystemsConfigurationStale(project)) {
    return { ok: false, code: 'building.systems_stale', message: 'Systems configuration is stale. Reconfirm systems before calculating loads' };
  }
  if (!systemsConfirmed) {
    return { ok: false, code: 'building.systems_not_confirmed', message: 'Confirm systems before calculating loads' };
  }
  const config = project.systemsConfiguration || project.systemsConfigurationSnapshot;
  if (config?.validation && !config.validation.ready) {
    return {
      ok: false,
      code: 'building.systems_not_ready',
      message: 'Systems validation has blockers. Resolve them and reconfirm systems before calculating loads',
      details: { blockers: config.validation.blockers },
    };
  }
  return { ok: true, code: null, message: null };
}

/** Derived staleness — never mutates the persisted historical result. */
export function isLoadStale(
  project: BuildingProject,
  calc: BuildingLoadCalculation | null | undefined,
): boolean {
  if (!calc) return false;
  return (
    Number(project.buildingRevision || 0) !== Number(calc.buildingRevisionAtCalculation || 0) ||
    Number(project.systemsRevision || 0) !== Number(calc.systemsRevisionAtCalculation || 0)
  );
}

function floorLabelOf(project: BuildingProject, floorId: string | null): string | null {
  if (!floorId) return null;
  return project.topology?.floors.find((f) => f.id === floorId)?.label || null;
}

function effectiveCeilingHeightM(project: BuildingProject, room: BuildingRoom): number | null {
  const override = room.extras?.geometry?.ceilingHeightM ?? null;
  if (override != null && Number.isFinite(override) && override > 0) return override;
  return project.defaultCeilingHeightM ?? null;
}

function preferenceFor(
  assignment: EngineeringRoomAssignment | undefined,
  service: 'heating' | 'cooling',
  fallback: ServicePreference,
): ServicePreference {
  const value = assignment?.servicePreferences?.[service];
  return value === 'required' || value === 'optional' || value === 'not_required' ? value : fallback;
}

/**
 * Deep-copy a nested engineering input for the snapshot. JSON round-trip
 * coerces NaN/Infinity to `null` (they never leak into a historical snapshot)
 * and fully detaches nested arrays/objects (immutable snapshot — later room
 * edits must not alter a captured snapshot).
 */
function snapshotDeepCopy<T>(value: T | null | undefined): T | null {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Immutable input snapshot — only what the engine actually consumes. */
export function buildLoadInputSnapshot(
  project: BuildingProject,
  mode: BuildingLoadMode,
  methodVersion: string,
): BuildingLoadInputSnapshot {
  const config = project.systemsConfiguration || project.systemsConfigurationSnapshot || null;
  const assignments = config?.roomAssignments || [];
  const requested = (config?.requestedServices || []).filter(
    (s): s is 'heating' | 'cooling' => s === 'heating' || s === 'cooling',
  );
  const assignmentByRoom = new Map(assignments.map((a) => [a.roomId, a]));
  return {
    projectId: project.id,
    objectType: project.objectType,
    region: project.region ? { ...project.region } : null,
    defaultCeilingHeightM: project.defaultCeilingHeightM,
    insulationLevel: project.insulationLevel,
    topology: project.topology ? JSON.parse(JSON.stringify(project.topology)) : null,
    rooms: project.rooms.map((room) => ({
      id: room.id,
      roomType: room.roomType,
      name: room.name,
      areaM2: room.areaM2,
      floorId: room.floorId || null,
      ceilingHeightOverrideM: room.extras?.geometry?.ceilingHeightM ?? null,
      externalWallCount: room.extras?.geometry?.externalWallCount ?? null,
      externalDoorCount: room.extras?.geometry?.externalDoorCount ?? null,
      floorPosition: room.extras?.geometry?.floorPosition ?? null,
      spaceAbove: room.extras?.geometry?.spaceAbove ?? null,
      spaceBelow: room.extras?.geometry?.spaceBelow ?? null,
      insulationOverride: room.extras?.insulationOverride ?? null,
      conditions: [...(room.extras?.conditions || [])],
      windows: {
        glazingType: room.extras?.windows?.glazingType ?? null,
        count: room.extras?.windows?.count ?? null,
        areaM2: room.extras?.windows?.areaM2 ?? null,
      },
      envelope: snapshotDeepCopy(room.envelope ?? null),
      air: snapshotDeepCopy(room.air ?? null),
      internalGains: snapshotDeepCopy(room.internalGains ?? null),
    })),
    requestedServices: requested,
    servicePreferences: project.rooms.map((room) => {
      const assignment = assignmentByRoom.get(room.id);
      return {
        roomId: room.id,
        heating: preferenceFor(assignment, 'heating', 'optional'),
        cooling: preferenceFor(assignment, 'cooling', 'optional'),
      };
    }),
    buildingRevision: project.buildingRevision,
    systemsRevision: project.systemsRevision,
    mode,
    methodVersion,
  };
}

/**
 * Object total invariant helper (Phase 3 contract): object load = raw sum of
 * ELIGIBLE room loads; never an independent formula. Returns null +
 * complete=false when any eligible room lacks a numeric result. Eligible =
 * rooms where the service is requested and not_required.
 */
export function sumEligibleRoomLoads(
  roomResults: RoomLoadResult[],
  service: 'heating' | 'cooling',
): { demandW: number | null; complete: boolean; eligibleCount: number } {
  let sum = 0;
  let eligibleCount = 0;
  let complete = true;
  for (const room of roomResults) {
    const res = service === 'heating' ? room.heating : room.cooling;
    if (res.status === 'not_requested' || res.status === 'not_required') continue;
    eligibleCount += 1;
    if (res.demandW == null) {
      complete = false;
      continue;
    }
    sum += res.demandW;
  }
  if (eligibleCount === 0) return { demandW: null, complete, eligibleCount };
  return { demandW: complete ? sum : null, complete, eligibleCount };
}

/** Sum of rooms with an actual numeric result (partial, never a design load). */
export function sumCalculatedRoomLoads(
  roomResults: RoomLoadResult[],
  service: 'heating' | 'cooling',
): { partialDemandW: number | null; calculatedCount: number; eligibleCount: number } {
  let sum = 0;
  let calculatedCount = 0;
  let eligibleCount = 0;
  for (const room of roomResults) {
    const res = service === 'heating' ? room.heating : room.cooling;
    if (res.status === 'not_requested' || res.status === 'not_required') continue;
    eligibleCount += 1;
    const d = res.demandW ?? res.partialDemandW;
    if (d == null) continue;
    calculatedCount += 1;
    sum += d;
  }
  return {
    partialDemandW: calculatedCount > 0 ? sum : null,
    calculatedCount,
    eligibleCount,
  };
}

/**
 * Object-level indicative band: raw sum of eligible room demandRangeW
 * (presentation band only — not a confidence interval). Null when not every
 * eligible room carries a numeric range.
 */
export function sumRoomRanges(
  roomResults: RoomLoadResult[],
  service: 'heating' | 'cooling',
): { min: number; max: number } | null {
  let min = 0;
  let max = 0;
  let counted = 0;
  for (const room of roomResults) {
    const res = service === 'heating' ? room.heating : room.cooling;
    if (res.status === 'not_requested' || res.status === 'not_required') continue;
    if (res.demandW == null || !res.demandRangeW) return null;
    min += res.demandRangeW.min;
    max += res.demandRangeW.max;
    counted += 1;
  }
  if (counted === 0) return null;
  return { min, max };
}

function requestedServicesOf(project: BuildingProject): Array<'heating' | 'cooling'> {
  const config = project.systemsConfiguration || project.systemsConfigurationSnapshot || null;
  return (config?.requestedServices || []).filter(
    (s): s is 'heating' | 'cooling' => s === 'heating' || s === 'cooling',
  );
}

function assignmentsByRoom(project: BuildingProject): Map<string, EngineeringRoomAssignment> {
  const config = project.systemsConfiguration || project.systemsConfigurationSnapshot || null;
  return new Map((config?.roomAssignments || []).map((a) => [a.roomId, a] as [string, EngineeringRoomAssignment]));
}

function serviceNotRequested(service: 'heating' | 'cooling'): ServiceLoadResult {
  return { status: 'not_requested', demandW: null, demandRangeW: null, assumptions: [], warnings: [], missingInputs: [] };
}

function serviceNotRequired(): ServiceLoadResult {
  return {
    status: 'not_required',
    demandW: null,
    demandRangeW: null,
    assumptions: ['Пользователь указал сервис как не требующийся в этом помещении. Отсутствие результата не означает доказанную нулевую нагрузку.'],
    warnings: [],
    missingInputs: [],
  };
}

function serviceLimited(
  reason: string,
  missingInputs: string[],
): ServiceLoadResult {
  return {
    status: 'limited',
    demandW: null,
    demandRangeW: null,
    assumptions: [],
    warnings: [reason],
    missingInputs,
  };
}

/**
 * Phase 3.1 — numeric QUICK calculation. Professional remains limited.
 * Object total = raw sum of eligible room results; incomplete when any
 * eligible room is missing an input (partial sums explicitly marked).
 */
export function computeBuildingLoads(
  project: BuildingProject,
  mode: BuildingLoadMode,
): BuildingLoadCalculation {
  if (mode === 'professional') return computeProfessionalLoads(project);
  if (mode === 'steady_state') return computeSteadyStateLoads(project);
  return computeQuickLoads(project);
}

function computeProfessionalLoads(project: BuildingProject): BuildingLoadCalculation {
  const method = LOAD_METHODS.professional;
  const reason = PROFESSIONAL_METHOD_LIMITED;
  const missingForMode = PROFESSIONAL_MISSING_INPUTS;
  const requested = requestedServicesOf(project);
  const assignmentByRoom = assignmentsByRoom(project);

  const roomResults: RoomLoadResult[] = project.rooms.map((room) => {
    const assignment = assignmentByRoom.get(room.id);
    const heatingPref = preferenceFor(assignment, 'heating', requested.includes('heating') ? 'required' : 'not_required');
    const coolingPref = preferenceFor(assignment, 'cooling', requested.includes('cooling') ? 'required' : 'not_required');
    const heating = !requested.includes('heating')
      ? serviceNotRequested('heating')
      : heatingPref === 'not_required'
        ? serviceNotRequired()
        : serviceLimited(reason, missingForMode);
    const cooling = !requested.includes('cooling')
      ? serviceNotRequested('cooling')
      : coolingPref === 'not_required'
        ? serviceNotRequired()
        : serviceLimited(reason, missingForMode);
    return {
      roomId: room.id,
      roomName: room.name,
      roomType: room.roomType,
      floorId: room.floorId || null,
      floorLabel: floorLabelOf(project, room.floorId || null),
      areaM2: room.areaM2,
      effectiveCeilingHeightM: effectiveCeilingHeightM(project, room),
      heating,
      cooling,
    };
  });

  const warnings = [reason];
  const missingInputs = [...missingForMode];
  const assumptions = [
    'Профессиональный метод не активирован: отсутствует доказанный набор климатических и ограждающих коэффициентов.',
    'Результат является статусом расчёта, а не мощностью оборудования. Выбор оборудования — отдельная фаза.',
  ];

  const inputSnapshot = buildLoadInputSnapshot(project, 'professional', method.version);

  return {
    mode: 'professional',
    status: 'limited',
    methodId: method.id,
    methodVersion: method.version,
    buildingRevisionAtCalculation: project.buildingRevision,
    systemsRevisionAtCalculation: project.systemsRevision,
    roomResults,
    heatingDemandW: null,
    coolingDemandW: null,
    climateDatasetId: null,
    climateDatasetVersion: null,
    climateLocationId: null,
    climateLocationLabel: null,
    warnings,
    missingInputs,
    assumptions,
    inputSnapshot,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Phase 3.2a — Steady-State physical method (transmission component only).
 * Transmission = Σ(U×A)×ΔT per room; ventilation/infiltration, solar and
 * internal gains are NOT yet modeled and are explicitly listed as pending.
 */
function computeSteadyStateLoads(project: BuildingProject): BuildingLoadCalculation {
  const method = LOAD_METHODS.steadyState;
  const requested = requestedServicesOf(project);
  const assignmentByRoom = assignmentsByRoom(project);
  const rawLocation = resolveClimateLocation(project.region?.code);
  const location = rawLocation
    ? { ...rawLocation, solarIrradianceByOrientation: getSolarIrradiance(rawLocation.id) }
    : null;
  const climateMeta = getClimateDatasetMeta();

  const roomResults: RoomLoadResult[] = project.rooms.map((room) => {
    const assignment = assignmentByRoom.get(room.id);
    const heatingPref = preferenceFor(assignment, 'heating', requested.includes('heating') ? 'required' : 'not_required');
    const coolingPref = preferenceFor(assignment, 'cooling', requested.includes('cooling') ? 'required' : 'not_required');

    const transmission = computeRoomTransmission(project, room, location);
    const transmissionBreakdown = roomTransmissionBreakdown(transmission);
    const air = computeRoomAir(project, room, location);
    const solar = computeRoomSolar(project, room, location);
    const solarBreakdown = roomSolarBreakdown(solar);
    const internal = computeRoomInternal(project, room);
    const internalBreakdown = roomInternalBreakdown(internal);

    const heating = !requested.includes('heating')
      ? serviceNotRequested('heating')
      : heatingPref === 'not_required'
        ? serviceNotRequired()
        : steadyStateServiceResult('heating', room, transmission, transmissionBreakdown, air, solar, internal);
    const cooling = !requested.includes('cooling')
      ? serviceNotRequested('cooling')
      : coolingPref === 'not_required'
        ? serviceNotRequired()
        : steadyStateServiceResult('cooling', room, transmission, transmissionBreakdown, air, solar, internal);

    return {
      roomId: room.id,
      roomName: room.name,
      roomType: room.roomType,
      floorId: room.floorId || null,
      floorLabel: floorLabelOf(project, room.floorId || null),
      areaM2: room.areaM2,
      effectiveCeilingHeightM: effectiveCeilingHeightM(project, room),
      heating,
      cooling,
      transmissionBreakdown,
      airBreakdown: air.breakdown,
      solarBreakdown,
      internalGainsBreakdown: internalBreakdown,
    };
  });

  const heatingSum = sumEligibleRoomLoads(roomResults, 'heating');
  const coolingSum = sumEligibleRoomLoads(roomResults, 'cooling');
  const heatingPartial = sumCalculatedRoomLoads(roomResults, 'heating');
  const coolingPartial = sumCalculatedRoomLoads(roomResults, 'cooling');

  const warnings: string[] = [];
  if (location == null) warnings.push('climate_location:missing_climate_location');
  if (heatingSum.eligibleCount > 0 && !heatingSum.complete) warnings.push('object_heating_total:incomplete');
  if (coolingSum.eligibleCount > 0 && !coolingSum.complete) warnings.push('object_cooling_total:incomplete');

  const missingInputs: string[] = [];
  const seen = new Set<string>();
  for (const room of roomResults) {
    for (const item of [...room.heating.missingInputs, ...room.cooling.missingInputs]) {
      if (!seen.has(item)) {
        seen.add(item);
        missingInputs.push(item);
      }
    }
  }

  const status =
    (heatingSum.eligibleCount === 0 || heatingSum.complete) &&
    (coolingSum.eligibleCount === 0 || coolingSum.complete)
      ? 'calculated'
      : 'incomplete';

  const inputSnapshot = buildLoadInputSnapshot(project, 'steady_state', method.version);

  return {
    mode: 'steady_state',
    status,
    methodId: method.id,
    methodVersion: method.version,
    buildingRevisionAtCalculation: project.buildingRevision,
    systemsRevisionAtCalculation: project.systemsRevision,
    roomResults,
    heatingDemandW: heatingSum.demandW,
    coolingDemandW: coolingSum.demandW,
    heatingRangeW: null,
    coolingRangeW: null,
    partialHeatingDemandW: heatingSum.complete ? null : heatingPartial.partialDemandW,
    partialCoolingDemandW: coolingSum.complete ? null : coolingPartial.partialDemandW,
    climateDatasetId: location ? (climateMeta?.datasetId ?? null) : null,
    climateDatasetVersion: location ? (climateMeta?.datasetVersion ?? null) : null,
    climateLocationId: location ? location.id : null,
    climateLocationLabel: location ? `${location.labelRu} (${location.labelHy})` : null,
    warnings,
    missingInputs,
    assumptions: [
      'OhmX Steady-State v1 — физический расчёт теплопередачи, воздушной нагрузки, солнечных и внутренних теплопритоков. Предварительный физический расчёт, не заменяет полный теплотехнический расчёт.',
      'Нагрузка — потребность здания/помещения, а не мощность оборудования. Резерв на подбор оборудования не добавляется.',
      'Phase 3.2e: солнечные теплопритоки используют вендоренный набор солнечной радиации (PVGIS SARAH3+ERA5, 2005–2023, изотропная транспозиция, пик июня–августа); для локации без данных солнечная составляющая помечается missing, а охлаждение — limited/incomplete.',
    ],
    limitations: [
      'solar irradiance: PVGIS TMY (SARAH3+ERA5) + isotropic sky transposition to vertical, June-August peak (APPROVED_WITH_LIMITATION)',
      'SHGC / shading factors: profile values (APPROVED_WITH_LIMITATION)',
      'internal gains: sensible-only (no latent), profiles (APPROVED_WITH_LIMITATION)',
    ],
    pendingComponents: [],
    inputSnapshot,
    calculatedAt: new Date().toISOString(),
  };
}

function steadyStateServiceResult(
  service: 'heating' | 'cooling',
  room: BuildingRoom,
  transmission: RoomTransmissionResult,
  transmissionBreakdown: TransmissionBreakdown,
  air: RoomAirResult,
  solar: RoomSolarResult,
  internal: RoomInternalResult,
): ServiceLoadResult {
  if (transmission.status === 'missing_input') {
    return {
      status: 'missing_input',
      demandW: null,
      demandRangeW: null,
      specificLoadWm2: null,
      assumptions: [],
      warnings: [],
      missingInputs: [...transmission.missingInputs],
    };
  }

  if (service === 'heating') {
    // Heating stays transmission + air ONLY — solar/internal gains are NEVER
    // added to, or subtracted from, the heating load (Phase 3.2c rule).
    if (air.status === 'missing_input') {
      return {
        status: 'limited',
        demandW: null,
        demandRangeW: null,
        specificLoadWm2: null,
        assumptions: [
          'Теплопередача через ограждения рассчитана, но воздушная составляющая (вентиляция/инфильтрация) неполна — полная нагрузка не определена.',
        ],
        warnings: [...air.warnings],
        missingInputs: [...air.missingInputs],
      };
    }
    const transW = transmission.heatingW;
    const airW = air.heatingW;
    const demandW = transW != null && airW != null ? transW + airW : null;
    const area = room.areaM2 != null && room.areaM2 > 0 ? room.areaM2 : null;
    const specificLoadWm2 = demandW != null && area != null ? demandW / area : null;
    return {
      status: 'calculated',
      demandW,
      demandRangeW: null,
      specificLoadWm2,
      methodInputs: {
        indoorC: transmission.indoorHeatingC,
        outdoorC: transmission.outdoorHeatingC,
        transmissionHeatingW: transmission.heatingW,
        transmissionCoolingW: transmission.coolingW,
        airHeatingW: air.heatingW,
        airCoolingW: air.coolingW,
      },
      coefficientTrace: {
        methodId: STEADY_STATE_METHOD_ID,
        components: 'transmission,air',
        elementCount: transmissionBreakdown.elements.length,
        airConstant: air.breakdown.airConstant,
      },
      assumptions: [`Температура помещения ${transmission.indoorHeatingC}°C, снаружи ${transmission.outdoorHeatingC}°C.`],
      warnings: [...transmission.warnings, ...air.warnings],
      missingInputs: [...transmission.missingInputs, ...air.missingInputs],
    };
  }

  // ---- cooling: Q_cool = transmission + air + solar + internal ----
  const transC = transmission.coolingW;
  const airC = air.coolingW;
  const solarC = solar.totalCoolingW;
  const internalC = internal.totalCoolingW;

  const missingInputs: string[] = [];
  const warnings: string[] = [...transmission.warnings, ...air.warnings, ...solar.warnings, ...internal.warnings];
  for (const m of [...air.missingInputs, ...solar.missingInputs, ...internal.missingInputs]) {
    if (!missingInputs.includes(m)) missingInputs.push(m);
  }

  const area = room.areaM2 != null && room.areaM2 > 0 ? room.areaM2 : null;
  const allComplete = transC != null && airC != null && solarC != null && internalC != null;

  if (allComplete) {
    const demandW = transC + airC + solarC + internalC;
    return {
      status: 'calculated',
      demandW,
      demandRangeW: null,
      specificLoadWm2: area != null ? demandW / area : null,
      methodInputs: {
        indoorC: transmission.indoorCoolingC,
        outdoorC: transmission.outdoorCoolingC,
        transmissionHeatingW: transmission.heatingW,
        transmissionCoolingW: transmission.coolingW,
        airHeatingW: air.heatingW,
        airCoolingW: air.coolingW,
        solarCoolingW: solarC,
        internalCoolingW: internalC,
      },
      coefficientTrace: {
        methodId: STEADY_STATE_METHOD_ID,
        components: 'transmission,air,solar,internal',
        elementCount: transmissionBreakdown.elements.length,
        airConstant: air.breakdown.airConstant,
        solarWindowCount: solar.windows.length,
      },
      assumptions: [`Температура помещения ${transmission.indoorCoolingC}°C, снаружи ${transmission.outdoorCoolingC}°C.`],
      warnings,
      missingInputs,
    };
  }

  // Incomplete cooling: partial = sum of KNOWN components (transmission anchors it;
  // air/solar totals + internal sub-components contribute what they resolved).
  const knownParts: number[] = [];
  if (transC != null) knownParts.push(transC);
  if (airC != null) knownParts.push(airC);
  if (solarC != null) knownParts.push(solarC);
  if (internal.peopleW != null) knownParts.push(internal.peopleW);
  if (internal.lightingW != null) knownParts.push(internal.lightingW);
  if (internal.equipmentW != null) knownParts.push(internal.equipmentW);
  const partialDemandW = knownParts.length > 0 ? knownParts.reduce((a, b) => a + b, 0) : null;

  const assumptions: string[] = [];
  if (solar.status === 'missing_input') {
    assumptions.push('Солнечные теплопритоки не рассчитаны — отсутствуют данные солнечной радиации (solar_irradiance) для выбранного местоположения.');
  }
  if (air.status === 'missing_input') {
    assumptions.push('Воздушная составляющая (вентиляция/инфильтрация) неполна — полная нагрузка охлаждения не определена.');
  }
  if (internal.status === 'missing_input') {
    assumptions.push('Внутренние теплопритоки (люди/освещение/оборудование) неполны — полная нагрузка охлаждения не определена.');
  }

  return {
    status: 'limited',
    demandW: null,
    demandRangeW: null,
    specificLoadWm2: null,
    partialDemandW,
    assumptions,
    warnings,
    missingInputs,
  };
}

function computeQuickLoads(project: BuildingProject): BuildingLoadCalculation {
  const method = LOAD_METHODS.quick;
  const requested = requestedServicesOf(project);
  const assignmentByRoom = assignmentsByRoom(project);
  const location = resolveClimateLocation(project.region?.code);
  const climateMeta = getClimateDatasetMeta();

  const roomResults: RoomLoadResult[] = project.rooms.map((room) => {
    const assignment = assignmentByRoom.get(room.id);
    const heatingPref = preferenceFor(assignment, 'heating', requested.includes('heating') ? 'required' : 'not_required');
    const coolingPref = preferenceFor(assignment, 'cooling', requested.includes('cooling') ? 'required' : 'not_required');

    const heating = !requested.includes('heating')
      ? serviceNotRequested('heating')
      : heatingPref === 'not_required'
        ? serviceNotRequired()
        : quickServiceResult('heating', room, project, location).result;

    const cooling = !requested.includes('cooling')
      ? serviceNotRequested('cooling')
      : coolingPref === 'not_required'
        ? serviceNotRequired()
        : quickServiceResult('cooling', room, project, location).result;

    return {
      roomId: room.id,
      roomName: room.name,
      roomType: room.roomType,
      floorId: room.floorId || null,
      floorLabel: floorLabelOf(project, room.floorId || null),
      areaM2: room.areaM2,
      effectiveCeilingHeightM: effectiveCeilingHeightM(project, room),
      heating,
      cooling,
    };
  });

  const heatingSum = sumEligibleRoomLoads(roomResults, 'heating');
  const coolingSum = sumEligibleRoomLoads(roomResults, 'cooling');
  const heatingPartial = sumCalculatedRoomLoads(roomResults, 'heating');
  const coolingPartial = sumCalculatedRoomLoads(roomResults, 'cooling');
  const heatingRange = sumRoomRanges(roomResults, 'heating');
  const coolingRange = sumRoomRanges(roomResults, 'cooling');

  const warnings: string[] = [];
  if (location == null) {
    warnings.push('climate_location:missing_climate_location');
  }
  if (heatingSum.eligibleCount > 0 && !heatingSum.complete) {
    warnings.push('object_heating_total:incomplete');
  }
  if (coolingSum.eligibleCount > 0 && !coolingSum.complete) {
    warnings.push('object_cooling_total:incomplete');
  }

  const missingInputs: string[] = [];
  const seen = new Set<string>();
  for (const room of roomResults) {
    for (const item of [...room.heating.missingInputs, ...room.cooling.missingInputs]) {
      if (!seen.has(item)) {
        seen.add(item);
        missingInputs.push(item);
      }
    }
  }

  const assumptions = [
    'OhmX QUICK Load v1 — предварительная инженерная оценка нагрузки. Не заменяет полный теплотехнический расчёт и не является подбором мощности конкретного оборудования.',
    'Нагрузка — это потребность здания/помещения, а не мощность оборудования. Резерв на подбор оборудования не добавляется.',
  ];
  if (location) {
    assumptions.push(`Климатический пункт: ${location.labelRu} (${location.labelHy}), ${location.elevationM} м над ур. моря.`);
    assumptions.push(`Источник климата: ${climateMeta?.datasetId ?? 'armenia-hhsn-22-01-2024'} v${climateMeta?.datasetVersion ?? '1.0.0'} (ՀՀՇՆ 22-01-2024).`);
  } else {
    assumptions.push('Для региона проекта нет однозначного официального климатического пункта — численный QUICK недоступен (missing_climate_location).');
  }

  const status =
    (heatingSum.eligibleCount === 0 || heatingSum.complete) &&
    (coolingSum.eligibleCount === 0 || coolingSum.complete)
      ? 'calculated'
      : 'incomplete';

  const inputSnapshot = buildLoadInputSnapshot(project, 'quick', method.version);

  return {
    mode: 'quick',
    status,
    methodId: method.id,
    methodVersion: method.version,
    buildingRevisionAtCalculation: project.buildingRevision,
    systemsRevisionAtCalculation: project.systemsRevision,
    roomResults,
    heatingDemandW: heatingSum.demandW,
    coolingDemandW: coolingSum.demandW,
    heatingRangeW: heatingSum.complete ? heatingRange : null,
    coolingRangeW: coolingSum.complete ? coolingRange : null,
    partialHeatingDemandW: heatingSum.complete ? null : heatingPartial.partialDemandW,
    partialCoolingDemandW: coolingSum.complete ? null : coolingPartial.partialDemandW,
    climateDatasetId: location ? (climateMeta?.datasetId ?? null) : null,
    climateDatasetVersion: location ? (climateMeta?.datasetVersion ?? null) : null,
    climateLocationId: location ? location.id : null,
    climateLocationLabel: location ? `${location.labelRu} (${location.labelHy})` : null,
    warnings,
    missingInputs,
    assumptions,
    inputSnapshot,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Honest method registry for API/UI: what each mode can do today.
 * QUICK is active, but coverage is conditional on the vendored dataset's
 * regionMap — the method status never claims all Armenia is supported.
 */
export function getLoadMethodStatus() {
  const supportedRegions = climateDatasetSupportedRegions();
  return {
    quick: {
      status: LOAD_METHODS.quick.status,
      methodId: LOAD_METHODS.quick.id,
      methodVersion: LOAD_METHODS.quick.version,
      reason:
        'OhmX QUICK Load v1 активен для регионов с подтверждёнными официальными климатическими данными (ՀՀՇՆ 22-01-2024). Для регионов без однозначного климатического пункта численный результат недоступен (missing_climate_location).',
      missingInputs: [...QUICK_MISSING_INPUTS],
      supportedRegions,
    },
    professional: {
      status: LOAD_METHODS.professional.status,
      methodId: LOAD_METHODS.professional.id,
      methodVersion: LOAD_METHODS.professional.version,
      reason: PROFESSIONAL_METHOD_LIMITED,
      missingInputs: [...PROFESSIONAL_MISSING_INPUTS],
      supportedRegions: [],
    },
    steadyState: {
      status: LOAD_METHODS.steadyState.status,
      methodId: LOAD_METHODS.steadyState.id,
      methodVersion: LOAD_METHODS.steadyState.version,
      reason:
        'OhmX Steady-State v1 — физический расчёт теплопередачи, воздушной нагрузки, солнечных и внутренних теплопритоков с утверждёнными профилями (Phase 3.2). Требует инженерных данных помещения (ограждения, окна, вентиляция, люди).',
      missingInputs: ['envelope:missing', 'u_value:missing', 'area:missing', 'solar_and_orientation_methodology:missing', 'internal_gains_methodology:missing', 'infiltration_or_ventilation_method:missing', 'climate_location:missing_climate_location'],
      supportedRegions,
    },
  };
}
