import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { getLocalizedCategoryName } from '../data/catalogExperience';
import { normalizeLanguage } from '../i18n/types';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ArrowLeft, Check, Document, Star } from '../components/Icons';
import { availabilityTone, buildInquiryPath } from '../lib/availability';
import { getDisplaySeriesName, getSeriesSlug } from '../lib/series';
import { useStore } from '../store/useStore';
import { ManagedImage } from '../components/ManagedImage';
import { PinButton } from '../components/PinButton';
import { RichTextBlock } from '../components/RichTextBlock';
import { QuantitySelector } from '../components/QuantitySelector';
import { ProductColorVariants, ProductSeriesKit } from '../components/ProductSeriesKit';
import {
  CompatibilityWarning,
  ProductPageApiResponse,
  PublicProductSummary,
  RelatedProductGroups,
  RelatedProductItem,
  SeriesKitItem,
  emptyRelatedProductGroups,
} from '../types/ProductRelationships';

const RELATION_COPY = {
  required: {
    titleKey: 'product.relationships.required.title',
    badgeKey: 'product.relationships.required.badge',
    descriptionKey: 'product.relationships.required.description',
    badgeClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  recommended: {
    titleKey: 'product.relationships.recommended.title',
    badgeKey: 'product.relationships.recommended.badge',
    descriptionKey: 'product.relationships.recommended.description',
    badgeClass: 'border-ok/30 bg-ok/10 text-ok',
  },
  optional: {
    titleKey: 'product.relationships.optional.title',
    badgeKey: 'product.relationships.optional.badge',
    descriptionKey: 'product.relationships.optional.description',
    badgeClass: 'border-line bg-card text-fg-soft',
  },
  alternatives: {
    titleKey: 'product.relationships.alternatives.title',
    badgeKey: 'product.relationships.alternatives.badge',
    descriptionKey: 'product.relationships.alternatives.description',
    badgeClass: 'border-warn/40 bg-warn/10 text-warn',
  },
} as const;

const STATUS_LABEL_KEYS: Record<string, string> = {
  compatible: 'product.status.compatible',
  compatible_when_conditions_match: 'product.status.compatibleWhenConditionsMatch',
  incompatible: 'product.status.incompatible',
  requires_manual_review: 'product.status.requiresManualReview',
  unknown: 'product.status.unknown',
};

const CONDITION_LABEL_KEYS: Record<string, string> = {
  voltage: 'product.conditions.voltage',
  voltage_min: 'product.conditions.voltageMin',
  voltage_max: 'product.conditions.voltageMax',
  current_max: 'product.conditions.currentMax',
  power_min: 'product.conditions.powerMin',
  power_max: 'product.conditions.powerMax',
  sensor_type: 'product.conditions.sensorType',
  sensor_resistance: 'product.conditions.sensorResistance',
  control_signal: 'product.conditions.controlSignal',
  mounting_type: 'product.conditions.mountingType',
  compatible_series: 'product.conditions.compatibleSeries',
  compatible_system: 'product.conditions.compatibleSystem',
  application: 'product.conditions.application',
  floor_type: 'product.conditions.floorType',
  heating_type: 'product.conditions.heatingType',
  cooling_type: 'product.conditions.coolingType',
  indoor_only: 'product.conditions.indoorOnly',
  wet_zone_allowed: 'product.conditions.wetZoneAllowed',
  requires_protection_device: 'product.conditions.requiresProtectionDevice',
};

const DEV_PREVIEW_GROUPS: RelatedProductGroups = {
  required: [
    {
      relationType: 'required',
      compatibilityStatus: 'compatible_when_conditions_match',
      reasonEngineering: 'Демонстрационный обязательный компонент: нужен только если проектные условия совпадают с требованиями монтажа.',
      conditions: { mounting_type: 'standard_installation', compatible_system: ['demo_engineering_system'] },
      product: {
        id: 'dev-required',
        slug: 'dev-required-preview',
        sku: 'DEV-REQ-01',
        name_ru: 'DEV пример обязательного монтажного компонента',
        brand_name: 'DEV PREVIEW',
        price_amd: 1200,
        availability_label: 'Наличие уточняется',
        availability_status: 'preorder',
        can_add_to_cart: true,
        images: [],
      },
    },
  ],
  recommended: [
    {
      relationType: 'recommended',
      compatibilityStatus: 'compatible_when_conditions_match',
      reasonEngineering: 'Демонстрационная рекомендация: повышает аккуратность и надёжность установки, но зависит от объекта.',
      conditions: { application: ['residential'], requires_protection_device: true },
      product: {
        id: 'dev-recommended',
        slug: 'dev-recommended-preview',
        sku: 'DEV-REC-01',
        name_ru: 'DEV пример рекомендуемого компонента безопасности',
        brand_name: 'DEV PREVIEW',
        price_amd: 2400,
        availability_label: 'В наличии',
        availability_status: 'in_stock',
        can_add_to_cart: true,
        images: [],
      },
    },
  ],
  optional: [
    {
      relationType: 'optional',
      compatibilityStatus: 'compatible',
      reasonEngineering: 'Демонстрационное дополнение: не требуется для запуска системы, но расширяет удобство эксплуатации.',
      conditions: { application: ['comfort_upgrade'] },
      product: {
        id: 'dev-optional',
        slug: 'dev-optional-preview',
        sku: 'DEV-OPT-01',
        name_ru: 'DEV пример дополнительного улучшения',
        brand_name: 'DEV PREVIEW',
        price_amd: 3600,
        availability_label: 'Под заказ',
        availability_status: 'preorder',
        can_add_to_cart: true,
        images: [],
      },
    },
  ],
  alternatives: [
    {
      relationType: 'alternative',
      compatibilityStatus: 'compatible_when_conditions_match',
      reasonEngineering: 'Демонстрационная альтернатива: заменяет выбранный товар при совпадении ключевых параметров проекта.',
      conditions: { voltage: 230, compatible_system: ['demo_engineering_system'] },
      product: {
        id: 'dev-alternative',
        slug: 'dev-alternative-preview',
        sku: 'DEV-ALT-01',
        name_ru: 'DEV пример альтернативного товара с длинным названием для проверки мобильной карточки и переноса строк',
        brand_name: 'DEV PREVIEW',
        price_amd: 4200,
        availability_label: 'Наличие уточняется',
        availability_status: 'preorder',
        can_add_to_cart: false,
        images: [],
      },
    },
  ],
};

const DEV_PREVIEW_WARNINGS: CompatibilityWarning[] = [
  {
    relationType: 'incompatible',
    compatibilityStatus: 'incompatible',
    reasonEngineering: 'Демонстрационное предупреждение: этот пример нельзя покупать вместе, если параметры системы не совпадают.',
    conditions: { voltage: 24, control_signal: 'demo_mismatch' },
    product: {
      id: 'dev-warning',
      slug: 'dev-warning-preview',
      sku: 'DEV-WARN-01',
      name_ru: 'DEV пример несовместимого товара',
      brand_name: 'DEV PREVIEW',
      availability_label: 'Не предлагать вместе',
      availability_status: 'unavailable',
      images: [],
    },
  },
];

function normalizeRelationGroups(value: ProductPageApiResponse['relatedProductGroups']): RelatedProductGroups {
  const empty = emptyRelatedProductGroups();
  if (!value || typeof value !== 'object') return empty;
  return {
    required: normalizeRelationItems(value.required, 'required'),
    recommended: normalizeRelationItems(value.recommended, 'recommended'),
    optional: normalizeRelationItems(value.optional, 'optional'),
    alternatives: normalizeRelationItems(value.alternatives, 'alternative'),
  };
}

function normalizeRelationItems(value: unknown, expectedType: RelatedProductItem['relationType']) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RelatedProductItem => {
    if (!item || typeof item !== 'object') return false;
    const relation = item as RelatedProductItem;
    return relation.relationType === expectedType && Boolean(relation.product) && Boolean(relation.reasonEngineering?.trim());
  });
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CompatibilityWarning => {
    if (!item || typeof item !== 'object') return false;
    const warning = item as CompatibilityWarning;
    return warning.relationType === 'incompatible' && warning.compatibilityStatus === 'incompatible' && Boolean(warning.reasonEngineering?.trim());
  });
}

