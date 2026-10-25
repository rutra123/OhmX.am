import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { AdminLayout } from '../../components/AdminLayout';
import { useStore } from '../../store/useStore';

type DashboardStatus = {
  activeDatabasePath: string;
  counts: {
    categories: number;
    brands: number;
    products: number;
    product_documents: number;
    import_logs: number;
  };
  latestImport?: {
    file_name?: string;
    created_count: number;
    updated_count: number;
    error_count: number;
    created_at: string;
  } | null;
  latestBackup?: {
    name: string;
    path: string;
    mtimeMs: number;
  } | null;
  templatePath: string;
  demoCsvPath: string;
};

export function AdminHomePage() {
  const { adminToken, setAdminToken } = useStore();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [dashboard, setDashboard] = useState<DashboardStatus | null>(null);

  const loadDashboard = () => api<DashboardStatus>('/admin/debug/status').then(setDashboard).catch(() => setDashboard(null));

  useEffect(() => {
    if (adminToken) void loadDashboard();
  }, [adminToken]);

  const login = async () => {
    try {
      const res = await api<{ token: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password }) });
      setAdminToken(res.token);
      setStatus('Вход выполнен');
      await loadDashboard();
    } catch {
      setStatus('Неверный пароль');
    }
  };

  if (!adminToken) {
    return <AdminLayout><div className="panel max-w-xl p-4"><h1 className="text-2xl font-bold">OhmX.am Admin</h1><p className="mt-2 text-slate-300">Для локального прототипа используется ADMIN_PASSWORD из .env. Для production замените это на полноценную авторизацию.</p><input className="field mt-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите admin password" autoComplete="current-password" /><div className="mt-4 flex gap-2"><button className="btn-primary" onClick={login}>Войти</button></div><div className="mt-3 text-sm text-muted">{status}</div></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">OhmX.am Dashboard</h1>
            <div className="text-sm text-muted">Состояние локального каталога: база, сущности, импорты и backup в одном месте.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/categories/new" className="btn-primary">Новая категория</Link>
            <Link to="/admin/brands/new" className="btn-secondary">Новый бренд</Link>
            <Link to="/admin/products/new" className="btn-secondary">Новый товар</Link>
            <Link to="/admin/import" className="btn-secondary">Импорт CSV</Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="panel p-4"><div className="text-sm text-muted">Категории</div><div className="mt-2 text-3xl font-bold">{dashboard?.counts.categories ?? '—'}</div></div>
          <div className="panel p-4"><div className="text-sm text-muted">Бренды</div><div className="mt-2 text-3xl font-bold">{dashboard?.counts.brands ?? '—'}</div></div>
          <div className="panel p-4"><div className="text-sm text-muted">Товары</div><div className="mt-2 text-3xl font-bold">{dashboard?.counts.products ?? '—'}</div></div>
          <div className="panel p-4"><div className="text-sm text-muted">Документы</div><div className="mt-2 text-3xl font-bold">{dashboard?.counts.product_documents ?? '—'}</div></div>
          <div className="panel p-4"><div className="text-sm text-muted">Логи импорта</div><div className="mt-2 text-3xl font-bold">{dashboard?.counts.import_logs ?? '—'}</div></div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel p-4 space-y-3">
            <h2 className="text-xl font-semibold">Текущее состояние</h2>
            <div className="text-sm text-slate-300">Активная база: <span className="font-mono text-slate-100">{dashboard?.activeDatabasePath || '—'}</span></div>
            <div className="text-sm text-slate-300">CSV template: <span className="font-mono text-slate-100">{dashboard?.templatePath || '—'}</span></div>
            <div className="text-sm text-slate-300">Demo CSV: <span className="font-mono text-slate-100">{dashboard?.demoCsvPath || '—'}</span></div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link to="/admin/import" className="btn-primary">Открыть импорт</Link>
              <a className="btn-secondary" href="http://localhost:8081/api/admin/import/products-csv/template" target="_blank" rel="noreferrer">Скачать CSV template</a>
            </div>
          </div>

          <div className="space-y-4">
            <div className="panel p-4">
              <h2 className="text-xl font-semibold">Последний импорт</h2>
              {dashboard?.latestImport ? (
                <div className="mt-3 text-sm text-slate-300 space-y-1">
                  <div>Файл: {dashboard.latestImport.file_name || 'products_csv'}</div>
                  <div>Когда: {dashboard.latestImport.created_at}</div>
                  <div>Created: {dashboard.latestImport.created_count} · Updated: {dashboard.latestImport.updated_count} · Errors: {dashboard.latestImport.error_count}</div>
                </div>
              ) : <div className="mt-3 text-sm text-slate-400">Логов импорта пока нет.</div>}
            </div>
            <div className="panel p-4">
              <h2 className="text-xl font-semibold">Последний backup</h2>
              {dashboard?.latestBackup ? (
                <div className="mt-3 text-sm text-slate-300 space-y-1">
                  <div>{dashboard.latestBackup.name}</div>
                  <div className="font-mono text-xs text-slate-400">{dashboard.latestBackup.path}</div>
                </div>
              ) : <div className="mt-3 text-sm text-slate-400">Backup пока не найден.</div>}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
