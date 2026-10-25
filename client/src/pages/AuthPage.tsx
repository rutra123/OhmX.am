import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useStore, type UserBudgetLevel, type UserPreferences, type UserRole } from '../store/useStore';

const specializationOptions = [
  { value: 'Электрика и щитовое оборудование', key: 'electrical' },
  { value: 'Розетки, выключатели и электроустановочные изделия', key: 'switches' },
  { value: 'Кабель, кабель-каналы и монтаж', key: 'cable' },
  { value: 'Освещение', key: 'lighting' },
  { value: 'Электрическое отопление / теплые полы', key: 'electricHeating' },
  { value: 'Водяное отопление и котельная', key: 'waterHeating' },
  { value: 'Насосы, водоснабжение и гидравлика', key: 'pumps' },
  { value: 'HVAC / кондиционирование / вентиляция', key: 'hvac' },
  { value: 'Автоматика и управление', key: 'automation' },
  { value: 'UPS / стабилизаторы / резервное питание', key: 'ups' },
  { value: 'Сервис и запасные части', key: 'service' },
  { value: 'Другое', key: 'other' },
] as const;

const projectTypeOptions = [
  { value: 'Квартира', key: 'apartment' },
  { value: 'Частный дом', key: 'house' },
  { value: 'Офис / коммерция', key: 'office' },
  { value: 'Сервис и ремонт', key: 'service' },
  { value: 'Монтажный объект', key: 'installation' },
] as const;

const budgetOptionValues: UserBudgetLevel[] = ['economy', 'optimal', 'premium'];

const splitList = (value: string) => value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);

