/** CM17 focused behavior tests. WRITTEN ONLY; agent does not execute them. */
import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  runBuildingProjectEngineeringConfiguration,
  type ConfiguredLiveOrchestrationResult,
} from "../buildingProjectEngineeringOrchestrator/index.js";
import {
  CATALOG_TOKEN,
  makeAvailableProvider,
  makeValidLiveProject,
} from "../buildingProjectEngineeringOrchestrator/fixtures.js";
import type { CatalogMatchRequest, CandidateEvaluation } from "../catalogMatcher/types.js";
import type { CatalogMatcherResult } from "../catalogMatcher/service.js";
import { requirementToMatcherInput } from "./requirementToMatcherInput.js";
import { runBuildingProjectCatalogMatching } from "./orchestrator.js";
import type {
  CatalogMatchingSnapshotProvider,
  CatalogMatchingSnapshotSession,
} from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OTHER_REVISION = `engineering-catalog-state:sha256:${"c".repeat(64)}` as const;

type MatchPlan = Record<string, number[]>;

async function configuredBaseline(): Promise<ConfiguredLiveOrchestrationResult> {
  const result = await runBuildingProjectEngineeringConfiguration({
    projectSnapshot: makeValidLiveProject(),
    catalogProvider: makeAvailableProvider(),
  });
  assert.equal(result.status, "CONFIGURED", JSON.stringify(result));
  return result as ConfiguredLiveOrchestrationResult;
}

function requestKey(request: CatalogMatchRequest): string {
  return `${request.equipmentType}:${request.projectContext?.roomId ?? "WHOLE_OBJECT"}:${request.service}`;
}

function defaultProductIds(request: CatalogMatchRequest): number[] {
  if (request.equipmentType === "HEAT_PUMP") return [1001];
  if (request.projectContext?.roomId === "room-1") return [2001];
  return [3001];
}

function candidate(
  productId: number,
  evidence: string,
  commerce: Record<string, unknown> = {
    stockStatus: "UNKNOWN",
    price: null,
    commercialAvailability: "UNKNOWN",
  },
): CandidateEvaluation {
  return {
    productId,
    sku: `SKU-${productId}`,
    equipmentType: "FAN_COIL",
    decision: "MATCH",
    engineeringEligibility: "ELIGIBLE",
    rank: 1,
    rankScore: null,
    rankKey: [`productId:${productId}`],
    oversizeRatio: 1,
    matchedValues: [],
    requiredValues: [],
    operatingPoint: { overall: "EXACT", requested: [], actual: [], perKey: {} },
    verification: {
      sourceType: "MANUFACTURER_DATASHEET",
      verificationTier: "AUTHORITATIVE",
      professionalEligible: true,
      identityStatus: "IDENTIFIED",
      dataCompleteness: "COMPLETE",
      profileSourceVerification: "VERIFIED",
    },
    compatibility: [],
    missingRequirements: [],
    warnings: [],
    reasonCodes: [],
    reasonDetails: [{
      code: "REQUEST_INVALID",
      parameter: null,
      required: null,
      actual: null,
      conditionContext: [],
      humanMessage: evidence,
    }],
    primaryReason: null,
    allReasons: [],
    commercialData: commerce as unknown as CandidateEvaluation["commercialData"],
    explanation: { decision: "MATCH", humanSummary: evidence, reasonDetails: [] },
  } as CandidateEvaluation;
}

function success(request: CatalogMatchRequest, productIds: number[], commerce?: Record<string, unknown>): CatalogMatcherResult {
  return {
    ok: true,
    response: {
      matcherModelId: request.matcherModelId,
      matcherModelVersion: request.matcherModelVersion,
      policyId: request.policyId,
      policyVersion: request.policyVersion,
      request,
      effectiveRequiredCapacity: request.requiredCapacity?.requiredValue ?? null,
      summary: {
        productsConsidered: productIds.length,
        eligible: productIds.length,
        eligibleWithWarnings: 0,
        insufficientData: 0,
        excluded: 0,
        conflicts: 0,
      },
      candidates: productIds.map((id) => candidate(id, `${requestKey(request)}:${id}`, commerce)),
      insufficientData: [],
      excluded: [],
      conflicts: [],
      warnings: [],
    },
  };
}

