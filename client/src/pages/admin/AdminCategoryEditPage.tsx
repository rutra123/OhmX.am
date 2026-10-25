import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, API } from '../../api/client';
import { AdminLayout } from '../../components/AdminLayout';
import { FileUploader } from '../../components/FileUploader';
import { useStore } from '../../store/useStore';

const emptyForm = {
  name_ru: '',
  name_hy: '',
  name_en: '',
  slug: '',
  parent_id: '',
  description_ru: '',
  short_description_ru: '',
  image_url: '',
  icon: '',
  sort_order: 0,
  is_active: true,
  is_public_card: false,
};

export function AdminCategoryEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useStore((s) => s.adminToken);
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState<any>(emptyForm);
  const [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    api<any[]>('/admin/categories').then(setCategories);
    if (id) api(`/admin/categories/${id}`).then(setForm);
  }, [id]);

  const save = async () => {
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/admin/categories/${id}` : '/admin/categories';
    const res: any = await api(path, { method, headers, body: JSON.stringify({ ...form, parent_id: form.parent_id || null }) });
    navigate(`/admin/categories/${res.id || id}/edit`);
  };

  const uploadImage = async (files: FileList | null) => {
    const file = files?.[0];
    const categoryId = id;
    if (!file || !categoryId) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API}/admin/categories/${categoryId}/image`, { method: 'POST', headers, body: fd });
    const data = await res.json();
    setForm((prev: any) => ({ ...prev, image_url: data.image_url }));
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{id ? 'Редактирование категории' : 'Новая категория'}</h1>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input className="field" placeholder="name_ru" value={form.name_ru || ''} onChange={(e) => setForm({ ...form, name_ru: e.target.value })} />
          <input className="field" placeholder="name_hy" value={form.name_hy || ''} onChange={(e) => setForm({ ...form, name_hy: e.target.value })} />
          <input className="field" placeholder="name_en" value={form.name_en || ''} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          <input className="field" placeholder="slug" value={form.slug || ''} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <select className="field" value={form.parent_id || ''} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">Без parent</option>
            {categories.filter((item) => String(item.id) !== String(id)).map((item) => <option key={item.id} value={item.id}>{item.name_ru}</option>)}
          </select>
          <input className="field" type="number" placeholder="sort_order" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          <input className="field md:col-span-2" placeholder="icon" value={form.icon || ''} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
          <input className="field md:col-span-2" placeholder="image_url" value={form.image_url || ''} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
          <textarea className="field md:col-span-2 min-h-24" placeholder="short_description_ru" value={form.short_description_ru || ''} onChange={(e) => setForm({ ...form, short_description_ru: e.target.value })} />
          <textarea className="field md:col-span-2 min-h-40" placeholder="description_ru" value={form.description_ru || ''} onChange={(e) => setForm({ ...form, description_ru: e.target.value })} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="panel flex items-center justify-between px-4 py-3"><span>Активна</span><input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /></label>
          <label className="panel flex items-center justify-between px-4 py-3"><span>Public card</span><input type="checkbox" checked={Boolean(form.is_public_card)} onChange={(e) => setForm({ ...form, is_public_card: e.target.checked })} /></label>
          <div className="panel px-4 py-3 text-sm text-slate-300">Upload image доступен после первого сохранения</div>
        </div>

        {id ? <FileUploader label="Загрузить image" accept=".jpg,.jpeg,.png,.webp" onChange={uploadImage} /> : null}
      </div>
    </AdminLayout>
  );
}