function groupsHaveItems(groups: RelatedProductGroups) {
  return Boolean(groups.required.length || groups.recommended.length || groups.optional.length || groups.alternatives.length);
}

function formatPrice(product: PublicProductSummary, t: TFunction) {
  const price = Number(product.price_amd || 0);
  const showPrice = product.show_price !== false && product.show_price !== 0;
  return showPrice && price > 0 ? `${price.toLocaleString('ru-RU')} AMD` : t('product.pricing.onRequest');
}

function productName(product: PublicProductSummary | undefined, t?: TFunction) {
  return String(product?.name_ru || product?.name || (t ? t('product.fallback.product') : 'Product'));
}

function getProductImage(product: PublicProductSummary | undefined) {
  return Array.isArray(product?.images) && product.images.length ? product.images[0]?.image_url || '' : '';
}

function canProductBeAdded(product: PublicProductSummary | undefined) {
  return Boolean(product?.can_add_to_cart) && Number.isFinite(Number(product?.id));
}

function cartPayloadFromProduct(product: PublicProductSummary) {
  const productId = Number(product.id);
  if (!Number.isFinite(productId)) return null;
  return {
    productId,
    slug: String(product.slug || ''),
    sku: String(product.sku || ''),
    name: productName(product),
    price: Number(product.price_amd || 0),
    image: getProductImage(product),
  };
}

