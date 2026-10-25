import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 transition ${isActive ? 'bg-primary text-white' : 'text-slate-300 hover:bg-card hover:text-white'}`;

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-4">
        <div>
          <Link to="/admin" className="text-2xl font-bold">Локальная админка</Link>
          <div className="mt-1 text-sm text-muted">Отдельный admin layout без public bottom nav, floating cart и клиентской mobile-навигации.</div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <NavLink to="/admin" end className={navItemClass}>Dashboard</NavLink>
          <NavLink to="/admin/categories" className={navItemClass}>Категории</NavLink>
          <NavLink to="/admin/brands" className={navItemClass}>Бренды</NavLink>
          <NavLink to="/admin/products" className={navItemClass}>Товары</NavLink>
          <NavLink to="/admin/warm-floor" className={navItemClass}>Тёплый пол</NavLink>
          <NavLink to="/admin/import" className={navItemClass}>Импорт</NavLink>
        </div>
      </div>
      {children}
    </div>
  );
}
