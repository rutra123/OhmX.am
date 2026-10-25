/**
 * Deterministic hydraulic helpers for the equipment/BOM engine.
 * Pure functions, SI units inside; m³/h, kPa and m H₂O at the boundary.
 */

export type GlycolPercent = 0 | 20 | 30 | 40;

export interface FluidProps {
  label: string;
  densityKgM3: number;
  cpKJkgK: number;
  /** Multiplier applied to water kinematic viscosity. */
  viscosityFactor: number;
}

/** Propylene-glycol values are indicative (≈20 °C), used only for preliminary sizing. */
export function fluidProps(glycol: GlycolPercent): FluidProps {
  switch (glycol) {
    case 20: return { label: 'пропиленгликоль 20%', densityKgM3: 1018, cpKJkgK: 3.95, viscosityFactor: 1.6 };
    case 30: return { label: 'пропиленгликоль 30%', densityKgM3: 1027, cpKJkgK: 3.85, viscosityFactor: 2.0 };
    case 40: return { label: 'пропиленгликоль 40%', densityKgM3: 1035, cpKJkgK: 3.75, viscosityFactor: 2.6 };
    default: return { label: 'вода', densityKgM3: 992, cpKJkgK: 4.18, viscosityFactor: 1 };
  }
}

/** Water kinematic viscosity, m²/s, linear between tabulated points. */
export function waterViscosity(tempC: number): number {
  const table: Array<[number, number]> = [[5, 1.52e-6], [10, 1.31e-6], [20, 1.0e-6], [35, 0.72e-6], [45, 0.6e-6], [60, 0.47e-6], [70, 0.41e-6], [80, 0.36e-6]];
  if (tempC <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i += 1) {
    const [t1, v1] = table[i];
    const [t0, v0] = table[i - 1];
    if (tempC <= t1) return v0 + ((v1 - v0) * (tempC - t0)) / (t1 - t0);
  }
  return table[table.length - 1][1];
}

/** Q = P / (ρ · cp · ΔT). For water ≈ 0.86 × P[kW] / ΔT. */
export function flowM3h(heatW: number, deltaTK: number, fluid: FluidProps): number {
  if (!(heatW > 0) || !(deltaTK > 0)) return 0;
  return (heatW / (fluid.densityKgM3 * fluid.cpKJkgK * 1000 * deltaTK)) * 3600;
}

/** Darcy–Weisbach pressure gradient, Pa/m (Swamee–Jain, smooth plastic ε = 0.007 mm). */
export function pipeGradientPaM(qM3h: number, innerDiameterM: number, meanTempC: number, fluid: FluidProps): number {
  if (!(qM3h > 0)) return 0;
  const area = (Math.PI * innerDiameterM ** 2) / 4;
  const v = qM3h / 3600 / area;
  const nu = waterViscosity(meanTempC) * fluid.viscosityFactor;
  const re = (v * innerDiameterM) / nu;
  const eps = 7e-6;
  const lambda = re < 2300 ? 64 / re : 0.25 / Math.log10(eps / (3.7 * innerDiameterM) + 5.74 / re ** 0.9) ** 2;
  return (lambda / innerDiameterM) * ((fluid.densityKgM3 * v ** 2) / 2);
}

export function velocityMs(qM3h: number, innerDiameterM: number): number {
  return qM3h / 3600 / ((Math.PI * innerDiameterM ** 2) / 4);
}

/** Δp across a valve: (Q / Kv)² bar → kPa. */
export function valveDpKPa(qM3h: number, kv: number): number {
  return (qM3h / kv) ** 2 * 100;
}

export const KPA_PER_M = 9.80665;

// ---------------------------------------------------------------------------
// Underfloor loops
// ---------------------------------------------------------------------------

export interface UfhLoopAssumptions {
  spacingM: number;
  maxLoopM: number;
  /** Supply + return lead between manifold and room. */
  leadM: number;
}

export const UFH_DEFAULTS: UfhLoopAssumptions = { spacingM: 0.15, maxLoopM: 100, leadM: 10 };

export function ufhLoops(areaM2: number, a: UfhLoopAssumptions = UFH_DEFAULTS): { loops: number; loopLengthM: number; pipeM: number } {
  if (!(areaM2 > 0)) return { loops: 0, loopLengthM: 0, pipeM: 0 };
  const inRoom = areaM2 / a.spacingM;
  const loops = Math.max(1, Math.ceil(inRoom / (a.maxLoopM - a.leadM)));
  const loopLengthM = inRoom / loops + a.leadM;
  return { loops, loopLengthM, pipeM: loopLengthM * loops };
}

// ---------------------------------------------------------------------------
// Main pipe size (multilayer PERT-AL-PERT), velocity limit
// ---------------------------------------------------------------------------

export const MULTILAYER_SIZES: Array<{ od: string; innerM: number; thread: string }> = [
  { od: '16×2', innerM: 0.012, thread: '1/2"' },
  { od: '20×2', innerM: 0.016, thread: '3/4"' },
  { od: '26×3', innerM: 0.02, thread: '1"' },
  { od: '32×3', innerM: 0.026, thread: '1 1/4"' },
  { od: '40×3,5', innerM: 0.033, thread: '1 1/2"' },
  { od: '50×4', innerM: 0.042, thread: '2"' },
];

export function mainPipeSize(qM3h: number, maxVelocityMs = 0.7) {
  return MULTILAYER_SIZES.find((s) => velocityMs(qM3h, s.innerM) <= maxVelocityMs) ?? MULTILAYER_SIZES[MULTILAYER_SIZES.length - 1];
}

// ---------------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------------

/**
 * Preliminary head at flow from catalog Hmax/Qmax using the usual parabolic
 * approximation of a wet-rotor circulator curve: H(Q) = Hmax·(1 − (Q/Qmax)²).
 * NOT a manufacturer curve — results stay preliminary.
 */
export function approxPumpHeadM(hMaxM: number, qMaxM3h: number, qM3h: number): number {
  if (qM3h >= qMaxM3h) return 0;
  return hMaxM * (1 - (qM3h / qMaxM3h) ** 2);
}
