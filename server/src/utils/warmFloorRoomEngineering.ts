/**
 * Room-level engineering power model.
 * Uses warmFloorEngineV3 formulas without modifying them.
 * Adds machine-readable power fields + PASS/WARNING/BLOCKED status.
 */
import {
  getWarmFloorConfigV3,
  normalizeWarmFloorInputV3,
  validateWarmFloorInputV3,
  resolveDesignTargets,
} from './warmFloorEngineV3.js';
import type {
  EngineeringIssue,
  EngineeringStatus,
  PowerCalculation,
  RoomEngineeringResult,
  RoomInput,
} from './warmFloorProjectTypes.js';

function round(value: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * f) / f;
}

export function roomInputToEngineRaw(room: RoomInput) {
  const wetDefault = room.roomType === 'bathroom' || room.roomType === 'balcony';
  return {
    roomType: room.roomType,
    roomPurpose: room.roomType,
    roomAreaM2: room.roomAreaM2,
    totalAreaM2: room.roomAreaM2,
    installationAreaM2: room.installationAreaM2,
    heatedAreaM2: room.installationAreaM2,
    excludedAreaM2: room.excludedAreaM2,
    substrateType: room.substrateType,
    floorCovering: room.floorCovering,
    heatingPurpose: room.heatingPurpose,
    heatingGoal: room.heatingPurpose,
    insulationLevel: room.insulationLevel || 'standard',
    budgetLevel: room.budgetLevel || 'premium',
    includeAccessories: room.includeAccessories !== false,
    systemPreference: room.systemPreference || 'auto',
    wetZone: room.wetZone ?? wetDefault,
    preferredBrands: room.preferredBrands || [],
    heatLossW: room.heatLossW ?? null,
    regionProfile: room.regionProfile || 'AM',
  };
}

function worstStatus(statuses: EngineeringStatus[]): EngineeringStatus {
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('WARNING')) return 'WARNING';
  return 'PASS';
}

/**
 * Pure engineering need for a room — before product selection.
 * installed* fields stay null until a product is bound.
 */
export function calculateRoomEngineering(room: RoomInput): RoomEngineeringResult {
  const config = getWarmFloorConfigV3();
  const raw = roomInputToEngineRaw(room);
  const normalized = normalizeWarmFloorInputV3(raw);
  const validation = validateWarmFloorInputV3(normalized, config);
  const design = resolveDesignTargets(normalized, config);
  const issues: EngineeringIssue[] = [];

  for (const err of validation.errors || []) {
    issues.push({
      code: typeof err === 'object' && err && 'code' in err ? String((err as any).code) : 'validation.error',
      severity: 'block',
      params: typeof err === 'object' && err && 'params' in err ? (err as any).params : {},
    });
  }
  for (const warn of validation.warnings || []) {
    issues.push({
      code: typeof warn === 'object' && warn && 'code' in warn ? String((warn as any).code) : 'validation.warning',
      severity: 'warning',
      params: typeof warn === 'object' && warn && 'params' in warn ? (warn as any).params : {},
    });
  }

  // Engineering policy checks (status layer; formulas unchanged)
  if (design.preferredSystem === 'blocked') {
    issues.push({
      code: 'engineering.standardWetSystemBlocked',
      severity: 'block',
      params: { substrate: normalized.substrateType },
      message: 'Standard wet mat/cable auto-selection is blocked for this substrate; special dry system or manual design required.',
    });
  }

  if (normalized.heatingPurpose === 'main_heating' && design.mainHeatingMode !== 'heat_loss') {
    issues.push({
      code: 'engineering.mainHeatingNeedsHeatLoss',
      severity: 'warning',
      params: { mode: design.mainHeatingMode },
      message: 'Main heating sized by area fallback only; heat-loss input required for a confirmed main-heating claim.',
    });
  }

  if (design.coveringLimited) {
    issues.push({
      code: 'engineering.coveringLimitedTarget',
      severity: 'warning',
      params: {
        coveringMaxWm2: design.coveringMaxWm2,
        targetWm2: design.targetInstalledPowerWm2,
      },
    });
  }

  // Impossible design: main heating heat loss demands density above covering limit
  if (
    normalized.heatingPurpose === 'main_heating'
    && design.mainHeatingMode === 'heat_loss'
    && design.internalTargetInstalledPowerWm2 > design.coveringMaxWm2 + 1e-9
  ) {
    issues.push({
      code: 'engineering.heatLossExceedsCoveringLimit',
      severity: 'block',
      params: {
        requiredWm2: round(design.internalTargetInstalledPowerWm2, 1),
        coveringMaxWm2: design.coveringMaxWm2,
        requiredPowerW: design.requiredTotalPowerW,
      },
      message: 'Heat-loss based power density exceeds covering maximum installed W/m²; redesign insulation/covering or heating concept.',
    });
  }

  if (normalized.installationAreaM2 <= 0 || normalized.roomAreaM2 <= 0) {
    issues.push({
      code: 'engineering.invalidArea',
      severity: 'block',
      params: {
        roomAreaM2: normalized.roomAreaM2,
        installationAreaM2: normalized.installationAreaM2,
      },
    });
  }

  const reasons: EngineeringIssue[] = [
    {
      code: 'power.reason.presetDensity',
      severity: 'info',
      params: {
        roomType: normalized.roomType,
        heatingPurpose: normalized.heatingPurpose,
        insulationFactor: design.insulationFactor,
        targetWm2: design.targetInstalledPowerWm2,
      },
    },
    {
      code: 'power.reason.requiredFromArea',
      severity: 'info',
      params: {
        formula: 'installationAreaM2 * targetInstalledPowerWm2',
        installationAreaM2: normalized.installationAreaM2,
        targetWm2: design.targetInstalledPowerWm2,
        requiredPowerW: design.requiredTotalPowerW,
      },
    },
  ];
  if (design.mainHeatingMode === 'heat_loss') {
    reasons.push({
      code: 'power.reason.heatLossMargin',
      severity: 'info',
      params: {
        heatLossW: normalized.heatLossW,
        mainHeatingMode: design.mainHeatingMode,
        requiredPowerW: design.requiredTotalPowerW,
      },
    });
  }

  const power: PowerCalculation = {
    heatedAreaM2: normalized.installationAreaM2,
    roomAreaM2: normalized.roomAreaM2,
    excludedAreaM2: normalized.excludedAreaM2,
    targetWm2: design.targetInstalledPowerWm2,
    requiredPowerW: design.requiredTotalPowerW,
    designPowerW: design.requiredTotalPowerW,
    installedPowerW: null,
    installedWm2: null,
    powerReserveW: null,
    powerDeficitW: null,
    powerFitPercent: null,
    voltageV: design.voltageV,
    currentA: null,
    coveringMaxWm2: design.coveringMaxWm2,
    floorTemperatureLimitC: design.floorTemperatureLimitC,
    mainHeatingMode: design.mainHeatingMode,
    insulationFactor: design.insulationFactor,
    preferredSystem: design.preferredSystem,
    calculationMode: design.mainHeatingMode === 'heat_loss' ? 'heat_loss' : 'quick_estimate',
    formulas: {
      targetWm2: 'min(roomPresetDefault * insulationFactor, covering.maxInstalledPowerWm2)',
      requiredPowerW: 'installationAreaM2 * targetWm2 (main: max with heatLossW * margin when provided)',
      currentA: 'installedPowerW / voltageV',
      installedWm2: 'installedPowerW / installationAreaM2',
      reserveW: 'installedPowerW - requiredPowerW',
    },
    reasons,
  };

  const status = worstStatus([
    issues.some((i) => i.severity === 'block') ? 'BLOCKED' : 'PASS',
    issues.some((i) => i.severity === 'warning') ? 'WARNING' : 'PASS',
    validation.valid ? 'PASS' : 'BLOCKED',
  ]);

  return {
    roomId: room.id,
    status,
    issues,
    power,
    normalizedInput: normalized,
    validation,
    design: {
      targetInstalledPowerWm2: design.targetInstalledPowerWm2,
      requiredTotalPowerW: design.requiredTotalPowerW,
      insulationFactor: design.insulationFactor,
      preferredSystem: design.preferredSystem,
      coveringMaxWm2: design.coveringMaxWm2,
      floorTemperatureLimitC: design.floorTemperatureLimitC,
      voltageV: design.voltageV,
      mainHeatingMode: design.mainHeatingMode,
      coveringLimited: design.coveringLimited,
      spacingRules: design.spacingRules,
      indoorCableLinearPowerMaxWm: design.indoorCableLinearPowerMaxWm,
    },
  };
}

