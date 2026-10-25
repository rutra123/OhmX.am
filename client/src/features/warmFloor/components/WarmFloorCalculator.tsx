// client/src/features/warmFloor/components/WarmFloorCalculator.tsx

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWarmFloorStore } from '../store/useWarmFloorStore';
import { ManagedImage } from '../../../components/ManagedImage';
import { useStore } from '../../../store/useStore';
import { Check, Info, Flame, Snowflake, ChevronRight, ArrowLeft } from '../../../components/Icons';

const SUBSTRATE_KEYS = ['concrete_screed', 'tile_adhesive', 'old_tile', 'wood', 'insulation_board', 'other'] as const;
const INSULATION_KEYS = ['poor', 'standard', 'good', 'excellent'] as const;
const SYSTEM_KEYS = ['auto', 'mat', 'cable'] as const;

const formatNumber = (value: unknown, digits = 1, locale = 'ru-RU') => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString(locale, { maximumFractionDigits: digits });
};

type MessageValue = string | { code?: string; params?: Record<string, unknown>; text?: string };

const normalizeWarnings = (warnings: unknown, translate: (code: string, params?: Record<string, unknown>) => string): string[] => {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((item: MessageValue) => {
    if (typeof item === 'string') return item;
    if (item?.code) return translate(item.code, item.params);
    return item?.text || '';
  }).filter(Boolean);
};

const availabilityClass = (status?: string) => {
  if (status === 'in_stock') return 'bg-ok/10 border-ok/20 text-ok';
  if (status === 'low_stock') return 'bg-warn/10 border-warn/20 text-warn';
  return 'bg-surface border-line text-fg-muted';
};

