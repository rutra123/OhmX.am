import type { EngineeringConfiguratorInput } from './types.js';
type IdentityContext = Pick<EngineeringConfiguratorInput,'projectId'|'projectRevision'|'systemConfigurationRevision'>;

/** Unicode code-point order, independent of locale and UTF-16 surrogate ordering. */
export function compareCodePoints(a: string,b: string): number {
  const x=Array.from(a), y=Array.from(b);
  for(let j=0;j<Math.min(x.length,y.length);j++){
    const difference=x[j].codePointAt(0)!-y[j].codePointAt(0)!;
    if(difference!==0) return difference;
  }
  return x.length-y.length;
}
export function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareCodePoints);
}
export function validStableId(value: unknown): value is string {
  if(typeof value!=='string'||value.trim().length===0) return false;
  for(const char of value){const cp=char.codePointAt(0)!;if(cp>=0xd800&&cp<=0xdfff)return false;}
  return true;
}
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function heatPumpComponentInstanceId(input: IdentityContext): string {
  return `component:${encode(input.projectId)}:b${input.projectRevision}:s${input.systemConfigurationRevision}:shared:system:heat-pump:01`;
}
export function fanCoilComponentInstanceId(input: IdentityContext & {roomId:string}): string {
  return `component:${encode(input.projectId)}:b${input.projectRevision}:s${input.systemConfigurationRevision}:room:${encode(input.roomId)}:fan-coil:01`;
}
export function requirementInstanceId(componentInstanceId:string,service:'HEATING'|'COOLING'):string {
  return `requirement:${componentInstanceId}:${service}`;
}
