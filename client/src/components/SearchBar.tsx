import { useTranslation } from 'react-i18next';
import { Search } from './Icons';
import { productThumbUrl } from './ManagedImage';

export type SearchSuggestion = {
  id: string;
  type: 'product' | 'category' | 'brand' | 'document';
  label: string;
  detail?: string;
  value?: string;
  url?: string;
  imageUrl?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputAriaLabel?: string;
  onSubmit?: () => void;
  submitLabel?: string;
  compact?: boolean;
  suggestions?: SearchSuggestion[];
  suggestionsOpen?: boolean;
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void;
  productFallbackLabel?: string;
  suggestionTypeLabels?: Record<SearchSuggestion['type'], string>;
  genericSuggestionLabel?: string;
};

const LEGACY_PLACEHOLDER_KEYS: Record<string, string> = {
  'Поиск по SKU, бренду, названию или документу': 'search.shared.catalogPlaceholder',
};

export function SearchBar({
  value,
  onChange,
  placeholder,
  inputAriaLabel,
  onSubmit,
  submitLabel,
  compact = false,
  suggestions = [],
  suggestionsOpen = false,
  onSuggestionSelect,
  productFallbackLabel,
  suggestionTypeLabels,
  genericSuggestionLabel,
}: Props) {
  const { t } = useTranslation();
  const resolvedSuggestionTypeLabels: Record<SearchSuggestion['type'], string> = suggestionTypeLabels ?? {
    product: t('search.shared.suggestionTypes.product'),
    category: t('search.shared.suggestionTypes.category'),
    brand: t('search.shared.suggestionTypes.brand'),
    document: t('search.shared.suggestionTypes.document'),
  };
  const legacyPlaceholderKey = placeholder ? LEGACY_PLACEHOLDER_KEYS[placeholder] : '';
  const resolvedPlaceholder = legacyPlaceholderKey ? t(legacyPlaceholderKey) : placeholder ?? t('search.shared.placeholder');
  const resolvedInputAriaLabel = inputAriaLabel ?? t('search.shared.inputLabel');
  const resolvedSubmitLabel = submitLabel ?? t('search.shared.submit');
  const resolvedProductFallbackLabel = productFallbackLabel ?? t('search.shared.productFallback');
  const resolvedGenericSuggestionLabel = genericSuggestionLabel ?? t('search.shared.genericSuggestion');

  return (
    <div className="search-combobox">
      <label className={`search-shell ${compact ? 'search-shell--compact' : ''}`}>
        <Search className="h-5 w-5 text-slate-400 sm:h-6 sm:w-6" />
        <input
          className="search-shell__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit?.();
          }}
          placeholder={resolvedPlaceholder}
          aria-label={resolvedInputAriaLabel}
          autoComplete="off"
        />
        {onSubmit ? (
          <button type="button" className={`btn-primary ${compact ? 'hidden sm:inline-flex' : 'inline-flex'}`} onClick={onSubmit}>
            {resolvedSubmitLabel}
          </button>
        ) : null}
      </label>

      {suggestionsOpen && suggestions.length ? (
        <div className="search-suggestions" role="listbox" aria-label={t('search.shared.suggestionsLabel')}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="search-suggestions__item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSuggestionSelect?.(suggestion)}
            >
              {suggestion.type === 'product' ? (
                <span className="search-suggestions__thumb" aria-hidden="true">
                  {suggestion.imageUrl ? (
                    <img
                      src={productThumbUrl(suggestion.imageUrl) || suggestion.imageUrl}
                      alt=""
                      className="search-suggestions__thumb-image"
                      loading="lazy"
                      onError={(event) => {
                        const img = event.currentTarget;
                        if (suggestion.imageUrl && !img.src.endsWith(suggestion.imageUrl)) img.src = suggestion.imageUrl;
                      }}
                    />
                  ) : (
                    <span className="search-suggestions__thumb-fallback">{resolvedProductFallbackLabel}</span>
                  )}
                </span>
              ) : (
                <span className="search-suggestions__badge">{resolvedSuggestionTypeLabels[suggestion.type] || resolvedGenericSuggestionLabel}</span>
              )}
              <span className="search-suggestions__copy">
                <span className="search-suggestions__label">{suggestion.label}</span>
                {suggestion.detail ? <span className="search-suggestions__detail">{suggestion.detail}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
