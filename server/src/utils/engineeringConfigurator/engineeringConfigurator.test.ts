/** CM9 tests WRITTEN ONLY. No production data, service or Matcher calls. */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureHeatPumpFanCoil, generateHeatPumpFanCoilRequirements } from './configureHeatPumpFanCoil.js';
import { heatPumpComponentInstanceId, fanCoilComponentInstanceId } from './componentIdentity.js';
import { assessEngineeringConfiguratorStaleness } from './staleness.js';
import { makeFixture, changed, setPath, deepFreeze, LOAD_TOKEN, ENGINEERING_TOKEN, COMMERCE_TOKEN,
  NEXT_ENGINEERING_TOKEN, NEXT_COMMERCE_TOKEN } from './fixtures.js';
import type { EngineeringConfiguratorInput, EngineeringConfiguratorResult } from './types.js';

function ok(input: EngineeringConfiguratorInput = makeFixture()) {
  const r = configureHeatPumpFanCoil(input);
  assert.equal(r.status, 'READY_WITH_WARNINGS', JSON.stringify(r.blockingReasons));
  if (r.status !== 'READY_WITH_WARNINGS') throw new Error('Expected success');
  assert.deepEqual(r.blockingReasons, []);
  assert.equal(r.completenessState, 'PILOT_CORE_SELECTION_ONLY');
  assert.ok(r.warnings.some(w => w.code === 'PILOT_CORE_SELECTION_ONLY'));
  return r;
}
function blocked(input: EngineeringConfiguratorInput, code: string) {
  const r = configureHeatPumpFanCoil(input);
  assert.equal(r.status, 'BLOCKED'); assert.deepEqual(r.physicalComponents, []); assert.deepEqual(r.equipmentRequirements, []);
  assert.ok(r.blockingReasons.some(b => b.code === code), JSON.stringify(r.blockingReasons)); return r;
}
function assessment(historical: EngineeringConfiguratorResult = ok()) {
  return { historical, currentProjectRevision: 7, currentLoadCalculationRevision: LOAD_TOKEN,
    currentSystemConfigurationRevision: 3,
    currentConfiguratorPolicyId: 'ohmx.engineering-configurator.heat-pump-fan-coil.v1', currentConfiguratorPolicyVersion: '1.1.0',
    currentGenericRequirementPolicyVersion: '1.0.0', currentMatcherModelId: 'ohmx.catalog-matcher.v1', currentMatcherModelVersion: '1.0.0',
    currentMatcherPolicyId: 'ohmx.catalog-matcher-policy.v1', currentMatcherPolicyVersion: '1.0.0',
    currentEngineeringSchemaId: 'ohmx.engineering-product.v1', currentEngineeringSchemaVersion: '1.0.0',
    currentEngineeringCatalogStateRevision: ENGINEERING_TOKEN,
    currentCommerceStateRevision: COMMERCE_TOKEN,
  };
}
function withCommerce() { const i = makeFixture(); i.commerceStateRevision = COMMERCE_TOKEN; return ok(i); }

test("CM9-001 valid apartment: exactly one HP and one FC per served room [CM8-01 CM8-15]", () => {
  const r = ok(); assert.deepEqual(r.physicalComponents.map(c => c.equipmentType), ['HEAT_PUMP', 'FAN_COIL', 'FAN_COIL']); assert.equal(r.equipmentRequirements.length, 6);
});

test("CM9-002 valid private_house remains seasonal pilot only [CM8-02 CM8-53]", () => {
  const r = ok(makeFixture('private_house')); assert.equal(r.systemOperationPolicy, 'SEASONAL_CHANGEOVER'); assert.equal(r.systemArchitectureId, 'hydronic_2pipe_heating_cooling');
});

test("CM9-003 object heating uses direct object total, not room sum [CM8-05 CM8-07]", () => {
  const i=makeFixture(); const r=ok(i); assert.equal(r.equipmentRequirements[0].requiredCapacity!.requiredValue, i.loadCalculation.heatingDemandW! / 1000); assert.equal(r.equipmentRequirements[0].sourceLoadReference.sourceLoadDerivation,'DIRECT_OBJECT_TOTAL');
});

test("CM9-004 object cooling uses independent direct total [CM8-05 CM8-08]", () => {
  const i=makeFixture(); assert.equal(ok(i).equipmentRequirements[1].requiredCapacity!.requiredValue,i.loadCalculation.coolingDemandW! / 1000);
});

test("CM9-005 neither service is summed or max-replaced [CM8-05 CM8-06]", () => {
  const i=makeFixture(); const r=ok(i); assert.deepEqual(r.equipmentRequirements.slice(0,2).map(x=>x.requiredCapacity!.requiredValue),[i.loadCalculation.heatingDemandW!/1000,i.loadCalculation.coolingDemandW!/1000]); assert.notEqual(r.equipmentRequirements[0].requiredCapacity!.requiredValue,r.equipmentRequirements[1].requiredCapacity!.requiredValue);
});

test("CM9-006 fan coil heating is its own room load, not object load [CM8-11 CM8-14]", () => {
  const i=makeFixture(); const q=ok(i).equipmentRequirements[2]; assert.equal(q.requiredCapacity!.requiredValue,i.loadCalculation.roomResults[0].heating.demandW!/1000); assert.equal(q.sourceLoadReference.sourceLoadDerivation,'DIRECT_ROOM_RESULT'); assert.deepEqual(q.sourceLoadReference.sourceRoomIds,['room-a']);
});

test("CM9-007 fan coil cooling is its own room load [CM8-11]", () => {
  const i=makeFixture(); assert.equal(ok(i).equipmentRequirements[3].requiredCapacity!.requiredValue,i.loadCalculation.roomResults[0].cooling.demandW!/1000);
});

test("CM9-008 all component service pairs have SAME_PRODUCT binding [CM8-09 CM8-12 CM8.1-46]", () => {
  const r=ok(); for(const c of r.physicalComponents){ const qs=r.equipmentRequirements.filter(q=>q.physicalComponentRef?.componentInstanceId===c.componentInstanceId); assert.equal(qs.length,2); assert.deepEqual(qs.map(q=>q.service),['HEATING','COOLING']); assert.ok(qs.every(q=>q.physicalComponentRef!.selectionConstraint==='SAME_PRODUCT')); assert.deepEqual(qs[0].scopeReference,qs[1].scopeReference); assert.deepEqual(c.serviceRequirementIds,qs.map(q=>q.requirementId)); }
});

