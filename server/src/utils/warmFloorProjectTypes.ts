/**
 * Warm-floor multi-room project types.
 * Engineering and commercial layers are intentionally separate.
 */

export type ProjectStatus = 'draft' | 'confirmed';
export type EngineeringStatus = 'PASS' | 'WARNING' | 'BLOCKED';
export type RoomPurpose =
  | 'bathroom'
  | 'kitchen'
  | 'living_room'
  | 'bedroom'
  | 'corridor'
  | 'balcony'
  | 'local_zone'
  | 'other'
  | string;

export type HeatingPurpose = 'comfort_floor' | 'additional_heating' | 'main_heating' | string;
export type BundleTierRole =
  | 'premium'
  | 'standard'
  | 'economy'
  | 'replacement_standard'
  | 'replacement_economy'
  | string;

export type QuantityScope =
  | 'per_project'
  | 'per_room'
  | 'per_control_zone'
  | 'per_heating_circuit'
  | 'per_room_circuit'
  | 'per_heating_kit'
  | 'length_based'
  | 'area_based';

export type PackingSource = 'explicit' | 'name_inferred' | 'unit_is_package' | 'none';
export type PriceStatus = 'ok' | 'missing' | 'unavailable' | 'manual_no_price';

export interface EngineeringIssue {
  code: string;
  severity: 'info' | 'warning' | 'block';
  params?: Record<string, unknown>;
  message?: string;
}

export interface PowerCalculation {
  heatedAreaM2: number;
  roomAreaM2: number;
  excludedAreaM2: number;
  targetWm2: number;
  requiredPowerW: number;
  designPowerW: number;
  installedPowerW: number | null;
  installedWm2: number | null;
  powerReserveW: number | null;
  powerDeficitW: number | null;
  powerFitPercent: number | null;
  voltageV: number;
  currentA: number | null;
  coveringMaxWm2: number;
  floorTemperatureLimitC: number;
  mainHeatingMode: string;
  insulationFactor: number;
  preferredSystem: string;
  /** quick_estimate | heat_loss — honesty label for calculation mode */
  calculationMode: 'quick_estimate' | 'heat_loss';
  formulas: Record<string, string>;
  reasons: EngineeringIssue[];
}

export interface RoomInput {
  id: string;
  name: string;
  roomType: RoomPurpose;
  roomAreaM2: number;
  installationAreaM2: number;
  excludedAreaM2?: number;
  heatingPurpose: HeatingPurpose;
  floorCovering: string;
  substrateType: string;
  insulationLevel?: string;
  systemPreference?: 'auto' | 'mat' | 'cable';
  wetZone?: boolean;
  heatLossW?: number | null;
  preferredBrands?: string[];
  budgetLevel?: string;
  includeAccessories?: boolean;
  regionProfile?: string;
  notes?: string;
  /** User lock after reviewing variants */
  lockedVariantRole?: string | null;
  controlZones?: number;
}

export interface SpecLineItem {
  lineId: string;
  roomId: string;
  roomName: string;
  productId: number | null;
  sku: string;
  article: string;
  name: string;
  brand: string;
  role: string;
  accessoryGroup?: string | null;
  /** Engineering required quantity (before package rounding) */
  requiredQuantity: number;
  /** Alias used by BOM aggregation / UI */
  quantity: number;
  unit: string;
  packageSize: number | null;
  packageCount: number | null;
  purchaseQuantity: number;
  surplus: number;
  packingSource: PackingSource;
  packingNote?: string;
  quantityScope: QuantityScope;
  engineeringReasonCodes: string[];
  isManualLineItem?: boolean;
  selectedTierRole?: string | null;
  unitPrice: number | null;
  currency: string;
  lineTotal: number | null;
  priceStatus: PriceStatus;
  productType?: string | null;
}

export interface RoomEngineeringResult {
  roomId: string;
  status: EngineeringStatus;
  issues: EngineeringIssue[];
  power: PowerCalculation;
  normalizedInput: Record<string, unknown>;
  validation: { valid: boolean; errors: unknown[]; warnings: unknown[] };
  design: Record<string, unknown>;
}

