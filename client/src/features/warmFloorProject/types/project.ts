/** Drop-in types for multi-room warm floor project UI (recovery patch). */

export type EngineeringStatus = 'PASS' | 'WARNING' | 'BLOCKED';
export type ProjectStatus = 'draft' | 'confirmed';
export type ObjectType = 'apartment' | 'private_house' | string;

export interface ProjectRoomInput {
  id?: string;
  name: string;
  roomType: string;
  roomAreaM2: number;
  installationAreaM2: number;
  heatingPurpose: string;
  floorCovering: string;
  substrateType: string;
  insulationLevel?: string;
  systemPreference?: 'auto' | 'mat' | 'cable';
  wetZone?: boolean;
  heatLossW?: number | null;
  notes?: string;
}

export interface WarmFloorProjectDto {
  id: string;
  name: string;
  status: ProjectStatus;
  preferredBundleRole: string;
  objectType?: ObjectType | null;
  objectTotalAreaM2?: number | null;
  rooms: ProjectRoomInput[];
  draftResult: any | null;
  confirmedSnapshot: any | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}
