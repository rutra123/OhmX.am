/** CM17 SAME_PRODUCT composition over existing per-requirement Matcher results. */
import type {
  CatalogMatchingBlocker,
  RequirementMatcherResult,
  SameProductCompositionGroup,
} from "./types.js";
import { catalogMatchingBlocker } from "./validation.js";

export type SameProductCompositionResult =
  | { ok: true; groups: readonly SameProductCompositionGroup[] }
  | { ok: false; blocker: CatalogMatchingBlocker };

export function composeSameProductGroups(
  matches: readonly RequirementMatcherResult[],
): SameProductCompositionResult {
  const grouped = new Map<string, RequirementMatcherResult[]>();
  for (const match of matches) {
    const ref = match.requirement.physicalComponentRef;
    if (!ref || ref.selectionConstraint !== "SAME_PRODUCT" || !ref.componentInstanceId) {
      return {
        ok: false,
        blocker: catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "Matcher result lost its SAME_PRODUCT component linkage.", {
          requirementId: match.requirement.requirementId,
          componentInstanceId: ref?.componentInstanceId ?? null,
        }),
      };
    }
    const members = grouped.get(ref.componentInstanceId) ?? [];
    members.push(match);
    grouped.set(ref.componentInstanceId, members);
  }

  const groups: SameProductCompositionGroup[] = [];
  for (const [componentInstanceId, members] of grouped) {
    if (members.length < 2) {
      return {
        ok: false,
        blocker: catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "SAME_PRODUCT requires multiple linked service requirements.", {
          componentInstanceId,
        }),
      };
    }

    const eligibleSets = members.map((member) => new Set(member.response.candidates.map((row) => row.productId)));
    const anchorOrder = [...new Set(members[0]!.response.candidates.map((row) => row.productId))];
    const commonIds = anchorOrder.filter((productId) => eligibleSets.every((set) => set.has(productId)));
    if (commonIds.length === 0) {
      return {
        ok: false,
        blocker: catalogMatchingBlocker(
          "SAME_PRODUCT_NO_COMMON_CANDIDATE",
          "No technically eligible product satisfies every requirement linked to this physical component.",
          { componentInstanceId },
        ),
      };
    }

    const commonCandidates = commonIds.map((productId) => ({
      productId,
      perRequirementEvidence: members.map((member) => ({
        requirementId: member.requirement.requirementId,
        service: member.requirement.service,
        candidate: member.response.candidates.find((row) => row.productId === productId)!,
      })),
    }));

    groups.push({
      componentInstanceId,
      selectionConstraint: "SAME_PRODUCT",
      equipmentType: members[0]!.requirement.equipmentType,
      roomId: members[0]!.requirement.scopeReference.roomId,
      requirementIds: members.map((member) => member.requirement.requirementId),
      services: members.map((member) => member.requirement.service),
      perRequirementCandidateProductIds: members.map((member) => ({
        requirementId: member.requirement.requirementId,
        service: member.requirement.service,
        productIds: member.response.candidates.map((row) => row.productId),
      })),
      commonCandidateProductIds: commonIds,
      commonCandidates,
      selectedProductId: null,
    });
  }

  return { ok: true, groups };
}