function fakeSnapshot(options: {
  revision?: typeof CATALOG_TOKEN | typeof OTHER_REVISION;
  plan?: MatchPlan;
  failKey?: string;
  commerce?: Record<string, unknown>;
} = {}) {
  const requests: CatalogMatchRequest[] = [];
  const outcomes: string[] = [];
  let opens = 0;
  const provider: CatalogMatchingSnapshotProvider = {
    openSession(): CatalogMatchingSnapshotSession {
      opens += 1;
      return {
        revision: (options.revision ?? CATALOG_TOKEN) as CatalogMatchingSnapshotSession["revision"],
        match(request) {
          requests.push(request);
          if (requestKey(request) === options.failKey) {
            return {
              ok: false,
              kind: "DATABASE_READ_ERROR",
              error: { message: "fixture matcher failure", cause: null },
            };
          }
          return success(request, options.plan?.[requestKey(request)] ?? defaultProductIds(request), options.commerce);
        },
        commit() { outcomes.push("COMMIT"); },
        rollback() { outcomes.push("ROLLBACK"); },
      };
    },
  };
  return { provider, requests, outcomes, get opens() { return opens; } };
}

async function matched(plan?: MatchPlan) {
  const cm16 = await configuredBaseline();
  const snapshot = fakeSnapshot({ plan });
  const result = await runBuildingProjectCatalogMatching({
    runCm16: async () => cm16,
    snapshotProvider: snapshot.provider,
  });
  assert.equal(result.status, "MATCHED", JSON.stringify(result));
  return { result: result as Extract<typeof result, { status: "MATCHED" }>, cm16, snapshot };
}

test("CM17-001 CM16 BLOCKED returns BLOCKED before opening a Matcher snapshot", async () => {
  const cm16 = await runBuildingProjectEngineeringConfiguration({});
  const snapshot = fakeSnapshot();
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "CM16_BLOCKED");
  assert.equal(snapshot.opens, 0);
  assert.equal(snapshot.requests.length, 0);
});

test("CM17-002 CONFIGURED consumes the exact CM16 requirements and physical components", async () => {
  const { result, cm16 } = await matched();
  assert.equal(result.cm16Result, cm16);
  assert.equal(result.equipmentRequirements, cm16.configuratorResult.equipmentRequirements);
  assert.equal(result.physicalComponents, cm16.configuratorResult.physicalComponents);
});

test("CM17-003 EquipmentRequirement maps exactly to the existing CatalogMatchRequest", async () => {
  const cm16 = await configuredBaseline();
  const requirement = cm16.configuratorResult.equipmentRequirements[2]!;
  const mapped = requirementToMatcherInput(requirement);
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.request, {
    matcherModelId: requirement.matcherRequestPolicy.matcherModelId,
    matcherModelVersion: requirement.matcherRequestPolicy.matcherModelVersion,
    schemaVersion: requirement.matcherRequestPolicy.engineeringSchemaVersion,
    policyId: requirement.matcherRequestPolicy.matcherPolicyId,
    policyVersion: requirement.matcherRequestPolicy.matcherPolicyVersion,
    selectionMode: requirement.selectionMode,
    equipmentType: requirement.equipmentType,
    service: requirement.service,
    requiredCapacity: requirement.requiredCapacity,
    operatingConditions: requirement.operatingConditions,
    requiredParameters: requirement.requiredParameters,
    preferredParameters: requirement.preferredParameters,
    excludedParameters: requirement.excludedParameters,
    compatibilityRequirements: requirement.compatibilityRequirements,
    requiredVerificationTier: requirement.matcherRequestPolicy.requiredVerificationTier,
    requireExactOperatingPoint: requirement.matcherRequestPolicy.requireExactOperatingPoint,
    allowInterpolation: requirement.matcherRequestPolicy.allowInterpolation,
    allowExtrapolation: requirement.matcherRequestPolicy.allowExtrapolation,
    designMarginPercent: requirement.designMargin!.designMarginPercent,
    maxCandidates: requirement.matcherRequestPolicy.maxCandidates,
    maxDiagnosticResults: requirement.matcherRequestPolicy.maxDiagnosticResults,
    projectContext: {
      projectId: requirement.projectId,
      roomId: requirement.scopeReference.roomId,
      systemId: requirement.scopeReference.systemId,
      source: "ENGINEERING_CONFIGURATOR",
    },
  });
});

