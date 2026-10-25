import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useStore } from '../store/useStore';
import { Flame, Snowflake } from '../components/Icons';
import {
  CalculatorDocumentCard,
  CalculatorInfoNote,
  CalculatorSection,
  CalculatorSummaryCard,
  CalculatorSummaryCards,
  ProductRecommendationCard,
  type RecommendationProduct,
} from '../components/calculator/CalculatorDesign';

type Mode = 'cooling' | 'heating';
type EnergySource = 'gas' | 'electric';
type SystemType = 'gas_boiler' | 'electric_boiler' | 'heat_pump' | 'electric_convector' | 'floor_heating' | 'infrared_heating';
type HeatingType = 'water' | 'electric';
type AnimationPhase = 'idle' | 'analyzing' | 'matching' | 'done';

type CalcProduct = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article: string;
  powerKw?: number | null;
  price?: number | null;
  currency?: string;
  image?: string;
  availabilityStatus: 'in_stock' | 'low_stock' | 'preorder';
  availabilityLabel: string;
  preorderNote?: string;
  equipmentType?: string;
  systemType?: string;
};

type CalcResult = {
  requiredPowerKw: number;
  recommendedRange: string | { minKw: number; maxKw: number | null };
  mainProducts: CalcProduct[];
  accessories: CalcProduct[];
  heatingType?: HeatingType;
  hasGas?: boolean;
  resolvedSystem?: string | null;
  calculationDetails: {
    mode: Mode;
    roomAreaM2: number;
    area: number;
    ceilingHeightM: number;
    ceilingHeight: number;
    volumeM3: number;
    baseSpecificPowerWm3: number;
    basePowerKw: number;
    coefficient: number;
    correctionFactors: { key: string; coefficient: number }[];
    calculatedPowerKw: number;
    recommendedPowerRange: { minKw: number; maxKw: number | null };
    specificWm2: number;
    method: string;
    formula: string;
    selectedOptions: { key: string; coefficient: number }[];
    disclaimerCode: string;
  };
};

type RecommendationResult = {
  systemType: SystemType;
  energySource: EnergySource;
  mainProducts: CalcProduct[];
  accessories: CalcProduct[];
  notes: Array<string | { code: string; params?: Record<string, unknown> }>;
};

const coolingOptions = ['sunny_side', 'kitchen_heat', 'many_people', 'top_floor_poor_insulation', 'power_reserve'] as const;

const heatingOptions = ['poor_insulation', 'corner_room', 'first_last_floor', 'large_windows', 'power_reserve'] as const;

const electricSystems: { type: SystemType; icon: string }[] = [
  { type: 'electric_boiler', icon: '⚡' },
  { type: 'heat_pump', icon: '🌡️' },
  { type: 'electric_convector', icon: '▤' },
  { type: 'floor_heating', icon: '≈' },
  { type: 'infrared_heating', icon: '☀' },
];

function formatPrice(value: number | null | undefined, currency: string | undefined, requestLabel: string, locale: string) {
  if (!value) return requestLabel;
  return `${new Intl.NumberFormat(locale).format(value)} ${currency || 'AMD'}`;
}

function useCountUp(value: number, active: boolean, duration = 850) {
  const [display, setDisplay] = useState(active ? value : 0);
  useEffect(() => {
    if (!active) { setDisplay(0); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased * 100) / 100);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, active, duration]);
  return display.toFixed(2).replace('.00', '');
}

const POWER_CALCULATOR_DRAFT_KEY = 'ohmx:power-calculator:draft';

type PowerCalculatorDraft = {
  mode: Mode;
  area: string;
  height: string;
  options: string[];
  includeAccessories: boolean;
  result: CalcResult | null;
  recommendations: RecommendationResult | null;
  energySource: EnergySource | '';
  systemType: SystemType | '';
  pickedProducts: CalcProduct[];
  heatingType: HeatingType | '';
  hasGas: boolean | null;
  baseSignature?: string;
};

function buildPowerCalculatorBaseSignature(input: PowerCalculatorDraftInput) {
  return JSON.stringify([
    input.mode,
    input.area,
    input.height,
    input.options.join(','),
    input.heatingType || '',
    input.hasGas === null ? 'null' : String(input.hasGas),
  ]);
}

function hasMeaningfulPowerCalculatorDraft(input: PowerCalculatorDraftInput, result: CalcResult | null, recommendations: RecommendationResult | null, pickedProducts: CalcProduct[]) {
  return Boolean(
    result
    || recommendations
    || pickedProducts.length
    || input.mode !== 'cooling'
    || input.area !== '20'
    || input.height !== '2.7'
    || input.options.length
    || !input.includeAccessories
    || input.energySource
    || input.systemType
    || input.heatingType
    || input.hasGas !== null
  );
}

function buildPowerCalculatorDraftPayload(input: PowerCalculatorDraftInput, result: CalcResult | null, recommendations: RecommendationResult | null, pickedProducts: CalcProduct[], baseSignature: string): PowerCalculatorDraft {
  return {
    ...input,
    result,
    recommendations,
    pickedProducts,
    baseSignature,
  };
}