/** Bind a selected product power onto an engineering result (does not re-run design targets). */
export function bindInstalledPower(
  engineering: RoomEngineeringResult,
  installedPowerW: number,
  extras: Partial<PowerCalculation> = {},
): RoomEngineeringResult {
  const required = engineering.power.requiredPowerW;
  const heated = engineering.power.heatedAreaM2;
  const installed = Math.round(Number(installedPowerW) || 0);
  const installedWm2 = heated > 0 ? round(installed / heated, 1) : 0;
  const reserve = installed - required;
  const fit = required > 0 ? round((installed / required) * 100, 1) : null;
  const currentA = engineering.power.voltageV > 0
    ? round(installed / engineering.power.voltageV, 2)
    : null;

  const issues = [...engineering.issues];
  if (fit != null && fit < 85) {
    issues.push({
      code: 'engineering.installedPowerUnder',
      severity: 'warning',
      params: { powerFitPercent: fit, installedPowerW: installed, requiredPowerW: required },
    });
  }
  if (fit != null && fit > 120) {
    issues.push({
      code: 'engineering.installedPowerOver',
      severity: 'warning',
      params: { powerFitPercent: fit, installedPowerW: installed, requiredPowerW: required },
    });
  }
  if (installedWm2 > engineering.power.coveringMaxWm2 + 1e-9) {
    issues.push({
      code: 'engineering.installedExceedsCovering',
      severity: 'block',
      params: { installedWm2, coveringMaxWm2: engineering.power.coveringMaxWm2 },
    });
  }

  const status = worstStatus([
    engineering.status,
    issues.some((i) => i.severity === 'block') ? 'BLOCKED' : 'PASS',
    issues.some((i) => i.severity === 'warning') ? 'WARNING' : 'PASS',
  ]);

  return {
    ...engineering,
    status,
    issues,
    power: {
      ...engineering.power,
      installedPowerW: installed,
      installedWm2,
      powerReserveW: reserve >= 0 ? reserve : 0,
      powerDeficitW: reserve < 0 ? Math.abs(reserve) : 0,
      powerFitPercent: fit,
      currentA,
      ...extras,
    },
  };
}

export function aggregateEngineeringStatus(statuses: EngineeringStatus[]): EngineeringStatus {
  return worstStatus(statuses);
}
