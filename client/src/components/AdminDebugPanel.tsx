import { useEffect, useState } from 'react';
import { api } from '../api/client';

type DebugStatus = {
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
  nodeEnv: string;
};

function shouldShowDebugPanel() {
  if (typeof window === 'undefined') return false;
  return import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export function AdminDebugPanel({ refreshKey }: { refreshKey?: string | number }) {
  const [status, setStatus] = useState<DebugStatus | null>(null);

  useEffect(() => {
    if (!shouldShowDebugPanel()) return;
    api<DebugStatus>('/admin/debug/status').then(setStatus).catch(() => undefined);
  }, [refreshKey]);

  if (!shouldShowDebugPanel() || !status) return null;

  return (
    <div className="panel p-4 text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold">DB status</div>
        <span className="chip">Categories: {status.counts.categories}</span>
        <span className="chip">Brands: {status.counts.brands}</span>
        <span className="chip">Products: {status.counts.products}</span>
        <span className="chip">Documents: {status.counts.product_documents}</span>
        <span className="chip">Import logs: {status.counts.import_logs}</span>
      </div>
      <div className="mt-2 text-xs text-slate-400">SQLite: {status.activeDatabasePath}</div>
      {status.latestBackup ? <div className="mt-1 text-xs text-slate-400">Last backup: {status.latestBackup.path}</div> : null}
      {status.latestImport ? <div className="mt-1 text-xs text-slate-400">Last import: {status.latestImport.file_name || 'products_csv'} · {status.latestImport.created_at}</div> : null}
    </div>
  );
}
