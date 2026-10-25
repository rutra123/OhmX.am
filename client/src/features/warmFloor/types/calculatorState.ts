// client/src/features/warmFloor/types/calculatorState.ts

import type { WarmFloorSettingsV2 } from './warmFloorSettings';

export type RoomType = 
  | 'bathroom' 
  | 'kitchen' 
  | 'living_room' 
  | 'bedroom' 
  | 'balcony' 
  | 'corridor' 
  | 'local_zone' 
  | 'other';

export type HeatingType = 'comfort_floor' | 'additional_heating' | 'main_heating' | 'local_zone';

export type CoveringType = 'tile' | 'porcelain' | 'stone' | 'laminate' | 'vinyl' | 'engineered_wood' | 'other';
export type SubstrateType = 'concrete_screed' | 'tile_adhesive' | 'old_tile' | 'wood' | 'insulation_board' | 'other';

export type SystemType = 'auto' | 'cable' | 'mat';

export interface CalculationResult {
  roomAreaM2: number;
  excludedAreaM2?: number;
  installationAreaM2: number;
  heatingPurpose: string;
  targetInstalledPowerWm2: number;
  requiredTotalPowerW: number;
  selectedProductTotalPowerW: number;
  actualInstalledPowerWm2: number;
  actualCurrentA: number;
  floorTemperatureLimitC: number;
  cableLengthM?: number;
  linearPowerWm?: number;
  spacingCm?: number;
  mountingTapeLengthM?: number;
  totalMatAreaM2?: number;
  coveragePercent?: number;
  numberOfCircuits?: number;
  recommendedThermostatQueries?: string[];
  recommendedAccessories?: any[];
  warnings: Array<string | { code: string; params?: Record<string, unknown> }>;
}

export interface WarmFloorCalculatorState {
  settings: WarmFloorSettingsV2 | null;
  isLoading: boolean;
  error: string | null;

  // Inputs
  area: number;
  installationAreaM2: number;
  roomType: RoomType;
  heatingType: HeatingType;
  covering: CoveringType;
  substrate: SubstrateType;
  insulationLevel: 'poor' | 'standard' | 'good' | 'excellent';
  systemType: SystemType;
  linearPower: number; // Вт/м

  // Results
  result: CalculationResult | null;
  selectedBrand: string | null;

  // UI state
  showBrandSelection: boolean;
}
