import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ArrowLeft, Compare } from '../components/Icons';
import { useStore } from '../store/useStore';

export function ComparePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const compare = useStore((s) => s.compare);
  const clearCompare = useStore((s) => s.clearCompare);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(compare.map((item) => api(`/products/${item.slug}`).catch(() => null)))
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.filter(Boolean));
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [compare]);

  const products = items.map((item) => item.product).filter(Boolean);
  const featureNames = useMemo(() => {
    const set = new Set<string>();
    for (const product of products) {
      for (const feature of product.features || []) set.add(feature.feature_name);
    }
    return Array.from(set);
  }, [products]);

  return (
    <div className="page space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button className="circle-icon-btn" onClick={() => navigate(-1)} aria-label={t('common.actions.back')}>
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="mobile-page-title text-slate-950">{t('compare.title')}</div>
        <button className="circle-icon-btn" onClick={clearCompare} aria-label={t('compare.actions.clear')}>
          <Compare className="h-6 w-6" />
        </button>
      </div>

      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('compare.breadcrumb') }]} />

      {!products.length ? (
        <div className="panel p-6 text-slate-300">{t('compare.empty')}</div>
      ) : (
        <>
          <div className="compare-grid">
            {products.map((product) => (
              <div key={product.id} className="panel p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{product.brand_name || t('common.fallbacks.noBrand')} · SKU {product.sku}</div>
                <div className="mt-2 text-lg font-semibold text-slate-950">{product.name_ru}</div>
                <div className="mt-3 text-2xl font-bold text-slate-950">{Number(product.price_amd) > 0 ? `${Number(product.price_amd).toLocaleString('ru-RU')} AMD` : t('common.fallbacks.priceRequest')}</div>
                <Link to={`/product/${product.slug}`} className="btn-secondary mt-4">{t('common.actions.openProduct')}</Link>
              </div>
            ))}
          </div>

          <div className="panel p-6">
            <div className="mb-4 text-xl font-semibold text-slate-950">{t('compare.parameters.title')}</div>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>{t('compare.parameters.name')}</th>
                    {products.map((product) => <th key={product.id}>{product.name_ru}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{t('common.labels.price')}</td>
                    {products.map((product) => <td key={product.id}>{Number(product.price_amd) > 0 ? `${Number(product.price_amd).toLocaleString('ru-RU')} AMD` : t('common.fallbacks.priceRequest')}</td>)}
                  </tr>
                  {featureNames.map((name) => (
                    <tr key={name}>
                      <td>{name}</td>
                      {products.map((product) => {
                        const feature = (product.features || []).find((item: any) => item.feature_name === name);
                        return <td key={`${product.id}-${name}`}>{feature ? `${feature.feature_value}${feature.feature_unit || ''}` : '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