test("CM9-009 physical quantities are not doubled by two service rows [CM8-10 CM8-15]", () => {
  const r=ok(); assert.equal(r.physicalComponents.length,3); for(const c of r.physicalComponents) assert.equal(c.quantity,1); for(const q of r.equipmentRequirements){assert.equal(q.quantity.targetQuantity,1);assert.equal(q.quantity.matcherMayMultiply,false);} assert.equal(r.equipmentRequirements[0].quantityStrategy,'SHARED');assert.equal(r.equipmentRequirements[2].quantityStrategy,'PER_ROOM');
});

test("CM9-010 different rooms get distinct physical identities [CM8-13]", () => {
  const r=ok(); assert.notEqual(r.physicalComponents[1].componentInstanceId,r.physicalComponents[2].componentInstanceId);
});

test("CM9-011 component ID exact percent encoding and service independence [CM8-50]", () => {
  const p={projectId: "a:b !'()*~é",projectRevision:7,systemConfigurationRevision:3}; assert.equal(heatPumpComponentInstanceId(p),'component:a%3Ab%20%21%27%28%29%2A~%C3%A9:b7:s3:shared:system:heat-pump:01'); assert.equal(fanCoilComponentInstanceId({...p,roomId:'r:/?'}),'component:a%3Ab%20%21%27%28%29%2A~%C3%A9:b7:s3:room:r%3A%2F%3F:fan-coil:01');
});

test("CM9-012 requirement ID exact service suffix [CM8-49 CM8-50]", () => {
  for(const q of ok().equipmentRequirements){assert.equal(q.requirementId,`requirement:${q.physicalComponentRef!.componentInstanceId}:${q.service}`); assert.ok(!q.physicalComponentRef!.componentInstanceId.includes('HEATING'));assert.ok(!q.physicalComponentRef!.componentInstanceId.includes('COOLING'));}
});

test("CM9-013 same input gives byte-equivalent result and no input mutation [CM8-49]", () => {
  const i=deepFreeze(makeFixture()); const before=JSON.stringify(i); const a=ok(i); const b=ok(i); assert.deepEqual(a,b);assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(JSON.stringify(i),before);
});

test("CM9-014 canonical ordering ignores input room and assignment order [CM8-49]", () => {
  const a=makeFixture();const b=makeFixture();b.servedRooms.reverse();b.systemConfigurationSnapshot.roomAssignments.reverse();b.loadCalculation.roomResults.reverse();b.loadCalculation.inputSnapshot.requestedServices.reverse();b.systemConfigurationSnapshot.requestedServices.reverse();assert.deepEqual(ok(a),ok(b));
});

test("CM9-015 Unicode room ordering is code-point, not UTF-16 or locale [CM8-49]", () => {
  const i=makeFixture(); for(const [j,id] of ['𐀀',''].entries()){i.servedRooms[j].roomId=id;i.systemConfigurationSnapshot.roomAssignments[j].roomId=id;i.loadCalculation.roomResults[j].roomId=id;}assert.deepEqual(ok(i).physicalComponents.slice(1).map(c=>c.scopeReference.roomId),['','𐀀']);
});

test("CM9-016 timestamps and room display names do not alter requirements [CM8-49 CM8-50]", () => {
  const a=makeFixture();const b=makeFixture();b.loadCalculation.calculatedAt='different-audit-only';b.loadCalculation.roomResults[0].roomName='renamed';assert.deepEqual(ok(a),ok(b));
});

test("CM9-017 CM7.1 generic identity and revision stamp preserved [CM8.1-44]", () => {
  for(const q of ok().equipmentRequirements){assert.equal(q.contractId,'ohmx.equipment-requirement.v1');assert.equal(q.contractVersion,'1.1.0');assert.equal(q.policyId,'ohmx.engineering-configurator-policy.v1');assert.equal(q.policyVersion,'1.0.0');assert.equal(q.revisionStamp.configuratorPolicyId,q.policyId);assert.equal(q.revisionStamp.configuratorPolicyVersion,'1.0.0');}
});

test("CM9-018 topology-specific 1.1.0 identity stays on envelope [CM8.1-44]", () => {
  const r=ok();assert.equal(r.policyId,'ohmx.engineering-configurator.heat-pump-fan-coil.v1');assert.equal(r.policyVersion,'1.1.0');assert.equal(r.equipmentRequirementContractVersion,'1.1.0');
});

test("CM9-019 grouping is not used as physical identity [CM8-09]", () => {
  for(const q of ok().equipmentRequirements){assert.equal(q.requirementGroupId,null);assert.ok(q.physicalComponentRef);}
});

test("CM9-020 compatibility stays unknown with no constraints inferred [CM8.1-22]", () => {
  const r=ok();assert.ok(r.warnings.some(w=>w.code==='COMPATIBILITY_UNKNOWN'));for(const q of r.equipmentRequirements)assert.deepEqual(q.compatibilityRequirements,[]);
});

test("CM9-021 independent source and policy trace retained [CM8-07 CM8-08 CM8-11]", () => {
  const i=makeFixture();for(const q of ok(i).equipmentRequirements){assert.equal(q.sourceLoadReference.sourceCalculationId,LOAD_TOKEN);assert.equal(q.sourceLoadReference.sourceRevision.loadCalculationRevision,LOAD_TOKEN);assert.equal(q.sourceLoadReference.sourceRevision.methodId,i.loadCalculation.methodId);assert.equal(q.sourceLoadReference.climateDatasetId,'synthetic-climate');assert.equal(q.revisionStamp.projectRevision,7);assert.equal(q.revisionStamp.systemConfigurationRevision,3);}
});

test("CM9-022 legacy signature alias delegates to identical pure generation [CM8-49]", () => {
  const i=makeFixture();assert.deepEqual(generateHeatPumpFanCoilRequirements(i),configureHeatPumpFanCoil(i));
});

test("CM9-023 zero calculated loads are not mistaken for missing [CM8-30]", () => {
  const i=makeFixture();i.loadCalculation.heatingDemandW=0;i.loadCalculation.roomResults[0].heating.demandW=0;const r=ok(i);assert.equal(r.equipmentRequirements[0].requiredCapacity!.requiredValue,0);assert.equal(r.equipmentRequirements[2].requiredCapacity!.requiredValue,0);
});

