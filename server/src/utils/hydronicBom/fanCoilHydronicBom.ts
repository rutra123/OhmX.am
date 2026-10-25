/**
 * Fan-coil hydronic BOM resolver (contract ohmx.fan-coil-hydronic-bom-contract.v1).
 * Pure and deterministic. Never selects primary equipment, never uses AI, and only
 * follows APPROVED relationships (default deny). Quantities come from the existing
 * Building Project hydronic requirements layer; this module only resolves SKUs.
 */
import type { HydronicSystemRequirements } from '../buildingProjectTypes.js';

export type BomLineStatus =
  | 'RESOLVED'
  | 'PENDING_DESIGN'
  | 'NOT_REQUIRED'
  | 'UNRESOLVED_NO_APPROVED_RELATIONSHIP'
  | 'UNRESOLVED_CATALOG_GAP'
  | 'BLOCKED_CONFLICT';

export type ComponentRole =
  | 'CONTROL_VALVE'
  | 'ACTUATOR'
  | 'ACTUATOR_CABLE'
  | 'VALVE_ADAPTER'
  | 'ISOLATION_VALVE'
  | 'BALANCING_VALVE'
  | 'MANIFOLD'
  | 'ROOM_CONTROL'
  | 'CONTROL_MASTER'
  | 'ACCESSORY'
  | 'OTHER';

export type RelationType = 'required' | 'recommended' | 'optional' | 'alternative' | 'incompatible';
export type ReviewStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';

export interface CatalogComponent {
  productId: number;
  sku: string;
  role: ComponentRole;
  active: boolean;
  ways?: 2 | 3 | 4;
  kvs?: number;
  dn?: number;
  pressureIndependent?: boolean;
  supply?: '24V' | '230V';
  cableIncluded?: boolean;
  cableLengthM?: number;
  ports?: number;
  /** True for remote boards (e.g. Riello SLAVE) that are useless without a shared master panel. */
  needsMasterControl?: boolean;
  /** Actuator/valve control characteristic when known (Danfoss recommends LOG for fan-coil water-to-air duty). */
  characteristic?: 'LOG' | 'LIN';
}

export interface ProductRelationship {
  id: number;
  sourceProductId: number;
  targetProductId: number;
  relationType: RelationType;
  reviewStatus: ReviewStatus;
  evidenceDocumentIds: readonly string[];
  choiceGroup?: string;
  /** Free-text accessory the manufacturer requires for this pairing (e.g. stem extension plug). */
  requiresAccessory?: string;
  /** For a 'required' source->master link: how many sources one target can serve (e.g. 30 SLAVE boards per MASTER panel). */
  maxSourcesPerTarget?: number;
  /** Units of the target needed per unit of the source (default 1). */
  quantityPerSource?: number;
  /** Manufacturer condition under which the companion is needed (free text). */
  requiredWhen?: string;
}

export type FanCoilBomRequirements = Pick<
  HydronicSystemRequirements,
  | 'fanCoilCount'
  | 'fanCoilCircuitKind'
  | 'fanCoilValveSetsRequired'
  | 'actuatorCountRequired'
  | 'fanCoilDistribution'
  | 'fanCoilManifoldRequired'
  | 'fanCoilManifoldPortsRequired'
  | 'mixingUnitStatus'
  | 'circulationPumpStatus'
>;

export interface FanCoilBomInput {
  requirements: FanCoilBomRequirements;
  /** Selected primary FAN_COIL products and how many units of each. */
  fanCoilUnits: ReadonlyArray<{ productId: number; count: number }>;
  /** Kv required per control valve from design flow and allowable pressure drop; null = not designed yet. */
  requiredKv: number | null;
  actuatorSupply?: '24V' | '230V';
  /** Preference only (never a filter): ranks actuators with this characteristic first. */
  preferredCharacteristic?: 'LOG' | 'LIN';
  /** fan-coil product id -> chosen room-control product id (a design decision when several approved options exist). */
  roomControlChoice?: Readonly<Record<number, number>>;
  cableLengthM?: number;
  catalog: readonly CatalogComponent[];
  relationships: readonly ProductRelationship[];
}

export interface BomLine {
  slot: string;
  requirement: 'required' | 'recommended' | 'optional';
  quantity: number | null;
  unit: 'pcs';
  status: BomLineStatus;
  productId: number | null;
  sku: string | null;
  relationshipId: number | null;
  evidenceDocumentIds: string[];
  reason: string;
}

