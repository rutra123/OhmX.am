/**
 * Equipment selection + bill of materials for a Building Project.
 *
 * Deterministic and pure: the same project, loads, design inputs and catalog
 * data always produce the same specification, rebuilt from scratch on every
 * call (no accumulation, no duplicates). The protected load engine is only
 * read: heating requirement = required capacity from loadResultSummary
 * (QUICK: base × 1.20 once; professional: base), cooling = base load.
 *
 * Two phases, same function:
 *   1. without catalog data -> design, fan-coil requests, SKUs to look up;
 *   2. with fan-coil picks + catalog lookups -> resolved lines and prices.
 */
import type { BuildingLoadCalculation, BuildingProject, EngineeringRoomAssignment } from '../types';
import { buildLoadResultSummary } from '../utils/loadResultSummary';
import type { TowelWarmerSelection } from '../utils/towelWarmer';
import {
  AIR_VENTS,
  BALL_VALVES_FM,
  COMPRESSION_FITTING_20,
  EXPANSION_TANKS,
  FHF_ACCESSORIES,
  FILL_DRAIN_VALVE,
  HYDRAULIC_SEPARATOR,
  MANOMETER,
  SAFETY_VALVE_3BAR,
  THERMOMETER,
  TOWEL_VALVE,
  MAX_MANIFOLD_OUTLETS,
  MIXING_UNITS,
  RADIATOR_VALVE_KIT,
  STRAINERS,
  UFH_PIPE,
  WATER_TOWEL_WARMERS,
  type MixingUnitFact,
} from './catalogFacts';
import { FAN_COIL_MOUNTINGS, FAN_COIL_MOUNTING_TEXT, fanCoilCountByMounting, fanCoilFits, fanCoilMountingInfo, isFanCoilMounting, type FanCoilMounting } from './fanCoilMounting';
import { auditSpecification, type AuditResult } from './selection/audit';
import { boilerOptions, confirmOption, electricHeaterOptions, excludeOption, productOptions, selectedOption, terminalOptions, towelWarmerOptions, type ChoiceOption, type LineChoice } from './selection/choices';
import { attr, catalogIndex, num, sourceLabel, str } from './selection/catalogIndex';
import { selectControlChain, type ArchitectureResult, type ControlZone } from './selection/controlChain';
import { DEFAULT_SELECTION_POLICY, stockCheck, stockText, type InventoryInput, type QuantityRecord, type SelectionPolicy } from './selection/inventory';
import { selectManifold, type ManifoldSelection } from './selection/manifolds';
import { PUMP_MAX_FLOW_SHARE, selectPump } from './selection/pumps';
import type { FunctionalType, MatchClass, ProductProfile, RoleCoverage, ScreeningRecord, StockCheck } from './selection/types';
import snapshot from './fanCoilHydraulicSnapshot.json';
import {
  HEAT_PUMPS,
  assessHeatPump,
  assessTopology,
  describeHeatPump,
  rankHeatPumps,
  type HeatPumpAssessment,
  type HeatPumpRequirement,
  type HeatPumpVerdict,
  type TopologyResult,
} from './plantSelection';
import {
  KPA_PER_M,
  UFH_DEFAULTS,
  fluidProps,
  flowM3h,
  mainPipeSize,
  pipeGradientPaM,
  ufhLoops,
  valveDpKPa,
  velocityMs,
  type FluidProps,
  type GlycolPercent,
} from './hydraulics';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DesignInputs {
  /** Fan-coil water distribution: home-run manifold (with actuators) or tee/branch piping. */
  fanCoilDistribution: 'manifold' | 'branch';
  /** One-way pipe length from the heat source to the farthest terminal, m. */
  criticalPathM: number | null;
  glycolPercent: GlycolPercent;
  /** Available external head of the source's integrated pump, kPa (null = unknown). */
  sourcePumpHeadKPa: number | null;
  /** Engineer override of the design heating load for the heat source, kW (null = use calculated / connected). */
  designHeatingKw: number | null;
  /** Engineer override of the design cooling load, kW. */
  designCoolingKw: number | null;
  /** Minimum system water content, L per kW of heat pump heating (null = engineering assumption is used and flagged). */
  minWaterLPerKw: number | null;
  /** A bypass valve keeps the minimum flow when all zone valves close. */
  bypassProvided: boolean;
}

export const DEFAULT_DESIGN_INPUTS: DesignInputs = {
  fanCoilDistribution: 'manifold',
  criticalPathM: null,
  glycolPercent: 0,
  sourcePumpHeadKPa: null,
  designHeatingKw: null,
  designCoolingKw: null,
  minWaterLPerKw: null,
  bypassProvided: false,
};

/** Water-content guideline used ONLY when the manufacturer value is unknown; always shown as an assumption. */
export const ASSUMED_MIN_WATER_L_PER_KW = 10;

export type LineGroup = 'main' | 'distribution' | 'pumps' | 'automation' | 'fittings';
export type LineStatus = 'catalog' | 'missing' | 'choice';
export type QtyStatus = 'confirmed' | 'estimated' | 'by_installer';

export interface CatalogProduct {
  sku: string;
  name: string;
  slug: string;
  /** null when the catalog shows no price (0 / hidden) — "по запросу". */
  priceAmd: number | null;
  unit: string;
  availabilityLabel: string | null;
  /** Catalog product id (needed to put the line into the cart). */
  id?: number | null;
  image?: string;
  /** true = on our stock (sell now), false = to order, null/undefined = unknown. */
  inStock?: boolean | null;
  /** The shop allows online ordering (in stock and priced). */
  canAddToCart?: boolean;
}

export interface BomLine {
  key: string;
  group: LineGroup;
  /** Descriptive Russian equipment name (always shown). */
  name: string;
  /** Catalog SKU — only for catalog lines that exist in the live catalog. */
  sku: string | null;
  quantity: number | null;
  unit: string;
  qtyStatus: QtyStatus;
  status: LineStatus;
  /** Short customer-facing reason. */
  reason: string;
  /** Things the installer/engineer must still check. */
  checks: string[];
  /** Engineering notes for the collapsible technical section. */
  tech: string[];
  evidence: string[];
  candidates: CatalogProduct[];
  product: CatalogProduct | null;
  /** True while the live catalog has not answered yet. */
  pending: boolean;
  /** Readable technical description lines (manufacturer data only; unknown values are stated as "не подтверждено"). */
  details: string[];
  /** Recommended / optional position: shown, but not part of mandatory-unpriced and not in the confirmed subtotal. */
  optional?: boolean;
  /** 'preliminary' = engineering candidate that still requires verification; 'verified' only after full checks. */
  engineering: 'preliminary' | 'verified' | null;
  /** Inventory-aware selection result for this position (role, classification, stock, screened candidates). */
  match?: LineMatch;
  /** Customer choice of this position (options + current selection). */
  choice?: LineChoice;
  /** Resolved choice "not part of this specification" (bought separately / included elsewhere). */
  excluded?: boolean;
}

export interface LineMatch {
  role: string;
  verdict: MatchClass;
  /** Why this product (or why nothing) was selected. */
  reasons: string[];
  stock: StockCheck | null;
  /** Every catalog product screened for the role, with its verdict (coverage / "why not"). */
  screening: ScreeningRecord[];
}

export interface SelectionStage {
  id: 'requirements' | 'screening' | 'discovery' | 'validation' | 'assembly' | 'accessories' | 'stock' | 'audit';
  label: string;
  status: 'done' | 'pending' | 'blocked';
  detail: string;
}

export interface SelectionReport {
  snapshot: { dbSha256: string; activeProducts: number; profiles: number };
  stages: SelectionStage[];
  roles: RoleCoverage[];
  controlOptions: Array<Pick<ArchitectureResult, 'id' | 'label' | 'complete' | 'verdict' | 'missing' | 'notes' | 'knownCostAmd' | 'unpricedLines'> & { selected: boolean; stock: string[] }>;
  audit: AuditResult;
  /** Quantity source used for stock checks ('public-status' = in stock yes/no only). */
  stockSource: 'quantity' | 'public-status' | 'none';
}

export interface FanCoilRequest {
  roomId: string;
  roomName: string;
  service: 'COOLING' | 'HEATING';
  requiredKw: number;
  pipe: '2-pipe' | '4-pipe';
  /** Installation type chosen by the customer for this room. */
  mounting: FanCoilMounting;
}

export interface FanCoilPick {
  roomId: string;
  units: number;
  /** null: no catalog unit satisfies the request. */
  sku: string | null;
  capacityKw: number | null;
  /** Chosen unit is on stock (true) / only to order (false) / unknown. */
  inStock?: boolean | null;
  /** Capacity / requirement of the chosen unit. */
  oversizeRatio?: number;
  /** Larger unit on stock outside the best-fit band — for engineering review only, never auto-selected. */
  stockAlternative?: { sku: string; capacityKw: number; oversizeRatio: number };
  /** No unit of the chosen installation type fits: these other types would. */
  otherMountings?: FanCoilMounting[];
}

export interface PumpBreakdownItem { label: string; kPa: number; assumption: boolean }

export interface PumpResult {
  groupId: string;
  label: string;
  flowM3h: number;
  headKPa: number;
  breakdown: PumpBreakdownItem[];
  /** Integrated pump that serves this circuit (mixing unit / source). */
  integrated: string | null;
  selection: { sku: string; name: string; headAtFlowM: number } | null;
  mainPipe: string;
  preliminary: true;
  notes: string[];
}

export interface CircuitGroup {
  id: string;
  kind: 'ufh' | 'fan_coil' | 'radiator';
  label: string;
  supplyC: number;
  returnC: number;
  coolingSupplyC: number | null;
  coolingReturnC: number | null;
  heatW: number;
  coolW: number;
  flowM3h: number;
  circuits: number;
  terminalDpKPa: number;
  terminalDpAssumed: boolean;
  /** Estimated floor-heating pipe, m (UFH groups only). */
  pipeM: number;
  valveDpKPa: number;
  valveDpAssumed: boolean;
  /** outlets = circuits used; selectionKey points to the inventory-aware selection of the manifold. */
  manifolds: Array<{ label: string; outlets: number; sku: string | null; family: string | null; selectionKey?: string }>;
  needsMixing: boolean;
  notes: string[];
}

export interface EquipmentSpec {
  ready: boolean;
  loadsAvailable: boolean;
  summary: {
    totalAreaM2: number | null;
    heatingRequiredW: number | null;
    heatingReserveRatio: number;
    coolingW: number | null;
    configuration: string;
    circuits: number;
    manifoldText: string;
    pumpText: string;
  };
  groups: CircuitGroup[];
  pumps: PumpResult[];
  lines: BomLine[];
  totals: {
    pricedSubtotalAmd: number; pricedLines: number; unpricedLines: number; missingLines: number; choiceLines: number;
    /** Names of mandatory positions that are not in the subtotal (no price / not in catalog / need a choice). */
    unpricedPositions: string[];
  };
  missingInputs: string[];
  assumptions: string[];
  warnings: string[];
  fanCoilRequests: FanCoilRequest[];
  skus: string[];
  plant: PlantSummary;
  selection: SelectionReport;
  /** Required choices still open — the final document is blocked until this list is empty. */
  pendingChoices: Array<{ key: string; name: string }>;
}

export interface PlantSummary {
  /** 'verified' is reserved: the engine cannot establish it from nominal ratings alone. */
  status: 'preliminary' | 'verified';
  statusReasons: string[];
  heatPump: null | {
    basis: HeatPumpRequirement['basis'];
    requiredHeatingKw: number | null;
    requiredCoolingKw: number | null;
    connectedCoolingKw: number | null;
    connectedHeatingKw: number | null;
    candidates: Array<{ sku: string; name: string; verdict: HeatPumpVerdict; heatingKw: number; coolingKw: number; inStock: boolean | null; priceAmd: number | null; reasons: string[]; unresolved: string[] }>;
    selectedSku: string | null;
  };
  topology: TopologyResult | null;
  completeness: { total: number; fromCatalog: number; candidatesToVerify: number; missing: number; choices: number; percent: number };
}

