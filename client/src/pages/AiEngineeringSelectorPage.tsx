import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useStore, type UserAssistantProfile } from '../store/useStore';
import { Flame, Snowflake, FileText, Wrench, Bolt, ChevronRight } from '../components/Icons';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt?: string;
};

type AssistantState = {
  intent: string;
  stage: string;
  requirements: Record<string, unknown>;
  missingFields: string[];
  readyForSelection: boolean;
};

type FloorHeatingAnalysis = {
  recommendedSolution: string;
  availableInstallAreaM2: number;
  requiredHeatingPowerW: number;
  selectedSystemPowerKw: number;
  selectedSystemPowerW: number;
  specificPowerWm2: number;
  powerCoveragePercent: number;
  powerBalancePercent: number;
  cableLengthM?: number | null;
  cableSpacingCm?: number | null;
  mountingTapeRequiredWithReserveM?: number | null;
  matAreaM2?: number | null;
  matPowerPerM2?: number | null;
  engineeringConclusion: string;
  installationRecommendations: string[];
};

type RoomHeatingAnalysis = {
  title: string;
  baseRule: string;
  totalAreaM2: number;
  totalPowerKw: number;
  totalPowerW: number;
  equipmentCount: number;
  preliminaryCostNote: string;
  engineerRecommendation: string;
  roomRecommendations: Array<{
    id: string;
    label: string;
    type: string;
    areaM2: number;
    requiredPowerKw: number;
    requiredPowerW: number;
    recommendedEquipment: string;
    systemType: string;
    quantity: string;
    explanation: string;
  }>;
};

type SelectionResult = {
  requiredPowerKw: number;
  recommendedRange: string;
  recommendedSystems: { systemType: string; label: string; reason: string }[];
  bundles: Array<{
    bundleType: 'economy' | 'optimal' | 'premium';
    title: string;
    description: string;
    mainProduct: Product | null;
    accessories: Product[];
    estimatedTotal: number | null;
    availabilityStatus: string;
    notes: string[];
  }>;
  mainProducts: Product[];
  accessories: Product[];
  warnings: string[];
  floorHeating?: FloorHeatingAnalysis;
  roomHeating?: RoomHeatingAnalysis;
  disclaimer: string;
  calculationDetails: {
    mode: string;
    area: number;
    ceilingHeight: number;
    volumeM3: number;
    basePowerKw: number;
    coefficient: number;
    range: { label: string; minKw: number | null; maxKw: number | null };
    energySource?: string;
    systemTypes?: string[];
    budgetLevel?: string;
    includeAccessories?: boolean;
  };
};

type Product = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article: string;
  powerKw?: number | null;
  recommendedAreaM2?: number | null;
  price?: number | null;
  currency?: string;
  image?: string;
  availabilityStatus: string;
  availabilityLabel: string;
  preorderNote: string;
  equipmentType: string;
  energySource: string;
  systemType: string;
  aiSelectionNotes: string;
  brandQualityTier: string;
};

type UIOption = { label: string; value: unknown; icon?: string };

type NumberInputQuestion = {
  type: 'number_input';
  field: string;
  label: string;
  description?: string;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  defaultValue?: number | null;
  required?: boolean;
};

type SingleChoiceQuestion = {
  type: 'single_choice';
  field: string;
  label: string;
  description?: string;
  options: UIOption[];
  required?: boolean;
};

type MultiChoiceQuestion = {
  type: 'multi_choice';
  field: string;
  label: string;
  description?: string;
  options: UIOption[];
  allowSkip?: boolean;
};

type ConfirmationQuestion = {
  type: 'confirmation';
  field: 'confirmation';
  label: string;
  description?: string;
  summary: Array<{ label: string; value: string }>;
  options: UIOption[];
};

type MultiCounterQuestion = {
  type: 'multi_counter';
  field: 'rooms';
  questionId: string;
  title: string;
  label: string;
  description?: string;
  counters: Array<{ key: string; label: string }>;
  actions: Array<'continue' | 'reset'>;
};

type RoomAreaFormQuestion = {
  type: 'room_area_form';
  field: 'roomAreaForm';
  questionId: string;
  title: string;
  label: string;
  description?: string;
  fields: Array<{ key: string; label: string; inputType: 'number' | 'select' | 'boolean'; required?: boolean; min?: number; max?: number; step?: number; options?: UIOption[] }>;
  submitLabel?: string;
};

type SummaryReviewQuestion = {
  type: 'summary_review';
  field: 'summaryAction';
  questionId: string;
  title: string;
  label: string;
  summary: Array<{ label: string; value: string }>;
  options: UIOption[];
};

type StepQuestion = NumberInputQuestion | SingleChoiceQuestion | MultiChoiceQuestion | ConfirmationQuestion | MultiCounterQuestion | RoomAreaFormQuestion | SummaryReviewQuestion;

type UIQuestion = {
  type: 'question_flow';
  totalSteps: number;
  currentStep: number;
  progressPercent: number;
  question: StepQuestion;
};

type UIResult = {
  type: 'result';
};

type UIConfirmation = {
  type: 'confirmation';
  progressPercent: number;
};

type RequirementsFormField = {
  name: string;
  label: string;
  type: 'number' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | string | boolean;
  options?: UIOption[];
};

type RequirementsFormUI = {
  type: 'requirements_form';
  form: {
    id: string;
    title: string;
    intent: string;
    mode: 'heating' | 'cooling' | 'floor_heating';
    fields: RequirementsFormField[];
    submitLabel: string;
  };
};

