import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '../components/Breadcrumbs';

export function PlaceholderPage({ title, text }: { title: string; text: string }) {
  const location = useLocation();
  const { t } = useTranslation();
  const inquiry = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const sku = params.get('sku') || '';
    const product = params.get('product') || '';
    const brand = params.get('brand') || '';
    const intent = params.get('intent') || '';
    return { sku, product, brand, intent };
  }, [location.search]);

  const intentLabel = inquiry.intent === 'price'
    ? t('placeholder.intent.price')
    : inquiry.intent === 'eta'
      ? t('placeholder.intent.eta')
      : inquiry.intent === 'price_eta'
        ? t('placeholder.intent.priceEta')
        : '';

  return (
    <div className="page space-y-4">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: title }]} />
      <div className="panel p-5">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-3 max-w-3xl text-slate-300">{text}</p>
        {(inquiry.sku || inquiry.product || inquiry.brand) ? (
          <div className="mt-5 rounded-2xl border border-primary/30 bg-card p-4 text-sm text-slate-200">
            <div className="font-semibold text-white">{t('placeholder.preparedRequest')}</div>
            {intentLabel ? <div className="mt-2 text-primary">{intentLabel}</div> : null}
            {inquiry.product ? <div className="mt-2">{t('contacts.requestContext.product')}: {inquiry.product}</div> : null}
            {inquiry.sku ? <div>{t('common.labels.article')}: <span className="font-mono">{inquiry.sku}</span></div> : null}
            {inquiry.brand ? <div>{t('contacts.requestContext.brand')}: {inquiry.brand}</div> : null}
            <div className="mt-3 text-slate-300">{t('placeholder.managerHint')}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
