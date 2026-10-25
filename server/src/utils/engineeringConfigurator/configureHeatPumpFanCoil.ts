import type { EngineeringConfiguratorInput,EngineeringConfiguratorResult,SuccessfulEngineeringConfiguratorResult,BlockedEngineeringConfiguratorResult,
  Cm8Warning,Cm8BlockingReasonDetail } from './types.js';
import { EQUIPMENT_REQUIREMENT_CONTRACT_ID,EQUIPMENT_REQUIREMENT_CONTRACT_VERSION } from './equipmentRequirementTypes.js';
import { ENGINEERING_CONFIGURATOR_POLICY_ID,ENGINEERING_CONFIGURATOR_POLICY_VERSION,CM8_SYSTEM_TOPOLOGY,CM8_SYSTEM_ARCHITECTURE_ID,
  CM8_SYSTEM_OPERATION_POLICY,CM8_COMPLETENESS_STATE,validEngineeringRevision,validCommerceRevision,revision,block,warn,orderedWarnings,orderedBlockers } from './policy.js';
import type { Diagnostics } from './policy.js';
import { validateSnapshot } from './validation.js';
import { resolveOperatingConditions } from './operatingConditions.js';
import { resolveMargins } from './margins.js';
import { createPhysicalComponents,createRequirements,validateGeneratedComponents } from './requirements.js';
type Envelope=Omit<EngineeringConfiguratorResult,'status'|'physicalComponents'|'equipmentRequirements'|'warnings'|'blockingReasons'>;
function blockedResult(envelope:Envelope,d:Diagnostics):BlockedEngineeringConfiguratorResult {
  if(d.blockingReasons.length===0) block(d,'CANONICAL_VOCABULARY_INVALID','validated context unavailable');
  return {...envelope,status:'BLOCKED',physicalComponents:[],equipmentRequirements:[],warnings:orderedWarnings(d.warnings),
    blockingReasons:orderedBlockers(d.blockingReasons) as [Cm8BlockingReasonDetail,...Cm8BlockingReasonDetail[]]};
}
/** Pure, synchronous, snapshot-only. It establishes no live catalog freshness or matched-product claim. */
export function configureHeatPumpFanCoil(input:EngineeringConfiguratorInput):SuccessfulEngineeringConfiguratorResult|BlockedEngineeringConfiguratorResult {
  input=input??{} as EngineeringConfiguratorInput;
  const d:Diagnostics={blockingReasons:[],warnings:[]};
  const engineering=validEngineeringRevision(input.engineeringCatalogStateRevision)?input.engineeringCatalogStateRevision:null;
  const commerce=validCommerceRevision(input.commerceStateRevision)?input.commerceStateRevision:undefined;
  if(engineering===null) block(d,input.engineeringCatalogStateRevision===undefined?'ENGINEERING_CATALOG_STATE_REQUIRED':'ENGINEERING_CATALOG_STATE_INVALID','engineeringCatalogStateRevision');
  if(input.commerceStateRevision!==undefined&&commerce===undefined) warn(d,'COMMERCE_REVISION_IGNORED','Malformed optional commerce reference omitted.','commerceStateRevision');
  const envelope:Envelope={policyId:ENGINEERING_CONFIGURATOR_POLICY_ID,policyVersion:ENGINEERING_CONFIGURATOR_POLICY_VERSION,
    equipmentRequirementContractId:EQUIPMENT_REQUIREMENT_CONTRACT_ID,equipmentRequirementContractVersion:EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
    projectId:typeof input.projectId==='string'?input.projectId:'',projectRevision:revision(input.projectRevision)?input.projectRevision:0,
    loadCalculationRevision:typeof input.loadCalculationRevision==='string'?input.loadCalculationRevision:'',
    systemConfigurationRevision:revision(input.systemConfigurationRevision)?input.systemConfigurationRevision:0,
    systemTopology:CM8_SYSTEM_TOPOLOGY,systemArchitectureId:CM8_SYSTEM_ARCHITECTURE_ID,systemOperationPolicy:CM8_SYSTEM_OPERATION_POLICY,
    engineeringCatalogStateRevision:engineering,...(commerce===undefined?{}:{commerceStateRevision:commerce}),
    engineeringStale:engineering===null,engineeringStaleReasons:engineering===null?['ENGINEERING_CATALOG_STATE_UNAVAILABLE']:[],
    commerceStale:false,commerceStaleReasons:[],commerceComparisonStatus:commerce===undefined?'NOT_TRACKED':'NOT_COMPARED',completenessState:CM8_COMPLETENESS_STATE};
  const context=validateSnapshot(input,d);
  if(d.blockingReasons.length>0||!context.quality||!context.qualityGate) return blockedResult(envelope,d);
  const conditions=resolveOperatingConditions(input,context.rooms,d),margins=resolveMargins(input,d);
  if(d.blockingReasons.length>0) return blockedResult(envelope,d);
  warn(d,'PILOT_CORE_SELECTION_ONLY','Only central heat pump and room fan coils; not a complete installable system.');
  warn(d,'COMPATIBILITY_UNKNOWN','Compatibility is not established by this pilot.');
  d.warnings=orderedWarnings(d.warnings);
  const physicalComponents=createPhysicalComponents(input,context.rooms);
  const equipmentRequirements=createRequirements(input,physicalComponents,context.rooms,context.quality,context.qualityGate,conditions,margins,d);
  validateGeneratedComponents(physicalComponents,equipmentRequirements,d);
  if(d.blockingReasons.length>0) return blockedResult(envelope,d);
  return {...envelope,status:'READY_WITH_WARNINGS',engineeringCatalogStateRevision:engineering!,physicalComponents,equipmentRequirements,
    warnings:orderedWarnings(d.warnings) as [Cm8Warning,...Cm8Warning[]],blockingReasons:[]};
}
/** Exact function name declared by CM8.1, retained as a pure alias. */
export const generateHeatPumpFanCoilRequirements=configureHeatPumpFanCoil;