export interface EngineInput {
  project: BuildingProject;
  loads: BuildingLoadCalculation | null;
  towelWarmers: TowelWarmerSelection[];
  design: DesignInputs;
  fanCoilPicks?: Record<string, FanCoilPick>;
  /** sku -> product (null = not in catalog / inactive). Absent map = not loaded yet. */
  catalog?: Map<string, CatalogProduct | null>;
  /** Approved relationship groups per fan-coil SKU (from the public product API). */
  companions?: Record<string, { required: CatalogProduct[]; optional: CatalogProduct[] }>;
  /** Available-to-sell quantities (authenticated inventory source or a labelled fixture); absent = public status only. */
  quantities?: Map<string, QuantityRecord>;
  /** Commercial tie-breakers (manufacturer preference); never used for eligibility. */
  selectionPolicy?: SelectionPolicy;
  /** Customer choices: choice key → option id (catalog SKU, 'exclude', 'confirm' or a value such as a fan-coil mounting). */
  choices?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Terminal / source classification
// ---------------------------------------------------------------------------

type Terminal = 'ufh' | 'fan_coil' | 'radiator' | 'convector' | 'electric' | 'dx';

const TERMINAL_OF: Record<string, Terminal[]> = {
  hydronic_floor_heating: ['ufh'],
  fan_coils: ['fan_coil'],
  chiller_fan_coils: ['fan_coil'],
  heat_pump_air_to_water_fan_coils: ['fan_coil'],
  aluminum_radiators: ['radiator'],
  bimetal_radiators: ['radiator'],
  steel_panel_radiators: ['radiator'],
  infloor_convectors: ['convector'],
  electric_convector: ['electric'],
  heating_cable: ['electric'],
  heating_mat: ['electric'],
  electric_underfloor_heating: ['electric'],
  heat_pump_air_to_air: ['dx'],
  split_wall: ['dx'],
  multi_split: ['dx'],
  cassette_ac: ['dx'],
  ducted_ac: ['dx'],
  floor_ceiling_ac: ['dx'],
  column_ac: ['dx'],
  vrf_vrv: ['dx'],
};
const TEMPLATE_OF: Record<string, { heating: Terminal[]; cooling: Terminal[] }> = {
  radiators_plus_ac: { heating: ['radiator'], cooling: ['dx'] },
  hydronic_floor_heating_plus_ac: { heating: ['ufh'], cooling: ['dx'] },
  hydronic_floor_heating_plus_fan_coils: { heating: ['ufh', 'fan_coil'], cooling: ['fan_coil'] },
  electric_heating_plus_cooling: { heating: ['electric'], cooling: ['dx'] },
  gas_boiler_vrf: { heating: [], cooling: ['dx'] },
  gas_boiler_split_multi_split: { heating: [], cooling: ['dx'] },
};

export function roomTerminals(assignment: EngineeringRoomAssignment | undefined): { heating: Set<Terminal>; cooling: Set<Terminal> } {
  const heating = new Set<Terminal>();
  const cooling = new Set<Terminal>();
  if (!assignment) return { heating, cooling };
  const add = (ids: string[], service: 'heating' | 'cooling') => {
    for (const id of ids) {
      const tpl = TEMPLATE_OF[id];
      const list = tpl ? tpl[service] : TERMINAL_OF[id] ?? [];
      for (const t of list) (service === 'heating' ? heating : cooling).add(t);
    }
  };
  if (assignment.servicePreferences?.heating !== 'not_required') add(assignment.heatingSystems.map((s) => s.familyId), 'heating');
  if (assignment.servicePreferences?.cooling !== 'not_required') add(assignment.coolingSystems.map((s) => s.familyId), 'cooling');
  return { heating, cooling };
}

type SourceKind = 'heat_pump' | 'boiler' | 'external' | 'unknown';
const HEAT_PUMP_SOURCES = new Set(['heat_pump_air_to_water', 'reversible_air_to_water_heat_pump']);
const BOILER_SOURCES = new Set(['gas_boiler', 'gas_condensing_boiler', 'electric_boiler']);

function sourceKind(id: string | null | undefined): SourceKind {
  if (!id) return 'unknown';
  if (HEAT_PUMP_SOURCES.has(id)) return 'heat_pump';
  if (BOILER_SOURCES.has(id)) return 'boiler';
  if (id === 'external_building_heating_supply') return 'external';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Constants (all surfaced as assumptions)
// ---------------------------------------------------------------------------

/** Floor heating specific output used to split a room between UFH and a second terminal. */
const UFH_MAX_WM2 = 60;
const UFH_SUPPLY = 40;
const UFH_RETURN = 35;
const COOL_SUPPLY = 7;
const COOL_RETURN = 12;
const PIPE_FITTINGS_ALLOWANCE = 0.3;
/** Main pipe velocity limit, m/s (branches to single terminals: 1.0 m/s). */
const MAIN_VELOCITY = 0.9;
const ASSUMED = {
  fhfValveKPa: 10,
  fanCoilValveKitKPa: 15,
  radiatorTerminalKPa: 10,
  strainerKPa: 5,
  separatorKPa: 2,
  fanCoilTerminalKPa: 25,
};

interface SnapshotPoint { capacity_kw?: number; dp_kpa?: number; flow_m3h?: number }
interface SnapshotUnit {
  pipe_configuration?: string;
  connection_size?: string;
  drain_connection_mm?: number;
  cooling_7_12?: SnapshotPoint;
  heating_70_60?: SnapshotPoint;
}
const FC_SNAPSHOT = (snapshot as { units: Record<string, SnapshotUnit>; exportedAt: string; sha256: string });

export function fanCoilHydraulics(sku: string | null): SnapshotUnit | null {
  return sku ? FC_SNAPSHOT.units[sku] ?? null : null;
}

function fmtKw(w: number) { return `${(w / 1000).toFixed(2)} кВт`; }
function round(n: number, d = 2) { return Number(n.toFixed(d)); }

// ---------------------------------------------------------------------------
// Line builder with deterministic de-duplication
// ---------------------------------------------------------------------------

class LineBook {
  private map = new Map<string, BomLine>();
  add(line: Omit<BomLine, 'candidates' | 'product' | 'pending' | 'checks' | 'tech' | 'evidence' | 'details' | 'engineering' | 'optional'> & Partial<Pick<BomLine, 'candidates' | 'checks' | 'tech' | 'evidence' | 'details' | 'engineering' | 'optional'>>) {
    const existing = this.map.get(line.key);
    if (existing) {
      existing.quantity = existing.quantity != null && line.quantity != null ? existing.quantity + line.quantity : existing.quantity ?? line.quantity;
      if (line.qtyStatus !== 'confirmed' && existing.qtyStatus === 'confirmed') existing.qtyStatus = line.qtyStatus;
      for (const r of [line.reason]) if (r && !existing.reason.includes(r)) existing.reason = `${existing.reason}; ${r}`;
      for (const c of line.checks ?? []) if (!existing.checks.includes(c)) existing.checks.push(c);
      for (const t of line.tech ?? []) if (!existing.tech.includes(t)) existing.tech.push(t);
      for (const e of line.evidence ?? []) if (!existing.evidence.includes(e)) existing.evidence.push(e);
      return;
    }
    this.map.set(line.key, {
      candidates: [], checks: [], tech: [], evidence: [], product: null, pending: false, details: [], engineering: null,
      ...line,
    } as BomLine);
  }
  catalog(group: LineGroup, sku: string, name: string, qty: number | null, qtyStatus: QtyStatus, reason: string, extra: Partial<BomLine> = {}) {
    this.add({ key: `sku:${sku}`, group, name, sku, quantity: qty, unit: 'шт', qtyStatus, status: 'catalog', reason, ...extra });
  }
  missing(group: LineGroup, id: string, name: string, qty: number | null, qtyStatus: QtyStatus, reason: string, extra: Partial<BomLine> = {}) {
    this.add({ key: `missing:${id}`, group, name, sku: null, quantity: qty, unit: 'шт', qtyStatus, status: 'missing', reason, ...extra });
  }
  choice(group: LineGroup, id: string, name: string, qty: number | null, qtyStatus: QtyStatus, reason: string, extra: Partial<BomLine> = {}) {
    this.add({ key: `choice:${id}`, group, name, sku: null, quantity: qty, unit: 'шт', qtyStatus, status: 'choice', reason, ...extra });
  }
  list(): BomLine[] { return [...this.map.values()]; }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const GROUP_ORDER: LineGroup[] = ['main', 'distribution', 'pumps', 'automation', 'fittings'];

export function buildEquipmentSpec(input: EngineInput): EquipmentSpec {
  // Sales rule: among technically equal options, what is on our stock comes first.
  const onStock = (sku: string) => input.catalog?.get(sku)?.inStock === true;
  const inv: InventoryInput = { catalog: input.catalog, quantities: input.quantities };
  const policy = input.selectionPolicy ?? DEFAULT_SELECTION_POLICY;
  const index = catalogIndex();
  const roles: RoleCoverage[] = [];
  const roleCoverage = (role: string, label: string, types: FunctionalType[], screening: ScreeningRecord[]) => {
    if (!roles.some((r) => r.role === role)) roles.push({ role, label, screenedTypes: types, population: index.byType(...types).length, screening });
  };
  const manifoldSelections = new Map<string, ManifoldSelection>();
  const stockFirst = <T,>(skuOf: (item: T) => string) => (a: T, b: T) => Number(onStock(skuOf(b))) - Number(onStock(skuOf(a)));
  const { project, loads, design } = input;
  const config = project.systemsConfiguration;
  const requested = config?.requestedServices ?? [];
  const arch = config?.architecture ?? null;
  const fluid: FluidProps = fluidProps(design.glycolPercent);
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const missingInputs: string[] = [];
  const book = new LineBook();
  const fanCoilRequests: FanCoilRequest[] = [];

  const summaryLoads = loads ? buildLoadResultSummary(loads) : null;
  const roomLoad = new Map(summaryLoads?.rooms.map((r) => [r.roomId, r]) ?? []);
  const reserveRatio = summaryLoads?.reserveRatio ?? 0;

  const heatSourceId = arch?.spaceHeatingSourceId ?? arch?.spaceCombinedSourceId ?? null;
  const coolSourceId = arch?.spaceCoolingSourceId ?? arch?.spaceCombinedSourceId ?? null;
  const source = sourceKind(heatSourceId);
  const circuitKind = arch?.distribution?.circuitKind ?? 'none';
  const changeOver2Pipe = arch?.distribution?.id === 'hydronic_2pipe_heating_cooling';
  const fourPipe = circuitKind === '4pipe';
  if (requested.includes('heating') && source === 'unknown') missingInputs.push('Источник тепла не выбран — температуры приняты как для теплового насоса (45/40 °C).');

  const fcHeat = source === 'boiler' || source === 'external' ? { s: 70, r: 60 } : { s: 45, r: 40 };
  const radHeat = source === 'boiler' || source === 'external' ? { s: 70, r: 55 } : { s: 45, r: 40 };

  // ---- rooms -> terminals ----------------------------------------------------
  type RoomPlan = {
    id: string; name: string; areaM2: number; floorId: string | null; floorLabel: string;
    heat: Set<Terminal>; cool: Set<Terminal>; heatReqW: number | null; coolW: number | null;
  };
  const floorList = project.topology?.floors ?? [];
  const floors = new Map(floorList.map((f, i) => [f.id, f.label || `${i + 1}-й этаж`]));
  const rooms: RoomPlan[] = project.rooms.map((room) => {
    const t = roomTerminals(config?.roomAssignments?.find((a) => a.roomId === room.id));
    const rl = roomLoad.get(room.id);
    return {
      id: room.id, name: room.name, areaM2: room.areaM2 ?? 0, floorId: room.floorId ?? null,
      floorLabel: (room.floorId && floors.get(room.floorId)) || 'Объект',
      heat: requested.includes('heating') ? t.heating : new Set<Terminal>(),
      cool: requested.includes('cooling') ? t.cooling : new Set<Terminal>(),
      heatReqW: rl?.heating ? rl.heating.requiredW : null,
      coolW: rl?.coolingW ?? null,
    };
  });
  const loadsAvailable = Boolean(loads) && rooms.some((r) => r.heatReqW != null || r.coolW != null);
  if (!loadsAvailable) missingInputs.push('Нагрузки не рассчитаны — мощности, расходы и насосы будут подобраны после расчёта.');

  // ---- fan coils (requests and picks) ---------------------------------------
  const fcRooms = rooms.filter((r) => r.heat.has('fan_coil') || r.cool.has('fan_coil'));
  type FcUnit = {
    roomId: string; roomName: string; sku: string | null; units: number;
    heatFlow: number; heatDp: number; heatDpAssumed: boolean;
    coolFlow: number; coolDp: number; coolDpAssumed: boolean;
    heatW: number; coolW: number;
  };
  const fcUnits: FcUnit[] = [];
  for (const r of fcRooms) {
    const ufhShare = r.heat.has('ufh') && r.heatReqW != null ? Math.min(r.heatReqW, r.areaM2 * UFH_MAX_WM2) : 0;
    const fcHeatW = r.heat.has('fan_coil') && r.heatReqW != null ? Math.max(0, r.heatReqW - ufhShare) : 0;
    const fcCoolW = r.cool.has('fan_coil') && r.coolW != null ? r.coolW : 0;
    const service: 'COOLING' | 'HEATING' = fcCoolW > 0 ? 'COOLING' : 'HEATING';
    const reqW = service === 'COOLING' ? fcCoolW : fcHeatW;
    // The installation type is the customer's decision per room: no model is picked before it is chosen.
    const mountingRaw = input.choices?.[`fc-mounting:${r.id}`];
    const mounting: FanCoilMounting | null = isFanCoilMounting(mountingRaw) ? mountingRaw : null;
    if (reqW > 0 && mounting) fanCoilRequests.push({ roomId: r.id, roomName: r.name, service, requiredKw: round(reqW / 1000, 3), pipe: fourPipe ? '4-pipe' : '2-pipe', mounting });
    const pick = mounting ? input.fanCoilPicks?.[r.id] : undefined;
    const hyd = fanCoilHydraulics(pick?.sku ?? null);
    const point = service === 'COOLING' ? hyd?.cooling_7_12 : hyd?.heating_70_60;
    const units = pick?.units ?? 1;
    // Rated datasheet flow is what the unit needs for its rated output (conservative);
    // heating datasheet points exist only for 70/60 °C.
    const heatPointValid = fcHeat.s === 70 && hyd?.heating_70_60 != null;
    const heatFlow = fcHeatW > 0 ? Math.max(heatPointValid ? hyd!.heating_70_60!.flow_m3h ?? 0 : 0, flowM3h(fcHeatW / units, fcHeat.s - fcHeat.r, fluid)) : 0;
    const coolFlow = fcCoolW > 0 ? Math.max(hyd?.cooling_7_12?.flow_m3h ?? 0, flowM3h(fcCoolW / units, COOL_RETURN - COOL_SUPPLY, fluid)) : 0;
    fcUnits.push({
      roomId: r.id, roomName: r.name, sku: pick?.sku ?? null, units,
      heatFlow, heatDp: (heatPointValid ? hyd!.heating_70_60!.dp_kpa : hyd?.heating_70_60?.dp_kpa) ?? ASSUMED.fanCoilTerminalKPa,
      heatDpAssumed: !heatPointValid,
      coolFlow, coolDp: hyd?.cooling_7_12?.dp_kpa ?? ASSUMED.fanCoilTerminalKPa, coolDpAssumed: hyd?.cooling_7_12?.dp_kpa == null,
      heatW: fcHeatW, coolW: fcCoolW,
    });

    if (!loadsAvailable) continue;
    if (reqW <= 0) continue;
    if (!mounting) {
      const counts = fanCoilCountByMounting();
      book.choice('main', `fc-mounting:${r.id}`, `Фанкойл для «${r.name}» (≥ ${fmtKw(reqW)}): выберите тип установки`, 1, 'confirmed',
        'Тип установки определяет, какие модели подходят: открытый (в корпусе) у пола / на стене или под потолком, скрытый в стене или за потолком, кассетный.',
        { choice: { key: `fc-mounting:${r.id}`, prompt: 'Тип установки фанкойла', required: true, selectedId: null,
          options: FAN_COIL_MOUNTINGS.map((m) => ({ id: m, kind: 'value' as const, label: FAN_COIL_MOUNTING_TEXT[m].label, detail: `${FAN_COIL_MOUNTING_TEXT[m].sub} · моделей в каталоге: ${counts[m]}`, disabled: counts[m] === 0 })) } });
      continue;
    }
    const mountingText = FAN_COIL_MOUNTING_TEXT[mounting].short;
    if (!input.fanCoilPicks) {
      book.add({ key: `fc:${r.id}`, group: 'main', name: `Фанкойл для «${r.name}» (≥ ${fmtKw(reqW)})`, sku: null, quantity: null, unit: 'шт', qtyStatus: 'estimated', status: 'catalog', reason: 'Подбор по каталогу…', pending: true } as BomLine);
    } else if (!pick?.sku) {
      const others = (pick?.otherMountings ?? []).map((m) => FAN_COIL_MOUNTING_TEXT[m].short);
      book.missing('main', `fc-${r.id}`, `${fourPipe ? '4-трубный фанкойл' : 'Фанкойл'} (${mountingText}) ${service === 'COOLING' ? 'холодопроизводительностью' : 'теплопроизводительностью'} не менее ${fmtKw(reqW)} («${r.name}»)`, 1, 'estimated',
        fourPipe ? 'В каталоге нет 4-трубных фанкойлов с паспортными данными.'
          : `В каталоге нет фанкойла типа «${mountingText}» с подтверждёнными данными под эту мощность.${others.length ? ` Подходят другие типы установки: ${others.join(', ')} — можно изменить выбор на шаге «Системы».` : ''}`);
    } else {
      const mInfo = fanCoilMountingInfo(pick.sku);
      book.catalog('main', pick.sku, `Фанкойл (${r.name}, ${mountingText})`, pick.units, 'confirmed',
        `${service === 'COOLING' ? 'Холод' : 'Тепло'} ${pick.capacityKw ?? '—'} кВт на блок при ${service === 'COOLING' ? '7/12 °C' : '70/60 °C'} ≥ требуемых ${fmtKw(reqW / pick.units)}`,
        {
          evidence: ['OHMX-ENG-FC'],
          tech: [
            `Подбор: catalog-matcher (паспортные данные, утверждённые профили), требуемая мощность ${round(reqW / 1000, 2)} кВт без дополнительного запаса.`,
            hyd ? `Паспорт: расход ${point?.flow_m3h ?? '—'} м³/ч, Δp ${point?.dp_kpa ?? '—'} кПа, подключение ${hyd.connection_size ?? '—'}, дренаж ${hyd.drain_connection_mm ?? '—'} мм.` : 'Гидравлические данные фанкойла в выгрузке отсутствуют — Δp принято условно.',
          ],
          checks: [
            ...(service === 'HEATING' && source === 'heat_pump'
              ? ['Теплопроизводительность в каталоге указана только для 70/60 °C — при 45/40 °C от теплового насоса проверить по каталогу производителя.']
              : fcHeatW > 0 && source === 'heat_pump'
                ? ['Отопление фанкойлом при 45/40 °C: паспортные данные есть только для 70/60 °C — проверить.']
                : []),
            ...(pick.inStock === false ? ['Подходящего по мощности фанкойла в наличии нет — предложен лучший вариант под заказ.'] : []),
            ...(mInfo.note ? [mInfo.note] : []),
            ...(mInfo.source === 'CARD' ? [`Тип установки «${mountingText}» — по описанию в каталоге; подтвердить по документации производителя.`] : []),
            ...(pick.stockAlternative ? [`Альтернатива со склада (нужно решение инженера): ${pick.stockAlternative.sku}, ${pick.stockAlternative.capacityKw} кВт — мощнее требуемого на ${Math.round((pick.stockAlternative.oversizeRatio - 1) * 100)}%: проверить шум, цикличность и осушение на пониженной скорости.`] : []),
          ],
          candidates: pick.stockAlternative && input.catalog?.get(pick.stockAlternative.sku) ? [input.catalog.get(pick.stockAlternative.sku)!] : [],
          match: {
            role: 'fan_coil',
            verdict: (fcHeatW > 0 && source === 'heat_pump' ? 'SUBSTITUTE_CONDITIONAL' : 'SUBSTITUTE_VERIFIED') as MatchClass,
            reasons: [`мощность по утверждённому профилю при ${service === 'COOLING' ? '7/12 °C' : '70/60 °C'}, запас ${pick.oversizeRatio != null ? Math.round((pick.oversizeRatio - 1) * 100) : '—'}%`],
            stock: stockCheck(pick.sku, pick.units, inv),
            screening: pick.stockAlternative ? [{ sku: pick.stockAlternative.sku, name: input.catalog?.get(pick.stockAlternative.sku)?.name ?? pick.stockAlternative.sku, brand: null, verdict: 'REQUIRES_ENGINEERING_REVIEW' as MatchClass, reasons: [`на складе, но мощнее требуемого на ${Math.round((pick.stockAlternative.oversizeRatio - 1) * 100)}% — вне полосы лучшего подбора`], inStock: true, selected: false }] : [],
          },
        });
    }
  }

  // ---- groups ------------------------------------------------------------------
  const groups: CircuitGroup[] = [];

  // Underfloor heating per floor
  const ufhRooms = rooms.filter((r) => r.heat.has('ufh'));
  const hasOtherHotGroups = rooms.some((r) => r.heat.has('fan_coil') || r.heat.has('radiator') || r.heat.has('convector'));
  const ufhNeedsMixing = ufhRooms.length > 0 && (source === 'boiler' || source === 'external' || hasOtherHotGroups);
  const ufhFloors = [...new Set(ufhRooms.map((r) => r.floorLabel))];
  const ufhRoomLoops = new Map<string, { loops: number; floorLabel: string }>();
  for (const floorLabel of ufhFloors) {
    const fr = ufhRooms.filter((r) => r.floorLabel === floorLabel);
    let loopsTotal = 0;
    let heatW = 0;
    let flow = 0;
    let critical = 0;
    let pipeM = 0;
    const notes: string[] = [];
    for (const r of fr) {
      const l = ufhLoops(r.areaM2);
      ufhRoomLoops.set(r.id, { loops: l.loops, floorLabel });
      loopsTotal += l.loops;
      pipeM += l.pipeM;
      const otherTerminal = r.heat.has('fan_coil') || r.heat.has('radiator') || r.heat.has('convector');
      const share = r.heatReqW == null ? null : otherTerminal ? Math.min(r.heatReqW, r.areaM2 * UFH_MAX_WM2) : r.heatReqW;
      if (share != null) {
        heatW += share;
        if (!otherTerminal && r.areaM2 > 0 && share / r.areaM2 > UFH_MAX_WM2 * 1.2) {
          warnings.push(`«${r.name}»: нужно ${Math.round(share / r.areaM2)} Вт/м² — тёплый пол обычно даёт до ~${UFH_MAX_WM2} Вт/м², может понадобиться дополнительный прибор.`);
        }
        const qLoop = flowM3h(share / l.loops, UFH_SUPPLY - UFH_RETURN, fluid);
        flow += qLoop * l.loops;
        const dpLoop = (pipeGradientPaM(qLoop, UFH_PIPE.innerDiameterM, (UFH_SUPPLY + UFH_RETURN) / 2, fluid) * l.loopLengthM * 1.2) / 1000;
        if (dpLoop > critical) critical = dpLoop;
        if (dpLoop > 25) notes.push(`«${r.name}»: Δp петли ${round(dpLoop, 1)} кПа — лучше разбить на большее число петель.`);
      }
    }
    const manifoldCount = Math.ceil(loopsTotal / MAX_MANIFOLD_OUTLETS);
    const perManifold = splitEven(loopsTotal, manifoldCount);
    groups.push({
      id: `ufh:${floorLabel}`, kind: 'ufh', label: `Тёплый пол — ${floorLabel}`,
      supplyC: UFH_SUPPLY, returnC: UFH_RETURN, coolingSupplyC: null, coolingReturnC: null,
      heatW, coolW: 0, flowM3h: flow, circuits: loopsTotal,
      terminalDpKPa: critical, terminalDpAssumed: false, pipeM,
      valveDpKPa: ASSUMED.fhfValveKPa, valveDpAssumed: true,
      manifolds: perManifold.map((n, i) => {
        const key = `ufh:${floorLabel}:${i}`;
        const sel = selectManifold({
          id: key, label: `Тёплый пол — ${floorLabel}`, application: 'ufh', circuits: n, quantity: 1,
          maxFlowTempC: UFH_SUPPLY, chilledWater: changeOver2Pipe, needsActuators: true, maxOutletFlowM3h: null, designSeries: 'FHF',
        }, inv, index);
        manifoldSelections.set(key, sel);
        roleCoverage('manifold-ufh', 'Коллектор тёплого пола', ['MANIFOLD'], sel.screening);
        const p = sel.selected?.profile;
        return { label: manifoldCount > 1 ? `Коллектор ${i + 1}` : 'Коллектор', outlets: n, sku: p?.sku ?? null, family: p ? str(p, 'series') ?? p.brand : null, selectionKey: key };
      }),
      needsMixing: ufhNeedsMixing,
      notes: [
        `Петли: шаг ${UFH_DEFAULTS.spacingM * 1000} мм, не длиннее ${UFH_DEFAULTS.maxLoopM} м, подводка ${UFH_DEFAULTS.leadM} м; всего трубы ≈ ${Math.round(pipeM)} м.`,
        ...notes,
      ],
    });
  }

  // Fan coils: one hydraulic group (2-pipe / heating-only) or two independent ones (4-pipe)
  if (fcUnits.length) {
    const totalUnits = fcUnits.reduce((s, u) => s + u.units, 0);
    const useManifold = design.fanCoilDistribution === 'manifold';
    const variants: Array<{ id: string; label: string; manifoldLabel: string; mode: 'both' | 'heat' | 'cool' }> = fourPipe
      ? [
        { id: 'fc-heat', label: 'Фанкойлы — контур отопления (4-трубная)', manifoldLabel: 'Коллектор отопления', mode: 'heat' },
        { id: 'fc-cool', label: 'Фанкойлы — контур холодоснабжения (4-трубная)', manifoldLabel: 'Коллектор холодоснабжения', mode: 'cool' },
      ]
      : [{ id: 'fc', label: changeOver2Pipe ? 'Фанкойлы (2-трубная, отопление/охлаждение)' : 'Фанкойлы', manifoldLabel: 'Коллектор фанкойлов', mode: 'both' }];
    for (const v of variants) {
      const per = fcUnits.map((u) => {
        const useCool = v.mode === 'cool' || (v.mode === 'both' && u.coolFlow >= u.heatFlow);
        return useCool
          ? { units: u.units, flow: u.coolFlow, dp: u.coolDp, assumed: u.coolDpAssumed }
          : { units: u.units, flow: u.heatFlow, dp: u.heatDp, assumed: u.heatDpAssumed };
      }).filter((x) => x.flow > 0);
      if (!per.length && loadsAvailable) continue;
      const flow = per.reduce((s, x) => s + x.flow * x.units, 0);
      const maxUnitFlow = per.length ? Math.max(...per.map((x) => x.flow)) : 0;
      const supplyLimit = v.mode === 'cool' ? COOL_SUPPLY : fcHeat.s;
      let valveDp = ASSUMED.fanCoilValveKitKPa;
      let valveAssumed = true;
      const manifolds: CircuitGroup['manifolds'] = [];
      const notes: string[] = [];
      let documentedKvs: number | null = null;
      if (useManifold) {
        // Every catalog manifold is screened; SSM-F (documented kvs, max 60 °C) is the reference below 60 °C, FHF (90 °C) above.
        const designSeries = supplyLimit <= 60 ? 'SSM-F' : 'FHF';
        const count = Math.ceil(totalUnits / MAX_MANIFOLD_OUTLETS);
        const kvsList: Array<number | null> = [];
        splitEven(totalUnits, count).forEach((n, i) => {
          const key = `${v.id}:${i}`;
          const sel = selectManifold({
            id: key, label: v.label, application: 'fan_coil', circuits: n, quantity: 1, maxFlowTempC: supplyLimit,
            chilledWater: v.mode !== 'heat' && requested.includes('cooling'), needsActuators: true, maxOutletFlowM3h: maxUnitFlow, designSeries,
          }, inv, index);
          manifoldSelections.set(key, sel);
          roleCoverage(`manifold-${v.id}`, `Коллектор фанкойлов (${v.label})`, ['MANIFOLD'], sel.screening);
          const p = sel.selected?.profile;
          kvsList.push(p ? num(p, 'kvs_max') : null);
          manifolds.push({ label: v.manifoldLabel, outlets: n, sku: p?.sku ?? null, family: p ? str(p, 'series') ?? p.brand : null, selectionKey: key });
          if (p && str(p, 'series') !== designSeries) notes.push(`Коллектор: вместо ${designSeries} выбран ${p.name} — ${sel.selected!.reasons.slice(0, 2).join('; ')}.`);
          if (!p) notes.push(`Подходящий коллектор на ${n} выходов не найден: ${sel.screening.filter((x) => x.verdict !== 'INCOMPATIBLE').length} кандидатов без подтверждённых данных, остальные не подходят.`);
        });
        if (kvsList.length && kvsList.every((k) => k != null)) {
          documentedKvs = Math.min(...(kvsList as number[]));
          valveDp = valveDpKPa(maxUnitFlow, documentedKvs);
          valveAssumed = false;
        }
      }
      // Hydraulically critical branch = the one with the largest (coil Δp + its own valve Δp). The coil of one branch and
      // the valve of another are never added together.
      const branchValveDp = (flow: number) => (documentedKvs != null ? valveDpKPa(flow, documentedKvs) : ASSUMED.fanCoilValveKitKPa);
      const worst = per.reduce((a, x) => (x.dp + branchValveDp(x.flow) > a.dp + branchValveDp(a.flow) ? x : a), per[0] ?? { units: 0, flow: 0, dp: 0, assumed: true });
      if (per.length) valveDp = branchValveDp(worst.flow);
      if (per.length) notes.push(`Критическая ветвь (не сумма параллельных): расход ${round(worst.flow, 2)} м³/ч, катушка ${round(worst.dp, 1)} кПа${worst.assumed ? ' (допущение)' : ' (паспорт)'}, клапан ${round(valveDp, 1)} кПа.`);
      const heating = v.mode !== 'cool';
      const cooling = v.mode !== 'heat' && requested.includes('cooling');
      groups.push({
        id: v.id, kind: 'fan_coil', label: v.label,
        supplyC: heating ? fcHeat.s : COOL_SUPPLY, returnC: heating ? fcHeat.r : COOL_RETURN,
        coolingSupplyC: heating && cooling ? COOL_SUPPLY : null,
        coolingReturnC: heating && cooling ? COOL_RETURN : null,
        heatW: heating ? fcUnits.reduce((s, u) => s + u.heatW, 0) : 0,
        coolW: cooling ? fcUnits.reduce((s, u) => s + u.coolW, 0) : 0,
        flowM3h: flow, circuits: totalUnits,
        terminalDpKPa: worst.dp, terminalDpAssumed: worst.assumed, pipeM: 0,
        valveDpKPa: valveDp, valveDpAssumed: valveAssumed,
        manifolds, needsMixing: false,
        notes,
      });
    }
  }

  // Radiators / convectors (+ water towel warmers attach here when present)
  const radRooms = rooms.filter((r) => r.heat.has('radiator') || r.heat.has('convector'));
  if (radRooms.length) {
    let heatW = 0;
    for (const r of radRooms) {
      const ufhShare = r.heat.has('ufh') && r.heatReqW != null ? Math.min(r.heatReqW, r.areaM2 * UFH_MAX_WM2) : 0;
      heatW += r.heatReqW != null ? Math.max(0, r.heatReqW - ufhShare) : 0;
    }
    groups.push({
      id: 'rad', kind: 'radiator', label: 'Радиаторы', supplyC: radHeat.s, returnC: radHeat.r, coolingSupplyC: null, coolingReturnC: null,
      heatW, coolW: 0, flowM3h: flowM3h(heatW, radHeat.s - radHeat.r, fluid), circuits: radRooms.length,
      terminalDpKPa: ASSUMED.radiatorTerminalKPa, terminalDpAssumed: true, pipeM: 0, valveDpKPa: 0, valveDpAssumed: false,
      manifolds: [], needsMixing: false,
      notes: source === 'heat_pump' ? ['Радиаторы от теплового насоса работают при 45/40 °C — их нужно подбирать по мощности при этих температурах (крупнее обычного).'] : [],
    });
  }

  // ---- distribution lines --------------------------------------------------------
  const controlZones: ControlZone[] = [];
  let plugOutlets = 0;
  const matchOf = (role: string, verdict: MatchClass, reasons: string[], stock: StockCheck | null, screening: ScreeningRecord[]) => ({ role, verdict, reasons, stock, screening });
  for (const g of groups) {
    for (const m of g.manifolds) {
      const sel = m.selectionKey ? manifoldSelections.get(m.selectionKey) : undefined;
      const chosen = sel?.selected ?? null;
      const circuitsText = `${m.outlets} ${m.outlets < 5 ? 'контура' : 'контуров'}`;
      if (m.sku && chosen) {
        const outlets = num(chosen.profile, 'outlets');
        book.catalog('distribution', m.sku, chosen.profile.name, 1, 'confirmed',
          `${g.label}: ${circuitsText}${outlets != null && outlets > m.outlets ? ` (коллектор на ${outlets}: ${outlets - m.outlets} выход(а) не используются)` : ''}`,
          {
            evidence: [...new Set(Object.values(chosen.profile.attrs).map((a) => a.doc).filter((d): d is string => Boolean(d)))],
            checks: chosen.checks,
            engineering: chosen.verdict === 'SUBSTITUTE_CONDITIONAL' ? 'preliminary' : null,
            match: matchOf('manifold', chosen.verdict, chosen.reasons, chosen.stock, sel!.screening),
          });
      } else {
        book.missing('distribution', `manifold-${g.id}-${m.outlets}`, `Распределительный коллектор на ${circuitsText} с клапанами под термоприводы (${g.label})`, 1, 'confirmed',
          `В каталоге нет коллектора с подтверждёнными данными: проверено ${sel?.population ?? 0} позиций.`,
          { match: matchOf('manifold', 'UNAVAILABLE', ['ни один коллектор каталога не прошёл проверку'], null, sel?.screening ?? []) });
      }
      const series = chosen ? str(chosen.profile, 'series') : null;
      if (series === 'FHF' || series === 'FHF-like') {
        const accChecks = series === 'FHF-like' ? [`Аксессуары FHF подобраны по серии; код ${m.sku} в даташите FHF 2020 не указан — совместимость подтвердить.`] : [];
        book.catalog('distribution', FHF_ACCESSORIES.ballValves.sku, FHF_ACCESSORIES.ballValves.name, 1, 'confirmed', 'Отключение коллектора от системы', { evidence: ['DAN-FHF-2020'], checks: accChecks });
        book.catalog('distribution', FHF_ACCESSORIES.autoAirVent.sku, FHF_ACCESSORIES.autoAirVent.name, 2, 'estimated', 'Воздухоудаление и слив на концах подающей и обратной гребёнки',
          { evidence: ['DAN-FHF-2020'], checks: ['Количество в упаковке (шт./комплект) уточнить: на коллектор нужны 2 концевые секции.', ...accChecks] });
        book.catalog('distribution', FHF_ACCESSORIES.brackets.sku, FHF_ACCESSORIES.brackets.name, 1, 'confirmed', 'Крепление коллектора', { evidence: ['DAN-FHF-2020'], checks: accChecks });
      } else if (series === 'SSM-F') {
        book.catalog('distribution', BALL_VALVES_FM['1"'].sku, BALL_VALVES_FM['1"'].name, 2, 'confirmed', 'Отключение коллектора SSM-F от системы (подача и обратка)',
          { evidence: ['OHMX-CATALOG'], checks: ['Резьба кранов (внутр./наруж.) — по присоединению коллектора SSM-F и магистрали.'] });
      } else if (chosen) {
        book.missing('distribution', `manifold-acc-${g.id}`, `Запорные краны, воздухоотводчики и крепление для коллектора ${m.sku}`, null, 'by_installer',
          'Комплектность коллектора этой серии в документации не подтверждена.');
      }
      const plugs = sel?.plugs;
      if (plugs && chosen) {
        plugOutlets += plugs.quantity;
        if (plugs.profile) {
          book.catalog('distribution', plugs.profile.sku, plugs.profile.name, plugs.quantity, 'confirmed',
            `Заглушки неиспользуемых выходов коллектора ${m.sku}: ${plugs.reasons.join('; ')}`,
            { checks: plugs.checks, engineering: 'preliminary', match: matchOf('plug', plugs.verdict, plugs.reasons, plugs.stock, plugs.screening) });
        } else {
          book.missing('distribution', `plugs-${m.sku}`, `Заглушки для неиспользуемых выходов коллектора ${m.sku}`, plugs.quantity, 'confirmed',
            plugs.reasons.join('; '), { match: matchOf('plug', 'UNAVAILABLE', plugs.reasons, null, plugs.screening) });
        }
        roleCoverage('plug', 'Заглушки неиспользуемых выходов коллектора', ['MANIFOLD_PLUG'], plugs.screening);
      }
    }
    if (g.kind === 'ufh') {
      for (const r of ufhRooms.filter((x) => `ufh:${x.floorLabel}` === g.id)) {
        controlZones.push({ id: r.id, roomId: r.id, name: r.name, circuits: ufhRoomLoops.get(r.id)?.loops ?? 1, application: 'ufh',
          coolingControl: false, closeInCooling: changeOver2Pipe, manifoldSku: g.manifolds[0]?.sku ?? null });
      }
      const l = g.circuits;
      book.catalog('fittings', FHF_ACCESSORIES.compressionFitting16.sku, FHF_ACCESSORIES.compressionFitting16.name, l * 2, 'confirmed',
        `2 на каждую петлю тёплого пола (${l} петель)`, { evidence: ['DAN-FHF-2020'], tech: ['Фитинг 013G4186 по даташиту FHF — для труб ALUPEX / PERT-AL-PERT 16×2; труба выбрана такого же типа.'] });
      const pipeM = Math.ceil(g.pipeM);
      book.add({
        key: `sku:${UFH_PIPE.sku}`, group: 'fittings', name: UFH_PIPE.name, sku: UFH_PIPE.sku, quantity: pipeM, unit: 'м', qtyStatus: 'estimated', status: 'catalog',
        reason: 'Труба петель тёплого пола (оценка по площади)', evidence: ['DAN-FHF-2020'],
        checks: ['Длина трубы — оценка по шагу 150 мм; точное значение по раскладке.'],
      });
      if (g.needsMixing) {
        const kw = g.heatW / 1000;
        const unit = loadsAvailable
          ? MIXING_UNITS.filter((u) => u.maxKwDt5 >= kw).sort((a, b) => stockFirst<MixingUnitFact>((u) => u.sku)(a, b) || a.maxKwDt5 - b.maxKwDt5)[0]
          : undefined;
        const manifoldsInGroup = g.manifolds.length;
        if (!loadsAvailable) {
          book.choice('distribution', `mixing-${g.id}`, `Смесительный узел для тёплого пола (${g.label})`, manifoldsInGroup, 'confirmed', 'Мощность узла будет подобрана после расчёта нагрузок.',
            { choice: { key: `mixing-${g.id}`, prompt: 'Смесительный узел', options: [confirmOption('Подобрать после расчёта нагрузок')], selectedId: input.choices?.[`mixing-${g.id}`] ?? null, required: false } });
        } else if (unit && manifoldsInGroup === 1) {
          book.catalog('distribution', unit.sku, unit.name, 1, 'confirmed',
            `Понижает температуру до ${UFH_SUPPLY}/${UFH_RETURN} °C; тёплый пол ${round(kw, 2)} кВт ≤ ${unit.maxKwDt5} кВт при Δt 5 K`,
            { evidence: unit.evidence, tech: [`Встроенный насос ${unit.pump} обслуживает контуры тёплого пола — отдельный насос для них не нужен.`], checks: ['Напор встроенного насоса узла сверить с потерями в самой длинной петле (см. гидравлику).'] });
        } else {
          book.missing('distribution', `mixing-${g.id}`, `Насосно-смесительный узел для тёплого пола не менее ${round(kw, 1)} кВт при Δt 5 K (${g.label})`, manifoldsInGroup, 'confirmed',
            'Узлы FHM-C в каталоге рассчитаны максимум на 7 кВт при Δt 5 K.');
        }
      }
    }
    if (g.kind === 'fan_coil') {
      const units = fcUnits.reduce((s, u) => s + u.units, 0);
      const firstFcGroup = g.id !== 'fc-cool';
      if (g.manifolds.length === 0 && firstFcGroup) {
        const perUnit = fourPipe ? 2 : 1;
        book.missing('automation', 'fc-valve-kit', `Клапан с электроприводом для фанкойла${fourPipe ? ' (отдельно отопление и охлаждение)' : ''}`, units * perUnit, 'confirmed',
          'Совместимой пары «клапан фанкойла + привод» с подтверждением производителя в каталоге нет.',
          { tech: ['Аудит 2026-10-13: для клапанов Danfoss VZ/VZL в каталоге нет документально совместимых приводов (AMV/AME 13x, TWA-ZL); комплекты клапанов Emmeti KEV / Riello отсутствуют.'] });
      }
      if (g.manifolds.length) {
        // One actuated manifold outlet per fan-coil unit; the room is cooled → its control must work in cooling.
        for (const u of fcUnits) {
          controlZones.push({ id: `${g.id}:${u.roomId}`, roomId: u.roomId, name: u.roomName, circuits: u.units, application: 'fan_coil',
            coolingControl: requested.includes('cooling') && u.coolW > 0, closeInCooling: false, manifoldSku: g.manifolds[0]?.sku ?? null });
        }
      }
      // Branch pipe size per fan coil (velocity ≤ 0.7 m/s) and manifold compression fittings
      if (g.manifolds.length) {
        const sizes = new Map<string, number>();
        for (const u of fcUnits) {
          const unitFlow = g.id === 'fc-cool' ? u.coolFlow : g.id === 'fc-heat' ? u.heatFlow : Math.max(u.heatFlow, u.coolFlow);
          const s = mainPipeSize(unitFlow, 1.0);
          sizes.set(s.od, (sizes.get(s.od) ?? 0) + u.units * 2);
        }
        for (const [od, n] of sizes) {
          if (od === '16×2' && g.manifolds.some((m) => m.family === 'FHF')) {
            book.catalog('fittings', FHF_ACCESSORIES.compressionFitting16.sku, FHF_ACCESSORIES.compressionFitting16.name, n, 'confirmed', 'Подключение труб фанкойлов к коллектору', { evidence: ['DAN-FHF-2020'] });
          } else if (od === '20×2') {
            book.catalog('fittings', COMPRESSION_FITTING_20.sku, COMPRESSION_FITTING_20.name, n, 'confirmed', 'Подключение труб 20×2 к выходам коллектора SSM-F (по 2 на фанкойл)',
              { evidence: ['OHMX-CATALOG'], engineering: 'preliminary',
                checks: ['Карточка указывает только размер 20×2 — присоединительную резьбу (евроконус G ¾") сверить с выходами коллектора SSM-F.'] });
          } else if (od === '16×2') {
            book.catalog('fittings', FHF_ACCESSORIES.compressionFitting16.sku, FHF_ACCESSORIES.compressionFitting16.name, n, 'confirmed', 'Подключение труб фанкойлов к коллектору',
              { evidence: ['OHMX-CATALOG'], checks: ['Выходы коллектора SSM-F: сверить с паспортом, что это евроконус G ¾" (под фитинг 013G4186).'] });
          } else {
            book.missing('fittings', `fc-fitting-${od}`, `Компрессионный фитинг G ¾" для металлопластиковой трубы ${od} (выходы коллектора)`, n, 'confirmed',
              `Расход фанкойла требует трубу ${od}; такого фитинга нет в каталоге${g.manifolds.some((m) => m.family === 'SSM-F') ? ' (резьбу выходов SSM-F уточнить)' : ''}.`);
          }
        }
      }
      if (!firstFcGroup) continue;
      // Isolation valves sized by the fan-coil water connection from the approved hydraulic snapshot.
      // Threaded connections only ("1/2\" F", "3/4\" gas", "1/2 inch F"); eurocone outlets need adapters → stays a named requirement.
      const threadOf = (raw: string) => (/euro|конус/i.test(raw) ? '' : (raw.match(/^(1\/2|3\/4|1)\s*(?:"|inch)/)?.[1] ?? ''));
      const fcConnections = [...new Set(fcUnits.map((u) => threadOf(String(fanCoilHydraulics(u.sku)?.connection_size ?? ''))))];
      const fcValve = fcConnections.length === 1 && fcConnections[0] ? BALL_VALVES_FM[`${fcConnections[0]}"`] : undefined;
      if (fcValve) {
        book.catalog('fittings', fcValve.sku, fcValve.name, units * (fourPipe ? 2 : 1) * 2, 'confirmed', 'Отключение фанкойла на подаче и обратке — обслуживание без слива системы',
          { evidence: ['OHMX-CATALOG'], checks: [`Присоединение фанкойла ${fcConnections[0]}" (паспорт); резьбу (внутр./наруж.) сверить с подводкой.`] });
      } else {
        book.missing('fittings', 'fc-isolation', 'Комплект запорных кранов для подключения фанкойла (подача + обратка)', units * (fourPipe ? 2 : 1), 'confirmed', 'Обслуживание фанкойла без слива системы');
      }
      if (fcUnits.some((u) => u.coolW > 0)) {
        const drain = [...new Set(fcUnits.map((u) => fanCoilHydraulics(u.sku)?.drain_connection_mm).filter(Boolean))];
        book.missing('fittings', 'fc-condensate', `Отвод конденсата от фанкойла (трубка${drain.length ? ` Ø${drain.join('/')} мм` : ''}, сифон/гидрозатвор)`, units, 'estimated', 'В режиме охлаждения фанкойл выделяет конденсат');
        book.missing('fittings', 'cool-insulation', 'Теплоизоляция с паробарьером для труб и арматуры холодоснабжения', null, 'by_installer', 'Защита от конденсата на трубах 7/12 °C');
      }
      // Fan-coil unit control — approved companions only
      const picksWithSku = fcUnits.filter((u) => u.sku);
      for (const u of picksWithSku) {
        const comp = input.companions?.[u.sku!];
        for (const req of comp?.required ?? []) {
          book.catalog('automation', req.sku, req.name, u.units, 'confirmed', 'Обязательный компонент по утверждённой совместимости');
        }
      }
      const optionalControls = uniqueProducts(picksWithSku.flatMap((u) => input.companions?.[u.sku!]?.optional ?? []));
      book.choice('automation', 'fc-control', 'Пульт / термостат управления вентилятором фанкойла', units, 'confirmed',
        optionalControls.length ? 'Выберите из утверждённых совместимых аксессуаров' : 'Совместимые пульты для выбранной модели в каталоге не утверждены',
        { candidates: optionalControls,
          choice: { key: 'fc-control', prompt: 'Пульт / термостат фанкойла', options: [...optionalControls.map((c): ChoiceOption => ({ id: c.sku, sku: c.sku, kind: 'product', quantity: units, label: c.name, detail: 'утверждённая совместимость с моделью фанкойла' })), excludeOption('Не нужен — управление от комнатного термостата / пульт в комплекте')], selectedId: input.choices?.['fc-control'] ?? null, required: true } });
    }
    if (g.kind === 'radiator') {
      // One choice per room: catalog radiators / convectors with the quantity the room load needs at design temperatures.
      let valveKits = 0;
      for (const r of radRooms) {
        const reqW = r.heatReqW != null ? Math.max(0, r.heatReqW - (r.heat.has('ufh') ? Math.min(r.heatReqW, r.areaM2 * UFH_MAX_WM2) : 0)) : null;
        const kind: 'radiator' | 'convector' = r.heat.has('convector') && !r.heat.has('radiator') ? 'convector' : 'radiator';
        const key = `terminal:${r.id}`;
        const options: ChoiceOption[] = [...terminalOptions(kind, reqW, g.supplyC, g.returnC, inv), excludeOption()];
        const sel = selectedOption({ key, prompt: '', options, selectedId: input.choices?.[key] ?? null, required: true });
        const sectional = sel?.sku ? index.get(sel.sku)?.attrs.sectional?.v === true : false;
        valveKits += sel?.kind === 'exclude' ? 0 : sel?.sku && !sectional ? (sel.quantity ?? 1) : 1;
        book.choice('main', key, `${kind === 'convector' ? 'Конвектор' : 'Радиатор'} для «${r.name}»: ${reqW != null ? `не менее ${fmtKw(reqW)}` : 'мощность после расчёта'} при ${g.supplyC}/${g.returnC} °C`, 1, 'estimated',
          'Выберите модель — количество рассчитано по мощности помещения при расчётных температурах.',
          { choice: { key, prompt: kind === 'convector' ? 'Конвектор' : 'Радиатор', options, selectedId: input.choices?.[key] ?? null, required: true } });
      }
      if (valveKits > 0) {
        book.catalog('automation', RADIATOR_VALVE_KIT.sku, RADIATOR_VALVE_KIT.name, valveKits, 'estimated', 'Автоматическое поддержание температуры в комнате: термоклапан на каждый прибор',
          { evidence: ['OHMX-CATALOG'], checks: ['Прямой или угловой вариант — по месту подключения.'] });
      }
    }
  }

  // ---- automation: zone control chain (complete architectures compared) -----------------------
  const actuatedCircuits = controlZones.reduce((sum, z) => sum + z.circuits, 0);
  const chain = selectControlChain(controlZones, inv, { coolingSwitch: requested.includes('cooling') && groups.some((g) => g.kind === 'fan_coil' && g.manifolds.length > 0) }, index);
  if (chain.selected) {
    const arch = chain.selected;
    const others = chain.options.filter((o) => o !== arch);
    for (const l of arch.lines) {
      if (!l.sku) continue;
      book.catalog('automation', l.sku, l.name, l.quantity, 'confirmed', l.reasons[0] ?? '', {
        evidence: l.evidence, checks: l.checks, tech: [`Схема управления: ${arch.label}.`, ...l.reasons.slice(1),
          ...(others.length && l === arch.lines[0] ? [`Сравнивались: ${chain.options.map((o) => `${o.label} — ${o.complete ? 'полная' : `не хватает: ${o.missing.join('; ')}`}`).join(' | ')}.`] : [])],
        engineering: l.verdict === 'EXACT_VERIFIED' || l.verdict === 'SUBSTITUTE_VERIFIED' ? null : 'preliminary',
        match: matchOf(l.role, l.verdict, l.reasons, l.stock, l.role === 'actuator' ? chain.screening.actuators : l.role === 'thermostat' ? chain.screening.thermostats : chain.screening.controllers),
      });
    }
    for (const [i, miss] of arch.missing.entries()) {
      book.missing('automation', `chain-${i}`, miss, null, 'confirmed', `Схема «${arch.label}» без этой позиции не работает.`,
        { tech: arch.notes, match: matchOf(/термостат/i.test(miss) ? 'thermostat' : /привод/i.test(miss) ? 'actuator' : 'controller', 'UNAVAILABLE', arch.notes, null, /термостат/i.test(miss) ? chain.screening.thermostats : chain.screening.controllers) });
    }
    if (arch.notes.length) warnings.push(...arch.notes.map((n) => `Управление зонами: ${n}`));
    roleCoverage('actuator', 'Термоприводы клапанов коллектора', ['THERMAL_ACTUATOR', 'MOTOR_ACTUATOR'], chain.screening.actuators);
    roleCoverage('thermostat', 'Комнатные термостаты зон', ['ROOM_THERMOSTAT', 'WATER_UFH_THERMOSTAT', 'ELECTRIC_UFH_THERMOSTAT', 'THERMOSTAT_OTHER'], chain.screening.thermostats);
    roleCoverage('controller', 'Контроллеры / коммутационные центры', ['ZONE_CONTROLLER', 'CONTROL_ACCESSORY'], chain.screening.controllers);
  }
  if (ufhRooms.length && changeOver2Pipe) {
    warnings.push('2-трубная система с охлаждением: на лето контуры тёплого пола нужно отключать (приводы закрыты термостатами / отсечной клапан), иначе пол будет охлаждаться и возможен конденсат.');
  }

  // ---- towel warmers ---------------------------------------------------------------
  const waterTowels = input.towelWarmers.filter((t) => t.kind === 'water');
  const electricTowels = input.towelWarmers.filter((t) => t.kind === 'electric');
  if (waterTowels.length) {
    const qty = waterTowels.reduce((s, t) => s + t.quantity, 0);
    const heatingOnlyCircuit = radRooms.length > 0 || (!changeOver2Pipe && !fourPipe && groups.some((g) => g.kind === 'fan_coil')) || (ufhRooms.length > 0 && !changeOver2Pipe);
    const candidates = WATER_TOWEL_WARMERS.map((sku) => input.catalog?.get(sku)).filter((p): p is CatalogProduct => Boolean(p))
      .sort(stockFirst<CatalogProduct>((p) => p.sku));
    book.choice('main', 'towel-water', 'Водяной полотенцесушитель', qty, 'confirmed', 'Выберите модель — в карточках нет тепловой мощности, расчётная нагрузка ванной от него не меняется',
      {
        candidates,
        choice: { key: 'towel-water', prompt: 'Водяной полотенцесушитель', options: [...towelWarmerOptions('WATER', qty), excludeOption()], selectedId: input.choices?.['towel-water'] ?? null, required: true },
        checks: heatingOnlyCircuit
          ? ['Подключать к контуру отопления с высокой температурой (до смесительного узла / к радиаторной ветке).']
          : ['В системе с переключением на охлаждение водяной полотенцесушитель нельзя ставить на общий контур (летом пойдёт холодная вода): нужна отдельная ветка только отопления с отсечкой — или выберите электрический.'],
      });
    book.catalog('fittings', TOWEL_VALVE.sku, TOWEL_VALVE.name, qty * 2, 'confirmed', 'Подключение и отключение полотенцесушителя (подача + обратка)',
      { evidence: ['OHMX-CATALOG'], checks: ['Угловой или прямой вентиль — по схеме подводки к полотенцесушителю.'] });
    if (!heatingOnlyCircuit) warnings.push('Водяной полотенцесушитель в 2-трубной системе с охлаждением требует отдельной ветки отопления.');
  }
  if (electricTowels.length) {
    const eQty = electricTowels.reduce((s, t) => s + t.quantity, 0);
    book.choice('main', 'towel-electric', 'Электрический полотенцесушитель', eQty, 'confirmed', 'Выберите модель. Водяные подключения не нужны; нужна розетка / выход кабеля с УЗО во влажной зоне.',
      { choice: { key: 'towel-electric', prompt: 'Электрический полотенцесушитель', options: [...towelWarmerOptions('ELECTRIC', eQty), excludeOption()], selectedId: input.choices?.['towel-electric'] ?? null, required: true } });
  }

  // ---- other terminals ------------------------------------------------------------
  const elecRooms = rooms.filter((r) => r.heat.has('electric'));
  if (elecRooms.length) {
    for (const r of elecRooms) {
      const key = `electric:${r.id}`;
      book.choice('main', key, `Электрический обогреватель для «${r.name}»: ${r.heatReqW != null ? `не менее ${fmtKw(r.heatReqW)}` : 'мощность после расчёта'}`, 1, 'estimated',
        'Количество — по мощности помещения. Электрический тёплый пол (кабель / мат) подбирается в калькуляторе тёплого пола.',
        { choice: { key, prompt: 'Электрический прибор', options: [...electricHeaterOptions(r.heatReqW, inv), excludeOption('Не включать — подбирается отдельно (кабель / мат / другой прибор)')], selectedId: input.choices?.[key] ?? null, required: true } });
    }
  }
  const dxRooms = rooms.filter((r) => r.cool.has('dx'));
  if (dxRooms.length) {
    book.choice('main', 'dx', 'Кондиционер (сплит-система) по холодопроизводительности помещения', dxRooms.length, 'estimated', 'Подбор кондиционеров этим модулем не выполняется — сплит-систем в каталоге нет',
      { tech: dxRooms.map((r) => `«${r.name}»: ${r.coolW != null ? fmtKw(r.coolW) : '—'}`),
        choice: { key: 'dx', prompt: 'Кондиционер', options: [excludeOption('Подбирается отдельно (вне этой спецификации)')], selectedId: input.choices?.['dx'] ?? null, required: true } });
  }

  // ---- sources -----------------------------------------------------------------------
  const hydronicHeatW = groups.reduce((s, g) => s + g.heatW, 0);
  const hydronicCoolW = groups.reduce((s, g) => s + g.coolW, 0);
  // Connected terminal ratings (information only — never treated as building demand).
  const parsedKw = (name: string, re: RegExp) => Number((name.match(re)?.[1] ?? '').replace(',', '.')) || 0;
  let connectedCoolKw = 0;
  let connectedHeatKw = 0;
  for (const pick of Object.values(input.fanCoilPicks ?? {})) {
    if (!pick?.sku) continue;
    const nm = input.catalog?.get(pick.sku)?.name ?? '';
    connectedCoolKw += parsedKw(nm, /охлажд[^\d]{0,14}(\d+(?:[.,]\d+)?)/i) * pick.units;
    connectedHeatKw += parsedKw(nm, /отоплен[^\d]{0,14}(\d+(?:[.,]\d+)?)/i) * pick.units;
  }
  let heatPumpPlan: PlantSummary['heatPump'] = null;
  let selectedHeatPump: HeatPumpAssessment | null = null;
  /** Fact set used for the hydraulic assessment: the selected unit or, when none qualifies, the nearest candidate (preliminary). */
  let topologyHeatPump: HeatPumpAssessment | null = null;
  const planHeatKwBase = design.designHeatingKw ?? (loadsAvailable && hydronicHeatW > 0 ? hydronicHeatW / 1000 : connectedHeatKw > 0 ? connectedHeatKw : null);
  const planCoolKwBase = design.designCoolingKw ?? (loadsAvailable && hydronicCoolW > 0 ? hydronicCoolW / 1000 : connectedCoolKw > 0 ? connectedCoolKw : null);
  const requirementBasis: HeatPumpRequirement['basis'] = design.designHeatingKw != null || design.designCoolingKw != null ? 'override'
    : loadsAvailable && hydronicHeatW > 0 ? 'building_load' : connectedHeatKw > 0 || connectedCoolKw > 0 ? 'connected_terminals' : 'unknown';
  if (groups.length && requested.includes('heating') && hydronicHeatW > 0) {
    const label = source === 'heat_pump' ? 'Тепловой насос воздух–вода' : source === 'boiler' ? 'Котёл' : source === 'external' ? 'Подключение к внешнему теплоснабжению (ИТП)' : 'Источник тепла';
    const sourceTech = [`Сумма водяных контуров ${fmtKw(hydronicHeatW)}${reserveRatio > 0 ? ` (уже с запасом ${Math.round(reserveRatio * 100)}% предварительного расчёта)` : ''}; ГВС не учтено.`];
    if (source === 'heat_pump') {
      const req: HeatPumpRequirement = {
        heatingKw: planHeatKwBase, coolingKw: planCoolKwBase, basis: requirementBasis,
        requiredSupplyC: groups.length ? Math.max(...groups.map((g) => g.supplyC)) : null,
        needsCooling: requested.includes('cooling') && (planCoolKwBase ?? 0) > 0,
      };
      const assessed = rankHeatPumps(HEAT_PUMPS.map((f) => {
        const cp = input.catalog?.get(f.sku);
        return assessHeatPump(f, req, { inStock: cp?.inStock ?? null, priceAmd: cp?.priceAmd ?? null });
      }));
      const best = assessed[0];
      selectedHeatPump = best && best.verdict === 'suitable_preliminary' ? best : null;
      topologyHeatPump = selectedHeatPump ?? assessed.find((a) => a.verdict !== 'incompatible') ?? null;
      heatPumpPlan = {
        basis: requirementBasis, requiredHeatingKw: req.heatingKw, requiredCoolingKw: req.coolingKw,
        connectedCoolingKw: connectedCoolKw > 0 ? round(connectedCoolKw, 2) : null, connectedHeatingKw: connectedHeatKw > 0 ? round(connectedHeatKw, 2) : null,
        candidates: assessed.map((a) => ({ sku: a.sku, name: a.fact.name, verdict: a.verdict, heatingKw: a.heatingKw, coolingKw: a.coolingKw, inStock: a.inStock, priceAmd: a.priceAmd, reasons: a.reasons, unresolved: a.unresolved })),
        selectedSku: selectedHeatPump?.sku ?? null,
      };
      const basisText = requirementBasis === 'override' ? 'заданная инженером нагрузка' : requirementBasis === 'building_load' ? 'предварительный расчёт нагрузок здания' : 'сумма мощностей подключённых приборов (НЕ нагрузка здания)';
      const altProducts = assessed.filter((a) => a !== selectedHeatPump).map((a) => input.catalog?.get(a.sku)).filter((p): p is CatalogProduct => Boolean(p));
      if (selectedHeatPump) {
        const sel = selectedHeatPump;
        book.catalog('main', sel.sku, `Тепловой насос воздух–вода ${sel.fact.name}`, 1, 'confirmed',
          `Инженерный кандидат (предварительно): нагрев ${sel.heatingKw} кВт, охлаждение ${sel.coolingKw} кВт при стандартных условиях; требуется ${planHeatKwBase != null ? fmtKw(planHeatKwBase * 1000) : '—'} нагрев / ${planCoolKwBase != null ? fmtKw(planCoolKwBase * 1000) : '—'} охлаждение (${basisText}).`,
          {
            engineering: 'preliminary', evidence: sel.fact.evidence, candidates: altProducts,
            details: describeHeatPump(sel.fact),
            checks: ['Предварительный подбор: подтвердить мощность при расчётной наружной температуре и температуре воды по таблицам производителя.', ...sel.unresolved.slice(0, 4)],
            tech: [...sel.reasons, ...sel.fact.notes, `Другие модели: ${assessed.filter((a) => a !== sel).map((a) => `${a.fact.name} — ${a.verdict === 'suitable_preliminary' ? 'подходит предварительно' : a.verdict === 'insufficient' ? 'мощности недостаточно' : 'несовместима'}`).join('; ') || 'нет'}.`],
          });
      } else {
        const near = assessed.find((a) => a.verdict !== 'incompatible') ?? assessed[0];
        book.choice('main', 'heat-source', `${label}: не менее ${planHeatKwBase != null ? fmtKw(planHeatKwBase * 1000) : '—'} нагрев${req.needsCooling && planCoolKwBase != null ? ` / ${fmtKw(planCoolKwBase * 1000)} охлаждение` : ''} (${basisText})`, 1, 'confirmed',
          `Ни одна модель Riello из каталога не покрывает требование по номинальным мощностям${near ? `; ближайшая — ${near.fact.name}: ${near.reasons.join(' ')} Наличие: ${near.inStock === true ? 'в наличии' : near.inStock === false ? 'под заказ' : 'уточняется'}${near.priceAmd != null ? `, цена по каталогу ${Math.round(near.priceAmd).toLocaleString('ru-RU')} драм` : ''}. Предложение остаётся предварительным до инженерного решения.` : ''}`,
          { candidates: assessed.map((a) => input.catalog?.get(a.sku)).filter((p): p is CatalogProduct => Boolean(p)), engineering: 'preliminary',
            checks: ['Нужна модель большей мощности, два теплонасоса или уточнение нагрузки (возможно, расчётная нагрузка ниже суммы приборов).'],
            details: near ? describeHeatPump(near.fact) : [], tech: sourceTech,
            choice: { key: 'heat-source', prompt: 'Источник тепла', required: true, selectedId: input.choices?.['heat-source'] ?? null,
              options: [
                ...assessed.map((a): ChoiceOption => ({ id: a.sku, sku: a.sku, kind: 'product', quantity: 1, label: a.fact.name, disabled: a.verdict !== 'suitable_preliminary',
                  detail: a.verdict === 'suitable_preliminary' ? 'подходит предварительно' : a.verdict === 'insufficient' ? `мощности недостаточно: ${a.heatingKw} кВт нагрев / ${a.coolingKw} кВт охлаждение` : 'не подходит' })),
                excludeOption('Подбирается отдельно (другая модель / каскад) — решение инженера'),
              ] } });
      }
    } else {
      book.choice('main', 'heat-source', `${label}: не менее ${fmtKw(hydronicHeatW)} при расчётной зимней температуре`, 1, 'confirmed',
        'Мощность в каталоге задана при стандартных условиях — при морозе нужна проверка по таблицам производителя',
        { tech: sourceTech,
          choice: { key: 'heat-source', prompt: 'Источник тепла', required: true, selectedId: input.choices?.['heat-source'] ?? null,
            options: [
              ...(source === 'boiler' && heatSourceId ? boilerOptions(heatSourceId, planHeatKwBase ?? hydronicHeatW / 1000, inv) : []),
              excludeOption(source === 'external' ? 'Подключение к существующему теплоснабжению (ИТП) — вне спецификации' : 'Подбирается отдельно / котёл уже есть (вне этой спецификации)'),
            ] } });
    }
  }
  if (groups.length && hydronicCoolW > 0 && !(selectedHeatPump && coolSourceId && coolSourceId === heatSourceId)) {
    const sameAsHeat = coolSourceId && coolSourceId === heatSourceId;
    book.choice('main', 'cool-source', `${sameAsHeat ? 'Тот же источник в режиме охлаждения' : 'Источник холода (реверсивный тепловой насос / чиллер)'}: не менее ${fmtKw(hydronicCoolW)} при 7/12 °C`, sameAsHeat ? null : 1, sameAsHeat ? 'by_installer' : 'confirmed', 'Проверить холодопроизводительность при летней расчётной температуре',
      { choice: { key: 'cool-source', prompt: 'Источник холода', required: true, selectedId: input.choices?.['cool-source'] ?? null,
        options: sameAsHeat ? [confirmOption('Подтверждаю: охлаждение от того же реверсивного источника'), excludeOption()] : [excludeOption('Подбирается отдельно (чиллер / тепловой насос) — вне спецификации')] } });
  }

  // ---- pumps ---------------------------------------------------------------------------
  const pumps: PumpResult[] = [];
  const pumpedGroups = groups.filter((g) => g.flowM3h > 0);
  const separated = pumpedGroups.length > 1;
  const area = summaryLoads?.totalAreaM2 ?? rooms.reduce((s, r) => s + r.areaM2, 0);
  const floorCount = Math.max(1, floorList.length || 1);
  const estimatedPath = Math.round(Math.sqrt(Math.max(area, 1) / floorCount) * 1.5 + 3 * (floorCount - 1) + 5);
  const pathM = design.criticalPathM ?? estimatedPath;
  if (design.criticalPathM == null && pumpedGroups.length) {
    missingInputs.push(`Длина трубы до самого дальнего прибора не указана — принято ≈ ${estimatedPath} м по площади и этажности.`);
  }
  if (loadsAvailable) {
    for (const g of pumpedGroups) {
      const pipe = mainPipeSize(g.flowM3h, MAIN_VELOCITY);
      // A pump group on the manifold only sees its own secondary circuit.
      const secondaryOnly = g.kind === 'ufh' && g.needsMixing;
      const gradient = pipeGradientPaM(g.flowM3h, pipe.innerM, (g.supplyC + g.returnC) / 2, fluid);
      const coolGradient = g.coolingSupplyC != null ? pipeGradientPaM(g.flowM3h, pipe.innerM, (g.coolingSupplyC + (g.coolingReturnC ?? 12)) / 2, fluid) : 0;
      const pipeKPa = (Math.max(gradient, coolGradient) * 2 * pathM * (1 + PIPE_FITTINGS_ALLOWANCE)) / 1000;
      const breakdown: PumpBreakdownItem[] = [];
      if (!secondaryOnly) breakdown.push({ label: `Трубы ${pipe.od} (внутр. Ø ${Math.round(pipe.innerM * 1000)} мм, ${round(velocityMs(g.flowM3h, pipe.innerM), 2)} м/с): подача + обратка 2 × ${pathM} м, ${Math.round(Math.max(gradient, coolGradient))} Па/м, +30% на фитинги`, kPa: pipeKPa, assumption: design.criticalPathM == null });
      breakdown.push(
        { label: g.kind === 'ufh' ? 'Самая длинная петля тёплого пола' : g.kind === 'fan_coil' ? 'Самый «тяжёлый» фанкойл (паспорт)' : 'Радиатор с термоклапаном', kPa: g.terminalDpKPa, assumption: g.terminalDpAssumed },
      );
      if (g.valveDpKPa > 0) breakdown.push({ label: g.kind === 'ufh' ? 'Клапан коллектора (до уточнения по диаграмме)' : g.manifolds.length ? (g.valveDpAssumed ? 'Клапан коллектора (допущение)' : 'Клапан коллектора (kvs по документации)') : 'Клапан фанкойла', kPa: g.valveDpKPa, assumption: g.valveDpAssumed });
      if (!secondaryOnly) breakdown.push({ label: 'Сетчатый фильтр (чистый)', kPa: ASSUMED.strainerKPa, assumption: true });
      if (separated && !secondaryOnly) breakdown.push({ label: 'Гидрострелка / буферная ёмкость', kPa: ASSUMED.separatorKPa, assumption: true });
      const headKPa = breakdown.reduce((s, b) => s + b.kPa, 0);
      const headM = headKPa / KPA_PER_M;
      const notes: string[] = secondaryOnly ? ['Насос узла работает только на коллектор и петли (вторичный контур); подача к узлу — от гидрострелки / источника.'] : [];
      notes.push(`Расход ${round(g.flowM3h, 2)} м³/ч = тепловая нагрузка / (ρ·c·ΔT), ΔT ${g.supplyC - g.returnC} K${g.coolingSupplyC != null ? `, в охлаждении ΔT ${(g.coolingReturnC ?? 12) - g.coolingSupplyC} K` : ''}; ${fluid.label}.`);
      if (velocityMs(g.flowM3h, pipe.innerM) > MAIN_VELOCITY) notes.push('Расход больше, чем пропускает самая крупная труба модели — нужен расчёт магистрали.');
      let integrated: string | null = null;
      let selection: PumpResult['selection'] = null;
      if (g.kind === 'ufh' && g.needsMixing) {
        const unitLine = book.list().find((l) => l.group === 'distribution' && MIXING_UNITS.some((u) => u.sku === l.sku));
        integrated = unitLine ? MIXING_UNITS.find((u) => u.sku === unitLine.sku)!.pump : 'насос смесительного узла';
        notes.push('Контур тёплого пола обслуживает насос смесительного узла; напор сверить с кривой насоса узла.');
      } else if (!separated && design.sourcePumpHeadKPa != null && design.sourcePumpHeadKPa >= headKPa) {
        integrated = 'встроенный насос источника';
        notes.push(`Остаточный напор насоса источника ${design.sourcePumpHeadKPa} кПа ≥ требуемых ${round(headKPa, 1)} кПа — отдельный насос не нужен.`);
      } else {
        const pumpSel = selectPump({
          id: g.id, label: g.label, flowM3h: g.flowM3h, headM,
          maxFluidTempC: g.supplyC, chilledWater: g.coolingSupplyC != null || g.id === 'fc-cool',
        }, inv, policy, index);
        roleCoverage(`pump-${g.id}`, `Циркуляционный насос «${g.label}»`, ['CIRCULATION_PUMP', 'BOILER_SPARE_PUMP', 'OTHER_PUMP'], pumpSel.screening);
        const best = pumpSel.selected;
        if (best) selection = { sku: best.profile.sku, name: best.profile.name, headAtFlowM: round(best.headAtFlowM ?? 0, 2) };
        if (!separated && design.sourcePumpHeadKPa == null) {
          notes.push('Если встроенного насоса источника хватает (нужен остаточный напор не менее требуемого), отдельный насос не нужен — укажите напор из паспорта источника.');
        } else if (!separated && design.sourcePumpHeadKPa != null) {
          notes.push(`Остаточного напора насоса источника (${design.sourcePumpHeadKPa} кПа) недостаточно.`);
        }
        const lineName = `Циркуляционный насос контура «${g.label}»`;
        const pumpDetails = (p: ProductProfile, headAt: number | null) => [
          `Модель: ${p.name}${num(p, 'dn') != null ? `; DN ${num(p, 'dn')}` : ''}${str(p, 'connection_thread') ? `; резьба ${str(p, 'connection_thread')}` : ''}`,
          `Требуется: ${round(g.flowM3h, 2)} м³/ч, напор ${round(headM, 2)} м (${round(headKPa, 1)} кПа)`,
          `Доступный напор при этом расходе: ≈ ${headAt != null ? round(headAt, 2) : '—'} м — оценка по Hmax/Qmax; кривая Q–H производителя не подтверждена`,
          `Hmax ${num(p, 'h_max_m') ?? '—'} м, Qmax ${num(p, 'q_max_m3h') ?? '—'} м³/ч (${sourceLabel(attr(p, 'h_max_m'))}); строительная длина: ${num(p, 'install_length_mm') != null ? `${num(p, 'install_length_mm')} мм` : 'не подтверждена'}`,
          `Мощность: ${num(p, 'power_max_w') != null ? `${num(p, 'power_max_w')} Вт` : 'не подтверждена'}; регулирование: ${str(p, 'speed_control') === 'ELECTRONIC' ? 'электронное' : str(p, 'motor') === 'PERMANENT_MAGNET' ? 'синхронный двигатель (энергоэффективный)' : str(p, 'speed_control') === 'FIXED_SPEEDS' ? 'ступенчатые скорости' : 'не подтверждено'}`,
        ];
        if (best) {
          book.catalog('pumps', best.profile.sku, best.profile.name, 1, separated ? 'confirmed' : 'estimated',
            `${g.label}: ${round(g.flowM3h, 2)} м³/ч при ${round(headM, 2)} м`,
            {
              evidence: ['OHMX-CATALOG'],
              engineering: 'preliminary',
              details: pumpDetails(best.profile, best.headAtFlowM),
              checks: ['Предварительно: проверить рабочую точку по кривой производителя — насос не считается подтверждённым без кривой Q–H.', ...(!separated ? ['Нужен, только если не хватает встроенного насоса источника.'] : [])],
              tech: [
                `Проверено насосов каталога: ${pumpSel.population} (все бренды). Порядок: энергоэффективность → наличие → наименьший подходящий (Hmax·Qmax) → цена → предпочтение бренда (${(policy.brandPreference.CIRCULATION_PUMP ?? []).join(' → ') || 'нет'}) только при равенстве.`,
                ...best.reasons,
              ],
              match: matchOf('pump', best.verdict, best.reasons, best.stock, pumpSel.screening),
            });
        } else {
          // No pump passes the estimate. Do not discard the whole warehouse because of a partly ASSUMED requirement:
          // offer the strongest suitable-by-flow pump on stock as an explicitly UNAPPROVED candidate when the shortfall
          // is not larger than the assumed share of the requirement. Never approve it.
          const assumedHeadM = breakdown.filter((b) => b.assumption).reduce((sum, b) => sum + b.kPa, 0) / KPA_PER_M;
          const near = pumpSel.evaluated
            .filter((e) => e.verdict === 'INSUFFICIENT_DATA' && e.headAtFlowM != null && e.headAtFlowM < headM && headM - e.headAtFlowM <= assumedHeadM
              && g.flowM3h <= PUMP_MAX_FLOW_SHARE * (num(e.profile, 'q_max_m3h') ?? 0) && e.stock.status !== 'NOT_IN_STOCK' && e.stock.status !== 'UNKNOWN')
            .sort((a, b) => a.efficiency - b.efficiency || (b.headAtFlowM ?? 0) - (a.headAtFlowM ?? 0) || a.profile.sku.localeCompare(b.profile.sku))[0];
          if (near) {
            const shortfall = headM - (near.headAtFlowM ?? 0);
            book.catalog('pumps', near.profile.sku, near.profile.name, 1, separated ? 'confirmed' : 'estimated',
              `${g.label}: ${round(g.flowM3h, 2)} м³/ч при ориентировочном напоре ${round(headM, 1)} м — НЕ ОДОБРЕН: по оценке не хватает ${round(shortfall, 2)} м`,
              { evidence: ['OHMX-CATALOG'], engineering: 'preliminary',
                details: [...pumpDetails(near.profile, near.headAtFlowM), `Из требуемого напора допущения ≈ ${round(assumedHeadM, 2)} м`],
                checks: ['Не одобрен автоматически: требования к напору оценочные (трубы, фитинги, фильтр — допущения). Уточнить длины/потери или взять насос большего напора.'],
                tech: breakdown.map((b) => `${b.label}: ${round(b.kPa, 1)} кПа${b.assumption ? ' (допущение)' : ''}`),
                match: matchOf('pump', 'REQUIRES_ENGINEERING_REVIEW', near.reasons, near.stock, pumpSel.screening) });
          } else {
            book.missing('pumps', `pump-${g.id}`, `${lineName}: ${round(g.flowM3h, 2)} м³/ч при напоре не менее ${round(headM, 1)} м`, 1, separated ? 'confirmed' : 'estimated',
              `Ни один из ${pumpSel.population} насосов каталога не проходит по расходу и напору (с причинами — в списке проверенных).`,
              { tech: [`Допущения в требовании ≈ ${round(assumedHeadM, 2)} м из ${round(headM, 2)} м.`, ...breakdown.map((b) => `${b.label}: ${round(b.kPa, 1)} кПа${b.assumption ? ' (допущение)' : ''}`)],
                match: matchOf('pump', 'UNAVAILABLE', ['нет насоса, проходящего проверку'], null, pumpSel.screening) });
          }
        }
        const pumpValve = BALL_VALVES_FM[pipe.thread];
        if (pumpValve) {
          book.catalog('fittings', pumpValve.sku, pumpValve.name, 2, 'confirmed', `Отключение насоса контура «${g.label}» — замена без слива системы`,
            { evidence: ['OHMX-CATALOG'], checks: [`Размер по магистрали контура ${pipe.od} (${pipe.thread}); насос подключается через свои присоединительные гайки — при другой резьбе нужен переходник.`] });
        } else {
          book.missing('fittings', `pump-valves-${g.id}`, `Шаровые краны для отключения насоса контура «${g.label}» (размер по присоединению насоса)`, 2, 'confirmed', 'Замена насоса без слива системы',
            { tech: [`Магистраль ${pipe.od} (${pipe.thread}); резьба кранов — по присоединению выбранного насоса.`] });
        }
      }
      pumps.push({ groupId: g.id, label: g.label, flowM3h: round(g.flowM3h, 3), headKPa: round(headKPa, 1), breakdown, integrated, selection, mainPipe: pipe.od, preliminary: true, notes });
    }
  }

  // ---- plant accessories --------------------------------------------------------------
  let topology: TopologyResult | null = null;
  if (groups.length) {
    const totalFlow = groups.reduce((s, g) => s + g.flowM3h, 0);
    const main = mainPipeSize(totalFlow || 0.3, MAIN_VELOCITY);
    const topologyInput = {
      heatPump: topologyHeatPump?.fact ?? null,
      primaryKw: planHeatKwBase,
      groups: pumpedGroups.map((g) => ({
        id: g.id, kind: g.kind, flowM3h: g.flowM3h, hasZoneValves: g.manifolds.length > 0 || g.kind === 'ufh',
        hasOwnPump: g.kind === 'ufh' && g.needsMixing,
        requiredHeadM: (() => { const pr = pumps.find((x) => x.groupId === g.id); return pr ? pr.headKPa / KPA_PER_M : null; })(),
        needsAddedPump: (() => { const pr = pumps.find((x) => x.groupId === g.id); return Boolean(pr && !pr.integrated); })(),
        // 16×2 multilayer: inner Ø12 mm = 0.113 L/m; fan-coil branch volume is not estimated (conservative: 0).
        waterVolumeL: g.kind === 'ufh' ? g.pipeM * 0.113 : 0, supplyC: g.supplyC,
      })),
      minWaterLPerKw: design.minWaterLPerKw,
      assumedMinWaterLPerKw: ASSUMED_MIN_WATER_L_PER_KW,
      bypassProvided: design.bypassProvided,
    };
    topology = source === 'heat_pump' && pumpedGroups.length ? assessTopology(topologyInput) : null;
    const separatorWanted = topology ? topology.separator.level === 'required' : separated;
    const separatorOptional = topology ? topology.separator.level === 'recommended' : false;
    if (separatorWanted || separatorOptional) {
      // Emmeti DN25 card states Ду25, 1" side / 1/2" end ports, 10 bar, 110 °C — NO maximum flow. Connection velocity is the only check.
      const sepVelocity = round(totalFlow / 3600 / (Math.PI * 0.0125 ** 2), 2);
      const sepFits = groups.length <= HYDRAULIC_SEPARATOR.maxCircuits && sepVelocity <= HYDRAULIC_SEPARATOR.maxVelocityMs;
      const sepBasis = `Расчётный расход ${round(totalFlow, 2)} м³/ч = сумма расходов вторичных контуров при ΔT 5 K (все контуры одновременно). Скорость в присоединении Ду25: ${sepVelocity} м/с (инженерный критерий ≤ ${HYDRAULIC_SEPARATOR.maxVelocityMs} м/с — не данные производителя).`;
      if (sepFits) {
        book.catalog('pumps', HYDRAULIC_SEPARATOR.sku, HYDRAULIC_SEPARATOR.name, 1, 'confirmed',
          `${separatorOptional ? 'Рекомендуется: ' : ''}гидравлическая развязка контуров (${groups.length}), расход ${round(totalFlow, 2)} м³/ч`,
          { evidence: ['OHMX-CATALOG'], engineering: 'preliminary', optional: separatorOptional,
            details: [`Присоединение: Ду25 (1") боковые, 1/2" торцевые; рабочее давление до 10 бар, до 110 °C; ${groups.length} контура`, 'Максимальный расход производителем в карточке не указан', 'Габариты (В×Ш×Г), изоляция и комплект: не подтверждены', sepBasis],
            checks: ['Максимальный расход и габариты сверить с паспортом Emmeti.'] });
      } else {
        book.missing('pumps', 'separator', `Гидравлический разделитель на расход ≈ ${round(totalFlow, 2)} м³/ч${separatorOptional ? ' (рекомендуется)' : ''}`, 1, 'confirmed',
          'Единственный разделитель в каталоге (Emmeti Ду25, 2 контура) не подтверждается по числу контуров или скорости в присоединении',
          { optional: separatorOptional, tech: [sepBasis, 'Максимальный расход Emmeti 28151040 в карточке не указан.'] });
      }
    }
    if (topology && topology.bypass.level !== 'not_required' && topology.bypass.level !== 'unknown') {
      book.missing('pumps', 'bypass', 'Перепускной (байпасный) клапан для сохранения минимального расхода теплового насоса', 1, 'by_installer',
        topology.bypass.reason, { engineering: 'preliminary', optional: topology.bypass.level === 'recommended', tech: ['Байпас обеспечивает расход, но не добавляет объём воды и энергию для оттайки.'] });
    }
    if (topology && (topology.buffer.level === 'required' || topology.buffer.level === 'recommended')) {
      book.missing('pumps', 'buffer', `Буферная ёмкость (объём воды при закрытых зонах не менее ${topology.minWaterVolumeL ?? '—'} л — по контуру без клапанов или ёмкость)`, 1, 'by_installer',
        topology.buffer.reason, { engineering: 'preliminary', optional: topology.buffer.level === 'recommended', checks: topology.unresolved, tech: [topology.defrostNote, ...topology.rationale] });
    }
    const strainer = loadsAvailable ? STRAINERS.find((s) => s.thread === main.thread) : undefined;
    if (strainer) {
      book.catalog('fittings', strainer.sku, strainer.name, 1, 'estimated', `Защита источника и насосов, магистраль ${main.od}`, { evidence: ['OHMX-CATALOG'], checks: ['Резьба фильтра — по фактическому диаметру магистрали.'] });
    } else if (loadsAvailable) {
      book.missing('fittings', 'strainer', `Сетчатый фильтр ${main.thread}`, 1, 'estimated', 'Защита источника и насосов');
    }
    const vent = AIR_VENTS.find((v) => v.thread === '3/4"')!;
    const ventPoints = groups.filter((g) => g.kind !== 'ufh').length + (separated ? 1 : 0);
    if (ventPoints > 0) {
      book.catalog('fittings', vent.sku, vent.name, ventPoints, 'by_installer', 'Удаление воздуха в верхних точках', { evidence: ['OHMX-CATALOG'], checks: ['Количество — по числу верхних точек трассы.'] });
    }
    book.catalog('fittings', FILL_DRAIN_VALVE.sku, FILL_DRAIN_VALVE.name, groups.length, 'estimated', 'Заполнение и опорожнение контуров',
      { evidence: ['OHMX-CATALOG'], checks: ['На свободный выход — заглушка или штуцер под шланг.'] });
    book.catalog('fittings', THERMOMETER.sku, THERMOMETER.name, groups.length * 2, 'estimated', 'Контроль температуры подачи и обратки каждого контура', { evidence: ['OHMX-CATALOG'] });
    book.catalog('fittings', MANOMETER.sku, MANOMETER.name, 1, 'estimated', 'Контроль давления в системе (рабочее 1,5–2,5 бар)', { evidence: ['OHMX-CATALOG'] });
    // Expansion tank volume depends on the water volume of the whole system → offered as a choice, not auto-sized.
    const tanks = EXPANSION_TANKS.map((t) => input.catalog?.get(t.sku)).filter((p): p is CatalogProduct => Boolean(p))
      .sort(stockFirst<CatalogProduct>((p) => p.sku));
    book.choice('pumps', 'expansion', 'Расширительный бак (объём — около 10% объёма воды в системе)', 1, 'by_installer',
      'Если не входит в комплект источника тепла', { candidates: tanks,
        choice: { key: 'expansion', prompt: 'Расширительный бак', options: [...productOptions(index.byType('EXPANSION_VESSEL'), 1, (p) => num(p, 'volume_l') != null ? `${num(p, 'volume_l')} л` : undefined), excludeOption('Не нужен — входит в комплект источника тепла')], selectedId: input.choices?.['expansion'] ?? null, required: true },
        checks: ['Проверить комплектацию источника тепла.', 'Объём бака — по объёму системы и статической высоте.'] });
    book.catalog('pumps', SAFETY_VALVE_3BAR.sku, SAFETY_VALVE_3BAR.name, 1, 'by_installer', 'Группа безопасности (если не входит в комплект источника)',
      { evidence: ['OHMX-CATALOG'], checks: ['Давление срабатывания 3 бар — сверить с допустимым давлением котла / теплового насоса.'] });
  }

  // ---- resolve against the live catalog ------------------------------------------------
  const lines = book.list();
  // ---- customer choices: apply the explicit selection (stale or disabled selections are ignored) -------------
  for (const line of lines) {
    if (!line.choice) continue;
    line.choice.selectedId = input.choices?.[line.choice.key] ?? null;
    const opt = selectedOption(line.choice);
    if (!opt) { line.choice.selectedId = null; continue; }
    if (opt.kind === 'product' && opt.sku) {
      line.status = 'catalog';
      line.sku = opt.sku;
      line.quantity = opt.quantity ?? line.quantity;
      line.qtyStatus = line.quantity != null ? 'confirmed' : line.qtyStatus;
      line.reason = `Выбрано: ${opt.label}${opt.detail ? ` — ${opt.detail}` : ''}`;
      for (const c of opt.checks ?? []) if (!line.checks.includes(c)) line.checks.push(c);
      if (opt.checks?.length) line.engineering = 'preliminary';
    } else {
      line.excluded = opt.kind === 'exclude';
      line.reason = opt.label;
    }
  }
  const choiceResolved = (l: BomLine) => Boolean(l.choice && selectedOption(l.choice));
  const skus = [...new Set([
    ...lines.flatMap((l) => l.choice?.options.map((o) => o.sku).filter((x): x is string => Boolean(x)) ?? []),
    ...lines.filter((l) => l.sku).map((l) => l.sku!),
    ...(waterTowels.length ? WATER_TOWEL_WARMERS : []),
    ...(groups.length ? EXPANSION_TANKS.map((t) => t.sku) : []),
    ...(source === 'heat_pump' && groups.length ? HEAT_PUMPS.map((h) => h.sku) : []),
    ...Object.values(input.fanCoilPicks ?? {}).map((p) => p?.stockAlternative?.sku).filter((x): x is string => Boolean(x)),
    // every candidate of every screened role: the stock-aware selection needs their live availability
    ...roles.flatMap((r) => index.byType(...r.screenedTypes).map((p) => p.sku)),
    // roles that only appear after a stock-driven switch (a larger manifold needs plugs) must be looked up up-front
    ...(manifoldSelections.size ? index.byType('MANIFOLD_PLUG').map((p) => p.sku) : []),
    ...(ufhRooms.length ? MIXING_UNITS.map((u) => u.sku) : []),
  ])].sort();
  for (const line of lines) {
    if (!line.sku) continue;
    if (!input.catalog) { line.pending = true; continue; }
    const product = input.catalog.get(line.sku);
    if (product === undefined) { line.pending = true; continue; }
    if (product === null) {
      // Planned SKU is not an active catalog product: keep the descriptive name only.
      line.status = 'missing';
      line.sku = null;
      line.key = `missing:${line.key}`;
      continue;
    }
    line.product = product;
    if (line.unit === 'м' && product.unit !== 'м') {
      line.checks.push(`В каталоге цена указана за «${product.unit}» — уточнить, что это цена за метр.`);
    } else {
      line.unit = product.unit || line.unit;
    }
  }

  lines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

  let pricedSubtotalAmd = 0;
  let pricedLines = 0;
  let unpricedLines = 0;
  for (const l of lines) {
    if (l.status !== 'catalog' || !l.product || l.excluded) continue;
    if (l.product.priceAmd != null && l.quantity != null) { pricedSubtotalAmd += l.product.priceAmd * l.quantity; pricedLines += 1; } else unpricedLines += 1;
  }

  // ---- independent second pass + selection report -------------------------------------
  const heatPumpSkus = new Set(HEAT_PUMPS.map((h) => h.sku));
  const requiredRoles: Parameters<typeof auditSpecification>[0]['requiredRoles'] = [];
  if (groups.length && requested.includes('heating') && hydronicHeatW > 0) requiredRoles.push({ role: 'heat_source', label: 'источник тепла', satisfiedBy: (l) => l.key === 'choice:heat-source' || (l.sku != null && heatPumpSkus.has(l.sku)) });
  for (const g of groups) for (const m of g.manifolds) requiredRoles.push({ role: 'manifold', label: `коллектор (${g.label})`, satisfiedBy: (l) => l.match?.role === 'manifold' && (l.sku === m.sku || l.status === 'missing') });
  for (const pr of pumps) if (!pr.integrated) requiredRoles.push({ role: 'pump', label: `насос «${pr.label}»`, satisfiedBy: (l) => l.match?.role === 'pump' });
  if (actuatedCircuits > 0) {
    requiredRoles.push({ role: 'actuator', label: 'термоприводы', satisfiedBy: (l) => l.match?.role === 'actuator' });
    requiredRoles.push({ role: 'thermostat', label: 'комнатные термостаты', satisfiedBy: (l) => l.match?.role === 'thermostat' });
  }
  if (groups.length) {
    requiredRoles.push({ role: 'expansion', label: 'расширительный бак', satisfiedBy: (l) => l.key === 'choice:expansion' });
    requiredRoles.push({ role: 'safety', label: 'предохранительный клапан', satisfiedBy: (l) => l.sku === SAFETY_VALVE_3BAR.sku });
  }
  const audit = auditSpecification({
    lines: lines.map((l) => ({ key: l.key, sku: l.sku, name: l.status === 'catalog' ? l.product?.name ?? l.name : l.name, quantity: l.quantity, status: l.status, group: l.group, optional: l.optional, engineering: l.engineering, excluded: l.excluded, choiceResolved: choiceResolved(l), match: l.match ? { verdict: l.match.verdict, role: l.match.role } : undefined })),
    actuatedCircuits,
    zones: controlZones.map((z) => ({ id: z.id, circuits: z.circuits })),
    plugOutlets,
    requiredRoles,
  }, inv, index);
  // Aggregated stock goes back onto the lines (a SKU used by several groups is checked once with the summed quantity).
  for (const st of audit.stock) {
    const line = lines.find((l) => l.sku === st.sku && !l.optional);
    if (line?.match) line.match.stock = st.check;
    if (line?.match && st.check.status === 'INSUFFICIENT') line.match.reasons = [...line.match.reasons.filter((r) => !r.startsWith('на складе')), stockText(st.check)];
  }
  const screenedTotal = roles.reduce((sum, r) => sum + r.screening.length, 0);
  const verdictCount = (v: MatchClass) => roles.reduce((sum, r) => sum + r.screening.filter((x) => x.verdict === v).length, 0);
  const stockSource: SelectionReport['stockSource'] = input.quantities?.size ? 'quantity' : input.catalog ? 'public-status' : 'none';
  const selectionReport: SelectionReport = {
    snapshot: { dbSha256: index.meta.dbSha256, activeProducts: index.meta.activeProducts, profiles: index.meta.exported },
    stages: [
      { id: 'requirements', label: 'Инженерные требования', status: loadsAvailable ? 'done' : 'blocked', detail: loadsAvailable ? `${groups.length} контур(ов), ${actuatedCircuits} регулируемых выходов, ${pumps.length} насосных групп` : 'нагрузки не рассчитаны' },
      { id: 'screening', label: 'Просмотр каталога', status: 'done', detail: `снимок каталога: ${index.meta.activeProducts} активных товаров, ${index.meta.exported} технических профилей; по ролям проверено ${screenedTotal} позиций` },
      { id: 'discovery', label: 'Поиск альтернатив', status: 'done', detail: `подходят: ${verdictCount('EXACT_VERIFIED') + verdictCount('SUBSTITUTE_VERIFIED')} подтверждённо, ${verdictCount('SUBSTITUTE_CONDITIONAL')} условно` },
      { id: 'validation', label: 'Проверка совместимости', status: 'done', detail: `не подходят: ${verdictCount('INCOMPATIBLE')}; не хватает данных: ${verdictCount('INSUFFICIENT_DATA')}; нужно решение инженера: ${verdictCount('REQUIRES_ENGINEERING_REVIEW')}` },
      { id: 'assembly', label: 'Сборка системы целиком', status: chain.options.length || !actuatedCircuits ? 'done' : 'blocked', detail: actuatedCircuits ? `сравнено схем управления: ${chain.options.length}; выбрана: ${chain.selected?.label ?? '—'}` : 'регулируемых зон нет' },
      { id: 'accessories', label: 'Комплектность и аксессуары', status: 'done', detail: `${plugOutlets ? `заглушек на свободные выходы: ${plugOutlets}; ` : ''}обязательных функций: ${requiredRoles.length}` },
      { id: 'stock', label: 'Проверка наличия', status: input.catalog ? 'done' : 'pending', detail: !input.catalog ? 'ожидаем ответ каталога' : stockSource === 'quantity' ? 'по количеству на складе' : 'только «в наличии / под заказ» — количество не подтверждено' },
      { id: 'audit', label: 'Независимая проверка BOM', status: !input.catalog ? 'pending' : audit.findings.some((f) => f.severity === 'error') ? 'blocked' : 'done', detail: `ошибок ${audit.findings.filter((f) => f.severity === 'error').length}, предупреждений ${audit.findings.filter((f) => f.severity === 'warning').length}; ${audit.installationReady ? 'готово к монтажу' : 'не готово к монтажу без проверок'}` },
    ],
    roles,
    controlOptions: chain.options.map((o) => ({
      id: o.id, label: o.label, complete: o.complete, verdict: o.verdict, missing: o.missing, notes: o.notes, knownCostAmd: o.knownCostAmd, unpricedLines: o.unpricedLines,
      selected: o === chain.selected, stock: o.lines.filter((l) => l.stock).map((l) => `${l.sku}: ${stockText(l.stock!)}`),
    })),
    audit,
    stockSource,
  };

  assumptions.push(
    `Тёплый пол: ${UFH_SUPPLY}/${UFH_RETURN} °C; до ${UFH_MAX_WM2} Вт/м², если в комнате есть второй прибор.`,
    `Фанкойлы: отопление ${fcHeat.s}/${fcHeat.r} °C, охлаждение ${COOL_SUPPLY}/${COOL_RETURN} °C; радиаторы ${radHeat.s}/${radHeat.r} °C.`,
    `Трубы: металлопластик, скорость в магистрали ≤ ${MAIN_VELOCITY} м/с (отводы к приборам ≤ 1,0 м/с), +30% потерь на фитинги; ${fluid.label}.`,
    'Насосы: оценка по Hmax/Qmax из карточек каталога (кривых производителя в каталоге нет) — подбор предварительный.',
  );
  if (reserveRatio > 0) assumptions.push(`Тепловая мощность приборов и расходы считаются от требуемой мощности с запасом ${Math.round(reserveRatio * 100)}% (предварительный расчёт), запас добавлен один раз.`);

  const circuits = groups.reduce((s, g) => s + g.circuits, 0);
  const manifoldList = groups.flatMap((g) => g.manifolds.map((m) => `${m.family ?? 'коллектор'} ${m.outlets}+${m.outlets}`));
  const config0 = [
    ufhRooms.length ? 'тёплый пол' : null,
    fcUnits.length ? (fourPipe ? 'фанкойлы 4-трубные' : 'фанкойлы 2-трубные') : null,
    radRooms.length ? 'радиаторы' : null,
    elecRooms.length ? 'электроотопление' : null,
    dxRooms.length ? 'кондиционеры' : null,
  ].filter(Boolean).join(' + ');

  return {
    ready: Boolean(input.catalog) && (fanCoilRequests.length === 0 || Boolean(input.fanCoilPicks) || !loadsAvailable),
    loadsAvailable,
    summary: {
      totalAreaM2: summaryLoads?.totalAreaM2 ?? (rooms.length ? rooms.reduce((s, r) => s + r.areaM2, 0) : null),
      heatingRequiredW: summaryLoads?.heating?.requiredW ?? null,
      heatingReserveRatio: reserveRatio,
      coolingW: summaryLoads?.showCooling ? summaryLoads.coolingW : null,
      configuration: config0 || 'системы не выбраны',
      circuits,
      manifoldText: manifoldList.length ? manifoldList.join(', ') : 'не требуется',
      pumpText: pumps.length
        ? pumps.map((p) => `${p.label}: ${p.flowM3h} м³/ч, ${p.headKPa} кПа${p.integrated ? ` (${p.integrated})` : p.selection ? ` → ${p.selection.name}` : ''}`).join('; ')
        : loadsAvailable ? 'не требуется' : 'после расчёта нагрузок',
    },
    groups,
    pumps,
    lines,
    totals: {
      pricedSubtotalAmd, pricedLines, unpricedLines,
      missingLines: lines.filter((l) => l.status === 'missing').length,
      choiceLines: lines.filter((l) => l.status === 'choice' && !choiceResolved(l)).length,
      unpricedPositions: lines
        .filter((l) => !l.optional && !(l.status === 'choice' && choiceResolved(l)) && (l.status !== 'catalog' || l.product?.priceAmd == null || l.quantity == null))
        .map((l) => (l.status === 'catalog' ? l.product?.name ?? l.name : l.name)),
    },
    plant: {
      status: 'preliminary',
      statusReasons: [
        ...(heatPumpPlan ? ['Мощность теплового насоса не подтверждена при расчётных температурах (нужны таблицы производителя).'] : []),
        ...(!loadsAvailable || heatPumpPlan?.basis === 'connected_terminals' ? ['Нагрузки здания не рассчитаны — подбор по мощности подключённых приборов.'] : []),
        'Кривые Q–H насосов в каталоге отсутствуют — рабочие точки оценочные.',
        ...(topology?.unresolved ?? []),
      ],
      heatPump: heatPumpPlan,
      topology,
      completeness: (() => {
        const fromCatalog = lines.filter((l) => l.status === 'catalog').length;
        const cand = lines.filter((l) => l.engineering === 'preliminary').length;
        const miss = lines.filter((l) => l.status === 'missing').length;
        const ch = lines.filter((l) => l.status === 'choice').length;
        const total = lines.length;
        return { total, fromCatalog, candidatesToVerify: cand, missing: miss, choices: ch, percent: total ? Math.round((fromCatalog / total) * 100) : 0 };
      })(),
    },
    missingInputs,
    assumptions,
    warnings,
    fanCoilRequests,
    skus,
    selection: selectionReport,
    pendingChoices: lines.filter((l) => l.choice?.required && !choiceResolved(l)).map((l) => ({ key: l.choice!.key, name: l.name })),
  };
}

function splitEven(total: number, parts: number): number[] {
  if (parts <= 0 || total <= 0) return [];
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

function uniqueProducts(list: CatalogProduct[]): CatalogProduct[] {
  const seen = new Map<string, CatalogProduct>();
  for (const p of list) if (!seen.has(p.sku)) seen.set(p.sku, p);
  return [...seen.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Pick the fan coil for one request from matcher candidates (pure, testable). */
/**
 * Upper oversize ratio of in-stock units that are SHOWN as alternatives for engineering review.
 * Not an acceptance tolerance: such a unit is never auto-selected (directive 2026-10-15: engineering > stock).
 */
export const FAN_COIL_STOCK_MAX_OVERSIZE = 1.7;

/**
 * Engineering first: the selection is made inside the best-fit band (closest capacity ×1.1 — units that are
 * practically equivalent); inside that band a unit on stock wins, then the lower known price.
 * A larger unit on stock outside the band is not selected automatically: it is returned as `stockAlternative`
 * (an oversized fan coil cycles, is louder at the same airflow and dehumidifies worse — engineer decides).
 */
export function chooseFanCoil(
  request: FanCoilRequest,
  candidatesByUnits: Array<{ units: number; candidates: Array<{ sku: string; capacityKw: number; oversizeRatio: number; priceAmd: number | null; inStock?: boolean | null }> }>,
): FanCoilPick {
  const byPrice = (a: { priceAmd: number | null; oversizeRatio: number; sku: string }, b: { priceAmd: number | null; oversizeRatio: number; sku: string }) => {
    const pa = a.priceAmd ?? Number.POSITIVE_INFINITY;
    const pb = b.priceAmd ?? Number.POSITIVE_INFINITY;
    return pa - pb || a.oversizeRatio - b.oversizeRatio || a.sku.localeCompare(b.sku);
  };
  const otherMountings = new Set<FanCoilMounting>();
  for (const { units, candidates } of candidatesByUnits) {
    const byPipe = candidates.filter((c) => {
      const pipe = fanCoilHydraulics(c.sku)?.pipe_configuration;
      return request.pipe === '4-pipe' ? pipe === '4-pipe' : pipe !== '4-pipe';
    });
    for (const c of byPipe) for (const m of fanCoilMountingInfo(c.sku).mountings) if (m !== request.mounting) otherMountings.add(m);
    const usable = byPipe.filter((c) => fanCoilFits(c.sku, request.mounting));
    if (!usable.length) continue;
    const bestRatio = Math.min(...usable.map((c) => c.oversizeRatio));
    const nearLimit = bestRatio * 1.1;
    const near = usable.filter((c) => c.oversizeRatio <= nearLimit);
    const stockedNear = near.filter((c) => c.inStock === true);
    const c = stockedNear.length ? [...stockedNear].sort(byPrice)[0] : [...near].sort(byPrice)[0];
    const alt = c.inStock === true ? undefined : usable
      .filter((x) => x.inStock === true && x.oversizeRatio > nearLimit && x.oversizeRatio <= FAN_COIL_STOCK_MAX_OVERSIZE)
      .sort((a, b) => a.oversizeRatio - b.oversizeRatio || byPrice(a, b))[0];
    return {
      roomId: request.roomId, units, sku: c.sku, capacityKw: c.capacityKw, inStock: c.inStock ?? null, oversizeRatio: c.oversizeRatio,
      ...(alt ? { stockAlternative: { sku: alt.sku, capacityKw: alt.capacityKw, oversizeRatio: alt.oversizeRatio } } : {}),
    };
  }
  return { roomId: request.roomId, units: 1, sku: null, capacityKw: null, inStock: null, ...(otherMountings.size ? { otherMountings: FAN_COIL_MOUNTINGS.filter((m) => otherMountings.has(m)) } : {}) };
}
