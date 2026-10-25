import { Link } from 'react-router-dom';
import type { PublicCategory } from '../data/publicMenu';
import { PinButton } from './PinButton';
import { useTranslation } from 'react-i18next';
import { RootCategoryMedia } from './RootCategoryMedia';

type Props = {
  item: PublicCategory & { productsCount?: number; childrenCount?: number };
  pinned?: boolean;
  onTogglePin?: () => void;
};

export function PublicCategoryCard({ item, pinned = false, onTogglePin }: Props) {
  const { t } = useTranslation();

  return (
    <Link to={item.to} className="category-showcase-card group">
      <div className="flex items-start justify-between gap-3">
        <div className="category-showcase-card__header">
          <div className="category-showcase-card__title">{item.title}</div>
        </div>
        {onTogglePin ? <PinButton active={pinned} onClick={onTogglePin} title={pinned ? t('catalog.shared.pin.unpinCategory') : t('catalog.shared.pin.pinCategory')} /> : null}
      </div>
      <div className="category-showcase-card__subtitle">{item.description}</div>
      <RootCategoryMedia imageUrl={item.imageUrl} alt={item.title} fallback={item.title.slice(0, 1)} />
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {typeof item.childrenCount === 'number' ? <span className="category-stat-pill">{t('catalog.publicCard.directionsCount', { count: item.childrenCount })}</span> : null}
          {typeof item.productsCount === 'number' ? <span className="category-stat-pill">{t('catalog.publicCard.productsCount', { count: item.productsCount })}</span> : null}
        </div>
        <div className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <span>{t('catalog.publicCard.openSection')}</span>
          <span aria-hidden="true">→</span>
        </div>
      </div>
    </Link>
  );
}