test("CM9-024 partial numeric sums are never used on valid source totals [CM8-20]", () => {
  const a=makeFixture();const b=makeFixture();b.loadCalculation.partialHeatingDemandW=1;b.loadCalculation.partialCoolingDemandW=2;assert.deepEqual(ok(a),ok(b));
});

test("CM9-025 simultaneous intent blocks atomically [CM8-03]", () => {
  blocked(changed("systemConfigurationSnapshot.simultaneousHeatCoolRequired", true), "SIMULTANEOUS_OPERATION_NOT_SUPPORTED");
});

test("CM9-026 simultaneous distribution blocks atomically [CM8-03]", () => {
  blocked(changed("systemConfigurationSnapshot.architecture.distribution.simultaneousHeatCool", true), "SIMULTANEOUS_OPERATION_NOT_SUPPORTED");
});

test("CM9-027 four pipe blocks atomically [CM8-04]", () => {
  blocked(changed("systemConfigurationSnapshot.architecture.distribution.circuitKind", "4pipe"), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-028 independent distribution blocks atomically [CM8-04]", () => {
  blocked(changed("systemConfigurationSnapshot.architecture.distribution.id", "independent_dx"), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-029 commercial blocks atomically [CM8-53]", () => {
  blocked(changed("projectSnapshot.objectType", "commercial"), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-030 wrong topology blocks atomically [CM8-01]", () => {
  blocked(changed("systemTopology", "DX"), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-031 missing combined source blocks atomically [CM8-29]", () => {
  blocked(changed("systemConfigurationSnapshot.architecture.spaceCombinedSourceId", null), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-032 conflicting cooling source blocks atomically [CM8-29]", () => {
  blocked(changed("systemConfigurationSnapshot.architecture.spaceCoolingSourceId", "gas_boiler"), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-033 heating only blocks atomically [CM8-16]", () => {
  blocked(changed("systemConfigurationSnapshot.requestedServices", ["heating"]), "TOPOLOGY_NOT_SUPPORTED");
});

test("CM9-034 load snapshot missing cooling blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.inputSnapshot.requestedServices", ["heating"]), "LOAD_CALCULATION_NOT_READY");
});

test("CM9-035 draft topology blocks atomically [CM8-29]", () => {
  blocked(changed("systemConfigurationSnapshot.configurationStatus", "draft"), "SYSTEM_CONFIGURATION_MISSING");
});

test("CM9-036 snapshot missing blocks atomically [CM8-29]", () => {
  blocked(changed("systemConfigurationSnapshot", null), "SYSTEM_CONFIGURATION_MISSING");
});

test("CM9-037 quick mode blocks atomically [CM8-54]", () => {
  blocked(changed("loadCalculation.mode", "quick"), "LOAD_CALCULATION_NOT_READY");
});

test("CM9-038 limited professional load mode blocks atomically [CM8-54]", () => {
  blocked(changed("loadCalculation.mode", "professional"), "LOAD_CALCULATION_NOT_READY");
});

test("CM9-039 limited status blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.status", "limited"), "LOAD_CALCULATION_NOT_READY");
});

test("CM9-040 null object heating with partial total blocks atomically [CM8-20 CM8-30]", () => {
  blocked(changed("loadCalculation.heatingDemandW", null), "OBJECT_LOAD_MISSING");
});

test("CM9-041 negative object cooling blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.coolingDemandW", -1), "OBJECT_LOAD_MISSING");
});

test("CM9-042 missing room load blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.roomResults.0.heating.demandW", null), "ROOM_LOAD_MISSING");
});

test("CM9-043 room service missing_input blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.roomResults.0.cooling.status", "missing_input"), "ROOM_LOAD_MISSING");
});

test("CM9-044 room unresolved critical input despite numeric result blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.roomResults.0.heating.missingInputs", ["critical_thermal_input"]), "ROOM_LOAD_MISSING");
});

test("CM9-045 unknown coverage blocks atomically [CM8-21]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.scope", "UNKNOWN"), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-046 unconfirmed coverage blocks atomically [CM8-21]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.confirmation", "UNCONFIRMED"), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-047 selected room coverage blocks atomically [CM8-22]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.scope", "SELECTED_ROOMS"), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-048 conditioned zone coverage blocks atomically [CM8-22]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.scope", "CONDITIONED_ZONES"), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-049 whole object exclusions blocks atomically [CM8-23]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.confirmation", "WHOLE_OBJECT_WITH_EXCLUSIONS"), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-050 contradictory ratio blocks atomically [CM8-25]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.ratio", 0.5), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-051 zero modeled area blocks atomically [CM8-25]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.modeledAreaM2", 0), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-052 absent declared area blocks atomically [CM8-25]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.declaredAreaM2", null), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-053 project revision mismatch blocks atomically [CM8-26]", () => {
  blocked(changed("loadCalculation.buildingRevisionAtCalculation", 6), "PROJECT_REVISION_STALE");
});

test("CM9-054 snapshot project revision mismatch blocks atomically [CM8-26]", () => {
  blocked(changed("loadCalculation.inputSnapshot.buildingRevision", 6), "PROJECT_REVISION_STALE");
});

test("CM9-055 project identity mismatch blocks atomically [CM8-26]", () => {
  blocked(changed("projectSnapshot.id", "other"), "PROJECT_REVISION_STALE");
});

test("CM9-056 system revision mismatch blocks atomically [CM8-27]", () => {
  blocked(changed("loadCalculation.systemsRevisionAtCalculation", 2), "SYSTEM_CONFIGURATION_REVISION_STALE");
});

test("CM9-057 snapshot system revision mismatch blocks atomically [CM8-27]", () => {
  blocked(changed("loadCalculation.inputSnapshot.systemsRevision", 2), "SYSTEM_CONFIGURATION_REVISION_STALE");
});

test("CM9-058 confirmation revision mismatch blocks atomically [CM8-27]", () => {
  blocked(changed("systemConfigurationSnapshot.systemsRevisionAtConfirmation", 2), "SYSTEM_CONFIGURATION_REVISION_STALE");
});

test("CM9-059 timestamp load token blocks atomically [CM8-28]", () => {
  blocked(changed("loadCalculationRevision", "2026-09-09"), "LOAD_CALCULATION_REVISION_STALE");
});

test("CM9-060 source calculation token inequality blocks atomically [CM8-28]", () => {
  blocked(changed("sourceCalculationId", "load:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"), "LOAD_CALCULATION_REVISION_STALE");
});

