import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SearchSuggestion } from '../components/SearchBar';

type SuggestionsResponse = {
  suggestions: SearchSuggestion[];
};

export function useSearchSuggestions(query: string, limit = 8, includeRelated = false) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 10);
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q, limit: String(safeLimit) });
      if (includeRelated) params.set('related', '1');
      api<SuggestionsResponse>(`/search/suggestions?${params.toString()}`)
        .then((data) => {
          if (active) setSuggestions((data.suggestions || []).slice(0, safeLimit));
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 160);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, limit, includeRelated]);

  return suggestions;
}
