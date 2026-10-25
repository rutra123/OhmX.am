/**
 * CM11 adapter — explicit design inputs (hydronic / wet-bulb / fan-speed / margins)
 * and operating-condition projection with served-room temperature consensus.
 *
 * No numerical defaults, no HIGH fan default, no case folding, no psychrometric
 * derivation, no area/load recomputation. PILOT_REFERENCE only under PRELIMINARY.
 */
import type {
  SystemEngineeringDesignInputs,
  AdapterLoadCalculation,
} from "./types.js";
import type {
  OperatingConditionPolicyInput,
  SourcedNumericOperatingInput,
  SourcedTextOperatingInput,
  ConfiguratorSelectionIntent,
  DesignMarginPolicyInput,
  ConfiguratorDesignMarginInput,
} from "../engineeringConfigurator/types.js";
import type { Diagnostics } from "./policy.js";
import {
  block,
  warn,
  finite,
  nonEmpty,
  canonicalNumber,
} from "./policy.js";

export interface ResolvedLeaf {
  value: number | string;
  unit: "°C" | null;
  source: "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE";
  sourceReference: string;
}

export interface ResolvedDesign {
  heatingWaterSupplyC: ResolvedLeaf;
  heatingWaterReturnC: ResolvedLeaf;
  coolingWaterSupplyC: ResolvedLeaf;
  coolingWaterReturnC: ResolvedLeaf;
  indoorCoolingWetBulbC: ResolvedLeaf;
  sizingFanSpeed: ResolvedLeaf;
  designMargins: DesignMarginPolicyInput;
}

interface NumericLeafLike {
  value: number | null;
  unit: unknown;
  source: unknown;
  sourceReference: string | null;
  status: unknown;
  policyReference?: { policyId: string; policyVersion: string; entryId: string } | null;
}
interface TextLeafLike {
  value: string | null;
  unit: unknown;
  source: unknown;
  sourceReference: string | null;
  status: unknown;
  policyReference?: { policyId: string; policyVersion: string; entryId: string } | null;
}

const DESIGN_SOURCES = ["USER_INPUT", "SYSTEM_POLICY", "PILOT_REFERENCE"] as const;

function validateSource(
  source: unknown,
  sourceReference: unknown,
  policyReference: unknown,
  fieldPath: string,
  d: Diagnostics,
): "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE" | null {
  if (!(DESIGN_SOURCES as readonly unknown[]).includes(source) || !nonEmpty(sourceReference)) {
    block(d, "OPERATING_CONDITION_REQUIRED", fieldPath);
    return null;
  }
  const src = source as "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE";
  if (src === "USER_INPUT") {
    if (policyReference !== null && policyReference !== undefined) {
      block(d, "CANONICAL_VOCABULARY_INVALID", `${fieldPath}.policyReference`);
      return null;
    }
  } else {
    const pr = policyReference as { policyId?: unknown; policyVersion?: unknown; entryId?: unknown } | null | undefined;
    if (!pr || !nonEmpty(pr.policyId) || !nonEmpty(pr.policyVersion) || !nonEmpty(pr.entryId)) {
      block(d, "CANONICAL_VOCABULARY_INVALID", `${fieldPath}.policyReference`);
      return null;
    }
  }
  return src;
}

function resolveNumericLeaf(
  leaf: NumericLeafLike | null | undefined,
  fieldPath: string,
  selectionIntent: ConfiguratorSelectionIntent,
  d: Diagnostics,
): ResolvedLeaf | null {
  if (!leaf || typeof leaf !== "object" || leaf.status !== "RESOLVED" || !finite(leaf.value) || leaf.unit !== "°C") {
    block(d, "OPERATING_CONDITION_REQUIRED", fieldPath);
    return null;
  }
  const source = validateSource(leaf.source, leaf.sourceReference, leaf.policyReference, fieldPath, d);
  if (source === null) return null;
  if (source === "PILOT_REFERENCE") {
    if (selectionIntent === "PROFESSIONAL") {
      block(d, "OPERATING_CONDITION_REQUIRED", fieldPath);
      return null;
    }
    warn(d, "PILOT_REFERENCE_OPERATING_INPUT", fieldPath, "Explicit preliminary-only reference; not Professional evidence.");
  }
  return { value: canonicalNumber(leaf.value as number), unit: "°C", source, sourceReference: leaf.sourceReference as string };
}