test("CM9-061 one service fan coil blocks atomically [CM8-16]", () => {
  blocked(changed("systemConfigurationSnapshot.roomAssignments.0.coolingSystems", []), "SERVED_ROOM_INVALID");
});

test("CM9-062 room service not required blocks atomically [CM8-16]", () => {
  blocked(changed("systemConfigurationSnapshot.roomAssignments.0.servicePreferences.cooling", "not_required"), "SERVED_ROOM_INVALID");
});

test("CM9-063 room conflicting source blocks atomically [CM8-16]", () => {
  blocked(changed("systemConfigurationSnapshot.roomAssignments.0.sourceSystemIds.heating", "gas_boiler"), "SERVED_ROOM_INVALID");
});

test("CM9-064 missing HP heat supply blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.waterSupplyC.value", null), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-065 missing HP cool return blocks atomically [CM8-37]", () => {
  blocked(changed("operatingConditions.heatPumpCooling.waterReturnC.value", null), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-066 missing wet bulb blocks atomically [CM8-38]", () => {
  blocked(changed("operatingConditions.fanCoilCooling.indoorAirWetBulbC.value", null), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-067 unresolved fan speed blocks atomically [CM8-39]", () => {
  blocked(changed("operatingConditions.fanCoilHeating.sizingFanSpeed.source", "UNRESOLVED"), "FAN_SPEED_REQUIRED");
});

test("CM9-068 missing speed no HIGH default blocks atomically [CM8-39]", () => {
  blocked(changed("operatingConditions.fanCoilCooling.sizingFanSpeed.value", null), "FAN_SPEED_REQUIRED");
});

test("CM9-069 empty provenance reference blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.waterSupplyC.sourceReference", ""), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-070 unsupported operating source blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.waterSupplyC.source", "AUTO"), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-071 unresolved status despite temperature blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.waterSupplyC.status", "REQUIRED_POLICY_INPUT"), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-072 two pipe heat mismatch blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.fanCoilHeating.waterInC.value", 46), "OPERATING_CONDITION_CONFLICT");
});

test("CM9-073 two pipe cool mismatch blocks atomically [CM8-37]", () => {
  blocked(changed("operatingConditions.fanCoilCooling.waterOutC.value", 14), "OPERATING_CONDITION_CONFLICT");
});

test("CM9-074 wrong temperature unit blocks atomically [CM8-36]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.waterSupplyC.unit", "F"), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-075 outdoor context contradiction blocks atomically [CM8-44]", () => {
  blocked(changed("operatingConditions.heatPumpHeating.outdoorHeatingDesignC.value", 7), "OPERATING_CONDITION_CONFLICT");
});

test("CM9-076 missing transmission context blocks atomically [CM8-43]", () => {
  blocked(changed("loadCalculation.roomResults.0.transmissionBreakdown", null), "OPERATING_CONDITION_REQUIRED");
});

test("CM9-077 indoor consensus contradiction blocks atomically [CM8-43]", () => {
  blocked(changed("loadCalculation.roomResults.0.transmissionBreakdown.indoorHeatingC", 21), "OPERATING_CONDITION_CONFLICT");
});

test("CM9-078 negative margin blocks atomically [CM8-48]", () => {
  blocked(changed("designMargins.heatPumpHeating.designMarginPercent", -10), "DESIGN_MARGIN_INVALID");
});

test("CM9-079 source-less nonzero margin blocks atomically [CM8-48]", () => {
  blocked(changed("designMargins.heatPumpHeating.designMarginPercent", 10), "DESIGN_MARGIN_INVALID");
});

test("CM9-080 legacy quality blocks atomically [CM8-35]", () => {
  blocked(changed("loadCalculation.engineeringQuality.gateStatus", "LEGACY_UNASSESSED"), "LOAD_QUALITY_INSUFFICIENT");
});

test("CM9-081 unassessed level blocks atomically [CM8-35]", () => {
  blocked(changed("loadCalculation.engineeringQuality.maximumEligibleLevel", null), "LOAD_QUALITY_INSUFFICIENT");
});

test("CM9-082 zero quality blocks atomically [CM8-35]", () => {
  blocked(changed("loadCalculation.engineeringQuality.maximumEligibleLevel", 0), "LOAD_QUALITY_INSUFFICIENT");
});

test("CM9-083 unknown quality gate blocks atomically [CM8-35]", () => {
  blocked(changed("loadCalculation.engineeringQuality.gateStatus", "UNKNOWN"), "LOAD_QUALITY_INSUFFICIENT");
});

test("CM9-084 historical policy version blocks atomically [CM8.1-43]", () => {
  blocked(changed("policyVersion", "1.0.0"), "POLICY_ID_VERSION_INVALID");
});

test("CM9-085 wrong matcher version blocks atomically [CM8.1-36]", () => {
  blocked(changed("matcherRequestPolicy.matcherModelVersion", "2.0.0"), "POLICY_ID_VERSION_INVALID");
});

test("CM9-086 interpolation requested blocks atomically [CM8-45]", () => {
  blocked(changed("matcherRequestPolicy.allowInterpolation", true), "CANONICAL_VOCABULARY_INVALID");
});

test("CM9-087 extrapolation requested blocks atomically [CM8-45]", () => {
  blocked(changed("matcherRequestPolicy.allowExtrapolation", true), "CANONICAL_VOCABULARY_INVALID");
});

test("CM9-088 exactness disabled blocks atomically [CM8-44]", () => {
  blocked(changed("matcherRequestPolicy.requireExactOperatingPoint", false), "CANONICAL_VOCABULARY_INVALID");
});

test("CM9-089 nonfinite object load blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.heatingDemandW", Infinity), "OBJECT_LOAD_MISSING");
});

test("CM9-090 NaN room load blocks atomically [CM8-30]", () => {
  blocked(changed("loadCalculation.roomResults.0.cooling.demandW", NaN), "ROOM_LOAD_MISSING");
});

test("CM9-091 infinite margin blocks atomically [CM8-48]", () => {
  blocked(changed("designMargins.heatPumpHeating.designMarginPercent", Infinity), "DESIGN_MARGIN_INVALID");
});

test("CM9-092 NaN coverage blocks atomically [CM8-25]", () => {
  blocked(changed("loadCalculation.engineeringQuality.coverage.ratio", NaN), "LOAD_COVERAGE_INCOMPLETE");
});