function readPowerCalculatorDraft(): Partial<PowerCalculatorDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(POWER_CALCULATOR_DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePowerCalculatorDraft(draft: PowerCalculatorDraft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(POWER_CALCULATOR_DRAFT_KEY, JSON.stringify(draft));
}

function clearPowerCalculatorDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(POWER_CALCULATOR_DRAFT_KEY);
}

type PowerCalculatorDraftInput = Pick<
  PowerCalculatorDraft,
  'mode' | 'area' | 'height' | 'options' | 'includeAccessories' | 'energySource' | 'systemType' | 'heatingType' | 'hasGas'
>;

function buildPowerCalculatorSignature(input: PowerCalculatorDraftInput) {
  return JSON.stringify([
    input.mode,
    input.area,
    input.height,
    input.options.join(','),
    input.includeAccessories ? '1' : '0',
    input.energySource || '',
    input.systemType || '',
    input.heatingType || '',
    input.hasGas === null ? 'null' : String(input.hasGas),
  ]);
}

function ProductRow({ product, accessory = false, onAdd, onPick }: { product: CalcProduct; accessory?: boolean; onAdd: (product: CalcProduct) => void; onPick: (product: CalcProduct) => void }) {
  const { t } = useTranslation();
  const badges = [
    product.powerKw ? `${product.powerKw} ${t('common.units.kw')}` : null,
  ].filter(Boolean) as string[];

  const localizedProduct = {
    ...product,
    availabilityLabel: product.availabilityStatus === 'in_stock'
      ? t('common.fallbacks.inStock')
      : product.availabilityStatus === 'low_stock'
        ? t('common.fallbacks.lowStock')
        : t('common.fallbacks.preorder'),
  };

  return (
    <ProductRecommendationCard
      product={localizedProduct as RecommendationProduct}
      accessory={accessory}
      badges={badges}
      onAdd={(item) => onAdd(item as CalcProduct)}
      onPick={(item) => onPick(item as CalcProduct)}
    />
  );
}

function SystemCard({ active, title, text, icon, onClick }: { active?: boolean; title: string; text: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`group rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-primary bg-primary/10 shadow-sm' : 'border-line bg-card'}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${active ? 'bg-primary text-white' : 'bg-card text-fg-soft'}`}>{icon}</span>
        <span>
          <span className="block text-base font-bold text-fg-strong">{title}</span>
          <span className="mt-1 block text-sm leading-5 text-fg-muted">{text}</span>
        </span>
      </div>
    </button>
  );
}

