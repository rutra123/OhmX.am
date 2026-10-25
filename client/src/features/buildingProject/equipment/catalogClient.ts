/**
 * Read-only catalog access for the equipment engine (existing public APIs only):
 *   GET  /products?q=<sku>          — code, name, price, unit, availability
 *   GET  /products/:slug            — approved relationship groups
 *   POST /catalog-matcher/match     — fan-coil selection on approved engineering data
 * Results are cached per session; nothing is written anywhere.
 */
import { api } from '../../../api/client';
import { fanCoilFits } from './fanCoilMounting';
import { FAN_COIL_STOCK_MAX_OVERSIZE, chooseFanCoil, type CatalogProduct, type FanCoilPick, type FanCoilRequest } from './equipmentEngine';

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

interface ProductCard {
  id?: number;
  sku: string;
  slug: string;
  name_ru: string;
  price_amd: number | null;
  show_price: number;
  unit: string | null;
  availability_label?: string | null;
  availability_status?: string | null;
  can_add_to_cart?: boolean | number | null;
  cover_image?: string | null;
}

// Public availability statuses (server utils/publicAvailability): stock > 0 → available_to_order / price_on_request.
const IN_STOCK = new Set(['available_to_order', 'price_on_request']);
const TO_ORDER = new Set(['preorder', 'request_price_and_eta', 'unavailable']);

export function toCatalogProduct(card: ProductCard): CatalogProduct {
  const price = Number(card.price_amd);
  const status = card.availability_status ?? null;
  return {
    sku: card.sku,
    name: card.name_ru,
    slug: card.slug,
    priceAmd: card.show_price && Number.isFinite(price) && price > 0 ? price : null,
    unit: card.unit || 'шт',
    availabilityLabel: card.availability_label ?? null,
    id: Number.isFinite(Number(card.id)) ? Number(card.id) : null,
    image: card.cover_image || '',
    inStock: status && IN_STOCK.has(status) ? true : status && TO_ORDER.has(status) ? false : null,
    canAddToCart: Boolean(card.can_add_to_cart),
  };
}

const productCache = new Map<string, Promise<CatalogProduct | null>>();

export function lookupSku(sku: string, fetcher: Fetcher = api): Promise<CatalogProduct | null> {
  const cached = productCache.get(sku);
  if (cached) return cached;
  const p = fetcher<ProductCard[]>(`/products?q=${encodeURIComponent(sku)}&limit=50`)
    .then((cards) => {
      // Exact code match only — never a "similar" product.
      const card = (cards || []).find((c) => String(c.sku).trim() === sku);
      return card ? toCatalogProduct(card) : null;
    })
    .catch((err) => {
      productCache.delete(sku);
      throw err;
    });
  productCache.set(sku, p);
  return p;
}

export async function lookupSkus(skus: string[], fetcher: Fetcher = api): Promise<Map<string, CatalogProduct | null>> {
  const entries = await Promise.all(skus.map(async (sku) => [sku, await lookupSku(sku, fetcher)] as const));
  return new Map(entries);
}

const categoryCache = new Map<string, Promise<Map<string, CatalogProduct>>>();

function lookupCategory(slug: string, fetcher: Fetcher): Promise<Map<string, CatalogProduct>> {
  const cached = categoryCache.get(slug);
  if (cached) return cached;
  const p = fetcher<ProductCard[]>(`/products?category=${encodeURIComponent(slug)}&limit=2000`)
    .then((cards) => new Map((cards || []).map((c) => [String(c.sku).trim(), toCatalogProduct(c)] as const)))
    .catch((err) => {
      categoryCache.delete(slug);
      throw err;
    });
  categoryCache.set(slug, p);
  return p;
}

/**
 * Live availability and price for many SKUs with one request per catalog category (from the profile snapshot),
 * instead of one request per SKU. SKUs the category listing does not return fall back to the exact-code lookup
 * (null = not an active catalog product). Only the public card data is used: availability flag, price, unit.
 */
export async function lookupSkusBatched(
  skus: string[],
  categoryOf: (sku: string) => string | undefined,
  fetcher: Fetcher = api,
): Promise<Map<string, CatalogProduct | null>> {
  const byCategory = new Map<string, string[]>();
  const loose: string[] = [];
  for (const sku of [...new Set(skus)]) {
    const cat = categoryOf(sku);
    if (cat) byCategory.set(cat, [...(byCategory.get(cat) ?? []), sku]);
    else loose.push(sku);
  }
  const out = new Map<string, CatalogProduct | null>();
  for (const [cat, list] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const listing = await lookupCategory(cat, fetcher).catch(() => new Map<string, CatalogProduct>());
    for (const sku of list) {
      const hit = listing.get(sku);
      if (hit) out.set(sku, hit);
      else loose.push(sku);
    }
  }
  for (const [sku, product] of (await lookupSkus(loose, fetcher)).entries()) out.set(sku, product);
  return out;
}

interface RelatedGroup { product: ProductCard; relationType: string }

const companionCache = new Map<string, Promise<{ required: CatalogProduct[]; optional: CatalogProduct[] }>>();

