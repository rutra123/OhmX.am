/**
 * Shared types of the inventory-aware selection layer.
 *
 * Three concerns are kept apart on purpose:
 *   - identity / wording  (what the catalog calls the product)       -> ProductProfile
 *   - engineering fit     (does it satisfy the role, on what evidence) -> MatchClass + reasons
 *   - availability        (is there enough of it on stock)             -> StockCheck
 */

/** Verification classification of a candidate or a selected BOM position (directive §15). */
export type MatchClass =
  | 'EXACT_VERIFIED'
  | 'SUBSTITUTE_VERIFIED'
  | 'SUBSTITUTE_CONDITIONAL'
  | 'INSUFFICIENT_DATA'
  | 'INCOMPATIBLE'
  | 'UNAVAILABLE'
  | 'INSUFFICIENT_QUANTITY'
  | 'REQUIRES_ENGINEERING_REVIEW';

export const MATCH_CLASS_LABEL: Record<MatchClass, string> = {
  EXACT_VERIFIED: 'точное соответствие, подтверждено',
  SUBSTITUTE_VERIFIED: 'замена, подтверждена',
  SUBSTITUTE_CONDITIONAL: 'замена условно — нужна проверка',
  INSUFFICIENT_DATA: 'недостаточно данных',
  INCOMPATIBLE: 'не подходит',
  UNAVAILABLE: 'нет подходящего товара',
  INSUFFICIENT_QUANTITY: 'не хватает на складе',
  REQUIRES_ENGINEERING_REVIEW: 'нужно решение инженера',
};

/** Classes a product may be auto-selected with; anything else is only listed. */
export const SELECTABLE: ReadonlySet<MatchClass> = new Set(['EXACT_VERIFIED', 'SUBSTITUTE_VERIFIED', 'SUBSTITUTE_CONDITIONAL']);

/** Strength order for ranking (lower = stronger evidence). */
export const CLASS_RANK: Record<MatchClass, number> = {
  EXACT_VERIFIED: 0,
  SUBSTITUTE_VERIFIED: 1,
  SUBSTITUTE_CONDITIONAL: 2,
  REQUIRES_ENGINEERING_REVIEW: 3,
  INSUFFICIENT_QUANTITY: 4,
  INSUFFICIENT_DATA: 5,
  UNAVAILABLE: 6,
  INCOMPATIBLE: 7,
};

/** Weakest of several classes (a chain is only as verified as its weakest link). */
export function weakest(...classes: MatchClass[]): MatchClass {
  return classes.reduce((a, b) => (CLASS_RANK[b] > CLASS_RANK[a] ? b : a), 'EXACT_VERIFIED' as MatchClass);
}

/**
 * Where an attribute value comes from. Only 'datasheet' (manufacturer document with id) and
 * 'profile' (approved engineering profile) can verify a mandatory requirement.
 */
export type AttrSource = 'name' | 'feature' | 'description' | 'profile' | 'datasheet';

export interface Attr {
  v: string | number | boolean;
  u: string | null;
  src: AttrSource;
  raw?: string;
  /** Evidence document id (EVIDENCE registry) for datasheet values. */
  doc?: string;
}

export type FunctionalType =
  | 'HEAT_PUMP' | 'CIRCULATION_PUMP' | 'BOILER_SPARE_PUMP' | 'OTHER_PUMP' | 'MIXING_UNIT'
  | 'MANIFOLD' | 'MANIFOLD_PLUG' | 'MANIFOLD_ACCESSORY' | 'HYDRAULIC_SEPARATOR'
  | 'THERMAL_ACTUATOR' | 'MOTOR_ACTUATOR' | 'ZONE_CONTROLLER' | 'CONTROL_ACCESSORY' | 'FLOOR_SENSOR'
  | 'WATER_UFH_THERMOSTAT' | 'ROOM_THERMOSTAT' | 'ELECTRIC_UFH_THERMOSTAT' | 'THERMOSTAT_OTHER'
  | 'EXPANSION_VESSEL' | 'AIR_VENT' | 'STRAINER' | 'CHECK_VALVE' | 'SAFETY_VALVE' | 'BALL_VALVE'
  | 'FAN_COIL' | 'RADIATOR' | 'CONVECTOR' | 'ELECTRIC_CONVECTOR' | 'TOWEL_WARMER' | 'BOILER';

export interface ProductProfile {
  sku: string;
  name: string;
  brand: string | null;
  /** Catalog category slug (used for batched live lookups). */
  cat: string;
  type: FunctionalType;
  /** Approved engineering profile type, when one exists. */
  profile: string | null;
  attrs: Record<string, Attr>;
  /** Found by name outside the HVAC category trees (classification error in the catalog). */
  crossCategory?: boolean;
}

/** Availability of one SKU for the quantity the BOM needs. */
export interface StockCheck {
  status: 'SUFFICIENT' | 'INSUFFICIENT' | 'IN_STOCK_QTY_UNVERIFIED' | 'NOT_IN_STOCK' | 'UNKNOWN';
  required: number | null;
  /** Available-to-sell quantity when a quantity source exists. */
  available: number | null;
  /** 'public-status' = live public availability flag only (no quantity); 'quantity' = quantity source. */
  source: 'public-status' | 'quantity' | 'none';
  asOf: string | null;
  /** Label of the quantity source, e.g. "test fixture" — never shown as live stock unless source is live. */
  sourceLabel?: string;
}

/** Why a candidate was or was not used — every screened product gets one (no silent drops). */
export interface ScreeningRecord {
  sku: string;
  name: string;
  brand: string | null;
  verdict: MatchClass;
  reasons: string[];
  inStock: boolean | null;
  selected: boolean;
}

export interface RoleCoverage {
  role: string;
  label: string;
  /** Functional types screened for the role. */
  screenedTypes: FunctionalType[];
  /** Number of catalog profiles of those types in the snapshot. */
  population: number;
  screening: ScreeningRecord[];
}
