import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Category } from '../types/Category';

type BlockedCategory = {
  id: number;
  name_ru?: string;
  slug?: string;
  children_count?: number;
  product_count?: number;
  reasons?: string[];
};

type DeletePreviewResponse = {
  deletable: Category[];
  blocked: BlockedCategory[];
  summary: {
    requested: number;
    deletable: number;
    blocked: number;
  };
};

type Props = {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onDeleted: () => void;
};

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
}

export default function AdminCategoriesDeleteModal({ open, categories, onClose, onDeleted }: Props) {
  const [preview, setPreview] = useState<DeletePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const ids = useMemo(() => categories.map((category) => Number(category.id)).filter(Number.isFinite), [categories]);
  const hasBlocked = Boolean(preview?.blocked?.length);
  const canDelete = Boolean(preview?.deletable?.length) && !hasBlocked;

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError('');
      setLoading(false);
      setSubmitting(false);
      return;
    }

    if (!ids.length) {
      setPreview(null);
      setError('Нет выбранных категорий.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    api<DeletePreviewResponse>('/admin/categories/bulk-delete-preview', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) setError(normalizeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, ids.join(',')]);

  if (!open) return null;

  const confirmDelete = async () => {
    if (!canDelete) return;
    setSubmitting(true);
    setError('');
    try {
      await api('/admin/categories/bulk', {
        method: 'POST',
        body: JSON.stringify({ action: 'soft_delete', ids: preview?.deletable.map((category) => category.id) || [] }),
      });
      onDeleted();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Удаление выбранных категорий</h2>
            <p className="mt-1 text-sm text-slate-400">
              Перед удалением backend проверяет дочерние категории и товары. Заблокированные категории не удаляются молча.
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Закрыть</button>
        </div>

        {loading ? <div className="mt-4 text-sm text-slate-300">Проверяю выбранные категории...</div> : null}
        {error ? <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

        {preview ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-lg bg-slate-900/60 p-3">Выбрано: <b>{preview.summary.requested}</b></div>
              <div className="rounded-lg bg-emerald-900/30 p-3 text-emerald-200">Можно удалить: <b>{preview.summary.deletable}</b></div>
              <div className="rounded-lg bg-amber-900/30 p-3 text-amber-200">Заблокировано: <b>{preview.summary.blocked}</b></div>
            </div>

            {preview.blocked.length ? (
              <div className="rounded-lg border border-amber-500/40 p-3">
                <div className="font-semibold text-amber-200">Нельзя удалить без предварительной обработки</div>
                <div className="mt-2 space-y-2">
                  {preview.blocked.map((category) => (
                    <div key={category.id} className="text-sm text-slate-300">
                      <div className="font-medium text-white">#{category.id} {category.name_ru || category.slug || 'Без названия'}</div>
                      <div className="text-slate-400">{(category.reasons || []).join('; ') || 'Есть дочерние категории или товары.'}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-sm text-slate-400">
                  Безопасная альтернатива: скрыть или деактивировать эти категории через массовые действия, затем вручную проверить товары/дочерние ветки.
                </div>
              </div>
            ) : null}

            {preview.deletable.length ? (
              <div className="rounded-lg border border-emerald-500/30 p-3">
                <div className="font-semibold text-emerald-200">Будут soft-deleted</div>
                <div className="mt-2 max-h-48 overflow-y-auto text-sm text-slate-300">
                  {preview.deletable.map((category) => (
                    <div key={category.id}>#{category.id} {category.name_ru} <span className="text-slate-500">/{category.slug}</span></div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Отмена</button>
          <button className="btn-primary" onClick={confirmDelete} disabled={!canDelete || submitting || loading}>
            {submitting ? 'Удаление...' : hasBlocked ? 'Удаление заблокировано' : 'Подтвердить soft delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
