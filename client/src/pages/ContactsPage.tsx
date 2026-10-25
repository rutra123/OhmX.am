import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { contactCards } from '../data/publicMenu';

export function ContactsPage() {
  const [params] = useSearchParams();
  const { t } = useTranslation();

  const requestSummary = useMemo(() => {
    const sku = params.get('sku');
    const product = params.get('product');
    const brand = params.get('brand');
    const intent = params.get('intent');
    if (!sku && !product && !brand && !intent) return null;
    return { sku, product, brand, intent };
  }, [params]);

  return (
    <div className="page space-y-6">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('contacts.breadcrumb') }]} />
      <div>
        <div className="section-caption">{t('contacts.caption')}</div>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">{t('contacts.title')}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">{t('contacts.description')}</p>
      </div>

      {requestSummary ? (
        <div className="panel p-5">
          <div className="section-caption">{t('contacts.requestContext.title')}</div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {requestSummary.sku ? <div><span className="font-semibold text-slate-950">SKU:</span> {requestSummary.sku}</div> : null}
            {requestSummary.product ? <div><span className="font-semibold text-slate-950">{t('contacts.requestContext.product')}:</span> {requestSummary.product}</div> : null}
            {requestSummary.brand ? <div><span className="font-semibold text-slate-950">{t('contacts.requestContext.brand')}:</span> {requestSummary.brand}</div> : null}
            {requestSummary.intent ? <div><span className="font-semibold text-slate-950">{t('contacts.requestContext.intent')}:</span> {requestSummary.intent}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {contactCards.map((item, index) => {
          const cardKey = ['phone', 'messenger', 'address'][index] || 'phone';
          return (
            <div key={item.title} className="panel p-5">
              <div className="section-caption">{t(`contacts.cards.${cardKey}.title`)}</div>
              <div className="mt-2 text-lg font-semibold text-slate-950">{item.value}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{t(`contacts.cards.${cardKey}.hint`)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-slate-950">{t('contacts.order.title')}</h2>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>{t('contacts.order.steps.send')}</li>
            <li>{t('contacts.order.steps.confirm')}</li>
            <li>{t('contacts.order.steps.finish')}</li>
          </ol>
        </div>
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-slate-950">{t('contacts.delivery.title')}</h2>
          <div className="mt-3 text-sm leading-6 text-slate-600">{t('contacts.delivery.text')}</div>
        </div>
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-slate-950">{t('contacts.audience.title')}</h2>
          <div className="mt-3 text-sm leading-6 text-slate-600">{t('contacts.audience.text')}</div>
        </div>
      </div>
    </div>
  );
}
