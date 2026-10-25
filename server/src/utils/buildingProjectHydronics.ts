/**
 * Building Project Phase 2.5 / 2.8 — Hydronic System Completeness (requirements layer).
 *
 * Deterministic derivation of what a hydronic system NEEDS, without any Phase 3
 * engineering (no heat loss, kW/BTU, flow, head, pipe/loop sizing, no SKU matching).
 *
 * Phase 2.8 honesty:
 * - Pure DX/electric projects do not emit pump-group / hydraulic-separation pending items.
 * - Fan-coil manifold is not automatically required; distribution stays pending_design.
 * - 4-pipe heating and cooling circuits are modeled separately.
 * - Mixing unit / dedicated circulation pump are pending_design without supply-temp topology.
 * - Towel radiators are a recommendation by default, not an automatic requirement.
 * - floorHeatingCircuitCount is never 'known' without a numeric count.
 */
import type {
  BuildingProject,
  EngineeringRoomAssignment,
  EngineeringSystemConfiguration,
  FanCoilCircuitRequirements,
  FanCoilDistributionKind,
  FloorHeatingCircuitCount,
  FloorHydronicRequirements,
  HydronicSystemRequirements,
  ServicePreference,
} from './buildingProjectTypes.js';

/**
 * Water-based (hydronic) room terminals. These require hydraulic piping and are
 * the basis for manifold / valve / actuator / towel-radiator requirements.
 */
export const HYDRONIC_TERMINAL_FAMILY_IDS: ReadonlySet<string> = new Set([
  'hydronic_floor_heating',
  'aluminum_radiators',
  'bimetal_radiators',
  'steel_panel_radiators',
  'fan_coils',
  'infloor_convectors',
]);

/**
 * Electric room-local heating terminals. A bathroom heated ONLY by these does not
 * get a water towel radiator.
 */
export const ELECTRIC_TERMINAL_FAMILY_IDS: ReadonlySet<string> = new Set([
  'electric_convector',
  'heating_cable',
  'heating_mat',
  'electric_underfloor_heating',
]);

/** Families that are hydronic fan-coil terminals (one physical unit per room). */
export const HYDRONIC_FAN_COIL_FAMILY_IDS: ReadonlySet<string> = new Set(['fan_coils']);

/**
 * Room purpose that can receive a water towel radiator recommendation when
 * hydronic heating exists. Phase 2.7: bathroom AND shower. WC/toilet (`wc`)
 * is deliberately excluded.
 */
export const TOWEL_RADIATOR_ROOM_PURPOSES: ReadonlySet<string> = new Set(['bathroom', 'shower']);

/**
 * A fan-coil home-run manifold is required only after distribution topology is
 * explicitly home-run. pending_design and branch/riser must not invent a manifold.
 */
export function isFanCoilManifoldRequired(
  distribution: FanCoilDistributionKind,
  fanCoilCount: number,
): boolean {
  return fanCoilCount > 0 && distribution === 'home_run_manifold';
}

export function roomHasHydronicHeating(assignment: EngineeringRoomAssignment): boolean {
  return assignment.heatingSystems.some((item) => HYDRONIC_TERMINAL_FAMILY_IDS.has(item.familyId));
}

function roomHasHydronicFanCoil(assignment: EngineeringRoomAssignment): boolean {
  return (
    assignment.heatingSystems.some((item) => HYDRONIC_FAN_COIL_FAMILY_IDS.has(item.familyId)) ||
    assignment.coolingSystems.some((item) => HYDRONIC_FAN_COIL_FAMILY_IDS.has(item.familyId))
  );
}

function roomHasHydronicFloorHeating(assignment: EngineeringRoomAssignment): boolean {
  return assignment.heatingSystems.some((item) => item.familyId === 'hydronic_floor_heating');
}

