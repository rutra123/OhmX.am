import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ManagedImage } from './ManagedImage';
import { QuantitySelector } from './QuantitySelector';
import { Check, ChevronRight, ShoppingCart } from './Icons';
import type { SeriesKit, SeriesKitColorVariant, SeriesKitItem } from '../types/ProductRelationships';

const ITEMS_PER_GROUP = 4;
const ADDED_FEEDBACK_MS = 1800;

function kitItemPrice(item: SeriesKitItem) {
  const price = Number(item.price_amd || 0);
  const showPrice = item.show_price !== false && item.show_price !== 0;
  return showPrice && price > 0 ? `${price.toLocaleString('ru-RU')} AMD` : '';
}

function kitItemImage(item: SeriesKitItem) {
  return String(item.cover_image || item.images?.[0]?.image_url || '');
}

function KitItemRow({ item, onAdd }: { item: SeriesKitItem; onAdd: (item: SeriesKitItem, quantity: number) => void }) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const name = String(item.name_ru || item.name || '');
  const url = item.slug ? `/product/${item.slug}` : '/catalog';
  const price = kitItemPrice(item);
  const canAdd = Boolean(item.can_add_to_cart) && Number.isFinite(Number(item.id));

  useEffect(() => {
    if (!added) return undefined;
    const timer = window.setTimeout(() => setAdded(false), ADDED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [added]);

  return (
    <article className="flex gap-3 rounded-2xl border border-line bg-card p-3">
      <Link to={url} className="block h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t('product.actions.openProduct', { name })}>
        <ManagedImage thumb src={kitItemImage(item)} alt={name} variant="product" placeholderTitle={name} placeholderSubtitle={String(item.brand_name || item.sku || 'OhmX.am')} className="h-full w-full object-contain" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Link to={url} className="line-clamp-2 text-sm font-semibold leading-snug text-fg-strong transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{name}</Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          {price ? <span className="text-sm font-semibold text-fg-strong">{price}</span> : null}
          <span>{String(item.availability_label || t('product.availability.request'))}</span>
          {item.matches_product ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{t('product.kit.matchesProduct')}</span> : null}
          {!item.color_key ? <span className="rounded-full bg-surface px-2 py-0.5">{t('product.kit.universal')}</span> : null}
        </div>
        {canAdd ? (
          <div className="flex flex-wrap items-center gap-2">
            <QuantitySelector value={quantity} onChange={setQuantity} size="sm" />
            <button
              type="button"
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${added ? 'bg-ok/15 text-ok' : 'bg-primary text-white hover:opacity-90'}`}
              onClick={() => { onAdd(item, quantity); setAdded(true); setQuantity(1); }}
              aria-label={t('product.actions.addToCartAria', { name })}
            >
              {added ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
              {added ? t('product.actions.added') : t('product.actions.addToCart')}
            </button>
          </div>
        ) : (
          <Link to={url} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {t('product.actions.details')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </article>
  );
}

export function ProductColorVariants({ currentColor, variants }: { currentColor: string; variants: SeriesKitColorVariant[] }) {
  const { t } = useTranslation();
  if (!variants.length) return null;
  return (
    <div className="mt-4">
      <div className="text-sm text-fg-muted">{t('product.variants.title')}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {currentColor ? (
          <span className="rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary" aria-current="true">{currentColor}</span>
        ) : null}
        {variants.map((variant) => (
          <Link
            key={variant.slug}
            to={`/product/${variant.slug}`}
            className="rounded-full border border-line bg-card px-3 py-1.5 text-sm text-fg-soft transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            title={variant.name_ru}
          >
            {variant.color}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProductSeriesKit({ kit, seriesUrl, onAdd }: {
  kit: SeriesKit;
  seriesUrl?: string;
  onAdd: (item: SeriesKitItem, quantity: number) => void;
}) {
  const { t } = useTranslation();
  const [colorKey, setColorKey] = useState(kit.defaultColorKey);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setColorKey(kit.defaultColorKey);
    setExpanded({});
  }, [kit]);

  const groups = useMemo(() => kit.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !colorKey || !item.color_key || item.color_key === colorKey) }))
    .filter((group) => group.items.length), [colorKey, kit.groups]);

  if (!kit.groups.length) return null;
  const selectedColor = kit.colors.find((color) => color.key === colorKey);

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="series-kit">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="series-kit" className="text-xl font-semibold text-fg-strong">{t('product.kit.title', { family: kit.familyName })}</h2>
          <p className="text-sm leading-6 text-fg-soft">
            {selectedColor ? t('product.kit.descriptionColor', { color: selectedColor.label }) : t('product.kit.description')}
          </p>
        </div>
        {seriesUrl ? (
          <Link to={seriesUrl} className="inline-flex items-center gap-1 text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {t('product.kit.viewSeries')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>

      {kit.colors.length > 1 ? (
        <div className="mb-5">
          <div className="mb-2 text-sm text-fg-muted">{t('product.kit.color')}</div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label={t('product.kit.color')}>
            {kit.colors.map((color) => (
              <button
                key={color.key}
                type="button"
                role="radio"
                aria-checked={color.key === colorKey}
                onClick={() => { setColorKey(color.key); setExpanded({}); }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${color.key === colorKey ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line bg-card text-fg-soft hover:border-primary'}`}
              >
                {color.label}
                {color.key === kit.productColorKey ? <span className="ml-1 text-xs opacity-70">· {t('product.kit.asThisProduct')}</span> : null}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={!colorKey}
              onClick={() => { setColorKey(''); setExpanded({}); }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!colorKey ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line bg-card text-fg-soft hover:border-primary'}`}
            >
              {t('product.kit.allColors')}
            </button>
          </div>
        </div>
      ) : null}

      {groups.length ? (
        <div className="space-y-5">
          {groups.map((group) => {
            const isExpanded = Boolean(expanded[group.key]);
            const visible = isExpanded ? group.items : group.items.slice(0, ITEMS_PER_GROUP);
            const hiddenCount = group.items.length - visible.length;
            return (
              <div key={group.key}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-fg-muted">{group.title}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {visible.map((item) => <KitItemRow key={String(item.id)} item={item} onAdd={onAdd} />)}
                </div>
                {hiddenCount > 0 || isExpanded ? (
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => setExpanded((prev) => ({ ...prev, [group.key]: !isExpanded }))}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? t('product.kit.showLess') : t('product.kit.showMore', { count: hiddenCount })}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-soft">{t('product.kit.emptyColor')}</p>
      )}
    </section>
  );
}
