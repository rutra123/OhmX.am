import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ProductCard } from '../components/ProductCard';
import { ArrowLeft, ChevronRight } from '../components/Icons';
import { ViewModeToggle } from '../components/ViewModeToggle';

export function BrandDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [productView, setProductView] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('ohmx-product-view') === 'list' ? 'list' : 'grid';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ohmx-product-view', productView);
  }, [productView]);

  useEffect(() => {
    api(`/brands/${slug}`).then(setData).catch(() => setData(null));
  }, [slug]);

  const brand = data;
  const products = data?.products || [];
  const categories = useMemo(() => {
    const seen = new Set<string>();
    return (data?.categories || []).filter((category: any) => {
      const key = String(category.name_ru || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data?.categories]);

  return (
    <div className="page space-y-4">
      <div className="flex items-center gap-3">
        <button className="circle-icon-btn" onClick={() => navigate(-1)} aria-label="Назад">
          <ArrowLeft className="h-7 w-7" />
        </button>
        <div className="mobile-page-title text-left">{brand?.name || slug}</div>
      </div>
      <Breadcrumbs items={[{ label: 'Главная', to: '/' }, { label: 'Бренды', to: '/brands' }, { label: brand?.name || slug }]} />
      <div className="panel p-5">
        <div className="flex items-center gap-4">
          <div className="catalog-list-card__thumb brand-logo-frame brand-logo-frame--hero flex items-center justify-center">
            {brand?.logo_url ? <img src={brand.logo_url} alt={brand.name} className="brand-logo-image" /> : <div className="text-3xl font-bold text-slate-500">{(brand?.name || slug).slice(0, 1).toUpperCase()}</div>}
          </div>
          <div>
            <div className="text-3xl font-bold">{brand?.name || slug}</div>
            <div className="mt-2 text-slate-400">{brand?.country || 'Мультибрендовый инженерный поставщик'}</div>
          </div>
        </div>
      </div>
      {categories.length ? (
        <div className="space-y-3">
          <div className="text-xl font-semibold">Категории бренда</div>
          <div className="catalog-list catalog-list--brand-categories">
            {categories.map((category: any) => (
              <Link key={category.id} to={`/catalog/${category.slug}`} className="catalog-list-card catalog-list-card--brand-category group">
                <div className="min-w-0 flex-1">
                  <div className="catalog-list-card__title">{category.name_ru}</div>
                  {category.products_count ? <div className="catalog-list-card__subtitle">{category.products_count} товаров</div> : null}
                </div>
                <div className="catalog-list-card__arrow">
                  <ChevronRight className="h-6 w-6" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xl font-semibold">Товары</div>
          <ViewModeToggle value={productView} onChange={setProductView} />
        </div>
        {products.length ? <div className={productView === 'grid' ? 'product-grid' : 'space-y-3'}>{products.map((product: any) => <ProductCard key={product.id} product={product} view={productView} />)}</div> : <div className="panel p-4 text-slate-300">У этого бренда пока нет активных товаров.</div>}
      </div>
    </div>
  );
}
