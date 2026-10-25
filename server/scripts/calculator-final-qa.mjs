import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchWarmFloorProductsV3 } from '../dist/utils/warmFloorMatcherV3.js';
import { warmFloorProductRows } from '../dist/utils/warmFloorProducts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const products = warmFloorProductRows();
const results = [];
let failures = 0;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function run(name, fn) {
  try {
    const details = fn() || {};
    results.push({ name, pass: true, details });
  } catch (error) {
    failures += 1;
    results.push({ name, pass: false, error: error.message });
  }
}

function input(overrides = {}) {
  return {
    roomType: 'living_room',
    roomAreaM2: 20,
    installationAreaM2: 15,
    excludedAreaM2: 5,
    floorCovering: 'tile',
    substrateType: 'concrete_screed',
    heatingPurpose: 'additional_heating',
    insulationLevel: 'standard',
    wetZone: false,
    systemPreference: 'auto',
    includeAccessories: true,
    regionProfile: 'AM',
    ...overrides,
  };
}

function assertUnique(result) {
  const main = result.variants.map((v) => v.mainProduct);
  const accessory = [...result.accessories, ...result.accessoryReplacements];
  const ids = [...main, ...accessory].filter((p) => Number(p.id) > 0).map((p) => Number(p.id));
  const skus = [...main, ...accessory].map((p) => String(p.sku || '').trim().toLowerCase()).filter(Boolean);
  check(new Set(ids).size === ids.length, 'duplicate product id across groups');
  check(new Set(skus).size === skus.length, 'duplicate SKU across groups');
}

function summary(result) {
  const primary = result.variants[0];
  return {
    status: result.status,
    primary: primary ? {
      id: primary.mainProduct.id,
      name: primary.mainProduct.name,
      type: primary.mainProduct.productType,
      tier: primary.brandTier,
      targetWm2: primary.calculation.targetInstalledPowerWm2,
      selectedPowerW: primary.calculation.selectedProductTotalPowerW,
      currentA: primary.calculation.actualCurrentA,
      spacingCm: primary.calculation.spacingCm ?? null,
      coveragePercent: primary.calculation.coveragePercent ?? null,
    } : null,
    variantTiers: result.variants.map((v) => v.brandTier),
    accessoryGroups: result.accessories.map((a) => a.accessoryGroup),
  };
}

run('01 bathroom 7m2 / tile / tile adhesive', () => {
  const r = matchWarmFloorProductsV3(input({ roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5.5, excludedAreaM2: 1.5, substrateType: 'tile_adhesive', heatingPurpose: 'comfort_floor', wetZone: true }));
  check(r.status === 'ok', 'expected a compatible result');
  check(r.variants.every((v) => v.mainProduct.productType === 'heating_mat'), 'thin layer must contain mats only');
  check(r.variants.every((v) => v.mainProduct.approvedForThinLayer === true), 'mat lacks manufacturer/series thin-layer approval');
  check(r.variants.every((v) => v.mainProduct.wetZoneAllowed === true), 'wet-zone approval missing');
  check(r.variants[0].brandTier === 'premium' && /DEVI/i.test(r.variants[0].mainProduct.brand), 'premium DEVI must rank first when compatible');
  assertUnique(r);
  return summary(r);
});

run('02 bathroom / tile / screed', () => {
  const r = matchWarmFloorProductsV3(input({ roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5.5, excludedAreaM2: 1.5, heatingPurpose: 'comfort_floor', wetZone: true }));
  check(r.status === 'ok', 'expected a compatible result');
  check(r.variants[0].mainProduct.productType === 'heating_cable', 'screed should prefer compatible cable');
  check(r.variants[0].calculation.spacingCm >= 3 && r.variants[0].calculation.spacingCm <= 20, 'cable spacing outside hard range');
  check(r.variants[0].mainProduct.linearPowerWm <= 20, 'indoor linear output exceeds 20 W/m');
  assertUnique(r);
  return summary(r);
});

let poorTarget = null;
run('03 living room 15m2 / poor insulation / screed', () => {
  const r = matchWarmFloorProductsV3(input({ insulationLevel: 'poor' }));
  check(r.status === 'ok', 'expected a compatible result');
  poorTarget = r.calculation.targetInstalledPowerWm2;
  check(Math.abs(r.calculation.requiredTotalPowerW - Math.round(15 * r.calculation.targetInstalledPowerWm2)) < 0.01, 'required power is not heatedArea × q (rounded only for output)');
  check(r.variants[0].brandTier === 'premium', 'premium compatible product must rank first');
  const tape = r.accessories.find((a) => a.accessoryGroup === 'mounting_tape');
  check(tape && tape.requiredLengthMeters > 0 && tape.packageLengthMeters > 0 && tape.packageCount === Math.ceil(tape.requiredLengthMeters / tape.packageLengthMeters), 'mounting-tape units/packages are inconsistent');
  assertUnique(r);
  return { ...summary(r), tape: tape && { requiredLengthMeters: tape.requiredLengthMeters, packageLengthMeters: tape.packageLengthMeters, packageCount: tape.packageCount } };
});