test("CM9-093 missing engineering token blocks atomically [CM8.1-35]", () => {
  blocked(changed("engineeringCatalogStateRevision", undefined), "ENGINEERING_CATALOG_STATE_REQUIRED");
});

test("CM9-094 malformed engineering token blocks atomically [CM8.1-35]", () => {
  blocked(changed("engineeringCatalogStateRevision", 'engineering-catalog-state:sha256:BAD'), "ENGINEERING_CATALOG_STATE_INVALID");
});

test("CM9-095 newline engineering token blocks atomically [CM8.1-35]", () => {
  blocked(changed("engineeringCatalogStateRevision", ENGINEERING_TOKEN+'\n'), "ENGINEERING_CATALOG_STATE_INVALID");
});

test("CM9-096 unpaired surrogate project ID blocks atomically [CM8-50]", () => {
  blocked(changed("projectId", '\ud800'), "PROJECT_REVISION_STALE");
});

test("CM9-097 partial 50 of 180 coverage blocks without area extrapolation [CM8-19 CM8.1-45]", () => {
  const i=makeFixture();i.projectSnapshot.totalAreaM2=180;Object.assign(i.loadCalculation.engineeringQuality!.coverage,{declaredAreaM2:180,modeledAreaM2:50,ratio:50/180});blocked(i,'LOAD_COVERAGE_INCOMPLETE');
});

test("CM9-098 coverage tolerance accepted inside frozen epsilons [CM8-24]", () => {
  const i=makeFixture();i.loadCalculation.engineeringQuality!.coverage.modeledAreaM2=100.009;i.loadCalculation.engineeringQuality!.coverage.ratio=1.0000009;ok(i);
});

test("CM9-099 area tolerance exceeded even when ratio claims one [CM8-25]", () => {
  blocked(changed('loadCalculation.engineeringQuality.coverage.modeledAreaM2',100.011),'LOAD_COVERAGE_INCOMPLETE');
});

test("CM9-100 duplicate served IDs blocked [CM8-17]", () => {
  const i=makeFixture();i.servedRooms.push({...i.servedRooms[0]});blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-101 duplicate load-result IDs blocked [CM8-17]", () => {
  const i=makeFixture();i.loadCalculation.roomResults.push({...i.loadCalculation.roomResults[0]});blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-102 orphan assignment without load result blocked [CM8-18]", () => {
  const i=makeFixture();i.loadCalculation.roomResults.pop();blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-103 omitting a fan-coil assignment from servedRooms blocked [CM8-18]", () => {
  const i=makeFixture();i.servedRooms.pop();blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-104 served room without assignment blocked [CM8-18]", () => {
  const i=makeFixture();i.systemConfigurationSnapshot.roomAssignments.pop();blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-105 duplicate confirmed assignments blocked [CM8-17]", () => {
  const i=makeFixture();i.systemConfigurationSnapshot.roomAssignments.push({...i.systemConfigurationSnapshot.roomAssignments[0]});blocked(i,'SERVED_ROOM_INVALID');
});

test("CM9-106 empty served inventory blocked [CM8-18]", () => {
  blocked(changed('servedRooms',[]),'SERVED_ROOM_INVALID');
});

test("CM9-107 all exact canonical operating condition keys emitted [CM8-36 CM8-37 CM8-38 CM8-43]", () => {
  const r=ok();const keys=[['outdoor_air_c','water_supply_c','water_return_c'],['outdoor_air_c','water_supply_c','water_return_c'],['water_in_c','water_out_c','indoor_air_dry_bulb_c','fan_speed'],['water_in_c','water_out_c','indoor_air_dry_bulb_c','indoor_air_wet_bulb_c','fan_speed']];for(let j=0;j<4;j++){assert.deepEqual(r.equipmentRequirements[j].operatingConditions.map(c=>c.conditionKey),keys[j]);assert.ok(r.equipmentRequirements[j].operatingConditions.every(c=>c.matchPolicy==='EXACT'));}
});

test("CM9-108 indoor alias maps to existing key with load provenance [CM8-43]", () => {
  const q=ok().equipmentRequirements[2];assert.equal(q.operatingConditions.find(c=>c.conditionKey==='indoor_air_dry_bulb_c')!.valueNumeric,20);assert.equal(q.operatingConditionProvenance.find(c=>c.conditionKey==='indoor_air_dry_bulb_c')!.source,'BUILDING_LOAD_CONTEXT');
});

test("CM9-109 explicit speed preserved exactly with no case folding [CM8-40]", () => {
  const i=changed('operatingConditions.fanCoilHeating.sizingFanSpeed.value','medium');const q=ok(i).equipmentRequirements[2];assert.equal(q.operatingConditions.find(c=>c.conditionKey==='fan_speed')!.valueText,'medium');
});

test("CM9-110 SYSTEM_POLICY provenance maps without inventing aliases [CM8-40]", () => {
  const i=changed('operatingConditions.fanCoilCooling.sizingFanSpeed.source','SYSTEM_POLICY');assert.equal(ok(i).equipmentRequirements[3].operatingConditionProvenance.find(c=>c.conditionKey==='fan_speed')!.source,'SYSTEM_CONFIGURATION');
});

test("CM9-111 explicit preliminary pilot reference adds warning [CM8-41]", () => {
  const i=changed('operatingConditions.fanCoilHeating.sizingFanSpeed.source','PILOT_REFERENCE');assert.ok(ok(i).warnings.some(w=>w.code==='PILOT_REFERENCE_OPERATING_INPUT'));
});

test("CM9-112 professional pilot reference blocks without downgrade [CM8-42]", () => {
  const i=changed('operatingConditions.fanCoilHeating.sizingFanSpeed.source','PILOT_REFERENCE');i.selectionIntent='PROFESSIONAL';blocked(i,'FAN_SPEED_REQUIRED');
});

test("CM9-113 professional temperature pilot reference blocks [CM8-42]", () => {
  const i=changed('operatingConditions.heatPumpHeating.waterSupplyC.source','PILOT_REFERENCE');i.selectionIntent='PROFESSIONAL';blocked(i,'OPERATING_CONDITION_REQUIRED');
});

