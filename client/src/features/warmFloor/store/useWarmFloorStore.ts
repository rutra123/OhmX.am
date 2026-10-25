import { create } from 'zustand';
import type { WarmFloorSettingsV2 } from '../types/warmFloorSettings';
import type { 
  WarmFloorCalculatorState, 
  RoomType, 
  HeatingType, 
  CoveringType, 
  SubstrateType, 
  SystemType,
  CalculationResult 
} from '../types/calculatorState';
import type { RecommendedAccessories } from '../services/accessoryRecommender';
import type { BrandId } from '../types/brand';
import { loadWarmFloorSettingsV2 } from '../services/warmFloorSettingsService';
import { refineRecommendationsByBrand } from '../services/brandRefiner';
import { api } from '../../../api/client';

interface WarmFloorStore extends WarmFloorCalculatorState {
  recommendedAccessories: RecommendedAccessories | null;
  recommendedProducts: any[];
  accessoryProducts: any[];
  accessoryReplacements: any[];
  recommendationFallback: any | null;
  missingAccessoryRequirements: any[];
  regionProfile: string;
  
  // Guided flow state
  currentStepIndex: number;
  isGuided: boolean;

  loadSettings: () => Promise<void>;
  setInput: (partial: Partial<WarmFloorCalculatorState>) => void;
  setStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  startGuided: () => void;
  calculate: () => Promise<void>;
  selectBrand: (brandId: BrandId | null) => void;
  reset: () => void;
}

const initialState: Omit<WarmFloorCalculatorState, 'settings' | 'isLoading' | 'error'> = {
  area: 10,
  installationAreaM2: 8,
  roomType: 'bathroom',
  heatingType: 'comfort_floor',
  covering: 'tile',
  substrate: 'concrete_screed',
  insulationLevel: 'standard',
  systemType: 'auto',
  linearPower: 15,
  result: null,
  selectedBrand: null,
  showBrandSelection: false,
};

const WARM_FLOOR_DRAFT_KEY = 'ohmx:warm-floor-calculator:draft';
const WARM_FLOOR_DRAFT_VERSION = 2;

type WarmFloorDraft = Partial<Omit<WarmFloorStore, 'settings' | 'isLoading' | 'error' | 'loadSettings' | 'setInput' | 'setStep' | 'nextStep' | 'prevStep' | 'startGuided' | 'calculate' | 'selectBrand' | 'reset'>>;

const isRecord = (value: unknown): value is Record<string, any> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const safeArray = <T = any>(value: unknown): T[] => Array.isArray(value) ? value : [];
const safeRecordArray = <T = Record<string, any>>(value: unknown): T[] => (
  safeArray(value).filter(isRecord) as T[]
);

const safeNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const safeEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
);

const normalizeCalculationResult = (value: unknown): CalculationResult | null => {
  if (!isRecord(value)) return null;
  return {
    ...value,
    warnings: safeArray(value.warnings),
  } as CalculationResult;
};

const normalizeRecommendedAccessories = (value: unknown): RecommendedAccessories | null => {
  if (!isRecord(value)) return null;
  return {
    thermostat: safeRecordArray(value.thermostat),
    floorSensor: safeRecordArray(value.floorSensor),
    corrugatedTube: safeRecordArray(value.corrugatedTube),
    protection: safeRecordArray(value.protection),
    mountingTape: safeRecordArray(value.mountingTape),
    ...(Array.isArray(value.contactor) ? { contactor: safeRecordArray(value.contactor) } : {}),
  };
};

const migrateWarmFloorDraft = (raw: unknown): Record<string, any> => {
  if (!isRecord(raw)) return {};
  const persisted = isRecord(raw.state)
    ? { ...raw.state, persistVersion: raw.persistVersion ?? raw.version }
    : raw;
  const version = Number.isFinite(Number(persisted.persistVersion)) ? Number(persisted.persistVersion) : 0;
  if (version >= WARM_FLOOR_DRAFT_VERSION) return persisted;

  return {
    ...persisted,
    installationAreaM2: persisted.installationAreaM2 ?? persisted.heatedAreaM2,
    recommendedProducts: persisted.recommendedProducts ?? persisted.variants,
    accessoryProducts: persisted.accessoryProducts ?? persisted.accessories,
    recommendationFallback: persisted.recommendationFallback ?? persisted.fallback,
    regionProfile: persisted.regionProfile ?? 'AM',
  };
};