/** Approved relationships only (the public endpoint serves review_status = 'approved'). */
export function lookupCompanions(product: CatalogProduct, fetcher: Fetcher = api) {
  const cached = companionCache.get(product.sku);
  if (cached) return cached;
  const p = fetcher<{ relatedProductGroups?: { required?: RelatedGroup[]; recommended?: RelatedGroup[]; optional?: RelatedGroup[] } }>(`/products/${encodeURIComponent(product.slug)}`)
    .then((detail) => ({
      required: (detail.relatedProductGroups?.required ?? []).map((g) => toCatalogProduct(g.product)),
      optional: [...(detail.relatedProductGroups?.recommended ?? []), ...(detail.relatedProductGroups?.optional ?? [])].map((g) => toCatalogProduct(g.product)),
    }))
    .catch(() => ({ required: [], optional: [] }));
  companionCache.set(product.sku, p);
  return p;
}

// ---------------------------------------------------------------------------
// Fan-coil selection through the existing catalog matcher
// ---------------------------------------------------------------------------

const cond = (key: string, num: number | null, text: string | null = null, unit: string | null = null) => ({
  conditionKey: key, valueNumeric: num, valueText: text, valueBoolean: null, unit, matchPolicy: 'EXACT',
});

export function matcherRequest(service: 'COOLING' | 'HEATING', requiredKw: number) {
  const cooling = service === 'COOLING';
  const parameterCode = cooling ? 'cooling_capacity' : 'heating_capacity';
  return {
    matcherModelId: 'ohmx.catalog-matcher.v1',
    matcherModelVersion: '1.0.0',
    schemaVersion: '1.0.0',
    policyId: 'ohmx.catalog-matcher-policy.v1',
    policyVersion: '1.0.0',
    selectionMode: 'PRELIMINARY',
    equipmentType: 'FAN_COIL',
    service,
    requiredCapacity: { parameterCode, requiredValue: Number(requiredKw.toFixed(3)), unit: 'kW', comparisonPolicy: 'AT_LEAST', upperValue: null },
    operatingConditions: cooling
      ? [cond('fan_speed', null, 'HIGH'), cond('water_in_c', 7, null, '°C'), cond('water_out_c', 12, null, '°C'), cond('indoor_air_dry_bulb_c', 27, null, '°C'), cond('indoor_air_wet_bulb_c', 19, null, '°C')]
      : [cond('fan_speed', null, 'HIGH'), cond('water_in_c', 70, null, '°C'), cond('water_out_c', 60, null, '°C'), cond('indoor_air_dry_bulb_c', 20, null, '°C')],
    requiredParameters: [{ parameterCode, requirementKind: 'SELECTION', conditionScope: 'VALUE_OPERATING_POINT' }],
    preferredParameters: [],
    excludedParameters: [],
    compatibilityRequirements: [],
    requiredVerificationTier: 'VERIFIED_SECONDARY',
    requireExactOperatingPoint: true,
    allowInterpolation: false,
    allowExtrapolation: false,
    // The 20% heating reserve is already inside requiredKw — never add a second margin.
    designMarginPercent: 0,
    // all candidates (server max): the stock rule needs to see in-stock units beyond the closest 20
    maxCandidates: 100,
    maxDiagnosticResults: 0,
    projectContext: null,
  };
}

interface MatcherCandidate {
  sku: string;
  decision: string;
  oversizeRatio: number | null;
  matchedValues: Array<{ parameterCode: string; value: { valueNumeric?: number | null } }>;
  commercialData?: { price?: { amount?: number } };
}

const matcherCache = new Map<string, Promise<FanCoilPick>>();

export function pickFanCoil(request: FanCoilRequest, fetcher: Fetcher = api): Promise<FanCoilPick> {
  const key = JSON.stringify(request);
  const cached = matcherCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const byUnits: Parameters<typeof chooseFanCoil>[1] = [];
    for (const units of [1, 2, 3]) {
      const res = await fetcher<{ candidates?: MatcherCandidate[] }>('/catalog-matcher/match', {
        method: 'POST',
        body: JSON.stringify(matcherRequest(request.service, request.requiredKw / units)),
      });
      const code = request.service === 'COOLING' ? 'cooling_capacity' : 'heating_capacity';
      const candidates = (res.candidates ?? [])
        .filter((c) => c.decision === 'MATCH' || c.decision === 'MATCH_WITH_WARNINGS')
        .map((c) => ({
          sku: c.sku,
          capacityKw: Number(c.matchedValues.find((v) => v.parameterCode === code)?.value.valueNumeric ?? 0),
          oversizeRatio: c.oversizeRatio ?? 99,
          priceAmd: (c.commercialData?.price?.amount ?? 0) > 0 ? c.commercialData!.price!.amount! : null,
          inStock: null as boolean | null,
        }));
      // The matcher has no stock data: read availability from the catalog for candidates the stock rule can use.
      const fitting = candidates.filter((c) => fanCoilFits(c.sku, request.mounting));
      const bestRatio = fitting.length ? Math.min(...fitting.map((c) => c.oversizeRatio)) : Number.POSITIVE_INFINITY;
      await Promise.all(fitting
        .filter((c) => c.oversizeRatio <= Math.max(bestRatio * 1.1, FAN_COIL_STOCK_MAX_OVERSIZE))
        .map(async (c) => {
          const product = await lookupSku(c.sku, fetcher).catch(() => null);
          c.inStock = product?.inStock ?? null;
        }));
      byUnits.push({ units, candidates });
      const pick = chooseFanCoil(request, byUnits);
      if (pick.sku) return pick;
    }
    return chooseFanCoil(request, byUnits);
  })().catch((err) => {
    matcherCache.delete(key);
    throw err;
  });
  matcherCache.set(key, p);
  return p;
}