function resolveTextLeaf(
  leaf: TextLeafLike | null | undefined,
  fieldPath: string,
  selectionIntent: ConfiguratorSelectionIntent,
  d: Diagnostics,
): ResolvedLeaf | null {
  if (!leaf || typeof leaf !== "object" || leaf.status !== "RESOLVED" || !nonEmpty(leaf.value) || leaf.unit !== null) {
    block(d, "FAN_SPEED_REQUIRED", fieldPath);
    return null;
  }
  const source = validateSource(leaf.source, leaf.sourceReference, leaf.policyReference, fieldPath, d);
  if (source === null) return null;
  if (source === "PILOT_REFERENCE") {
    if (selectionIntent === "PROFESSIONAL") {
      block(d, "FAN_SPEED_REQUIRED", fieldPath);
      return null;
    }
    warn(d, "PILOT_REFERENCE_OPERATING_INPUT", fieldPath, "Explicit preliminary-only reference; not Professional evidence.");
  }
  // No case folding, trimming, title parsing, speed translation or automatic HIGH.
  return { value: leaf.value as string, unit: null, source, sourceReference: leaf.sourceReference as string };
}

function resolveMarginGroup(
  group: ConfiguratorDesignMarginInput | undefined,
  fieldPath: string,
  d: Diagnostics,
): ConfiguratorDesignMarginInput {
  if (group === undefined) {
    return { designMarginPercent: 0, marginSource: "NONE" as const, marginPolicyId: null, marginPolicyVersion: null };
  }
  const pct = group.designMarginPercent;
  const source = group.marginSource;
  const id = group.marginPolicyId;
  const ver = group.marginPolicyVersion;
  const isNone = source === "NONE";
  const valid =
    finite(pct) &&
    pct >= 0 &&
    ["NONE", "USER_INPUT", "SYSTEM_POLICY"].includes(source) &&
    (isNone ? pct === 0 && id === null && ver === null : nonEmpty(id) && nonEmpty(ver));
  if (!valid) block(d, "DESIGN_MARGIN_INVALID", fieldPath);
  const safe = { designMarginPercent: canonicalNumber(finite(pct) ? pct : 0), marginSource: source, marginPolicyId: id, marginPolicyVersion: ver };
  // Normalize an invalid group to the sanctioned NONE only so downstream projection stays typed.
  return valid
    ? ({ ...safe, marginSource: safe.marginSource as ConfiguratorDesignMarginInput["marginSource"] } as ConfiguratorDesignMarginInput)
    : { designMarginPercent: 0, marginSource: "NONE" as const, marginPolicyId: null, marginPolicyVersion: null };
}

export function resolveMargins(
  design: SystemEngineeringDesignInputs | null | undefined,
  d: Diagnostics,
): DesignMarginPolicyInput {
  const base = design?.designMargins;
  return {
    heatPumpHeating: resolveMarginGroup(base?.heatPumpHeating, "engineeringDesignInputs.designMargins.heatPumpHeating", d),
    heatPumpCooling: resolveMarginGroup(base?.heatPumpCooling, "engineeringDesignInputs.designMargins.heatPumpCooling", d),
    fanCoilHeating: resolveMarginGroup(base?.fanCoilHeating, "engineeringDesignInputs.designMargins.fanCoilHeating", d),
    fanCoilCooling: resolveMarginGroup(base?.fanCoilCooling, "engineeringDesignInputs.designMargins.fanCoilCooling", d),
  };
}

/**
 * Validate the confirmed-system engineeringDesignInputs (hydronic / wet-bulb /
 * fan-speed / margins) against frozen CM10 §16–19. Returns null if any required
 * design leaf is missing/invalid; every independent failure is still recorded.
 */
