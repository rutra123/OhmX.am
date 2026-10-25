const SEARCH_NORMALIZE_REGEX = /[^\p{L}\p{N}]+/gu;

export function normalizeSearchText(value: string) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(SEARCH_NORMALIZE_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, '');
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

export function buildSearchMatch(query: string, values: string[]) {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  if (!normalizedQuery && !compactQuery) return true;

  return values.some((value) => {
    const normalizedValue = normalizeSearchText(value || '');
    const compactValue = compactSearchText(value || '');
    if (!normalizedValue && !compactValue) return false;
    return normalizedValue.includes(normalizedQuery)
      || compactValue.includes(compactQuery)
      || (compactQuery.length >= 3 && isSubsequence(compactQuery, compactValue));
  });
}