export function WarmFloorCalculator() {
  const { t, i18n } = useTranslation();
  const numberLocale = i18n.language.startsWith('hy') ? 'hy-AM' : i18n.language.startsWith('en') ? 'en-US' : 'ru-RU';
  const fmt = (value: unknown, digits = 1): string => formatNumber(value, digits, numberLocale);
  const message = (code?: string, params?: Record<string, unknown>) => code
    ? t(`calculator.warmFloor.engineering.${code}`, { ...(params || {}), defaultValue: code })
    : '';
  const roomLabel = (key: string) => t(`calculator.warmFloor.rooms.${key}.label`, { defaultValue: key });
  const roomHint = (key: string) => t(`calculator.warmFloor.rooms.${key}.hint`, { defaultValue: '' });
  const heatingLabel = (key: string) => t(`calculator.warmFloor.heating.${key}.label`, { defaultValue: key });
  const heatingHint = (key: string) => t(`calculator.warmFloor.heating.${key}.hint`, { defaultValue: '' });
  const coveringLabel = (key: string) => t(`calculator.warmFloor.coverings.${key}.label`, { defaultValue: key });
  const coveringHint = (key: string) => t(`calculator.warmFloor.coverings.${key}.hint`, { defaultValue: '' });
  const substrateLabel = (key: string) => t(`calculator.warmFloor.substrates.${key}.label`, { defaultValue: key });
  const substrateHint = (key: string) => t(`calculator.warmFloor.substrates.${key}.hint`, { defaultValue: '' });
  const insulationLabel = (key: string) => t(`calculator.warmFloor.insulation.${key}.label`, { defaultValue: key });
  const insulationHint = (key: string) => t(`calculator.warmFloor.insulation.${key}.hint`, { defaultValue: '' });
  const systemLabel = (key: string) => t(`calculator.warmFloor.systems.${key}.label`, { defaultValue: key });
  const systemHint = (key: string) => t(`calculator.warmFloor.systems.${key}.hint`, { defaultValue: '' });

  const {
    settings,
    isLoading,
    error,
    area,
    installationAreaM2,
    roomType,
    heatingType,
    covering,
    substrate,
    insulationLevel,
    systemType,
    selectedBrand,
    result,
    recommendedProducts,
    accessoryProducts,
    accessoryReplacements,
    recommendationFallback,
    missingAccessoryRequirements,
    currentStepIndex,
    isGuided,
    setInput,
    calculate,
    reset,
    loadSettings,
    nextStep,
    prevStep,
    startGuided,
    selectBrand,
  } = useWarmFloorStore();

  const addToCart = useStore((s) => s.addToCart);

  useEffect(() => {
    if (!settings && !isLoading) loadSettings();
  }, [settings, isLoading, loadSettings]);

  if (isLoading && !settings) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[28px] border border-line bg-surface shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <div className="text-sm text-fg-muted">{t('calculator.warmFloor.loading')}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[28px] border border-primary/20 bg-primary/5 p-6 text-center shadow-sm">
        <div className="mb-2 text-lg font-black text-primary">{t('calculator.warmFloor.errors.loadTitle')}</div>
        <div className="mb-4 text-sm text-fg-muted">{error}</div>
        <button onClick={() => loadSettings()} className="btn-primary px-6">{t('common.actions.retry')}</button>
      </div>
    );
  }

  if (!settings) return null;

  const brandOptions = settings.brandSelection?.options || [];
  const selectedBrandOption = brandOptions.find((brand) => brand.id === selectedBrand);
  const progress = Math.round(((currentStepIndex + 1) / 9) * 100);
  const usefulAreaPercent = area > 0 ? Math.round((installationAreaM2 / area) * 100) : 0;
  const resultWarnings = normalizeWarnings(result?.warnings, message);

  const steps = [
    {
      id: 'roomType',
      eyebrow: t('calculator.warmFloor.steps.room.eyebrow'),
      title: t('calculator.warmFloor.steps.room.title'),
      description: t('calculator.warmFloor.steps.room.description'),
      options: Object.keys(settings.powerPresetsWm2 || {}).map((key) => ({ value: key, label: roomLabel(key), hint: roomHint(key) })),
      value: roomType,
      onSelect: (value: string) => { setInput({ roomType: value as any }); nextStep(); },
    },
    {
      id: 'roomAreaM2',
      eyebrow: t('calculator.warmFloor.steps.area.eyebrow'),
      title: t('calculator.warmFloor.steps.area.title'),
      description: t('calculator.warmFloor.steps.area.description'),
      type: 'number',
      value: area,
      onChange: (value: number) => setInput({ area: value, installationAreaM2: Math.min(installationAreaM2 || value, value) }),
      onNext: () => { setInput({ installationAreaM2: installationAreaM2 > 0 ? Math.min(installationAreaM2, area) : Number((area * 0.8).toFixed(1)) }); nextStep(); },
    },
    {
      id: 'installationAreaM2',
      eyebrow: t('calculator.warmFloor.steps.installArea.eyebrow'),
      title: t('calculator.warmFloor.steps.installArea.title'),
      description: t('calculator.warmFloor.steps.installArea.description'),
      type: 'number',
      value: installationAreaM2,
      helper: usefulAreaPercent > 90
        ? t('calculator.warmFloor.validation.suspiciousHeatedArea', { percent: usefulAreaPercent })
        : `${usefulAreaPercent || 0}% ${t('calculator.warmFloor.steps.installArea.helperSuffix')}`,
      onChange: (value: number) => setInput({ installationAreaM2: Math.min(value, area) }),
      onNext: () => nextStep(),
    },
    {
      id: 'substrateType',
      eyebrow: t('calculator.warmFloor.steps.substrate.eyebrow'),
      title: t('calculator.warmFloor.steps.substrate.title'),
      description: t('calculator.warmFloor.steps.substrate.description'),
      options: SUBSTRATE_KEYS.map((key) => ({ value: key, label: substrateLabel(key), hint: substrateHint(key) })),
      value: substrate,
      onSelect: (value: string) => { setInput({ substrate: value as any }); nextStep(); },
    },
    {
      id: 'floorCovering',
      eyebrow: t('calculator.warmFloor.steps.covering.eyebrow'),
      title: t('calculator.warmFloor.steps.covering.title'),
      description: t('calculator.warmFloor.steps.covering.description'),
      options: Object.keys(settings.coveringCompatibility || {}).map((key) => ({ value: key, label: coveringLabel(key), hint: coveringHint(key) })),
      value: covering,
      onSelect: (value: string) => { setInput({ covering: value as any }); nextStep(); },
    },
    {
      id: 'heatingPurpose',
      eyebrow: t('calculator.warmFloor.steps.heating.eyebrow'),
      title: t('calculator.warmFloor.steps.heating.title'),
      description: t('calculator.warmFloor.steps.heating.description'),
      options: ['comfort_floor', 'additional_heating', 'main_heating'].map((key) => ({ value: key, label: heatingLabel(key), hint: heatingHint(key) })),
      value: heatingType,
      onSelect: (value: string) => { setInput({ heatingType: value as any }); nextStep(); },
    },
    {
      id: 'insulationLevel',
      eyebrow: t('calculator.warmFloor.steps.insulation.eyebrow'),
      title: t('calculator.warmFloor.steps.insulation.title'),
      description: t('calculator.warmFloor.steps.insulation.description'),
      options: INSULATION_KEYS.map((key) => ({ value: key, label: insulationLabel(key), hint: insulationHint(key) })),
      value: insulationLevel,
      onSelect: (value: string) => { setInput({ insulationLevel: value as any }); nextStep(); },
    },
    {
      id: 'systemType',
      eyebrow: t('common.labels.system'),
      title: t('calculator.warmFloor.steps.system.title'),
      description: t('calculator.warmFloor.steps.system.description'),
      options: SYSTEM_KEYS.map((key) => ({ value: key, label: systemLabel(key), hint: systemHint(key) })),
      value: systemType,
      onSelect: (value: string) => { setInput({ systemType: value as any }); nextStep(); },
    },
    {
      id: 'brand',
      eyebrow: t('common.labels.brand'),
      title: t('calculator.warmFloor.steps.brand.title'),
      description: t('calculator.warmFloor.steps.brand.description'),
      type: 'brand',
      onNext: () => calculate(),
    },
  ];

  const currentStep = steps[currentStepIndex];

  if (!result && !isGuided) {
    return (
      <section className="relative overflow-hidden rounded-[34px] border border-line bg-gradient-to-br from-card via-surface to-primary/5 p-6 shadow-sm md:p-10">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-warn/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-primary">
              <Flame className="h-4 w-4" /> {t('calculator.warmFloor.hero.badge')}
            </div>
            <h2 className="max-w-3xl text-3xl font-black tracking-tight text-fg-strong md:text-5xl">
              {t('calculator.warmFloor.hero.title')}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-fg-soft">
              {t('calculator.warmFloor.hero.description')}
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                ['🔥', t('calculator.warmFloor.hero.cards.system.title'), t('calculator.warmFloor.hero.cards.system.text')],
                ['🧱', t('calculator.warmFloor.hero.cards.floor.title'), t('calculator.warmFloor.hero.cards.floor.text')],
                ['✅', t('calculator.warmFloor.hero.cards.kit.title'), t('calculator.warmFloor.hero.cards.kit.text')],
              ].map(([icon, title, text]) => (
                <div key={title} className="rounded-3xl border border-line bg-surface/70 p-4">
                  <div className="text-2xl">{icon}</div>
                  <div className="mt-2 text-sm font-black text-fg-strong">{title}</div>
                  <div className="mt-1 text-xs text-fg-muted">{text}</div>
                </div>
              ))}
            </div>
            <button onClick={startGuided} className="btn-primary mt-8 w-full rounded-3xl py-5 text-lg font-black shadow-xl shadow-primary/25 sm:w-auto sm:px-10">
              {t('calculator.warmFloor.hero.start')}
            </button>
          </div>

          <div className="rounded-[32px] border border-line bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-fg-faint">{t('calculator.warmFloor.output.caption')}</div>
                <div className="mt-1 text-xl font-black text-fg-strong">{t('calculator.warmFloor.output.title')}</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Snowflake className="h-6 w-6" />
              </div>
            </div>
            <div className="space-y-3">
              {[t('calculator.warmFloor.output.items.power'), t('calculator.warmFloor.output.items.spacing'), t('calculator.warmFloor.output.items.tape'), t('calculator.warmFloor.output.items.thermostat'), t('calculator.warmFloor.output.items.warnings')].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-line bg-surface/60 p-3 text-sm text-fg-soft">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (isGuided && currentStep) {
    return (
      <div className="mx-auto max-w-5xl animate-in fade-in slide-in-from-bottom-8 duration-500">
        <div className="mb-5 flex items-center justify-between gap-4 px-1 text-xs font-black uppercase tracking-widest text-fg-faint">
          <span>{t('calculator.warmFloor.progress', { step: currentStepIndex + 1, total: steps.length, progress })}</span>
          <button onClick={reset} className="rounded-full px-3 py-2 hover:bg-surface hover:text-primary">{t('common.actions.reset')}</button>
        </div>
        <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-surface ring-1 ring-line">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-warn transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <section className="grid gap-5 lg:grid-cols-[0.72fr_0.28fr]">
          <div className="rounded-[32px] border border-line bg-card p-5 shadow-sm md:p-8">
            <div className="mb-8 flex items-start gap-4">
              {currentStepIndex > 0 && (
                <button onClick={prevStep} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface hover:border-primary hover:text-primary">
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <div>
                <div className="section-caption !mb-2">{currentStep.eyebrow}</div>
                <h2 className="text-2xl font-black tracking-tight text-fg-strong md:text-4xl">{currentStep.title}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-muted">{currentStep.description}</p>
              </div>
            </div>

            {currentStep.options && (
              <div className="grid gap-3 md:grid-cols-2">
                {currentStep.options.map((opt) => {
                  const active = currentStep.value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => currentStep.onSelect?.(opt.value)}
                      className={`group flex min-h-[112px] items-start justify-between gap-4 rounded-3xl border-2 p-5 text-left transition-all ${active ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10' : 'border-line bg-surface/50 hover:border-primary/50 hover:bg-surface'}`}
                    >
                      <span>
                        <span className={`block text-base font-black ${active ? 'text-primary' : 'text-fg-strong'}`}>{opt.label}</span>
                        {opt.hint && <span className="mt-2 block text-xs leading-5 text-fg-muted">{opt.hint}</span>}
                      </span>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-primary bg-primary' : 'border-line group-hover:border-primary/60'}`}>
                        {active && <Check className="h-4 w-4 text-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {currentStep.type === 'number' && (
              <div className="space-y-5">
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max={currentStep.id === 'installationAreaM2' ? area : undefined}
                    step="0.1"
                    value={currentStep.value}
                    onChange={(event) => currentStep.onChange?.(parseFloat(event.target.value) || 0)}
                    className="field w-full rounded-[28px] bg-surface px-6 py-7 text-center text-4xl font-black ring-2 ring-line focus:border-primary focus:ring-primary"
                    autoFocus
                  />
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 text-xl font-black text-fg-faint">{t('common.units.m2')}</div>
                </div>
                {currentStep.helper && <div className="rounded-2xl border border-line bg-surface/60 p-4 text-sm text-fg-muted">{currentStep.helper}</div>}
                <button
                  onClick={currentStep.onNext}
                  disabled={Number(currentStep.value) <= 0 || (currentStep.id === 'installationAreaM2' && Number(currentStep.value) > area)}
                  className="btn-primary flex w-full items-center justify-center gap-2 rounded-3xl py-5 text-lg font-black shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('common.actions.continue')} <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}

            {currentStep.type === 'brand' && (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    onClick={() => selectBrand(null as any)}
                    className={`rounded-3xl border-2 p-5 text-left transition-all ${!selectedBrand ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10' : 'border-line bg-surface/50 hover:border-primary/50'}`}
                  >
                    <div className="text-base font-black text-fg-strong">{t('calculator.warmFloor.brand.autoTitle')}</div>
                    <div className="mt-2 text-xs leading-5 text-fg-muted">{t('calculator.warmFloor.brand.autoText')}</div>
                  </button>
                  {brandOptions.map((brand) => {
                    const active = selectedBrand === brand.id;
                    return (
                      <button
                        key={brand.id}
                        onClick={() => selectBrand(brand.id as any)}
                        className={`rounded-3xl border-2 p-5 text-left transition-all ${active ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10' : 'border-line bg-surface/50 hover:border-primary/50'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className={`text-base font-black ${active ? 'text-primary' : 'text-fg-strong'}`}>{brand.name}</div>
                          {active && <Check className="h-5 w-5 text-primary" />}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-fg-muted">{t(`calculator.warmFloor.brand.options.${brand.id}.strengths`)}</div>
                        <div className="mt-3 text-[11px] font-bold text-fg-faint">{t(`calculator.warmFloor.brand.options.${brand.id}.note`)}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-3xl border border-line bg-surface/60 p-5">
                  <div className="mb-4 text-xs font-black uppercase tracking-widest text-fg-faint">{t('calculator.warmFloor.review.title')}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      [t('calculator.warmFloor.steps.room.eyebrow'), roomLabel(roomType)],
                      [t('calculator.warmFloor.review.totalArea'), `${fmt(area)} ${t('common.units.m2')}`],
                      [t('calculator.warmFloor.review.installArea'), `${fmt(installationAreaM2)} ${t('common.units.m2')}`],
                      [t('calculator.warmFloor.steps.substrate.eyebrow'), substrateLabel(substrate)],
                      [t('calculator.warmFloor.steps.covering.eyebrow'), coveringLabel(covering)],
                      [t('calculator.warmFloor.steps.heating.eyebrow'), heatingLabel(heatingType)],
                      [t('calculator.warmFloor.review.insulation'), insulationLabel(insulationLevel)],
                      [t('common.labels.system'), systemLabel(systemType)],
                      [t('common.labels.brand'), selectedBrandOption?.shortName || t('common.fallbacks.auto')],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-line/40 bg-card/60 p-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-fg-faint">{label}</div>
                        <div className="mt-1 text-sm font-black text-fg-strong">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={currentStep.onNext}
                  disabled={isLoading}
                  className="btn-primary flex w-full items-center justify-center gap-2 rounded-3xl py-5 text-xl font-black shadow-xl shadow-primary/25 disabled:opacity-60"
                >
                  {isLoading ? t('calculator.warmFloor.actions.calculating') : t('calculator.warmFloor.actions.getEngineeringResult')}
                </button>
              </div>
            )}
          </div>

          <aside className="rounded-[32px] border border-line bg-surface/70 p-5 shadow-sm">
            <div className="section-caption !mb-3">{t('calculator.warmFloor.liveBrief')}</div>
            <div className="space-y-3 text-sm">
              {[
                [t('calculator.warmFloor.steps.room.eyebrow'), roomLabel(roomType)],
                [t('calculator.warmFloor.review.installation'), `${fmt(installationAreaM2)} ${t('common.labels.of')} ${fmt(area)} ${t('common.units.m2')}`],
                [t('calculator.warmFloor.steps.covering.eyebrow'), coveringLabel(covering)],
                [t('calculator.warmFloor.steps.substrate.eyebrow'), substrateLabel(substrate)],
                [t('common.labels.system'), systemLabel(systemType)],
                [t('common.labels.brand'), selectedBrandOption?.shortName || t('common.fallbacks.auto')],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-line/40 pb-3 last:border-0">
                  <span className="text-fg-muted">{label}</span>
                  <span className="text-right font-black text-fg-strong">{value}</span>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-32">
      {result && (
        <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-700">
          <section className="rounded-[34px] border border-primary/20 bg-gradient-to-br from-card via-surface to-primary/5 p-5 shadow-sm md:p-8">
            <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="section-caption !mb-2">{t('calculator.warmFloor.result.caption')}</div>
                <h2 className="text-3xl font-black tracking-tight text-fg-strong md:text-4xl">{t('calculator.warmFloor.result.title')}</h2>
                <p className="mt-2 max-w-2xl text-sm text-fg-muted">{t('calculator.warmFloor.result.description')}</p>
              </div>
              <button onClick={reset} className="btn-secondary rounded-2xl px-5 py-3 text-sm font-black">{t('calculator.warmFloor.actions.changeParams')}</button>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
              {[
                [t('calculator.warmFloor.review.totalArea'), result.roomAreaM2],
                [t('calculator.warmFloor.review.excludedArea'), result.excludedAreaM2],
                [t('calculator.warmFloor.review.usefulArea'), result.installationAreaM2],
              ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-line bg-card/70 p-3 text-center"><div className="text-[9px] font-black uppercase tracking-wider text-fg-faint">{label}</div><div className="mt-1 font-black text-fg-strong">{fmt(value, 1)} {t('common.units.m2')}</div></div>)}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: t('calculator.warmFloor.result.cards.required'), val: result.requiredTotalPowerW, fallback: (result as any).requiredPowerW, unit: t('common.units.w'), hint: t('calculator.warmFloor.result.hints.byArea'), digits: 0 },
                { label: t('calculator.warmFloor.result.cards.selected'), val: result.selectedProductTotalPowerW, fallback: (result as any).selectedPowerW, unit: t('common.units.w'), hint: t('calculator.warmFloor.result.hints.catalogProduct'), digits: 0 },
                { label: t('calculator.warmFloor.result.cards.actualPower'), val: result.actualInstalledPowerWm2, fallback: (result as any).actualPowerWm2, unit: t('common.units.wm2'), hint: t('calculator.warmFloor.result.hints.installArea'), digits: 0 },
                { label: t('calculator.warmFloor.result.cards.current'), val: result.actualCurrentA, unit: t('common.units.amp'), hint: t('calculator.warmFloor.result.hints.protection'), digits: 2 },
              ].map((item) => (
                <div key={item.label} className="rounded-3xl border border-line bg-card/70 p-5 text-center">
                  <div className="text-[10px] font-black uppercase tracking-widest text-fg-faint">{item.label}</div>
                  <div className="mt-3 text-3xl font-black leading-none text-fg-strong">{fmt(item.val ?? item.fallback, item.digits)}</div>
                  <div className="mt-1 text-xs font-black text-primary">{item.unit}</div>
                  <div className="mt-3 text-[10px] uppercase tracking-widest text-fg-faint">{item.hint}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-primary/10 bg-primary/5 p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Info className="h-5 w-5" /></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-fg-strong">{t('calculator.warmFloor.installation.title')}</h3>
                </div>
                <div className="space-y-4">
                  {[
                    [t('calculator.warmFloor.installation.cableSpacing'), result.spacingCm, t('common.units.cm'), t('calculator.warmFloor.installation.freeCable'), 1],
                    [t('calculator.warmFloor.installation.mountingTape'), result.mountingTapeLengthM ?? (result as any).mountingTapeM, t('common.units.m'), t('calculator.warmFloor.installation.withReserve'), 0],
                    [t('calculator.warmFloor.installation.matArea'), result.totalMatAreaM2 ?? (result as any).coveredAreaM2, t('common.units.m2'), t('calculator.warmFloor.installation.actualCoverage'), 1],
                    [t('calculator.warmFloor.installation.matCoverage'), result.coveragePercent, '%', t('calculator.warmFloor.installation.fromUsefulArea'), 0],
                    [t('calculator.warmFloor.installation.temperatureLimit'), result.floorTemperatureLimitC, '°C', t('calculator.warmFloor.installation.byCovering'), 0],
                  ].filter(([, value]) => value !== undefined && value !== null).map(([label, value, unit, hint, digits]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-line/30 pb-4 last:border-0">
                      <div>
                        <div className="text-xs font-black uppercase tracking-widest text-fg-faint">{label}</div>
                        <div className="mt-1 text-sm text-fg-muted">{hint}</div>
                      </div>
                      <div className="text-right text-2xl font-black text-primary">{fmt(value, Number(digits))} <span className="text-xs">{unit}</span></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-warn/20 bg-warn/5 p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-warn/10 text-warn"><Info className="h-5 w-5" /></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-fg-strong">{t('calculator.warmFloor.warnings.title')}</h3>
                </div>
                <ul className="space-y-3">
                  {(resultWarnings.length ? resultWarnings : [t('calculator.warmFloor.warnings.defaults.noShorten'), t('calculator.warmFloor.warnings.defaults.noFurniture'), t('calculator.warmFloor.warnings.defaults.electrician')]).map((warning) => (
                    <li key={warning} className="flex gap-3 text-sm leading-6 text-fg-soft">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex flex-col gap-3 px-1 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="section-caption !mb-1">{t('calculator.warmFloor.catalogKits.caption')}</div>
                <h2 className="text-3xl font-black tracking-tight text-fg-strong">{t('calculator.warmFloor.catalogKits.title')}</h2>
              </div>
              <div className="text-sm text-fg-muted">{t('common.labels.brand')}: <span className="font-black text-fg-strong">{selectedBrandOption?.shortName || t('common.fallbacks.autoSelection')}</span></div>
            </div>

            {recommendedProducts.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {recommendedProducts.map((variant: any) => {
                  const product = variant.mainProduct || variant.product || variant;
                  if (!product?.id) return null;
                  const isPrimary = Boolean(variant.isPrimary);
                  const isReplacement = String(variant.bundleType || variant.role || '').includes('replacement');
                  const calc = variant.calculation || {};
                  const badge = isPrimary
                    ? t(`calculator.warmFloor.tiers.${variant.brandTier || product.brandTier || 'premium'}`)
                    : isReplacement
                      ? t('calculator.warmFloor.catalogKits.replacementBadge')
                      : null;
                  return (
                    <div key={`${variant.bundleType || variant.role || 'variant'}-${product.id}`} className={`group relative flex h-full flex-col overflow-hidden rounded-[30px] border bg-card p-5 shadow-sm transition-all hover:-translate-y-1 ${isPrimary ? 'border-primary ring-2 ring-primary/20' : isReplacement ? 'border-amber-300/70' : 'border-line hover:border-primary/40'}`}>
                      {badge && <div className={`absolute right-0 top-0 rounded-bl-2xl px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white ${isPrimary ? 'bg-primary' : 'bg-amber-500'}`}>{badge}</div>}
                      <div className="mb-5 flex gap-4">
                        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-3xl border border-line bg-surface p-2 shadow-inner">
                          <ManagedImage src={product.image} alt={product.name} variant="product" placeholderTitle={product.name} placeholderSubtitle={product.brand} className="h-full w-full object-contain transition-transform duration-700 group-hover:scale-105" />
                        </div>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className={`mb-2 text-[10px] font-black uppercase tracking-widest ${isPrimary ? 'text-primary' : 'text-fg-faint'}`}>{variant.labelCode ? message(variant.labelCode) : t('calculator.warmFloor.catalogKits.variant')}</div>
                          <div className="line-clamp-3 text-base font-black leading-tight text-fg-strong">{product.name}</div>
                          <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-fg-faint">{product.brand}{product.brandTier ? ` · ${t(`calculator.warmFloor.tiers.${product.brandTier}`)}` : ''}{product.article ? ` · ${product.article}` : ''}</div>
                        </div>
                      </div>

                      <div className="mb-5 grid grid-cols-2 gap-2 text-xs">
                        {[
                          [t('common.labels.power'), `${fmt(calc.selectedProductTotalPowerW ?? calc.selectedPowerW ?? product.powerW ?? (product.powerKw ? product.powerKw * 1000 : null), 0)} ${t('common.units.w')}`],
                          [t('calculator.warmFloor.catalogKits.density'), `${fmt(calc.actualInstalledPowerWm2 ?? calc.actualPowerWm2, 0)} ${t('common.units.wm2')}`],
                          [t('calculator.warmFloor.catalogKits.targetDensity'), `${fmt(calc.targetInstalledPowerWm2, 0)} ${t('common.units.wm2')}`],
                          [t('calculator.warmFloor.catalogKits.spacingArea'), calc.spacingCm ? `${fmt(calc.spacingCm, 1)} ${t('common.units.cm')}` : calc.totalMatAreaM2 || calc.coveredAreaM2 ? `${fmt(calc.totalMatAreaM2 ?? calc.coveredAreaM2, 1)} ${t('common.units.m2')}` : '—'],
                          [t('calculator.warmFloor.catalogKits.current'), calc.actualCurrentA != null ? `${fmt(calc.actualCurrentA, 2)} A` : '—'],
                          [t('common.labels.availability'), product.availabilityStatus === 'in_stock' ? t('common.fallbacks.inStock') : product.availabilityStatus === 'low_stock' ? t('common.fallbacks.lowStock') : t('common.fallbacks.preorder')],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-line bg-surface/60 p-3">
                            <div className="text-[9px] font-black uppercase tracking-widest text-fg-faint">{label}</div>
                            <div className="mt-1 font-black text-fg-strong">{value}</div>
                          </div>
                        ))}
                      </div>

                      {variant.explanation && (
                        <div className="mb-5 rounded-2xl border border-line bg-surface/60 p-4">
                          <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-fg-faint">{t('calculator.warmFloor.explanation.title')}</div>
                          <ul className="space-y-2 text-xs leading-5 text-fg-muted">
                            <li><span className="font-black text-fg-strong">{t('calculator.warmFloor.explanation.why')}:</span> {message(variant.explanation.whyCode, variant.explanation.whyParams)}</li>
                            <li><span className="font-black text-fg-strong">{t('calculator.warmFloor.explanation.mounting')}:</span> {message(variant.explanation.mountingCode, variant.explanation.mountingParams)}</li>
                            <li><span className="font-black text-fg-strong">{t('calculator.warmFloor.explanation.performance')}:</span> {message(variant.explanation.performanceCode, variant.explanation.performanceParams)}</li>
                            <li><span className="font-black text-fg-strong">{t('calculator.warmFloor.explanation.price')}:</span> {message(variant.explanation.commercialCode, variant.explanation.commercialParams)}</li>
                          </ul>
                        </div>
                      )}

                      <div className="mt-auto border-t border-line/40 pt-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-fg-faint">{t('calculator.warmFloor.catalogKits.productCost')}</div>
                            <div className="mt-1 text-2xl font-black tracking-tight text-fg-strong">{product.price ? `${fmt(product.price, 0)} ${product.currency || 'AMD'}` : t('common.fallbacks.priceRequest')}</div>
                          </div>
                          <button onClick={() => addToCart({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name, price: product.price || 0, image: product.image })} className={isPrimary ? 'btn-primary rounded-2xl p-4' : 'btn-secondary rounded-2xl p-4'} title={t('common.actions.addToCart')}>
                            <Check className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {product.powerKw && <span className="rounded-full border border-line bg-surface px-3 py-1 text-[10px] font-black text-fg-muted">{product.powerKw} {t('common.units.kw')}</span>}
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${availabilityClass(product.availabilityStatus)}`}>{product.availabilityStatus === 'in_stock' ? t('common.fallbacks.inStock') : product.availabilityStatus === 'low_stock' ? t('common.fallbacks.lowStock') : t('common.fallbacks.preorder')}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[30px] border-2 border-dashed border-line bg-card/40 p-10 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface text-fg-faint"><Info className="h-8 w-8" /></div>
                <div className="mb-2 text-lg font-black text-fg-strong">{message(recommendationFallback?.code) || t('calculator.warmFloor.empty.title')}</div>
                <p className="mx-auto max-w-lg text-sm leading-6 text-fg-muted">{t('calculator.warmFloor.empty.text')}</p>
                {recommendationFallback?.requiredCharacteristics && (
                  <div className="mx-auto mt-5 grid max-w-2xl grid-cols-2 gap-2 text-left text-xs sm:grid-cols-3">
                    {[
                      [t('calculator.warmFloor.review.usefulArea'), `${fmt(recommendationFallback.requiredCharacteristics.heatedAreaM2, 1)} ${t('common.units.m2')}`],
                      [t('calculator.warmFloor.result.requiredPower'), `${fmt(recommendationFallback.requiredCharacteristics.requiredPowerW, 0)} ${t('common.units.w')}`],
                      [t('calculator.warmFloor.catalogKits.targetDensity'), `${fmt(recommendationFallback.requiredCharacteristics.targetPowerWm2, 0)} ${t('common.units.wm2')}`],
                      [t('calculator.warmFloor.fallback.systemType'), message(`systemTypes.${recommendationFallback.requiredCharacteristics.systemType}`)],
                      [t('calculator.warmFloor.fallback.maxLinearPower'), `${fmt(recommendationFallback.requiredCharacteristics.maximumIndoorCableLinearPowerWm, 0)} W/m`],
                      [t('calculator.warmFloor.fallback.thermostatLoad'), `${fmt(recommendationFallback.requiredCharacteristics.thermostat?.minimumSwitchingLoadA, 2)} A`],
                    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-line bg-surface p-3"><div className="text-fg-faint">{label}</div><div className="mt-1 font-black text-fg-strong">{value}</div></div>)}
                  </div>
                )}
                {Array.isArray(recommendationFallback?.rejectedReasons) && recommendationFallback.rejectedReasons.length > 0 && (
                  <div className="mx-auto mt-5 max-w-2xl text-left">
                    <div className="text-xs font-black uppercase tracking-wider text-fg-faint">{t('calculator.warmFloor.fallback.rejectionReasons')}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-fg-muted">
                      {recommendationFallback.rejectedReasons.map((item: any) => <li key={item.code}>{message(item.code, item.params)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {accessoryProducts.length > 0 && (
            <section className="space-y-5">
              <div className="flex items-center gap-3 px-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Check className="h-4 w-4" /></div>
                <div>
                  <div className="section-caption !mb-0">{t('calculator.common.accessories')}</div>
                  <h3 className="text-xl font-black text-fg-strong">{t('calculator.warmFloor.accessories.title')}</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">{t('calculator.warmFloor.accessories.subtitle')}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {accessoryProducts.map((acc: any) => {
                  const isManual = Boolean(acc.isManualLineItem) || Number(acc.id) < 0;
                  const groupLabel = message(acc.groupLabelCode) || acc.accessoryGroup || acc.equipmentType || t('calculator.common.accessory');
                  const accessoryName = acc.name || message(acc.nameCode);
                  return (
                    <div key={`main-${acc.accessoryGroup || 'acc'}-${acc.id}`} className={`group flex flex-col rounded-3xl border p-4 transition-all ${acc.required ? 'border-primary/30 bg-primary/[0.03]' : 'border-line bg-surface/60 hover:border-primary/40 hover:bg-surface'}`}>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-line bg-card px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-fg-muted">{groupLabel}</span>
                        {acc.required ? (
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-primary">{t('calculator.warmFloor.accessories.required')}</span>
                        ) : (
                          <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-fg-faint">{t('calculator.warmFloor.accessories.recommended')}</span>
                        )}
                      </div>
                      <div className="mb-4 flex items-center gap-4">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-line bg-card p-1.5 shadow-sm">
                          <ManagedImage src={acc.image} alt={accessoryName} variant="product" placeholderTitle={accessoryName} placeholderSubtitle={acc.brand} className="h-full w-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-fg-faint">{acc.brand || t('calculator.warmFloor.accessories.kitItem')}</div>
                          <div className="line-clamp-2 text-sm font-black text-fg-strong group-hover:text-primary">{accessoryName}</div>
                        </div>
                      </div>
                      {acc.noteCode ? <p className="mb-3 line-clamp-3 text-xs leading-5 text-fg-muted">{message(acc.noteCode, acc.noteParams)}</p> : null}
                      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line/30 pt-3">
                        <div className="text-sm font-black text-fg-strong">{acc.price ? `${fmt(acc.price, 0)} ${acc.currency || 'AMD'}` : t('common.fallbacks.priceRequest')}</div>
                        {!isManual ? (
                          <button onClick={() => addToCart({ productId: acc.id, slug: acc.slug, sku: acc.sku, name: accessoryName, price: acc.price || 0, image: acc.image })} className="flex h-9 w-9 items-center justify-center rounded-xl border border-line hover:border-primary hover:bg-primary hover:text-white" title={t('common.actions.addToCart')}>
                            <Check className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="rounded-xl border border-dashed border-line px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-fg-faint">{t('calculator.warmFloor.accessories.estimate')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(accessoryReplacements) && accessoryReplacements.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="px-1">
                    <div className="text-sm font-black text-fg-strong">{t('calculator.warmFloor.accessories.replacementsTitle')}</div>
                    <p className="mt-1 text-xs leading-5 text-fg-muted">{t('calculator.warmFloor.accessories.replacementsText')}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {accessoryReplacements.map((acc: any) => {
                      const replacementName = acc.name || message(acc.nameCode);
                      return (
                      <div key={`repl-${acc.accessoryGroup || 'acc'}-${acc.id}`} className="group flex flex-col rounded-3xl border border-amber-300/60 bg-amber-50/30 p-4 transition-all hover:border-amber-400">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-line bg-card px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-fg-muted">{message(acc.groupLabelCode) || acc.accessoryGroup}</span>
                          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">{t('calculator.warmFloor.catalogKits.replacementBadge')}</span>
                        </div>
                        <div className="mb-3 line-clamp-2 text-sm font-black text-fg-strong">{replacementName}</div>
                        {acc.noteCode ? <p className="mb-3 line-clamp-2 text-xs leading-5 text-fg-muted">{message(acc.noteCode, acc.noteParams)}</p> : null}
                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line/30 pt-3">
                          <div className="text-sm font-black text-fg-strong">{acc.price ? `${fmt(acc.price, 0)} ${acc.currency || 'AMD'}` : t('common.fallbacks.priceRequest')}</div>
                          <button onClick={() => addToCart({ productId: acc.id, slug: acc.slug, sku: acc.sku, name: replacementName, price: acc.price || 0, image: acc.image })} className="flex h-9 w-9 items-center justify-center rounded-xl border border-line hover:border-primary hover:bg-primary hover:text-white" title={t('common.actions.addToCart')}>
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {result && (
            <section className="rounded-[30px] border border-amber-300/60 bg-amber-50/40 p-6">
              <div className="mb-2 text-sm font-black text-fg-strong">{t('calculator.warmFloor.important.title')}</div>
              <p className="text-sm leading-6 text-fg-muted">{t('calculator.warmFloor.important.electricalDisclaimer')}</p>
              {Array.isArray(missingAccessoryRequirements) && missingAccessoryRequirements.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-black uppercase tracking-wider text-amber-800">{t('calculator.warmFloor.important.missingAccessories')}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-fg-muted">
                    {missingAccessoryRequirements.map((item: any, index: number) => <li key={`${item.group}-${index}`}>{message(item.specificationCode, item.params)}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
