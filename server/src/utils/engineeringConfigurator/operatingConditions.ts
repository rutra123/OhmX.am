import type { CanonicalConditionKey, ConditionRequirement } from '../catalogMatcher/types.js';
import type { EngineeringConfiguratorInput, SourcedNumericOperatingInput, SourcedTextOperatingInput } from './types.js';
import type { OperatingConditionProvenance, OperatingConditionSource } from './equipmentRequirementTypes.js';
import type { ValidatedRoom } from './validation.js';
import type { Diagnostics,OperatingGroup } from './policy.js';
import { OPERATING_GROUPS,block,warn,finite,nonEmpty,canonicalNumber } from './policy.js';
export interface ResolvedConditions {conditions:ConditionRequirement[];provenance:OperatingConditionProvenance[]}
export type OperatingConditionSets=Record<OperatingGroup,ResolvedConditions>;
const SOURCES:Readonly<Record<string,OperatingConditionSource>>={USER_INPUT:'EXPLICIT_USER',SYSTEM_POLICY:'SYSTEM_CONFIGURATION',BUILDING_LOAD_CONTEXT:'BUILDING_LOAD_CONTEXT',PILOT_REFERENCE:'CONFIGURATOR_POLICY'};
type Spec={input:string;key:CanonicalConditionKey;context?:'indoorHeatingC'|'indoorCoolingC'|'outdoorHeatingC'|'outdoorCoolingC';text?:true};
export const CONDITION_SPECS:Readonly<Record<OperatingGroup,readonly Spec[]>>={
  heatPumpHeating:[{input:'outdoorHeatingDesignC',key:'outdoor_air_c',context:'outdoorHeatingC'},{input:'waterSupplyC',key:'water_supply_c'},{input:'waterReturnC',key:'water_return_c'}],
  heatPumpCooling:[{input:'outdoorCoolingDesignC',key:'outdoor_air_c',context:'outdoorCoolingC'},{input:'waterSupplyC',key:'water_supply_c'},{input:'waterReturnC',key:'water_return_c'}],
  fanCoilHeating:[{input:'waterInC',key:'water_in_c'},{input:'waterOutC',key:'water_out_c'},{input:'indoor_air_c',key:'indoor_air_dry_bulb_c',context:'indoorHeatingC'},{input:'sizingFanSpeed',key:'fan_speed',text:true}],
  fanCoilCooling:[{input:'waterInC',key:'water_in_c'},{input:'waterOutC',key:'water_out_c'},{input:'indoorAirDryBulbC',key:'indoor_air_dry_bulb_c',context:'indoorCoolingC'},{input:'indoorAirWetBulbC',key:'indoor_air_wet_bulb_c'},{input:'sizingFanSpeed',key:'fan_speed',text:true}],
};
export function resolveOperatingConditions(input:EngineeringConfiguratorInput,rooms:readonly ValidatedRoom[],d:Diagnostics):OperatingConditionSets {
  const output={} as OperatingConditionSets;
  for(const group of OPERATING_GROUPS){
    const resolved:ResolvedConditions={conditions:[],provenance:[]};output[group]=resolved;
    const supplied=input.operatingConditions?.[group] as unknown as Record<string,SourcedNumericOperatingInput|SourcedTextOperatingInput>|undefined;
    for(const spec of CONDITION_SPECS[group]){
      const value=supplied?.[spec.input],path=`operatingConditions.${group}.${spec.input}`;
      const error=spec.text?'FAN_SPEED_REQUIRED':'OPERATING_CONDITION_REQUIRED';
      const validSource=spec.context?value?.source==='BUILDING_LOAD_CONTEXT':value&&['USER_INPUT','SYSTEM_POLICY','PILOT_REFERENCE'].includes(value.source);
      if(!value||value.status!=='RESOLVED'||!validSource||!nonEmpty(value.sourceReference)
        ||(spec.text?(!nonEmpty(value.value)||value.unit!==null):(!finite(value.value)||value.unit!=='°C'))
        ||(value.source==='PILOT_REFERENCE'&&input.selectionIntent==='PROFESSIONAL')){block(d,error,path);continue;}
      if(value.source==='PILOT_REFERENCE') warn(d,'PILOT_REFERENCE_OPERATING_INPUT','Explicit preliminary-only reference; not Professional evidence.',path);
      if(spec.context){
        for(const room of rooms){const expected=room.load.transmissionBreakdown?.[spec.context];
          if(!finite(expected)) block(d,'OPERATING_CONDITION_REQUIRED',`roomResults.transmissionBreakdown.${spec.context}`,room.roomId);
          else if(expected!==value.value) block(d,'OPERATING_CONDITION_CONFLICT',path,room.roomId);
        }
      }
      resolved.conditions.push({conditionKey:spec.key,valueNumeric:spec.text?null:canonicalNumber(value.value as number),valueText:spec.text?value.value as string:null,valueBoolean:null,unit:spec.text?null:'°C',matchPolicy:'EXACT'});
      resolved.provenance.push({conditionKey:spec.key,source:SOURCES[value.source],sourceReference:value.sourceReference});
    }
  }
  const numeric=(group:OperatingGroup,key:CanonicalConditionKey)=>output[group].conditions.find(c=>c.conditionKey===key)?.valueNumeric;
  for(const season of ['Heating','Cooling'] as const){
    const hp=`heatPump${season}` as OperatingGroup,fc=`fanCoil${season}` as OperatingGroup;
    const supply=numeric(hp,'water_supply_c'),ret=numeric(hp,'water_return_c'),waterIn=numeric(fc,'water_in_c'),waterOut=numeric(fc,'water_out_c');
    if(finite(supply)&&finite(waterIn)&&supply!==waterIn) block(d,'OPERATING_CONDITION_CONFLICT',`${hp} supply = ${fc} water-in`);
    if(finite(ret)&&finite(waterOut)&&ret!==waterOut) block(d,'OPERATING_CONDITION_CONFLICT',`${hp} return = ${fc} water-out`);
    if(finite(supply)&&finite(ret)&&(season==='Heating'?supply<=ret:supply>=ret)) block(d,'OPERATING_CONDITION_CONFLICT',`${hp} seasonal temperature ordering`);
  }
  return output;
}