export function resolveDesignInputs(
  design: SystemEngineeringDesignInputs | null | undefined,
  selectionIntent: ConfiguratorSelectionIntent,
  d: Diagnostics,
): ResolvedDesign | null {
  const hydronic = design?.hydronicDesignConditions;
  const wetBulb = design?.coolingIndoorDesignCondition?.indoorCoolingWetBulbC;
  const fanSpeed = design?.fanCoilSizingPolicy?.sizingFanSpeed;

  const h = "engineeringDesignInputs.hydronicDesignConditions";
  const heatingSupply = resolveNumericLeaf(
    hydronic?.heatingWaterSupplyC as NumericLeafLike | undefined,
    `${h}.heatingWaterSupplyC`,
    selectionIntent,
    d,
  );
  const heatingReturn = resolveNumericLeaf(
    hydronic?.heatingWaterReturnC as NumericLeafLike | undefined,
    `${h}.heatingWaterReturnC`,
    selectionIntent,
    d,
  );
  const coolingSupply = resolveNumericLeaf(
    hydronic?.coolingWaterSupplyC as NumericLeafLike | undefined,
    `${h}.coolingWaterSupplyC`,
    selectionIntent,
    d,
  );
  const coolingReturn = resolveNumericLeaf(
    hydronic?.coolingWaterReturnC as NumericLeafLike | undefined,
    `${h}.coolingWaterReturnC`,
    selectionIntent,
    d,
  );
  const wb = resolveNumericLeaf(
    wetBulb as NumericLeafLike | undefined,
    "engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC",
    selectionIntent,
    d,
  );
  const speed = resolveTextLeaf(
    fanSpeed as TextLeafLike | undefined,
    "engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed",
    selectionIntent,
    d,
  );

  // Seasonal ordering: heating supply > return, cooling supply < return.
  if (heatingSupply && heatingReturn && (heatingSupply.value as number) <= (heatingReturn.value as number)) {
    block(d, "OPERATING_CONDITION_CONFLICT", `${h} seasonal temperature ordering (heating)`);
  }
  if (coolingSupply && coolingReturn && (coolingSupply.value as number) >= (coolingReturn.value as number)) {
    block(d, "OPERATING_CONDITION_CONFLICT", `${h} seasonal temperature ordering (cooling)`);
  }

  if (!heatingSupply || !heatingReturn || !coolingSupply || !coolingReturn || !wb || !speed) return null;

  return {
    heatingWaterSupplyC: heatingSupply,
    heatingWaterReturnC: heatingReturn,
    coolingWaterSupplyC: coolingSupply,
    coolingWaterReturnC: coolingReturn,
    indoorCoolingWetBulbC: wb,
    sizingFanSpeed: speed,
    designMargins: resolveMargins(design, d),
  };
}

/** Normalize absent margin groups to the frozen NONE so two design snapshots compare canonically. */
export function materializeMargins(
  design: SystemEngineeringDesignInputs | null | undefined,
): SystemEngineeringDesignInputs | null {
  if (!design) return null;
  return {
    hydronicDesignConditions: design.hydronicDesignConditions,
    coolingIndoorDesignCondition: design.coolingIndoorDesignCondition,
    fanCoilSizingPolicy: design.fanCoilSizingPolicy,
    designMargins: resolveMargins(design, { blockingReasons: [], warnings: [] }),
  };
}

/**
 * Composite design inputs captured into the immutable load input snapshot must
 * equal the confirmed-system design inputs (§call-gate step 10). Stale design —
 * for example a confirmed water/speed edit not yet propagated into a new load
 * result — blocks.
 */
export function validateCapturedDesignParity(
  systemDesign: SystemEngineeringDesignInputs | null | undefined,
  capturedDesign: SystemEngineeringDesignInputs | null | undefined,
  d: Diagnostics,
): void {
  const a = materializeMargins(systemDesign);
  const b = materializeMargins(capturedDesign);
  if (a === null || b === null) {
    block(d, "OPERATING_CONDITION_REQUIRED", "engineeringDesignInputs vs loadCalculation.inputSnapshot.systemEngineeringDesignInputs");
    return;
  }
  if (!inputDesignEquals(a, b)) {
    block(d, "LOAD_CALCULATION_REVISION_STALE", "engineeringDesignInputs vs loadCalculation.inputSnapshot.systemEngineeringDesignInputs");
  }
}

