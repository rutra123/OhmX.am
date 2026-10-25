import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API } from '../../api/client';
import { AdminDebugPanel } from '../../components/AdminDebugPanel';
import { AdminLayout } from '../../components/AdminLayout';
import AdminCategoriesDeleteModal from '../../components/AdminCategoriesDeleteModal';
import type { Category } from '../../types/Category';

type FilterValue = '' | 'true' | 'false';

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
}

function getExportFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const raw = match?.[1] || match?.[2] || '';
  try {
    return raw ? decodeURIComponent(raw) : fallback;
  } catch {
    return raw || fallback;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function boolLabel(value: unknown, enabled: string, disabled: string) {
  return Number(value ?? 0) === 1 || value === true ? enabled : disabled;
}

export function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [parentId, setParentId] = useState('');
  const [isActive, setIsActive] = useState<FilterValue>('');
  const [isPublic, setIsPublic] = useState<FilterValue>('');
  const [hasChildren, setHasChildren] = useState<FilterValue>('');
  const [hasProducts, setHasProducts] = useState<FilterValue>('');
  const [sortBy, setSortBy] = useState('sort_order');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCategories = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (level) params.set('level', level);
    if (parentId) params.set('parentId', parentId);
    if (isActive) params.set('isActive', isActive);
    if (isPublic) params.set('isPublic', isPublic);
    if (hasChildren) params.set('hasChildren', hasChildren);
    if (hasProducts) params.set('hasProducts', hasProducts);
    if (sortBy) params.set('sortBy', sortBy);
    setLoading(true);
    setError('');
    api<Category[]>(`/admin/categories${params.toString() ? `?${params.toString()}` : ''}`)
      .then(setCategories)
      .catch((err) => {
        setCategories([]);
        setError(normalizeError(err) || 'Не удалось загрузить категории');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories();
  }, [search, level, parentId, isActive, isPublic, hasChildren, hasProducts, sortBy]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleCategories = showSelectedOnly ? categories.filter((category) => selectedSet.has(category.id)) : categories;
  const selectedCategories = useMemo(() => categories.filter((category) => selectedSet.has(category.id)), [categories, selectedSet]);
  const parentOptions = useMemo(() => categories.filter((category) => Number(category.is_active ?? 1) === 1), [categories]);
  const visibleIds = visibleCategories.map((category) => category.id);
  const hasFilters = Boolean(search || level || parentId || isActive || isPublic || hasChildren || hasProducts);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const resetFilters = () => {
    setSearch('');
    setLevel('');
    setParentId('');
    setIsActive('');
    setIsPublic('');
    setHasChildren('');
    setHasProducts('');
    setShowSelectedOnly(false);
  };

  const handleCheckboxChange = (id: number, isChecked: boolean) => {
    setSelectedIds((current) => (isChecked ? [...new Set([...current, id])] : current.filter((item) => item !== id)));
  };

  const handleSelectAllVisible = () => {
    setSelectedIds((current) => [...new Set([...current, ...visibleIds])]);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
    setShowSelectedOnly(false);
  };

  const handleBulkAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selectedIds.length) return;
    if (action === 'delete_selected' || action === 'soft_delete') {
      setIsDeleteModalOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/admin/categories/bulk', {
        method: 'POST',
        body: JSON.stringify({ action, ids: selectedIds, ...extra }),
      });
      setMessage('Массовое действие выполнено.');
      setSelectedIds([]);
      setShowSelectedOnly(false);
      loadCategories();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCategory = (category: Category) => {
    setSelectedIds([category.id]);
    setIsDeleteModalOpen(true);
  };

  const handleExportProducts = async () => {
    setExporting(true);
    setExportError('');
    try {
      const token = window.localStorage.getItem('ek-admin-token') || '';
      const response = await fetch(`${API}/admin/products/export?format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text() || 'Export failed');
      const blob = await response.blob();
      const filename = getExportFilename(response, 'ohmx_products_export.csv');
      downloadBlob(blob, filename);
    } catch (err) {
      setExportError(normalizeError(err));
    } finally {
      setExporting(false);
    }
  };

  const handleExportCategoryTree = async () => {
    setExporting(true);
    setExportError('');
    try {
      const token = window.localStorage.getItem('ek-admin-token') || '';
      const response = await fetch(`${API}/admin/categories/export-tree.csv`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text() || 'Не удалось экспортировать дерево категорий');
      const blob = await response.blob();
      const filename = getExportFilename(response, `ohmx_category_tree_${new Date().toISOString().slice(0, 10)}.csv`);
      downloadBlob(blob, filename);
    } catch (err) {
      setExportError(normalizeError(err));
    } finally {
      setExporting(false);
    }
  };

  const onDeleted = () => {
    setIsDeleteModalOpen(false);
    setSelectedIds([]);
    setShowSelectedOnly(false);
    setMessage('Категории безопасно скрыты/deactivated.');
    loadCategories();
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Категории</h1>
            <div className="text-sm text-muted">Управление public cards и глубоким catalog tree без ломки текущей структуры.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={handleExportProducts} disabled={exporting}>{exporting ? 'Экспортируем...' : 'Экспорт товаров'}</button>
            <button type="button" className="btn-secondary" onClick={handleExportCategoryTree} disabled={exporting}>{exporting ? 'Экспортируем...' : 'Экспорт дерева CSV'}</button>
            <Link to="/admin/categories/new" className="btn-primary">Новая категория</Link>
          </div>
        </div>

        <div className="panel grid gap-3 p-4 md:grid-cols-4">
          <input className="field" placeholder="Поиск по названию / slug" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Все уровни</option>
            <option value="root">Root</option>
            <option value="child">Child</option>
            <option value="deep">Deep</option>
          </select>
          <select className="field" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Любой parent</option>
            <option value="null">Root only</option>
            {parentOptions.map((category) => <option key={category.id} value={category.id}>{category.name_ru}</option>)}
          </select>
          <select className="field" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="sort_order">Sort order</option>
            <option value="name">Название</option>
            <option value="id">ID</option>
            <option value="products">Товары</option>
            <option value="children">Дочерние</option>
          </select>
          <select className="field" value={isActive} onChange={(e) => setIsActive(e.target.value as FilterValue)}>
            <option value="">Активность: все</option>
            <option value="true">Активные</option>
            <option value="false">Неактивные</option>
          </select>
          <select className="field" value={isPublic} onChange={(e) => setIsPublic(e.target.value as FilterValue)}>
            <option value="">Публичность: все</option>
            <option value="true">Публичные</option>
            <option value="false">Скрытые</option>
          </select>
          <select className="field" value={hasChildren} onChange={(e) => setHasChildren(e.target.value as FilterValue)}>
            <option value="">Дочерние: все</option>
            <option value="true">Есть дочерние</option>
            <option value="false">Без дочерних</option>
          </select>
          <select className="field" value={hasProducts} onChange={(e) => setHasProducts(e.target.value as FilterValue)}>
            <option value="">Товары: все</option>
            <option value="true">Есть товары</option>
            <option value="false">Без товаров</option>
          </select>
          <button className="btn-secondary md:col-span-4" onClick={resetFilters} disabled={!hasFilters}>Сбросить фильтры</button>
        </div>

        <AdminDebugPanel refreshKey={categories.length} />

        {error ? <div className="panel p-4 text-sm text-red-300">Ошибка: {error}</div> : null}
        {exportError ? <div className="panel p-4 text-sm text-red-300">Ошибка экспорта: {exportError}</div> : null}
        {message ? <div className="panel p-4 text-sm text-emerald-300">{message}</div> : null}

        <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-300">
          <div>Найдено: {categories.length}; выбрано: {selectedIds.length}</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={allVisibleSelected ? handleClearSelection : handleSelectAllVisible} disabled={!visibleIds.length}>{allVisibleSelected ? 'Очистить выбор' : 'Выбрать видимые'}</button>
            <button className="btn-secondary" onClick={() => setShowSelectedOnly((value) => !value)} disabled={!selectedIds.length}>{showSelectedOnly ? 'Показать все' : 'Показать только выбранные'}</button>
            <button className="btn-secondary" onClick={() => handleBulkAction('set_active')} disabled={!selectedIds.length || busy}>Активировать</button>
            <button className="btn-secondary" onClick={() => handleBulkAction('set_inactive')} disabled={!selectedIds.length || busy}>Деактивировать</button>
            <button className="btn-secondary" onClick={() => handleBulkAction('set_visible')} disabled={!selectedIds.length || busy}>Сделать публичными</button>
            <button className="btn-secondary" onClick={() => handleBulkAction('set_hidden')} disabled={!selectedIds.length || busy}>Скрыть</button>
            <button className="btn-secondary" onClick={() => handleBulkAction('delete_selected')} disabled={!selectedIds.length || busy}>Удалить выбранные</button>
          </div>
        </div>

        <div className="space-y-2">
          {!loading && !error && visibleCategories.length === 0 ? (
            <div className="panel p-5 text-sm text-slate-300">
              <div>{hasFilters || showSelectedOnly ? 'По текущим фильтрам ничего не найдено.' : 'Нет данных. Создайте первую запись или импортируйте CSV.'}</div>
              {hasFilters ? <button className="btn-secondary mt-3" onClick={resetFilters}>Сбросить фильтры</button> : null}
            </div>
          ) : null}
          {visibleCategories.map((category) => (
            <div key={category.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-3">
                  <input type="checkbox" checked={selectedSet.has(category.id)} onChange={(event) => handleCheckboxChange(category.id, event.target.checked)} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold">{category.name_ru}</div>
                      <span className="chip">ID {category.id}</span>
                      <span className="chip">level {category.level}</span>
                      <span className="chip">sort {category.sort_order ?? 0}</span>
                      <span className="chip">children {category.children_count ?? 0}</span>
                      <span className="chip">products {category.product_count ?? 0}</span>
                      <span className="chip">{boolLabel(category.is_active, 'Активен', 'Неактивен')}</span>
                      <span className="chip">{boolLabel(category.is_public, 'Публичный', 'Скрыт')}</span>
                    </div>
                    <div className="mt-1 text-sm text-muted">/{category.slug}{category.parent_name ? ` · parent: ${category.parent_name}` : ' · parent: ROOT'}</div>
                    {category.short_description_ru ? <div className="mt-2 text-sm text-slate-300">{category.short_description_ru}</div> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={() => handleDeleteCategory(category)}>Удалить</button>
                  <Link to={`/admin/categories/${category.id}/edit`} className="btn-secondary">Редактировать</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <AdminCategoriesDeleteModal
        open={isDeleteModalOpen}
        categories={selectedCategories}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeleted={onDeleted}
      />
    </AdminLayout>
  );
}