/** Large animated selection card for heating type (Water / Electric) */
function HeatingTypeCard({
  type,
  active,
  icon,
  title,
  text,
  onClick,
}: {
  type: HeatingType;
  active: boolean;
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-3 rounded-3xl border-2 p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
        active
          ? 'border-primary bg-primary/10 shadow-md ring-2 ring-primary/20'
          : 'border-line bg-card hover:border-line/80'
      }`}
    >
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl text-3xl transition-all duration-300 ${
          active
            ? 'bg-primary text-white shadow-lg shadow-primary/30 scale-110'
            : 'bg-card text-fg-muted'
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-fg-strong">{title}</div>
        <div className="mt-1 text-sm leading-5 text-fg-muted">{text}</div>
      </div>
    </button>
  );
}

export function PowerCalculatorPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addToCart = useStore((s) => s.addToCart);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const currentUser = useStore((s) => s.currentUser);
  const draft = useMemo(() => readPowerCalculatorDraft(), []);
  const hasQueryParams = useMemo(() => Array.from(params.keys()).length > 0, [params]);
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) || draft.mode || 'cooling');
  const [area, setArea] = useState(params.get('area') || draft.area || '20');
  const [height, setHeight] = useState(params.get('height') || draft.height || '2.7');
  const [options, setOptions] = useState<string[]>(params.get('options')?.split(',').filter(Boolean) || draft.options || []);
  const [includeAccessories, setIncludeAccessories] = useState(params.get('accessories') ? params.get('accessories') !== '0' : draft.includeAccessories ?? true);
  const [result, setResult] = useState<CalcResult | null>(hasQueryParams ? null : draft.result || null);
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(hasQueryParams ? null : draft.recommendations || null);
  const [energySource, setEnergySource] = useState<EnergySource | ''>((params.get('energy') as EnergySource) || draft.energySource || '');
  const [systemType, setSystemType] = useState<SystemType | ''>((params.get('system') as SystemType) || draft.systemType || '');
  const [pickedProducts, setPickedProducts] = useState<CalcProduct[]>(hasQueryParams ? [] : draft.pickedProducts || []);
  const [loading, setLoading] = useState(false);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [phase, setPhase] = useState<AnimationPhase>((hasQueryParams ? null : draft.result) ? 'done' : 'idle');
  const [error, setError] = useState('');

  // NEW: heating-specific state
  const [heatingType, setHeatingType] = useState<HeatingType | ''>((params.get('heatingType') as HeatingType) || draft.heatingType || '');
  const [hasGas, setHasGas] = useState<boolean | null>(params.get('hasGas') === 'true' ? true : params.get('hasGas') === 'false' ? false : draft.hasGas ?? null);

  const resultRef = useRef<HTMLDivElement | null>(null);
  const optionList = (mode === 'cooling' ? coolingOptions : heatingOptions).map((key) => [key, t(`calculator.power.options.${mode}.${key}`)] as [string, string]);
  const getSystemLabel = (type: SystemType | string) => t(`calculator.power.systems.${type}.label`, { defaultValue: type });
  const formatCalculatorPrice = (value?: number | null, currency?: string) => formatPrice(value, currency, t('common.fallbacks.priceRequest'), i18n.language);
  const formatRange = (value: CalcResult | null | undefined) => {
    if (!value) return '';
    const range = value.calculationDetails?.recommendedPowerRange || (typeof value.recommendedRange === 'object' ? value.recommendedRange : null);
    if (!range) return String(value.recommendedRange || '');
    return range.maxKw == null
      ? t('calculator.power.result.rangeAbove', { min: range.minKw })
      : t('calculator.power.result.rangeBetween', { min: range.minKw, max: range.maxKw });
  };
  const translateNote = (note: string | { code: string; params?: Record<string, unknown> }) => {
    if (typeof note === 'string') return note;
    const params = { ...(note.params || {}) } as Record<string, unknown>;
    if (typeof params.systemType === 'string') params.system = getSystemLabel(params.systemType);
    return t(note.code, { ...params, defaultValue: note.code });
  };
  const countPower = useCountUp(result?.requiredPowerKw || 0, phase === 'done' && !!result);

  const selectionUrl = useMemo(() => {
    const query = new URLSearchParams({ mode, area, height, accessories: includeAccessories ? '1' : '0' });
    if (options.length) query.set('options', options.join(','));
    if (heatingType) query.set('heatingType', heatingType);
    if (hasGas !== null) query.set('hasGas', hasGas ? 'true' : 'false');
    if (energySource) query.set('energy', energySource);
    if (systemType) query.set('system', systemType);
    return `/tools/power-calculator?${query.toString()}`;
  }, [mode, area, height, includeAccessories, options, heatingType, hasGas, energySource, systemType]);

  const currentDraftInput = useMemo<PowerCalculatorDraftInput>(() => ({
    mode,
    area,
    height,
    options,
    includeAccessories,
    energySource,
    systemType,
    heatingType,
    hasGas,
  }), [mode, area, height, options, includeAccessories, energySource, systemType, heatingType, hasGas]);
  const currentBaseSignature = useMemo(() => buildPowerCalculatorBaseSignature(currentDraftInput), [currentDraftInput]);
  const isResultStale = Boolean(result && draft.baseSignature && draft.baseSignature !== currentBaseSignature);
  const visibleResult = isResultStale ? null : result;
  const visibleRecommendations = isResultStale ? null : recommendations;
  const visiblePickedProducts = isResultStale ? [] : pickedProducts;

  useEffect(() => {
    if (isResultStale) {
      setResult(null);
      setRecommendations(null);
      setPickedProducts([]);
      setPhase('idle');
    }
  }, [isResultStale]);

  const resetPowerCalculator = () => {
    clearPowerCalculatorDraft();
    setMode('cooling');
    setArea('20');
    setHeight('2.7');
    setOptions([]);
    setIncludeAccessories(true);
    setResult(null);
    setRecommendations(null);
    setEnergySource('');
    setSystemType('');
    setPickedProducts([]);
    setHeatingType('');
    setHasGas(null);
    setPhase('idle');
    setError('');
    setLoading(false);
    setRecommendationLoading(false);
    setEmailSending(false);
  };

  useEffect(() => {
    if (!hasMeaningfulPowerCalculatorDraft(currentDraftInput, result, recommendations, pickedProducts)) {
      clearPowerCalculatorDraft();
      return;
    }
    writePowerCalculatorDraft(buildPowerCalculatorDraftPayload(currentDraftInput, result, recommendations, pickedProducts, currentBaseSignature));
  }, [currentBaseSignature, currentDraftInput, result, recommendations, pickedProducts]);

  const calculate = async (animate = true) => {
    // Auth guard — stop calculation if not registered
    if (!isAuthenticated) {
      navigate('/auth?redirect=/tools/power-calculator');
      return;
    }

    setLoading(true);
    setError('');
    setRecommendations(null);
    if (animate) {
      setPhase('analyzing');
      setTimeout(() => setPhase('matching'), 650);
    }
    try {
      const body: any = { mode, area: Number(area), ceilingHeight: Number(height), options, includeAccessories };
      // Pass heating-specific params if in heating mode and type selected
      if (mode === 'heating' && heatingType) {
        body.heatingType = heatingType;
        body.hasGas = hasGas === true;
      }
      const [data] = await Promise.all([
        api<CalcResult>('/tools/power-calculator', { method: 'POST', body: JSON.stringify(body) }),
        animate ? new Promise((resolve) => setTimeout(resolve, 1250)) : Promise.resolve(),
      ]);
      setResult(data);
      setPhase('done');
      window.history.replaceState(null, '', selectionUrl);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch {
      setError(t('calculator.power.errors.calculate'));
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const requestRecommendations = async (source: EnergySource, nextSystem: SystemType) => {
    if (!result) return;
    setEnergySource(source);
    setSystemType(nextSystem);
    setRecommendationLoading(true);
    setError('');
    try {
      const data = await api<RecommendationResult>('/tools/power-calculator/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          area: Number(area),
          ceilingHeight: Number(height),
          requiredPowerKw: result.requiredPowerKw,
          energySource: source,
          systemType: nextSystem,
          includeAccessories,
        }),
      });
      setRecommendations(data);
      window.history.replaceState(null, '', `/tools/power-calculator?${new URLSearchParams({ mode, area, height, accessories: includeAccessories ? '1' : '0', ...(options.length ? { options: options.join(',') } : {}), ...(heatingType ? { heatingType } : {}), ...(hasGas !== null ? { hasGas: hasGas ? 'true' : 'false' } : {}), energy: source, system: nextSystem }).toString()}`);
    } catch {
      setError(t('calculator.power.errors.recommendations'));
    } finally {
      setRecommendationLoading(false);
    }
  };

  useEffect(() => {
    if (result && !hasQueryParams) return;
    calculate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (result && energySource && systemType) requestRecommendations(energySource, systemType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeAccessories]);

  const toggleOption = (key: string) => setOptions((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  const addProductToCart = (product: CalcProduct) => addToCart({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name, price: product.price || 0, image: product.image });
  const pickProduct = (product: CalcProduct) => setPickedProducts((prev) => prev.some((item) => item.id === product.id) ? prev : [...prev, product]);
  const currentMainProducts = recommendations?.mainProducts || result?.mainProducts || [];
  const currentAccessories = includeAccessories ? (recommendations?.accessories || result?.accessories || []) : [];
  const addSelectionToCart = () => {
    if (!result) return;
    const products = pickedProducts.length ? pickedProducts : [...currentMainProducts.slice(0, 1), ...currentAccessories];
    products.forEach(addProductToCart);
    navigate('/cart');
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${selectionUrl}`);
    alert(t('calculator.power.alerts.linkCopied'));
  };
  const managerRequest = () => {
    const systemText = systemType ? `, ${t('common.labels.system').toLowerCase()}: ${getSystemLabel(systemType as SystemType)}` : '';
    const modeText = mode === 'cooling' ? t('calculator.power.modes.cooling.genitive') : t('calculator.power.modes.heating.genitive');
    const intent = result ? `${t('calculator.power.manager.intentPrefix')} ${modeText}: ${area} ${t('common.units.m2')}, ${height} ${t('common.units.m')}, ${result.requiredPowerKw} ${t('common.units.kw')}, ${t('common.labels.range').toLowerCase()} ${formatRange(result)}${systemText}` : t('calculator.power.manager.defaultIntent');
    navigate(`/contacts?intent=${encodeURIComponent(intent)}`);
  };
  const sendEmail = async () => {
    if (!currentUser?.email) {
      alert(t('calculator.power.alerts.emailRequired'));
      return;
    }
    const systemText = systemType ? `${t('common.labels.system')}: ${getSystemLabel(systemType as SystemType)}` : t('calculator.power.email.systemNotSelected');
    const modeText = mode === 'cooling' ? t('calculator.power.modes.cooling.genitive') : t('calculator.power.modes.heating.genitive');
    const productLinesHtml = currentMainProducts.map((p) =>
      `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px 4px">${p.image ? `<img src="${p.image}" width="48" height="48" style="object-fit:contain;border-radius:6px" />` : ''}</td><td style="padding:8px 4px"><b>${p.name}</b><br/><span style="color:#6b7280;font-size:12px">${p.brand} · ${t('common.labels.article')} ${p.article || p.sku}</span></td><td style="padding:8px 4px;text-align:right;white-space:nowrap">${p.powerKw ? `${p.powerKw} ${t('common.units.kw')}` : ''}</td><td style="padding:8px 4px;text-align:right;font-weight:600;white-space:nowrap">${formatCalculatorPrice(p.price, p.currency)}</td></tr>`
    ).join('\n');
    const accessoryLinesHtml = includeAccessories && currentAccessories.length
      ? `<h3 style="margin-top:20px;font-size:14px;color:#6b7280">${t('calculator.common.accessories')}</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${currentAccessories.map((p) =>
          `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:6px 4px">${p.image ? `<img src="${p.image}" width="40" height="40" style="object-fit:contain;border-radius:4px" />` : ''}</td><td style="padding:6px 4px"><b>${p.name}</b><br/><span style="color:#9ca3af;font-size:11px">${p.brand}</span></td><td style="padding:6px 4px;text-align:right;font-weight:600;white-space:nowrap">${formatCalculatorPrice(p.price, p.currency)}</td></tr>`
        ).join('\n')}</table>`
      : '';
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Inter,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1f2937">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #d63a3b;margin-bottom:24px">
        <h1 style="font-size:20px;margin:0;color:#111827">OhmX.am</h1>
        <p style="margin:4px 0 0;color:#6b7280;font-size:13px">ENGINEERING EQUIPMENT</p>
      </div>
      <h2 style="font-size:18px;margin:0 0 16px">${t('calculator.power.email.selectionTitle')} ${modeText}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
        <tr><td style="padding:4px 0;color:#6b7280">${t('calculator.power.email.areaHeight')}</td><td style="padding:4px 0;text-align:right;font-weight:600">${area} ${t('common.units.m2')} · ${height} ${t('common.units.m')}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">${t('calculator.power.email.requiredPower')}</td><td style="padding:4px 0;text-align:right;font-weight:600">${result?.requiredPowerKw || '?'} ${t('common.units.kw')}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">${t('common.labels.range')}</td><td style="padding:4px 0;text-align:right;font-weight:600">${formatRange(result)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">${systemText.split(':')[0]}</td><td style="padding:4px 0;text-align:right;font-weight:600">${systemText.split(':')[1] || systemText}</td></tr>
      </table>
      <h3 style="font-size:14px;color:#6b7280;margin-bottom:8px">${t('common.labels.equipment')}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${productLinesHtml}</table>
      ${accessoryLinesHtml}
      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
        <a href="${window.location.origin}${selectionUrl}" style="color:#d63a3b">${t('calculator.power.email.openOnSite')}</a><br/>
        OhmX.am — ${t('calculator.power.email.engineeringEquipment')}
      </p>
    </body></html>`;
    const textBody = `${t('calculator.power.email.selectionTitle')} ${modeText}\n\n${t('common.labels.area')}: ${area} ${t('common.units.m2')}\n${t('common.labels.height')}: ${height} ${t('common.units.m')}\n${t('common.labels.power')}: ${result?.requiredPowerKw || '?'} ${t('common.units.kw')}\n${t('common.labels.range')}: ${formatRange(result)}\n${systemText}\n\n${t('common.labels.link')}: ${window.location.origin}${selectionUrl}`;
    try {
      setEmailSending(true);
      const resp = await api('/tools/power-calculator/email', {
        method: 'POST',
        body: JSON.stringify({ email: currentUser.email, subject: `${t('calculator.power.email.subjectPrefix')} ${modeText} — OhmX.am`, htmlBody, textBody }),
      });
      if ((resp as any)?.ok) {
        alert(t('calculator.power.alerts.emailSent'));
      } else {
        alert(t('calculator.power.alerts.emailError') + ': ' + t('calculator.power.alerts.smtpNotConfigured'));
      }
    } catch {
      alert(t('calculator.power.alerts.emailError') + ': ' + t('calculator.power.alerts.networkError'));
    } finally {
      setEmailSending(false);
    }
  };

  const handleHeatingTypeSelect = (type: HeatingType) => {
    setHeatingType(type);
    setHasGas(null); // reset gas choice when switching
    setSystemType('');
    setEnergySource('');
    setRecommendations(null);
  };

  return (
    <div className="page space-y-6" style={{ paddingBottom: '8rem' }}>
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('common.labels.tools'), to: '/tools' }, { label: t('calculator.power.breadcrumb') }]} />
      <section className="rounded-[28px] bg-surface p-5 shadow-sm ring-1 ring-line md:p-8">
        <div className="section-caption">{t('calculator.power.caption')}</div>
        <h1 className="mt-2 text-3xl font-bold text-fg-strong md:text-4xl">{t('calculator.power.title')}</h1>
        <p className="mt-3 max-w-3xl text-fg-muted">{t('calculator.power.description')}</p>
      </section>

      {!isAuthenticated ? (
        <section className="panel overflow-hidden p-0">
          <div className="bg-gradient-to-r from-primary/10 to-transparent p-8 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/20 text-4xl">🔒</div>
            <h2 className="text-2xl font-bold text-fg-strong">{t('calculator.power.authRequired.title')}</h2>
            <p className="mt-3 mx-auto max-w-lg text-fg-muted">{t('calculator.power.authRequired.text')}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/auth?redirect=/tools/power-calculator" className="btn-primary inline-flex items-center gap-2 px-8 py-4 text-base">
                {t('common.actions.register')}
              </Link>
              <Link to="/auth?redirect=/tools/power-calculator" className="btn-secondary inline-flex items-center gap-2 px-8 py-4 text-base">
                {t('common.actions.login')}
              </Link>
            </div>
          </div>
        </section>
      ) : (currentUser && !currentUser.email) ? (
        <section className="panel p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/20 text-2xl">✉️</div>
            <div>
              <h3 className="font-bold text-fg-strong">{t('calculator.power.emailRequired.title')}</h3>
              <p className="mt-1 text-sm text-fg-muted">{t('calculator.power.emailRequired.text')}</p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <section className="panel h-fit p-5">
          <h2 className="text-xl font-bold text-fg-strong">{t('calculator.power.form.roomData')}</h2>

          {/* Mode Toggle */}
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-card p-1">
            <button
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
                mode === 'cooling' ? 'bg-surface text-primary shadow' : 'text-fg-muted'
              }`}
              onClick={() => { setMode('cooling'); setHeatingType(''); setHasGas(null); setOptions([]); setEnergySource(''); setSystemType(''); setResult(null); setPhase('idle'); setRecommendations(null); }}
            >
              <Snowflake className={`h-5 w-5 ${mode === 'cooling' ? 'text-primary' : 'text-fg-muted'}`} />
              {t('calculator.power.modes.cooling.label')}
            </button>
            <button
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
                mode === 'heating' ? 'bg-surface text-primary shadow' : 'text-fg-muted'
              }`}
              onClick={() => { setMode('heating'); setOptions([]); setEnergySource(''); setSystemType(''); setResult(null); setPhase('idle'); setRecommendations(null); }}
            >
              <Flame className={`h-5 w-5 ${mode === 'heating' ? 'text-primary' : 'text-fg-muted'}`} />
              {t('calculator.power.modes.heating.label')}
            </button>
          </div>

          {/* NEW: Inline heating type selection — appears magically when heating is selected */}
          {mode === 'heating' && (
            <div className="mt-4 animate-[fadeSlideUp_0.4s_ease-out]">
              <div className="section-caption mb-3">{t('calculator.power.form.heatingType')}</div>
              <div className="grid grid-cols-2 gap-3">
                <HeatingTypeCard
                  type="water"
                  active={heatingType === 'water'}
                  icon={<span>🔥</span>}
                  title={t('calculator.power.heatingTypes.water.title')}
                  text={t('calculator.power.heatingTypes.water.text')}
                  onClick={() => handleHeatingTypeSelect('water')}
                />
                <HeatingTypeCard
                  type="electric"
                  active={heatingType === 'electric'}
                  icon={<span>⚡</span>}
                  title={t('calculator.power.heatingTypes.electric.title')}
                  text={t('calculator.power.heatingTypes.electric.text')}
                  onClick={() => handleHeatingTypeSelect('electric')}
                />
              </div>

              {/* Gas availability — mandatory for water heating */}
              {heatingType === 'water' && (
                <div className="mt-3 animate-[fadeSlideUp_0.3s_ease-out]">
                  <div className="section-caption mb-2">{t('calculator.power.form.gasAvailability')} *</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHasGas(true)}
                      className={`flex-1 rounded-2xl border-2 p-4 text-center font-semibold transition-all duration-200 ${
                        hasGas === true
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-line bg-card text-fg-muted hover:border-line/80'
                      }`}
                    >
                      <div className="text-2xl">🔥</div>
                      <div className="mt-1">{t('calculator.power.form.hasGas')}</div>
                    </button>
                    <button
                      onClick={() => setHasGas(false)}
                      className={`flex-1 rounded-2xl border-2 p-4 text-center font-semibold transition-all duration-200 ${
                        hasGas === false
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-line bg-card text-fg-muted hover:border-line/80'
                      }`}
                    >
                      <div className="text-2xl">⚡</div>
                      <div className="mt-1">{t('calculator.power.form.noGas')}</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Electric sub-types — show when electric heating selected */}
              {heatingType === 'electric' && (
                <div className="mt-3 animate-[fadeSlideUp_0.3s_ease-out] space-y-2">
                  <div className="section-caption mb-2">{t('calculator.power.form.systemType')}</div>
                  {electricSystems.map((item) => (
                    <SystemCard
                      key={item.type}
                      active={systemType === item.type}
                      title={t(`calculator.power.systems.${item.type}.label`)}
                      text={t(`calculator.power.systems.${item.type}.text`)}
                      icon={item.icon}
                      onClick={async () => {
                        setSystemType(item.type);
                        setEnergySource('electric');
                        // If we already have a result, re-calculate with this system type
                        if (result) {
                          setRecommendationLoading(true);
                          try {
                            const data = await api<RecommendationResult>('/tools/power-calculator/recommendations', {
                              method: 'POST',
                              body: JSON.stringify({
                                mode,
                                area: Number(area),
                                ceilingHeight: Number(height),
                                requiredPowerKw: result.requiredPowerKw,
                                energySource: 'electric',
                                systemType: item.type,
                                includeAccessories,
                              }),
                            });
                            setRecommendations(data);
                          } catch {
                            setError(t('calculator.power.errors.recommendations'));
                          } finally {
                            setRecommendationLoading(false);
                          }
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Area & Height fields */}
          <label className="mt-4 block text-sm font-semibold text-fg-soft">{t('calculator.power.form.area')}</label>
          <input className="field mt-2" type="number" min="1" value={area} onChange={(e) => setArea(e.target.value)} required />
          <label className="mt-4 block text-sm font-semibold text-fg-soft">{t('calculator.power.form.height')}</label>
          <input className="field mt-2" type="number" min="1" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} required />

          {/* Additional options */}
          <details className="mt-4 rounded-2xl border border-line bg-card p-4">
            <summary className="cursor-pointer font-semibold text-fg">{t('common.labels.advanced')}</summary>
            <div className="mt-3 space-y-2">
              {optionList.map(([key, label]) => (
                <label key={key} className="flex items-start gap-3 rounded-xl bg-surface p-3 text-sm text-fg-soft">
                  <input type="checkbox" className="mt-1" checked={options.includes(key)} onChange={() => toggleOption(key)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>

          {/* Accessories checkbox */}
          <label className="mt-4 flex items-center gap-3 rounded-2xl border border-line p-4 text-sm font-semibold text-fg">
            <input type="checkbox" checked={includeAccessories} onChange={(e) => setIncludeAccessories(e.target.checked)} />
            {t('calculator.common.addAccessories')}
          </label>

          {/* Calculate button */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              className="btn-primary w-full justify-center py-4 text-base"
              onClick={() => calculate(true)}
              disabled={loading}
            >
              {loading ? t('calculator.power.actions.calculating') : t('calculator.power.actions.calculate')}
            </button>
            <button
              className="btn-secondary w-full justify-center py-4 text-base"
              onClick={resetPowerCalculator}
            >
              {t('common.actions.reset')}
            </button>
          </div>
          {error ? <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        </section>

        {/* Results section */}
        <section ref={resultRef} className="space-y-5 scroll-mt-24">
          {phase === 'analyzing' || phase === 'matching' ? (
            <div className="overflow-hidden rounded-[28px] border border-primary/20 bg-surface p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-3xl text-primary">
                  <span className="animate-pulse text-4xl">{phase === 'analyzing' ? '🔍' : '⚡'}</span>
                  <span className="absolute inset-0 rounded-3xl border-2 border-primary/30 animate-ping" />
                </div>
                <div>
                  <div className="section-caption">{t('calculator.power.analysis.caption')}</div>
                  <div className="mt-1 text-2xl font-bold text-fg-strong">{phase === 'analyzing' ? t('calculator.power.analysis.analyzing') : t('calculator.power.analysis.matching')}</div>
                  <div className="mt-3 h-2 w-56 overflow-hidden rounded-full bg-card"><div className="h-full w-2/3 rounded-full bg-primary transition-all animate-pulse" /></div>
                </div>
              </div>
            </div>
          ) : null}

          {visibleResult && phase === 'done' ? (
            <>
              {/* BIG animated result cards */}
              <CalculatorSummaryCards>
                <CalculatorSummaryCard label={t('common.labels.power')} accent value={<>{countPower} <span className="text-3xl sm:text-4xl">{t('common.units.kw')}</span></>} />
                <CalculatorSummaryCard label={t('common.labels.range')} delayClassName="ohmx-result-card--delay-1" value={<span className="text-3xl">{formatRange(visibleResult)}</span>} />
                <CalculatorSummaryCard label={t('calculator.power.result.volumeCoefficient')} delayClassName="ohmx-result-card--delay-2" value={<span className="text-3xl">{visibleResult ? `${visibleResult.calculationDetails.volumeM3} ${t('common.units.m3')} · ×${visibleResult.calculationDetails.coefficient}` : ''}</span>} />
              </CalculatorSummaryCards>

              {/* Inline system info for heating */}
              {mode === 'heating' && visibleResult!.heatingType && (
                <CalculatorInfoNote>
                  <strong>{t('calculator.power.form.heatingType')}:</strong> {visibleResult!.heatingType === 'water' ? t('calculator.power.heatingTypes.water.title') : t('calculator.power.heatingTypes.electric.title')}
                  {visibleResult!.hasGas !== undefined ? <span>, <strong>{t('common.labels.gas')}:</strong> {visibleResult!.hasGas ? t('calculator.power.form.hasGas') : t('calculator.power.form.noGas')}</span> : null}
                  {visibleResult!.resolvedSystem ? <span>, <strong>{t('common.labels.system')}:</strong> {visibleResult!.resolvedSystem ? getSystemLabel(visibleResult!.resolvedSystem) : ''}</span> : null}
                </CalculatorInfoNote>
              )}

              <CalculatorInfoNote>
                {t('calculator.power.result.explanation', {
                  volume: visibleResult.calculationDetails.volumeM3,
                  baseSpecificPower: visibleResult.calculationDetails.baseSpecificPowerWm3,
                  basePower: visibleResult.calculationDetails.basePowerKw,
                  coefficient: visibleResult.calculationDetails.coefficient,
                  power: visibleResult.calculationDetails.calculatedPowerKw,
                  range: formatRange(visibleResult),
                })}
              </CalculatorInfoNote>
              <CalculatorInfoNote>
                {t(visibleResult.calculationDetails.disclaimerCode || 'calculator.power.result.engineeringDisclaimer')}
              </CalculatorInfoNote>

              {/* Next step — only show if electric mode without sub-type selected or cooling */}
              {mode === 'cooling' && (
                <div className="panel p-5">
                  <div className="section-caption">{t('calculator.power.nextStep.caption')}</div>
                  <h2 className="mt-1 text-2xl font-bold text-fg-strong">{t('calculator.power.nextStep.title')}</h2>
                  <p className="mt-2 text-sm text-fg-muted">{t('calculator.power.nextStep.text')}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SystemCard active={energySource === 'gas'} title={t('calculator.power.form.hasGas')} text={t('calculator.power.nextStep.gasText')} icon="🔥" onClick={() => requestRecommendations('gas', 'gas_boiler')} />
                    <SystemCard active={energySource === 'electric'} title={t('calculator.power.nextStep.electricOnly')} text={t('calculator.power.nextStep.electricText')} icon="⚡" onClick={() => { setEnergySource('electric'); setSystemType(''); setRecommendations(null); }} />
                  </div>
                  {energySource === 'electric' ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {electricSystems.map((item) => <SystemCard key={item.type} active={systemType === item.type} title={t(`calculator.power.systems.${item.type}.label`)} text={t(`calculator.power.systems.${item.type}.text`)} icon={item.icon} onClick={() => requestRecommendations('electric', item.type)} />)}
                    </div>
                  ) : null}
                  {recommendationLoading ? <div className="mt-4 rounded-2xl bg-card p-4 text-sm font-semibold text-fg-muted">{t('calculator.power.nextStep.loading')}</div> : null}
                  {/* Email button next to system options */}
                  {currentUser?.email && (
                    <div className="mt-4 flex items-center justify-between rounded-2xl border border-line bg-card p-3">
                      <span className="text-sm text-fg-muted">✉️ {t('calculator.power.email.getByEmail')}</span>
                      <button className="btn-primary px-4 py-2 text-sm" onClick={sendEmail} disabled={emailSending}>
                        {emailSending ? t('common.actions.sending') : t('calculator.power.email.sendTo', { email: currentUser.email })}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Selection document */}
              <CalculatorDocumentCard
                id="power-selection-document"
                title={t('calculator.power.document.title')}
                actions={<>
                  <button className="btn-secondary" onClick={() => window.print()}>{t('common.actions.downloadPdf')}</button>
                  <button className="btn-secondary" onClick={copyLink}>{t('common.actions.copyLink')}</button>
                  <button className="btn-secondary" onClick={managerRequest}>{t('common.actions.managerRequest')}</button>
                  {currentUser?.email ? <button className="btn-secondary" onClick={sendEmail} disabled={emailSending}>{emailSending ? t('common.actions.sending') : t('common.actions.toEmail')}</button> : null}
                  <button className="btn-primary" onClick={addSelectionToCart}>{t('common.actions.addToCart')}</button>
                </>}
              >
                <div>{t('calculator.power.document.calculationType')}: <b>{mode === 'cooling' ? t('calculator.power.modes.cooling.label') : t('calculator.power.modes.heating.label')}</b></div>
                <div>{t('calculator.power.email.areaHeight')}: <b>{area} {t('common.units.m2')} · {height} {t('common.units.m')}</b></div>
                <div>{t('common.labels.power')}: <b>{visibleResult.requiredPowerKw} {t('common.units.kw')}</b></div>
                <div>{t('common.labels.range')}: <b>{formatRange(visibleResult)}</b></div>
                <div>{t('common.labels.system')}: <b>{systemType ? getSystemLabel(systemType as SystemType) : (visibleResult.resolvedSystem ? getSystemLabel(visibleResult.resolvedSystem) : t('common.fallbacks.notSelectedYet'))}</b></div>
                <div>{t('calculator.power.document.inSelection')}: <b>{visiblePickedProducts.length ? t('calculator.power.document.productsCount', { count: visiblePickedProducts.length }) : t('calculator.power.document.autoKit')}</b></div>
                <div className="sm:col-span-2">{t('calculator.power.document.extraParameters')}: <b>{visibleResult.calculationDetails.selectedOptions.map((item) => t(`calculator.power.options.${mode}.${item.key}`, { defaultValue: item.key })).join(', ') || t('common.fallbacks.notSelected')}</b></div>
                {mode === 'heating' && visibleResult.heatingType ? <>
                  <div>{t('calculator.power.form.heatingType')}: <b>{visibleResult.heatingType === 'water' ? t('calculator.power.heatingTypes.water.title') : t('calculator.power.heatingTypes.electric.title')}</b></div>
                  {visibleResult.hasGas !== undefined ? <div>{t('common.labels.gas')}: <b>{visibleResult.hasGas ? t('calculator.power.form.hasGas') : t('calculator.power.form.noGas')}</b></div> : null}
                </> : null}
                {visibleRecommendations?.notes?.length ? <div className="space-y-1 text-sm text-fg-muted sm:col-span-2">{visibleRecommendations.notes.map((note, index) => <div key={`${typeof note === 'string' ? note : note.code}-${index}`}>• {translateNote(note)}</div>)}</div> : null}
              </CalculatorDocumentCard>

              {/* Send to email */}
              {currentUser?.email && (
                <div className="panel p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xl">✉️</div>
                      <div>
                        <div className="font-semibold text-fg-strong">{t('calculator.power.email.sendTitle')}</div>
                        <div className="text-sm text-fg-muted">{currentUser.email}</div>
                      </div>
                    </div>
                    <button className="btn-primary px-6 py-3" onClick={sendEmail} disabled={emailSending}>
                      {emailSending ? t('common.actions.sending') : t('common.actions.send')}
                    </button>
                  </div>
                </div>
              )}

              {/* Products */}
              <CalculatorSection title={recommendations ? t('calculator.power.sections.recommendedEquipment') : t('calculator.power.sections.mainEquipment')}>
                {currentMainProducts.length ? currentMainProducts.map((product) => <ProductRow key={product.id} product={product} onAdd={addProductToCart} onPick={pickProduct} />) : <div className="panel p-5 text-fg-muted">{t('calculator.power.empty.noProducts')}</div>}
              </CalculatorSection>
              {includeAccessories ? (
                <CalculatorSection title={t('calculator.common.accessories')}  action={<button className="btn-secondary" onClick={() => setIncludeAccessories(false)}>{t('calculator.common.removeAccessories')}</button>}>
                  {currentAccessories.length ? currentAccessories.map((product) => <ProductRow key={product.id} product={product} accessory onAdd={addProductToCart} onPick={pickProduct} />) : <div className="panel p-5 text-fg-muted">{t('calculator.power.empty.noAccessories')}</div>}
                </CalculatorSection>
              ) : null}
            </>
          ) : phase === 'idle' && isAuthenticated ? (
            <div className="panel p-8 text-fg-muted">
              {mode === 'heating' && !heatingType
                ? t('calculator.power.empty.selectHeatingType')
                : t('calculator.power.empty.fillForm')}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}