test("CM17-004 Matcher is called exactly once per unique requirement", async () => {
  const { result, snapshot } = await matched();
  assert.equal(snapshot.requests.length, result.equipmentRequirements.length);
  assert.equal(result.requirementMatches.length, result.equipmentRequirements.length);
  assert.equal(new Set(result.requirementMatches.map((row) => row.requirement.requirementId)).size, result.equipmentRequirements.length);
});

test("CM17-005 heat-pump heating and cooling compose under one SAME_PRODUCT component", async () => {
  const { result } = await matched({
    "HEAT_PUMP:WHOLE_OBJECT:HEATING": [11, 12],
    "HEAT_PUMP:WHOLE_OBJECT:COOLING": [12, 13],
  });
  const group = result.sameProductGroups.find((row) => row.equipmentType === "HEAT_PUMP")!;
  assert.deepEqual(group.services, ["HEATING", "COOLING"]);
  assert.deepEqual(group.commonCandidateProductIds, [12]);
});

test("CM17-006 fan-coil SAME_PRODUCT is composed per room and distinct rooms remain distinct", async () => {
  const { result } = await matched();
  const fanCoils = result.sameProductGroups.filter((row) => row.equipmentType === "FAN_COIL");
  assert.equal(fanCoils.length, 2);
  assert.deepEqual(fanCoils.map((row) => row.roomId), ["room-1", "room-2"]);
  assert.equal(new Set(fanCoils.map((row) => row.componentInstanceId)).size, 2);
  assert.ok(fanCoils.every((row) => row.services.join(",") === "HEATING,COOLING"));
});

test("CM17-007 SAME_PRODUCT intersection retains one common product", async () => {
  const { result } = await matched({
    "FAN_COIL:room-1:HEATING": [20, 21],
    "FAN_COIL:room-1:COOLING": [21, 22],
  });
  const group = result.sameProductGroups.find((row) => row.roomId === "room-1")!;
  assert.deepEqual(group.commonCandidateProductIds, [21]);
});

test("CM17-008 multiple common products preserve the first linked Matcher's technical order", async () => {
  const { result } = await matched({
    "FAN_COIL:room-1:HEATING": [31, 30, 32],
    "FAN_COIL:room-1:COOLING": [30, 31, 40],
  });
  const group = result.sameProductGroups.find((row) => row.roomId === "room-1")!;
  assert.deepEqual(group.commonCandidateProductIds, [31, 30]);
  assert.equal(group.selectedProductId, null);
});

test("CM17-009 empty SAME_PRODUCT intersection fails closed", async () => {
  const cm16 = await configuredBaseline();
  const snapshot = fakeSnapshot({ plan: {
    "FAN_COIL:room-1:HEATING": [41],
    "FAN_COIL:room-1:COOLING": [42],
  } });
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "SAME_PRODUCT_NO_COMMON_CANDIDATE");
  assert.ok(result.blocker.componentInstanceId?.includes("room:room-1"));
  assert.deepEqual(snapshot.outcomes, ["ROLLBACK"]);
});

test("CM17-010 an individual requirement with no candidates fails closed", async () => {
  const cm16 = await configuredBaseline();
  const snapshot = fakeSnapshot({ plan: { "FAN_COIL:room-2:COOLING": [] } });
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "NO_ELIGIBLE_CANDIDATE");
});

test("CM17-011 common candidates preserve heating and cooling Matcher evidence", async () => {
  const { result } = await matched();
  const group = result.sameProductGroups.find((row) => row.roomId === "room-1")!;
  const common = group.commonCandidates[0]!;
  assert.equal(common.perRequirementEvidence.length, 2);
  assert.deepEqual(common.perRequirementEvidence.map((row) => row.service), ["HEATING", "COOLING"]);
  assert.ok(common.perRequirementEvidence.every((row) => row.candidate.reasonDetails.length > 0));
});

test("CM17-012 distinct componentInstanceIds are never merged by equipmentType", async () => {
  const { result } = await matched();
  const fanCoils = result.sameProductGroups.filter((row) => row.equipmentType === "FAN_COIL");
  assert.equal(fanCoils.length, 2);
  assert.notEqual(fanCoils[0]?.componentInstanceId, fanCoils[1]?.componentInstanceId);
});

test("CM17-013 malformed SAME_PRODUCT linkage fails before Matcher", async () => {
  const original = await configuredBaseline();
  const cm16 = structuredClone(original) as any;
  cm16.configuratorResult.equipmentRequirements[2].physicalComponentRef.componentInstanceId = "component:missing";
  const snapshot = fakeSnapshot();
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "COMPONENT_LINKAGE_INVALID");
  assert.equal(snapshot.requests.length, 0);
});