export function AuthPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const location = useLocation();
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const quickRegister = useStore((s) => s.quickRegister);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    role: '' as '' | UserRole,
    specializations: [] as string[],
    preferredCategories: [] as string[],
    projectTypes: [] as string[],
    preferredBrands: '',
    budgetLevel: 'optimal' as UserBudgetLevel,
    aiNotes: '',
    communicationChannel: 'any' as UserPreferences['communicationChannel'],
    rememberAiHistory: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const title = useMemo(() => isAuthenticated ? t('auth.already.title') : t('auth.title'), [isAuthenticated, t]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = t('auth.validation.name');
    if (!form.phone.trim()) next.phone = t('auth.validation.phone');
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = t('auth.validation.email');
    if (!form.role) next.role = t('auth.validation.role');
    if (form.role === 'installer' && !form.specializations.length) next.specializations = t('auth.validation.specializations');
    setErrors(next);
    return !Object.keys(next).length;
  };

  const submit = () => {
    if (!validate()) return;
    const preferences: UserPreferences = {
      preferredBrands: splitList(form.preferredBrands),
      preferredCategories: form.role === 'installer' ? form.specializations : form.preferredCategories,
      projectTypes: form.projectTypes,
      budgetLevel: form.budgetLevel,
      aiNotes: form.aiNotes.trim(),
      rememberAiHistory: form.rememberAiHistory,
      communicationChannel: form.communicationChannel,
    };
    quickRegister({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      role: form.role as UserRole,
      specializations: form.role === 'installer' ? form.specializations : [],
      preferences,
    });
    navigate('/profile', { replace: true, state: { from: location.pathname } });
  };

  const toggleArrayValue = (field: 'specializations' | 'preferredCategories' | 'projectTypes', item: string) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(item)
        ? current[field].filter((value) => value !== item)
        : [...current[field], item],
    }));
  };

  if (isAuthenticated) {
    return (
      <div className="page space-y-4">
        <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('profile.breadcrumb') }]} />
        <div className="panel p-6">
          <div className="section-caption">{t('auth.already.caption')}</div>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">{title}</h1>
          <p className="mt-3 max-w-2xl text-slate-600">{t('auth.already.description')}</p>
          <button className="btn-primary mt-5" onClick={() => navigate('/profile')}>{t('auth.already.openProfile')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page space-y-4">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('auth.breadcrumb') }]} />

      <div className="panel overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="p-6 md:p-8">
            <div className="section-caption">OhmX ID</div>
            <h1 className="mt-2 text-3xl font-bold text-fg-strong">{t('auth.title')}</h1>
            <p className="mt-3 max-w-2xl text-fg-soft">
              {t('auth.description')}
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.name')} *</label>
                <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('auth.placeholders.name')} autoComplete="name" />
                {errors.name ? <div className="form-error">{errors.name}</div> : null}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.phone')} *</label>
                <input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+374 ..." autoComplete="tel" />
                {errors.phone ? <div className="form-error">{errors.phone}</div> : null}
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.email')} *</label>
                <input className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" autoComplete="email" />
                {errors.email ? <div className="form-error">{errors.email}</div> : null}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.role')} *</div>
              <div className="auth-role-grid">
                <button type="button" className={`auth-role-card ${form.role === 'installer' ? 'active' : ''}`} onClick={() => setForm({ ...form, role: 'installer', preferredCategories: [] })}>
                  <div className="auth-role-card__title">{t('auth.roles.installer.title')}</div>
                  <div className="auth-role-card__text">{t('auth.roles.installer.text')}</div>
                </button>
                <button type="button" className={`auth-role-card ${form.role === 'consumer' ? 'active' : ''}`} onClick={() => setForm({ ...form, role: 'consumer', specializations: [] })}>
                  <div className="auth-role-card__title">{t('auth.roles.consumer.title')}</div>
                  <div className="auth-role-card__text">{t('auth.roles.consumer.text')}</div>
                </button>
              </div>
              {errors.role ? <div className="form-error">{errors.role}</div> : null}
            </div>

            <button className="btn-primary mt-8 w-full md:w-auto" onClick={submit}>{t('auth.actions.create')}</button>
          </div>

          <aside className="border-t border-line bg-card/70 p-6 md:p-8 lg:border-l lg:border-t-0">
            <div className="section-caption">{t('auth.preferences.caption')}</div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('auth.preferences.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t('auth.preferences.description')}</p>

            <div className="mt-5 space-y-5">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-500">{t('profile.preferences.budget')}</div>
                <div className="grid gap-2">
                  {budgetOptionValues.map((level) => (
                    <button key={level} type="button" className={`auth-role-card ${form.budgetLevel === level ? 'active' : ''}`} onClick={() => setForm({ ...form, budgetLevel: level })}>
                      <div className="auth-role-card__title">{t(`profile.budget.${level}`)}</div>
                      <div className="auth-role-card__text">{t(`auth.budgetHints.${level}`)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-500">{form.role === 'installer' ? `${t('auth.fields.specializations')} *` : t('auth.fields.interestedDirections')}</div>
                <div className="auth-specialization-grid">
                  {specializationOptions.map((item) => {
                    const field = form.role === 'installer' ? 'specializations' : 'preferredCategories';
                    const active = form[field].includes(item.value);
                    return (
                      <button key={item.value} type="button" className={`auth-specialization-chip ${active ? 'active' : ''}`} onClick={() => toggleArrayValue(field, item.value)}>
                        {t(`profile.specializations.${item.key}`)}
                      </button>
                    );
                  })}
                </div>
                {errors.specializations ? <div className="form-error">{errors.specializations}</div> : null}
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-500">{t('auth.fields.projectTypes')}</div>
                <div className="auth-specialization-grid">
                  {projectTypeOptions.map((item) => (
                    <button key={item.value} type="button" className={`auth-specialization-chip ${form.projectTypes.includes(item.value) ? 'active' : ''}`} onClick={() => toggleArrayValue('projectTypes', item.value)}>
                      {t(`profile.projectTypes.${item.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.preferredBrands')}</label>
                <input className="field" value={form.preferredBrands} onChange={(e) => setForm({ ...form, preferredBrands: e.target.value })} placeholder="Например: Legrand, Danfoss, DEVI" />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.aiNotes')}</label>
                <textarea className="field min-h-[96px] resize-y" value={form.aiNotes} onChange={(e) => setForm({ ...form, aiNotes: e.target.value })} placeholder={t('auth.placeholders.aiNotes')} />
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-slate-600">
                <input type="checkbox" className="mt-1" checked={form.rememberAiHistory} onChange={(e) => setForm({ ...form, rememberAiHistory: e.target.checked })} />
                <span><strong className="text-slate-950">{t('auth.fields.rememberHistoryTitle')}</strong><br />{t('auth.fields.rememberHistoryText')}</span>
              </label>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
