import { BrandChip } from './BrandChip';
import { useTranslation } from 'react-i18next';
export function FilterSheet({ brands, activeBrand, setBrand }: { brands: string[]; activeBrand: string; setBrand: (v: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className="panel p-4">
      <div className="mb-3 text-sm font-medium text-slate-200">{t('catalog.filters.brandFilter')}</div>
      <div className="flex flex-wrap gap-2">
        <BrandChip brand={t('catalog.filters.allBrands')} active={!activeBrand} onClick={() => setBrand('')} />
        {brands.map((brand) => <BrandChip key={brand} brand={brand} active={activeBrand === brand} onClick={() => setBrand(brand)} />)}
      </div>
    </div>
  );
}
