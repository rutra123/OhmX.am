import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export type CalculatorSummaryCardProps = {
  label: string;
  value: ReactNode;
  accent?: boolean;
  delayClassName?: string;
};

export function CalculatorSummaryCards({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function CalculatorSummaryCard({ label, value, accent = false, delayClassName = '' }: CalculatorSummaryCardProps) {
  return (
    <div className={`ohmx-result-card ${delayClassName} rounded-3xl border ${accent ? 'border-primary/25 ring-1 ring-primary/10' : 'border-line'} bg-surface p-6 text-center shadow-sm`}>
      <div className="section-caption">{label}</div>
      <div className={`${accent ? 'text-primary' : 'text-fg-strong'} mt-2 text-4xl font-black sm:text-5xl`}>{value}</div>
    </div>
  );
}

export function CalculatorInfoNote({ children, tone = 'primary' }: { children: ReactNode; tone?: 'primary' | 'warning' | 'danger' | 'neutral' }) {
  const cls = tone === 'danger'
    ? 'border-red-500/40 bg-red-500/10 text-red-100'
    : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      : tone === 'neutral'
        ? 'border-line bg-card text-fg-muted'
        : 'border-primary/20 bg-primary/10 text-fg';
  return <div className={`rounded-2xl border p-4 text-sm leading-6 ${cls}`}>{children}</div>;
}

export function CalculatorDocumentCard({
  title = 'Подбор оборудования',
  caption = 'Документ / подбор',
  actions,
  children,
  id,
}: {
  title?: string;
  caption?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="section-caption">{caption}</div>
          <h2 className="text-2xl font-bold text-fg-strong">{title}</h2>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 grid gap-3 text-sm text-fg-muted sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function CalculatorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-fg-strong">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export type RecommendationProduct = {
  id: number;
  slug: string;
  name: string;
  brand?: string | null;
  article?: string | null;
  sku?: string | null;
  price?: number | null;
  currency?: string;
  image?: string | null;
  availabilityStatus?: string;
  availabilityLabel?: string;
};

function availabilityClasses(status?: string) {
  if (status === 'preorder') return 'bg-amber-200 text-amber-900';
  if (status === 'low_stock') return 'bg-orange-100 text-orange-700';
  if (status === 'unavailable') return 'bg-surface text-fg-muted';
  return 'bg-emerald-100 text-emerald-700';
}

function formatPrice(value: number | null | undefined, currency: string | undefined, requestLabel: string, locale: string) {
  if (!value) return requestLabel;
  return `${new Intl.NumberFormat(locale).format(value)} ${currency || 'AMD'}`;
}

export function ProductRecommendationCard({
  product,
  accessory = false,
  badges = [],
  onAdd,
  onPick,
}: {
  product: RecommendationProduct;
  accessory?: boolean;
  badges?: ReactNode[];
  onAdd: (product: RecommendationProduct) => void;
  onPick?: (product: RecommendationProduct) => void;
}) {
  const { t, i18n } = useTranslation();
  const isPreorder = product.availabilityStatus === 'preorder';
  return (
    <div className={`rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md ${isPreorder ? 'border-amber-500/35 bg-amber-500/10' : 'border-line bg-card'} sm:flex sm:items-center sm:gap-4`}>
      <Link to={`/product/${product.slug}`} className="mb-3 flex h-24 w-full items-center justify-center rounded-xl bg-surface sm:mb-0 sm:w-28">
        {product.image ? <img src={product.image} alt={product.name} className="max-h-full max-w-full object-contain p-2" loading="lazy" /> : <div className="text-xs text-fg-faint">{t('common.labels.photo')}</div>}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${availabilityClasses(product.availabilityStatus)}`}>{product.availabilityLabel || t('common.fallbacks.inStock')}</span>
          {accessory ? <span className="rounded-full bg-surface px-2.5 py-1 text-xs text-fg-muted">{t('calculator.common.accessoryProduct')}</span> : null}
          {badges.map((badge, index) => <span key={index} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{badge}</span>)}
        </div>
        <Link to={`/product/${product.slug}`} className="mt-2 block font-semibold text-fg-strong hover:text-primary">{product.name}</Link>
        <div className="mt-1 grid gap-1 text-sm text-fg-muted sm:grid-cols-3">
          <span>{t('common.labels.brand')}: {product.brand || '—'}</span>
          <span>{t('common.labels.article')}: {product.article || product.sku || '—'}</span>
          <span className="font-semibold text-fg">{formatPrice(product.price, product.currency, t('common.fallbacks.priceRequest'), i18n.language)}</span>
        </div>
        {isPreorder ? <div className="mt-2 text-sm font-medium text-warn">{t('calculator.common.preorderNote')}</div> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary px-3 py-2 text-sm" onClick={() => onAdd(product)}>{t('common.actions.addToCart')}</button>
          {onPick ? <button className="btn-secondary px-3 py-2 text-sm" onClick={() => onPick(product)}>{t('common.actions.addToSelection')}</button> : null}
        </div>
      </div>
    </div>
  );
}
