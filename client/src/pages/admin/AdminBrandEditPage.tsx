import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, API } from '../../api/client';
import { AdminLayout } from '../../components/AdminLayout';
import { FileUploader } from '../../components/FileUploader';
import { useStore } from '../../store/useStore';

const emptyForm = {
  name: '',
  slug: '',
  country: '',
  logo_url: '',
  description_ru: '',
  website_url: '',
  is_active: true,
  sort_order: 0,
  is_popular: false,
};

export function AdminBrandEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useStore((s) => s.adminToken);
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState<any>(emptyForm);

  useEffect(() => {
    if (id) api(`/admin/brands/${id}`).then(setForm);
  }, [id]);

  const save = async () => {
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/admin/brands/${id}` : '/admin/brands';
    const res: any = await api(path, { method, headers, body: JSON.stringify(form) });
    navigate(`/admin/brands/${res.id || id}/edit`);
  };

  const uploadLogo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !id) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API}/admin/brands/${id}/logo`, { method: 'POST', headers, body: fd });
    const data = await res.json();
    setForm((prev: any) => ({ ...prev, logo_url: data.logo_url }));
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{id ? 'Редактирование бренда' : 'Новый бренд'}</h1>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <input className="field" placeholder="name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field" placeholder="slug" value={form.slug || ''} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <input className="field" placeholder="country" value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input className="field" type="number" placeholder="sort_order" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          <input className="field md:col-span-2" placeholder="website_url" value={form.website_url || ''} onChange={(e) => setForm({ ...form, website_url: e.target.value })} />
          <input className="field md:col-span-2" placeholder="logo_url" value={form.logo_url || ''} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
          <textarea className="field md:col-span-2 min-h-40" placeholder="description_ru" value={form.description_ru || ''} onChange={(e) => setForm({ ...form, description_ru: e.target.value })} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="panel flex items-center justify-between px-4 py-3"><span>Активен</span><input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /></label>
          <label className="panel flex items-center justify-between px-4 py-3"><span>Popular</span><input type="checkbox" checked={Boolean(form.is_popular)} onChange={(e) => setForm({ ...form, is_popular: e.target.checked })} /></label>
          <div className="panel px-4 py-3 text-sm text-slate-300">Upload logo доступен после первого сохранения</div>
        </div>

        {id ? <FileUploader label="Загрузить logo" accept=".jpg,.jpeg,.png,.webp,.svg" onChange={uploadLogo} /> : null}
      </div>
    </AdminLayout>
  );
}
