/**
 * Engineering Catalog V1 - Type Definitions
 */

export enum TrustLevel {
  MANUFACTURER_VERIFIED = 'manufacturer_verified',
  ADMIN_VERIFIED = 'admin_verified',
  SUPPLIER_STRUCTURED = 'supplier_structured',
  AI_EXTRACTED_HIGH = 'ai_extracted_high',
  AI_EXTRACTED_LOW = 'ai_extracted_low',
  CONFLICT = 'conflict'
}

export enum ReviewStatus {
  CANDIDATE = 'candidate',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUPERSEDED = 'superseded'
}

export enum SourceType {
  TECHNICAL_PASSPORT = 'technical_passport',
  MANUFACTURER_WEBSITE = 'manufacturer_website',
  SUPPLIER_CSV = 'supplier_csv',
  ADMIN_MANUAL = 'admin_manual',
  AI_INFERENCE = 'ai_inference'
}

export interface ProvenanceSource {
  id: string;
  type: SourceType;
  name: string;
  url?: string;
  priority: number; // Lower is higher priority
}

export interface EngineeringAttribute<T = any> {
  product_id: number;
  attr_key: string;
  value_normalized: T;
  unit_canonical?: string;
  value_raw: string;
  source_id: string;
  source_ref?: string;
  trust_level: TrustLevel;
  confidence: number; // 0.0 - 1.0
  review_status: ReviewStatus;
  validation_output?: {
    status: 'valid' | 'warning' | 'error';
    messages: string[];
  };
  version_contract: string;
  created_at: string;
  updated_at: string;
}

/**
 * Pilot: Electric Warm Floor Contracts
 */

export enum WarmFloorType {
  CABLE = 'cable',
  MAT = 'mat',
  FILM = 'film'
}

export enum MountingType {
  DIN_RAIL = 'din_rail',
  FLUSH_MOUNT = 'flush_mount',
  SURFACE_MOUNT = 'surface_mount'
}

export interface WarmFloorAttributes {
  warm_floor_type?: WarmFloorType;
  linear_power_wm?: number;
  total_power_w?: number;
  length_m?: number;
  area_m2?: number;
  voltage_v?: number;
  conductor_count?: 1 | 2;
  cold_tail_length_m?: number;
}

export interface ThermostatAttributes {
  max_load_a?: number;
  max_load_w?: number;
  sensor_type_ntc?: number;
  mounting_type?: MountingType;
  has_air_sensor?: boolean;
  has_floor_sensor?: boolean;
  wifi_enabled?: boolean;
}
