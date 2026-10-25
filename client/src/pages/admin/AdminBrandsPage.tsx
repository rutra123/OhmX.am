import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { AdminDebugPanel } from '../../components/AdminDebugPanel';
import { AdminLayout } from '../../components/AdminLayout';

export function AdminBrandsPage() {
  const [brands, setBrands] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    setLoading(true);
    setError('');
    api<any[]>(`/admin/brands${params.toString() ? `?${params.toString()}` : ''}`)
      .then(setBrands)
      .catch((err) => {
        setBrands([]);
        setError(err.message || 'Не удалось загрузить бренды');
      })
      .finally(() => setLoading(false));
  }, [search]);

  const hasFilters = Boolean(search);
  const resetFilters = () => setSearch('');

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Бренды</h1>
            <div className="text-sm text-muted">CRUD брендов, popular flags и подготовка public brand pages.</div>
          </div>
          <Link to="/admin/brands/new" className="btn-primary">Новый бренд</Link>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <input className="field" placeholder="Поиск бренда" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-3">
            <div className="panel flex flex-1 items-center px-4 text-sm text-slate-300">Найдено: {brands.length}</div>
            <button className="btn-secondary" onClick={resetFilters} disabled={!hasFilters}>Сбросить фильтры</button>
          </div>
        </div>

        <AdminDebugPanel refreshKey={brands.length} />

        {error ? <div className="panel p-4 text-sm text-red-300">Ошибка загрузки: {error}</div> : null}

        <div className="space-y-2">
          {!loading && !error && brands.length === 0 ? (
            <div className="panel p-5 text-sm text-slate-300">
              <div>{hasFilters ? 'По текущим фильтрам ничего не найдено.' : 'Нет данных. Создайте первую запись или импортируйте CSV.'}</div>
              {hasFilters ? <button className="btn-secondary mt-3" onClick={resetFilters}>Сбросить фильтры</button> : null}
            </div>
          ) : null}
          {brands.map((brand) => (
            <div key={brand.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{brand.name}</div>
                    {brand.is_popular ? <span className="chip">popular</span> : null}
                    {!brand.is_active ? <span className="chip">Скрыт</span> : null}
                  </div>
                  <div className="mt-1 text-sm text-muted">/{brand.slug}{brand.country ? ` · ${brand.country}` : ''}</div>
                  {brand.description_ru ? <div className="mt-2 text-sm text-slate-300">{brand.description_ru}</div> : null}
                </div>
                <Link to={`/admin/brands/${brand.id}/edit`} className="btn-secondary">Редактировать</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
