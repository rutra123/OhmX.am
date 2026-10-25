/**
 * Building Project Phase 3.1 — OhmX QUICK Load v1 (numeric preliminary estimate).
 *
 * methodId:  ohmx.quick-load.v1
 * version:   1.0.0
 *
 * Scope:
 *   - heating demand per room (volume × ΔT × envelope × modifiers), W
 *   - cooling demand per room (area × 100 W/m² × modifiers × climate), W
 *   - object totals = raw sum of eligible room results (never an independent
 *     formula, never rounded, never a 0 W fabrication)
 *
 * Explicitly NOT in scope (Phase 4):
 *   - equipment selection, boiler/chiller/heat-pump/AC sizing, radiator count,
 *     pipe DN, pump flow/head, manifold circuits, BOM, estimate, PDF
 *   - any equipment reserve / margin (+10% etc.) — this layer computes DEMAND
 *
 * Method status:
 *   QUICK is ACTIVE only when a verified official climate location can be
 *   resolved for the project region (dataset armenia-hhsn-22-01-2024, v1.0.0).
 *   Regions without an unambiguous official mapping return missing_input with
 *   code climate_location:missing_climate_location — never an invented number.
 *   PROFESSIONAL stays LIMITED (no U-values / envelope areas / infiltration /
 *   solar / internal-gains / latent model) — see buildingProjectLoads.ts.
 *
 * All coefficients are OhmX internal QUICK v1 heuristics, NOT normative
 * U-values. Single source of truth: this module + the versioned climate
 * dataset JSON. No coefficient is duplicated in UI/service/tests.
 */
import { readFileSync } from 'node:fs';
import type {
  BuildingProject,
  BuildingRoom,
  ServiceLoadResult,
} from './buildingProjectTypes.js';

export const QUICK_METHOD_ID = 'ohmx.quick-load.v1';
export const QUICK_METHOD_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Climate dataset (versioned, vendored, deterministic; NO runtime HTTP fetch)
// ---------------------------------------------------------------------------

export interface QuickClimateLocation {
  id: string;
  labelRu: string;
  labelHy: string;
  station: string;
  elevationM: number;
  climateZone: string;
  regionId: string | null;
  observationPeriod: string;
  /** Winter design outdoor temperature: coldest five-day, probability 0.92 (HHSHN 22-01-2024, Table 25). */
  heatingOutdoorDesignC: number;
  /** Summer design outdoor temperature: mean daily temp of the hottest day, probability 0.95 (HHSHN 22-01-2024, Table 22). */
  coolingOutdoorDesignC: number;
  sourceTableHeating: string;
  sourceRowHeating: number;
  sourceTableCooling: string;
  sourceRowCooling: number;
}

export interface QuickClimateDataset {
  datasetId: string;
  datasetVersion: string;
  sourceTitle: string;
  sourceRevision: string;
  sourceUrl: string;
  heatingColumn: { table: string; columnHy: string; probability: number; meaning: string };
  coolingColumn: { table: string; columnHy: string; probability: number; meaning: string; note: string };
  regionMap: Record<string, { locationId: string; note: string }>;
  locations: QuickClimateLocation[];
}

let datasetCache: QuickClimateDataset | null = null;

/** Read + validate the vendored climate dataset (throwing a clear error if corrupt). */
export function loadClimateDataset(): QuickClimateDataset {
  if (datasetCache) return datasetCache;
  const url = new URL('../data/buildingProjectClimateQuickV1.json', import.meta.url);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(url, 'utf8'));
  } catch (err) {
    throw new Error(`QUICK climate dataset unreadable: ${String(err)}`);
  }
  const ds = raw as QuickClimateDataset;
  if (!ds || typeof ds !== 'object' || !Array.isArray(ds.locations) || ds.locations.length === 0) {
    throw new Error('QUICK climate dataset invalid: missing locations array');
  }
  const ids = new Set<string>();
  for (const loc of ds.locations) {
    if (typeof loc.id !== 'string' || !loc.id) {
      throw new Error('QUICK climate dataset invalid: location without id');
    }
    if (ids.has(loc.id)) throw new Error(`QUICK climate dataset invalid: duplicate location id ${loc.id}`);
    ids.add(loc.id);
    if (!Number.isFinite(loc.heatingOutdoorDesignC) || !Number.isFinite(loc.coolingOutdoorDesignC)) {
      throw new Error(`QUICK climate dataset invalid: non-finite temperature at ${loc.id}`);
    }
  }
  for (const [regionCode, entry] of Object.entries(ds.regionMap || {})) {
    if (!entry || typeof entry.locationId !== 'string' || !ids.has(entry.locationId)) {
      throw new Error(`QUICK climate dataset invalid: regionMap ${regionCode} -> unknown location`);
    }
  }
  datasetCache = ds;
  return ds;
}

