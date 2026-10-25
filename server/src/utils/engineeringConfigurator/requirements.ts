import type { EngineeringConfiguratorInput, PhysicalComponent, EngineeringQualitySnapshot } from './types.js';
import type { EquipmentRequirement, RequirementScopeReference, MatcherRequestPolicySnapshot, CalculationQualityGateDecision } from './equipmentRequirementTypes.js';
import { EQUIPMENT_REQUIREMENT_CONTRACT_ID, EQUIPMENT_REQUIREMENT_CONTRACT_VERSION, ENGINEERING_SCHEMA_ID } from './equipmentRequirementTypes.js';
import { CM7_GENERIC_CONFIGURATOR_POLICY_ID, CM7_GENERIC_CONFIGURATOR_POLICY_VERSION, CM8_SYSTEM_TOPOLOGY,
  CM8_SYSTEM_ARCHITECTURE_ID, CM8_SYSTEM_OPERATION_POLICY, CM8_SERVICE_INTENT, block,finite,canonicalNumber } from './policy.js';
import type { Diagnostics,OperatingGroup } from './policy.js';
import { heatPumpComponentInstanceId,fanCoilComponentInstanceId,requirementInstanceId,canonicalIds } from './componentIdentity.js';
import type { ValidatedRoom } from './validation.js';
import type { ResolvedMargins } from './margins.js';
import { capacityWithMargin } from './margins.js';
import type { OperatingConditionSets } from './operatingConditions.js';
function scopeCopy(scope:RequirementScopeReference):RequirementScopeReference {return {...scope,servedRoomIds:[...scope.servedRoomIds]};}
function matcherSnapshot(m:MatcherRequestPolicySnapshot):MatcherRequestPolicySnapshot {
  return {matcherModelId:m.matcherModelId,matcherModelVersion:m.matcherModelVersion,engineeringSchemaVersion:m.engineeringSchemaVersion,
    matcherPolicyId:m.matcherPolicyId,matcherPolicyVersion:m.matcherPolicyVersion,requiredVerificationTier:m.requiredVerificationTier,
    requireExactOperatingPoint:m.requireExactOperatingPoint,allowInterpolation:m.allowInterpolation,allowExtrapolation:m.allowExtrapolation,
    maxCandidates:m.maxCandidates,maxDiagnosticResults:m.maxDiagnosticResults};
}
export function createPhysicalComponents(input:EngineeringConfiguratorInput,rooms:readonly ValidatedRoom[]):PhysicalComponent[] {
  const hpId=heatPumpComponentInstanceId(input),roomIds=rooms.map(r=>r.roomId);
  const hpScope:RequirementScopeReference={scopeId:input.projectId,roomId:null,zoneId:null,systemId:hpId,servedRoomIds:[...roomIds]};
  const make=(id:string,type:'HEAT_PUMP'|'FAN_COIL',scope:'WHOLE_OBJECT'|'ROOM',reference:RequirementScopeReference,ids:readonly string[],zones:readonly string[]):PhysicalComponent=>({
    componentInstanceId:id,equipmentType:type,scope,scopeReference:reference,quantity:1,servedRoomIds:[...ids],servedZoneIds:canonicalIds(zones),
    serviceRequirementIds:[requirementInstanceId(id,'HEATING'),requirementInstanceId(id,'COOLING')],
  });
  return [make(hpId,'HEAT_PUMP','WHOLE_OBJECT',hpScope,roomIds,rooms.flatMap(r=>r.servedZoneIds)),
    ...rooms.map(room=>make(fanCoilComponentInstanceId({...input,roomId:room.roomId}),'FAN_COIL','ROOM',
      {scopeId:room.roomId,roomId:room.roomId,zoneId:null,systemId:hpId,servedRoomIds:[room.roomId]},[room.roomId],room.servedZoneIds))];
}
export function createRequirements(input:EngineeringConfiguratorInput,components:readonly PhysicalComponent[],rooms:readonly ValidatedRoom[],
  quality:EngineeringQualitySnapshot,qualityGate:CalculationQualityGateDecision,conditions:OperatingConditionSets,margins:ResolvedMargins,d:Diagnostics):EquipmentRequirement[] {
  const load=input.loadCalculation,roomMap=new Map(rooms.map(r=>[r.roomId,r]));
  const output:EquipmentRequirement[]=[];
  for(const component of components){
    const central=component.equipmentType==='HEAT_PUMP';
    for(const service of ['HEATING','COOLING'] as const){
      const heating=service==='HEATING';
      const group=`${central?'heatPump':'fanCoil'}${heating?'Heating':'Cooling'}` as OperatingGroup;
      const room=central?null:roomMap.get(component.scopeReference.roomId!)!;
      const sourceW=central?(heating?load.heatingDemandW!:load.coolingDemandW!):(heating?room!.load.heating.demandW!:room!.load.cooling.demandW!);
      const margin=capacityWithMargin(sourceW,margins[group]);
      if(!finite(margin.effectiveRequiredCapacity)){block(d,'DESIGN_MARGIN_INVALID',`designMargins.${group}`,component.scopeReference.roomId,service);continue;}
      const policy=matcherSnapshot(input.matcherRequestPolicy);
      output.push({contractId:EQUIPMENT_REQUIREMENT_CONTRACT_ID,contractVersion:EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
        requirementId:requirementInstanceId(component.componentInstanceId,service),requirementGroupId:null,
        physicalComponentRef:{componentInstanceId:component.componentInstanceId,selectionConstraint:'SAME_PRODUCT'},projectId:input.projectId,
        scope:component.scope,scopeReference:scopeCopy(component.scopeReference),systemTopologyId:CM8_SYSTEM_TOPOLOGY,systemArchitectureId:CM8_SYSTEM_ARCHITECTURE_ID,
        systemOperationPolicy:CM8_SYSTEM_OPERATION_POLICY,systemServiceIntent:CM8_SERVICE_INTENT,equipmentType:component.equipmentType,service,
        quantityStrategy:central?'SHARED':'PER_ROOM',quantity:{strategy:central?'SHARED':'PER_ROOM',targetQuantity:1,capacityBasis:central?'SYSTEM_TOTAL':'PER_ITEM',derivationReference:null,matcherMayMultiply:false},
        requiredCapacity:{parameterCode:heating?'heating_capacity':'cooling_capacity',requiredValue:margin.baseRequiredCapacity,unit:'kW',comparisonPolicy:'AT_LEAST',upperValue:null},
        operatingConditions:conditions[group].conditions.map(c=>({...c})),operatingConditionProvenance:conditions[group].provenance.map(p=>({...p})),
        requiredParameters:[],preferredParameters:[],excludedParameters:[],compatibilityRequirements:[],selectionMode:input.selectionIntent,
        calculationQualityGate:{...qualityGate,warnings:[...qualityGate.warnings],blockingReasons:[...qualityGate.blockingReasons]},
        sourceLoadReference:{sourceCalculationId:input.sourceCalculationId,sourceRevision:{projectRevision:input.projectRevision,systemsRevision:input.systemConfigurationRevision,
          loadCalculationRevision:input.loadCalculationRevision,methodId:load.methodId,methodVersion:load.methodVersion,loadMode:load.mode},
          sourceLoadType:central?(heating?'OBJECT_HEATING_DEMAND':'OBJECT_COOLING_DEMAND'):(heating?'ROOM_HEATING_DEMAND':'ROOM_COOLING_DEMAND'),
          sourceLoadW:canonicalNumber(sourceW),sourceRoomIds:[...component.servedRoomIds],sourceLoadDerivation:central?'DIRECT_OBJECT_TOTAL':'DIRECT_ROOM_RESULT',
          sourceQualityLevel:quality.maximumEligibleLevel,sourceRequestedQualityLevel:quality.requestedLevel,sourceQualityGateStatus:quality.gateStatus,
          sourceQualityModelId:quality.qualityModelId,sourceQualityModelVersion:quality.qualityModelVersion,
          sourceCoverage:{declaredAreaM2:quality.coverage.declaredAreaM2,modeledAreaM2:quality.coverage.modeledAreaM2,ratio:quality.coverage.ratio,scope:quality.coverage.scope,confirmation:quality.coverage.confirmation},
          climateDatasetId:load.climateDatasetId??null,climateDatasetVersion:load.climateDatasetVersion??null,climateLocationId:load.climateLocationId??null},
        designMargin:margin,notes:[],warnings:d.warnings.filter(w=>w.code!=='COMMERCE_REVISION_IGNORED').map(w=>({...w})),
        policyId:CM7_GENERIC_CONFIGURATOR_POLICY_ID,policyVersion:CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,matcherRequestPolicy:policy,
        revisionStamp:{projectId:input.projectId,projectRevision:input.projectRevision,systemConfigurationRevision:input.systemConfigurationRevision,
          loadCalculationRevision:input.loadCalculationRevision,sourceCalculationId:input.sourceCalculationId,
          configuratorPolicyId:CM7_GENERIC_CONFIGURATOR_POLICY_ID,configuratorPolicyVersion:CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,
          matcherModelId:policy.matcherModelId,matcherModelVersion:policy.matcherModelVersion,matcherPolicyId:policy.matcherPolicyId,matcherPolicyVersion:policy.matcherPolicyVersion,
          engineeringSchemaId:ENGINEERING_SCHEMA_ID,engineeringSchemaVersion:policy.engineeringSchemaVersion},
      });
    }
  }
  return output;
}
export function validateGeneratedComponents(components:readonly PhysicalComponent[],requirements:readonly EquipmentRequirement[],d:Diagnostics):void {
  const ids=new Set(components.map(c=>c.componentInstanceId));
  if(ids.size!==components.length||components.some(c=>c.quantity!==1)) block(d,'CANONICAL_VOCABULARY_INVALID','physical component identity/quantity');
  if(new Set(requirements.map(q=>q.requirementId)).size!==requirements.length) block(d,'CANONICAL_VOCABULARY_INVALID','requirement identity');
  for(const q of requirements){
    if(!q.physicalComponentRef||q.physicalComponentRef.selectionConstraint!=='SAME_PRODUCT'||!ids.has(q.physicalComponentRef.componentInstanceId))
      block(d,'CM7_1_PHYSICAL_COMPONENT_REFERENCE_REQUIRED','physicalComponentRef');
  }
  for(const component of components){const members=requirements.filter(q=>q.physicalComponentRef?.componentInstanceId===component.componentInstanceId);
    if(members.length!==2||members[0]?.service!=='HEATING'||members[1]?.service!=='COOLING') block(d,'CANONICAL_VOCABULARY_INVALID','component service pair');
  }
}