function renderConditionValue(value: unknown, t: TFunction) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== '').join(', ');
  if (typeof value === 'boolean') return value ? t('product.values.yes') : t('product.values.no');
  if (value === null || value === undefined || value === '') return t('product.status.unknown');
  return String(value);
}

function safeConditionEntries(conditions: RelatedProductItem['conditions']) {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return [];
  return Object.entries(conditions)
    .filter(([key, value]) => key in CONDITION_LABEL_KEYS && value !== undefined && value !== '')
    .slice(0, 6);
}

function statusLabel(status: string | undefined, t: TFunction) {
  return t(STATUS_LABEL_KEYS[status || ''] || 'product.status.unknown');
}

function featureValue(product: any, patterns: RegExp[]) {
  const features = Array.isArray(product?.features) ? product.features : [];
  const match = features.find((feature: any) => patterns.some((pattern) => pattern.test(String(feature?.feature_name || ''))));
  if (!match) return '';
  return `${match.feature_value || ''}${match.feature_unit || ''}`.trim();
}

function buildEngineeringChecks(product: any, t: TFunction) {
  const checks = [
    { label: t('product.engineeringChecks.voltage'), value: product?.warm_floor_voltage_v ? `${product.warm_floor_voltage_v} В` : featureValue(product, [/напряж/i, /voltage/i]) },
    { label: t('product.engineeringChecks.maxLoad'), value: featureValue(product, [/нагруз/i, /ток/i, /current/i, /load/i]) },
    { label: t('product.engineeringChecks.power'), value: featureValue(product, [/мощ/i, /power/i, /watt/i]) },
    { label: t('product.engineeringChecks.mountingType'), value: featureValue(product, [/монтаж/i, /install/i, /mount/i]) },
    { label: t('product.engineeringChecks.sensorType'), value: featureValue(product, [/датчик/i, /sensor/i]) },
    { label: t('product.engineeringChecks.applicationSystem'), value: featureValue(product, [/система/i, /примен/i, /application/i]) },
    { label: t('product.engineeringChecks.compatibility'), value: featureValue(product, [/совмест/i, /compat/i]) },
    { label: t('product.engineeringChecks.ipRating'), value: featureValue(product, [/\bip\b/i, /защиты/i]) },
  ];
  // Rows without data ("Требуется уточнение") only add noise, e.g. "Тип датчика" on a socket.
  return checks.filter((check) => check.value);
}

