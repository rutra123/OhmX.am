/** CM9 synthetic snapshots only. Tokens are illustrative fixtures, not live fingerprints. */
import type { EngineeringConfiguratorInput, SourcedNumericOperatingInput, SourcedTextOperatingInput } from './types.js';

export type Mutable<T> = { -readonly [P in keyof T]: Mutable<T[P]> };
export const LOAD_TOKEN = `load:sha256:${'a'.repeat(64)}`;
export const ENGINEERING_TOKEN = `engineering-catalog-state:sha256:${'b'.repeat(64)}` as const;
export const COMMERCE_TOKEN = `commerce-state:sha256:${'c'.repeat(64)}` as const;
export const NEXT_ENGINEERING_TOKEN = `engineering-catalog-state:sha256:${'d'.repeat(64)}` as const;
export const NEXT_COMMERCE_TOKEN = `commerce-state:sha256:${'e'.repeat(64)}` as const;
const source = 'reversible_air_to_water_heat_pump';
function numberInput(value: number, context = false): SourcedNumericOperatingInput {
  return { value, unit: '°C', source: context ? 'BUILDING_LOAD_CONTEXT' : 'USER_INPUT',
    sourceReference: context ? 'synthetic:load-design-consensus:v1' : 'synthetic:explicit-water-policy:v1', status: 'RESOLVED' };
}
function speed(): SourcedTextOperatingInput {
  return { value: 'MEDIUM', unit: null, source: 'USER_INPUT', sourceReference: 'synthetic:explicit-speed:v1', status: 'RESOLVED' };
}
export function makeFixture(objectType: 'apartment' | 'private_house' = 'apartment'): Mutable<EngineeringConfiguratorInput> {
  const room = (roomId: string, heat: number, cool: number) => ({
    roomId, roomName: roomId, roomType: 'living_room', areaM2: 50,
    heating: { status: 'calculated' as const, demandW: heat, warnings: [], missingInputs: [] },
    cooling: { status: 'calculated' as const, demandW: cool, warnings: [], missingInputs: [] },
    transmissionBreakdown: { indoorHeatingC: 20, indoorCoolingC: 26, outdoorHeatingC: -12, outdoorCoolingC: 34 },
  });
  const assignment = (roomId: string) => ({ roomId,
    sourceSystemIds: { heating: source, cooling: source },
    servicePreferences: { heating: 'required' as const, cooling: 'required' as const },
    heatingSystems: [{ familyId: 'fan_coils' }], coolingSystems: [{ familyId: 'fan_coils' }],
  });
  const zero = () => ({ designMarginPercent: 0, marginSource: 'NONE' as const, marginPolicyId: null, marginPolicyVersion: null });
  return {
    policyId: 'ohmx.engineering-configurator.heat-pump-fan-coil.v1', policyVersion: '1.1.0',
    projectId: 'synthetic-project', projectRevision: 7, systemConfigurationRevision: 3,
    loadCalculationRevision: LOAD_TOKEN, sourceCalculationId: LOAD_TOKEN,
    systemTopology: 'HEAT_PUMP_FAN_COIL', selectionIntent: 'PRELIMINARY',
    projectSnapshot: { id: 'synthetic-project', objectType, buildingRevision: 7, systemsRevision: 3, totalAreaM2: 100 },
    loadCalculation: {
      mode: 'steady_state', status: 'calculated', methodId: 'ohmx.building-loads.steady-state.v1', methodVersion: '1.0.0',
      buildingRevisionAtCalculation: 7, systemsRevisionAtCalculation: 3,
      heatingDemandW: 10000, coolingDemandW: 8000, partialHeatingDemandW: 999999, partialCoolingDemandW: 888888,
      roomResults: [room('room-a', 3000, 2000), room('room-b', 2000, 1500)],
      inputSnapshot: { projectId: 'synthetic-project', requestedServices: ['heating', 'cooling'], buildingRevision: 7,
        systemsRevision: 3, mode: 'steady_state', methodVersion: '1.0.0' },
      engineeringQuality: {
        qualityModelId: 'ohmx.professional-quality.v1', qualityModelVersion: '1.0.0',
        requestedLevel: 3, maximumEligibleLevel: 3, gateStatus: 'PASS', blockingFields: [], warnings: [],
        coverage: { declaredAreaM2: 100, modeledAreaM2: 100, ratio: 1, scope: 'WHOLE_OBJECT', confirmation: 'WHOLE_OBJECT_CONFIRMED' },
      },
      climateDatasetId: 'synthetic-climate', climateDatasetVersion: '1.0.0', climateLocationId: 'synthetic-location',
      calculatedAt: 'synthetic-audit-only',
    },
    systemConfigurationSnapshot: {
      projectId: 'synthetic-project', requestedServices: ['heating', 'cooling'], simultaneousHeatCoolRequired: false,
      architecture: { spaceHeatingSourceId: source, spaceCoolingSourceId: source, spaceCombinedSourceId: source,
        simultaneousHeatCoolSupported: false, distribution: { id: 'hydronic_2pipe_heating_cooling', circuitKind: '2pipe', simultaneousHeatCool: false } },
      roomAssignments: [assignment('room-a'), assignment('room-b')], configurationStatus: 'confirmed',
      buildingRevisionAtConfirmation: 7, systemsRevisionAtConfirmation: 3, systemsRevision: 3,
    },
    servedRooms: [{ roomId: 'room-a', servedZoneIds: ['zone-a'] }, { roomId: 'room-b', servedZoneIds: ['zone-b'] }],
    operatingConditions: {
      heatPumpHeating: { outdoorHeatingDesignC: numberInput(-12, true), waterSupplyC: numberInput(45), waterReturnC: numberInput(40) },
      heatPumpCooling: { outdoorCoolingDesignC: numberInput(34, true), waterSupplyC: numberInput(8), waterReturnC: numberInput(13) },
      fanCoilHeating: { waterInC: numberInput(45), waterOutC: numberInput(40), indoor_air_c: numberInput(20, true), sizingFanSpeed: speed() },
      fanCoilCooling: { waterInC: numberInput(8), waterOutC: numberInput(13), indoorAirDryBulbC: numberInput(26, true), indoorAirWetBulbC: numberInput(18), sizingFanSpeed: speed() },
    },
    designMargins: { heatPumpHeating: zero(), heatPumpCooling: zero(), fanCoilHeating: zero(), fanCoilCooling: zero() },
    matcherRequestPolicy: { matcherModelId: 'ohmx.catalog-matcher.v1', matcherModelVersion: '1.0.0',
      engineeringSchemaVersion: '1.0.0', matcherPolicyId: 'ohmx.catalog-matcher-policy.v1', matcherPolicyVersion: '1.0.0',
      requiredVerificationTier: 'AUTHORITATIVE', requireExactOperatingPoint: true, allowInterpolation: false,
      allowExtrapolation: false, maxCandidates: 20, maxDiagnosticResults: 20 },
    engineeringCatalogStateRevision: ENGINEERING_TOKEN,
  };
}

/** Test-only malformed-DTO injection; runtime module exposes no mutation helper. */
export function setPath(input: unknown, path: string, value: unknown): void {
  const keys = path.split('.'); let target = input as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]] = value;
}
export function changed(path: string, value: unknown): Mutable<EngineeringConfiguratorInput> {
  const input = makeFixture(); setPath(input, path, value); return input;
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