run('04 living room / good insulation', () => {
  const r = matchWarmFloorProductsV3(input({ insulationLevel: 'good' }));
  check(r.status === 'ok', 'expected a compatible result');
  check(r.calculation.insulationFactor === 0.92, 'good insulation factor must be 0.92');
  check(poorTarget !== null && r.calculation.targetInstalledPowerWm2 < poorTarget, 'good insulation must reduce q versus poor');
  check(Math.abs(r.calculation.requiredTotalPowerW - Math.round(15 * r.calculation.targetInstalledPowerWm2)) < 0.01, 'insulation factor or safety factor appears duplicated');
  return summary(r);
});

run('05 laminate', () => {
  const r = matchWarmFloorProductsV3(input({ floorCovering: 'laminate', insulationLevel: 'good', installationAreaM2: 10, excludedAreaM2: 10 }));
  check(r.status === 'no_match', 'untagged catalogue products must not be guessed for laminate');
  check(r.fallback?.requiredCharacteristics?.floorTemperatureLimitC === 27, 'laminate floor-temperature limit missing');
  return { ...summary(r), fallback: r.fallback };
});

run('06 Vinyl/LVT', () => {
  const r = matchWarmFloorProductsV3(input({ roomType: 'kitchen', roomAreaM2: 12, installationAreaM2: 8, excludedAreaM2: 4, floorCovering: 'vinyl' }));
  check(r.status === 'no_match', 'untagged catalogue products must not be guessed for Vinyl/LVT');
  check(r.fallback?.requiredCharacteristics?.floorTemperatureLimitC === 26, 'Vinyl/LVT floor-temperature limit missing');
  return { ...summary(r), fallback: r.fallback };
});

run('07 small heated area 1.5m2', () => {
  const r = matchWarmFloorProductsV3(input({ roomType: 'bathroom', roomAreaM2: 2, installationAreaM2: 1.5, excludedAreaM2: 0.5, substrateType: 'tile_adhesive', heatingPurpose: 'comfort_floor', wetZone: true }));
  check(r.status === 'ok', 'small area should find a fixed-size mat');
  check(r.variants[0].calculation.selectedProductTotalPowerW <= r.calculation.requiredTotalPowerW * 1.2 + 0.01, 'small-area product is oversized');
  return summary(r);
});

run('08 high load / contactor check', () => {
  const r = matchWarmFloorProductsV3(input({ roomAreaM2: 25, installationAreaM2: 22, excludedAreaM2: 3, insulationLevel: 'poor' }));
  check(r.status === 'ok', 'expected high-load product');
  check(r.variants[0].calculation.actualCurrentA >= 12.8, 'scenario did not reach configurable relay threshold');
  check(r.accessories.some((a) => a.accessoryGroup === 'contactor') || r.missingAccessoryRequirements.some((a) => a.group === 'contactor_or_zone_split'), 'contactor or zone split was not requested');
  return summary(r);
});

run('09 no DEVI available', () => {
  const noDevi = products.filter((p) => !/devi|danfoss/i.test(`${p.brand} ${p.name}`));
  const r = matchWarmFloorProductsV3(input({ roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5.5, excludedAreaM2: 1.5, substrateType: 'tile_adhesive', heatingPurpose: 'comfort_floor', wetZone: true }), { products: noDevi });
  check(r.status === 'ok', 'absence of DEVI must not make a valid Fenix scenario empty');
  check(r.variants[0].brandTier === 'standard' && /Fenix/i.test(r.variants[0].mainProduct.brand), 'Fenix Standard must become best available');
  check(r.variants[0].role === 'standard' && r.variants[0].isPrimary, 'Standard fallback is mislabeled as Premium');
  return summary(r);
});

run('10 no compatible products at all', () => {
  const r = matchWarmFloorProductsV3(input(), { products: [] });
  check(r.status === 'no_match' && r.variants.length === 0, 'must return no_match, not a random product');
  check(r.fallback?.requiredCharacteristics?.requiredPowerW > 0, 'required characteristics missing');
  return { ...summary(r), fallback: r.fallback };
});