export interface FanCoilBomResult {
  contractId: 'ohmx.fan-coil-hydronic-bom-contract.v1';
  complete: boolean;
  blockingSlots: string[];
  lines: BomLine[];
}

const RANK: Record<string, number> = { required: 0, recommended: 1, optional: 2 };

function line(
  slot: string,
  requirement: BomLine['requirement'],
  quantity: number | null,
  status: BomLineStatus,
  reason: string,
  pick?: { component: CatalogComponent; relationship?: ProductRelationship },
): BomLine {
  return {
    slot,
    requirement,
    quantity,
    unit: 'pcs',
    status,
    productId: pick?.component.productId ?? null,
    sku: pick?.component.sku ?? null,
    relationshipId: pick?.relationship?.id ?? null,
    evidenceDocumentIds: [...(pick?.relationship?.evidenceDocumentIds ?? [])].sort(),
    reason,
  };
}

function approved(relationships: readonly ProductRelationship[], sourceId: number): ProductRelationship[] {
  return relationships.filter((r) => r.sourceProductId === sourceId && r.reviewStatus === 'approved');
}

/** Approved, active targets of a given role, minus anything with an approved 'incompatible' link. */
function acceptedTargets(
  sourceId: number,
  role: ComponentRole,
  input: FanCoilBomInput,
  allowed: readonly RelationType[],
): Array<{ component: CatalogComponent; relationship: ProductRelationship }> {
  const rels = approved(input.relationships, sourceId);
  const blocked = new Set(rels.filter((r) => r.relationType === 'incompatible').map((r) => r.targetProductId));
  const byId = new Map(input.catalog.map((c) => [c.productId, c] as const));
  const out: Array<{ component: CatalogComponent; relationship: ProductRelationship }> = [];
  for (const r of rels) {
    if (!allowed.includes(r.relationType) || blocked.has(r.targetProductId)) continue;
    const c = byId.get(r.targetProductId);
    if (!c || !c.active || c.role !== role) continue;
    out.push({ component: c, relationship: r });
  }
  return out.sort((a, b) =>
    (RANK[a.relationship.relationType] ?? 9) - (RANK[b.relationship.relationType] ?? 9)
    || a.component.productId - b.component.productId);
}