test("CM17-013b incomplete SAME_PRODUCT service group fails before Matcher", async () => {
  const original = await configuredBaseline();
  const cm16 = structuredClone(original) as any;
  const component = cm16.configuratorResult.physicalComponents[0];
  const removedId = component.serviceRequirementIds[1];
  component.serviceRequirementIds = [component.serviceRequirementIds[0]];
  cm16.configuratorResult.equipmentRequirements = cm16.configuratorResult.equipmentRequirements
    .filter((row: any) => row.requirementId !== removedId);
  const snapshot = fakeSnapshot();
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "COMPONENT_LINKAGE_INVALID");
  assert.equal(snapshot.requests.length, 0);
});

test("CM17-014 unchanged catalog revision is accepted inside the matching snapshot", async () => {
  const { result, snapshot } = await matched();
  assert.equal(result.engineeringCatalogStateRevision, CATALOG_TOKEN);
  assert.deepEqual(snapshot.outcomes, ["COMMIT"]);
});

test("CM17-015 changed catalog revision fails with frozen engineering-state semantics before Matcher", async () => {
  const cm16 = await configuredBaseline();
  const snapshot = fakeSnapshot({ revision: OTHER_REVISION });
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "ENGINEERING_CATALOG_STATE_CHANGED");
  assert.equal(result.blocker.expectedEngineeringCatalogStateRevision, CATALOG_TOKEN);
  assert.equal(result.blocker.observedEngineeringCatalogStateRevision, OTHER_REVISION);
  assert.equal(snapshot.requests.length, 0);
  assert.deepEqual(snapshot.outcomes, ["ROLLBACK"]);
});

test("CM17-016 Matcher technical failure is deterministic BLOCKED", async () => {
  const cm16 = await configuredBaseline();
  const snapshot = fakeSnapshot({ failKey: "FAN_COIL:room-1:HEATING" });
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "MATCHER_TECHNICAL_FAILURE");
  assert.deepEqual(snapshot.outcomes, ["ROLLBACK"]);
});

test("CM17-017 duplicate requirement identity fails before Matcher", async () => {
  const original = await configuredBaseline();
  const cm16 = structuredClone(original) as any;
  cm16.configuratorResult.equipmentRequirements[1].requirementId = cm16.configuratorResult.equipmentRequirements[0].requirementId;
  const snapshot = fakeSnapshot();
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "DUPLICATE_REQUIREMENT_ID");
  assert.equal(snapshot.requests.length, 0);
});

test("CM17-018 unsupported Matcher conversion fails closed without defaults", async () => {
  const original = await configuredBaseline();
  const cm16 = structuredClone(original) as any;
  cm16.configuratorResult.equipmentRequirements[0].designMargin = null;
  const snapshot = fakeSnapshot();
  const result = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: snapshot.provider });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blocker.code, "UNSUPPORTED_MATCHER_REQUEST_CONVERSION");
  assert.equal(snapshot.requests.length, 0);
});

test("CM17-019 commerce fields do not affect technical composition", async () => {
  const cm16 = await configuredBaseline();
  const a = fakeSnapshot({ commerce: { stockStatus: "OUT_OF_STOCK", price: { amount: 1, currency: "AMD" }, commercialAvailability: "UNAVAILABLE" } });
  const b = fakeSnapshot({ commerce: { stockStatus: "IN_STOCK", price: { amount: 999999, currency: "AMD" }, commercialAvailability: "AVAILABLE" } });
  const ra = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: a.provider });
  const rb = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: b.provider });
  assert.equal(ra.status, "MATCHED");
  assert.equal(rb.status, "MATCHED");
  if (ra.status !== "MATCHED" || rb.status !== "MATCHED") return;
  assert.deepEqual(ra.sameProductGroups.map((g) => g.commonCandidateProductIds), rb.sameProductGroups.map((g) => g.commonCandidateProductIds));
});

test("CM17-020 repeated execution is deterministic and does not mutate CM16", async () => {
  const cm16 = await configuredBaseline();
  const before = JSON.stringify(cm16);
  const a = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: fakeSnapshot().provider });
  const b = await runBuildingProjectCatalogMatching({ runCm16: async () => cm16, snapshotProvider: fakeSnapshot().provider });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(cm16), before);
});
