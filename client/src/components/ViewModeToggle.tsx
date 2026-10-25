import { ViewGrid, ViewList } from './Icons';
import { useTranslation } from 'react-i18next';

type ViewMode = 'grid' | 'list';

export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="view-toggle" aria-label={t('search.viewMode.ariaLabel')}>
      <button
        type="button"
        className={`view-toggle__btn ${value === 'grid' ? 'active' : ''}`}
        onClick={() => onChange('grid')}
        aria-label={t('search.viewMode.grid')}
        title={t('search.viewMode.grid')}
      >
        <ViewGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={`view-toggle__btn ${value === 'list' ? 'active' : ''}`}
        onClick={() => onChange('list')}
        aria-label={t('search.viewMode.list')}
        title={t('search.viewMode.list')}
      >
        <ViewList className="h-4 w-4" />
      </button>
    </div>
  );
}
