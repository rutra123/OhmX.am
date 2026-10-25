import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { normalizeUserPreferences, useStore, type UserBudgetLevel, type UserPreferences, type UserRole } from '../store/useStore';

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

const splitList = (value: string) => value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
const joinList = (value: unknown) => Array.isArray(value) ? value.map(String).join(', ') : '';

export function ProfilePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const currentUser = useStore((s) => s.currentUser);
  const userAssistantProfile = useStore((s) => s.userAssistantProfile);
  const setUserAssistantProfile = useStore((s) => s.setUserAssistantProfile);
  const updateUserProfile = useStore((s) => s.updateUserProfile);
  const logout = useStore((s) => s.logout);
  const favorites = useStore((s) => s.favorites);
  const recent = useStore((s) => s.recent);
  const pinnedTools = useStore((s) => s.pinnedTools);
  const pinnedItems = useStore((s) => s.pinnedItems);
  const [products, setProducts] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'consumer' as UserRole,
    specializations: [] as string[],
    preferredCategories: [] as string[],
    projectTypes: [] as string[],
    preferredBrands: '',
    budgetLevel: 'optimal' as UserBudgetLevel,
    aiNotes: '',
    rememberAiHistory: true,
    communicationChannel: 'any' as UserPreferences['communicationChannel'],
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth', { replace: true });
      return;
    }
    api<any[]>('/products?limit=100').then(setProducts).catch(() => setProducts([]));
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!currentUser?.id) return;
    api<{ userContextDocument?: typeof userAssistantProfile }>(`/ai-engineering/profile/${currentUser.id}`)
      .then((data) => {
        if (data.userContextDocument) setUserAssistantProfile(data.userContextDocument);
      })
      .catch(() => undefined);
  }, [currentUser?.id, setUserAssistantProfile]);

  useEffect(() => {
    if (!currentUser) return;
    const profilePreferences = normalizeUserPreferences({ ...(userAssistantProfile?.preferences || {}), ...(currentUser.preferences || {}) });
    setProfileForm({
      name: currentUser.name,
      phone: currentUser.phone,
      email: currentUser.email,
      role: currentUser.role,
      specializations: currentUser.specializations || [],
      preferredCategories: profilePreferences.preferredCategories,
      projectTypes: profilePreferences.projectTypes,
      preferredBrands: joinList(profilePreferences.preferredBrands),
      budgetLevel: profilePreferences.budgetLevel,
      aiNotes: profilePreferences.aiNotes,
      rememberAiHistory: profilePreferences.rememberAiHistory,
      communicationChannel: profilePreferences.communicationChannel,
    });
  }, [currentUser, userAssistantProfile?.preferences]);

  const favoriteProducts = useMemo(() => products.filter((product) => favorites.includes(product.id)), [products, favorites]);
  const recentProducts = useMemo(() => recent.map((slug) => products.find((p) => p.slug === slug)).filter(Boolean), [recent, products]);
  const groupedPins = useMemo(() => ({
    brands: pinnedItems.filter((item) => item.type === 'brand'),
    categories: pinnedItems.filter((item) => item.type === 'category'),
    subcategories: pinnedItems.filter((item) => item.type === 'subcategory'),
    series: pinnedItems.filter((item) => item.type === 'series'),
    products: pinnedItems.filter((item) => item.type === 'product'),
  }), [pinnedItems]);

  const assistantMemory = userAssistantProfile?.assistantMemory || {};
  const activity = userAssistantProfile?.activity || {};
  const selections = Array.isArray(userAssistantProfile?.engineeringSelections) ? userAssistantProfile!.engineeringSelections : [];
  const activeDirection = String(assistantMemory.lastDirection || (assistantMemory.activeEngineeringSelection as any)?.direction || 'unknown');
  const clientDoc = userAssistantProfile?.clientRequirementDocument;

  const toggleArrayValue = (field: 'specializations' | 'preferredCategories' | 'projectTypes', item: string) => {
    setProfileForm((current) => ({
      ...current,
      [field]: current[field].includes(item)
        ? current[field].filter((value) => value !== item)
        : [...current[field], item],
    }));
  };

  const saveProfile = () => {
    const preferences: UserPreferences = {
      preferredBrands: splitList(profileForm.preferredBrands),
      preferredCategories: profileForm.role === 'installer' ? profileForm.specializations : profileForm.preferredCategories,
      projectTypes: profileForm.projectTypes,
      budgetLevel: profileForm.budgetLevel,
      aiNotes: profileForm.aiNotes.trim(),
      rememberAiHistory: profileForm.rememberAiHistory,
      communicationChannel: profileForm.communicationChannel,
    };
    updateUserProfile({
      name: profileForm.name.trim(),
      phone: profileForm.phone.trim(),
      email: profileForm.email.trim(),
      role: profileForm.role,
      specializations: profileForm.role === 'installer' ? profileForm.specializations : [],
      preferences,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const getBudgetLabel = (level: UserBudgetLevel) => t(`profile.budget.${level}`);
  const getDirectionLabel = (direction: string) => t(`profile.directions.${direction}`, { defaultValue: direction });

  if (!currentUser) return null;

  return (
    <div className="page space-y-4">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('profile.breadcrumb') }]} />

      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-primary text-xl font-bold text-white">
              {currentUser.name.trim().slice(0, 1).toUpperCase() || 'O'}
            </div>
            <div className="min-w-0">
              <div className="section-caption">OhmX ID</div>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">{t('profile.title')}</h1>
              <p className="mt-2 text-slate-600">{t('profile.description')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/tools/ai-engineering-selector" className="btn-primary">{t('common.actions.openAiSelector')}</Link>
            <button className="btn-secondary" onClick={() => { logout(); navigate('/auth'); }}>{t('common.actions.logout')}</button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="profile-fact-card">
            <div className="profile-fact-card__label">{t('profile.facts.clientType')}</div>
            <div className="profile-fact-card__value">{currentUser.role === 'installer' ? t('auth.roles.installer.title') : t('auth.roles.consumer.title')}</div>
          </div>
          <div className="profile-fact-card">
            <div className="profile-fact-card__label">{t('profile.facts.aiBudget')}</div>
            <div className="profile-fact-card__value">{getBudgetLabel(profileForm.budgetLevel)}</div>
          </div>
          <div className="profile-fact-card">
            <div className="profile-fact-card__label">{t('profile.facts.aiHistory')}</div>
            <div className="profile-fact-card__value">{profileForm.rememberAiHistory ? t('profile.facts.enabled') : t('profile.facts.disabled')}</div>
          </div>
          <div className="profile-fact-card">
            <div className="profile-fact-card__label">{t('profile.facts.lastSelection')}</div>
            <div className="profile-fact-card__value">{getDirectionLabel(activeDirection)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="panel p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="section-caption">{t('profile.sections.profileData.caption')}</div>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('profile.sections.profileData.title')}</h2>
            </div>
            {saved ? <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">{t('common.actions.saved')}</span> : null}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.name')}</label>
              <input className="field" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.phone')}</label>
              <input className="field" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-500">Email</label>
              <input className="field" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.role')}</div>
            <div className="auth-role-grid">
              <button type="button" className={`auth-role-card ${profileForm.role === 'installer' ? 'active' : ''}`} onClick={() => setProfileForm({ ...profileForm, role: 'installer' })}>
                <div className="auth-role-card__title">Инсталлятор / инженер</div>
                <div className="auth-role-card__text">{t('profile.roles.installer.text')}</div>
              </button>
              <button type="button" className={`auth-role-card ${profileForm.role === 'consumer' ? 'active' : ''}`} onClick={() => setProfileForm({ ...profileForm, role: 'consumer', specializations: [] })}>
                <div className="auth-role-card__title">Покупатель</div>
                <div className="auth-role-card__text">{t('profile.roles.consumer.text')}</div>
              </button>
            </div>
          </div>

          <button className="btn-primary mt-6" onClick={saveProfile}>{t('profile.actions.saveProfile')}</button>
        </section>

        <aside className="panel p-5 md:p-6">
          <div className="section-caption">{t('profile.sections.aiMemory.caption')}</div>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('profile.sections.aiMemory.title')}</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="font-semibold text-slate-950">{t('profile.aiMemory.contextDocument')}</div>
              <div className="mt-1">{userAssistantProfile?.documentId || t('profile.aiMemory.willBeCreated')}</div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="font-semibold text-slate-950">{t('profile.aiMemory.selectionsAndCalculations')}</div>
              <div className="mt-1">{t('profile.aiMemory.selectionStats', { selections: selections.length, calculations: clientDoc?.calculations?.length || 0 })}</div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="font-semibold text-slate-950">{t('profile.aiMemory.activity')}</div>
              <div className="mt-1">{t('profile.aiMemory.activityStats', { views: (activity.viewedProducts as unknown[] | undefined)?.length || recent.length, favorites: favorites.length, pins: pinnedItems.length })}</div>
            </div>
          </div>
        </aside>
      </div>

      <section className="panel p-5 md:p-6">
        <div className="section-caption">{t('profile.sections.personalization.caption')}</div>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">{t('profile.sections.personalization.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t('profile.sections.personalization.description')}</p>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-500">{t('profile.preferences.budget')}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['economy', 'optimal', 'premium'] as UserBudgetLevel[]).map((level) => (
                <button key={level} type="button" className={`auth-role-card ${profileForm.budgetLevel === level ? 'active' : ''}`} onClick={() => setProfileForm({ ...profileForm, budgetLevel: level })}>
                  <div className="auth-role-card__title">{getBudgetLabel(level)}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.preferredBrands')}</label>
            <input className="field" value={profileForm.preferredBrands} onChange={(e) => setProfileForm({ ...profileForm, preferredBrands: e.target.value })} placeholder="Legrand, Danfoss, DEVI" />
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-500">{profileForm.role === 'installer' ? t('auth.fields.specializations') : t('auth.fields.interestedDirections')}</div>
            <div className="auth-specialization-grid">
              {specializationOptions.map((item) => {
                const field = profileForm.role === 'installer' ? 'specializations' : 'preferredCategories';
                const active = profileForm[field].includes(item.value);
                return (
                  <button key={item.value} type="button" className={`auth-specialization-chip ${active ? 'active' : ''}`} onClick={() => toggleArrayValue(field, item.value)}>
                    {t(`profile.specializations.${item.key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-500">{t('auth.fields.projectTypes')}</div>
            <div className="auth-specialization-grid">
              {projectTypeOptions.map((item) => (
                <button key={item.value} type="button" className={`auth-specialization-chip ${profileForm.projectTypes.includes(item.value) ? 'active' : ''}`} onClick={() => toggleArrayValue('projectTypes', item.value)}>
                  {t(`profile.projectTypes.${item.key}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-500">{t('auth.fields.aiNotes')}</label>
            <textarea className="field min-h-[110px] resize-y" value={profileForm.aiNotes} onChange={(e) => setProfileForm({ ...profileForm, aiNotes: e.target.value })} placeholder={t('profile.placeholders.aiNotes')} />
          </div>
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-2xl border border-line bg-card p-4 text-sm text-slate-600">
          <input type="checkbox" className="mt-1" checked={profileForm.rememberAiHistory} onChange={(e) => setProfileForm({ ...profileForm, rememberAiHistory: e.target.checked })} />
          <span><strong className="text-slate-950">{t('profile.preferences.rememberHistoryTitle')}</strong><br />{t('profile.preferences.rememberHistoryText')}</span>
        </label>

        <button className="btn-primary mt-5" onClick={saveProfile}>{t('profile.actions.savePreferences')}</button>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-slate-950">{t('profile.lists.favorites')}</h2>
          <div className="mt-3 space-y-2">{favoriteProducts.length ? favoriteProducts.map((item) => <Link key={item.id} to={`/product/${item.slug}`} className="block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.name_ru}</Link>) : <p className="text-sm text-slate-300">{t('common.fallbacks.empty')}</p>}</div>
        </div>
        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-slate-950">{t('profile.lists.pinned')}</h2>
          <div className="mt-3 space-y-3 text-sm">
            {groupedPins.brands.length ? <div><div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{t('common.labels.brands')}</div>{groupedPins.brands.slice(0, 4).map((item) => <Link key={`${item.type}-${item.id}-${item.contextId || 'root'}`} to={item.url} className="mb-2 block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.title}</Link>)}</div> : null}
            {groupedPins.categories.length ? <div><div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{t('common.labels.categories')}</div>{groupedPins.categories.slice(0, 4).map((item) => <Link key={`${item.type}-${item.id}-${item.contextId || 'root'}`} to={item.url} className="mb-2 block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.title}</Link>)}</div> : null}
            {groupedPins.subcategories.length ? <div><div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{t('common.labels.subcategories')}</div>{groupedPins.subcategories.slice(0, 4).map((item) => <Link key={`${item.type}-${item.id}-${item.contextId || 'root'}`} to={item.url} className="mb-2 block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.title}</Link>)}</div> : null}
            {groupedPins.series.length ? <div><div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{t('common.labels.series')}</div>{groupedPins.series.slice(0, 4).map((item) => <Link key={`${item.type}-${item.id}-${item.contextId || 'root'}`} to={item.url} className="mb-2 block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.title}</Link>)}</div> : null}
            {groupedPins.products.length ? <div><div className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-500">{t('common.labels.products')}</div>{groupedPins.products.slice(0, 4).map((item) => <Link key={`${item.type}-${item.id}-${item.contextId || 'root'}`} to={item.url} className="mb-2 block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.title}</Link>)}</div> : null}
            {!groupedPins.brands.length && !groupedPins.categories.length && !groupedPins.subcategories.length && !groupedPins.series.length && !groupedPins.products.length ? <p className="text-sm text-slate-300">{t('common.fallbacks.empty')}</p> : null}
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-slate-950">{t('profile.lists.historyTools')}</h2>
          <div className="mt-3 space-y-2">{recentProducts.slice(0, 4).map((item: any) => <Link key={item.slug} to={`/product/${item.slug}`} className="block rounded-xl border border-line bg-card px-3 py-3 text-sm">{item.name_ru}</Link>)}{pinnedTools.map((slug) => <Link key={slug} to="/tools" className="block rounded-xl border border-line bg-card px-3 py-3 text-sm">{t('profile.lists.toolPrefix')}: {slug}</Link>)}{!recentProducts.length && !pinnedTools.length && <p className="text-sm text-slate-300">{t('common.fallbacks.empty')}</p>}</div>
        </div>
      </div>
    </div>
  );
}
