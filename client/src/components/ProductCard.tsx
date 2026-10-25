import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getDisplaySeriesName } from '../lib/series';
import { ManagedImage } from './ManagedImage';
import { useStore } from '../store/useStore';
import { Compare } from './Icons';
import { PinButton } from './PinButton';
import { useTranslation } from 'react-i18next';
import { descriptionToPlainText } from '../lib/productDescription';

type ProductCardProps = {
  product: any;
  view?: 'grid' | 'list';
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandle?: ReactNode | null;
};

export function ProductCard({ product, view = 'list', pinned = false, onTogglePin, dragHandle = null }: ProductCardProps) {
  const { t } = useTranslation();
  const displaySeriesName = getDisplaySeriesName(product);
  const subtitle = descriptionToPlainText(product.short_description_ru || product.description_ru || '', 180) || displaySeriesName || t('catalog.productCard.subtitleFallback');
  const price = Number(product.price_amd || 0);
  const addToCart = useStore((s) => s.addToCart);
  const compare = useStore((s) => s.compare);
  const toggleCompare = useStore((s) => s.toggleCompare);
  const isCompared = compare.some((item) => item.productId === product.id);
  const imageFitClass = view === 'list'
    ? 'h-full w-full object-contain p-2'
    : 'h-full w-full object-contain p-3';
  const actionButtonClass = view === 'list' ? 'btn-secondary product-card-btn-compact' : 'btn-secondary';
  const primaryActionClass = view === 'list' ? 'btn-primary product-card-btn-compact whitespace-nowrap' : 'btn-primary whitespace-nowrap';

  return (
    <div className={`product-commerce-card product-commerce-card--${view} group ${pinned ? 'is-pinned' : ''}`}>
      {dragHandle ? <div className="product-card-drag-slot">{dragHandle}</div> : null}
      <Link to={`/product/${product.slug}`} className={`product-commerce-card__media product-commerce-card__media--${view}`}>
        <ManagedImage
          src={product.cover_image}
          thumb
          alt={product.name_ru}
          variant="product"
          placeholderTitle={product.name_ru}
          placeholderSubtitle={product.brand_name || t('common.labels.product')}
          className={imageFitClass}
        />
      </Link>
      <div className={`min-w-0 ${view === 'list' ? 'product-commerce-card__body' : 'product-commerce-card__body product-commerce-card__body--grid'}`}>
        <div className="product-commerce-card__toprow">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-fg-muted">
            {product.brand_name ? <span>{product.brand_name}</span> : null}
            <span>SKU {product.sku}</span>
          </div>
          {onTogglePin ? <PinButton active={pinned} onClick={onTogglePin} title={pinned ? t('catalog.shared.pin.unpinProduct') : t('catalog.shared.pin.pinProduct')} className="product-card-pin-btn" /> : null}
        </div>
        <Link to={`/product/${product.slug}`} className="product-commerce-card__title">
          {product.name_ru}
        </Link>
        <div className={`mt-2 text-sm text-fg-muted ${view === 'grid' ? 'line-clamp-2 leading-5 product-commerce-card__subtitle' : 'line-clamp-2 leading-5 sm:leading-6 product-commerce-card__subtitle'}`}>{subtitle}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className={`availability-pill availability-pill--${product.availability_status || 'request'}`}>{product.availability_label || t('common.fallbacks.availabilityUnknown')}</span>
          {displaySeriesName ? <span className="category-stat-pill">{displaySeriesName}</span> : null}
          {product.documents_count ? <span className="category-stat-pill">{t('catalog.productCard.documentsCount', { count: product.documents_count })}</span> : null}
        </div>
        <div className={view === 'list' ? 'product-commerce-card__footer' : 'product-commerce-card__footer product-commerce-card__footer--grid'}>
          <div className="text-left">
            <div className="text-sm text-fg-muted">{t('common.labels.price')}</div>
            <div className="text-xl font-bold text-fg-strong">{price > 0 ? `${price.toLocaleString('ru-RU')} AMD` : t('common.fallbacks.priceRequest')}</div>
          </div>
          <div className={`flex flex-wrap gap-2 ${view === 'grid' ? 'mt-3' : ''}`}>
            <Link to={`/product/${product.slug}`} className={actionButtonClass}>{t('common.actions.details')}</Link>
            <button
              type="button"
              className={`${actionButtonClass} ${isCompared ? 'product-card-compare-btn active' : 'product-card-compare-btn'}`}
              onClick={() => toggleCompare({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name_ru, price: product.price_amd, brandName: product.brand_name })}
            >
              <Compare className="h-4 w-4" />
              <span>{isCompared ? t('compare.actions.inCompare') : t('compare.actions.compare')}</span>
            </button>
            {product.can_add_to_cart ? (
              <button
                className={primaryActionClass}
                onClick={() => addToCart({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name_ru, price: product.price_amd, image: product.cover_image })}
              >
                {t('common.actions.addToCart')}
              </button>
            ) : (
              <Link to={`/contacts?sku=${encodeURIComponent(product.sku || '')}&product=${encodeURIComponent(product.name_ru || '')}`} className={primaryActionClass}>
                {t('common.actions.requestPrice')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
