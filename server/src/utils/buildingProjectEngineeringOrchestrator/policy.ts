/**
 * CM16 — frozen policy identity / matcher-request-policy constructors.
 *
 * These two objects are REQUIRED by the CM11 adapter input and are assembled
 * here from the single source-of-truth frozen literals, NOT re-declared:
 *   - adapter contract identity      → buildingProjectConfiguratorAdapter/types.js
 *   - topology / configurator policy → engineeringConfigurator/types.js
 *   - matcher / requirement / schema / quality identities → equipmentRequirementTypes.js
 *
 * CM16 assembles; CM11 validates. These constructors contain no validation and
 * no runtime side effects.
 */
import {
  ADAPTER_CONTRACT_ID,
  ADAPTER_CONTRACT_VERSION,
  type AdapterPolicyIdentities,
} from "../buildingProjectConfiguratorAdapter/types.js";
import {
  ENGINEERING_CONFIGURATOR_POLICY_ID,
  ENGINEERING_CONFIGURATOR_POLICY_VERSION,
} from "../engineeringConfigurator/types.js";
import {
  EQUIPMENT_REQUIREMENT_CONTRACT_ID,
  EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
  CONFIGURATOR_POLICY_ID,
  MATCHER_MODEL_ID,
  MATCHER_MODEL_VERSION,
  MATCHER_POLICY_ID,
  ENGINEERING_SCHEMA_ID,
  ENGINEERING_SCHEMA_VERSION,
  BUILDING_QUALITY_MODEL_ID,
  BUILDING_QUALITY_MODEL_VERSION,
  type MatcherRequestPolicySnapshot,
} from "../engineeringConfigurator/equipmentRequirementTypes.js";

/** Frozen generic-requirement policy version (CM7 generic policy). */
const GENERIC_REQUIREMENT_POLICY_VERSION = "1.0.0" as const;
/** Frozen matcher-policy version (CM10/CM11 contract literal). */
const MATCHER_POLICY_VERSION = "1.0.0" as const;

/**
 * The exact AdapterPolicyIdentities the CM11 policy bridge validates against
 * (revisionValidation.validatePolicyBridge). Fresh object per call.
 */
export function buildPolicyIdentities(): AdapterPolicyIdentities {
  return {
    adapterContract: { id: ADAPTER_CONTRACT_ID, version: ADAPTER_CONTRACT_VERSION },
    topologyPolicy: { id: ENGINEERING_CONFIGURATOR_POLICY_ID, version: ENGINEERING_CONFIGURATOR_POLICY_VERSION },
    equipmentRequirementContract: { id: EQUIPMENT_REQUIREMENT_CONTRACT_ID, version: EQUIPMENT_REQUIREMENT_CONTRACT_VERSION },
    genericRequirementPolicy: { id: CONFIGURATOR_POLICY_ID, version: GENERIC_REQUIREMENT_POLICY_VERSION },
    qualityModel: { id: BUILDING_QUALITY_MODEL_ID, version: BUILDING_QUALITY_MODEL_VERSION },
    engineeringSchema: { id: ENGINEERING_SCHEMA_ID, version: ENGINEERING_SCHEMA_VERSION },
    matcherModel: { id: MATCHER_MODEL_ID, version: MATCHER_MODEL_VERSION },
    matcherPolicy: { id: MATCHER_POLICY_ID, version: MATCHER_POLICY_VERSION },
  };
}

/**
 * The frozen MatcherRequestPolicySnapshot. Contains NO product candidates, no
 * commerce, no Matcher invocation — it is only the policy the (future) matcher
 * will be asked to honor. Exact operand semantics for pilot scope (exact
 * operating point required, no interpolation/extrapolation).
 */
export function buildMatcherRequestPolicy(): MatcherRequestPolicySnapshot {
  return {
    matcherModelId: MATCHER_MODEL_ID,
    matcherModelVersion: MATCHER_MODEL_VERSION,
    engineeringSchemaVersion: ENGINEERING_SCHEMA_VERSION,
    matcherPolicyId: MATCHER_POLICY_ID,
    matcherPolicyVersion: MATCHER_POLICY_VERSION,
    requiredVerificationTier: "ANY_KNOWN",
    requireExactOperatingPoint: true,
    allowInterpolation: false,
    allowExtrapolation: false,
    maxCandidates: 10,
    maxDiagnosticResults: 20,
  };
}