export function resolveFanCoilHydronicBom(input: FanCoilBomInput): FanCoilBomResult {
  const req = input.requirements;
  const lines: BomLine[] = [];
  const result = (): FanCoilBomResult => {
    const blocking = lines
      .filter((l) => l.requirement === 'required' && l.status !== 'RESOLVED' && l.status !== 'NOT_REQUIRED')
      .map((l) => l.slot);
    return { contractId: 'ohmx.fan-coil-hydronic-bom-contract.v1', complete: blocking.length === 0, blockingSlots: blocking, lines };
  };
  if (req.fanCoilCount === 0) return result();

  const unitSum = input.fanCoilUnits.reduce((s, u) => s + u.count, 0);
  if (unitSum !== req.fanCoilCount) {
    lines.push(line('FAN_COIL_UNITS', 'required', req.fanCoilCount, 'BLOCKED_CONFLICT',
      `selected primary units (${unitSum}) do not match fanCoilCount (${req.fanCoilCount})`));
    return result();
  }

  // 1. control valve sets (duty-based)
  const valveQty = req.fanCoilValveSetsRequired;
  let valve: CatalogComponent | null = null;
  if (input.requiredKv == null) {
    lines.push(line('CONTROL_VALVE_SET', 'required', valveQty, 'PENDING_DESIGN', 'required Kv is not designed yet (design flow / allowable pressure drop missing)'));
  } else {
    const candidates = input.catalog
      .filter((c) => c.active && c.role === 'CONTROL_VALVE' && (c.ways === 2 || c.ways === 3) && c.kvs != null && c.kvs >= (input.requiredKv as number))
      .sort((a, b) => (a.kvs as number) - (b.kvs as number) || (a.dn ?? 0) - (b.dn ?? 0) || a.productId - b.productId);
    if (candidates.length === 0) {
      lines.push(line('CONTROL_VALVE_SET', 'required', valveQty, 'UNRESOLVED_CATALOG_GAP', `no active 2/3-way control valve with Kvs >= ${input.requiredKv}`));
    } else {
      valve = candidates[0];
      lines.push(line('CONTROL_VALVE_SET', 'required', valveQty, 'RESOLVED', `smallest sufficient Kvs ${valve.kvs} (DN ${valve.dn ?? 'n/a'})`, { component: valve }));
    }
  }

  // 2. actuator via approved valve->actuator relationships only
  const actQty = req.actuatorCountRequired;
  let actuator: CatalogComponent | null = null;
  if (!valve) {
    lines.push(line('ACTUATOR', 'required', actQty, 'PENDING_DESIGN', 'control valve is not selected'));
  } else {
    const accepted = acceptedTargets(valve.productId, 'ACTUATOR', input, ['required', 'recommended', 'optional'])
      .filter((t) => input.actuatorSupply == null || t.component.supply == null || t.component.supply === input.actuatorSupply)
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const pa = input.preferredCharacteristic && a.t.component.characteristic === input.preferredCharacteristic ? 0 : 1;
        const pb = input.preferredCharacteristic && b.t.component.characteristic === input.preferredCharacteristic ? 0 : 1;
        return pa - pb || a.i - b.i;
      })
      .map((x) => x.t);
    if (accepted.length === 0) {
      lines.push(line('ACTUATOR', 'required', actQty, 'UNRESOLVED_NO_APPROVED_RELATIONSHIP', `no approved relationship from valve ${valve.sku} to an active actuator`));
    } else {
      actuator = accepted[0].component;
      lines.push(line('ACTUATOR', 'required', actQty, 'RESOLVED', `approved ${accepted[0].relationship.relationType} relationship`, accepted[0]));
      const needed = accepted[0].relationship.requiresAccessory;
      if (needed) {
        const adapters = [
          ...acceptedTargets(valve.productId, 'VALVE_ADAPTER', input, ['required']),
          ...acceptedTargets(actuator.productId, 'VALVE_ADAPTER', input, ['required']),
        ];
        if (adapters.length === 0) {
          lines.push(line('VALVE_ADAPTER', 'required', actQty, 'UNRESOLVED_CATALOG_GAP', `manufacturer requires: ${needed}; no approved adapter product for this pairing`));
        } else {
          lines.push(line('VALVE_ADAPTER', 'required', actQty, 'RESOLVED', `required accessory: ${needed}`, adapters[0]));
        }
      }
    }
  }

  // 3. actuator cable: each required item is one line; members of one choice group are alternatives (exactly one)
  if (!actuator) {
    lines.push(line('ACTUATOR_CABLE', 'required', actQty, 'PENDING_DESIGN', 'actuator is not selected'));
  } else if (actuator.cableIncluded === true) {
    lines.push(line('ACTUATOR_CABLE', 'required', 0, 'NOT_REQUIRED', 'cable is supplied with the actuator'));
  } else {
    const cables = acceptedTargets(actuator.productId, 'ACTUATOR_CABLE', input, ['required']);
    if (cables.length === 0) {
      lines.push(line('ACTUATOR_CABLE', 'required', actQty, 'UNRESOLVED_NO_APPROVED_RELATIONSHIP', `cable supply for actuator ${actuator.sku} is not documented by an approved relationship`));
    } else {
      const groups = new Map<string, typeof cables>();
      for (const c of cables) {
        const key = c.relationship.choiceGroup ? `group:${c.relationship.choiceGroup}` : `single:${c.component.productId}`;
        groups.set(key, [...(groups.get(key) ?? []), c]);
      }
      for (const key of [...groups.keys()].sort()) {
        const members = groups.get(key) as typeof cables;
        if (!key.startsWith('group:')) {
          lines.push(line('ACTUATOR_CABLE', 'required', actQty, 'RESOLVED', 'approved required cable', members[0]));
          continue;
        }
        const wanted = input.cableLengthM == null ? undefined : members.find((m) => m.component.cableLengthM === input.cableLengthM);
        if (wanted) lines.push(line('ACTUATOR_CABLE', 'required', actQty, 'RESOLVED', `one of ${members.length} alternatives (${key.slice(6)}): ${input.cableLengthM} m`, wanted));
        else lines.push(line('ACTUATOR_CABLE', 'required', actQty, 'PENDING_DESIGN', `exactly one of ${members.length} alternatives (${key.slice(6)}); length is a site decision`));
      }
    }
  }

  // 4. isolation valves (recommended): 2 per valve set
  if (valve) {
    const iso = input.catalog
      .filter((c) => c.active && c.role === 'ISOLATION_VALVE' && (c.dn ?? 0) >= (valve?.dn ?? 0))
      .sort((a, b) => (a.dn ?? 0) - (b.dn ?? 0) || a.productId - b.productId);
    if (iso.length === 0) lines.push(line('ISOLATION_VALVES', 'recommended', valveQty * 2, 'UNRESOLVED_CATALOG_GAP', `no active isolation valve with DN >= ${valve.dn ?? 'n/a'}`));
    else lines.push(line('ISOLATION_VALVES', 'recommended', valveQty * 2, 'RESOLVED', 'smallest sufficient DN', { component: iso[0] }));
  } else {
    lines.push(line('ISOLATION_VALVES', 'recommended', valveQty * 2, 'PENDING_DESIGN', 'control valve is not selected'));
  }

  // 5. balancing
  if (valve?.pressureIndependent === true) lines.push(line('BALANCING', 'recommended', 0, 'NOT_REQUIRED', 'pressure-independent control valve'));
  else lines.push(line('BALANCING', 'recommended', req.fanCoilCount, 'PENDING_DESIGN', 'balancing method depends on the hydraulic design'));

  // 6. manifold
  if (req.fanCoilDistribution === 'branch_riser') lines.push(line('MANIFOLD', 'recommended', 0, 'NOT_REQUIRED', 'branch/riser distribution'));
  else if (!req.fanCoilManifoldRequired) lines.push(line('MANIFOLD', 'recommended', 0, 'PENDING_DESIGN', 'distribution topology not decided'));
  else {
    const need = req.fanCoilManifoldPortsRequired;
    const m = input.catalog
      .filter((c) => c.active && c.role === 'MANIFOLD' && (c.ports ?? 0) >= need)
      .sort((a, b) => (a.ports ?? 0) - (b.ports ?? 0) || a.productId - b.productId);
    if (m.length === 0) lines.push(line('MANIFOLD', 'required', 1, 'UNRESOLVED_CATALOG_GAP', `no active manifold with >= ${need} ports`));
    else lines.push(line('MANIFOLD', 'required', 1, 'RESOLVED', `smallest manifold with >= ${need} ports`, { component: m[0] }));
  }

  // 7. room control (vendor specific, approved relationships only) + shared master panels
  const units = [...input.fanCoilUnits].sort((a, b) => a.productId - b.productId);
  const chosenControls = new Map<number, { component: CatalogComponent; units: number }>();
  for (const u of units) {
    const accepted = acceptedTargets(u.productId, 'ROOM_CONTROL', input, ['required', 'recommended', 'optional']);
    if (accepted.length === 0) {
      lines.push(line('ROOM_CONTROL', 'recommended', u.count, 'UNRESOLVED_NO_APPROVED_RELATIONSHIP', `no approved room-control relationship for fan coil ${u.productId}`));
      continue;
    }
    const wantedId = input.roomControlChoice?.[u.productId];
    const picked = wantedId != null ? accepted.find((a) => a.component.productId === wantedId) : accepted.length === 1 ? accepted[0] : undefined;
    if (!picked) {
      lines.push(line('ROOM_CONTROL', 'recommended', u.count, 'PENDING_DESIGN',
        wantedId != null
          ? `chosen control ${wantedId} has no approved relationship to fan coil ${u.productId}`
          : `${accepted.length} approved control options; the control concept is a design decision`));
      continue;
    }
    lines.push(line('ROOM_CONTROL', 'recommended', u.count, 'RESOLVED', `approved ${picked.relationship.relationType} relationship`, picked));
    const prev = chosenControls.get(picked.component.productId);
    chosenControls.set(picked.component.productId, { component: picked.component, units: (prev?.units ?? 0) + u.count });
  }
  for (const id of [...chosenControls.keys()].sort((a, b) => a - b)) {
    const { component, units: n } = chosenControls.get(id) as { component: CatalogComponent; units: number };
    const masters = acceptedTargets(component.productId, 'CONTROL_MASTER', input, ['required']);
    if (masters.length === 0) {
      if (component.needsMasterControl === true) {
        lines.push(line('CONTROL_MASTER', 'required', null, 'UNRESOLVED_NO_APPROVED_RELATIONSHIP', `remote board ${component.sku} needs a master panel but no approved relationship to one exists`));
      }
      continue;
    }
    const max = masters[0].relationship.maxSourcesPerTarget;
    if (max == null || !Number.isInteger(max) || max < 1) {
      lines.push(line('CONTROL_MASTER', 'required', null, 'PENDING_DESIGN', `units per master panel is not documented for ${component.sku}`, masters[0]));
    } else {
      const qty = Math.ceil(n / max);
      lines.push(line('CONTROL_MASTER', 'required', qty, 'RESOLVED', `ceil(${n} x ${component.sku} / ${max} per master) = ${qty}`, masters[0]));
    }
  }

  // 7b. accessories: approved companions of each selected fan coil (optional ones never block completeness)
  for (const u of units) {
    const accepted = acceptedTargets(u.productId, 'ACCESSORY', input, ['required', 'recommended', 'optional']);
    for (const a of accepted) {
      const req: BomLine['requirement'] = a.relationship.relationType === 'required' ? 'required' : a.relationship.relationType === 'recommended' ? 'recommended' : 'optional';
      const per = a.relationship.quantityPerSource ?? 1;
      const cond = a.relationship.requiredWhen ? `; condition: ${a.relationship.requiredWhen}` : '';
      lines.push(line('ACCESSORIES', req, u.count * per, 'RESOLVED', `approved ${a.relationship.relationType} accessory of fan coil ${u.productId}${cond}`, a));
    }
    const byId = new Map(input.catalog.map((c) => [c.productId, c] as const));
    for (const r of approved(input.relationships, u.productId)) {
      if (r.relationType !== 'required') continue;
      const c = byId.get(r.targetProductId);
      if (!c || !c.active) {
        lines.push(line('ACCESSORIES', 'required', u.count * (r.quantityPerSource ?? 1), 'UNRESOLVED_CATALOG_GAP', `required companion ${r.targetProductId} of fan coil ${u.productId} is not an active catalog product`));
      }
    }
  }

  // 8. pump / mixing
  const pm = req.circulationPumpStatus === 'not_required' && req.mixingUnitStatus === 'not_required';
  lines.push(line('PUMP_MIXING', 'recommended', null, pm ? 'NOT_REQUIRED' : 'PENDING_DESIGN', pm ? 'not required' : 'supply temperature / source topology not decided'));

  return result();
}

