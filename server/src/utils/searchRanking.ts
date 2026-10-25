const SEARCH_NORMALIZE_REGEX = /[^\p{L}\p{N}]+/gu;

type SearchCandidate = {
  value: unknown;
  weight: number;
};

/** Unicode casefold for LIKE/equality (Cyrillic-safe). Keeps punctuation for SKU/text shape. */
export function unicodeFoldForSearch(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

export function normalizeSearchText(value: unknown) {
  return unicodeFoldForSearch(value)
    .replace(SEARCH_NORMALIZE_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactSearchText(value: unknown) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

export function splitSearchTerms(value: unknown) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function isSubsequence(needle: string, haystack: string) {
  if (!needle) return false;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function scoreCandidate(
  queryNormalized: string,
  queryCompact: string,
  queryTerms: string[],
  candidate: unknown,
  weight: number,
) {
  const normalized = normalizeSearchText(candidate);
  const compact = compactSearchText(candidate);
  if (!normalized && !compact) return 0;
  let score = 0;
  if (queryCompact && compact === queryCompact) score += weight * 12;
  if (queryCompact && compact.startsWith(queryCompact)) score += weight * 8;
  if (queryCompact && compact.includes(queryCompact)) score += weight * 6;
  if (queryNormalized && normalized.includes(queryNormalized)) score += weight * 4;
  for (const term of queryTerms) {
    if (normalized.includes(term)) score += weight;
    else if (compact.includes(term)) score += Math.max(1, Math.floor(weight / 2));
  }
  if (queryCompact.length >= 3 && compact.length >= queryCompact.length && isSubsequence(queryCompact, compact)) {
    score += Math.max(2, Math.floor(weight * 1.5));
  }
  const distanceBase = queryCompact.length >= 3 ? queryCompact : queryNormalized;
  const candidateBase = queryCompact.length >= 3 ? compact : normalized;
  if (distanceBase && candidateBase) {
    const maxWindowDelta = Math.max(2, Math.floor(distanceBase.length * 0.25));
    if (Math.abs(candidateBase.length - distanceBase.length) <= maxWindowDelta) {
      const distance = levenshtein(distanceBase, candidateBase);
      if (distance <= 1) score += weight * 5;
      else if (distance === 2) score += weight * 3;
      else if (distance === 3 && distanceBase.length >= 7) score += weight * 2;
    }
  }
  return score;
}

export function scoreSearchRecord(query: unknown, candidates: SearchCandidate[]) {
  const queryNormalized = normalizeSearchText(query);
  const queryCompact = compactSearchText(query);
  const queryTerms = splitSearchTerms(query);
  if (!queryTerms.length && !queryCompact) return 0;
  return candidates.reduce(
    (sum, candidate) => sum + scoreCandidate(queryNormalized, queryCompact, queryTerms, candidate.value, candidate.weight),
    0,
  );
}

export function isStrongSearchMatch(score: number) {
  return score >= 120;
}
