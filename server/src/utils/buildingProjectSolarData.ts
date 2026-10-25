/**
 * Building Project Phase 3.2e/f — vendored solar irradiance dataset loader.
 *
 * Deterministic and OFFLINE: values are vendored (no runtime HTTP).
 *
 * Dataset v2.0.0 (Phase 3.2f) carries, per climate location, the June–August
 * HOURLY design series for all 8 window orientations (transposed to vertical),
 * enabling the SIMULTANEOUS room design peak. Per-orientation peaks are stored
 * alongside (identical to v1) for provenance / legacy fallback.
 *
 * v1.0.0 (per-orientation peak only) is retained on disk as a legacy/secondary
 * artifact and is no longer loaded.
 *
 * Source: PVGIS (EU JRC) TMY hourly radiation (PVGIS-SARAH3 + ERA5, 2005–2023),
 * isotropic sky transposition to vertical (tilt 90°). Full method/assumption
 * metadata lives in the dataset JSON.
 */
import { readFileSync } from 'node:fs';
import type {
  SolarHourlySeries,
  SolarIrradianceByOrientation,
  SolarIrradianceData,
  WindowOrientation,
} from './buildingProjectTypes.js';

export const SOLAR_DATASET_ID = 'ohmx-solar-irradiance';
export const SOLAR_DATASET_VERSION = '2.0.0';

/** Canonical column order of the hourly matrix (and the per-orientation peaks). */
export const SOLAR_ORIENTATION_ORDER: readonly WindowOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface SolarDatasetLocation {
  latitude: number;
  longitude: number;
  /** Per-orientation design peaks (identical to v1). */
  values: SolarIrradianceByOrientation;
  /** [timeStep][orientationIndex] = W/m², JJA hourly. */
  hourly: number[][];
}

interface SolarDataset {
  datasetId: string;
  datasetVersion: string;
  source: string;
  method: string;
  raddatabase: string;
  meteodatabase: string;
  yearRange: string;
  aggregation: string;
  orientationOrder: WindowOrientation[];
  orientationConvention: string;
  transposition: string;
  designSeason: string;
  timeResolution: string;
  generatedAt: string;
  assumptions: string[];
  timeAxisUtc: string[];
  locations: Record<string, SolarDatasetLocation>;
}

let cache: SolarDataset | null = null;

export function loadSolarDataset(): SolarDataset {
  if (cache) return cache;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(new URL('../data/buildingProjectSolarIrradianceV2.json', import.meta.url), 'utf8'));
  } catch (err) {
    throw new Error(`Solar irradiance dataset unreadable: ${String(err)}`);
  }
  const ds = raw as SolarDataset;
  if (!ds || typeof ds !== 'object' || !ds.locations || typeof ds.locations !== 'object') {
    throw new Error('Solar irradiance dataset invalid: missing locations map');
  }
  cache = ds;
  return ds;
}

/** Dataset metadata (id + version) without forcing a throw for absent data. */
export function getSolarDatasetMeta(): { datasetId: string; datasetVersion: string } | null {
  try {
    const ds = loadSolarDataset();
    return { datasetId: ds.datasetId, datasetVersion: ds.datasetVersion };
  } catch {
    return null;
  }
}

/** Shared hourly time axis (UTC) of the vendored design series, or null when unavailable. */
export function getSolarTimeAxisUtc(): string[] | null {
  try {
    return [...loadSolarDataset().timeAxisUtc];
  } catch {
    return null;
  }
}

/**
 * Per-orientation design peaks + hourly design series for a climate location id.
 * Returns null for an uncovered location (solar = missing, never borrowed data).
 * Defensive-copies `values`, `hourly` and `orientationOrder` so caller mutation
 * cannot corrupt the cached dataset.
 */
export function getSolarIrradiance(locationId: string | null | undefined): SolarIrradianceData | null {
  if (!locationId) return null;
  try {
    const ds = loadSolarDataset();
    const entry = ds.locations[locationId];
    if (!entry || !entry.values) return null;
    const hourly: SolarHourlySeries | null =
      entry.hourly && ds.orientationOrder?.length
        ? {
            orientationOrder: [...ds.orientationOrder],
            irradianceWm2: entry.hourly.map((row) => [...row]),
          }
        : null;
    return {
      values: { ...entry.values },
      hourly,
      source: ds.source,
      datasetVersion: ds.datasetVersion,
    };
  } catch {
    return null;
  }
}