export const normalizeWarmFloorDraft = (raw: unknown): WarmFloorDraft => {
  const persisted = migrateWarmFloorDraft(raw);
  const area = safeNumber(persisted.area, initialState.area, 0, 10_000);
  const installationAreaM2 = Math.min(
    area,
    safeNumber(persisted.installationAreaM2, Math.min(initialState.installationAreaM2, area), 0, 10_000),
  );

  return {
    area,
    installationAreaM2,
    roomType: safeEnum(persisted.roomType, ['bathroom', 'kitchen', 'living_room', 'bedroom', 'balcony', 'corridor', 'local_zone', 'other'] as const, initialState.roomType),
    heatingType: safeEnum(persisted.heatingType, ['comfort_floor', 'additional_heating', 'main_heating', 'local_zone'] as const, initialState.heatingType),
    covering: safeEnum(persisted.covering, ['tile', 'porcelain', 'stone', 'laminate', 'vinyl', 'engineered_wood', 'other'] as const, initialState.covering),
    substrate: safeEnum(persisted.substrate, ['concrete_screed', 'tile_adhesive', 'old_tile', 'wood', 'insulation_board', 'other'] as const, initialState.substrate),
    insulationLevel: safeEnum(persisted.insulationLevel, ['poor', 'standard', 'good', 'excellent'] as const, initialState.insulationLevel),
    systemType: safeEnum(persisted.systemType, ['auto', 'cable', 'mat'] as const, initialState.systemType),
    linearPower: safeNumber(persisted.linearPower, initialState.linearPower, 1, 100),
    result: normalizeCalculationResult(persisted.result),
    selectedBrand: typeof persisted.selectedBrand === 'string' ? persisted.selectedBrand : null,
    showBrandSelection: typeof persisted.showBrandSelection === 'boolean' ? persisted.showBrandSelection : false,
    recommendedAccessories: normalizeRecommendedAccessories(persisted.recommendedAccessories),
    recommendedProducts: safeRecordArray(persisted.recommendedProducts),
    accessoryProducts: safeRecordArray(persisted.accessoryProducts),
    accessoryReplacements: safeRecordArray(persisted.accessoryReplacements),
    recommendationFallback: isRecord(persisted.recommendationFallback) ? persisted.recommendationFallback : null,
    missingAccessoryRequirements: safeRecordArray(persisted.missingAccessoryRequirements),
    currentStepIndex: Math.trunc(safeNumber(persisted.currentStepIndex, 0, 0, 8)),
    isGuided: typeof persisted.isGuided === 'boolean' ? persisted.isGuided : false,
    regionProfile: typeof persisted.regionProfile === 'string' && persisted.regionProfile.trim()
      ? persisted.regionProfile.trim().slice(0, 16)
      : 'AM',
  };
};

const readWarmFloorDraft = (): WarmFloorDraft => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WARM_FLOOR_DRAFT_KEY);
    return normalizeWarmFloorDraft(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeWarmFloorDraft({});
  }
};

const persistWarmFloorDraft = (state: Partial<WarmFloorStore>) => {
  if (typeof window === 'undefined') return;
  const draft = normalizeWarmFloorDraft(state);
  window.localStorage.setItem(WARM_FLOOR_DRAFT_KEY, JSON.stringify({
    persistVersion: WARM_FLOOR_DRAFT_VERSION,
    ...draft,
  }));
};

const clearWarmFloorDraft = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(WARM_FLOOR_DRAFT_KEY);
};

const persistedWarmFloorDraft = readWarmFloorDraft();

