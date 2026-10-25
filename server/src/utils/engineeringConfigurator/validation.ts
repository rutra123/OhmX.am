import type { EngineeringConfiguratorInput, RoomLoadPolicySnapshot, EngineeringQualitySnapshot, ServedRoomInput } from './types.js';
import type { CalculationQualityGateDecision } from './equipmentRequirementTypes.js';
import { MATCHER_MODEL_ID, MATCHER_MODEL_VERSION, MATCHER_POLICY_ID, ENGINEERING_SCHEMA_VERSION,
  BUILDING_QUALITY_MODEL_ID, BUILDING_QUALITY_MODEL_VERSION } from './equipmentRequirementTypes.js';
import { CM8_SYSTEM_TOPOLOGY, CM8_SYSTEM_ARCHITECTURE_ID, CM8_REVERSIBLE_SOURCE_FAMILY_ID,
  CM8_FAN_COIL_FAMILY_ID, ENGINEERING_CONFIGURATOR_POLICY_ID, ENGINEERING_CONFIGURATOR_POLICY_VERSION,
  CM8_COVERAGE_AREA_EPSILON_M2, CM8_COVERAGE_RATIO_EPSILON, MATCHER_POLICY_VERSION, VERIFICATION_REQUIREMENTS,
  block,warn,finite,nonNegative,nonEmpty,revision,strings,validLoadRevision } from './policy.js';
import type { Diagnostics } from './policy.js';
import { canonicalIds,compareCodePoints,validStableId } from './componentIdentity.js';
export interface ValidatedRoom {roomId:string;servedZoneIds:string[];load:RoomLoadPolicySnapshot}
export interface ValidatedContext {rooms:ValidatedRoom[];quality:EngineeringQualitySnapshot|null;qualityGate:CalculationQualityGateDecision|null}
function bothServices(value:unknown):boolean {
  return strings(value)&&value.length===2&&value.includes('heating')&&value.includes('cooling');
}
function idInventory(rows:readonly {roomId:string}[],path:string,d:Diagnostics):boolean {
  const seen=new Set<string>();let valid=true;
  for(const row of rows){if(!row||!validStableId(row.roomId)||seen.has(row.roomId)){block(d,'SERVED_ROOM_INVALID',path);valid=false;}else seen.add(row.roomId);}
  return valid;
}

