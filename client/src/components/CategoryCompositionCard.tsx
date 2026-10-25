import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { CategoryComposition } from './CategoryComposition';
import { ManagedImage } from './ManagedImage';
import { PinButton } from './PinButton';
import { getCategoryTitle } from '../data/catalogExperience';
import type { CategoryComposition as CategoryCompositionConfig } from '../config/categoryCompositions';

type Count = number | string | null;
type CategoryCompositionCardProps = {
  category: { slug?: string; name_ru?: string; name_en?: string | null; name_hy?: string | null; image_url?: string | null; productsCount?: Count; products_count?: Count; count?: Count };
  to: string;
  composition: CategoryCompositionConfig;
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandle?: ReactNode | null;
  pinLabel?: string;
};

export function CategoryCompositionCard({ category, to, composition, pinned = false, onTogglePin, dragHandle = null, pinLabel }: CategoryCompositionCardProps) {
  const { t, i18n } = useTranslation();
  const title = getCategoryTitle(category, i18n.resolvedLanguage ?? i18n.language);
  const description = t(composition.descriptionKey, { defaultValue: composition.description });
  const rawCount = category.productsCount ?? category.products_count ?? category.count;
  const number = rawCount == null || rawCount === '' ? NaN : Number(rawCount);
  const productsCount = Number.isSafeInteger(number) && number >= 0 ? number : null;

  return (
    <article className={`category-composition-card group ${pinned ? 'is-pinned' : ''} ${onTogglePin ? 'has-pin' : ''}`}>
      {dragHandle ? <div className="category-composition-card__drag">{dragHandle}</div> : null}
      <Link to={to} className="category-composition-card__link">
        <div className="category-composition-card__art">
          {composition.layers.length ? (
            <CategoryComposition layers={composition.layers} />
          ) : (
            // Interim art until the owner-supplied PNG layers arrive: the category's existing catalog image.
            <div className="category-composition category-composition--pending" aria-hidden="true">
              <ManagedImage src={category.image_url || ''} alt="" placeholderTitle="" className="category-composition__photo" />
            </div>
          )}
        </div>
        <div className="category-composition-card__body">
          <h3 className="category-composition-card__title">{title}</h3>
          <p className="category-composition-card__description">{description}</p>
          <div className="category-composition-card__meta">
            {productsCount !== null ? <span className="category-stat-pill">{t('catalog.shared.counts.products', { count: productsCount })}</span> : <span />}
            <span className="category-composition-card__arrow" aria-hidden="true">→</span>
          </div>
        </div>
      </Link>
      {onTogglePin ? <PinButton active={pinned} onClick={onTogglePin} title={pinLabel || t(pinned ? 'catalog.shared.pin.unpinSubcategory' : 'catalog.shared.pin.pinSubcategory')} className="category-composition-card__pin" /> : null}
    </article>
  );
}
