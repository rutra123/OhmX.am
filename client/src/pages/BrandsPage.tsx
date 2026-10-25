import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { featuredBrands } from '../data/publicMenu';

export function BrandsPage() {
  const [brands, setBrands] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>('/brands').then(setBrands).catch(() => setBrands([]));
  }, []);

  const filtered = useMemo(() => {
    const sorted = [...brands].sort((a, b) => {
      const ai = featuredBrands.includes(a.name as any) ? 0 : 1;
      const bi = featuredBrands.includes(b.name as any) ? 0 : 1;
      return ai - bi || a.name.localeCompare(b.name, 'ru');
    });
    return sorted;
  }, [brands]);

  return (
    <div className="page space-y-6">
      <Breadcrumbs items={[{ label: 'Главная', to: '/' }, { label: 'Бренды' }]} />
      <div>
        <div className="section-caption">Бренды</div>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Производители и брендовые линейки</h1>
        <p className="mt-2 max-w-3xl text-slate-600">Бренды — это отдельный сервисный раздел каталога. Выберите производителя, чтобы увидеть его товары и перейти в нужную ветку.</p>
      </div>
      <div className="brand-grid">
        {filtered.map((brand) => (
          <Link key={brand.id} to={`/brands/${brand.slug}`} className="brand-tile group">
            <div className="brand-tile__mark brand-logo-frame">{brand.logo_url ? <img src={brand.logo_url} alt={brand.name} className="brand-logo-image" /> : <span>{brand.name.slice(0, 1).toUpperCase()}</span>}</div>
            <div className="brand-tile__title">{brand.name}</div>
            <div className="brand-tile__subtitle">{brand.country || 'Поставщик инженерного оборудования'}</div>
          </Link>
        ))}
      </div>
      {!filtered.length ? <div className="panel p-5 text-slate-600">По этому запросу бренды не найдены. Попробуйте часть названия или откройте полный список.</div> : null}
    </div>
  );
}
