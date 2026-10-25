import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from './Icons';
import { PinButton } from './PinButton';

type BrandCardProps = {
  brand: any;
  to: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandle?: ReactNode | null;
};

export function BrandCard({ brand, to, pinned = false, onTogglePin, dragHandle = null }: BrandCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`catalog-list-card group catalog-list-card--with-pin ${pinned ? 'is-pinned' : ''}`}>
      {dragHandle}
      <Link to={to} className="catalog-list-card__thumb brand-logo-frame flex items-center justify-center">
        {brand.logo_url ? <img src={brand.logo_url} alt={brand.name} className="brand-logo-image" /> : <div className="text-3xl font-bold text-slate-500">{brand.name.slice(0, 1).toUpperCase()}</div>}
      </Link>
      <Link to={to} className="min-w-0 flex-1">
        <div className="catalog-list-card__title">{brand.name}</div>
        <div className="catalog-list-card__subtitle">
          {brand.productsCount
            ? t('catalog.category.cards.brandProducts', { count: brand.productsCount })
            : t('catalog.category.cards.brandConnected')}
        </div>
      </Link>
      <div className="flex items-center gap-2 justify-self-end">
        {onTogglePin ? <PinButton active={pinned} onClick={onTogglePin} title={pinned ? t('catalog.shared.pin.unpinBrand') : t('catalog.shared.pin.pinBrand')} className="catalog-list-card__pin" /> : null}
        <div className="catalog-list-card__arrow">
          <ChevronRight className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