export interface RoomSelectionResult {
  roomId: string;
  status: EngineeringStatus;
  issues: EngineeringIssue[];
  matcherStatus: string;
  selectedRole: string | null;
  variants: any[];
  selectedVariant: any | null;
  accessories: any[];
  accessoryReplacements: any[];
  missingAccessoryRequirements: any[];
  multiUnit: null | {
    strategy: 'single' | 'multi_mat' | 'multi_cable';
    unitCount: number;
    reasonCodes: string[];
  };
  selectionReasons: EngineeringIssue[];
  controlZones: number;
  circuitSummary: null | {
    heatingKits: number;
    controlZones: number;
    installedPowerW: number;
    actualCurrentA: number;
    voltageV: number;
    protectionScheme: string | null;
  };
}

export interface RoomProjectResult {
  room: RoomInput;
  engineering: RoomEngineeringResult;
  selection: RoomSelectionResult;
  roomSpecification: SpecLineItem[];
}

export interface ConsolidatedBomLine {
  key: string;
  productId: number | null;
  sku: string;
  article: string;
  name: string;
  brand: string;
  role: string;
  /** purchase quantity total */
  quantity: number;
  requiredQuantity: number;
  purchaseQuantity: number;
  surplus: number;
  packageSize?: number | null;
  packageCount?: number | null;
  packingNote?: string | null;
  unit: string;
  unitPrice: number | null;
  currency: string;
  lineTotal: number | null;
  priceStatus: PriceStatus;
  isManualLineItem?: boolean;
  quantityScope?: QuantityScope;
  packingSource?: PackingSource;
  roomDistribution: Array<{ roomId: string; roomName: string; quantity: number }>;
}

export interface ProjectEstimate {
  currency: string;
  lines: Array<{
    productId: number | null;
    sku: string;
    article: string;
    name: string;
    role?: string;
    quantity: number;
    requiredQuantity?: number;
    purchaseQuantity: number;
    surplus?: number;
    packageSize?: number | null;
    packageCount?: number | null;
    packingSource?: PackingSource;
    packingNote?: string | null;
    unit: string;
    unitPrice: number | null;
    lineTotal: number | null;
    priceMissing: boolean;
    priceStatus: PriceStatus;
    roomDistribution?: Array<{ roomId: string; roomName: string; quantity: number }>;
  }>;
  equipmentSubtotal: number | null;
  projectTotal: number | null;
  missingPriceCount: number;
  incompleteCommercial: boolean;
  pricedLineCount: number;
  totalLineCount: number;
}

export type ObjectType = 'apartment' | 'private_house' | string;

export interface WarmFloorProject {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  regionProfile: string;
  preferredBundleRole: BundleTierRole;
  /** Optional site context — not a substitute for room list. */
  objectType?: ObjectType | null;
  /** Total building/object area (m²). Independent of Σ room areas. */
  objectTotalAreaM2?: number | null;
  rooms: RoomInput[];
  draftResult: null | {
    computedAt: string;
    overallStatus: EngineeringStatus;
    rooms: RoomProjectResult[];
    specificationByRoom: SpecLineItem[];
    consolidatedBom: ConsolidatedBomLine[];
    estimatePreview: ProjectEstimate;
  };
  confirmedSnapshot: null | {
    confirmedAt: string;
    overallStatus: EngineeringStatus;
    rooms: RoomProjectResult[];
    specificationByRoom: SpecLineItem[];
    consolidatedBom: ConsolidatedBomLine[];
    estimate: ProjectEstimate;
    roomInputs: RoomInput[];
    preferredBundleRole: BundleTierRole;
    objectType?: ObjectType | null;
    objectTotalAreaM2?: number | null;
  };
}

export interface CreateProjectInput {
  name?: string;
  regionProfile?: string;
  preferredBundleRole?: BundleTierRole;
  objectType?: ObjectType | null;
  objectTotalAreaM2?: number | null;
  rooms?: RoomInput[];
}