/** Adapter from a product_relationships row (conditions_json carries evidence and choice_group). */
export function relationshipFromRow(row: {
  id: number;
  source_product_id: number;
  target_product_id: number;
  relation_type: RelationType;
  review_status: ReviewStatus;
  conditions_json: string | null;
}): ProductRelationship {
  let evidence: string[] = [];
  let choiceGroup: string | undefined;
  let requiresAccessory: string | undefined;
  let maxSourcesPerTarget: number | undefined;
  let quantityPerSource: number | undefined;
  let requiredWhen: string | undefined;
  if (row.conditions_json) {
    try {
      const c = JSON.parse(row.conditions_json) as {
        evidence?: Array<{ document_id?: string }>; choice_group?: string; requires_accessory?: string;
        max_slaves_per_master?: number; max_sources_per_target?: number; quantity_per_source?: number; required_when?: string;
      };
      evidence = (c.evidence ?? []).map((e) => e.document_id ?? '').filter((x) => x !== '');
      choiceGroup = typeof c.choice_group === 'string' ? c.choice_group : undefined;
      requiresAccessory = typeof c.requires_accessory === 'string' ? c.requires_accessory : undefined;
      const mx = c.max_sources_per_target ?? c.max_slaves_per_master;
      maxSourcesPerTarget = typeof mx === 'number' && Number.isInteger(mx) && mx >= 1 ? mx : undefined;
      quantityPerSource = typeof c.quantity_per_source === 'number' && Number.isInteger(c.quantity_per_source) && c.quantity_per_source >= 1 ? c.quantity_per_source : undefined;
      requiredWhen = typeof c.required_when === 'string' ? c.required_when : undefined;
    } catch {
      evidence = [];
    }
  }
  return {
    id: row.id,
    sourceProductId: row.source_product_id,
    targetProductId: row.target_product_id,
    relationType: row.relation_type,
    reviewStatus: row.review_status,
    evidenceDocumentIds: evidence,
    ...(choiceGroup ? { choiceGroup } : {}),
    ...(requiresAccessory ? { requiresAccessory } : {}),
    ...(maxSourcesPerTarget ? { maxSourcesPerTarget } : {}),
    ...(quantityPerSource ? { quantityPerSource } : {}),
    ...(requiredWhen ? { requiredWhen } : {}),
  };
}
