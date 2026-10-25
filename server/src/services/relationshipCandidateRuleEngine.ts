import type { ProductRelationType, RelationshipConfidence } from './productRelationshipsService.js';

export type RelationshipPriority = 'P1' | 'P2' | 'P3';
export type RelationshipRuleSource = 'manual' | 'taxonomy_rule' | 'import_mapping' | 'calculator_rule' | 'ai_suggested';

export type CandidateProductRole =
  | 'heating_cable'
  | 'heating_mat'
  | 'thermostat'
  | 'universal_thermostat'
  | 'floor_sensor'
  | 'sensor_conduit'
  | 'mounting_tape'
  | 'protection_device'
  | 'hydronic_zone'
  | 'actuator'
  | 'collector'
  | 'pump_mixing_unit'
  | 'fan_coil_unit'
  | 'fan_coil_controller';

export type CandidateProductFamily =
  | 'electric_warm_floor'
  | 'hydronic_warm_floor'
  | 'fan_coil'
  | 'universal_thermostat';

export type CandidateProductFacts = {
  id: number;
  sku?: string;
  name?: string;
  isActive?: boolean;
  family?: CandidateProductFamily;
  role?: CandidateProductRole;
  voltageV?: number;
  powerW?: number;
  loadA?: number;
  maxLoadA?: number;
  mountingType?: string;
  compatibleLoadTypes?: string[];
  sensorTypes?: string[];
  controlSignals?: string[];
  modes?: string[];
};

export type RelationshipCandidate = {
  source_product_id: number;
  target_product_id: number;
  proposed_relation_type: ProductRelationType;
  reason_engineering: string;
  confidence: RelationshipConfidence;
  missing_facts: string[];
  priority: RelationshipPriority;
  rule_source: RelationshipRuleSource;
  conditions_json: Record<string, unknown>;
  manual_review_required: boolean;
};

type CandidateDraft = {
  relationType: ProductRelationType;
  reason: string;
  confidence?: RelationshipConfidence;
  missingFacts?: string[];
  priority?: RelationshipPriority;
  ruleSource?: RelationshipRuleSource;
  conditions?: Record<string, unknown>;
};

const P1_FACTS = new Set(['voltage', 'voltage_match', 'load_capacity', 'sensor_type', 'control_signal', 'control_signal_match']);

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function includes(values: string[] | undefined, value: string) {
  return Array.isArray(values) && values.includes(value);
}

function hasAny(values: string[] | undefined, expected: string[]) {
  return Array.isArray(values) && expected.some((value) => values.includes(value));
}

function compatibleVoltage(source: CandidateProductFacts, target: CandidateProductFacts) {
  if (!source.voltageV || !target.voltageV) return null;
  return Number(source.voltageV) === Number(target.voltageV);
}

function targetCanCarrySourceLoad(source: CandidateProductFacts, target: CandidateProductFacts) {
  const sourceLoad = source.loadA || (source.powerW && source.voltageV ? Number((source.powerW / source.voltageV).toFixed(2)) : undefined);
  if (!sourceLoad || !target.maxLoadA) return null;
  return Number(target.maxLoadA) >= Number(sourceLoad);
}

function hasRequiredControl(source: CandidateProductFacts, target: CandidateProductFacts, required: string[]) {
  const sourceSignals = source.controlSignals || [];
  const targetSignals = target.controlSignals || [];
  const signals = required.length ? required : sourceSignals;
  if (!signals.length || !targetSignals.length) return null;
  return signals.every((signal) => targetSignals.includes(signal));
}

function technicalMissingFactsForElectricalControl(source: CandidateProductFacts, target: CandidateProductFacts) {
  const missing: string[] = [];
  if (!source.voltageV || !target.voltageV) missing.push('voltage');
  if (!source.loadA && !source.powerW) missing.push('load_current_or_power');
  if (!target.maxLoadA) missing.push('target_load_capacity');
  if (!includes(target.sensorTypes, 'floor_sensor')) missing.push('sensor_type');
  if (!hasAny(target.controlSignals, ['relay', 'on_off'])) missing.push('control_signal');
  return missing;
}

function addCandidate(source: CandidateProductFacts, target: CandidateProductFacts, draft: CandidateDraft, out: RelationshipCandidate[]) {
  if (!Number.isInteger(source.id) || !Number.isInteger(target.id)) return;
  if (source.id === target.id) return;
  if (target.isActive === false) return;

  const missingFacts = uniq(draft.missingFacts || []);
  const hasP1Fact = missingFacts.some((fact) => P1_FACTS.has(fact)) || draft.relationType === 'incompatible';
  const priority = draft.priority || (hasP1Fact ? 'P1' : 'P2');
  const confidence = draft.confidence || (missingFacts.length ? 'low' : 'medium');

  out.push({
    source_product_id: source.id,
    target_product_id: target.id,
    proposed_relation_type: draft.relationType,
    reason_engineering: draft.reason,
    confidence,
    missing_facts: missingFacts,
    priority,
    rule_source: draft.ruleSource || 'calculator_rule',
    conditions_json: {
      source_family: source.family || null,
      source_role: source.role || null,
      target_family: target.family || null,
      target_role: target.role || null,
      ...(draft.conditions || {}),
    },
    manual_review_required: true,
  });
}

function generateUniversalThermostatCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[], out: RelationshipCandidate[]) {
  if (source.family !== 'universal_thermostat' && source.role !== 'universal_thermostat' && source.sku !== 'BT11') return;
  for (const target of targets) {
    addCandidate(source, target, {
      relationType: 'recommended',
      reason: 'Universal thermostat application is only a candidate because sensor, load and control compatibility must be verified before publication.',
      confidence: 'low',
      priority: 'P1',
      ruleSource: 'ai_suggested',
      missingFacts: ['sensor_type', 'load_current_or_power', 'control_signal', 'voltage'],
      conditions: { auto_approval_allowed: false, universal_thermostat_review: true },
    }, out);
  }
}

function generateElectricWarmFloorCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[], out: RelationshipCandidate[]) {
  if (source.family !== 'electric_warm_floor' || !['heating_cable', 'heating_mat'].includes(String(source.role))) return;

  for (const target of targets) {
    if (target.family && target.family !== 'electric_warm_floor') continue;

    if (target.role === 'thermostat' || target.role === 'universal_thermostat') {
      const missing = technicalMissingFactsForElectricalControl(source, target);
      const voltageOk = compatibleVoltage(source, target);
      const loadOk = targetCanCarrySourceLoad(source, target);
      if (voltageOk === false) missing.push('voltage_match');
      if (loadOk === false) missing.push('load_capacity');

      addCandidate(source, target, {
        relationType: voltageOk === false || loadOk === false ? 'incompatible' : 'required',
        reason: voltageOk === false || loadOk === false
          ? 'Thermostat candidate must not be paired with this electric warm floor load because voltage or load capacity does not match verified requirements.'
          : 'Electric warm floor heating cable or mat requires a compatible thermostat with floor sensor input and sufficient switching capacity.',
        confidence: missing.length ? 'low' : 'medium',
        priority: missing.length ? 'P1' : 'P2',
        missingFacts: missing,
        conditions: {
          required_load_a: source.loadA || null,
          source_power_w: source.powerW || null,
          source_voltage_v: source.voltageV || null,
          target_voltage_v: target.voltageV || null,
          target_max_load_a: target.maxLoadA || null,
        },
      }, out);
    }

    if (target.role === 'floor_sensor') {
      addCandidate(source, target, {
        relationType: 'required',
        reason: 'Electric warm floor control requires a floor sensor candidate so the thermostat can limit floor temperature safely.',
        confidence: includes(target.sensorTypes, 'floor_sensor') ? 'medium' : 'low',
        missingFacts: includes(target.sensorTypes, 'floor_sensor') ? [] : ['sensor_type'],
        priority: includes(target.sensorTypes, 'floor_sensor') ? 'P2' : 'P1',
      }, out);
    }

    if (target.role === 'sensor_conduit') {
      addCandidate(source, target, {
        relationType: 'recommended',
        reason: 'Sensor conduit is recommended so the warm floor sensor can be installed and replaced without breaking the floor finish.',
        confidence: 'medium',
        priority: 'P3',
      }, out);
    }

    if (target.role === 'mounting_tape' && source.role === 'heating_cable') {
      addCandidate(source, target, {
        relationType: 'recommended',
        reason: 'Heating cable installation normally needs mounting tape to keep cable spacing and layout stable during screed installation.',
        confidence: target.mountingType && source.mountingType && target.mountingType !== source.mountingType ? 'low' : 'medium',
        missingFacts: target.mountingType && source.mountingType && target.mountingType !== source.mountingType ? ['mounting_type_match'] : [],
        priority: 'P3',
      }, out);
    }

    if (target.role === 'protection_device') {
      const missing: string[] = [];
      const voltageOk = compatibleVoltage(source, target);
      const loadOk = targetCanCarrySourceLoad(source, target);
      if (!source.voltageV || !target.voltageV) missing.push('voltage');
      if (!source.loadA && !source.powerW) missing.push('load_current_or_power');
      if (!target.maxLoadA) missing.push('target_load_capacity');
      if (voltageOk === false) missing.push('voltage_match');
      if (loadOk === false) missing.push('load_capacity');
      addCandidate(source, target, {
        relationType: voltageOk === false || loadOk === false ? 'incompatible' : 'recommended',
        reason: 'Dedicated protection device is recommended for an electric warm floor circuit when voltage and current ratings match the load.',
        confidence: missing.length ? 'low' : 'medium',
        missingFacts: missing,
        priority: missing.length ? 'P1' : 'P2',
      }, out);
    }
  }
}

function generateHydronicWarmFloorCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[], out: RelationshipCandidate[]) {
  if (source.family !== 'hydronic_warm_floor') return;
  for (const target of targets) {
    if (target.family && target.family !== 'hydronic_warm_floor') continue;

    if (target.role === 'thermostat' || target.role === 'actuator') {
      const missing: string[] = [];
      const voltageOk = compatibleVoltage(source, target);
      const controlOk = hasRequiredControl(source, target, ['on_off']);
      if (!source.voltageV || !target.voltageV) missing.push('voltage');
      if (voltageOk === false) missing.push('voltage_match');
      if (controlOk === null) missing.push('control_signal');
      if (controlOk === false) missing.push('control_signal_match');
      addCandidate(source, target, {
        relationType: voltageOk === false || controlOk === false ? 'incompatible' : target.role === 'actuator' ? 'required' : 'recommended',
        reason: target.role === 'actuator'
          ? 'Hydronic warm floor control requires compatible valve actuators for collector zone opening and closing.'
          : 'Hydronic warm floor zones normally use a room thermostat matched to actuator voltage and control signal.',
        confidence: missing.length ? 'low' : 'medium',
        missingFacts: missing,
        priority: missing.length ? 'P1' : 'P2',
      }, out);
    }

    if (target.role === 'collector') {
      addCandidate(source, target, {
        relationType: 'required',
        reason: 'Hydronic warm floor loops require a collector/manifold to distribute water circuits and connect actuators or flow controls.',
        confidence: 'medium',
        priority: 'P2',
      }, out);
    }

    if (target.role === 'pump_mixing_unit') {
      addCandidate(source, target, {
        relationType: 'recommended',
        reason: 'Pump or mixing unit is recommended when warm floor water temperature and circulation need controlled hydronic distribution.',
        confidence: 'medium',
        priority: 'P2',
      }, out);
    }
  }
}

function generateFanCoilCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[], out: RelationshipCandidate[]) {
  if (source.family !== 'fan_coil' || source.role !== 'fan_coil_unit') return;
  for (const target of targets) {
    if (target.family && target.family !== 'fan_coil') continue;
    if (target.role !== 'fan_coil_controller') continue;
    const missing: string[] = [];
    const voltageOk = compatibleVoltage(source, target);
    const controlOk = hasRequiredControl(source, target, ['three_speed_fan', 'valve_on_off']);
    if (!source.voltageV || !target.voltageV) missing.push('voltage');
    if (voltageOk === false) missing.push('voltage_match');
    if (controlOk === null) missing.push('control_signal');
    if (controlOk === false) missing.push('control_signal_match');
    if (!hasAny(target.modes, ['heating']) || !hasAny(target.modes, ['cooling'])) missing.push('heating_cooling_mode');
    if (!hasAny(target.sensorTypes, ['air_sensor', 'room_sensor'])) missing.push('sensor_type');
    addCandidate(source, target, {
      relationType: voltageOk === false || controlOk === false ? 'incompatible' : 'recommended',
      reason: 'Fan-coil unit should use a compatible controller with fan speed outputs, valve output and matching heating/cooling control mode.',
      confidence: missing.length ? 'low' : 'medium',
      missingFacts: missing,
      priority: missing.length ? 'P1' : 'P2',
      conditions: { required_outputs: ['three_speed_fan', 'valve_on_off'] },
    }, out);
  }
}

function generateAlternativeCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[], out: RelationshipCandidate[]) {
  if (!source.family || !source.role) return;
  for (const target of targets) {
    if (target.family !== source.family || target.role !== source.role) continue;
    if (target.role === 'heating_cable' || target.role === 'heating_mat') continue;
    const voltageOk = compatibleVoltage(source, target);
    const loadOk = targetCanCarrySourceLoad(source, target);
    const missing: string[] = [];
    if (voltageOk === false) missing.push('voltage_match');
    if (loadOk === false) missing.push('load_capacity');
    addCandidate(source, target, {
      relationType: missing.length ? 'incompatible' : 'alternative',
      reason: missing.length
        ? 'Products with the same role cannot be treated as alternatives when voltage or load compatibility conflicts.'
        : 'Products share the same engineering role and family, so this is a replacement candidate rather than an accessory.',
      confidence: missing.length ? 'low' : 'medium',
      missingFacts: missing,
      priority: missing.length ? 'P1' : 'P2',
    }, out);
  }
}

export function generateRelationshipCandidates(source: CandidateProductFacts, targets: CandidateProductFacts[]): RelationshipCandidate[] {
  const out: RelationshipCandidate[] = [];
  if (!source || source.isActive === false) return out;

  generateUniversalThermostatCandidates(source, targets, out);
  generateElectricWarmFloorCandidates(source, targets, out);
  generateHydronicWarmFloorCandidates(source, targets, out);
  generateFanCoilCandidates(source, targets, out);
  generateAlternativeCandidates(source, targets, out);

  const unique = new Map<string, RelationshipCandidate>();
  for (const candidate of out) {
    const key = `${candidate.source_product_id}:${candidate.target_product_id}:${candidate.proposed_relation_type}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return Array.from(unique.values());
}

export function getAccessoryCandidatesForUpsell(candidates: RelationshipCandidate[]) {
  return candidates.filter((candidate) => ['required', 'recommended', 'optional'].includes(candidate.proposed_relation_type));
}

export function getCompatibilityWarningCandidates(candidates: RelationshipCandidate[]) {
  return candidates.filter((candidate) => candidate.proposed_relation_type === 'incompatible');
}
