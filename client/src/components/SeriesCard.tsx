import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ManagedImage } from './ManagedImage';
import { PinButton } from './PinButton';

function getSeriesInitials(title: string) {
  const cleaned = String(title || '')
    .replace(/^legrand\s+серия\s+/iu, '')
    .replace(/[^a-zа-яё0-9\s]/giu, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return 'SX';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

type SeriesCardProps = {
  title: string;
  subtitle: string;
  imageUrl?: string;
  to: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandle?: ReactNode | null;
};

export function SeriesCard({ title, subtitle, imageUrl, to, pinned = false, onTogglePin, dragHandle = null }: SeriesCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`catalog-list-card catalog-list-card--copy-fluid catalog-list-card--series group catalog-list-card--with-pin ${pinned ? 'is-pinned' : ''}`}>
      {dragHandle}
      <Link to={to} className={`catalog-list-card__thumb catalog-list-card__thumb--series ${imageUrl ? 'catalog-list-card__thumb--series-image' : ''}`}>
        {imageUrl ? (
          <ManagedImage
            src={imageUrl}
            thumb
            alt={title}
            placeholderTitle={title}
            placeholderSubtitle={t('catalog.category.cards.series')}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="series-card-fallback" aria-hidden="true">
            <span>{getSeriesInitials(title)}</span>
          </div>
        )}
      </Link>
      <Link to={to} className="catalog-list-card__copy min-w-0 flex-1">
        <div className="catalog-list-card__title">{title}</div>
        <div className="catalog-list-card__subtitle">{subtitle}</div>
      </Link>
      {onTogglePin ? <PinButton active={pinned} onClick={onTogglePin} title={pinned ? t('catalog.shared.pin.unpinSeries') : t('catalog.shared.pin.pinSeries')} className="catalog-list-card__pin" /> : null}
    </div>
  );
}