function EngineeringRelatedProductCard({ item, relationKind, onAddToCart }: {
  item: RelatedProductItem;
  relationKind: keyof RelatedProductGroups;
  onAddToCart: (product: PublicProductSummary) => void;
}) {
  const { t } = useTranslation();
  const product = item.product;
  if (!product || !item.reasonEngineering?.trim()) return null;
  const copy = RELATION_COPY[relationKind];
  const isAlternative = relationKind === 'alternatives';
  const productSlug = product.slug ? `/product/${product.slug}` : '/catalog';
  const imageUrl = getProductImage(product);

  return (
    <article className={`grid gap-4 rounded-3xl border bg-card p-4 shadow-sm transition focus-within:ring-2 focus-within:ring-primary/40 sm:grid-cols-[112px_1fr] ${isAlternative ? 'border-warn/40' : 'border-line'}`}>
      <Link to={productSlug} className="block rounded-2xl bg-surface p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t('product.actions.openProduct', { name: productName(product, t) })}>
        <ManagedImage
          src={imageUrl}
          thumb
          alt={productName(product, t)}
          variant="product"
          placeholderTitle={productName(product, t)}
          placeholderSubtitle={String(product.brand_name || product.sku || 'OhmX.am')}
          className="h-28 w-full object-contain"
        />
      </Link>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${copy.badgeClass}`}>{t(copy.badgeKey)}</span>
          <span className="text-xs font-medium text-fg-muted">{statusLabel(item.compatibilityStatus, t)}</span>
        </div>
        <div>
          <Link to={productSlug} className="block text-base font-semibold leading-snug text-fg-strong transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {productName(product, t)}
          </Link>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
            {product.brand_name ? <span>{String(product.brand_name)}</span> : null}
            {product.sku ? <span>SKU {String(product.sku)}</span> : null}
          </div>
        </div>
        <p className="text-sm leading-6 text-fg-soft">{item.reasonEngineering}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-fg-strong">{formatPrice(product, t)}</span>
          <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-fg-soft">{String(product.availability_label || t('product.availability.request'))}</span>
        </div>
        {safeConditionEntries(item.conditions).length ? (
          <dl className="grid gap-2 rounded-2xl border border-line bg-surface p-3 text-xs sm:grid-cols-2">
            {safeConditionEntries(item.conditions).map(([key, value]) => (
              <div key={key}>
                <dt className="text-fg-muted">{t(CONDITION_LABEL_KEYS[key])}</dt>
                <dd className="mt-0.5 font-medium text-fg">{renderConditionValue(value, t)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Link to={productSlug} className="btn-secondary justify-center text-center" aria-label={t('product.actions.detailsAria', { name: productName(product, t) })}>{t('product.actions.details')}</Link>
          {isAlternative ? (
            <Link to={productSlug} className="btn-primary justify-center text-center" aria-label={t('product.actions.viewAlternativeAria', { name: productName(product, t) })}>{t('product.actions.viewAlternative')}</Link>
          ) : canProductBeAdded(product) ? (
            <button className="btn-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onAddToCart(product)} aria-label={t('product.actions.addToCartAria', { name: productName(product, t) })}>{t('product.actions.addToCart')}</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function RelationshipSection({ kind, items, onAddToCart }: {
  kind: keyof RelatedProductGroups;
  items: RelatedProductItem[];
  onAddToCart: (product: PublicProductSummary) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const copy = RELATION_COPY[kind];
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby={`relation-${kind}`}>
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`relation-${kind}`} className="text-xl font-semibold text-fg-strong">{t(copy.titleKey)}</h2>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${copy.badgeClass}`}>{t(copy.badgeKey)}</span>
        </div>
        <p className="text-sm leading-6 text-fg-soft">{t(copy.descriptionKey)}</p>
        {kind === 'alternatives' ? (
          <p className="rounded-2xl border border-warn/30 bg-warn/10 p-3 text-sm font-medium leading-6 text-warn">{t('product.relationships.alternatives.note')}</p>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item, index) => (
          <EngineeringRelatedProductCard key={`${kind}-${item.product?.id || item.product?.slug || index}`} item={item} relationKind={kind} onAddToCart={onAddToCart} />
        ))}
      </div>
    </section>
  );
}

