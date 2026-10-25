import type { StalenessAssessmentInput,Cm81StaleAssessment,Cm81EngineeringStaleReason } from './types.js';
import { CM81_ENGINEERING_STALE_REASONS } from './types.js';
import { CONFIGURATOR_POLICY_ID,MATCHER_MODEL_ID,MATCHER_MODEL_VERSION,MATCHER_POLICY_ID,ENGINEERING_SCHEMA_ID,ENGINEERING_SCHEMA_VERSION } from './equipmentRequirementTypes.js';
import { ENGINEERING_CONFIGURATOR_POLICY_ID,ENGINEERING_CONFIGURATOR_POLICY_VERSION,CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,
  MATCHER_POLICY_VERSION,revision,validLoadRevision,validEngineeringRevision,validCommerceRevision } from './policy.js';
/** Comparison only. CURRENT use additionally requires a non-BLOCKED historical result. */
export function assessEngineeringConfiguratorStaleness(input:StalenessAssessmentInput):Cm81StaleAssessment {
  const h=input.historical,reasons=new Set<Cm81EngineeringStaleReason>();
  const mark=(reason:Cm81EngineeringStaleReason,condition:boolean)=>{if(condition)reasons.add(reason);};
  mark('PROJECT_REVISION_CHANGED',!revision(input.currentProjectRevision)||!revision(h.projectRevision)||h.projectRevision!==input.currentProjectRevision);
  mark('LOAD_CALCULATION_REVISION_CHANGED',!validLoadRevision(input.currentLoadCalculationRevision)||!validLoadRevision(h.loadCalculationRevision)||h.loadCalculationRevision!==input.currentLoadCalculationRevision);
  mark('SYSTEM_CONFIGURATION_REVISION_CHANGED',!revision(input.currentSystemConfigurationRevision)||!revision(h.systemConfigurationRevision)||h.systemConfigurationRevision!==input.currentSystemConfigurationRevision);
  mark('CONFIGURATOR_POLICY_CHANGED',h.policyId!==ENGINEERING_CONFIGURATOR_POLICY_ID||h.policyVersion!==ENGINEERING_CONFIGURATOR_POLICY_VERSION
    ||h.policyId!==input.currentConfiguratorPolicyId||h.policyVersion!==input.currentConfiguratorPolicyVersion);
  if(!validEngineeringRevision(input.currentEngineeringCatalogStateRevision)||!validEngineeringRevision(h.engineeringCatalogStateRevision)) reasons.add('ENGINEERING_CATALOG_STATE_UNAVAILABLE');
  else mark('ENGINEERING_CATALOG_STATE_CHANGED',h.engineeringCatalogStateRevision!==input.currentEngineeringCatalogStateRevision);
  const requirements=h.equipmentRequirements;
  if(requirements.length===0&&h.status!=='BLOCKED') throw new RangeError('READY history requires nonempty requirement stamps');
  if(requirements.length===0){
    mark('GENERIC_REQUIREMENT_POLICY_CHANGED',input.currentGenericRequirementPolicyVersion!==CM7_GENERIC_CONFIGURATOR_POLICY_VERSION);
    mark('MATCHER_MODEL_CHANGED',input.currentMatcherModelId!==MATCHER_MODEL_ID||input.currentMatcherModelVersion!==MATCHER_MODEL_VERSION);
    mark('MATCHER_POLICY_CHANGED',input.currentMatcherPolicyId!==MATCHER_POLICY_ID||input.currentMatcherPolicyVersion!==MATCHER_POLICY_VERSION);
    mark('ENGINEERING_SCHEMA_CHANGED',input.currentEngineeringSchemaId!==ENGINEERING_SCHEMA_ID||input.currentEngineeringSchemaVersion!==ENGINEERING_SCHEMA_VERSION);
  }
  for(const q of requirements){
    const stamp=q.revisionStamp,policy=q.matcherRequestPolicy,source=q.sourceLoadReference;
    mark('PROJECT_REVISION_CHANGED',q.projectId!==h.projectId||stamp?.projectId!==h.projectId||stamp?.projectRevision!==h.projectRevision
      ||source?.sourceRevision?.projectRevision!==h.projectRevision);
    mark('SYSTEM_CONFIGURATION_REVISION_CHANGED',stamp?.systemConfigurationRevision!==h.systemConfigurationRevision
      ||source?.sourceRevision?.systemsRevision!==h.systemConfigurationRevision);
    mark('LOAD_CALCULATION_REVISION_CHANGED',stamp?.loadCalculationRevision!==h.loadCalculationRevision||stamp?.sourceCalculationId!==h.loadCalculationRevision
      ||source?.sourceCalculationId!==h.loadCalculationRevision||source?.sourceRevision?.loadCalculationRevision!==h.loadCalculationRevision);
    mark('GENERIC_REQUIREMENT_POLICY_CHANGED',q.policyId!==CONFIGURATOR_POLICY_ID||stamp?.configuratorPolicyId!==CONFIGURATOR_POLICY_ID
      ||q.policyVersion!==CM7_GENERIC_CONFIGURATOR_POLICY_VERSION||stamp?.configuratorPolicyVersion!==q.policyVersion||q.policyVersion!==input.currentGenericRequirementPolicyVersion);
    mark('MATCHER_MODEL_CHANGED',policy?.matcherModelId!==MATCHER_MODEL_ID||policy?.matcherModelVersion!==MATCHER_MODEL_VERSION
      ||stamp?.matcherModelId!==policy?.matcherModelId||stamp?.matcherModelVersion!==policy?.matcherModelVersion
      ||policy?.matcherModelId!==input.currentMatcherModelId||policy?.matcherModelVersion!==input.currentMatcherModelVersion);
    mark('MATCHER_POLICY_CHANGED',policy?.matcherPolicyId!==MATCHER_POLICY_ID||policy?.matcherPolicyVersion!==MATCHER_POLICY_VERSION
      ||stamp?.matcherPolicyId!==policy?.matcherPolicyId||stamp?.matcherPolicyVersion!==policy?.matcherPolicyVersion
      ||policy?.matcherPolicyId!==input.currentMatcherPolicyId||policy?.matcherPolicyVersion!==input.currentMatcherPolicyVersion);
    mark('ENGINEERING_SCHEMA_CHANGED',stamp?.engineeringSchemaId!==ENGINEERING_SCHEMA_ID||stamp?.engineeringSchemaVersion!==ENGINEERING_SCHEMA_VERSION
      ||policy?.engineeringSchemaVersion!==stamp?.engineeringSchemaVersion||stamp?.engineeringSchemaId!==input.currentEngineeringSchemaId||stamp?.engineeringSchemaVersion!==input.currentEngineeringSchemaVersion);
  }
  let commerceComparisonStatus:Cm81StaleAssessment['commerceComparisonStatus']='NOT_TRACKED';
  if(validCommerceRevision(h.commerceStateRevision)) commerceComparisonStatus=!validCommerceRevision(input.currentCommerceStateRevision)?'NOT_COMPARED'
    :h.commerceStateRevision===input.currentCommerceStateRevision?'CURRENT':'STALE';
  const engineeringStaleReasons=CM81_ENGINEERING_STALE_REASONS.filter(reason=>reasons.has(reason));
  return {engineeringStale:engineeringStaleReasons.length>0,engineeringStaleReasons,commerceStale:commerceComparisonStatus==='STALE',
    commerceStaleReasons:commerceComparisonStatus==='STALE'?['COMMERCE_STATE_CHANGED']:[],commerceComparisonStatus};
}