test("CM9-114 no A7/W35 substitution and no 70/60 inference [CM8-44 CM8-45]", () => {
  const r=ok();assert.deepEqual(r.equipmentRequirements[0].operatingConditions.map(c=>c.valueNumeric),[-12,45,40]);assert.deepEqual(r.equipmentRequirements[2].operatingConditions.slice(0,2).map(c=>c.valueNumeric),[45,40]);assert.ok(r.equipmentRequirements.every(q=>q.matcherRequestPolicy.allowInterpolation===false&&q.matcherRequestPolicy.allowExtrapolation===false));
});

test("CM9-115 heating supply must exceed return even if HP and FC agree [CM8-36]", () => {
  const i=makeFixture();i.operatingConditions.heatPumpHeating.waterSupplyC.value=40;i.operatingConditions.fanCoilHeating.waterInC.value=40;blocked(i,'OPERATING_CONDITION_CONFLICT');
});

test("CM9-116 cooling supply must be lower than return even if HP and FC agree [CM8-37]", () => {
  const i=makeFixture();i.operatingConditions.heatPumpCooling.waterSupplyC.value=13;i.operatingConditions.fanCoilCooling.waterInC.value=13;blocked(i,'OPERATING_CONDITION_CONFLICT');
});

test("CM9-117 zero margin default is explicit when approval absent [CM8-46]", () => {
  const i=changed('designMargins',undefined);for(const q of ok(i).equipmentRequirements){assert.equal(q.designMargin!.designMarginPercent,0);assert.equal(q.designMargin!.marginPolicySource,'NONE');assert.equal(q.designMargin!.marginPolicyId,null);assert.equal(q.designMargin!.effectiveRequiredCapacity,q.requiredCapacity!.requiredValue);}
});

test("CM9-118 nonzero margin preserves base plus full-precision effective capacity [CM8-47]", () => {
  const i=makeFixture();i.loadCalculation.heatingDemandW=1234.56789;i.designMargins.heatPumpHeating={designMarginPercent:12.34567,marginSource:'USER_INPUT',marginPolicyId:'synthetic-margin',marginPolicyVersion:'1.0.0'};const q=ok(i).equipmentRequirements[0];const base=1234.56789/1000;assert.equal(q.requiredCapacity!.requiredValue,base);assert.equal(q.designMargin!.baseRequiredCapacity,base);assert.equal(q.designMargin!.effectiveRequiredCapacity,base*(1+12.34567/100));assert.equal(q.designMargin!.marginPolicySource,'EXPLICIT_USER');assert.equal(q.designMargin!.marginPolicyId,'synthetic-margin');assert.equal(ok(i).equipmentRequirements[1].designMargin!.designMarginPercent,0);
});

test("CM9-119 system-policy margin maps to CONFIGURATOR_POLICY [CM8-47]", () => {
  const i=makeFixture();i.designMargins.fanCoilCooling={designMarginPercent:5,marginSource:'SYSTEM_POLICY',marginPolicyId:'synthetic-policy',marginPolicyVersion:'1.0.0'};assert.equal(ok(i).equipmentRequirements[3].designMargin!.marginPolicySource,'CONFIGURATOR_POLICY');
});

test("CM9-120 overflow in effective capacity blocks [CM8-48]", () => {
  const i=makeFixture();i.loadCalculation.heatingDemandW=Number.MAX_VALUE;i.designMargins.heatPumpHeating={designMarginPercent:Number.MAX_VALUE,marginSource:'USER_INPUT',marginPolicyId:null,marginPolicyVersion:null};blocked(i,'DESIGN_MARGIN_INVALID');
});

test("CM9-121 preliminary eligible level 1 warns without reducing capacity [CM8-31 CM8-32]", () => {
  const i=changed('loadCalculation.engineeringQuality.maximumEligibleLevel',1);const r=ok(i);assert.ok(r.warnings.some(w=>w.code==='PRELIMINARY_LOAD_QUALITY'));assert.equal(r.equipmentRequirements[0].requiredCapacity!.requiredValue,i.loadCalculation.heatingDemandW!/1000);assert.equal(r.equipmentRequirements[0].requiredCapacity!.comparisonPolicy,'AT_LEAST');
});

test("CM9-122 preliminary eligible level 2 warns without reducing capacity [CM8-31 CM8-32]", () => {
  const i=changed('loadCalculation.engineeringQuality.maximumEligibleLevel',2);const r=ok(i);assert.ok(r.warnings.some(w=>w.code==='PRELIMINARY_LOAD_QUALITY'));assert.equal(r.equipmentRequirements[0].requiredCapacity!.requiredValue,i.loadCalculation.heatingDemandW!/1000);assert.equal(r.equipmentRequirements[0].requiredCapacity!.comparisonPolicy,'AT_LEAST');
});

test("CM9-123 building quality warnings remain named warnings [CM8-31]", () => {
  const i=changed('loadCalculation.engineeringQuality.warnings',['synthetic noncritical warning']);assert.ok(ok(i).warnings.some(w=>w.code==='BUILDING_QUALITY_WARNING'));
});

test("CM9-124 professional valid level three passes without downgrade [CM8-34]", () => {
  const i=changed('selectionIntent','PROFESSIONAL');for(const q of ok(i).equipmentRequirements){assert.equal(q.selectionMode,'PROFESSIONAL');assert.equal(q.calculationQualityGate.allowedMatcherMode,'PROFESSIONAL');assert.equal(q.calculationQualityGate.minimumUseLevelForProfessional,3);}
});

test("CM9-125 professional insufficient level blocks [CM8-33]", () => {
  const i=changed('selectionIntent','PROFESSIONAL');i.loadCalculation.engineeringQuality!.maximumEligibleLevel=2;blocked(i,'LOAD_QUALITY_INSUFFICIENT');
});

test("CM9-126 professional quality BLOCKED status blocks even at level three [CM8-33]", () => {
  const i=changed('selectionIntent','PROFESSIONAL');i.loadCalculation.engineeringQuality!.gateStatus='BLOCKED';blocked(i,'LOAD_QUALITY_INSUFFICIENT');
});

test("CM9-127 professional unresolved blockingFields blocks [CM8-33]", () => {
  const i=changed('selectionIntent','PROFESSIONAL');i.loadCalculation.engineeringQuality!.blockingFields=['critical'];blocked(i,'LOAD_QUALITY_INSUFFICIENT');
});

