/**
 * Building Project Phase 3.2B — Object Type Profile + profile reference types.
 *
 * Typed foundation ONLY. No numeric profile values, no resolver behavior.
 * Semantics follow the frozen MASTER §4 (ObjectTypeProfile) / §48 (default profiles).
 */
import type { ObjectType } from './buildingProjectCatalog.js';
import type {
  EngineeringInputId,
  EngineeringProfileReference,
} from './buildingProjectEngineeringTypes.js';

/** Profile lifecycle status (frozen MASTER §24 / task PART 1). */
export type ProfileStatus = 'draft' | 'validated' | 'approved' | 'published' | 'deprecated';

/**
 * Alias preserving the existing exported name. The canonical shape is the shared
 * `EngineeringProfileReference` from the domain types module (no circular import).
 */
export type ProfileReference = EngineeringProfileReference;

/**
 * Object Type Profile (frozen MASTER §4.4).
 * `profileId` is constrained to the exact ObjectType tokens
 * (apartment | private_house | commercial); object type is rules, never a multiplier.
 */
export interface ObjectTypeProfile {
  profileId: ObjectType;
  objectType: ObjectType;
  title: string;
  version: string;
  applicability: string | null;
  requiredInputsQuick: readonly EngineeringInputId[];
  requiredInputsProfessional: readonly EngineeringInputId[];
  defaultProfileRefs: readonly EngineeringProfileReference[];
  geometryRules: readonly string[];
  exposureRules: readonly string[];
  ventilationRules: readonly string[];
  internalGainRules: readonly string[];
  allowedAutoDefaults: readonly string[];
  forbiddenAutoDefaults: readonly string[];
  warnings: readonly string[];
  status: ProfileStatus;
}

/** Versioned set of object-type profiles (frozen MASTER §34 axis objectTypeProfileSetVersion). */
export interface ObjectTypeProfileSet {
  objectTypeProfileSetVersion: string;
  profiles: readonly ObjectTypeProfile[];
}