function CompatibilityWarningsSection({ warnings }: { warnings: CompatibilityWarning[] }) {
  const { t } = useTranslation();
  if (!warnings.length) return null;
  return (
    <section className="panel border-warn/40 bg-warn/10 p-5 sm:p-6" aria-labelledby="compatibility-warnings">
      <div className="mb-4 space-y-2">
        <h2 id="compatibility-warnings" className="text-xl font-semibold text-fg-strong">{t('product.warnings.title')}</h2>
        <p className="text-sm leading-6 text-fg-soft">{t('product.warnings.description')}</p>
      </div>
      <div className="space-y-3">
        {warnings.map((warning, index) => (
          <article key={`${warning.targetProductId || warning.product?.id || index}`} className="rounded-3xl border border-warn/40 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs font-semibold text-warn">{t('product.status.incompatible')}</span>
              <span className="text-sm font-medium text-fg-soft">{statusLabel(warning.compatibilityStatus, t)}</span>
            </div>
            {warning.product ? <h3 className="mt-3 text-base font-semibold text-fg-strong">{productName(warning.product, t)}</h3> : null}
            <p className="mt-2 text-sm leading-6 text-fg-soft">{warning.reasonEngineering}</p>
            {safeConditionEntries(warning.conditions).length ? (
              <dl className="mt-3 grid gap-2 rounded-2xl border border-line bg-card p-3 text-xs sm:grid-cols-2">
                {safeConditionEntries(warning.conditions).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-fg-muted">{t(CONDITION_LABEL_KEYS[key])}</dt>
                    <dd className="mt-0.5 font-medium text-fg">{renderConditionValue(value, t)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="mt-3 text-sm font-medium text-warn">{t('product.warnings.orderNote')}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PrePurchaseChecksSection({ checks, hasRequired, hasWarnings }: {
  checks: Array<{ label: string; value: string }>;
  hasRequired: boolean;
  hasWarnings: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="pre-purchase-checks">
      <div className="mb-4 space-y-2">
        <h2 id="pre-purchase-checks" className="text-xl font-semibold text-fg-strong">{t('product.prePurchase.title')}</h2>
        <p className="text-sm leading-6 text-fg-soft">
          {t('product.prePurchase.description')}
        </p>
      </div>
      <div className={`grid gap-4 ${checks.length ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]' : ''}`}>
        <ul className="space-y-3 text-sm leading-6 text-fg-soft">
          <li>{t('product.prePurchase.bullets.compatibility')}</li>
          <li>{t('product.prePurchase.bullets.parameters')}</li>
          <li>{hasRequired ? t('product.prePurchase.bullets.requiredPresent') : t('product.prePurchase.bullets.requiredMissing')}</li>
          <li>{hasWarnings ? t('product.prePurchase.bullets.warningsPresent') : t('product.prePurchase.bullets.warningsMissing')}</li>
          <li>{t('product.prePurchase.bullets.systemParts')}</li>
        </ul>
        {checks.length ? (
          <dl className="grid gap-2 rounded-3xl border border-line bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {checks.slice(0, 8).map((check) => (
              <div key={check.label}>
                <dt className="text-fg-muted">{check.label}</dt>
                <dd className="mt-0.5 font-medium text-fg-strong">{check.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function LegacySimilarProducts({ products }: { products: PublicProductSummary[] }) {
  const { t } = useTranslation();
  if (!products.length) return null;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="legacy-similar-products">
      <div className="mb-4 space-y-2">
        <h2 id="legacy-similar-products" className="text-xl font-semibold text-fg-strong">{t('product.similar.title')}</h2>
        <p className="text-sm leading-6 text-fg-soft">{t('product.similar.description')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((item) => (
          <Link key={item.id || item.slug} to={item.slug ? `/product/${item.slug}` : '/catalog'} className="catalog-mini-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t('product.actions.openSimilarProduct', { name: productName(item, t) })}>
            {productName(item, t)}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ProductPage() {
  const { t, i18n } = useTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProductPageApiResponse | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const addToCart = useStore((s) => s.addToCart);
  const addRecent = useStore((s) => s.addRecent);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const pinnedItems = useStore((s) => s.pinnedItems);
  const togglePinnedItem = useStore((s) => s.togglePinnedItem);

  useEffect(() => {
    let cancelled = false;
    setHasLoadError(false);
    setData(null);
    api<ProductPageApiResponse>(`/products/${slug}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        addRecent(slug);
        setActiveImage(0);
        setQuantity(1);
        setJustAdded(false);
      })
      .catch(() => {
        if (!cancelled) setHasLoadError(true);
      });
    return () => { cancelled = true; };
  }, [addRecent, slug]);

  const product = data?.product as any;
  const isFavorite = product ? favorites.includes(product.id) : false;
  const isDevRelationshipPreview = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('relationshipPreview') === '1';
  const apiGroups = normalizeRelationGroups(data?.relatedProductGroups);
  const apiWarnings = normalizeWarnings(data?.compatibilityWarnings);
  const relationshipGroups = isDevRelationshipPreview ? DEV_PREVIEW_GROUPS : apiGroups;
  const compatibilityWarnings = isDevRelationshipPreview ? DEV_PREVIEW_WARNINGS : apiWarnings;
  const hasTypedGroups = groupsHaveItems(relationshipGroups);
  const hasWarnings = Boolean(compatibilityWarnings.length);
  const legacyRelatedProducts = Array.isArray(data?.relatedProducts) ? data.relatedProducts.filter(Boolean) : [];
  const legacySimilarProducts = !hasTypedGroups && !hasWarnings ? legacyRelatedProducts.slice(0, 6) : [];

  useEffect(() => {
    if (!justAdded) return undefined;
    const timer = window.setTimeout(() => setJustAdded(false), 1800);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  const images = useMemo(() => (product?.images?.length ? product.images : [{ image_url: '', alt_text: product?.name_ru || t('product.fallback.product') }]), [product, t]);
  const inquiryPath = product ? buildInquiryPath(product) : '/contacts';

  if (hasLoadError) return <div className="page"><div className="panel p-6 text-fg-soft" role="alert">{t('product.errors.load')}</div></div>;
  if (!product) return <div className="page"><div className="panel p-6 text-fg-soft">{t('product.states.loading')}</div></div>;

  const selectedImage = images[Math.min(activeImage, images.length - 1)];
  const availabilityClass = availabilityTone(product.availability_status);
  const canAddToCart = Boolean(product.can_add_to_cart);
  const hasDocs = Boolean(product.documents?.length);
  const hasFeatures = Boolean(product.features?.length);
  const displaySeriesName = getDisplaySeriesName(product);
  const categoryBreadcrumbs = Array.isArray(product?.breadcrumbs) ? product.breadcrumbs : [];
  const categoryPaths = Array.isArray(product?.category_paths) ? product.category_paths : [];
  const crumbLabel = (item: any) => getLocalizedCategoryName({ name_ru: item.label, name_en: item.name_en, name_hy: item.name_hy }, language);
  const pathLabel = (path: any) => (language === 'en' && path.label_en) || (language === 'hy' && path.label_hy) || path.label;
  const lastCrumb = categoryBreadcrumbs[categoryBreadcrumbs.length - 1];
  const categoryName = language !== 'ru' && lastCrumb ? crumbLabel(lastCrumb) : product.category_name;
  const productPinContextId = `${product?.category_slug || product?.category_name || 'catalog'}:all:all`;
  const isPinned = Boolean(product && pinnedItems.find((item) => item.type === 'product' && item.id === String(product.id) && item.contextId === productPinContextId && item.contextType === 'category-products'));
  const engineeringChecks = buildEngineeringChecks(product, t);
  const hasRequiredRelations = Boolean(relationshipGroups.required.length);
  const showPrePurchaseChecks = Boolean(engineeringChecks.length) || hasRequiredRelations || hasWarnings;
  const seriesKit = data?.seriesKit && Array.isArray(data.seriesKit.groups) ? data.seriesKit : null;
  const seriesUrl = displaySeriesName ? `/catalog/rozetki-i-vyklyuchateli?series=${encodeURIComponent(getSeriesSlug(displaySeriesName))}` : undefined;
  const handleRelatedAddToCart = (relatedProduct: PublicProductSummary, amount = 1) => {
    const payload = cartPayloadFromProduct(relatedProduct);
    if (payload) addToCart(payload, amount);
  };
  const handleKitAddToCart = (item: SeriesKitItem, amount: number) => handleRelatedAddToCart(item, amount);
  const handleAddToCart = () => {
    addToCart({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name_ru, price: product.price_amd, image: images?.[0]?.image_url }, quantity);
    setJustAdded(true);
    setQuantity(1);
  };

  return (
    <div className="page space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button className="circle-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => navigate(-1)} aria-label={t('product.actions.back')}>
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="mobile-page-title text-fg-strong">{t('product.mobileTitle')}</div>
        <button className={`circle-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isFavorite ? 'bg-primary text-white' : ''}`} onClick={() => toggleFavorite(product.id)} aria-label={isFavorite ? t('product.actions.removeFavorite') : t('product.actions.addFavorite')}>
          <Star className="h-6 w-6" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <Breadcrumbs
        items={[
          { label: t('navigation.breadcrumbs.home'), to: '/' },
          { label: t('navigation.breadcrumbs.catalog'), to: '/catalog' },
          ...categoryBreadcrumbs.map((item: any) => ({ label: crumbLabel(item), to: item.to })),
          { label: product.name_ru },
        ]}
      />

      {isDevRelationshipPreview ? (
        <div className="rounded-3xl border border-warn/40 bg-warn/10 p-4 text-sm font-semibold text-warn" role="status">{t('product.devPreviewBanner')}</div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]" aria-labelledby="product-title">
        <div className="space-y-4">
          <div className="product-hero-media">
            <ManagedImage
              src={selectedImage.image_url}
              alt={product.name_ru}
              variant="product"
              placeholderTitle={product.name_ru}
              placeholderSubtitle={product.brand_name || t('product.fallback.product')}
              className="h-[300px] w-full object-contain sm:h-[420px]"
            />
          </div>
          {images.length > 1 ? (
            <div className="flex flex-wrap gap-3" aria-label={t('product.gallery.ariaLabel')}>
              {images.map((image: any, index: number) => (
                <button key={image.id || `${image.image_url}-${index}`} onClick={() => setActiveImage(index)} className={`product-thumb-dot focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${index === activeImage ? 'active' : ''}`} aria-label={t('product.gallery.showImage', { index: index + 1 })} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-fg-muted">
              {product.brand_name ? <span>{product.brand_name}</span> : null}
              <span>SKU {product.sku}</span>
              {displaySeriesName ? <span>{t('product.labels.series', { series: displaySeriesName })}</span> : null}
            </div>
            <h1 id="product-title" className="mt-3 text-3xl font-bold leading-tight text-fg-strong">{product.name_ru}</h1>
            <div className={`mt-4 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${availabilityClass}`}>{product.availability_label || t('product.availability.request')}</div>
            {seriesKit?.colorVariants?.length ? <ProductColorVariants currentColor={seriesKit.productColor} variants={seriesKit.colorVariants} /> : null}
            <RichTextBlock
              html={product.short_description_ru || product.description_ru || ''}
              className="rich-text-content mt-4 text-sm leading-7 text-fg-soft"
              fallback={t('product.descriptionFallback')}
            />

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-sm text-fg-muted">{t('product.labels.price')}</div>
                <div className="mt-1 text-2xl font-bold text-fg-strong">{formatPrice(product, t)}</div>
              </div>
              <div>
                <div className="text-sm text-fg-muted">{t('product.labels.category')}</div>
                <div className="mt-1 font-semibold text-fg-strong">{categoryName || t('product.categoryFallback')}</div>
                {categoryPaths.length ? (
                  <div className="mt-2 space-y-1 text-sm text-fg-soft">
                    {categoryPaths.slice(0, 4).map((path: any) => (
                      <Link key={path.url} to={path.url} className="block transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{pathLabel(path)}</Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PinButton
                active={isPinned}
                onClick={() => togglePinnedItem({
                  id: String(product.id),
                  type: 'product',
                  title: product.name_ru,
                  imageUrl: images?.[0]?.image_url,
                  url: `/product/${product.slug}`,
                  contextId: productPinContextId,
                  contextType: 'category-products',
                  subtitle: product.sku,
                })}
                title={isPinned ? t('product.actions.unpin') : t('product.actions.pin')}
                size="md"
              />
              {canAddToCart ? (
                <>
                  <QuantitySelector value={quantity} onChange={setQuantity} />
                  <button
                    className={`btn-primary inline-flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${justAdded ? 'opacity-90' : ''}`}
                    onClick={handleAddToCart}
                    aria-live="polite"
                  >
                    {justAdded ? <Check className="h-4 w-4" /> : null}
                    {justAdded ? t('product.actions.added') : t('product.actions.addToCart')}
                  </button>
                </>
              ) : (
                <Link to={inquiryPath} className="btn-primary">{String(product.primary_cta_label || t('product.actions.requestAvailability'))}</Link>
              )}
            </div>
            {canAddToCart && justAdded ? (
              <div className="mt-3 text-sm text-fg-soft" role="status">
                {t('product.actions.addedHint')} <Link to="/cart" className="font-semibold text-primary">{t('product.actions.goToCart')}</Link>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {seriesKit ? <ProductSeriesKit kit={seriesKit} seriesUrl={seriesUrl} onAdd={handleKitAddToCart} /> : null}

      {hasFeatures ? (
        <section className="panel p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-fg-strong">{t('product.specifications.title')}</h2>
            <Document className="h-6 w-6 text-fg-muted" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {product.features.map((feature: any) => (
              <div key={feature.id} className="rounded-2xl border border-line bg-card px-4 py-3">
                <div className="text-sm text-fg-muted">{feature.feature_name}</div>
                <div className="mt-1 font-semibold text-fg-strong">{feature.feature_value}{feature.feature_unit || ''}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showPrePurchaseChecks ? <PrePurchaseChecksSection checks={engineeringChecks} hasRequired={hasRequiredRelations} hasWarnings={hasWarnings} /> : null}
      <CompatibilityWarningsSection warnings={compatibilityWarnings} />
      <RelationshipSection kind="required" items={relationshipGroups.required} onAddToCart={handleRelatedAddToCart} />
      <RelationshipSection kind="recommended" items={relationshipGroups.recommended} onAddToCart={handleRelatedAddToCart} />
      <RelationshipSection kind="optional" items={relationshipGroups.optional} onAddToCart={handleRelatedAddToCart} />
      <RelationshipSection kind="alternatives" items={relationshipGroups.alternatives} onAddToCart={handleRelatedAddToCart} />
      <LegacySimilarProducts products={legacySimilarProducts} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-fg-strong">{t('product.order.title')}</h2>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-fg-soft">
            <li>{t('product.order.steps.open')}</li>
            <li>{t('product.order.steps.add')}</li>
            <li>{t('product.order.steps.confirm')}</li>
          </ol>
        </div>
        <div className="panel p-5">
          <h2 className="text-lg font-semibold text-fg-strong">{t('product.delivery.title')}</h2>
          <div className="mt-3 text-sm leading-6 text-fg-soft">{t('product.delivery.description')}</div>
        </div>
      </div>

      {hasDocs ? (
        <section className="panel p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-fg-strong">{t('product.documents.title')}</h2>
            <Link to="/documentation" className="text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{t('product.documents.allDocumentation')}</Link>
          </div>
          <div className="space-y-3">
            {product.documents.map((doc: any) => (
              <a key={doc.id} href={doc.file_url} target="_blank" rel="noreferrer" className="document-row focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={t('product.documents.openAria', { name: doc.document_name })}>
                <div>
                  <div className="font-semibold text-fg-strong">{doc.document_name}</div>
                  <div className="mt-1 text-sm text-fg-muted">{(doc.file_extension || 'pdf').toUpperCase()} · {(doc.language || 'ru').toUpperCase()}</div>
                </div>
                <span className="text-primary">{t('product.documents.open')}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