test("CM9-128 engineering and commerce references remain separate envelope fields [CM8.1-19 CM8.1-20]", () => {
  const r=withCommerce();assert.equal(r.engineeringCatalogStateRevision,ENGINEERING_TOKEN);assert.equal(r.commerceStateRevision,COMMERCE_TOKEN);assert.equal(r.commerceComparisonStatus,'NOT_COMPARED');assert.equal(r.engineeringStale,false);assert.ok(!Object.hasOwn(r,'catalogStateRevision'));for(const q of r.equipmentRequirements){assert.ok(!Object.hasOwn(q,'commerceStateRevision'));assert.ok(!Object.hasOwn(q,'engineeringCatalogStateRevision'));}
});

test("CM9-129 absent commerce does not block and is not claimed CURRENT [CM8.1-33 CM8.1-34 CM8.1-59]", () => {
  const r=ok();assert.ok(!Object.hasOwn(r,'commerceStateRevision'));assert.equal(r.commerceComparisonStatus,'NOT_TRACKED');assert.equal(r.commerceStale,false);assert.deepEqual(r.commerceStaleReasons,[]);
});

test("CM9-130 invalid optional commerce is ignored, not a generation error [CM8.1-50]", () => {
  const i=changed('commerceStateRevision','wrong');const r=ok(i);assert.ok(r.warnings.some(w=>w.code==='COMMERCE_REVISION_IGNORED'));assert.ok(!Object.hasOwn(r,'commerceStateRevision'));assert.deepEqual(r.equipmentRequirements,ok().equipmentRequirements);
});

test("CM9-131 commerce difference cannot change components, capacity, conditions or binding [CM8.1-19 CM8.1-20 CM8.1-22]", () => {
  const a=makeFixture();a.commerceStateRevision=COMMERCE_TOKEN;const b=makeFixture();b.commerceStateRevision=NEXT_COMMERCE_TOKEN;const x=ok(a),y=ok(b);assert.deepEqual(x.equipmentRequirements,y.equipmentRequirements);assert.deepEqual(x.physicalComponents,y.physicalComponents);
});

test("CM9-132 catalog engineering reference changes do not recalculate loads [CM8.1-02]", () => {
  const a=ok();const b=ok(changed('engineeringCatalogStateRevision',NEXT_ENGINEERING_TOKEN));assert.deepEqual(a.equipmentRequirements,b.equipmentRequirements);assert.equal(b.engineeringCatalogStateRevision,NEXT_ENGINEERING_TOKEN);
});

test("CM9-133 missing engineering identity has explicit unavailable stale state [CM8.1-35]", () => {
  const r=blocked(changed('engineeringCatalogStateRevision',undefined),'ENGINEERING_CATALOG_STATE_REQUIRED');assert.equal(r.engineeringCatalogStateRevision,null);assert.equal(r.engineeringStale,true);assert.deepEqual(r.engineeringStaleReasons,['ENGINEERING_CATALOG_STATE_UNAVAILABLE']);
});

test("CM9-134 stale matrix A compares two domains independently [CM8.1-13 CM8.1-14 CM8.1-15]", () => {
  const i=assessment(withCommerce());i.currentEngineeringCatalogStateRevision=ENGINEERING_TOKEN;i.currentCommerceStateRevision=COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.equal(a.commerceStale,false);assert.deepEqual(a.engineeringStaleReasons,[]);assert.deepEqual(a.commerceStaleReasons,[]);assert.equal(a.commerceComparisonStatus,'CURRENT');
});

test("CM9-135 stale matrix B compares two domains independently [CM8.1-13 CM8.1-14 CM8.1-15]", () => {
  const i=assessment(withCommerce());i.currentEngineeringCatalogStateRevision=NEXT_ENGINEERING_TOKEN;i.currentCommerceStateRevision=COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,true);assert.equal(a.commerceStale,false);assert.deepEqual(a.engineeringStaleReasons,["ENGINEERING_CATALOG_STATE_CHANGED"]);assert.deepEqual(a.commerceStaleReasons,[]);assert.equal(a.commerceComparisonStatus,'CURRENT');
});

test("CM9-136 stale matrix C compares two domains independently [CM8.1-13 CM8.1-14 CM8.1-15]", () => {
  const i=assessment(withCommerce());i.currentEngineeringCatalogStateRevision=ENGINEERING_TOKEN;i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.equal(a.commerceStale,true);assert.deepEqual(a.engineeringStaleReasons,[]);assert.deepEqual(a.commerceStaleReasons,["COMMERCE_STATE_CHANGED"]);assert.equal(a.commerceComparisonStatus,'STALE');
});

test("CM9-137 stale matrix D compares two domains independently [CM8.1-13 CM8.1-14 CM8.1-15]", () => {
  const i=assessment(withCommerce());i.currentEngineeringCatalogStateRevision=NEXT_ENGINEERING_TOKEN;i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,true);assert.equal(a.commerceStale,true);assert.deepEqual(a.engineeringStaleReasons,["ENGINEERING_CATALOG_STATE_CHANGED"]);assert.deepEqual(a.commerceStaleReasons,["COMMERCE_STATE_CHANGED"]);assert.equal(a.commerceComparisonStatus,'STALE');
});

test("CM9-138 price change represented solely by supplied commerce token [CM8.1-09]", () => {
  const i=assessment(withCommerce());i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.deepEqual(a.engineeringStaleReasons,[]);assert.equal(a.commerceStale,true);
});

test("CM9-139 currency change represented solely by supplied commerce token [CM8.1-10]", () => {
  const i=assessment(withCommerce());i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.deepEqual(a.engineeringStaleReasons,[]);assert.equal(a.commerceStale,true);
});

test("CM9-140 semantic stock change represented solely by supplied commerce token [CM8.1-11]", () => {
  const i=assessment(withCommerce());i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.deepEqual(a.engineeringStaleReasons,[]);assert.equal(a.commerceStale,true);
});

test("CM9-141 mapped availability change represented solely by supplied commerce token [CM8.1-12]", () => {
  const i=assessment(withCommerce());i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,false);assert.deepEqual(a.engineeringStaleReasons,[]);assert.equal(a.commerceStale,true);
});

test("CM9-142 tracked history without current commerce is NOT_COMPARED [CM8.1-42]", () => {
  const i=assessment(withCommerce());setPath(i,'currentCommerceStateRevision',undefined);const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.commerceComparisonStatus,'NOT_COMPARED');assert.equal(a.commerceStale,false);
});

