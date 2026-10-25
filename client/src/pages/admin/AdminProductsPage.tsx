import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API } from '../../api/client';
import { AdminDebugPanel } from '../../components/AdminDebugPanel';
import { AdminLayout } from '../../components/AdminLayout';

export function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [filters, setFilters] = useState({ q: '', categoryId: '', brandId: '', isActive: '', inStock: '', sortBy: 'updated' });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [fullExport, setFullExport] = useState<{ state: 'idle' | 'running' | 'done'; message: string }>({ state: 'idle', message: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api<any[]>('/admin/categories').then(setCategories).catch(() => setCategories([]));
    api<any[]>('/admin/brands').then(setBrands).catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setLoading(true);
    setError('');
    api<any[]>(`/admin/products?${params.toString()}`)
      .then(setProducts)
      .catch((err) => {
        setProducts([]);
        setError(err.message || 'Не удалось загрузить товары');
      })
      .finally(() => setLoading(false));
  }, [filters]);

  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'sortBy' && Boolean(value));
  const resetFilters = () => setFilters({ q: '', categoryId: '', brandId: '', isActive: '', inStock: '', sortBy: 'updated' });

  const handleExportProducts = async (currentOnly: boolean) => {
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (currentOnly) {
        Object.entries(filters).forEach(([key, value]) => {
          if (!value || key === 'sortBy') return;
          params.set(key === 'q' ? 'search' : key, value);
        });
      } else {
        params.set('includeInactive', 'true');
        params.set('includeHidden', 'true');
      }
      const token = window.localStorage.getItem('ek-admin-token') || '';
      const response = await fetch(`${API}/admin/products/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text() || 'Не удалось экспортировать товары');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || 'ohmx_products_export.csv';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка экспорта');
    } finally {
      setExporting(false);
    }
  };

  // Full catalog: every product with categories, specifications, images, documents and stock (server streams one CSV).
  const handleExportFullCatalog = async () => {
    setFullExport({ state: 'running', message: 'Формируется полный каталог…' });
    setError('');
    try {
      const token = window.localStorage.getItem('ek-admin-token') || '';
      const response = await fetch(`${API}/admin/products/export/full`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text() || 'Не удалось выгрузить полный каталог');
      // blob() rejects if the server aborts mid-stream, so an incomplete file is never offered for download.
      const blob = await response.blob();
      const rowCount = response.headers.get('x-export-row-count');
      const match = (response.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/i);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = match?.[1] || 'OHMX_FULL_PRODUCT_CATALOG.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFullExport({ state: 'done', message: rowCount ? `Готово: ${rowCount} товаров` : 'Готово' });
    } catch (err) {
      setFullExport({ state: 'idle', message: '' });
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка экспорта каталога');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Товары</h1>
            <div className="text-sm text-muted">Поиск, фильтры и быстрый переход к редактированию карточек товара.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => handleExportProducts(false)} disabled={exporting}>{exporting ? 'Экспорт...' : 'Экспорт всех товаров'}</button>
            <button className="btn-secondary" onClick={() => handleExportProducts(true)} disabled={exporting}>{exporting ? 'Экспорт...' : 'Экспорт текущей выборки'}</button>
            <button className="btn-secondary" onClick={handleExportFullCatalog} disabled={fullExport.state === 'running'} aria-busy={fullExport.state === 'running'}>
              {fullExport.state === 'running' ? 'Формируется…' : 'Экспорт полного каталога (CSV)'}
            </button>
            <Link to="/admin/products/new" className="btn-primary">Новый товар</Link>
          </div>
        </div>

        {fullExport.message ? <div className="text-sm text-muted" role="status">{fullExport.message}</div> : null}

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input className="field xl:col-span-2" placeholder="SKU / название / бренд" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select className="field" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">Все категории</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name_ru}</option>)}
          </select>
          <select className="field" value={filters.brandId} onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}>
            <option value="">Все бренды</option>
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <select className="field" value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
            <option value="">Все статусы</option>
            <option value="true">Только активные</option>
            <option value="false">Только скрытые</option>
          </select>
          <select className="field" value={filters.inStock} onChange={(e) => setFilters({ ...filters, inStock: e.target.value })}>
            <option value="">Любое наличие</option>
            <option value="true">Только в наличии</option>
          </select>
          <select className="field" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}>
            <option value="updated">Сначала новые</option>
            <option value="name">По названию</option>
            <option value="price">По цене</option>
            <option value="sku">По SKU</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="panel flex items-center px-4 text-sm text-slate-300">Найдено: {products.length}</div>
          <button className="btn-secondary" onClick={resetFilters} disabled={!hasFilters}>Сбросить фильтры</button>
        </div>

        <AdminDebugPanel refreshKey={products.length} />

        {error ? <div className="panel p-4 text-sm text-red-300">Ошибка загрузки: {error}</div> : null}

        <div className="space-y-2">
          {!loading && !error && products.length === 0 ? (
            <div className="panel p-5 text-sm text-slate-300">
              <div>{hasFilters ? 'По текущим фильтрам ничего не найдено.' : 'Нет данных. Создайте первую запись или импортируйте CSV.'}</div>
              {hasFilters ? <button className="btn-secondary mt-3" onClick={resetFilters}>Сбросить фильтры</button> : null}
            </div>
          ) : null}
          {products.map((product) => (
            <div key={product.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{product.name_ru}</div>
                    {product.documents_count > 0 ? <span className="chip">docs {product.documents_count}</span> : null}
                    {!product.is_active ? <span className="chip">Скрыт</span> : null}
                    {product.available_quantity > 0 ? <span className="chip">stock {product.available_quantity}</span> : null}
                  </div>
                  <div className="mt-1 text-sm text-muted">{product.sku} · {product.brand_name || 'Без бренда'} · {product.category_name || 'Без категории'}</div>
                </div>
                <Link to={`/admin/products/${product.id}/edit`} className="btn-secondary">Редактировать</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
