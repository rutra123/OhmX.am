/**
 * Building Project Phase 3.2c/f — Cooling Solar Gains.
 *
 * Solar component of the steady-state cooling load, per window:
 *   Q_solar_window(t) = A_glazing × SHGC × I_orientation(t) × shadingFactor
 *
 * Phase 3.2f — SIMULTANEOUS room design peak (the per-window formula is
 * unchanged; only the room-level time aggregation changed):
 *
 *   Q_solar_room = max_t Σ_windows [ A × SHGC × I_orientation(t) × shading ]
 *
 * East/west (and north/south) maxima are NOT simultaneous: summing independent
 * per-orientation maxima over-sized multi-orientation rooms (audit: E+W +66.8%,
 * N+E+S+W +75.5%). When the location carries an hourly design series (dataset
 * v2+), the engine evaluates the summed gain at every design-season hour and
 * takes the maximum. When only per-orientation peaks are present (legacy v1 /
 * synthetic test fixtures), it falls back to the peak-sum (documented legacy).
 *
 * Solar contributes to COOLING ONLY — never added to, or subtracted from, the
 * heating load. Honesty rule: missing ≠ 0; an unresolved orientation / SHGC /
 * shading / area / irradiance yields `missing_input` (never a fabricated W/m²).
 */

import type { QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import type {
  BuildingProject,
  BuildingRoom,
  ConstructionTier,
  EnvelopeElement,
  ShadingProfile,
  ShgcSource,
  ShadingSource,
  SolarBreakdown,
  SolarIrradianceData,
  SolarIrradianceByOrientation,
  SolarWindowContribution,
  WindowOrientation,
} from './buildingProjectTypes.js';

/** SHGC by glazing/construction tier — Phase 3.2B baseline (APPROVED_WITH_LIMITATION). */
export const SHGC_GLASS_PROFILES: Record<ConstructionTier, number> = {
  poor: 0.8, // clear single glazing
  average: 0.7,
  good: 0.45, // low-e
  high_performance: 0.35,
};

/** Shading multipliers by explicit profile — Phase 3.2B baseline (APPROVED_WITH_LIMITATION). */
export const SHADING_PROFILES: Record<ShadingProfile, number> = {
  none: 1.0,
  interior: 0.7,
  exterior: 0.4,
};

/**
 * Rough-opening → glazed-area frame factor (APPROVED_WITH_LIMITATION, estimated).
 * Applied only when a window provides a rough/gross dimension and no explicit
 * net glazed `areaM2`. Never applied twice.
 */
export const WINDOW_GLAZING_AREA_FACTOR = 0.8;

/** Location with an optional versioned solar-irradiance dataset (Phase 3.2c extension). */
type SolarClimateLocation = QuickClimateLocation & {
  solarIrradianceByOrientation?: SolarIrradianceData | null;
};

export interface RoomSolarResult {
  status: 'calculated' | 'missing_input';
  totalCoolingW: number | null;
  windows: SolarWindowContribution[];
  missingInputs: string[];
  warnings: string[];
}

function windowElementsOf(room: BuildingRoom): EnvelopeElement[] | null {
  const envelope = room.envelope ?? null;
  if (!envelope) return null;
  return envelope.windowElements || [];
}

/** Resolve a window's glazed (net) area for solar; prefers existing `areaM2` semantics. */
function resolveGlazedArea(
  element: EnvelopeElement,
): { areaM2: number | null; estimated: boolean; missing: string[] } {
  const missing: string[] = [];
  const invalid = () => missing.push(`area:invalid:${element.elementId}`);
  const ok = (n: number) => Number.isFinite(n) && n >= 0;

  // 1. Explicit net/glazed area — authoritative, no frame factor.
  if (element.areaM2 != null) {
    if (!ok(element.areaM2)) {
      invalid();
      return { areaM2: null, estimated: false, missing };
    }
    return { areaM2: element.areaM2, estimated: false, missing };
  }
  // 2. Rough gross area → glazed = 0.8 × gross (estimated, once).
  if (element.grossAreaM2 != null) {
    if (!ok(element.grossAreaM2)) {
      invalid();
      return { areaM2: null, estimated: false, missing };
    }
    return { areaM2: WINDOW_GLAZING_AREA_FACTOR * element.grossAreaM2, estimated: true, missing };
  }
  // 3. width × height → rough opening → glazed = 0.8 × (w×h) (estimated, once).
  if (element.widthM != null && element.heightM != null) {
    if (!ok(element.widthM) || !ok(element.heightM)) {
      invalid();
      return { areaM2: null, estimated: false, missing };
    }
    return { areaM2: WINDOW_GLAZING_AREA_FACTOR * element.widthM * element.heightM, estimated: true, missing };
  }
  missing.push(`area:missing:${element.elementId}`);
  return { areaM2: null, estimated: false, missing };
}

/** Resolve SHGC (certificate → glazing profile → missing). */
function resolveShgc(
  element: EnvelopeElement,
): { shgc: number | null; source: ShgcSource | null; missing: string[]; warning: string | null } {
  const missing: string[] = [];
  // 1. Explicit / certificate SHGC.
  if (element.shgc != null) {
    if (!Number.isFinite(element.shgc) || element.shgc < 0 || element.shgc > 1) {
      missing.push(`shgc:invalid:${element.elementId}`);
      return { shgc: null, source: 'missing', missing, warning: null };
    }
    return { shgc: element.shgc, source: 'certificate', missing, warning: null };
  }
  // 2. Glazing-profile mapping (construction tier → SHGC table).
  if (element.constructionTier != null) {
    const profile = SHGC_GLASS_PROFILES[element.constructionTier];
    if (profile != null) {
      return {
        shgc: profile,
        source: 'glazing_profile',
        missing,
        warning: `shgc_glazing_profile:${element.constructionTier}:${element.elementId}`,
      };
    }
  }
  missing.push(`shgc:missing:${element.elementId}`);
  return { shgc: null, source: 'missing', missing, warning: null };
}

/** Resolve shading multiplier (explicit factor → profile → missing; NO hidden 1.0). */
function resolveShading(
  element: EnvelopeElement,
): { shadingFactor: number | null; source: ShadingSource | null; missing: string[]; warning: string | null } {
  const missing: string[] = [];
  // 1. Explicit shading factor.
  if (element.shadingFactor != null) {
    if (!Number.isFinite(element.shadingFactor) || element.shadingFactor < 0 || element.shadingFactor > 1) {
      missing.push(`shading:invalid:${element.elementId}`);
      return { shadingFactor: null, source: 'missing', missing, warning: null };
    }
    return { shadingFactor: element.shadingFactor, source: 'explicit', missing, warning: null };
  }
  // 2. Explicit shading profile.
  if (element.shadingProfile != null) {
    const factor = SHADING_PROFILES[element.shadingProfile];
    if (factor != null) {
      return {
        shadingFactor: factor,
        source: 'profile',
        missing,
        warning: `shading_profile:${element.shadingProfile}:${element.elementId}`,
      };
    }
  }
  // 3. Missing — absent shading info is NOT silently treated as 1.0.
  missing.push(`shading:missing:${element.elementId}`);
  return { shadingFactor: null, source: 'missing', missing, warning: null };
}

function solarDataOf(location: QuickClimateLocation | null): SolarIrradianceData | null {
  if (!location) return null;
  const data = (location as SolarClimateLocation).solarIrradianceByOrientation ?? null;
  if (!data || typeof data !== 'object' || !data.values || typeof data.values !== 'object') return null;
  return data;
}

/** A window whose area/SHGC/shading/orientation are all resolved (aggregation-ready). */
interface ResolvedSolarWindow {
  elementId: string;
  orientation: WindowOrientation;
  /** Pre-computed A × SHGC × shading — the time-invariant gain per unit irradiance. */
  coeff: number;
}

/**
 * Compute a single room's cooling solar gain. Pure and deterministic.
 *
 * Aggregation (Phase 3.2f): when the location carries an hourly design series,
 * Q = max_t Σ (A × SHGC × I_orientation(t) × shading). Otherwise (legacy peak
 * data) Q = Σ (A × SHGC × I_orientation_peak × shading).
 *
 * Returns `missing_input` (totalCoolingW null) when no window envelope is
 * collected, or any window lacks orientation / irradiance / SHGC / shading.
 */
export function computeRoomSolar(
  project: BuildingProject,
  room: BuildingRoom,
  location: QuickClimateLocation | null,
): RoomSolarResult {
  const warnings: string[] = [];
  const missingInputs: string[] = [];

  const elements = windowElementsOf(room);
  if (elements === null) {
    missingInputs.push('envelope:missing');
    return { status: 'missing_input', totalCoolingW: null, windows: [], missingInputs, warnings };
  }

  const solarData = solarDataOf(location);
  if (elements.length > 0 && solarData == null) {
    missingInputs.push('solar_irradiance:missing');
  }

  const windows: SolarWindowContribution[] = [];
  const resolved: ResolvedSolarWindow[] = [];
  let allResolved = true;
  const seenElementIds = new Set<string>();

  for (const element of elements) {
    if (seenElementIds.has(element.elementId)) {
      allResolved = false;
      const duplicate = `duplicate_element_id:${element.elementId}`;
      if (!missingInputs.includes(duplicate)) missingInputs.push(duplicate);
    } else {
      seenElementIds.add(element.elementId);
    }
    const wMissing: string[] = [];
    const wWarnings: string[] = [];

    const area = resolveGlazedArea(element);
    wMissing.push(...area.missing);
    if (area.estimated) wWarnings.push(`glazing_area_estimated:${element.elementId}`);

    const orientation: WindowOrientation | null = element.orientation;
    if (orientation == null) {
      wMissing.push(`orientation:missing:${element.elementId}`);
    }

    let shgc: number | null = null;
    let shgcSource: ShgcSource | null = null;
    let shading: number | null = null;
    let shadingSource: ShadingSource | null = null;

    if (wMissing.length === 0) {
      const s = resolveShgc(element);
      shgc = s.shgc;
      shgcSource = s.source;
      wMissing.push(...s.missing);
      if (s.warning) wWarnings.push(s.warning);

      const sh = resolveShading(element);
      shading = sh.shadingFactor;
      shadingSource = sh.source;
      wMissing.push(...sh.missing);
      if (sh.warning) wWarnings.push(sh.warning);
    }

    if (wMissing.length > 0) {
      allResolved = false;
      for (const m of wMissing) if (!missingInputs.includes(m)) missingInputs.push(m);
    } else if (orientation != null && area.areaM2 != null && shgc != null && shading != null) {
      resolved.push({ elementId: element.elementId, orientation, coeff: area.areaM2 * shgc * shading });
    }

    for (const w of wWarnings) if (!warnings.includes(w)) warnings.push(w);

    windows.push({
      elementId: element.elementId,
      areaM2: area.areaM2,
      orientation,
      shgc,
      shgcSource,
      shadingFactor: shading,
      shadingSource,
      irradianceWm2: null,
      irradianceSource: null,
      coolingW: null,
    });
  }

  // ---- Aggregation (only when every window is fully resolved) ----
  let total: number | null = null;
  let aggregation: 'simultaneous_room_peak' | 'independent_peak_legacy' | null = null;
  const irradianceUsed = new Map<string, number>(); // elementId -> irradiance actually used

  if (elements.length === 0) {
    // No window elements → 0 W (calculated; nothing to sum).
    total = 0;
  } else if (!allResolved || solarData == null) {
    // A window is unresolved, or no solar data is attached → blocking missing.
    if (solarData == null && !missingInputs.includes('solar_irradiance:missing')) {
      missingInputs.push('solar_irradiance:missing');
    }
    allResolved = false;
  } else {
    const hourly = solarData.hourly ?? null;
    const usableHourly = hourly != null && Array.isArray(hourly.orientationOrder) && hourly.orientationOrder.length > 0
      && Array.isArray(hourly.irradianceWm2) && hourly.irradianceWm2.length > 0;

    if (usableHourly && hourly != null) {
      // Method B — SIMULTANEOUS room design peak.
      const orientIndex = new Map<WindowOrientation, number>();
      hourly.orientationOrder.forEach((o, i) => orientIndex.set(o, i));
      const idx = resolved.map((r) => orientIndex.get(r.orientation));
      if (idx.some((i) => i == null)) {
        // Orientation not covered by the series → treat as invalid (missing), never fabricate.
        for (const r of resolved) {
          if (orientIndex.get(r.orientation) == null) {
            if (!missingInputs.includes(`solar_irradiance:invalid:${r.orientation}`)) {
              missingInputs.push(`solar_irradiance:invalid:${r.orientation}`);
            }
          }
        }
        allResolved = false;
      } else {
        let peakSum = Number.NEGATIVE_INFINITY;
        let peakStep = 0;
        const steps = hourly.irradianceWm2.length;
        for (let t = 0; t < steps; t++) {
          const row = hourly.irradianceWm2[t];
          let sum = 0;
          for (let k = 0; k < resolved.length; k++) {
            sum += resolved[k].coeff * row[idx[k] as number];
          }
          if (sum > peakSum) {
            peakSum = sum;
            peakStep = t;
          }
        }
        if (!Number.isFinite(peakSum)) {
          allResolved = false;
        } else {
          total = peakSum;
          const peakRow = hourly.irradianceWm2[peakStep];
          for (let k = 0; k < resolved.length; k++) {
            irradianceUsed.set(resolved[k].elementId, peakRow[idx[k] as number]);
          }
          aggregation = 'simultaneous_room_peak';
        }
      }
    } else {
      // Method A (legacy) — sum of independent per-orientation maxima.
      let sum = 0;
      for (const r of resolved) {
        const raw = (solarData.values as SolarIrradianceByOrientation)[r.orientation];
        if (raw == null || !Number.isFinite(raw) || raw < 0) {
          if (!missingInputs.includes(`solar_irradiance:invalid:${r.orientation}`)) {
            missingInputs.push(`solar_irradiance:invalid:${r.orientation}`);
          }
          allResolved = false;
        } else {
          irradianceUsed.set(r.elementId, raw);
          sum += r.coeff * raw;
        }
      }
      if (allResolved) total = sum;
      aggregation = 'independent_peak_legacy';
    }
  }

  // ---- Fill irradiance + per-window cooling contribution ----
  if (allResolved && total != null && solarData != null) {
    for (const r of resolved) {
      const irr = irradianceUsed.get(r.elementId);
      const win = windows.find((w) => w.elementId === r.elementId);
      if (win && irr != null) {
        win.irradianceWm2 = irr;
        win.irradianceSource = solarData.source;
        win.coolingW = r.coeff * irr;
      }
    }
  }

  if (solarData != null) {
    warnings.push(`solar_dataset:${solarData.source}:${solarData.datasetVersion}`);
  }
  if (aggregation != null) {
    warnings.push(`solar_aggregation:${aggregation}`);
  }

  return {
    status: allResolved ? 'calculated' : 'missing_input',
    totalCoolingW: allResolved ? total : null,
    windows,
    missingInputs,
    warnings,
  };
}

/** Assemble the persisted solar breakdown (windows + totals + provenance). */
export function roomSolarBreakdown(result: RoomSolarResult): SolarBreakdown {
  return {
    windows: result.windows,
    totalCoolingW: result.totalCoolingW,
    missingInputs: [...result.missingInputs],
    warnings: [...result.warnings],
  };
}