/** Get dataset metadata (dataset/version) without forcing a throw for callers that handle absence. */
export function getClimateDatasetMeta(): { datasetId: string; datasetVersion: string } | null {
  try {
    const ds = loadClimateDataset();
    return { datasetId: ds.datasetId, datasetVersion: ds.datasetVersion };
  } catch {
    return null;
  }
}

/**
 * Resolve the official climate location for a Building Project region code.
 * Only unambiguous mappings from the vendored regionMap are used; everything
 * else returns null (→ missing_climate_location). Never guesses a marz capital.
 */
export function resolveClimateLocation(
  regionCode: string | null | undefined,
): QuickClimateLocation | null {
  if (!regionCode) return null;
  try {
    const ds = loadClimateDataset();
    const mapped = ds.regionMap[regionCode];
    if (!mapped) return null;
    const loc = ds.locations.find((l) => l.id === mapped.locationId);
    return loc ?? null;
  } catch {
    return null;
  }
}

export function climateDatasetSupportedRegions(): string[] {
  try {
    const ds = loadClimateDataset();
    return Object.keys(ds.regionMap).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// OhmX QUICK v1 coefficients — single source of truth (Phase 3.1 spec §14-28)
// ---------------------------------------------------------------------------

/** Heating envelope coefficient, W/(m³·K) — internal heuristic, NOT normative U-value. */
export const QUICK_HEATING_ENVELOPE = {
  good: 0.55,
  medium: 0.75,
  poor: 1.0,
  unknown: 0.9,
} as const;

/** Heating external-wall factor by external wall count. */
export const QUICK_HEATING_EXTERNAL = {
  0: 0.8,
  1: 1.0,
  2: 1.08,
  '3+': 1.15,
} as const;

/** Heating floor/roof exposure factor. */
export const QUICK_HEATING_FLOOR = {
  middle: 1.0,
  top: 1.08,
  ground: 1.08,
  roofPlusUnheatedBelow: 1.15,
} as const;

/** Heating glazing factor — strongest applicable category, never a product of two. */
export const QUICK_HEATING_GLAZING = {
  standard: 1.0,
  large: 1.1,
  panoramic: 1.2,
  stained: 1.2,
} as const;

/** QUICK v1 does not reduce heating demand for solar gains. */
export const QUICK_HEATING_SOLAR = 1.0 as const;

/** Cooling empirical base, W/m² — internal QUICK v1 coefficient, NOT normative. */
export const QUICK_COOLING_BASE_WM2 = 100 as const;

/** Cooling height factor reference and guard rails. */
export const QUICK_COOLING_HEIGHT_REF_M = 2.7 as const;
export const QUICK_COOLING_HEIGHT_MIN_K = 0.85 as const;
export const QUICK_COOLING_HEIGHT_MAX_K = 1.5 as const;

export const QUICK_COOLING_INSULATION = {
  good: 0.9,
  medium: 1.0,
  poor: 1.1,
  unknown: 1.05,
} as const;

export const QUICK_COOLING_EXTERNAL = {
  0: 0.9,
  1: 1.0,
  2: 1.05,
  '3+': 1.1,
} as const;

export const QUICK_COOLING_FLOOR = {
  normal: 1.0,
  top: 1.1,
} as const;

export const QUICK_COOLING_GLAZING = {
  standard: 1.0,
  large: 1.15,
  panoramic: 1.25,
  stained: 1.25,
} as const;

/** Solar cooling factor — the model does not collect orientation, so it stays 1.00 + warning. */
export const QUICK_COOLING_SOLAR_UNKNOWN = 1.0 as const;

/** Cooling climate factor reference (QUICK v1 method reference, not normative). */
export const QUICK_COOLING_CLIMATE = {
  refOutdoorC: 35,
  indoorC: 24,
  refDeltaK: 11,
  minK: 0.8,
  maxK: 1.25,
} as const;

/** Indicative presentation bands (NOT confidence intervals). */
export const QUICK_BAND_HEATING_NARROW = { minFactor: 0.8, maxFactor: 1.2 } as const;
export const QUICK_BAND_HEATING_WIDE = { minFactor: 0.7, maxFactor: 1.3 } as const;
export const QUICK_BAND_COOLING_NARROW = { minFactor: 0.75, maxFactor: 1.25 } as const;
export const QUICK_BAND_COOLING_WIDE = { minFactor: 0.65, maxFactor: 1.35 } as const;

/** QUICK v1 indoor design temperature assumptions (internal, not normative claims). */
const QUICK_INDOOR_20 = new Set([
  'bedroom',
  'child_room',
  'living_room',
  'office',
  'guest_room',
  'kitchen',
]);
const QUICK_INDOOR_22 = new Set(['bathroom', 'shower']);
const QUICK_INDOOR_18 = new Set(['corridor', 'hall', 'dressing_room']);
const QUICK_INDOOR_16 = new Set(['storage', 'technical', 'boiler_room', 'garage']);

export const QUICK_DEFAULT_INDOOR_C = 20 as const;

export function quickIndoorDesignC(roomType: string): { tempC: number; isDefault: boolean } {
  if (QUICK_INDOOR_20.has(roomType)) return { tempC: 20, isDefault: false };
  if (QUICK_INDOOR_22.has(roomType)) return { tempC: 22, isDefault: false };
  if (QUICK_INDOOR_18.has(roomType)) return { tempC: 18, isDefault: false };
  if (QUICK_INDOOR_16.has(roomType)) return { tempC: 16, isDefault: false };
  return { tempC: QUICK_DEFAULT_INDOOR_C, isDefault: true };
}

// ---------------------------------------------------------------------------
// Input helpers (validation + effective values)
// ---------------------------------------------------------------------------

/** Room area: finite positive number required. */
export function quickRoomAreaM2(room: BuildingRoom): number | null {
  const area = room.areaM2;
  if (area == null || !Number.isFinite(area) || area <= 0) return null;
  return area;
}

/** Effective ceiling height: room override first, then object default. Never a hidden 2.7 m substitute. */
export function quickEffectiveHeightM(project: BuildingProject, room: BuildingRoom): number | null {
  const override = room.extras?.geometry?.ceilingHeightM ?? null;
  if (override != null && Number.isFinite(override) && override > 0) return override;
  const def = project.defaultCeilingHeightM;
  if (def != null && Number.isFinite(def) && def > 0) return def;
  return null;
}

/** Effective insulation level: room override wins over object level. */
export function quickEffectiveInsulation(
  project: BuildingProject,
  room: BuildingRoom,
): 'good' | 'medium' | 'poor' | 'unknown' {
  const override = room.extras?.insulationOverride ?? null;
  if (override === 'good' || override === 'medium' || override === 'poor' || override === 'unknown') {
    return override;
  }
  const level = project.insulationLevel;
  return level === 'good' || level === 'medium' || level === 'poor' || level === 'unknown' ? level : 'unknown';
}

export function quickExternalWallCount(room: BuildingRoom): number | null {
  const count = room.extras?.geometry?.externalWallCount ?? null;
  if (count == null) return null;
  // Must be a non-negative INTEGER: the wall-count factor tables are keyed by
  // 0 / 1 / 2 / '3+'. A non-integer would index `undefined` and silently yield
  // NaN in both the heating and cooling engines.
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export type QuickFloorExposure =
  | { kind: 'middle'; factor: number }
  | { kind: 'top'; factor: number }
  | { kind: 'ground'; factor: number }
  | { kind: 'roof_plus_unheated_below'; factor: number }
  | { kind: 'unknown'; factor: number };

/**
 * Heating floor/roof exposure from real stored facts only (floorPosition +
 * validated room conditions). Nothing is inferred from floor numbers alone.
 */
export function quickHeatingFloorExposure(room: BuildingRoom): QuickFloorExposure {
  const position = room.extras?.geometry?.floorPosition ?? null;
  const conditions = room.extras?.conditions ?? [];
  const hasTop = position === 'top' || conditions.includes('top_floor');
  const hasGroundLike =
    position === 'ground' ||
    position === 'basement' ||
    conditions.includes('ground_floor') ||
    conditions.includes('above_unheated') ||
    conditions.includes('above_basement');
  if (hasTop && hasGroundLike) {
    return { kind: 'roof_plus_unheated_below', factor: QUICK_HEATING_FLOOR.roofPlusUnheatedBelow };
  }
  if (hasTop) return { kind: 'top', factor: QUICK_HEATING_FLOOR.top };
  if (hasGroundLike) return { kind: 'ground', factor: QUICK_HEATING_FLOOR.ground };
  if (position === 'intermediate') return { kind: 'middle', factor: QUICK_HEATING_FLOOR.middle };
  return { kind: 'unknown', factor: 1.0 };
}

/** Cooling floor factor — ground/unheated below does NOT raise cooling demand. */
export function quickCoolingFloorFactor(room: BuildingRoom): { factor: number; known: boolean } {
  const position = room.extras?.geometry?.floorPosition ?? null;
  const conditions = room.extras?.conditions ?? [];
  const hasTop = position === 'top' || conditions.includes('top_floor');
  if (hasTop) return { factor: QUICK_COOLING_FLOOR.top, known: true };
  if (position === 'intermediate' || position === 'ground' || position === 'basement') {
    return { factor: QUICK_COOLING_FLOOR.normal, known: true };
  }
  // No stored fact -> neutral 1.00 with a warning at the result level.
  return { factor: QUICK_COOLING_FLOOR.normal, known: false };
}

export type QuickGlazingKind = 'standard' | 'large' | 'panoramic' | 'stained' | null;

export function quickGlazingKind(room: BuildingRoom): QuickGlazingKind {
  const glazing = room.extras?.windows?.glazingType ?? null;
  if (glazing === 'standard' || glazing === 'large' || glazing === 'panoramic' || glazing === 'stained') {
    return glazing;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure numeric engines (heating and cooling are fully independent)
// ---------------------------------------------------------------------------

export interface QuickHeatingEngineResult {
  demandW: number;
  specificLoadWm2: number;
  inputs: Record<string, number | string | boolean | null>;
  coefficientTrace: Record<string, number | string | null>;
  assumptions: string[];
  warnings: string[];
  band: { minFactor: number; maxFactor: number };
}

export function computeQuickHeating(
  project: BuildingProject,
  room: BuildingRoom,
  location: QuickClimateLocation,
): QuickHeatingEngineResult {
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const areaM2 = quickRoomAreaM2(room)!;
  const heightM = quickEffectiveHeightM(project, room)!;
  const volumeM3 = areaM2 * heightM;

  const indoor = quickIndoorDesignC(room.roomType);
  if (indoor.isDefault) warnings.push('quick_default_indoor_temperature');
  const outdoor = location.heatingOutdoorDesignC;
  const deltaT = indoor.tempC - outdoor;
  if (!Number.isFinite(deltaT) || deltaT <= 0) {
    throw new Error(`QUICK heating: invalid deltaT ${deltaT} for ${room.id}`);
  }

  const insulation = quickEffectiveInsulation(project, room);
  const kEnvelope = QUICK_HEATING_ENVELOPE[insulation];

  const wallCount = quickExternalWallCount(room);
  let kExternal = 1.0;
  if (wallCount == null) {
    warnings.push('external_wall_count_not_provided');
    assumptions.push('Количество наружных стен неизвестно — коэффициент 1.00.');
  } else {
    kExternal = wallCount >= 3 ? QUICK_HEATING_EXTERNAL['3+'] : QUICK_HEATING_EXTERNAL[wallCount as 0 | 1 | 2];
  }

  const exposure = quickHeatingFloorExposure(room);
  let kFloor = exposure.factor;
  if (exposure.kind === 'unknown') {
    warnings.push('floor_exposure_not_provided');
    assumptions.push('Положение помещения (верх/низ/грунт) не указано — коэффициент 1.00.');
  } else if (exposure.kind === 'top') {
    assumptions.push('Помещение под кровлей — учтён коэффициент 1.08.');
  } else if (exposure.kind === 'ground') {
    assumptions.push('Помещение над грунтом/неотапливаемым — учтён коэффициент 1.08.');
  } else if (exposure.kind === 'roof_plus_unheated_below') {
    assumptions.push('Помещение под кровлей и над неотапливаемым — учтён коэффициент 1.15.');
  }

  const glazing = quickGlazingKind(room);
  let kGlazing: number = QUICK_HEATING_GLAZING.standard;
  if (glazing == null) {
    assumptions.push('Тип остекления не указан — принят коэффициент обычного остекления 1.00.');
  } else {
    kGlazing = QUICK_HEATING_GLAZING[glazing];
    if (glazing === 'large') assumptions.push('Большие окна учтены (1.10).');
    if (glazing === 'panoramic' || glazing === 'stained') assumptions.push('Панорамное/витражное остекление учтено (1.20).');
  }

  // QUICK v1: no solar-gain reduction for heating (KsolarHeating = 1.00).
  assumptions.push('Солнечные теплопритоки в отопительной нагрузке QUICK v1 не учитываются (Ksolar = 1.00).');

  const demandW = volumeM3 * deltaT * kEnvelope * kExternal * kFloor * kGlazing * QUICK_HEATING_SOLAR;
  const specificLoadWm2 = demandW / areaM2;
  if (specificLoadWm2 < 30 || specificLoadWm2 > 200) {
    warnings.push('quick_specific_load_outlier');
  }

  // Indicative band: ±20% when insulation + exposure are known; ±30% otherwise.
  const insulationKnown = insulation !== 'unknown';
  const exposureKnown = exposure.kind !== 'unknown' && wallCount != null;
  const band =
    insulationKnown && exposureKnown ? QUICK_BAND_HEATING_NARROW : QUICK_BAND_HEATING_WIDE;
  if (!insulationKnown) assumptions.push('Утепление неизвестно — ориентировочный диапазон расширен до ±30%.');
  if (!exposureKnown && (exposure.kind === 'unknown' || wallCount == null)) {
    assumptions.push('Данные о наружных стенах/положении неполны — ориентировочный диапазон расширен до ±30%.');
  }

  return {
    demandW,
    specificLoadWm2,
    inputs: {
      areaM2,
      effectiveHeightM: heightM,
      volumeM3,
      indoorDesignC: indoor.tempC,
      outdoorDesignC: outdoor,
      insulationLevel: insulation,
      externalWallCount: wallCount,
      floorExposure: exposure.kind,
      glazingType: glazing,
    },
    coefficientTrace: {
      kEnvelope: kEnvelope,
      kExternal: kExternal,
      kFloor: kFloor,
      kGlazing: kGlazing,
      kSolarHeating: QUICK_HEATING_SOLAR,
      envelopeCoefficientId: `quick.heating.envelope.${insulation}`,
      externalFactorId: wallCount == null ? 'quick.heating.external.missing' : `quick.heating.external.walls${wallCount >= 3 ? '3plus' : wallCount}`,
      floorFactorId: `quick.heating.floor.${exposure.kind}`,
      glazingFactorId: glazing == null ? 'quick.heating.glazing.standard' : `quick.heating.glazing.${glazing}`,
    },
    assumptions,
    warnings,
    band,
  };
}

export interface QuickCoolingEngineResult {
  demandW: number;
  specificLoadWm2: number;
  inputs: Record<string, number | string | boolean | null>;
  coefficientTrace: Record<string, number | string | null>;
  assumptions: string[];
  warnings: string[];
  band: { minFactor: number; maxFactor: number };
}

export function computeQuickCooling(
  project: BuildingProject,
  room: BuildingRoom,
  location: QuickClimateLocation,
): QuickCoolingEngineResult {
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const areaM2 = quickRoomAreaM2(room)!;
  const heightM = quickEffectiveHeightM(project, room)!;

  const kHeightRaw = heightM / QUICK_COOLING_HEIGHT_REF_M;
  let kHeight = kHeightRaw;
  if (kHeightRaw < QUICK_COOLING_HEIGHT_MIN_K) kHeight = QUICK_COOLING_HEIGHT_MIN_K;
  if (kHeightRaw > QUICK_COOLING_HEIGHT_MAX_K) kHeight = QUICK_COOLING_HEIGHT_MAX_K;
  if (kHeightRaw < QUICK_COOLING_HEIGHT_MIN_K || kHeightRaw > QUICK_COOLING_HEIGHT_MAX_K) {
    warnings.push('height_outside_quick_reference_range');
  }

  const insulation = quickEffectiveInsulation(project, room);
  const kInsulation = QUICK_COOLING_INSULATION[insulation];

  const wallCount = quickExternalWallCount(room);
  let kExternal = 1.0;
  if (wallCount == null) {
    warnings.push('external_wall_count_not_provided');
    assumptions.push('Количество наружных стен неизвестно — коэффициент 1.00.');
  } else {
    kExternal = wallCount >= 3 ? QUICK_COOLING_EXTERNAL['3+'] : QUICK_COOLING_EXTERNAL[wallCount as 0 | 1 | 2];
  }

  const floor = quickCoolingFloorFactor(room);
  const kFloor = floor.factor;
  if (!floor.known) warnings.push('floor_exposure_not_provided');

  const glazing = quickGlazingKind(room);
  let kGlazing: number = QUICK_COOLING_GLAZING.standard;
  if (glazing == null) {
    assumptions.push('Тип остекления не указан — принят коэффициент обычного остекления 1.00.');
  } else {
    kGlazing = QUICK_COOLING_GLAZING[glazing];
    if (glazing === 'large') assumptions.push('Большие окна учтены (1.15).');
    if (glazing === 'panoramic' || glazing === 'stained') assumptions.push('Панорамное/витражное остекление учтено (1.25).');
  }

  // Solar orientation is not collected by the Building Project model -> 1.00 + warning.
  const kSolar = QUICK_COOLING_SOLAR_UNKNOWN;
  warnings.push('solar_orientation_not_collected');
  assumptions.push('Солнечная ориентация не указана — коэффициент 1.00.');

  const kClimateRaw = (location.coolingOutdoorDesignC - QUICK_COOLING_CLIMATE.indoorC) / QUICK_COOLING_CLIMATE.refDeltaK;
  let kClimate = kClimateRaw;
  let climateClamped = false;
  if (kClimate < QUICK_COOLING_CLIMATE.minK) {
    kClimate = QUICK_COOLING_CLIMATE.minK;
    climateClamped = true;
  }
  if (kClimate > QUICK_COOLING_CLIMATE.maxK) {
    kClimate = QUICK_COOLING_CLIMATE.maxK;
    climateClamped = true;
  }
  if (climateClamped) warnings.push('cooling_climate_factor_clamped');

  const demandW =
    areaM2 *
    QUICK_COOLING_BASE_WM2 *
    kHeight *
    kInsulation *
    kExternal *
    kFloor *
    kGlazing *
    kSolar *
    kClimate;
  const specificLoadWm2 = demandW / areaM2;
  if (specificLoadWm2 < 30 || specificLoadWm2 > 200) {
    warnings.push('quick_specific_load_outlier');
  }

  // QUICK v1 does NOT model people/appliances/lighting/ventilation/infiltration/
  // latent loads / SHGC / shading schedules — every numeric cooling result carries this.
  assumptions.push('Внутренние теплопритоки людей и оборудования в QUICK v1 не моделируются.');
  assumptions.push('Вентиляция, инфильтрация и влажностная нагрузка в QUICK v1 не моделируются.');

  // Indicative band: ±25% when climate exact + glazing known + solar known;
  // solar is never collected -> the wide ±35% band always applies for cooling.
  const band = glazing != null ? QUICK_BAND_COOLING_WIDE : QUICK_BAND_COOLING_WIDE;
  assumptions.push('Ориентировочный диапазон QUICK-оценки для охлаждения расширен до ±35% (солнечная ориентация не собирается).');

  return {
    demandW,
    specificLoadWm2,
    inputs: {
      areaM2,
      effectiveHeightM: heightM,
      indoorDesignC: QUICK_COOLING_CLIMATE.indoorC,
      outdoorDesignC: location.coolingOutdoorDesignC,
      insulationLevel: insulation,
      externalWallCount: wallCount,
      floorPositionKnown: floor.known,
      glazingType: glazing,
      solarExposure: 'unknown',
      climateFactorRaw: kClimateRaw,
    },
    coefficientTrace: {
      kHeight: kHeight,
      kHeightRaw: kHeightRaw,
      kInsulation: kInsulation,
      kExternal: kExternal,
      kFloor: kFloor,
      kGlazing: kGlazing,
      kSolar: kSolar,
      kClimateCooling: kClimate,
      climateFactorClamped: climateClamped ? 'true' : 'false',
      baseWm2: QUICK_COOLING_BASE_WM2,
      insulationCoefficientId: `quick.cooling.insulation.${insulation}`,
      externalFactorId: wallCount == null ? 'quick.cooling.external.missing' : `quick.cooling.external.walls${wallCount >= 3 ? '3plus' : wallCount}`,
      floorFactorId: `quick.cooling.floor.${floor.known ? (kFloor === QUICK_COOLING_FLOOR.top ? 'top' : 'normal') : 'unknown'}`,
      glazingFactorId: glazing == null ? 'quick.cooling.glazing.standard' : `quick.cooling.glazing.${glazing}`,
      climateFactorId: 'quick.cooling.climate.ref35_indoor24_dt11',
    },
    assumptions,
    warnings,
    band,
  };
}

// ---------------------------------------------------------------------------
// Result assembly into the Phase 3 ServiceLoadResult contract
// ---------------------------------------------------------------------------

export interface QuickServiceOutcome {
  result: ServiceLoadResult;
  /** Raw numeric demand (unrounded) or null. */
  demandW: number | null;
}

/**
 * Build the per-service ServiceLoadResult for QUICK numeric mode.
 * Service semantics are decided by the caller (not_requested / not_required
 * are handled in buildingProjectLoads.ts); this function handles missing
 * inputs and the numeric path.
 */
export function quickServiceResult(
  service: 'heating' | 'cooling',
  room: BuildingRoom,
  project: BuildingProject,
  location: QuickClimateLocation | null,
): QuickServiceOutcome {
  const warnings: string[] = [];
  const missingInputs: string[] = [];

  const areaM2 = quickRoomAreaM2(room);
  if (areaM2 == null) missingInputs.push('room_area:missing');
  const heightM = quickEffectiveHeightM(project, room);
  if (heightM == null) missingInputs.push('room_height:missing');

  if (location == null) {
    missingInputs.push('climate_location:missing_climate_location');
  }

  if (missingInputs.length > 0) {
    return {
      result: {
        status: 'missing_input',
        demandW: null,
        demandRangeW: null,
        specificLoadWm2: null,
        assumptions: location == null
          ? ['Для региона проекта нет однозначного официального климатического пункта (ՀՀՇՇ 22-01-2024) — численный QUICK недоступен.']
          : [],
        warnings,
        missingInputs,
      },
      demandW: null,
    };
  }

  const engine = service === 'heating'
    ? computeQuickHeating(project, room, location!)
    : computeQuickCooling(project, room, location!);

  const demandRangeW = {
    min: engine.demandW * engine.band.minFactor,
    max: engine.demandW * engine.band.maxFactor,
  };

  const assumptions = [
    service === 'heating'
      ? `Температура помещения принята ${engine.inputs.indoorDesignC}°C.`
      : `Температура помещения для охлаждения принята ${engine.inputs.indoorDesignC}°C.`,
    `Расчётная температура снаружи (${service === 'heating' ? 'зимняя' : 'летняя'}): ${engine.inputs.outdoorDesignC}°C.`,
    ...engine.assumptions,
  ];

  return {
    result: {
      status: 'calculated',
      demandW: engine.demandW,
      demandRangeW,
      specificLoadWm2: engine.specificLoadWm2,
      methodInputs: engine.inputs,
      coefficientTrace: engine.coefficientTrace,
      assumptions,
      warnings: [...warnings, ...engine.warnings],
      missingInputs,
    },
    demandW: engine.demandW,
  };
}

export { datasetCache };