type UIState = UIQuestion | UIResult | UIConfirmation | RequirementsFormUI;

const intentStartItems = [
  { labelKey: 'aiTools.intents.heating', value: 'heating_selection', icon: <Flame className="h-5 w-5" /> },
  { labelKey: 'aiTools.intents.cooling', value: 'cooling_selection', icon: <Snowflake className="h-5 w-5" /> },
  { labelKey: 'aiTools.intents.electrical', value: 'electrical_selection', icon: <Bolt className="h-5 w-5" /> },
];

const forbiddenPublicFields = new Set([
  'stock_quantity',
  'available_quantity',
  'quantity',
  'reserved_quantity',
  'internal_cost',
  'supplier_cost',
  'purchase_price',
  'admin_notes',
]);

function cleanProduct(item: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (forbiddenPublicFields.has(key)) continue;
    clone[key] = value;
  }
  return clone;
}

function formatPrice(value: number | null | undefined, currency: string | undefined, requestLabel: string, locale: string) {
  if (!value) return requestLabel;
  return `${new Intl.NumberFormat(locale).format(value)} ${currency || 'AMD'}`;
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function aiHistoryKey(userId?: string | null) {
  return `ohmx-ai-chat-history:${userId || 'guest'}`;
}

function getProfilePreferences(userAssistantProfile: UserAssistantProfile | null, currentUser: { preferences?: Record<string, unknown> } | null) {
  return {
    ...(currentUser?.preferences || {}),
    ...(userAssistantProfile?.preferences || {}),
  } as Record<string, unknown>;
}

function buildPreferenceRequirements(preferences: Record<string, unknown>) {
  const requirements: Record<string, unknown> = {};
  if (['economy', 'optimal', 'premium'].includes(String(preferences.budgetLevel))) requirements.budgetLevel = preferences.budgetLevel;
  if (Array.isArray(preferences.preferredBrands) && preferences.preferredBrands.length) requirements.preferredBrands = preferences.preferredBrands;
  if (Array.isArray(preferences.preferredCategories) && preferences.preferredCategories.length) requirements.preferredCategories = preferences.preferredCategories;
  if (Array.isArray(preferences.projectTypes) && preferences.projectTypes.length) requirements.projectTypes = preferences.projectTypes;
  if (typeof preferences.aiNotes === 'string' && preferences.aiNotes.trim()) requirements.userPreferenceNotes = preferences.aiNotes.trim();
  return requirements;
}

function AvailabilityBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const text =
    status === 'in_stock'
      ? t('common.fallbacks.inStock')
      : status === 'low_stock' || status === 'mixed'
        ? t('common.fallbacks.lowOrMixed')
        : status === 'preorder'
          ? t('common.fallbacks.preorder')
          : status === 'unknown'
            ? t('common.fallbacks.availabilityUnknown')
            : t('common.fallbacks.unavailable');
  return (
    <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-fg-muted">{text}</span>
  );
}

function ChatAssistantBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-3xl border border-line bg-surface px-4 py-3 text-sm leading-6 text-fg-strong">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-fg-faint">
          <Flame className="h-4 w-4" />
          <span>{t('aiTools.chat.assistantLabel')}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

