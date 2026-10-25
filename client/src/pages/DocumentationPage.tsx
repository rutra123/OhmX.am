import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';

type DocsResponse = {
  documents: any[];
  brands: { slug: string; name: string }[];
  categories: { slug: string; name_ru: string }[];
};

export function DocumentationPage() {
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation();
  const [data, setData] = useState<DocsResponse>({ documents: [], brands: [], categories: [] });
  const brand = params.get('brand') || '';
  const category = params.get('category') || '';

  useEffect(() => {
    const query = new URLSearchParams();
    if (params.get('q')) query.set('q', params.get('q') as string);
    if (brand) query.set('brand', brand);
    if (category) query.set('category', category);
    api<DocsResponse>(`/documents?${query.toString()}`).then(setData).catch(() => setData({ documents: [], brands: [], categories: [] }));
  }, [params, brand, category]);

  const grouped = useMemo(() => data.documents.slice(0, 80), [data.documents]);

  return (
    <div className="page space-y-6">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('docs.breadcrumb') }]} />
      <div>
        <div className="section-caption">{t('docs.caption')}</div>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{t('docs.title')}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">{t('docs.description')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <select className="field" value={brand} onChange={(e) => { const next = new URLSearchParams(params); e.target.value ? next.set('brand', e.target.value) : next.delete('brand'); setParams(next); }}>
          <option value="">{t('docs.filters.allBrands')}</option>
          {data.brands.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
        </select>
        <select className="field" value={category} onChange={(e) => { const next = new URLSearchParams(params); e.target.value ? next.set('category', e.target.value) : next.delete('category'); setParams(next); }}>
          <option value="">{t('docs.filters.allCategories')}</option>
          {data.categories.map((item) => <option key={item.slug} value={item.slug}>{item.name_ru}</option>)}
        </select>
        <Link to="/search" className="btn-primary">{t('docs.actions.openSearch')}</Link>
      </div>

      {grouped.length ? (
        <div className="space-y-3">
          {grouped.map((doc) => (
            <div key={doc.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-lg font-semibold text-slate-950 hover:text-primary">{doc.document_name}</a>
                  <div className="mt-1 text-sm text-slate-500">{doc.document_type} · {(doc.file_extension || 'pdf').toUpperCase()} · {(doc.language || 'ru').toUpperCase()}</div>
                  <div className="mt-2 text-sm text-slate-600">{doc.brand_name || t('common.fallbacks.noBrand')} · {doc.category_name || t('common.labels.catalog')} · SKU {doc.sku}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={doc.file_url} target="_blank" rel="noreferrer" className="btn-secondary">{t('docs.actions.openPdf')}</a>
                  <Link to={`/product/${doc.product_slug}`} className="btn-primary">{t('docs.actions.toProduct')}</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel p-5 text-slate-600">{t('docs.empty')}</div>
      )}
    </div>
  );
}
