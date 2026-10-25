/**
 * CM11 adapter — canonical load-facts projection and external reference validation.
 *
 * CM11 does NOT produce any fingerprint: it projects the supplied immutable load
 * into the frozen allowlist shape and structurally compares it against the
 * externally supplied loadRevisionReference.canonicalFacts. No hashing occurs here.
 */
import type {
  AdapterLoadCalculation,
  CanonicalLoadFingerprintFacts,
  CanonicalRoomLoadFacts,
  CanonicalServiceLoadFacts,
  CanonicalQualityFacts,
  CanonicalQualityField,
  CanonicalBlockingField,
  CoverageIntent,
  SystemEngineeringDesignInputs,
  LoadRevisionReference,
  EngineeringCatalogStateReference,
} from "./types.js";
import {
  LOAD_CANONICAL_DOMAIN,
  LOAD_CANONICAL_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
} from "./types.js";
import type { EngineeringCatalogStateRevision } from "../engineeringConfigurator/types.js";
import type { Diagnostics } from "./policy.js";
import {
  block,
  warn,
  canonicalIds,
  compareCodePoints,
  deepEqual,
  validLoadRevision,
  validEngineeringCatalogRevision,
  nonEmpty,
} from "./policy.js";

function serviceFacts(id: "heating" | "cooling", room: AdapterLoadCalculation["roomResults"][number]): CanonicalServiceLoadFacts {
  const s = room[id];
  return {
    status: s.status,
    demandW: s.demandW,
    partialDemandW: s.partialDemandW ?? null,
    warnings: canonicalIds(s.warnings ?? []),
    missingInputs: canonicalIds(s.missingInputs ?? []),
  };
}

/** Project the supplied load into the frozen canonical allowlist (exact CM10 §9). */
export function projectCanonicalLoadFacts(
  load: AdapterLoadCalculation,
  projectId: string,
  objectType: string,
  intent: CoverageIntent,
  design: SystemEngineeringDesignInputs,
): CanonicalLoadFingerprintFacts {
  const rooms = [...load.roomResults]
    .sort((a, b) => compareCodePoints(a.roomId, b.roomId))
    .map<CanonicalRoomLoadFacts>((r) => ({
      roomId: r.roomId,
      roomType: r.roomType,
      areaM2: r.areaM2,
      heating: serviceFacts("heating", r),
      cooling: serviceFacts("cooling", r),
      transmissionBreakdown: r.transmissionBreakdown
        ? {
            indoorHeatingC: r.transmissionBreakdown.indoorHeatingC,
            indoorCoolingC: r.transmissionBreakdown.indoorCoolingC,
            outdoorHeatingC: r.transmissionBreakdown.outdoorHeatingC,
            outdoorCoolingC: r.transmissionBreakdown.outdoorCoolingC,
          }
        : null,
    }));

  const quality = load.engineeringQuality!;
  const qualityFacts: CanonicalQualityFacts = {
    qualityModelId: quality.qualityModelId,
    qualityModelVersion: quality.qualityModelVersion,
    requestedLevel: quality.requestedLevel,
    maximumEligibleLevel: quality.maximumEligibleLevel,
    gateStatus: quality.gateStatus,
    coverage: {
      declaredAreaM2: quality.coverage.declaredAreaM2,
      modeledAreaM2: quality.coverage.modeledAreaM2,
      ratio: quality.coverage.ratio,
      scope: quality.coverage.scope,
      confirmation: quality.coverage.confirmation,
    },
    fields: [...quality.fields]
      .sort((a, b) => compareCodePoints(a.fieldId, b.fieldId))
      .map<CanonicalQualityField>((f) => ({
        fieldId: f.fieldId,
        roomId: f.roomId ?? null,
        parameter: f.parameter,
        service: f.service ?? null,
        effectiveValue: f.effectiveValue,
        unit: f.unit ?? null,
        effectiveProvenance: f.effectiveProvenance,
        userConfirmed: f.userConfirmed,
        quality: f.quality,
        criticality: f.criticality,
        requiredQuality: f.requiredQuality,
        status: f.status,
        sourceReference: f.sourceReference ?? null,
        messageCode: f.messageCode ?? null,
        supersededBy: canonicalIds(f.supersededBy ?? []),
      })),
    blockingFields: [...quality.blockingFields]
      .sort(
        (a, b) =>
          compareCodePoints(a.fieldId, b.fieldId) ||
          compareCodePoints(a.service ?? "", b.service ?? "") ||
          compareCodePoints(a.reasonCode, b.reasonCode),
      )
      .map<CanonicalBlockingField>((f) => ({
        fieldId: f.fieldId,
        roomId: f.roomId ?? null,
        service: f.service ?? null,
        parameter: f.parameter,
        reasonCode: f.reasonCode,
        requiredQuality: f.requiredQuality,
        requiredProvenance: (f.requiredProvenance ?? []).slice().sort(compareCodePoints),
      })),
    warnings: canonicalIds(quality.warnings ?? []),
  };

  const snapRooms = [...load.inputSnapshot.rooms]
    .sort((a, b) => compareCodePoints(a.id, b.id))
    .map((r) => ({ id: r.id, roomType: r.roomType, areaM2: r.areaM2, floorId: r.floorId ?? null }));
  const prefs = [...load.inputSnapshot.servicePreferences]
    .sort((a, b) => compareCodePoints(a.roomId, b.roomId))
    .map((p) => ({ roomId: p.roomId, heating: p.heating, cooling: p.cooling }));

  return {
    domain: LOAD_CANONICAL_DOMAIN,
    algorithmVersion: LOAD_CANONICAL_ALGORITHM_VERSION,
    projectId,
    buildingRevisionAtCalculation: load.buildingRevisionAtCalculation,
    systemsRevisionAtCalculation: load.systemsRevisionAtCalculation,
    mode: load.mode,
    status: load.status,
    methodId: load.methodId,
    methodVersion: load.methodVersion,
    heatingDemandW: load.heatingDemandW,
    coolingDemandW: load.coolingDemandW,
    partialHeatingDemandW: load.partialHeatingDemandW ?? null,
    partialCoolingDemandW: load.partialCoolingDemandW ?? null,
    warnings: canonicalIds(load.warnings ?? []),
    missingInputs: canonicalIds(load.missingInputs ?? []),
    roomResults: rooms,
    engineeringQuality: qualityFacts,
    climateDatasetId: load.climateDatasetId ?? null,
    climateDatasetVersion: load.climateDatasetVersion ?? null,
    climateLocationId: load.climateLocationId ?? null,
    inputSnapshot: {
      projectId: load.inputSnapshot.projectId,
      objectType: objectType as CanonicalLoadFingerprintFacts["inputSnapshot"]["objectType"],
      buildingRevision: load.inputSnapshot.buildingRevision,
      systemsRevision: load.inputSnapshot.systemsRevision,
      mode: load.inputSnapshot.mode,
      methodVersion: load.inputSnapshot.methodVersion,
      requestedServices: ["heating", "cooling"],
      rooms: snapRooms,
      servicePreferences: prefs,
      calculationConfiguration: { coverageIntent: intent },
      systemEngineeringDesignInputs: {
        hydronicDesignConditions: design.hydronicDesignConditions,
        coolingIndoorDesignCondition: design.coolingIndoorDesignCondition,
        fanCoilSizingPolicy: design.fanCoilSizingPolicy,
        designMargins: design.designMargins!,
      },
    },
  };
}