test("CM9-143 untracked history stays NOT_TRACKED when current commerce appears [CM8.1-34]", () => {
  assert.equal(assessEngineeringConfiguratorStaleness(assessment(ok())).commerceComparisonStatus,'NOT_TRACKED');
});

test("CM9-144 missing current engineering token fails closed [CM8.1-49]", () => {
  const i=assessment();setPath(i,'currentEngineeringCatalogStateRevision',null);const a=assessEngineeringConfiguratorStaleness(i);assert.equal(a.engineeringStale,true);assert.deepEqual(a.engineeringStaleReasons,['ENGINEERING_CATALOG_STATE_UNAVAILABLE']);
});

test("CM9-145 malformed current engineering token fails closed [CM8.1-49]", () => {
  const i=assessment();setPath(i,'currentEngineeringCatalogStateRevision','bad');assert.deepEqual(assessEngineeringConfiguratorStaleness(i).engineeringStaleReasons,['ENGINEERING_CATALOG_STATE_UNAVAILABLE']);
});

test("CM9-146 currentProjectRevision has independent engineering stale reason [CM8-26 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentProjectRevision",8);const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["PROJECT_REVISION_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-147 currentLoadCalculationRevision has independent engineering stale reason [CM8-28 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentLoadCalculationRevision","load:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["LOAD_CALCULATION_REVISION_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-148 currentSystemConfigurationRevision has independent engineering stale reason [CM8-27 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentSystemConfigurationRevision",4);const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["SYSTEM_CONFIGURATION_REVISION_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-149 currentConfiguratorPolicyVersion has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentConfiguratorPolicyVersion","1.2.0");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["CONFIGURATOR_POLICY_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-150 currentConfiguratorPolicyId has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentConfiguratorPolicyId","other");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["CONFIGURATOR_POLICY_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-151 currentGenericRequirementPolicyVersion has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentGenericRequirementPolicyVersion","1.1.0");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["GENERIC_REQUIREMENT_POLICY_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-152 currentMatcherModelVersion has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentMatcherModelVersion","2.0.0");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["MATCHER_MODEL_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-153 currentMatcherModelId has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentMatcherModelId","other");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["MATCHER_MODEL_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-154 currentMatcherPolicyVersion has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentMatcherPolicyVersion","2.0.0");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["MATCHER_POLICY_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-155 currentMatcherPolicyId has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentMatcherPolicyId","other");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["MATCHER_POLICY_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-156 currentEngineeringSchemaVersion has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentEngineeringSchemaVersion","2.0.0");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["ENGINEERING_SCHEMA_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-157 currentEngineeringSchemaId has independent engineering stale reason [CM8.1-36 CM8.1-36]", () => {
  const i=assessment(withCommerce());setPath(i,"currentEngineeringSchemaId","other");const a=assessEngineeringConfiguratorStaleness(i);assert.deepEqual(a.engineeringStaleReasons,["ENGINEERING_SCHEMA_CHANGED"]);assert.equal(a.commerceStale,false);
});

test("CM9-158 stale reasons deduplicated in frozen enum order [CM8.1-36]", () => {
  const i=assessment(withCommerce());i.currentProjectRevision=8;i.currentSystemConfigurationRevision=4;i.currentLoadCalculationRevision=`load:sha256:${'f'.repeat(64)}`;i.currentEngineeringCatalogStateRevision=NEXT_ENGINEERING_TOKEN;assert.deepEqual(assessEngineeringConfiguratorStaleness(i).engineeringStaleReasons,['PROJECT_REVISION_CHANGED','LOAD_CALCULATION_REVISION_CHANGED','SYSTEM_CONFIGURATION_REVISION_CHANGED','ENGINEERING_CATALOG_STATE_CHANGED']);
});

test("CM9-159 historical mixed generic stamps cannot be certified current [CM8.1-36]", () => {
  const h=ok();setPath(h,'equipmentRequirements.5.revisionStamp.configuratorPolicyVersion','bad');assert.deepEqual(assessEngineeringConfiguratorStaleness(assessment(h)).engineeringStaleReasons,['GENERIC_REQUIREMENT_POLICY_CHANGED']);
});

test("CM9-160 historical mixed model stamps cannot be certified current [CM8.1-36]", () => {
  const h=ok();setPath(h,'equipmentRequirements.5.revisionStamp.matcherModelVersion','bad');assert.deepEqual(assessEngineeringConfiguratorStaleness(assessment(h)).engineeringStaleReasons,['MATCHER_MODEL_CHANGED']);
});

test("CM9-161 historical mixed schema stamps cannot be certified current [CM8.1-36]", () => {
  const h=ok();setPath(h,'equipmentRequirements.5.matcherRequestPolicy.engineeringSchemaVersion','bad');assert.deepEqual(assessEngineeringConfiguratorStaleness(assessment(h)).engineeringStaleReasons,['ENGINEERING_SCHEMA_CHANGED']);
});

test("CM9-162 stale assessment never mutates historical result [CM8.1-49]", () => {
  const h=deepFreeze(withCommerce());const before=JSON.stringify(h);const i=assessment(h);i.currentCommerceStateRevision=NEXT_COMMERCE_TOKEN;assessEngineeringConfiguratorStaleness(i);assert.equal(JSON.stringify(h),before);
});

test("CM9-163 empty blocked result uses frozen dependency versions without claiming success [CM8.1-36]", () => {
  const h=blocked(changed('loadCalculation.heatingDemandW',null),'OBJECT_LOAD_MISSING');const i=assessment(h);i.currentGenericRequirementPolicyVersion='2.0.0';assert.deepEqual(assessEngineeringConfiguratorStaleness(i).engineeringStaleReasons,['GENERIC_REQUIREMENT_POLICY_CHANGED']);assert.equal(h.status,'BLOCKED');
});

test("CM9-164 no selected products commerce facts or BOM in result [CM8.1-28 CM8.1-57]", () => {
  const walk=(v:unknown):void=>{if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){assert.ok(!['productId','sku','price','stock','selectedProduct','selectedCandidate','rankedCandidates','bom','purchaseAction'].includes(k),k);walk(x);}}};walk(ok());
});


test("CM9-165 empty READY history is rejected, never given BLOCKED dependency defaults [CM8.1-36 CM8.1-59]", () => {
  const h=ok();setPath(h,'equipmentRequirements',[]);
  assert.throws(()=>assessEngineeringConfiguratorStaleness(assessment(h)),/READY history requires nonempty requirement stamps/);
});
