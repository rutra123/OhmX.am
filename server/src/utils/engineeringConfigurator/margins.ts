import type { EngineeringConfiguratorInput, ConfiguratorDesignMarginInput } from './types.js';
import type { DesignMargin, MarginPolicySource } from './equipmentRequirementTypes.js';
import type { OperatingGroup,Diagnostics } from './policy.js';
import { OPERATING_GROUPS,block,finite,nonEmpty,canonicalNumber } from './policy.js';
export type ResolvedMargins=Record<OperatingGroup,ConfiguratorDesignMarginInput>;
const SOURCE_MAP:Readonly<Record<string,MarginPolicySource>>={NONE:'NONE',USER_INPUT:'EXPLICIT_USER',SYSTEM_POLICY:'CONFIGURATOR_POLICY'};
export function resolveMargins(input:EngineeringConfiguratorInput,d:Diagnostics):ResolvedMargins {
  const out={} as ResolvedMargins;
  for(const group of OPERATING_GROUPS){
    const supplied=input.designMargins?.[group];
    const margin=supplied===undefined?{designMarginPercent:0,marginSource:'NONE' as const,marginPolicyId:null,marginPolicyVersion:null}:supplied;
    if(!margin||!finite(margin.designMarginPercent)||margin.designMarginPercent<0||!['NONE','USER_INPUT','SYSTEM_POLICY'].includes(margin.marginSource)
      ||(margin.designMarginPercent!==0&&margin.marginSource==='NONE')
      ||!(margin.marginPolicyId===null||nonEmpty(margin.marginPolicyId))||!(margin.marginPolicyVersion===null||nonEmpty(margin.marginPolicyVersion))
      ||(margin.marginSource==='NONE'&&(margin.marginPolicyId!==null||margin.marginPolicyVersion!==null))){block(d,'DESIGN_MARGIN_INVALID',`designMargins.${group}`);continue;}
    out[group]={designMarginPercent:canonicalNumber(margin.designMarginPercent),marginSource:margin.marginSource,marginPolicyId:margin.marginPolicyId,marginPolicyVersion:margin.marginPolicyVersion};
  }
  return out;
}
export function capacityWithMargin(sourceLoadW:number,margin:ConfiguratorDesignMarginInput):DesignMargin {
  const base=canonicalNumber(sourceLoadW/1000);
  return {baseRequiredCapacity:base,unit:'kW',designMarginPercent:margin.designMarginPercent,
    effectiveRequiredCapacity:base*(1+margin.designMarginPercent/100),marginPolicySource:SOURCE_MAP[margin.marginSource],
    marginPolicyId:margin.marginPolicyId,marginPolicyVersion:margin.marginPolicyVersion};
}