function inputDesignEquals(a: SystemEngineeringDesignInputs, b: SystemEngineeringDesignInputs): boolean {
  return leafEquals(a.hydronicDesignConditions.heatingWaterSupplyC, b.hydronicDesignConditions.heatingWaterSupplyC)
    && leafEquals(a.hydronicDesignConditions.heatingWaterReturnC, b.hydronicDesignConditions.heatingWaterReturnC)
    && leafEquals(a.hydronicDesignConditions.coolingWaterSupplyC, b.hydronicDesignConditions.coolingWaterSupplyC)
    && leafEquals(a.hydronicDesignConditions.coolingWaterReturnC, b.hydronicDesignConditions.coolingWaterReturnC)
    && leafEquals(a.coolingIndoorDesignCondition.indoorCoolingWetBulbC, b.coolingIndoorDesignCondition.indoorCoolingWetBulbC)
    && leafEquals(a.fanCoilSizingPolicy.sizingFanSpeed, b.fanCoilSizingPolicy.sizingFanSpeed)
    && marginEquals(a.designMargins!.heatPumpHeating, b.designMargins!.heatPumpHeating)
    && marginEquals(a.designMargins!.heatPumpCooling, b.designMargins!.heatPumpCooling)
    && marginEquals(a.designMargins!.fanCoilHeating, b.designMargins!.fanCoilHeating)
    && marginEquals(a.designMargins!.fanCoilCooling, b.designMargins!.fanCoilCooling);
}

function leafEquals(a: unknown, b: unknown): boolean {
  const A = a as { value?: unknown; unit?: unknown; source?: unknown; sourceReference?: unknown; status?: unknown; policyReference?: unknown };
  const B = b as { value?: unknown; unit?: unknown; source?: unknown; sourceReference?: unknown; status?: unknown; policyReference?: unknown };
  return (
    A.value === B.value &&
    A.unit === B.unit &&
    A.source === B.source &&
    A.sourceReference === B.sourceReference &&
    A.status === B.status &&
    policyEquals(A.policyReference, B.policyReference)
  );
}
function policyEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const A = a as { policyId?: unknown; policyVersion?: unknown; entryId?: unknown };
  const B = b as { policyId?: unknown; policyVersion?: unknown; entryId?: unknown };
  return A.policyId === B.policyId && A.policyVersion === B.policyVersion && A.entryId === B.entryId;
}
function marginEquals(a: unknown, b: unknown): boolean {
  const A = a as { designMarginPercent?: unknown; marginSource?: unknown; marginPolicyId?: unknown; marginPolicyVersion?: unknown };
  const B = b as { designMarginPercent?: unknown; marginSource?: unknown; marginPolicyId?: unknown; marginPolicyVersion?: unknown };
  return (
    A.designMarginPercent === B.designMarginPercent &&
    A.marginSource === B.marginSource &&
    A.marginPolicyId === B.marginPolicyId &&
    A.marginPolicyVersion === B.marginPolicyVersion
  );
}

// ---------------------------------------------------------------------------
// Operating conditions projection (CONSENSUS + SHARED_COPY + seasonal + wet-bulb)
// ---------------------------------------------------------------------------
export interface ConsensusFacts {
  indoorHeatingC: number;
  indoorCoolingC: number;
  outdoorHeatingC: number;
  outdoorCoolingC: number;
}

function consensusValue(
  load: AdapterLoadCalculation,
  sortedRoomIds: readonly string[],
  field: "indoorHeatingC" | "indoorCoolingC" | "outdoorHeatingC" | "outdoorCoolingC",
  fieldPath: string,
  d: Diagnostics,
): number | null {
  const roomMap = new Map(load.roomResults.map((r) => [r.roomId, r]));
  let value: number | null = null;
  for (const roomId of sortedRoomIds) {
    const breakdown = roomMap.get(roomId)?.transmissionBreakdown;
    const v = breakdown ? breakdown[field] : null;
    if (!finite(v)) {
      block(d, "OPERATING_CONDITION_REQUIRED", `roomResults.transmissionBreakdown.${field}`, { roomId });
      continue;
    }
    if (value === null) value = v as number;
    else if (value !== v) {
      block(d, "OPERATING_CONDITION_CONFLICT", fieldPath, { roomId });
    }
  }
  return value;
}