export interface LoadRevisionToken {
  revision: string;
  sourceCalculationId: string;
  algorithmVersion: string;
}

/**
 * Validate the externally supplied load revision reference (§12). `projectedFacts`
 * is null when a required parent (design/quality/coverage) is itself missing, in
 * which case no child facts-mismatch is emitted (missing-parent rule).
 */
export function validateLoadRevisionReference(
  ref: LoadRevisionReference | null | undefined,
  projectedFacts: CanonicalLoadFingerprintFacts | null,
  d: Diagnostics,
): LoadRevisionToken | null {
  if (!ref || ref.status !== "AVAILABLE") {
    block(d, "LOAD_REVISION_UNAVAILABLE", "loadRevisionReference");
    return null;
  }
  const malformed =
    !validLoadRevision(ref.revision) ||
    !validLoadRevision(ref.sourceCalculationId) ||
    ref.sourceCalculationId !== ref.revision ||
    ref.algorithmVersion !== LOAD_CANONICAL_ALGORITHM_VERSION ||
    (ref.errors as readonly unknown[]).length !== 0;
  if (malformed) {
    block(d, "LOAD_CALCULATION_REVISION_STALE", "loadRevisionReference (token/algorithm/sourceCalculationId)");
    return null;
  }
  if (projectedFacts !== null && !deepEqual(projectedFacts, ref.canonicalFacts)) {
    block(d, "LOAD_CALCULATION_REVISION_STALE", "loadRevisionReference.canonicalFacts mismatch");
    return null;
  }
  return { revision: ref.revision as string, sourceCalculationId: ref.sourceCalculationId as string, algorithmVersion: ref.algorithmVersion as string };
}

/**
 * Validate the externally supplied engineering catalog state reference (§27).
 * No SQL producer, no DB query, no fallback (§37).
 */
export function validateEngineeringCatalogReference(
  ref: EngineeringCatalogStateReference | null | undefined,
  d: Diagnostics,
): EngineeringCatalogStateRevision | null {
  if (!ref || ref.status !== "AVAILABLE") {
    block(d, "ENGINEERING_CATALOG_STATE_UNAVAILABLE", "engineeringCatalogStateReference");
    return null;
  }
  if (!validEngineeringCatalogRevision(ref.revision) || !nonEmpty(ref.revision as string)) {
    block(d, "ENGINEERING_CATALOG_STATE_INVALID", "engineeringCatalogStateReference.revision");
    return null;
  }
  const policyOk =
    ref.generatedFromPolicyId === "ohmx.engineering-configurator.heat-pump-fan-coil.v1" &&
    ref.generatedFromPolicyVersion === "1.1.0" &&
    ref.algorithmVersion === ENGINEERING_CATALOG_ALGORITHM_VERSION &&
    ref.readConsistency === "COMPLETE_COHERENT_SNAPSHOT" &&
    (ref.errors as readonly unknown[]).length === 0 &&
    Array.isArray(ref.scopeEquipmentTypes) &&
    ref.scopeEquipmentTypes.length === ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES.length &&
    ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES.every((t) => (ref.scopeEquipmentTypes as readonly string[]).includes(t));
  if (!policyOk) {
    block(d, "POLICY_ID_VERSION_INVALID", "engineeringCatalogStateReference (scope/algorithm/policy)");
    return null;
  }
  for (const w of ref.warnings as readonly { code?: unknown; sourceReference?: unknown; message?: unknown }[]) {
    warn(
      d,
      "ENGINEERING_CATALOG_STATE_PROVIDER_WARNING",
      "engineeringCatalogStateReference",
      `Provider warning ${w?.code ?? "unknown"}: ${w?.message ?? ""}`,
      typeof w?.sourceReference === "string" ? w.sourceReference : null,
    );
  }
  return ref.revision as EngineeringCatalogStateRevision;
}