export const useWarmFloorStore = create<WarmFloorStore>((set, get) => ({
  ...initialState,
  ...persistedWarmFloorDraft,
  settings: null,
  isLoading: false,
  error: null,
  recommendedAccessories: persistedWarmFloorDraft.recommendedAccessories ?? null,
  recommendedProducts: safeRecordArray(persistedWarmFloorDraft.recommendedProducts),
  accessoryProducts: safeRecordArray(persistedWarmFloorDraft.accessoryProducts),
  accessoryReplacements: safeRecordArray(persistedWarmFloorDraft.accessoryReplacements),
  recommendationFallback: isRecord(persistedWarmFloorDraft.recommendationFallback) ? persistedWarmFloorDraft.recommendationFallback : null,
  missingAccessoryRequirements: safeRecordArray(persistedWarmFloorDraft.missingAccessoryRequirements),
  currentStepIndex: persistedWarmFloorDraft.currentStepIndex ?? 0,
  isGuided: persistedWarmFloorDraft.isGuided ?? false,
  regionProfile: persistedWarmFloorDraft.regionProfile || 'AM',

  loadSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const settings = await loadWarmFloorSettingsV2();
      set({ settings, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  setInput: (partial) => {
    const nextState = { ...get(), ...partial };
    set(partial);
    persistWarmFloorDraft(nextState);
  },

  setStep: (index) => {
    const nextState = { ...get(), currentStepIndex: index };
    set({ currentStepIndex: index });
    persistWarmFloorDraft(nextState);
  },
  
  nextStep: () => set((state) => {
    const nextState = { ...state, currentStepIndex: state.currentStepIndex + 1 };
    persistWarmFloorDraft(nextState);
    return { currentStepIndex: nextState.currentStepIndex };
  }),
  
  prevStep: () => set((state) => {
    const nextState = { ...state, currentStepIndex: Math.max(0, state.currentStepIndex - 1) };
    persistWarmFloorDraft(nextState);
    return { currentStepIndex: nextState.currentStepIndex };
  }),
  
  startGuided: () => {
    const nextState = { ...get(), isGuided: true, currentStepIndex: 0 };
    set({ isGuided: true, currentStepIndex: 0 });
    persistWarmFloorDraft(nextState);
  },

  calculate: async () => {
    const state = get();
    if (!state.settings) return;

    set({ isLoading: true, error: null });

    try {
      // Backend V3 is the single source of truth for final engineering results.
      // The legacy local preview must not apply coefficients or safety factors a second time.
      const recommendations = await api<any>('/tools/warm-floor/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          totalAreaM2: state.area,
          excludedAreaM2: Math.max(0, state.area - state.installationAreaM2),
          heatedAreaM2: state.installationAreaM2,
          roomPurpose: state.roomType,
          heatingGoal: state.heatingType,
          floorCovering: state.covering,
          substrateType: state.substrate,
          insulationLevel: state.insulationLevel,
          systemPreference: state.systemType,
          wetZone: state.roomType === 'bathroom',
          preferredBrands: state.selectedBrand ? [state.selectedBrand] : [],
          regionProfile: state.regionProfile,
        }),
      });

      const variants = safeRecordArray(recommendations?.variants);
      const accessories = safeRecordArray(recommendations?.accessories);
      const accessoryReplacements = safeRecordArray(recommendations?.accessoryReplacements);
      const missingAccessoryRequirements = safeRecordArray(recommendations?.missingAccessoryRequirements);
      const bestVariant = variants[0];
      const finalResult = {
        ...(isRecord(bestVariant?.calculation)
          ? bestVariant.calculation
          : isRecord(recommendations?.calculation) ? recommendations.calculation : {}),
        warnings: safeArray(bestVariant?.warnings ?? recommendations?.validation?.warnings),
      } as CalculationResult;
      const recommendationFallback = isRecord(recommendations?.fallback) ? recommendations.fallback : null;
      const nextState = {
        ...get(),
        result: finalResult,
        recommendedAccessories: null,
        recommendedProducts: variants,
        accessoryProducts: accessories,
        accessoryReplacements,
        recommendationFallback,
        missingAccessoryRequirements,
        showBrandSelection: true,
        isLoading: false,
        isGuided: false,
      };

      set({
        result: finalResult,
        recommendedAccessories: null,
        recommendedProducts: variants,
        accessoryProducts: accessories,
        accessoryReplacements,
        recommendationFallback,
        missingAccessoryRequirements,
        showBrandSelection: true,
        isLoading: false,
        isGuided: false,
      });
      persistWarmFloorDraft(nextState);
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectBrand: (brandId) => {
    const state = get();
    if (!state.settings || !state.recommendedAccessories) {
      const nextState = { ...state, selectedBrand: brandId };
      set({ selectedBrand: brandId });
      persistWarmFloorDraft(nextState);
      return;
    }

    const refined = brandId
      ? refineRecommendationsByBrand(
        state.recommendedAccessories,
        brandId,
        state.settings
      )
      : state.recommendedAccessories;

    const nextState = {
      ...get(),
      selectedBrand: brandId,
      recommendedAccessories: refined,
    };

    set({
      selectedBrand: brandId,
      recommendedAccessories: refined,
    });
    persistWarmFloorDraft(nextState);
  },

  reset: () => {
    clearWarmFloorDraft();
    set({
      ...initialState,
      settings: get().settings,
      recommendedAccessories: null,
      recommendedProducts: [],
      accessoryProducts: [],
      accessoryReplacements: [],
      recommendationFallback: null,
      missingAccessoryRequirements: [],
      currentStepIndex: 0,
      isGuided: false,
      regionProfile: 'AM',
      isLoading: false,
      error: null,
    });
  },
}));
