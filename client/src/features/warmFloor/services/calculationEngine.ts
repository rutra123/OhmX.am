// client/src/features/warmFloor/services/calculationEngine.ts

import type {
  WarmFloorSettingsV2,
} from '../types/warmFloorSettings';
import type {
  CalculationResult,
  RoomType,
  HeatingType,
  CoveringType,
  SubstrateType,
  SystemType,
} from '../types/calculatorState';

interface CalculationParams {
  area: number;
  roomType: RoomType;
  heatingType: HeatingType;
  covering: CoveringType;
  substrate: SubstrateType;
  systemType: SystemType;
  linearPower: number;
  settings: WarmFloorSettingsV2;
  insulationLevel?: 'poor' | 'standard' | 'good' | 'excellent';
}

const INSULATION_FACTOR: Record<string, number> = {
  poor: 1.15,
  standard: 1.0,
  good: 0.92,
  excellent: 0.88,
};

/**
 * Local preview formulas (backend V3 remains source of truth for product matching):
 * q = preset(room, purpose) * insulationFactor
 * q = min(q, covering.maxPowerWm2)
 * P = A_install * q
 * I = P / U
 * cable length theory L = P / p_linear
 * spacing theory C_cm = p_linear * 100 / q   (= A*100/L)
 */
export function calculateWarmFloor(params: CalculationParams): CalculationResult {
  const {
    area,
    roomType,
    heatingType,
    covering,
    linearPower,
    settings,
    insulationLevel = 'standard',
  } = params;

  const preset = settings.powerPresetsWm2[roomType]?.[heatingType]
    ?? settings.powerPresetsWm2.other?.[heatingType]
    ?? 140;
  const insulationFactor = INSULATION_FACTOR[insulationLevel] ?? 1;
  const coveringLimit = settings.coveringCompatibility[covering] || settings.coveringCompatibility.other;
  let targetPowerWm2 = preset * insulationFactor;
  targetPowerWm2 = Math.min(targetPowerWm2, coveringLimit.maxPowerWm2 || 220);
  targetPowerWm2 = parseFloat(targetPowerWm2.toFixed(1));

  // Do NOT apply an extra safetyFactor on top of room presets (presets already include design intent).
  const totalPowerW = Math.round(area * targetPowerWm2);
  const voltage = Number(settings.voltage || 230);
  const currentA = parseFloat((totalPowerW / voltage).toFixed(2));

  const safeLinear = linearPower > 0 ? linearPower : 18;
  const totalCableLength = parseFloat((totalPowerW / safeLinear).toFixed(1));
  let layingStepCm = (safeLinear * 100) / targetPowerWm2;

  if (settings.calculationRules?.roundSpacingToAllowed && Array.isArray(settings.allowedCableSpacingCm)) {
    layingStepCm = settings.allowedCableSpacingCm.reduce((prev, curr) =>
      Math.abs(curr - layingStepCm) < Math.abs(prev - layingStepCm) ? curr : prev
    );
  }
  layingStepCm = parseFloat(layingStepCm.toFixed(1));

  const { maxPowerPerCircuitW, maxLengthPerCircuitM, default: defaultCircuits } = settings.calculationRules.numberOfCircuits;
  let numberOfCircuits = defaultCircuits;
  if (totalPowerW > maxPowerPerCircuitW || totalCableLength > maxLengthPerCircuitM) {
    const powerCircuits = Math.ceil(totalPowerW / maxPowerPerCircuitW);
    const lengthCircuits = Math.ceil(totalCableLength / maxLengthPerCircuitM);
    numberOfCircuits = Math.max(powerCircuits, lengthCircuits, defaultCircuits);
  }

  const warnings: string[] = [];
  if (preset * insulationFactor > (coveringLimit.maxPowerWm2 || 220)) {
    warnings.push(
      settings.warningTexts.COVERING_LIMIT.replace('{{maxFloorTemp}}', String(coveringLimit.maxFloorTempC ?? 27))
    );
  }
  if (heatingType === 'main_heating') {
    warnings.push(settings.warningTexts.MAIN_HEATING_CALC_NEEDED);
  }
  if (currentA > (settings.accessoryRules?.contactor?.requiredWhenCurrentOverA ?? 14)) {
    warnings.push(settings.warningTexts.HIGH_LOAD_CONTACTOR);
  }
  warnings.push(settings.warningTexts.NO_SHORTEN_CABLE);
  warnings.push(settings.warningTexts.SENSOR_PLACEMENT);

  const recommendedThermostatQueries = settings.accessoryRules.thermostat.query.slice(0, 4);

  return {
    roomAreaM2: area,
    installationAreaM2: area,
    heatingPurpose: heatingType,
    targetInstalledPowerWm2: targetPowerWm2,
    requiredTotalPowerW: totalPowerW,
    selectedProductTotalPowerW: totalPowerW,
    actualInstalledPowerWm2: targetPowerWm2,
    actualCurrentA: currentA,
    floorTemperatureLimitC: coveringLimit.maxFloorTempC,
    linearPowerWm: safeLinear,
    cableLengthM: totalCableLength,
    spacingCm: layingStepCm,
    numberOfCircuits,
    recommendedThermostatQueries,
    recommendedAccessories: [],
    warnings,
  };
}
