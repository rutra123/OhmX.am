import { useEffect, useState } from 'react';
import { API } from '../../api/client';
import { AdminDebugPanel } from '../../components/AdminDebugPanel';
import { AdminLayout } from '../../components/AdminLayout';
import { useStore } from '../../store/useStore';

export function AdminImportPage() {
  const token = useStore((s) => s.adminToken);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [createMissingBrands, setCreateMissingBrands] = useState(true);
  const [createMissingCategories, setCreateMissingCategories] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const loadLogs = () => apiLogs();

  useEffect(() => {
    void loadLogs();
  }, []);

  const apiLogs = async () => {
    const res = await fetch(`${API}/admin/import/logs`, { headers });
    if (res.ok) setLogs(await res.json());
  };

  const buildFormData = () => {
    const fd = new FormData();
    if (file) fd.append('file', file);
    fd.append('createMissingBrands', String(createMissingBrands));
    fd.append('createMissingCategories', String(createMissingCategories));
    return fd;
  };

  const runPreview = async () => {
    if (!file) return;
    const res = await fetch(`${API}/admin/import/products-csv/preview`, { method: 'POST', headers, body: buildFormData() });
    setPreview(await res.json());
    setResult(null);
  };

  const runApply = async () => {
    if (!file) return;
    const res = await fetch(`${API}/admin/import/products-csv/apply`, { method: 'POST', headers, body: buildFormData() });
    const data = await res.json();
    setResult(data);
    await loadLogs();
  };

  const downloadTemplate = async () => {
    const res = await fetch(`${API}/admin/import/products-csv/template`, { headers });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ohmx-products-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Импорт CSV</h1>
            <div className="text-sm text-muted">Preview / Dry run → validation → apply. Пока не нажата кнопка импорта, база не меняется.</div>
          </div>
          <button className="btn-secondary" onClick={downloadTemplate}>Скачать CSV template</button>
        </div>

        <div className="panel space-y-4 p-4">
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
            Dry run правило: <b>Preview / Dry run</b> не меняет базу, не создаёт товары и не пишет import logs. Изменения начинаются только после кнопки <b>Импортировать</b>.
          </div>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="panel flex items-center justify-between px-4 py-3"><span>Create missing brands</span><input type="checkbox" checked={createMissingBrands} onChange={(e) => setCreateMissingBrands(e.target.checked)} /></label>
            <label className="panel flex items-center justify-between px-4 py-3"><span>Create missing categories</span><input type="checkbox" checked={createMissingCategories} onChange={(e) => setCreateMissingCategories(e.target.checked)} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={runPreview} disabled={!file}>Preview / Dry run</button>
            <button className="btn-secondary" onClick={runApply} disabled={!file}>Импортировать</button>
          </div>
        </div>

        <AdminDebugPanel refreshKey={`${logs.length}-${result ? JSON.stringify(result) : 'idle'}`} />

        {preview ? (
          <div className="panel space-y-4 p-4">
            <h2 className="text-xl font-semibold">Preview / Dry run</h2>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6 text-sm">
              <div className="chip">Rows: {preview.summary?.total || 0}</div>
              <div className="chip">Will create: {preview.summary?.toCreate || 0}</div>
              <div className="chip">Will update: {preview.summary?.toUpdate || 0}</div>
              <div className="chip">Errors: {preview.summary?.errors || 0}</div>
              <div className="chip">Invalid rows: {preview.summary?.invalid || 0}</div>
              <div className="chip">Warnings: {preview.summary?.warnings || 0}</div>
            </div>

            {preview.fileErrors?.length ? <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{preview.fileErrors.join(' · ')}</div> : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="panel p-4">
                <div className="text-sm font-semibold">Бренды, которые будут созданы</div>
                <div className="mt-2 text-sm text-slate-300">{preview.brandsToCreate?.length ? preview.brandsToCreate.join(', ') : 'Нет'}</div>
              </div>
              <div className="panel p-4">
                <div className="text-sm font-semibold">Категории, которые будут созданы</div>
                <div className="mt-2 text-sm text-slate-300">{preview.categoriesToCreate?.length ? preview.categoriesToCreate.join(', ') : 'Нет'}</div>
              </div>
              <div className="panel p-4">
                <div className="text-sm font-semibold">SKU, которые уже существуют</div>
                <div className="mt-2 text-sm text-slate-300">{preview.existingSkus?.length ? preview.existingSkus.join(', ') : 'Нет'}</div>
              </div>
            </div>

            <div className="space-y-2">
              {(preview.rows || []).slice(0, 30).map((row: any) => (
                <div key={row.rowNumber} className="rounded-2xl border border-line bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">#{row.rowNumber} · {row.sku} · {row.name_ru}</div>
                    <span className="chip">{row.action === 'update' ? 'update' : 'create'}</span>
                    {row.brandWillBeCreated ? <span className="chip">new brand</span> : null}
                    {row.categoriesToCreate?.length ? <span className="chip">new category</span> : null}
                  </div>
                  <div className="mt-1 text-slate-300">{row.brand} · {row.categoryPath.join(' / ')}</div>
                  {row.errors?.length ? <div className="mt-2 text-red-300">Ошибки: {row.errors.join(' · ')}</div> : null}
                  {row.warnings?.length ? <div className="mt-2 text-amber-300">Warnings: {row.warnings.join(' · ')}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="panel p-4 text-sm text-slate-200">
            {'error' in result ? `Ошибка: ${result.error}` : `Импорт завершён. Created: ${result.createdCount}, Updated: ${result.updatedCount}, Errors: ${result.errorCount}`}
          </div>
        ) : null}

        <div className="panel p-4 space-y-3">
          <h2 className="text-xl font-semibold">Логи импорта</h2>
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-line bg-card p-3 text-sm">
                <div className="font-medium">{log.file_name || 'products_csv'} · {log.created_at}</div>
                <div className="text-slate-300">Created: {log.created_count} · Updated: {log.updated_count} · Errors: {log.error_count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
