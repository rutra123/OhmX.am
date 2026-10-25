// client/src/pages/admin/AdminWarmFloorSettingsPage.tsx

import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AdminLayout } from '../../components/AdminLayout';

export function AdminWarmFloorSettingsPage() {
  const [settingsText, setSettingsText] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api<any>('/admin/warm-floor/settings')
      .then((settings) => setSettingsText(JSON.stringify(settings, null, 2)))
      .catch(() => setStatus('Ошибка загрузки настроек'));
  }, []);

  const save = async () => {
    setStatus('');
    try {
      const parsed = JSON.parse(settingsText);
      const saved = await api<any>('/admin/warm-floor/settings', {
        method: 'PUT',
        body: JSON.stringify(parsed),
      });
      setSettingsText(JSON.stringify(saved, null, 2));
      setStatus('Сохранено');
    } catch (err: any) {
      setStatus(err?.message || 'Ошибка JSON');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Настройки тёплого пола</h1>
            <p className="mt-1 text-sm text-muted">Пресеты мощности, совместимость покрытий, шаги укладки, монтажная лента, аксессуары и тексты предупреждений.</p>
          </div>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>
        {status ? <div className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-slate-300">{status}</div> : null}
        <textarea
          className="field min-h-[70vh] font-mono text-xs leading-5"
          value={settingsText}
          onChange={(e) => setSettingsText(e.target.value)}
          spellCheck={false}
        />
      </div>
    </AdminLayout>
  );
}