/** Validate the frozen snapshot boundary without adapting live storage or recalculating loads. */
export function validateSnapshot(input:EngineeringConfiguratorInput,d:Diagnostics):ValidatedContext {
  const project=input.projectSnapshot,load=input.loadCalculation,system=input.systemConfigurationSnapshot;
  const context:ValidatedContext={rooms:[],quality:null,qualityGate:null};
  if(input.policyId!==ENGINEERING_CONFIGURATOR_POLICY_ID||input.policyVersion!==ENGINEERING_CONFIGURATOR_POLICY_VERSION)
    block(d,'POLICY_ID_VERSION_INVALID','policyId/policyVersion');
  const matcher=input.matcherRequestPolicy;
  if(!matcher||matcher.matcherModelId!==MATCHER_MODEL_ID||matcher.matcherModelVersion!==MATCHER_MODEL_VERSION
    ||matcher.matcherPolicyId!==MATCHER_POLICY_ID||matcher.matcherPolicyVersion!==MATCHER_POLICY_VERSION||matcher.engineeringSchemaVersion!==ENGINEERING_SCHEMA_VERSION)
    block(d,'POLICY_ID_VERSION_INVALID','matcherRequestPolicy');
  if(matcher&&(!VERIFICATION_REQUIREMENTS.includes(matcher.requiredVerificationTier)||matcher.requireExactOperatingPoint!==true
    ||matcher.allowInterpolation!==false||matcher.allowExtrapolation!==false||!revision(matcher.maxCandidates)||matcher.maxCandidates<1||!revision(matcher.maxDiagnosticResults)))
    block(d,'CANONICAL_VOCABULARY_INVALID','matcherRequestPolicy');
  if(!validStableId(input.projectId)||!revision(input.projectRevision)||!project||project.id!==input.projectId
    ||project.buildingRevision!==input.projectRevision||load?.buildingRevisionAtCalculation!==input.projectRevision
    ||load?.inputSnapshot?.buildingRevision!==input.projectRevision||load?.inputSnapshot?.projectId!==input.projectId)
    block(d,'PROJECT_REVISION_STALE','project/load project identity and revision');
  if(!revision(input.systemConfigurationRevision)||project?.systemsRevision!==input.systemConfigurationRevision
    ||load?.systemsRevisionAtCalculation!==input.systemConfigurationRevision||load?.inputSnapshot?.systemsRevision!==input.systemConfigurationRevision)
    block(d,'SYSTEM_CONFIGURATION_REVISION_STALE','project/load system revision');
  if(!validLoadRevision(input.loadCalculationRevision)||!validLoadRevision(input.sourceCalculationId)||input.sourceCalculationId!==input.loadCalculationRevision)
    block(d,'LOAD_CALCULATION_REVISION_STALE','loadCalculationRevision/sourceCalculationId');
  if(!load||load.status!=='calculated'||load.mode!=='steady_state'||load.inputSnapshot?.mode!==load.mode
    ||!nonEmpty(load.methodId)||!nonEmpty(load.methodVersion)||load.inputSnapshot?.methodVersion!==load.methodVersion
    ||!bothServices(load.inputSnapshot?.requestedServices)) block(d,'LOAD_CALCULATION_NOT_READY','loadCalculation');
  if(!nonNegative(load?.heatingDemandW)||!nonNegative(load?.coolingDemandW)) block(d,'OBJECT_LOAD_MISSING','loadCalculation object totals');
  if(!project||!['apartment','private_house'].includes(project.objectType)||input.systemTopology!==CM8_SYSTEM_TOPOLOGY)
    block(d,'TOPOLOGY_NOT_SUPPORTED','projectSnapshot.objectType/systemTopology');
  if(!system||system.configurationStatus!=='confirmed') block(d,'SYSTEM_CONFIGURATION_MISSING','systemConfigurationSnapshot');
  if(system){
    if(system.projectId!==input.projectId||system.buildingRevisionAtConfirmation!==input.projectRevision)
      block(d,'PROJECT_REVISION_STALE','systemConfigurationSnapshot project confirmation');
    if(system.systemsRevision!==input.systemConfigurationRevision||system.systemsRevisionAtConfirmation!==input.systemConfigurationRevision)
      block(d,'SYSTEM_CONFIGURATION_REVISION_STALE','systemConfigurationSnapshot system confirmation');
    const arch=system.architecture;
    if(!arch||!bothServices(system.requestedServices)||arch.spaceCombinedSourceId!==CM8_REVERSIBLE_SOURCE_FAMILY_ID
      ||arch.spaceHeatingSourceId!==CM8_REVERSIBLE_SOURCE_FAMILY_ID||arch.spaceCoolingSourceId!==CM8_REVERSIBLE_SOURCE_FAMILY_ID
      ||arch.distribution?.id!==CM8_SYSTEM_ARCHITECTURE_ID||arch.distribution?.circuitKind!=='2pipe')
      block(d,'TOPOLOGY_NOT_SUPPORTED','systemConfigurationSnapshot.architecture');
    if(system.simultaneousHeatCoolRequired!==false||arch?.distribution?.simultaneousHeatCool!==false||arch?.simultaneousHeatCoolSupported!==false)
      block(d,'SIMULTANEOUS_OPERATION_NOT_SUPPORTED','systemConfigurationSnapshot simultaneous flags');
  }
  const served=Array.isArray(input.servedRooms)?input.servedRooms:[];
  const assignments=Array.isArray(system?.roomAssignments)?system.roomAssignments:[];
  const results=Array.isArray(load?.roomResults)?load.roomResults:[];
  const inventoriesValid=[idInventory(served,'servedRooms',d),idInventory(assignments,'roomAssignments',d),idInventory(results,'roomResults',d)].every(Boolean);
  if(served.length===0||assignments.length===0||results.length===0) block(d,'SERVED_ROOM_INVALID','room inventories must not be empty');
  if(inventoriesValid){
    const servedIds=new Set(served.map(r=>r.roomId)),resultMap=new Map(results.map(r=>[r.roomId,r]));
    const assignmentMap=new Map(assignments.map(r=>[r.roomId,r]));
    for(const a of [...assignments].sort((x,y)=>compareCodePoints(x.roomId,y.roomId))){
      if(!servedIds.has(a.roomId)||!resultMap.has(a.roomId)) block(d,'SERVED_ROOM_INVALID','roomAssignments inventory',a.roomId);
      for(const service of ['heating','cooling'] as const){
        const terminals=service==='heating'?a.heatingSystems:a.coolingSystems;
        const pref=a.servicePreferences?.[service],source=a.sourceSystemIds?.[service];
        if(!Array.isArray(terminals)||!terminals.some(t=>t?.familyId===CM8_FAN_COIL_FAMILY_ID)||!['required','optional'].includes(pref)
          ||!(source===null||source===CM8_REVERSIBLE_SOURCE_FAMILY_ID))
          block(d,'SERVED_ROOM_INVALID',`roomAssignments.${service}`,a.roomId,service==='heating'?'HEATING':'COOLING');
      }
    }
    for(const room of [...served].sort((a,b)=>compareCodePoints(a.roomId,b.roomId))){
      const row=resultMap.get(room.roomId);
      if(!assignmentMap.has(room.roomId)||!row){block(d,'SERVED_ROOM_INVALID','servedRooms inventory',room.roomId);continue;}
      if(!Array.isArray(room.servedZoneIds)||!room.servedZoneIds.every(validStableId)){block(d,'SERVED_ROOM_INVALID','servedZoneIds',room.roomId);continue;}
      context.rooms.push({roomId:room.roomId,servedZoneIds:canonicalIds(room.servedZoneIds),load:row});
      for(const service of ['heating','cooling'] as const){const value=row[service];
        if(!value||value.status!=='calculated'||!nonNegative(value.demandW)||!Array.isArray(value.missingInputs)||value.missingInputs.length>0)
          block(d,'ROOM_LOAD_MISSING',`roomResults.${service}`,room.roomId,service==='heating'?'HEATING':'COOLING');
      }
    }
  }
  const quality=load?.engineeringQuality,coverage=quality?.coverage;
  if(!coverage||coverage.scope!=='WHOLE_OBJECT'||coverage.confirmation!=='WHOLE_OBJECT_CONFIRMED'
    ||!finite(coverage.declaredAreaM2)||coverage.declaredAreaM2<=0||!finite(coverage.modeledAreaM2)||coverage.modeledAreaM2<=0
    ||!finite(coverage.ratio)||Math.abs(coverage.ratio-1)>CM8_COVERAGE_RATIO_EPSILON
    ||Math.abs(coverage.modeledAreaM2-coverage.declaredAreaM2)>CM8_COVERAGE_AREA_EPSILON_M2
    ||!finite(project?.totalAreaM2)||project.totalAreaM2<=0||Math.abs(project.totalAreaM2-coverage.declaredAreaM2)>CM8_COVERAGE_AREA_EPSILON_M2)
    block(d,'LOAD_COVERAGE_INCOMPLETE','loadCalculation.engineeringQuality.coverage');
  if(!quality||quality.qualityModelId!==BUILDING_QUALITY_MODEL_ID||quality.qualityModelVersion!==BUILDING_QUALITY_MODEL_VERSION
    ||!([1,2,3] as readonly unknown[]).includes(quality.maximumEligibleLevel)||!([1,2,3] as readonly unknown[]).includes(quality.requestedLevel)
    ||!['PASS','PASS_WITH_WARNINGS','BLOCKED'].includes(quality.gateStatus)||!Array.isArray(quality.blockingFields)||!strings(quality.warnings)
    ||!['PRELIMINARY','PROFESSIONAL'].includes(input.selectionIntent)){
    block(d,'LOAD_QUALITY_INSUFFICIENT','loadCalculation.engineeringQuality');return context;
  }
  context.quality=quality;
  const professional=input.selectionIntent==='PROFESSIONAL';
  if(professional&&(quality.maximumEligibleLevel!==3||!['PASS','PASS_WITH_WARNINGS'].includes(quality.gateStatus)||quality.blockingFields.length>0))
    block(d,'LOAD_QUALITY_INSUFFICIENT','Professional quality gates');
  if(!professional&&quality.maximumEligibleLevel!==3)
    warn(d,'PRELIMINARY_LOAD_QUALITY',`Building quality level ${quality.maximumEligibleLevel}; no capacity relaxation.`,'loadCalculation.engineeringQuality');
  if(quality.gateStatus==='PASS_WITH_WARNINGS'||quality.gateStatus==='BLOCKED'||quality.blockingFields.length>0)
    warn(d,'BUILDING_QUALITY_WARNING','Building quality warnings require review; structural gates remain mandatory.','loadCalculation.engineeringQuality');
  for(const text of canonicalIds(quality.warnings)) warn(d,'BUILDING_QUALITY_WARNING',text,'loadCalculation.engineeringQuality.warnings');
  const qualityWarnings=canonicalIds(d.warnings.filter(w=>w.code==='PRELIMINARY_LOAD_QUALITY'||w.code==='BUILDING_QUALITY_WARNING').map(w=>w.message));
  context.qualityGate={requestedMatcherMode:input.selectionIntent,buildingQualityGateStatus:quality.gateStatus,
    buildingRequestedLevel:quality.requestedLevel,buildingMaximumEligibleLevel:quality.maximumEligibleLevel,
    minimumUseLevelForProfessional:3,preliminaryAllowedWithInsufficientQuality:!professional,
    decision:qualityWarnings.length>0?'ALLOWED_WITH_WARNINGS':'ALLOWED',allowedMatcherMode:input.selectionIntent,warnings:qualityWarnings,blockingReasons:[]};
  return context;
}