export function projectHasHydronicCircuit(config: EngineeringSystemConfiguration): boolean {
  const assignments = Array.isArray(config.roomAssignments) ? config.roomAssignments : [];
  if (assignments.some((a) => roomHasHydronicHeating(a) || roomHasHydronicFanCoil(a) || roomHasHydronicFloorHeating(a))) {
    return true;
  }
  const sourceIds = [
    config.architecture?.spaceHeatingSourceId,
    config.architecture?.spaceCoolingSourceId,
    config.architecture?.spaceCombinedSourceId,
    ...(config.architecture?.sources || []).map((s) => s.familyId),
  ].filter(Boolean) as string[];
  const hydronicSources = new Set([
    'gas_boiler',
    'gas_condensing_boiler',
    'electric_boiler',
    'heat_pump_air_to_water',
    'reversible_air_to_water_heat_pump',
    'chiller_fan_coils',
    'external_building_heating_supply',
    'external_building_cooling_supply',
  ]);
  return sourceIds.some((id) => hydronicSources.has(id));
}

function towelPreferenceOf(assignment: EngineeringRoomAssignment): ServicePreference {
  if (assignment.towelRadiatorPreference === 'required' || assignment.towelRadiatorPreference === 'not_required' || assignment.towelRadiatorPreference === 'optional') {
    return assignment.towelRadiatorPreference;
  }
  if (TOWEL_RADIATOR_ROOM_PURPOSES.has(assignment.roomPurpose) && roomHasHydronicHeating(assignment)) {
    return 'optional';
  }
  return 'not_required';
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyFanCoilCircuit(): FanCoilCircuitRequirements {
  return { present: false, valveSetsRequired: 0, actuatorCountRequired: 0 };
}

/**
 * Compute hydronic system requirements deterministically from a normalized systems
 * configuration plus the owning project (needed for room -> floor mapping).
 * Returns null when there is no systems configuration at all.
 */
export function computeHydronicSystemRequirements(
  project: BuildingProject | null | undefined,
  config: EngineeringSystemConfiguration | null | undefined,
): HydronicSystemRequirements | null {
  if (!config) return null;

  const assignments = Array.isArray(config.roomAssignments) ? config.roomAssignments : [];
  const topology = project?.topology || null;
  const floors = topology?.floors || [];

  const roomFloor = new Map<string, string>();
  if (floors.length) {
    const firstFloorId = floors[0]?.id || null;
    for (const room of project?.rooms || []) {
      roomFloor.set(room.id, room.floorId && floors.some((f) => f.id === room.floorId) ? room.floorId : firstFloorId || '');
    }
  }

  const towelRadiatorsRequired = assignments.filter(
    (assignment) =>
      TOWEL_RADIATOR_ROOM_PURPOSES.has(assignment.roomPurpose) &&
      roomHasHydronicHeating(assignment) &&
      towelPreferenceOf(assignment) === 'required',
  ).length;

  const towelRadiatorsRecommended = assignments.filter(
    (assignment) =>
      TOWEL_RADIATOR_ROOM_PURPOSES.has(assignment.roomPurpose) &&
      roomHasHydronicHeating(assignment) &&
      towelPreferenceOf(assignment) === 'optional',
  ).length;

  const fanCoilCount = assignments.filter((assignment) => roomHasHydronicFanCoil(assignment)).length;

  // Phase 2.8A: per-service fan-coil presence. A fan coil in heatingSystems only
  // is a HEATING terminal; one in coolingSystems only is a COOLING terminal.
  // The 2-pipe circuit attribution below must follow this, not default to heating.
  const fanCoilHeatingCount = assignments.filter((assignment) =>
    assignment.heatingSystems.some((item) => HYDRONIC_FAN_COIL_FAMILY_IDS.has(item.familyId)),
  ).length;
  const fanCoilCoolingCount = assignments.filter((assignment) =>
    assignment.coolingSystems.some((item) => HYDRONIC_FAN_COIL_FAMILY_IDS.has(item.familyId)),
  ).length;

  const circuitKind = config.architecture?.distribution?.circuitKind || 'none';
  const fanCoilCircuitKind: HydronicSystemRequirements['fanCoilCircuitKind'] =
    fanCoilCount === 0 ? 'none' : circuitKind === '4pipe' ? '4pipe' : '2pipe';

  // Phase 2.8: no fan-coil distribution topology yet. Do not infer home-run.
  const fanCoilDistribution: FanCoilDistributionKind = 'pending_design';
  const fanCoilManifoldRequired = isFanCoilManifoldRequired(fanCoilDistribution, fanCoilCount);
  const fanCoilManifoldPortsRequired = fanCoilCount;

  let fanCoilHeatingCircuit = emptyFanCoilCircuit();
  let fanCoilCoolingCircuit = emptyFanCoilCircuit();
  let fanCoilValveSetsRequired = 0;
  let actuatorCountRequired = 0;

  if (fanCoilCount > 0 && fanCoilCircuitKind === '4pipe') {
    fanCoilHeatingCircuit = { present: true, valveSetsRequired: fanCoilCount, actuatorCountRequired: fanCoilCount };
    fanCoilCoolingCircuit = { present: true, valveSetsRequired: fanCoilCount, actuatorCountRequired: fanCoilCount };
    fanCoilValveSetsRequired = fanCoilCount * 2;
    actuatorCountRequired = fanCoilValveSetsRequired;
  } else if (fanCoilCount > 0) {
    // 2-pipe seasonal: ONE shared circuit, never two independent H/C circuits.
    // Attribute it truthfully to the service(s) that actually use fan coils:
    //   heating-only  -> heating present, cooling absent
    //   cooling-only  -> cooling present, heating absent (NOT the reverse)
    //   both          -> the SAME single changeover circuit serves heating AND
    //                    cooling seasonally (both present), with ONE valve set
    //                    per fan coil — never two simultaneous circuits
    //                    (simultaneous operation is 4-pipe only).
    // "Present" = seasonal service function; the physical circuit count is the
    // valve-set total below (fanCoilCount for 2-pipe vs fanCoilCount * 2 for 4-pipe).
    const heatingUsed = fanCoilHeatingCount > 0;
    const coolingUsed = fanCoilCoolingCount > 0;
    fanCoilHeatingCircuit = {
      present: heatingUsed,
      valveSetsRequired: heatingUsed ? fanCoilCount : 0,
      actuatorCountRequired: heatingUsed ? fanCoilCount : 0,
    };
    fanCoilCoolingCircuit = {
      present: coolingUsed,
      valveSetsRequired: coolingUsed ? fanCoilCount : 0,
      actuatorCountRequired: coolingUsed ? fanCoilCount : 0,
    };
    fanCoilValveSetsRequired = fanCoilCount;
    actuatorCountRequired = fanCoilCount;
  }

  const hydronicFloorHeatingPresent = assignments.some((assignment) => roomHasHydronicFloorHeating(assignment));
  const floorHeatingManifoldRequired = hydronicFloorHeatingPresent;

  const persistedCircuits = (config.hydronicRequirements as HydronicSystemRequirements | null | undefined)?.floorHeatingCircuits;
  const persistedCount = persistedCircuits && Number.isInteger(persistedCircuits.count) && Number(persistedCircuits.count) > 0
    ? Number(persistedCircuits.count)
    : null;
  const floorHeatingCircuits: FloorHeatingCircuitCount = hydronicFloorHeatingPresent
    ? persistedCount != null
      ? { status: 'known', count: persistedCount }
      : { status: 'pending_calculation', count: null }
    : { status: 'pending_design', count: null };
  // 'known' without a numeric value is invalid — collapse to pending.
  if (floorHeatingCircuits.status === 'known' && !(Number.isInteger(floorHeatingCircuits.count) && Number(floorHeatingCircuits.count) > 0)) {
    floorHeatingCircuits.status = 'pending_calculation';
    floorHeatingCircuits.count = null;
  }
  const floorHeatingCircuitCount: HydronicSystemRequirements['floorHeatingCircuitCount'] =
    floorHeatingCircuits.status === 'known' && floorHeatingCircuits.count != null
      ? 'known'
      : 'pending_calculation';

  const mixingUnitRequired = false;
  const circulationPumpRequired = false;
  const mixingUnitStatus = hydronicFloorHeatingPresent ? 'pending_design' : 'not_required';
  const circulationPumpStatus = hydronicFloorHeatingPresent ? 'pending_design' : 'not_required';

  const hydronicCircuitPresent = projectHasHydronicCircuit(config);

  const unresolvedRequirements: string[] = [];
  if (hydronicFloorHeatingPresent) {
    if (floorHeatingCircuits.status !== 'known') unresolvedRequirements.push('floorHeatingCircuitCount:pending_calculation');
    unresolvedRequirements.push('floorHeatingMixingUnit:pending_design');
    unresolvedRequirements.push('floorHeatingCirculationPump:pending_design');
  }
  if (fanCoilCount > 0) {
    unresolvedRequirements.push('fanCoilDistribution:pending_design');
    unresolvedRequirements.push('fanCoilManifoldPorts:pending_product_resolution');
  }
  if (towelRadiatorsRequired > 0 || towelRadiatorsRecommended > 0) {
    unresolvedRequirements.push('towelRadiators:pending_product_resolution');
  }
  if (hydronicCircuitPresent) {
    unresolvedRequirements.push('pumpGroups:pending_design');
    unresolvedRequirements.push('hydraulicSeparation:pending_design');
  }

  const byFloor: FloorHydronicRequirements[] = [];
  if (floors.length) {
    for (const floor of floors) {
      const floorAssignments = assignments.filter((a) => roomFloor.get(a.roomId) === floor.id);
      const fFanCoils = floorAssignments.filter((a) => roomHasHydronicFanCoil(a)).length;
      const fTowelRequired = floorAssignments.filter(
        (a) => TOWEL_RADIATOR_ROOM_PURPOSES.has(a.roomPurpose) && roomHasHydronicHeating(a) && towelPreferenceOf(a) === 'required',
      ).length;
      const fTowelRecommended = floorAssignments.filter(
        (a) => TOWEL_RADIATOR_ROOM_PURPOSES.has(a.roomPurpose) && roomHasHydronicHeating(a) && towelPreferenceOf(a) === 'optional',
      ).length;
      const fFloorHeating = floorAssignments.some((a) => roomHasHydronicFloorHeating(a));
      const fUnresolved: string[] = [];
      if (fFloorHeating) fUnresolved.push('floorHeatingCircuitCount:pending_calculation');
      byFloor.push({
        floorId: floor.id,
        floorLabel: floor.label,
        fanCoilCount: fFanCoils,
        fanCoilCircuitKind: fFanCoils === 0 ? 'none' : fanCoilCircuitKind,
        fanCoilManifoldPortsRequired: fFanCoils,
        towelRadiatorsRequired: fTowelRequired,
        towelRadiatorsRecommended: fTowelRecommended,
        hydronicFloorHeatingPresent: fFloorHeating,
        floorHeatingCircuitCount,
        unresolvedRequirements: fUnresolved,
      });
    }
  }

  return {
    towelRadiatorsRequired,
    towelRadiatorsRecommended,
    fanCoilCount,
    fanCoilCircuitKind,
    fanCoilDistribution,
    fanCoilManifoldRequired,
    fanCoilManifoldPortsRequired,
    fanCoilValveSetsRequired,
    actuatorCountRequired,
    fanCoilHeatingCircuit,
    fanCoilCoolingCircuit,
    hydronicFloorHeatingPresent,
    floorHeatingManifoldRequired,
    floorHeatingCircuitCount,
    floorHeatingCircuits,
    mixingUnitRequired,
    circulationPumpRequired,
    mixingUnitStatus,
    circulationPumpStatus,
    hydronicCircuitPresent,
    unresolvedRequirements,
    byFloor,
    computedAt: nowIso(),
  };
}
