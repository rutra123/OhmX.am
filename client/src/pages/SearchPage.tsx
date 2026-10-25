import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { SearchBar } from '../components/SearchBar';
import { ProductCard } from '../components/ProductCard';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useSearchSuggestions } from '../hooks/useSearchSuggestions';
import type { SearchSuggestion } from '../components/SearchBar';

const searchExamples = [
  { value: '088H3122' },
  { value: 'LG-RX3-63A' },
  { value: 'DEVIreg Smart' },
  { value: 'Danfoss клапан', labelKey: 'search.page.examples.danfossValve' },
  { value: 'apc ups' },
] as const;

const SEARCH_LIMIT = 24;

type SearchPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

type SearchResponse = {
  query: string;
  relaxed?: boolean;
  correctedQuery?: string;
  products: any[];
  documents: any[];
  pagination: SearchPagination;
};

function emptyPagination(page = 1): SearchPagination {
  return { page, limit: SEARCH_LIMIT, total: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false };
}

function emptySearchData(page = 1): SearchResponse {
  return { query: '', products: [], documents: [], pagination: emptyPagination(page) };
}

function safeSearchData(data: Partial<SearchResponse> | null | undefined, fallbackQuery: string, fallbackPage: number): SearchResponse {
  const products = Array.isArray(data?.products) ? data.products.filter(Boolean) : [];
  const documents = Array.isArray(data?.documents) ? data.documents.filter(Boolean) : [];
  const pagination = data?.pagination || emptyPagination(fallbackPage);
  return {
    query: data?.query || fallbackQuery,
    relaxed: Boolean(data?.relaxed),
    correctedQuery: typeof data?.correctedQuery === 'string' ? data.correctedQuery : '',
    products,
    documents,
    pagination: {
      page: Number(pagination.page || fallbackPage),
      limit: Number(pagination.limit || SEARCH_LIMIT),
      total: Number(pagination.total ?? products.length),
      totalPages: Math.max(1, Number(pagination.totalPages || 1)),
      hasNextPage: Boolean(pagination.hasNextPage),
      hasPrevPage: Boolean(pagination.hasPrevPage),
    },
  };
}

