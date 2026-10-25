import { Link } from 'react-router-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ManagedImage } from './ManagedImage';
import { getCategoryDescription, getCategoryTitle } from '../data/catalogExperience';
import { PinButton } from './PinButton';
import type { MouseEvent, ReactNode } from 'react';

type CategoryCardProps = {
  category: any;
  to?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandle?: ReactNode | null;
  pinLabel?: string;
};

export function CategoryCard({ category, to, pinned = false, onTogglePin, dragHandle = null, pinLabel }: CategoryCardProps) {
  const { t } = useTranslation();
  const href = to || `/catalog/${category.slug}`;
  const [expanded, setExpanded] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const title = getCategoryTitle(category);
  const productsCount = Number(category.productsCount ?? category.products_count ?? category.count ?? 0);
  const childrenCount = Number(category.childrenCount ?? category.children_count ?? category.directionsCount ?? 0);
  const rawDescription = getCategoryDescription(category);
  const description = /импорт/i.test(rawDescription) ? '' : rawDescription;
  const canExpand = titleOverflows;

  useLayoutEffect(() => {
    setExpanded(false);
    const measure = () => {
      const node = titleRef.current;
      if (!node) return;
      setTitleOverflows(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [title]);

  const toggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded((value) => !value);
  };

  const hasProductImage = Boolean(category.image_url);

  return (
    <div className={`catalog-list-card catalog-list-card--copy-fluid catalog-list-card--category-nav group ${dragHandle ? 'catalog-list-card--category-nav-draggable' : ''} ${canExpand ? 'has-overflow' : ''} ${expanded ? 'is-expanded' : ''} ${pinned ? 'is-pinned' : ''}`}>
      {dragHandle}
      <Link to={href} className={`catalog-list-card__thumb catalog-list-card__thumb--category ${hasProductImage ? 'catalog-list-card__thumb--category-product-image' : 'bg-gradient-to-br from-slate-900 to-slate-700'}`}>
        <ManagedImage
          src={category.image_url}
          thumb
          alt={title}
          placeholderTitle=""
          className="catalog-list-card__category-image"
        />
      </Link>
      <Link to={href} className="min-w-0 flex-1">
        <div ref={titleRef} className="catalog-list-card__title">{title}</div>
        <div className="catalog-list-card__meta">
          {childrenCount ? <span className="category-stat-pill">{t('catalog.shared.counts.directions', { count: childrenCount })}</span> : null}
          {productsCount ? <span className="category-stat-pill">{t('catalog.shared.counts.products', { count: productsCount })}</span> : null}
          {description ? <span className="catalog-list-card__description">{description}</span> : null}
          {canExpand ? (
            <button type="button" className="catalog-list-card__expand" onClick={toggleExpanded} aria-label={expanded ? t('catalog.category.cards.collapseFullText') : t('catalog.category.cards.showFullText')}>
              {expanded ? '⌃' : '⌄'}
            </button>
          ) : null}
        </div>
      </Link>
      {onTogglePin ? (
        <PinButton active={pinned} onClick={onTogglePin} title={pinLabel || (pinned ? t('catalog.shared.pin.unpin') : t('catalog.shared.pin.pin'))} className="catalog-list-card__pin" />
      ) : null}
    </div>
  );
}