export function resolveOperatingConditions(
  load: AdapterLoadCalculation,
  sortedRoomIds: readonly string[],
  design: ResolvedDesign,
  loadRevision: string,
  d: Diagnostics,
): OperatingConditionPolicyInput | null {
  const indoorHeatingC = consensusValue(load, sortedRoomIds, "indoorHeatingC", "operatingConditions.fanCoilHeating.indoor_air_c", d);
  const indoorCoolingC = consensusValue(load, sortedRoomIds, "indoorCoolingC", "operatingConditions.fanCoilCooling.indoorAirDryBulbC", d);
  const outdoorHeatingC = consensusValue(load, sortedRoomIds, "outdoorHeatingC", "operatingConditions.heatPumpHeating.outdoorHeatingDesignC", d);
  const outdoorCoolingC = consensusValue(load, sortedRoomIds, "outdoorCoolingC", "operatingConditions.heatPumpCooling.outdoorCoolingDesignC", d);

  // Wet-bulb coherence: finite WB <= every served room cooling dry bulb.
  const wb = design.indoorCoolingWetBulbC.value as number;
  if (finite(indoorCoolingC) && (wb as number) > (indoorCoolingC as number)) {
    block(d, "OPERATING_CONDITION_CONFLICT", "operatingConditions.fanCoilCooling.indoorAirWetBulbC (wet bulb > cooling dry bulb)");
  }

  if (!finite(indoorHeatingC) || !finite(indoorCoolingC) || !finite(outdoorHeatingC) || !finite(outdoorCoolingC)) {
    return null;
  }

  const context = (loadRevision: string, field: string, rooms: readonly string[]): string =>
    `${loadRevision}; ${rooms.map((r) => `roomResults/${r}/transmissionBreakdown/${field}`).join(",")}`;

  const num = (
    value: number,
    source: "BUILDING_LOAD_CONTEXT" | "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE",
    sourceReference: string,
  ): SourcedNumericOperatingInput => ({ value, unit: "°C", source, sourceReference, status: "RESOLVED" });
  const txt = (
    value: string,
    source: "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE",
    sourceReference: string,
  ): SourcedTextOperatingInput => ({ value, unit: null, source, sourceReference, status: "RESOLVED" });

  const h2o = design.heatingWaterSupplyC;
  const h2r = design.heatingWaterReturnC;
  const c2s = design.coolingWaterSupplyC;
  const c2r = design.coolingWaterReturnC;
  const speed = design.sizingFanSpeed;

  const out: OperatingConditionPolicyInput = {
    heatPumpHeating: {
      outdoorHeatingDesignC: num(outdoorHeatingC, "BUILDING_LOAD_CONTEXT", context(loadRevision, "outdoorHeatingC", sortedRoomIds)),
      waterSupplyC: num(h2o.value as number, h2o.source, h2o.sourceReference),
      waterReturnC: num(h2r.value as number, h2r.source, h2r.sourceReference),
    },
    heatPumpCooling: {
      outdoorCoolingDesignC: num(outdoorCoolingC, "BUILDING_LOAD_CONTEXT", context(loadRevision, "outdoorCoolingC", sortedRoomIds)),
      waterSupplyC: num(c2s.value as number, c2s.source, c2s.sourceReference),
      waterReturnC: num(c2r.value as number, c2r.source, c2r.sourceReference),
    },
    fanCoilHeating: {
      waterInC: num(h2o.value as number, h2o.source, h2o.sourceReference),
      waterOutC: num(h2r.value as number, h2r.source, h2r.sourceReference),
      indoor_air_c: num(indoorHeatingC, "BUILDING_LOAD_CONTEXT", context(loadRevision, "indoorHeatingC", sortedRoomIds)),
      sizingFanSpeed: txt(speed.value as string, speed.source, speed.sourceReference),
    },
    fanCoilCooling: {
      waterInC: num(c2s.value as number, c2s.source, c2s.sourceReference),
      waterOutC: num(c2r.value as number, c2r.source, c2r.sourceReference),
      indoorAirDryBulbC: num(indoorCoolingC, "BUILDING_LOAD_CONTEXT", context(loadRevision, "indoorCoolingC", sortedRoomIds)),
      indoorAirWetBulbC: num(wb, design.indoorCoolingWetBulbC.source, design.indoorCoolingWetBulbC.sourceReference),
      sizingFanSpeed: txt(speed.value as string, speed.source, speed.sourceReference),
    },
  };

  // Seasonal ordering already validated in resolveDesignInputs; HP/FC coupling is shared-copy by construction.
  return out;
}