for (const locale of ['ru', 'hy', 'en']) {
  run(`${locale === 'ru' ? '11' : locale === 'hy' ? '12' : '13'} locale ${locale.toUpperCase()}`, () => {
    const file = path.join(root, 'client/src/i18n/locales', locale, 'common.json');
    const dictionary = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = matchWarmFloorProductsV3(input({ locale }));
    check(dictionary.calculator?.warmFloor?.engineering?.fallback?.noSuitableProduct, 'warm-floor fallback localization missing');
    check(dictionary.calculator?.power?.result?.engineeringDisclaimer, 'power disclaimer localization missing');
    check(dictionary.calculator?.warmFloor?.important?.electricalDisclaimer, 'electrical disclaimer localization missing');
    return { locale, numericSignature: [r.calculation.targetInstalledPowerWm2, r.calculation.requiredTotalPowerW, r.variants[0]?.mainProduct.id], uiSamples: { noProduct: dictionary.calculator.warmFloor.engineering.fallback.noSuitableProduct, powerDisclaimer: dictionary.calculator.power.result.engineeringDisclaimer } };
  });
}

const flattenLocale = (object, prefix = '', out = {}) => {
  if (object && typeof object === 'object' && !Array.isArray(object)) {
    for (const [key, value] of Object.entries(object)) flattenLocale(value, prefix ? `${prefix}.${key}` : key, out);
  } else out[prefix] = object;
  return out;
};

run('14 regression: locale key parity and numeric invariance', () => {
  const dictionaries = Object.fromEntries(['ru', 'hy', 'en'].map((locale) => [locale, flattenLocale(JSON.parse(fs.readFileSync(path.join(root, 'client/src/i18n/locales', locale, 'common.json'), 'utf8')))]));
  const keys = Object.values(dictionaries).map((dictionary) => Object.keys(dictionary).sort());
  check(JSON.stringify(keys[0]) === JSON.stringify(keys[1]) && JSON.stringify(keys[0]) === JSON.stringify(keys[2]), 'RU/HY/EN key sets differ');
  const base = input();
  const signatures = ['ru', 'hy', 'en'].map((locale) => {
    const r = matchWarmFloorProductsV3({ ...base, locale });
    return JSON.stringify([r.calculation.targetInstalledPowerWm2, r.calculation.requiredTotalPowerW, r.variants.map((v) => v.mainProduct.id)]);
  });
  check(new Set(signatures).size === 1, 'locale changes numeric/product results');
  return { localeKeyCount: keys[0].length, numericLocaleInvariant: true };
});

run('15 regression: client API remains calculation source-of-truth', () => {
  const store = fs.readFileSync(path.join(root, 'client/src/features/warmFloor/store/useWarmFloorStore.ts'), 'utf8');
  check(!store.includes('calculateWarmFloor(') && !store.includes('getRecommendedAccessories('), 'legacy client calculation is still applied');
  check(store.includes("api<any>('/tools/warm-floor/recommendations'"), 'Warm Floor API call is missing');
  check(store.includes('const variants = safeRecordArray(recommendations?.variants);'), 'API variants are not runtime-normalized');
  check((store.match(/accessoryProducts: accessories/g) || []).length === 2, 'persisted and live API accessory assignments are not both verified');
  return { backendSourceOfTruth: true, apiArrayBoundaryNormalized: true, accessoryProductsAssignmentsVerified: 2 };
});

run('16 regression: versioned legacy hydration boundary', () => {
  const store = fs.readFileSync(path.join(root, 'client/src/features/warmFloor/store/useWarmFloorStore.ts'), 'utf8');
  check(store.includes('const WARM_FLOOR_DRAFT_VERSION = 2;'), 'persistence version 2 is missing');
  check(store.includes('return normalizeWarmFloorDraft(raw ? JSON.parse(raw) : {});'), 'JSON.parse result does not cross the normalization boundary');
  check(store.includes('accessoryProducts: safeRecordArray(persisted.accessoryProducts)'), 'accessoryProducts is not normalized with Array.isArray semantics');
  check(store.includes('accessoryReplacements: safeRecordArray(persisted.accessoryReplacements)'), 'accessoryReplacements is not normalized with Array.isArray semantics');
  check(store.includes('recommendedProducts: persisted.recommendedProducts ?? persisted.variants'), 'legacy variants migration is missing');
  check(store.includes('installationAreaM2: persisted.installationAreaM2 ?? persisted.heatedAreaM2'), 'legacy heatedAreaM2 migration is missing');
  const initializer = store.slice(store.indexOf('export const useWarmFloorStore'), store.indexOf('loadSettings: async'));
  check(initializer.indexOf('...persistedWarmFloorDraft') < initializer.indexOf('accessoryProducts: safeRecordArray'), 'raw persisted spread occurs after normalized arrays');
  check(!initializer.includes('persistedWarmFloorDraft.accessoryProducts || []'), 'truthy fallback still permits non-array persisted values');
  return { persistenceVersion: 2, nullAndWrongTypeBoundary: 'safeRecordArray', legacyAliases: true };
});

console.log(JSON.stringify({ pass: failures === 0, failures, scenarios: results }, null, 2));
process.exitCode = failures ? 1 : 0;
