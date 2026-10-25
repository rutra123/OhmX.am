import { CM8_BLOCKING_REASONS, CM8_WARNING_CODES } from './types.js';
import type { Cm8BlockingReason, Cm8BlockingReasonDetail, Cm8Warning, Cm8WarningCode,
  EngineeringCatalogStateRevision, CommerceStateRevision } from './types.js';
import { compareCodePoints } from './componentIdentity.js';
export { ENGINEERING_CONFIGURATOR_POLICY_ID, ENGINEERING_CONFIGURATOR_POLICY_VERSION,
  CM7_GENERIC_CONFIGURATOR_POLICY_ID, CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,
  CM8_SYSTEM_TOPOLOGY, CM8_SYSTEM_ARCHITECTURE_ID, CM8_SYSTEM_OPERATION_POLICY, CM8_SERVICE_INTENT,
  CM8_REVERSIBLE_SOURCE_FAMILY_ID, CM8_FAN_COIL_FAMILY_ID, CM8_COMPLETENESS_STATE,
  CM8_MINIMUM_PROFESSIONAL_USE_LEVEL, CM8_COVERAGE_AREA_EPSILON_M2, CM8_COVERAGE_RATIO_EPSILON } from './types.js';
export const MATCHER_POLICY_VERSION='1.0.0' as const;
export const VERIFICATION_REQUIREMENTS=['ANY_KNOWN','VERIFIED_SECONDARY','AUTHORITATIVE'] as const;
export const OPERATING_GROUPS=['heatPumpHeating','heatPumpCooling','fanCoilHeating','fanCoilCooling'] as const;
export type OperatingGroup=(typeof OPERATING_GROUPS)[number];
export interface Diagnostics { blockingReasons:Cm8BlockingReasonDetail[]; warnings:Cm8Warning[] }
export function finite(value:unknown):value is number {return typeof value==='number'&&Number.isFinite(value);}
export function nonNegative(value:unknown):value is number {return finite(value)&&value>=0;}
export function revision(value:unknown):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
export function nonEmpty(value:unknown):value is string {return typeof value==='string'&&value.trim().length>0;}
export function strings(value:unknown):value is string[] {return Array.isArray(value)&&value.every(x=>typeof x==='string');}
export function canonicalNumber(value:number):number {return value===0?0:value;}
function token(value:unknown,prefix:string):boolean {
  return typeof value==='string'&&value.startsWith(prefix)&&value.length===prefix.length+64&&/^[0-9a-f]{64}$/.test(value.slice(prefix.length));
}
export function validLoadRevision(value:unknown):value is string {return token(value,'load:sha256:');}
export function validEngineeringRevision(value:unknown):value is EngineeringCatalogStateRevision {return token(value,'engineering-catalog-state:sha256:');}
export function validCommerceRevision(value:unknown):value is CommerceStateRevision {return token(value,'commerce-state:sha256:');}
export function block(d:Diagnostics,code:Cm8BlockingReason,path:string,roomId:string|null=null,service:'HEATING'|'COOLING'|null=null):void {
  d.blockingReasons.push({code,message:`${code}: ${path}`,sourceReference:path,roomId,service});
}
export function warn(d:Diagnostics,code:Cm8WarningCode,message:string,sourceReference:string|null=null):void {
  d.warnings.push({code,message,sourceReference});
}
export function orderedWarnings(rows:readonly Cm8Warning[]):Cm8Warning[] {
  const unique=new Map(rows.map(row=>[JSON.stringify(row),row]));
  return [...unique.values()].sort((a,b)=>CM8_WARNING_CODES.indexOf(a.code)-CM8_WARNING_CODES.indexOf(b.code)
    ||compareCodePoints(a.sourceReference??'',b.sourceReference??'')||compareCodePoints(a.message,b.message));
}
export function orderedBlockers(rows:readonly Cm8BlockingReasonDetail[]):Cm8BlockingReasonDetail[] {
  const unique=new Map(rows.map(row=>[JSON.stringify(row),row]));
  return [...unique.values()].sort((a,b)=>CM8_BLOCKING_REASONS.indexOf(a.code)-CM8_BLOCKING_REASONS.indexOf(b.code)
    ||compareCodePoints(a.roomId??'',b.roomId??'')||compareCodePoints(a.service??'',b.service??'')
    ||compareCodePoints(a.sourceReference??'',b.sourceReference??''));
}