function parsePageParam(value: string | null) {
  const page = Number(value || 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function SearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [value, setValue] = useState(params.get('q') || '');
  const [data, setData] = useState<SearchResponse>(() => emptySearchData(parsePageParam(params.get('page'))));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [suggestionsFocused, setSuggestionsFocused] = useState(false);
  const suggestions = useSearchSuggestions(value);
  const [productView, setProductView] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('ohmx-product-view') === 'list' ? 'list' : 'grid';
  });
  const saleMode = params.get('saleMode') || '';
  const page = parsePageParam(params.get('page'));

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ohmx-product-view', productView);
  }, [productView]);

  useEffect(() => {
    const q = (params.get('q') || '').trim();
    const requestedPage = parsePageParam(params.get('page'));
    setValue(q);
    if (!q) {
      setLoading(false);
      setError(false);
      setData(emptySearchData(requestedPage));
      return;
    }

    let active = true;
    const query = new URLSearchParams();
    query.set('q', q);
    query.set('page', String(requestedPage));
    query.set('limit', String(SEARCH_LIMIT));
    if (saleMode) query.set('saleMode', saleMode);

    setLoading(true);
    setError(false);
    api<SearchResponse>(`/search?${query.toString()}`)
      .then((response) => {
        if (active) setData(safeSearchData(response, q, requestedPage));
      })
      .catch(() => {
        if (active) {
          setError(true);
          setData(emptySearchData(requestedPage));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params, saleMode]);

  const hasQuery = useMemo(() => Boolean(params.get('q')), [params]);
  const totalFound = data.pagination.total;
  const totalPages = Math.max(1, data.pagination.totalPages || 1);
  const currentPage = Math.min(Math.max(1, data.pagination.page || page), totalPages);
  const hasProducts = data.products.length > 0;
  const hasDocuments = data.documents.length > 0;
  const showEmptyState = hasQuery && !loading && !error && totalFound === 0 && !hasDocuments;

  const setPage = (nextPage: number) => {
    const safePage = Math.max(1, nextPage);
    const next = new URLSearchParams(params);
    if (safePage > 1) next.set('page', String(safePage));
    else next.delete('page');
    setParams(next);
  };

  const submit = () => {
    const next = new URLSearchParams();
    if (value.trim()) next.set('q', value.trim());
    if (saleMode) next.set('saleMode', saleMode);
    setParams(next);
  };

  const setSaleMode = (nextMode: string) => {
    const next = new URLSearchParams(params);
    if (nextMode) next.set('saleMode', nextMode);
    else next.delete('saleMode');
    next.delete('page');
    setParams(next);
  };

  const selectSuggestion = (suggestion: SearchSuggestion) => {
    setValue(suggestion.value || suggestion.label);
    setSuggestionsFocused(false);
    if (suggestion.url) {
      navigate(suggestion.url);
      return;
    }
    const next = new URLSearchParams();
    next.set('q', suggestion.value || suggestion.label);
    if (saleMode) next.set('saleMode', saleMode);
    setParams(next);
  };

  return (
    <div className="page space-y-6">
      <div>
        <div className="section-caption">{t('search.page.caption')}</div>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{t('search.page.title')}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">{t('search.page.description')}</p>
      </div>

      <div onFocus={() => setSuggestionsFocused(true)} onBlur={() => window.setTimeout(() => setSuggestionsFocused(false), 120)}>
        <SearchBar
          value={value}
          onChange={setValue}
          onSubmit={submit}
          placeholder={t('search.page.placeholder')}
          suggestions={suggestions}
          suggestionsOpen={suggestionsFocused && value.trim().length >= 2}
          onSuggestionSelect={selectSuggestion}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-500">
        <span className="mr-1 font-medium text-slate-600">{t('search.page.examples.label')}</span>
        {searchExamples.map((example) => (
          <button key={example.value} className="chip bg-card" onClick={() => { setValue(example.value); setParams(new URLSearchParams({ q: example.value })); }}>
            {'labelKey' in example ? t(example.labelKey) : example.value}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select className="field max-w-xs" value={saleMode} onChange={(e) => setSaleMode(e.target.value)} aria-label={t('search.page.saleMode.ariaLabel')}>
          <option value="">{t('search.page.saleMode.any')}</option>
          <option value="buy_now">{t('search.page.saleMode.buyNow')}</option>
          <option value="price_request">{t('search.page.saleMode.priceRequest')}</option>
          <option value="preorder">{t('search.page.saleMode.preorder')}</option>
          <option value="price_eta_request">{t('search.page.saleMode.priceEtaRequest')}</option>
        </select>
        <ViewModeToggle value={productView} onChange={setProductView} />
      </div>

      {!hasQuery ? (
        <div className="text-sm text-slate-500">{t('search.page.startPrompt')}</div>
      ) : loading ? (
        <div className="panel p-5 text-slate-600">{t('search.page.loading')}</div>
      ) : error ? (
        <div className="panel border-danger/30 bg-danger/5 p-5 text-danger">{t('search.page.error')}</div>
      ) : (
        <div className="space-y-2">
          {data.correctedQuery ? (
            <div className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-fg-soft" role="status">{t('search.page.correctedQuery', { query: data.correctedQuery })}</div>
          ) : null}
          {data.relaxed && hasProducts ? (
            <div className="rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn" role="status">{t('search.page.relaxed')}</div>
          ) : null}
          <div className="text-sm text-slate-500">{t('search.page.summary', { products: totalFound, documents: data.documents.length, page: currentPage, totalPages })}</div>
        </div>
      )}

      {hasProducts && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-950">{t('search.page.resultsTitle')}</h2>
            <span className="text-sm text-slate-500">{t('search.page.shownSummary', { shown: data.products.length, total: totalFound })}</span>
          </div>
          <div className={productView === 'grid' ? 'product-grid' : 'space-y-4'}>
            {data.products.map((product: any) => <ProductCard key={product.id || product.slug} product={product} view={productView} />)}
          </div>
          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button className="btn-secondary" disabled={!data.pagination.hasPrevPage || loading} onClick={() => setPage(currentPage - 1)}>{t('search.page.pagination.previous')}</button>
              <span className="text-sm text-slate-500">{t('search.page.pagination.status', { page: currentPage, totalPages })}</span>
              <button className="btn-primary" disabled={!data.pagination.hasNextPage || loading} onClick={() => setPage(currentPage + 1)}>{t('search.page.pagination.next')}</button>
            </div>
          ) : null}
        </section>
      )}

      {hasDocuments && (
        <div className="panel p-5">
          <h2 className="text-xl font-semibold text-slate-950">{t('search.page.documentsTitle')}</h2>
          <div className="mt-4 space-y-3">
            {data.documents.map((document: any) => (
              <div key={document.id} className="rounded-2xl border border-line bg-card p-4">
                <a href={document.file_url} target="_blank" rel="noreferrer" className="font-semibold text-slate-950 hover:text-primary">{document.document_name}</a>
                <div className="mt-1 text-sm text-slate-500">{document.brand_name || t('search.page.brandFallback')} · SKU {document.sku}</div>
                <div className="mt-2">
                  <Link to={`/product/${document.product_slug}`} className="text-sm font-medium text-primary">{t('search.page.openProduct')}</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showEmptyState ? (
        <div className="panel space-y-3 p-5 text-slate-600">
          <div>{t('search.page.empty')}</div>
          <div className="flex flex-wrap gap-3">
            <Link to="/catalog" className="btn-secondary">{t('search.page.emptyCatalog')}</Link>
            <Link to={`/contacts?intent=price_eta&product=${encodeURIComponent(params.get('q') || '')}`} className="btn-primary">{t('search.page.emptyRequest')}</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
