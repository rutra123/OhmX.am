import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, API } from '../../api/client';
import { AdminLayout } from '../../components/AdminLayout';
import { FileUploader } from '../../components/FileUploader';
import { useStore } from '../../store/useStore';
import { documentTypeLabels } from '../../lib/documents';

const documentTypeOptions = Object.entries(documentTypeLabels);

const emptyFeature = { feature_name: '', feature_value: '', feature_unit: '', sort_order: 0 };

export function AdminProductEditPage() {
  const { id } = useParams();
  const token = useStore((s) => s.adminToken);
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [series, setSeries] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    sku: '',
    name_ru: '',
    name_hy: '',
    name_en: '',
    slug: '',
    brand_id: '',
    series_id: '',
    category_id: '',
    price_amd: 0,
    currency: 'AMD',
    unit: 'шт',
    short_description_ru: '',
    description_ru: '',
    seo_title_ru: '',
    seo_description_ru: '',
    is_active: true,
    is_featured: false,
    features: [{ ...emptyFeature, sort_order: 1 }],
    stock: [],
    documents: [],
    images: [],
    cooling_power_kw: '',
    heating_power_kw: '',
    recommended_area_m2: '',
    equipment_type: '',
    suitable_for_cooling: false,
    suitable_for_heating: false,
    is_calculator_accessory: false,
    accessory_group: '',
    accessory_default_enabled: true,
    warm_floor_product_type: '',
    warm_floor_linear_power_wm: '',
    warm_floor_cable_length_m: '',
    warm_floor_mat_area_m2: '',
    warm_floor_voltage_v: 230,
    warm_floor_room_types: '',
    warm_floor_floor_coverings: '',
    warm_floor_substrate_types: '',
    warm_floor_wet_zone_allowed: '',
  });
  const [productId, setProductId] = useState<string | undefined>(id);

  useEffect(() => {
    api<any[]>('/admin/categories').then(setCategories);
    api<any[]>('/admin/brands').then(setBrands);
    api<any[]>('/admin/series').then(setSeries);
    api<any[]>('/warehouses').then((rows) => {
      setWarehouses(rows);
      setForm((prev: any) => ({
        ...prev,
        stock: prev.stock?.length ? prev.stock : rows.map((warehouse: any) => ({ warehouse_id: warehouse.id, warehouse_name: warehouse.name, quantity: 0, reserved_quantity: 0, available_quantity: 0 })),
      }));
    });
  }, []);

  const hydrateProduct = (product: any) => {
    setForm({
      ...product,
      currency: product.currency || 'AMD',
      unit: product.unit || 'шт',
      seo_title_ru: product.seo_title_ru || '',
      seo_description_ru: product.seo_description_ru || '',
      is_featured: Boolean(product.is_featured),
      features: product.features?.length ? product.features : [{ ...emptyFeature, sort_order: 1 }],
      stock: product.stock || [],
      documents: product.documents || [],
      images: product.images || [],
      cooling_power_kw: product.cooling_power_kw ?? '',
      heating_power_kw: product.heating_power_kw ?? '',
      recommended_area_m2: product.recommended_area_m2 ?? '',
      equipment_type: product.equipment_type || '',
      suitable_for_cooling: Boolean(product.suitable_for_cooling),
      suitable_for_heating: Boolean(product.suitable_for_heating),
      is_calculator_accessory: Boolean(product.is_calculator_accessory),
      accessory_group: product.accessory_group || '',
      accessory_default_enabled: product.accessory_default_enabled !== 0,
      warm_floor_product_type: product.warm_floor_product_type || '',
      warm_floor_linear_power_wm: product.warm_floor_linear_power_wm ?? '',
      warm_floor_cable_length_m: product.warm_floor_cable_length_m ?? '',
      warm_floor_mat_area_m2: product.warm_floor_mat_area_m2 ?? '',
      warm_floor_voltage_v: product.warm_floor_voltage_v ?? 230,
      warm_floor_room_types: product.warm_floor_room_types || '',
      warm_floor_floor_coverings: product.warm_floor_floor_coverings || '',
      warm_floor_substrate_types: product.warm_floor_substrate_types || '',
      warm_floor_wet_zone_allowed: product.warm_floor_wet_zone_allowed === null || product.warm_floor_wet_zone_allowed === undefined ? '' : Boolean(product.warm_floor_wet_zone_allowed),
    });
  };

  useEffect(() => {
    if (id) api(`/admin/products/${id}` as any).then((res: any) => hydrateProduct(res));
  }, [id]);

  const filteredSeries = useMemo(() => series.filter((item) => !form.brand_id || Number(item.brand_id) === Number(form.brand_id)), [series, form.brand_id]);
  const stockRows = form.stock?.length ? form.stock : warehouses.map((warehouse: any) => ({ warehouse_id: warehouse.id, warehouse_name: warehouse.name, quantity: 0, reserved_quantity: 0, available_quantity: 0 }));

  const save = async () => {
    const method = productId ? 'PUT' : 'POST';
    const path = productId ? `/admin/products/${productId}` : '/admin/products';
    const res: any = await api(path, { method, headers, body: JSON.stringify(form) });
    const nextId = String(res.id || productId);
    setProductId(nextId);
    if (!id) navigate(`/admin/products/${nextId}/edit`);
  };

  const refreshProduct = async () => {
    if (!productId) return;
    const refreshed: any = await api(`/admin/products/${productId}` as any);
    hydrateProduct(refreshed);
  };

  const upload = async (kind: 'images' | 'documents', files: FileList | null) => {
    if (!files || !productId) return;
    const fd = new FormData();
    [...files].forEach((file) => fd.append('files', file));
    const res = await fetch(`${API}/admin/products/${productId}/${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (!res.ok) alert('Upload error');
    else await refreshProduct();
  };

  const saveDocument = async (doc: any) => {
    await api(`/admin/products/${productId}/documents/${doc.id}`, { method: 'PUT', headers, body: JSON.stringify(doc) });
    await refreshProduct();
  };

  const removeDocument = async (docId: number) => {
    await api(`/admin/products/${productId}/documents/${docId}`, { method: 'DELETE', headers });
    setForm((prev: any) => ({ ...prev, documents: (prev.documents || []).filter((doc: any) => doc.id !== docId) }));
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{id ? 'Редактирование товара' : 'Новый товар'}</h1>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input className="field" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input className="field" placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <input className="field" placeholder="Цена AMD" type="number" value={form.price_amd} onChange={(e) => setForm({ ...form, price_amd: Number(e.target.value) })} />
          <input className="field" placeholder="Валюта" value={form.currency || 'AMD'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          <input className="field xl:col-span-2" placeholder="Название RU" value={form.name_ru} onChange={(e) => setForm({ ...form, name_ru: e.target.value })} />
          <input className="field" placeholder="Название HY" value={form.name_hy || ''} onChange={(e) => setForm({ ...form, name_hy: e.target.value })} />
          <input className="field" placeholder="Название EN" value={form.name_en || ''} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          <select className="field" value={form.brand_id || ''} onChange={(e) => setForm({ ...form, brand_id: Number(e.target.value), series_id: '' })}><option value="">Бренд</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select>
          <select className="field" value={form.category_id || ''} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}><option value="">Категория</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name_ru}</option>)}</select>
          <select className="field" value={form.series_id || ''} onChange={(e) => setForm({ ...form, series_id: Number(e.target.value) })}><option value="">Серия</option>{filteredSeries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <input className="field" placeholder="Единица измерения" value={form.unit || 'шт'} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <label className="panel flex items-center justify-between px-4 py-3"><span>Активный товар</span><input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /></label>
          <label className="panel flex items-center justify-between px-4 py-3"><span>Featured</span><input type="checkbox" checked={Boolean(form.is_featured)} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} /></label>
          <input className="field md:col-span-2 xl:col-span-4" placeholder="Краткое описание" value={form.short_description_ru || ''} onChange={(e) => setForm({ ...form, short_description_ru: e.target.value })} />
          <textarea className="field md:col-span-2 xl:col-span-4 min-h-32" placeholder="Полное описание" value={form.description_ru || ''} onChange={(e) => setForm({ ...form, description_ru: e.target.value })} />
          <input className="field md:col-span-2" placeholder="SEO title" value={form.seo_title_ru || ''} onChange={(e) => setForm({ ...form, seo_title_ru: e.target.value })} />
          <input className="field md:col-span-2" placeholder="SEO description" value={form.seo_description_ru || ''} onChange={(e) => setForm({ ...form, seo_description_ru: e.target.value })} />
        </div>

        <div className="panel p-4">
          <h2 className="text-xl font-semibold">Калькуляторы и тёплый пол</h2>
          <p className="mt-1 text-sm text-muted">Эти поля управляют подбором в публичных инструментах. Точные остатки клиенту не показываются.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input className="field" type="number" step="0.1" placeholder="Мощность охлаждения, кВт" value={form.cooling_power_kw ?? ''} onChange={(e) => setForm({ ...form, cooling_power_kw: e.target.value })} />
            <input className="field" type="number" step="0.1" placeholder="Мощность отопления, кВт" value={form.heating_power_kw ?? ''} onChange={(e) => setForm({ ...form, heating_power_kw: e.target.value })} />
            <input className="field" type="number" step="1" placeholder="Рекомендуемая площадь, м²" value={form.recommended_area_m2 ?? ''} onChange={(e) => setForm({ ...form, recommended_area_m2: e.target.value })} />
            <input className="field" placeholder="Тип оборудования / группа аксессуаров" value={form.equipment_type || ''} onChange={(e) => setForm({ ...form, equipment_type: e.target.value })} />
            <label className="panel flex items-center justify-between px-4 py-3"><span>Подходит для охлаждения</span><input type="checkbox" checked={Boolean(form.suitable_for_cooling)} onChange={(e) => setForm({ ...form, suitable_for_cooling: e.target.checked })} /></label>
            <label className="panel flex items-center justify-between px-4 py-3"><span>Подходит для отопления</span><input type="checkbox" checked={Boolean(form.suitable_for_heating)} onChange={(e) => setForm({ ...form, suitable_for_heating: e.target.checked })} /></label>
            <label className="panel flex items-center justify-between px-4 py-3"><span>Аксессуар</span><input type="checkbox" checked={Boolean(form.is_calculator_accessory)} onChange={(e) => setForm({ ...form, is_calculator_accessory: e.target.checked })} /></label>
            <label className="panel flex items-center justify-between px-4 py-3"><span>Показывать аксессуар по умолчанию</span><input type="checkbox" checked={form.accessory_default_enabled !== false} onChange={(e) => setForm({ ...form, accessory_default_enabled: e.target.checked })} /></label>
            <input className="field md:col-span-2 xl:col-span-4" placeholder="Связь аксессуара с типом оборудования: cooling, heating, floor_heating..." value={form.accessory_group || ''} onChange={(e) => setForm({ ...form, accessory_group: e.target.value })} />

            <select className="field" value={form.warm_floor_product_type || ''} onChange={(e) => setForm({ ...form, warm_floor_product_type: e.target.value })}>
              <option value="">Тёплый пол: не связано</option>
              <option value="heating_cable">Нагревательный кабель</option>
              <option value="heating_mat">Нагревательный мат</option>
              <option value="mounting_tape">Монтажная лента</option>
              <option value="thermostat">Терморегулятор</option>
              <option value="floor_sensor">Датчик пола</option>
              <option value="corrugated_tube">Гофра</option>
              <option value="protection">Защита</option>
              <option value="accessory">Аксессуар</option>
            </select>
            <input className="field" type="number" step="0.1" placeholder="Линейная мощность, Вт/м" value={form.warm_floor_linear_power_wm ?? ''} onChange={(e) => setForm({ ...form, warm_floor_linear_power_wm: e.target.value })} />
            <input className="field" type="number" step="0.1" placeholder="Длина кабеля, м" value={form.warm_floor_cable_length_m ?? ''} onChange={(e) => setForm({ ...form, warm_floor_cable_length_m: e.target.value })} />
            <input className="field" type="number" step="0.1" placeholder="Площадь мата, м²" value={form.warm_floor_mat_area_m2 ?? ''} onChange={(e) => setForm({ ...form, warm_floor_mat_area_m2: e.target.value })} />
            <input className="field" type="number" step="1" placeholder="Напряжение, В" value={form.warm_floor_voltage_v ?? ''} onChange={(e) => setForm({ ...form, warm_floor_voltage_v: e.target.value })} />
            <select className="field" value={String(form.warm_floor_wet_zone_allowed)} onChange={(e) => setForm({ ...form, warm_floor_wet_zone_allowed: e.target.value === '' ? '' : e.target.value === 'true' })}>
              <option value="">Влажная зона: авто</option>
              <option value="true">Разрешено</option>
              <option value="false">Запрещено</option>
            </select>
            <input className="field md:col-span-2" placeholder="Помещения JSON/CSV: bathroom,kitchen" value={form.warm_floor_room_types || ''} onChange={(e) => setForm({ ...form, warm_floor_room_types: e.target.value })} />
            <input className="field md:col-span-2" placeholder="Покрытия JSON/CSV: tile,porcelain" value={form.warm_floor_floor_coverings || ''} onChange={(e) => setForm({ ...form, warm_floor_floor_coverings: e.target.value })} />
            <input className="field md:col-span-2 xl:col-span-4" placeholder="Основания JSON/CSV: concrete_screed,tile_adhesive" value={form.warm_floor_substrate_types || ''} onChange={(e) => setForm({ ...form, warm_floor_substrate_types: e.target.value })} />
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Характеристики</h2>
            <button className="btn-secondary" onClick={() => setForm({ ...form, features: [...(form.features || []), { ...emptyFeature, sort_order: (form.features || []).length + 1 }] })}>Добавить характеристику</button>
          </div>
          <div className="space-y-3">
            {(form.features || []).map((feature: any, index: number) => (
              <div key={index} className="grid gap-3 lg:grid-cols-[1.4fr_1fr_0.8fr_120px_120px]">
                <input className="field" placeholder="Параметр" value={feature.feature_name || ''} onChange={(e) => setForm({ ...form, features: form.features.map((item: any, i: number) => i === index ? { ...item, feature_name: e.target.value } : item) })} />
                <input className="field" placeholder="Значение" value={feature.feature_value || ''} onChange={(e) => setForm({ ...form, features: form.features.map((item: any, i: number) => i === index ? { ...item, feature_value: e.target.value } : item) })} />
                <input className="field" placeholder="Ед." value={feature.feature_unit || ''} onChange={(e) => setForm({ ...form, features: form.features.map((item: any, i: number) => i === index ? { ...item, feature_unit: e.target.value } : item) })} />
                <input className="field" type="number" placeholder="sort" value={feature.sort_order ?? index + 1} onChange={(e) => setForm({ ...form, features: form.features.map((item: any, i: number) => i === index ? { ...item, sort_order: Number(e.target.value) } : item) })} />
                <button className="btn-secondary" onClick={() => setForm({ ...form, features: form.features.filter((_: any, i: number) => i !== index) })}>Удалить</button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="text-xl font-semibold">Остатки по складам</h2>
          <div className="mt-3 space-y-3">
            {stockRows.map((row: any, index: number) => (
              <div key={row.warehouse_id || index} className="grid gap-3 lg:grid-cols-4">
                <div className="field flex items-center">{row.warehouse_name || warehouses.find((warehouse: any) => warehouse.id === row.warehouse_id)?.name || 'Склад'}</div>
                <input className="field" type="number" placeholder="quantity" value={row.quantity ?? 0} onChange={(e) => setForm({ ...form, stock: stockRows.map((item: any, i: number) => i === index ? { ...item, quantity: Number(e.target.value), available_quantity: Number(e.target.value) - Number(item.reserved_quantity || 0) } : item) })} />
                <input className="field" type="number" placeholder="reserved_quantity" value={row.reserved_quantity ?? 0} onChange={(e) => setForm({ ...form, stock: stockRows.map((item: any, i: number) => i === index ? { ...item, reserved_quantity: Number(e.target.value), available_quantity: Number(item.quantity || 0) - Number(e.target.value) } : item) })} />
                <input className="field" type="number" placeholder="available_quantity" value={row.available_quantity ?? 0} onChange={(e) => setForm({ ...form, stock: stockRows.map((item: any, i: number) => i === index ? { ...item, available_quantity: Number(e.target.value) } : item) })} />
              </div>
            ))}
          </div>
        </div>

        {productId ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FileUploader label="Загрузить фото товара" accept=".jpg,.jpeg,.png,.webp" multiple onChange={(files) => upload('images', files)} />
            <FileUploader label="Загрузить документы (до 25 MB)" accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.zip,.jpg,.jpeg,.png,.webp" multiple onChange={(files) => upload('documents', files)} />
          </div>
        ) : null}

        {productId ? (
          <div className="panel p-4">
            <h2 className="text-xl font-semibold">Документация товара</h2>
            <div className="mt-2 text-sm text-slate-400">Тип, язык, версия, публичность и порядок можно править после upload.</div>
            <div className="mt-4 space-y-4">
              {(form.documents || []).length ? form.documents.map((doc: any, index: number) => (
                <div key={doc.id} className="rounded-2xl border border-line bg-card p-4">
                  <div className="grid gap-3 lg:grid-cols-7">
                    <input className="field lg:col-span-2" placeholder="Название документа" value={doc.document_name || ''} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, document_name: e.target.value } : item) })} />
                    <select className="field" value={doc.document_type || 'other'} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, document_type: e.target.value } : item) })}>{documentTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <select className="field" value={doc.language || 'ru'} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, language: e.target.value } : item) })}><option value="ru">RU</option><option value="hy">HY</option><option value="en">EN</option></select>
                    <input className="field" value={doc.version || '1.0'} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, version: e.target.value } : item) })} placeholder="Версия" />
                    <input className="field" type="number" value={doc.sort_order ?? 0} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, sort_order: Number(e.target.value) } : item) })} placeholder="Порядок" />
                    <label className="panel flex items-center justify-between px-3 py-2"><span className="text-sm">Публичный</span><input type="checkbox" checked={Boolean(doc.is_public)} onChange={(e) => setForm({ ...form, documents: form.documents.map((item: any, i: number) => i === index ? { ...item, is_public: e.target.checked } : item) })} /></label>
                  </div>
                  <div className="mt-3 text-xs text-slate-400">Файл: {doc.file_url} {doc.file_extension ? `· ${doc.file_extension.toUpperCase()}` : ''} {doc.file_size ? `· ${Math.round(doc.file_size / 1024)} KB` : ''}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a className="btn-secondary" href={doc.file_url} target="_blank" rel="noreferrer">Открыть</a>
                    <button className="btn-primary" onClick={() => saveDocument(doc)}>Сохранить документ</button>
                    <button className="btn-secondary" onClick={() => removeDocument(doc.id)}>Удалить</button>
                  </div>
                </div>
              )) : <div className="text-sm text-muted">Пока нет загруженных документов.</div>}
            </div>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
