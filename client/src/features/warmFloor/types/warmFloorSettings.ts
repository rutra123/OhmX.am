// client/src/features/warmFloor/types/warmFloorSettings.ts

export interface PowerPreset {
  comfort_floor: number;
  additional_heating: number;
  main_heating: number;
  local_zone: number;
  sourceNote?: string;
}

export interface CoveringCompatibility {
  cable: boolean;
  mat: boolean;
  maxPowerWm2: number;
  maxFloorTempC: number;
  thinSystemPreferred: boolean;
  recommendedForMainHeating: boolean;
  note?: string;
}

export interface SubstrateCompatibility {
  cable: boolean;
  mat: boolean;
  minScreedThicknessMm?: number;
  note?: string;
}

export interface AccessoryRules {
  thermostat: {
    required: boolean;
    specificForUnderfloor: boolean;
    query: string[];
    excludeQuery: string[];
    note: string;
  };
  floorSensor: {
    required: boolean;
    query: string[];
  };
  corrugatedTube: {
    required: boolean;
    query: string[];
  };
  protection: {
    required: boolean;
    query: string[];
  };
  mountingTape: {
    requiredForCable: boolean;
    query: string[];
  };
  contactor: {
    requiredWhenCurrentOverA: number;
    query: string[];
    note: string;
  };
}

export interface CalculationRules {
  cableLengthFormula: string;
  spacingCmFormula: string;
  numberOfCircuits: {
    maxPowerPerCircuitW: number;
    maxLengthPerCircuitM: number;
    default: number;
    note: string;
  };
  currentCalculation: string;
  showLayingStep: boolean;
  showNumberOfCircuits: boolean;
  roundSpacingToAllowed: boolean;
}

export interface BrandOption {
  id: string;
  name: string;
  shortName: string;
  queryForProducts: string[];
  strengths: string;
  recommendedFor: string[];
  preferredThermostats: string[];
  note: string;
}

export interface WarmFloorSettingsV2 {
  version: number;
  lastUpdated: string;
  description: string;
  voltage: number;
  safetyFactor: number;

  powerPresetsWm2: Record<string, PowerPreset>;
  coveringCompatibility: Record<string, CoveringCompatibility>;
  substrateCompatibility: Record<string, SubstrateCompatibility>;

  cableLinearPowerOptions: number[];
  allowedCableSpacingCm: number[];

  matDefaults: {
    typicalSpacingCm: number;
    powerRangeWm2: number[];
    preferredForThinLayer: boolean;
    note: string;
  };

  mountingTape: {
    rowSpacingM: number;
    wasteFactor: number;
    minMeters: number;
    calculationNote: string;
  };

  accessoryRules: AccessoryRules;
  calculationRules: CalculationRules;
  warningTexts: Record<string, string>;

  displayRules: {
    afterCalculationShow: string[];
    numberOfCircuitsLabel: string;
    layingStepLabel: string;
  };

  brandSelection: {
    enabled: boolean;
    question: string;
    multiSelect: boolean;
    note: string;
    options: BrandOption[];
  };
}
