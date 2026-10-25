/**
 * Lexicographic ranking. rankScore is always null.
 * Commerce is never used.
 */
import type { CandidateEvaluation, RankTuple, VerificationTier, DataCompleteness } from './types.js';

function decisionQuality(decision: CandidateEvaluation['decision']): number {
  if (decision === 'MATCH') return 0;
  if (decision === 'MATCH_WITH_WARNINGS') return 1;
  return 9;
}

function verificationRank(tier: VerificationTier | null): number {
  if (tier === 'AUTHORITATIVE') return 0;
  if (tier === 'VERIFIED_SECONDARY') return 1;
  if (tier === 'UNVERIFIED') return 2;
  return 3;
}

function completenessRank(value: DataCompleteness): number {
  if (value === 'COMPLETE') return 0;
  if (value === 'PARTIAL') return 1;
  return 2;
}

export function isEngineeringEligible(evaluation: CandidateEvaluation): boolean {
  return evaluation.decision === 'MATCH' || evaluation.decision === 'MATCH_WITH_WARNINGS';
}

export function buildRankTuple(evaluation: CandidateEvaluation, preferredMatches = 0): RankTuple {
  const exactCount = Object.values(evaluation.operatingPoint.perKey).filter((state) => state === 'EXACT').length;
  return {
    decisionQuality: decisionQuality(evaluation.decision),
    oversizeRatio: evaluation.oversizeRatio == null ? Number.POSITIVE_INFINITY : evaluation.oversizeRatio,
    exactConditionCount: exactCount,
    verificationRank: verificationRank(evaluation.verification.verificationTier),
    completenessRank: completenessRank(evaluation.verification.dataCompleteness),
    preferredMatches,
    productId: evaluation.productId,
  };
}

export function compareRankTuples(a: RankTuple, b: RankTuple): number {
  if (a.decisionQuality !== b.decisionQuality) return a.decisionQuality - b.decisionQuality;
  if (a.oversizeRatio !== b.oversizeRatio) return a.oversizeRatio - b.oversizeRatio;
  if (a.exactConditionCount !== b.exactConditionCount) return b.exactConditionCount - a.exactConditionCount;
  if (a.verificationRank !== b.verificationRank) return a.verificationRank - b.verificationRank;
  if (a.completenessRank !== b.completenessRank) return a.completenessRank - b.completenessRank;
  if (a.preferredMatches !== b.preferredMatches) return b.preferredMatches - a.preferredMatches;
  return a.productId - b.productId;
}

export function rankKeyFromTuple(tuple: RankTuple): string[] {
  return [
    `decision:${tuple.decisionQuality}`,
    `oversize:${tuple.oversizeRatio}`,
    `exact:${tuple.exactConditionCount}`,
    `tier:${tuple.verificationRank}`,
    `complete:${tuple.completenessRank}`,
    `preferred:${tuple.preferredMatches}`,
    `productId:${tuple.productId}`,
  ];
}

export function rankEligibleCandidates(
  evaluations: CandidateEvaluation[],
  preferredMatchCounts?: ReadonlyMap<number, number>,
): CandidateEvaluation[] {
  const eligible = evaluations.filter(isEngineeringEligible);
  const ineligible = evaluations.filter((row) => !isEngineeringEligible(row));
  const sorted = [...eligible].sort((a, b) => {
    const ta = buildRankTuple(a, preferredMatchCounts?.get(a.productId) ?? 0);
    const tb = buildRankTuple(b, preferredMatchCounts?.get(b.productId) ?? 0);
    return compareRankTuples(ta, tb);
  });
  const ranked = sorted.map((row, index) => {
    const tuple = buildRankTuple(row, preferredMatchCounts?.get(row.productId) ?? 0);
    return {
      ...row,
      rank: index + 1,
      rankScore: null,
      rankKey: rankKeyFromTuple(tuple),
    };
  });
  return [
    ...ranked,
    ...ineligible.map((row) => ({
      ...row,
      rank: null,
      rankScore: null,
    })),
  ];
}