function ProductRow({ product, accessory = false, onAdd }: { product: Product; accessory?: boolean; onAdd: (p: Product) => void }) {
  const { t, i18n } = useTranslation();
  const badges = [
    product.powerKw ? `${product.powerKw} ${t('common.units.kw')}` : null,
    product.recommendedAreaM2 ? t('aiTools.product.areaBadge', { area: product.recommendedAreaM2 }) : null,
  ].filter(Boolean) as string[];
  return (
    <div className="rounded-2xl border border-line bg-card p-3">
      <div className="flex gap-3">
        {product.image ? (
          <img
            src={product.image}
            alt=""
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface text-fg-muted">
            <Flame className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg-strong">{product.name}</div>
          <div className="mt-1 text-xs text-fg-muted">{product.brand} • {product.article}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {badges.map((b) => (
              <span key={b} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-fg-muted">{b}</span>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-fg-strong">{formatPrice(product.price, product.currency, t('common.fallbacks.priceRequest'), i18n.language)}</span>
            <button onClick={() => onAdd(product)} className="btn-primary px-3 py-1.5 text-xs">{t('common.actions.addToCart')}</button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{accessory ? `${t('calculator.common.accessory')} • ` : ''}{product.systemType || product.equipmentType}</span>
        <AvailabilityBadge status={product.availabilityStatus} />
      </div>
    </div>
  );
}

function BundleCard({
  bundle,
  onAddMain,
}: {
  bundle: {
    bundleType: string;
    title: string;
    description: string;
    mainProduct: Product | null;
    accessories: Product[];
    estimatedTotal: number | null;
    availabilityStatus: string;
    notes: string[];
  };
  onAddMain: (p: Product) => void;
}) {
  const { t } = useTranslation();
  const [showAccessories, setShowAccessories] = useState(true);
  return (
    <div className="rounded-3xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-fg-strong">{bundle.title}</div>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{bundle.description}</p>
        </div>
        <div className="text-right text-xs text-fg-muted">
          <AvailabilityBadge status={bundle.availabilityStatus} />
        </div>
      </div>
      {bundle.mainProduct ? (
        <div className="mt-3">
          <ProductRow product={bundle.mainProduct} onAdd={(p) => onAddMain(p)} />
        </div>
      ) : null}
      {bundle.accessories.length > 0 ? (
        <div className="mt-3">
          <button
            onClick={() => setShowAccessories((x) => !x)}
            className="text-xs text-fg-muted underline"
          >
            {showAccessories ? t('calculator.common.removeAccessories') : t('calculator.common.showAccessories')}
          </button>
          {showAccessories ? (
            <div className="mt-2 space-y-2">
              {bundle.accessories.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-fg-strong">{acc.name}</div>
                    <div className="text-xs text-fg-muted">{acc.brand}</div>
                  </div>
                  <AvailabilityBadge status={acc.availabilityStatus} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 text-xs text-fg-muted">{bundle.notes?.[0]}</div>
    </div>
  );
}

function QuestionCard({
  ui,
  onAnswer,
  onSkip,
}: {
  ui: UIQuestion;
  onAnswer: (field: string, value: unknown) => void;
  onSkip?: () => void;
}) {
  const { t } = useTranslation();
  const { question } = ui;
  const questionKey = 'questionId' in question && question.questionId ? question.questionId : `${question.type}:${question.field}`;
  const [draft, setDraft] = useState<string>('');
  const [multi, setMulti] = useState<string[]>([]);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setDraft(question.type === 'number_input' && question.defaultValue ? String(question.defaultValue) : '');
    setMulti([]);
    setCounters({});
    const nextValues: Record<string, unknown> = {};
    if (question.type === 'room_area_form') {
      question.fields.forEach((field) => {
        if (field.inputType === 'select' && field.options?.[0]) nextValues[field.key] = field.options[0].value;
        if (field.key === 'ceilingHeight') nextValues[field.key] = 2.7;
        if (field.key === 'windowsCount') nextValues[field.key] = 1;
      });
    }
    setFormValues(nextValues);
    setValidationError('');
  }, [questionKey]);

  const submitNumber = (valueOverride?: number) => {
    if (question.type !== 'number_input') return;
    const value = valueOverride ?? Number(draft);
    const min = question.min ?? 0;
    const max = question.max ?? 1000;
    if (!Number.isFinite(value) || value < min || value > max) {
      setValidationError(t('aiTools.validation.numberRange', { min, max, unit: question.unit ? ` ${question.unit}` : '' }));
      return;
    }
    onAnswer(question.field, value);
  };

  const submitCounters = () => {
    const total = Object.values(counters).reduce((sum, value) => sum + value, 0);
    if (total < 1) {
      setValidationError(t('aiTools.validation.selectOneRoom'));
      return;
    }
    onAnswer(question.field, counters);
  };

  const isHeatingRoomPicker = question.type === 'multi_counter' && question.questionId === 'heating_apartment_rooms';

  // Heating room picker: multi-instance of same type (click adds +1), not unique toggle.
  const roomPickerMode = isHeatingRoomPicker;

  const submitRoomForm = () => {
    if (question.type !== 'room_area_form') return;
    for (const field of question.fields) {
      if (!field.required) continue;
      const value = formValues[field.key];
      if (field.inputType === 'number') {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue) || (field.min !== undefined && numberValue < field.min) || (field.max !== undefined && numberValue > field.max)) {
          setValidationError(t('aiTools.validation.checkField', { field: field.label }));
          return;
        }
      } else if (value === undefined || value === '') {
        setValidationError(t('aiTools.validation.fillField', { field: field.label }));
        return;
      }
    }
    onAnswer(question.field, formValues);
  };

  return (
    <div key={questionKey} className="rounded-3xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-fg-strong">{'title' in question && question.title ? question.title : question.label}</div>
          {'description' in question && question.description ? (
            <p className="mt-1 text-xs leading-5 text-fg-muted">{question.description}</p>
          ) : null}
        </div>
        {question.type === 'number_input' && question.unit ? (
          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-fg-muted">{question.unit}</span>
        ) : null}
      </div>

      {question.type === 'number_input' && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2">
            <input type="number" inputMode="decimal" value={draft} onChange={(e) => { setDraft(e.target.value); setValidationError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') submitNumber(); }} placeholder={question.placeholder} min={question.min} max={question.max} className="min-w-0 flex-1 bg-transparent py-2 text-lg font-semibold text-fg-strong outline-none" />
            {question.unit ? <span className="shrink-0 text-sm text-fg-muted">{question.unit}</span> : null}
          </div>
          {validationError ? <div className="text-xs text-red-400">{validationError}</div> : null}
          <button onClick={() => submitNumber()} className="btn-primary w-full py-3 text-sm">{t('common.actions.next')}</button>
        </div>
      )}

      {question.type === 'single_choice' && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => (
            <button key={String(option.value)} onClick={() => onAnswer(question.field, option.value)} className="min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-fg-strong transition hover:border-primary hover:bg-primary/10">
              {option.label}
            </button>
          ))}
        </div>
      )}

      {question.type === 'multi_counter' && (
        <div className="mt-4 space-y-3">
          {roomPickerMode ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-faint">{t('aiTools.rooms.hint')}</div>
              <p className="mt-1 text-xs text-fg-muted">Нажимайте несколько раз, чтобы добавить несколько помещений одного типа (Спальня 1, Спальня 2…).</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {question.counters.map((counter) => {
                  const count = counters[counter.key] || 0;
                  return (
                    <button
                      key={counter.key}
                      type="button"
                      onClick={() => { setCounters((prev) => ({ ...prev, [counter.key]: (prev[counter.key] || 0) + 1 })); setValidationError(''); }}
                      className={`min-h-12 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition ${count > 0 ? 'border-primary bg-primary/10 text-fg-strong' : 'border-line bg-surface text-fg-strong'}`}
                    >
                      {counter.label}{count > 0 ? ` × ${count}` : ' +'}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {question.counters.map((counter) => (
                <button key={counter.key} type="button" onClick={() => { setCounters((prev) => ({ ...prev, [counter.key]: (prev[counter.key] || 0) + 1 })); setValidationError(''); }} className="min-h-12 rounded-2xl border border-line bg-surface px-3 py-3 text-left text-sm font-semibold text-fg-strong">
                  {counter.label} +
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-line bg-surface p-3 text-sm text-fg-muted">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-fg-faint">{t('aiTools.rooms.selected')}</div>
            {Object.entries(counters).filter(([, value]) => value > 0).length ? Object.entries(counters).filter(([, value]) => value > 0).map(([key, value]) => {
              const label = question.counters.find((item) => item.key === key)?.label || key;
              return (
                <div key={key} className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3 py-2 last:mb-0">
                  <span className="font-semibold text-fg-strong">{label} × {value}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setCounters((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) - 1) }))} className="rounded-full border border-line px-2 py-1 text-[11px] text-fg-muted">−</button>
                    <button type="button" onClick={() => setCounters((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }))} className="rounded-full border border-line px-2 py-1 text-[11px] text-fg-muted">+</button>
                    <button type="button" onClick={() => setCounters((prev) => ({ ...prev, [key]: 0 }))} className="rounded-full border border-line px-2 py-1 text-[11px] text-fg-muted">{t('common.actions.remove')}</button>
                  </div>
                </div>
              );
            }) : t('common.fallbacks.nothingSelected')}
          </div>
          {validationError ? <div className="text-xs text-red-400">{validationError}</div> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setCounters({}); setValidationError(''); }} className="btn-secondary py-3 text-sm">{t('common.actions.reset')}</button>
            <button type="button" onClick={submitCounters} disabled={Object.values(counters).reduce((sum, value) => sum + value, 0) < 1} className="btn-primary py-3 text-sm disabled:opacity-50">{t('common.actions.continue')}</button>
          </div>
        </div>
      )}

      {question.type === 'room_area_form' && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {question.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs font-medium text-fg-muted">{field.label}</span>
                {field.inputType === 'select' ? (
                  <select value={String(formValues[field.key] ?? '')} onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value }))} className="mt-1 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg-strong outline-none">
                    {field.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                  </select>
                ) : (
                  <input type="number" inputMode="decimal" value={String(formValues[field.key] ?? '')} min={field.min} max={field.max} step={field.step} onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value === '' ? '' : Number(e.target.value) }))} className="mt-1 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-base font-semibold text-fg-strong outline-none" />
                )}
              </label>
            ))}
          </div>
          {validationError ? <div className="text-xs text-red-400">{validationError}</div> : null}
          <button onClick={submitRoomForm} className="btn-primary w-full py-3 text-sm">{question.submitLabel || t('common.actions.continue')}</button>
        </div>
      )}

      {question.type === 'multi_choice' && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const active = multi.includes(option.value as string);
              return <button key={String(option.value)} onClick={() => setMulti((prev) => active ? prev.filter((x) => x !== (option.value as string)) : [...prev, option.value as string])} className={`min-h-11 rounded-full border px-4 py-2 text-xs transition ${active ? 'border-primary bg-primary/10 text-fg-strong' : 'border-line bg-surface text-fg-muted'}`}>{option.label}</button>;
            })}
          </div>
          <div className="flex gap-2"><button onClick={() => onAnswer(question.field, multi)} className="btn-primary flex-1 py-3 text-sm">{t('common.actions.next')}</button>{question.allowSkip && onSkip ? <button onClick={onSkip} className="btn-secondary flex-1 py-3 text-sm">{t('common.actions.skip')}</button> : null}</div>
        </div>
      )}

      {(question.type === 'confirmation' || question.type === 'summary_review') && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2">
            {question.summary.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2 text-sm"><span className="text-fg-muted">{item.label}</span><span className="text-right font-semibold text-fg-strong">{item.value}</span></div>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {question.options.map((option, index) => <button key={String(option.value)} onClick={() => onAnswer(question.field, option.value)} className={index === 0 ? 'btn-primary py-3 text-sm' : 'btn-secondary py-3 text-sm'}>{option.label}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

function RequirementsFormCard({
  ui,
  loading,
  onSubmit,
}: {
  ui: RequirementsFormUI;
  loading: boolean;
  onSubmit: (intent: string, values: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const initialValues = useMemo(() => {
    const values: Record<string, unknown> = {};
    ui.form.fields.forEach((field) => {
      if (field.defaultValue !== undefined) values[field.name] = field.defaultValue;
      if (field.type === 'select' && values[field.name] === undefined && field.options?.[0]) values[field.name] = field.options[0].value;
    });
    return values;
  }, [ui.form]);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [validationError, setValidationError] = useState('');
  const primaryFields = ui.form.fields.filter((field) => field.name === 'areaM2' || field.name === 'ceilingHeightM');
  const advancedFields = ui.form.fields.filter((field) => field.name !== 'areaM2' && field.name !== 'ceilingHeightM' && field.name !== 'includeAccessories');
  const accessoriesField = ui.form.fields.find((field) => field.name === 'includeAccessories');

  useEffect(() => {
    setValues(initialValues);
    setValidationError('');
  }, [initialValues]);

  const updateValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setValidationError('');
  };

  const renderField = (field: RequirementsFormField) => {
    if (field.type === 'select') {
      return (
        <label key={field.name} className="block">
          <span className="text-xs font-medium text-fg-muted">{field.label}</span>
          <select
            value={String(values[field.name] ?? '')}
            onChange={(e) => updateValue(field.name, e.target.value)}
            className="mt-1 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg-strong outline-none"
          >
            {field.options?.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <label key={field.name} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg-strong">
          <input
            type="checkbox"
            checked={values[field.name] !== false}
            onChange={(e) => updateValue(field.name, e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>{field.label}</span>
        </label>
      );
    }

    return (
      <label key={field.name} className="block">
        <span className="text-xs font-medium text-fg-muted">{field.label}</span>
        <input
          type="number"
          inputMode="decimal"
          value={String(values[field.name] ?? '')}
          onChange={(e) => updateValue(field.name, e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          className="mt-1 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-base font-semibold text-fg-strong outline-none"
        />
      </label>
    );
  };

  const submitForm = () => {
    for (const field of ui.form.fields) {
      if (!field.required) continue;
      const value = values[field.name];
      if (field.type === 'number') {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue) || (field.min !== undefined && numberValue < field.min) || (field.max !== undefined && numberValue > field.max)) {
          setValidationError(t('aiTools.validation.checkField', { field: field.label }));
          return;
        }
      } else if (value === undefined || value === '') {
        setValidationError(t('aiTools.validation.fillField', { field: field.label }));
        return;
      }
    }
    onSubmit(ui.form.intent, values);
  };

  return (
    <div className="rounded-[28px] border border-line bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.parameters.caption')}</div>
          <h2 className="mt-1 text-xl font-bold text-fg-strong">{ui.form.title}</h2>
        </div>
        <div className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {t('aiTools.intents.heating')}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {primaryFields.map(renderField)}
      </div>

      <details className="mt-4 rounded-2xl border border-line bg-surface/60 p-3" open>
        <summary className="cursor-pointer text-sm font-semibold text-fg-strong">Дополнительно</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {advancedFields.map(renderField)}
        </div>
      </details>

      {accessoriesField ? <div className="mt-4">{renderField(accessoriesField)}</div> : null}
      {validationError ? <div className="mt-3 text-xs text-red-400">{validationError}</div> : null}

      <button onClick={submitForm} disabled={loading} className="btn-primary mt-4 w-full py-3 text-sm disabled:opacity-60">
        {loading ? t('aiTools.actions.calculating') : ui.form.submitLabel}
      </button>
    </div>
  );
}



export function AiEngineeringSelectorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToCart = useStore((s) => s.addToCart);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const currentUser = useStore((s) => s.currentUser);
  const userAssistantProfile = useStore((s) => s.userAssistantProfile);
  const setUserAssistantProfile = useStore((s) => s.setUserAssistantProfile);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [assistantState, setAssistantState] = useState<AssistantState | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionResult | null>(null);
  const [error, setError] = useState('');
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [accessoriesEnabled, setAccessoriesEnabled] = useState(true);
  const [ui, setUi] = useState<UIState | null>(null);
  const [started, setStarted] = useState(false);
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [lastShortReply, setLastShortReply] = useState('');
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const profilePreferences = useMemo(() => getProfilePreferences(userAssistantProfile, currentUser), [userAssistantProfile, currentUser]);
  const preferenceRequirements = useMemo(() => buildPreferenceRequirements(profilePreferences), [profilePreferences]);
  const rememberAiHistory = profilePreferences.rememberAiHistory !== false;

  const withPreferenceRequirements = (requirements?: Record<string, unknown>) => ({
    ...preferenceRequirements,
    ...(requirements || {}),
  });

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, ui]);

  useEffect(() => {
    setHistoryHydrated(false);
    if (!rememberAiHistory) {
      setMessages([]);
      window.localStorage.removeItem(aiHistoryKey(currentUser?.id));
      setHistoryHydrated(true);
      return;
    }
    const savedMessages = readLocalJson<ChatMessage[]>(aiHistoryKey(currentUser?.id), []);
    setMessages(savedMessages.slice(-30));
    if (savedMessages.length) setStarted(true);
    setHistoryHydrated(true);
  }, [currentUser?.id, rememberAiHistory]);

  useEffect(() => {
    if (!rememberAiHistory || !historyHydrated) return;
    window.localStorage.setItem(aiHistoryKey(currentUser?.id), JSON.stringify(messages.slice(-30)));
  }, [currentUser?.id, historyHydrated, messages, rememberAiHistory]);

  useEffect(() => {
    const handler = (evt: Event) => {
      const text = (evt as CustomEvent).detail;
      if (typeof text === 'string') {
        setInput(text);
      }
    };
    window.addEventListener('ai-quick', handler as EventListener);
    return () => window.removeEventListener('ai-quick', handler as EventListener);
  }, []);

  const pushMessage = (role: ChatRole, text: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() }].slice(-30));
  };

  const userContextPayload = () => ({
    userId: currentUser?.id || null,
    preferences: profilePreferences,
    userContextDocument: userAssistantProfile || null,
  });

  const applyChatResponse = (response: {
    conversationId?: string;
    reply?: string;
    state?: AssistantState;
    selection?: SelectionResult | null;
    ui?: UIState | null;
    userContextDocument?: UserAssistantProfile | null;
  }) => {
    if (response.conversationId) setConversationId(response.conversationId);
    if (response.state) {
      const requirements = { ...(response.state.requirements || {}), conversationId: response.conversationId || conversationId || undefined };
      setAssistantState({ ...response.state, requirements });
      localStorage.setItem('ohmx-ai-engineering-guest', JSON.stringify(requirements));
    }
    if (response.ui) setUi(response.ui);
    if (response.userContextDocument) setUserAssistantProfile(response.userContextDocument);
    if (response.selection) setSelection(response.selection);

    const hasGuidedQuestion = response.ui?.type === 'question_flow';
    if (response.reply) {
      if (hasGuidedQuestion) {
        setLastShortReply(response.reply.split('\n')[0].slice(0, 120));
      } else {
        pushMessage('assistant', response.reply);
      }
    }
  };

  const sendAnswer = async (field: string, value: unknown) => {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api<{
        conversationId?: string;
        reply: string;
        state?: AssistantState;
        selection?: SelectionResult;
        ui?: UIState;
      }>('/ai-engineering/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          message: '',
          answer: { field, value },
          intent: assistantState?.intent,
          currentRequirements: withPreferenceRequirements(assistantState?.requirements || {}),
          context: { language: 'ru', includeAccessories: accessoriesEnabled, userPreferences: profilePreferences },
          ...userContextPayload(),
        }),
      });
      applyChatResponse(response);
      setAiUnavailable(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('aiTools.errors.request');
      setError(message);
      setAiUnavailable(true);
    } finally {
      setLoading(false);
    }
  };

  const sendFormValues = async (intent: string, formValues: Record<string, unknown>) => {
    setLoading(true);
    setError('');
    try {
      const response = await api<{
        conversationId?: string;
        reply: string;
        state?: AssistantState;
        selection?: SelectionResult;
        ui?: UIState;
      }>('/ai-engineering/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          message: '',
          intent,
          formValues,
          currentRequirements: withPreferenceRequirements(assistantState?.requirements || {}),
          context: { language: 'ru', includeAccessories: formValues.includeAccessories !== false, userPreferences: profilePreferences },
          ...userContextPayload(),
        }),
      });
      applyChatResponse(response);
      setAccessoriesEnabled(formValues.includeAccessories !== false);
      setAiUnavailable(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('aiTools.errors.request');
      setError(message);
      setAiUnavailable(true);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmittedText(trimmed);
    setStarted(true);
    pushMessage('user', trimmed);
    setInput('');
    setLoading(true);
    setError('');
    try {
      const payload: {
        message: string;
        context: Record<string, unknown>;
        conversationId?: string;
        currentRequirements?: Record<string, unknown>;
        answer?: { field: string; value: unknown };
        userId?: string | null;
        userContextDocument?: UserAssistantProfile | null;
      } = {
        message: trimmed,
        context: { language: 'ru', includeAccessories: accessoriesEnabled, userPreferences: profilePreferences },
      };
      payload.currentRequirements = withPreferenceRequirements(assistantState?.requirements || {});
      if (conversationId) payload.conversationId = conversationId;
      Object.assign(payload, userContextPayload());
      const response = await api<{
        conversationId?: string;
        reply: string;
        state?: AssistantState;
        selection?: SelectionResult;
        ui?: UIState;
      }>('/ai-engineering/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      applyChatResponse(response);
      setAiUnavailable(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('aiTools.errors.request');
      setError(message);
      setAiUnavailable(true);
    } finally {
      setLoading(false);
    }
  };

  const submit = () => sendChatMessage(input);

  const startFromIntent = async (intent: string, label: string) => {
    setStarted(true);
    setSubmittedText(label);
    setLastShortReply('');
    setLoading(true);
    setError('');
    try {
      const response = await api<{
        conversationId?: string;
        reply: string;
        state?: AssistantState;
        selection?: SelectionResult;
        ui?: UIState;
      }>('/ai-engineering/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          message: '',
          startIntent: intent,
          context: { language: 'ru', includeAccessories: accessoriesEnabled, userPreferences: profilePreferences },
          ...userContextPayload(),
        }),
      });
      applyChatResponse(response);
      setAiUnavailable(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('aiTools.errors.request');
      setError(message);
      setAiUnavailable(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleAccessories = (enabled: boolean) => {
    setAccessoriesEnabled(enabled);
    setSelection((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        accessories: enabled ? prev.accessories : [],
        bundles: prev.bundles.map((bundle) => ({
          ...bundle,
          accessories: enabled ? bundle.accessories : [],
        })),
      };
    });
  };

  const addProductToCart = (product: Product) => {
    addToCart({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name, price: product.price ?? 0, image: product.image });
  };

  const printSelection = () => window.print();
  const copyLink = () => navigator.clipboard.writeText(window.location.href);

  const handleEmail = () => {
    if (!isAuthenticated) return navigate('/auth');
  };

  const handleManager = () => {
    if (!isAuthenticated) return navigate('/auth');
  };

  const currentQuestion = useMemo(() => {
    if (ui?.type === 'question_flow') return ui.question;
    return null;
  }, [ui]);

  const requirementsForm = useMemo(() => {
    if (ui?.type === 'requirements_form') return ui;
    return null;
  }, [ui]);

  const progressData = useMemo(() => {
    if (ui?.type === 'question_flow') {
      return { step: ui.currentStep, total: ui.totalSteps, percent: ui.progressPercent };
    }
    if (ui?.type === 'confirmation') {
      return { step: 6, total: 6, percent: 95 };
    }
    return null;
  }, [ui]);

  return (
    <div className="page space-y-4 pb-24">
      <div className="rounded-[28px] border border-line bg-card p-4 md:p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bolt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg-strong">{t('aiTools.title')}</h1>
            <p className="text-sm text-fg-muted">
              {t('aiTools.description')}
            </p>
          </div>
        </div>
        {aiUnavailable && !selection ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-3 text-sm text-fg-muted">
            {t('aiTools.unavailable')}
          </div>
        ) : null}
      </div>

      {progressData ? (
        <div className="rounded-[28px] border border-line bg-card p-4">
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>{t('aiTools.progress', { step: progressData.step, total: progressData.total })}</span>
            <span>{progressData.percent}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressData.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {!started && !currentQuestion && !selection ? (
        <div className="rounded-[28px] border border-line bg-card p-4">
          <div className="text-sm font-semibold text-fg-strong">{t('aiTools.startQuestion')}</div>
          <div className="mt-3 grid gap-2">
            {intentStartItems.map((item) => (
              <button
                key={item.value}
                onClick={() => startFromIntent(item.value, t(item.labelKey))}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-fg-strong transition"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {item.icon}
                </span>
                <span className="flex-1">{t(item.labelKey)}</span>
                <ChevronRight className="h-4 w-4 text-fg-muted" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {currentQuestion && !selection ? (
        <div className="space-y-2">
          {lastShortReply ? <div className="px-1 text-sm text-fg-muted">{lastShortReply}</div> : null}
          <QuestionCard
            ui={ui as UIQuestion}
            onAnswer={(field, value) => sendAnswer(field, value)}
            onSkip={
              currentQuestion.type === 'multi_choice' && currentQuestion.allowSkip
                ? async () => {
                    await sendAnswer(currentQuestion.field, []);
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)]">
        <div className="flex flex-col gap-3">
          <div className="rounded-[28px] border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-fg-faint">
              <Flame className="h-4 w-4" />
              {t('aiTools.chat.title')}
            </div>
            <div
              ref={chatRef}
              className="mt-3 max-h-[340px] space-y-2 overflow-y-auto sm:max-h-[420px]"
            >
              {messages.map((m) =>
                m.role === 'assistant' ? (
                  <ChatAssistantBubble key={m.id} message={m} />
                ) : (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[92%] rounded-3xl bg-primary px-4 py-3 text-sm leading-6 text-white">
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  </div>
                )
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder={t('aiTools.chat.placeholder')}
                className="flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm text-fg-strong outline-none"
              />
              <button
                onClick={submit}
                disabled={loading || !input.trim()}
                className="btn-primary disabled:opacity-60"
              >
                {loading ? '…' : t('common.actions.send')}
              </button>
            </div>
            {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
            {submittedText && !currentQuestion && !selection ? (
              <div className="mt-2 text-xs text-fg-muted">{t('aiTools.chat.processing')}</div>
            ) : null}
          </div>

          <div className="rounded-[28px] border border-line bg-card p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-fg-faint">
              <Snowflake className="h-4 w-4" />
              {t('aiTools.quick.title')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                t('aiTools.quick.noGas'),
                t('aiTools.quick.hasGas'),
                t('aiTools.quick.economy'),
                t('aiTools.quick.optimal'),
                t('aiTools.quick.premium'),
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => sendChatMessage(q)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {selection ? (
            <>
              <div className="rounded-[28px] border border-line bg-card p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.result.calculation')}</div>
                <div className="mt-2 text-sm font-semibold text-fg-strong">
                  {t('aiTools.result.requiredPower')}: {selection.requiredPowerKw} {t('common.units.kw')}
                </div>
                <div className="text-xs text-fg-muted">{t('common.labels.range')}: {selection.recommendedRange}</div>
                <div className="mt-2 text-xs text-fg-muted">
                  {t('common.labels.area')}: {selection.calculationDetails.area} {t('common.units.m2')} • {t('common.labels.height')}: {selection.calculationDetails.ceilingHeight} м
                </div>
                {selection.warnings?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-fg-muted">
                    {selection.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {selection.roomHeating ? (
                <div className="rounded-[28px] border border-line bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.result.roomProject')}</div>
                  <div className="mt-2 text-sm font-semibold text-fg-strong">{selection.roomHeating.title}</div>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{selection.roomHeating.baseRule}</p>
                  <div className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('calculator.warmFloor.review.totalArea')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.roomHeating.totalAreaM2} {t('common.units.m2')}</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('aiTools.result.totalPower')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.roomHeating.totalPowerKw} {t('common.units.kw')}</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('common.labels.equipment')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.roomHeating.equipmentCount} ед.</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('aiTools.result.estimatedCost')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{formatPrice(selection.bundles.find((bundle) => bundle.bundleType === 'optimal')?.estimatedTotal ?? null, undefined, t('common.fallbacks.priceRequest'), 'ru-RU')}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {selection.roomHeating.roomRecommendations.map((room) => (
                      <div key={room.id} className="rounded-2xl border border-line bg-surface p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-fg-strong">{room.label}</div>
                          <div className="rounded-full border border-line bg-card px-2 py-0.5 text-[11px] text-fg-muted">{room.areaM2} {t('common.units.m2')} • {room.requiredPowerKw} {t('common.units.kw')}</div>
                        </div>
                        <div className="mt-2 text-sm text-fg-strong">{room.recommendedEquipment}</div>
                        <div className="mt-1 text-xs text-fg-muted">{t('common.labels.power')}: {room.requiredPowerW} {t('common.units.w')} • {t('common.labels.quantity')}: {room.quantity}</div>
                        <p className="mt-2 text-xs leading-5 text-fg-muted">{room.explanation}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-xs leading-5 text-fg-muted">
                    <span className="font-semibold text-fg-strong">{t('aiTools.result.engineerRecommendation')}: </span>{selection.roomHeating.engineerRecommendation}
                  </div>
                </div>
              ) : null}

              {selection.floorHeating ? (
                <div className="rounded-[28px] border border-line bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.result.floorHeatingAnalysis')}</div>
                  <div className="mt-2 text-sm font-semibold text-fg-strong">{selection.floorHeating.recommendedSolution}</div>
                  <p className="mt-2 text-xs text-fg-muted">{selection.floorHeating.engineeringConclusion}</p>
                  <div className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('calculator.warmFloor.review.installArea')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.availableInstallAreaM2} {t('common.units.m2')}</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('aiTools.result.installedPower')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.selectedSystemPowerKw} {t('common.units.kw')}</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('calculator.warmFloor.catalogKits.density')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.specificPowerWm2} Вт/м²</div>
                    </div>
                    <div className="rounded-2xl border border-line bg-surface p-3">
                      <span className="text-fg-faint">{t('aiTools.result.powerCoverage')}</span>
                      <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.powerCoveragePercent}%</div>
                    </div>
                    {selection.floorHeating.cableSpacingCm ? (
                      <div className="rounded-2xl border border-line bg-surface p-3">
                        <span className="text-fg-faint">{t('calculator.warmFloor.installation.cableSpacing')}</span>
                        <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.cableSpacingCm} см</div>
                      </div>
                    ) : null}
                    {selection.floorHeating.mountingTapeRequiredWithReserveM ? (
                      <div className="rounded-2xl border border-line bg-surface p-3">
                        <span className="text-fg-faint">{t('calculator.warmFloor.installation.mountingTape')}</span>
                        <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.mountingTapeRequiredWithReserveM} м</div>
                      </div>
                    ) : null}
                    {selection.floorHeating.matAreaM2 ? (
                      <div className="rounded-2xl border border-line bg-surface p-3">
                        <span className="text-fg-faint">{t('calculator.warmFloor.installation.matArea')}</span>
                        <div className="text-sm font-semibold text-fg-strong">{selection.floorHeating.matAreaM2} {t('common.units.m2')}</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="rounded-[28px] border border-line bg-card p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.result.recommendedSystems')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selection.recommendedSystems.map((sys) => (
                    <span key={sys.systemType} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg-strong">
                      {sys.label} — {sys.reason}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-line bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('aiTools.result.bundles')}</div>
                    <p className="mt-1 text-xs text-fg-muted">{t('aiTools.result.bundleText')}</p>
                  </div>
                  <button
                    onClick={() => toggleAccessories(!accessoriesEnabled)}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    {accessoriesEnabled ? t('calculator.common.removeAccessories') : t('calculator.common.enableAccessories')}
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {selection.bundles
                    .sort((a, b) => (a.bundleType === 'optimal' ? -1 : b.bundleType === 'optimal' ? 1 : 0))
                    .map((bundle) => (
                      <BundleCard key={bundle.bundleType} bundle={bundle} onAddMain={(p) => addProductToCart(p)} />
                    ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-line bg-card p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('calculator.power.sections.mainEquipment')}</div>
                <div className="mt-3 space-y-2">
                  {selection.mainProducts.map((p) => (
                    <ProductRow key={p.id} product={p} onAdd={(product) => addProductToCart(product)} />
                  ))}
                </div>
              </div>

              {selection.accessories.length > 0 && accessoriesEnabled ? (
                <div className="rounded-[28px] border border-line bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-fg-faint">{t('calculator.common.accessories')}</div>
                  <div className="mt-3 space-y-2">
                    {selection.accessories.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-fg-strong">{p.name}</div>
                          <div className="text-xs text-fg-muted">{p.brand}</div>
                        </div>
                        <button onClick={() => addProductToCart(p)} className="btn-secondary px-2 py-1 text-xs">
                          {t('common.actions.addToCart')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <button disabled={!selection.mainProducts[0]} onClick={() => selection.mainProducts[0] && addProductToCart(selection.mainProducts[0])} className="btn-primary disabled:opacity-50">
                  {t('common.actions.addToCart')}
                </button>
                <button onClick={printSelection} className="btn-secondary">
                  {t('common.actions.printPdf')}
                </button>
                <button onClick={() => handleEmail()} className="btn-secondary">
                  {t('common.actions.toEmail')}
                </button>
                <button onClick={() => handleManager()} className="btn-secondary">
                  {t('common.actions.managerRequest')}
                </button>
                <button onClick={copyLink} className="btn-secondary sm:col-span-2">
                  {t('common.actions.copyLink')}
                </button>
              </div>
            </>
          ) : requirementsForm ? (
            <RequirementsFormCard ui={requirementsForm} loading={loading} onSubmit={sendFormValues} />
          ) : (
            <div className="rounded-[28px] border border-dashed border-line bg-surface p-4 text-sm text-fg-muted">
              {t('aiTools.empty')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

