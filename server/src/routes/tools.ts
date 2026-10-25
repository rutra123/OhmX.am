// RECOVERY: parity-first TypeScript source reconstructed from verified production runtime JavaScript.
import { Router } from 'express';
import { db } from '../db.js';
import nodemailer from 'nodemailer';
import { DEFAULT_WARM_FLOOR_SETTINGS, } from '../utils/warmFloorCalculator.js';

type ProductRow = Record<string, any>;
type ProductDto = Record<string, any>;

const router = Router();
const tools = [
    {
        slug: 'ai-engineering-selector',
        name: 'ИИ-инженерный подбор оборудования',
        description: 'Подбор отопления, охлаждения, тёплого пола, котлов, конвекторов и сопутствующих товаров через диалог с ИИ.',
        cta: 'Открыть ИИ-подбор',
        href: '/tools/ai-engineering-selector',
    },
    {
        slug: 'power-calculator',
        name: 'Калькулятор мощности охлаждения/отопления',
        description: 'Предварительный расчёт требуемой мощности в кВт и подбор реальных товаров OhmX.am по наличию.',
        cta: 'Открыть калькулятор',
        href: '/tools/power-calculator',
    },
    { slug: 'warm-floor', name: 'Подбор электрического тёплого пола', description: 'Wizard-flow для кабелей, матов, монтажной ленты, терморегуляторов и аксессуаров.', href: '/tools/warm-floor', cta: 'Открыть калькулятор' },
];
const calculatorOptions = [
    { key: 'sunny_side', label: 'Солнечная сторона / много окон', coefficient: 0.15, modes: ['cooling'] },
    { key: 'kitchen_heat', label: 'Кухня или помещение с тепловыделением', coefficient: 0.20, modes: ['cooling'] },
    { key: 'many_people', label: 'Много людей в помещении', coefficient: 0.10, modes: ['cooling'] },
    { key: 'top_floor_poor_insulation', label: 'Последний этаж / плохо утеплённое помещение', coefficient: 0.20, modes: ['cooling'] },
    { key: 'power_reserve', label: 'Нужен запас мощности', coefficient: 0.10, modes: ['cooling', 'heating'] },
    { key: 'poor_insulation', label: 'Плохо утеплённое помещение', coefficient: 0.20, modes: ['heating'] },
    { key: 'corner_room', label: 'Угловая комната', coefficient: 0.10, modes: ['heating'] },
    { key: 'first_last_floor', label: 'Первый/последний этаж', coefficient: 0.10, modes: ['heating'] },
    { key: 'large_windows', label: 'Большие окна', coefficient: 0.15, modes: ['heating'] },
];
const coolingRanges = [
    { max: 2.1, label: 'до 2.1 кВт', minKw: 0, maxKw: 2.1 },
    { max: 2.6, label: '2.1–2.6 кВт', minKw: 2.1, maxKw: 2.6 },
    { max: 3.5, label: '2.6–3.5 кВт', minKw: 2.6, maxKw: 3.5 },
    { max: 5.0, label: '3.5–5.0 кВт', minKw: 3.5, maxKw: 5.0 },
    { max: 7.0, label: '5.0–7.0 кВт', minKw: 5.0, maxKw: 7.0 },
    { max: Infinity, label: 'выше 7.0 кВт', minKw: 7.0, maxKw: null },
];
const heatingRanges = [
    { max: 1.5, label: 'до 1.5 кВт', minKw: 0, maxKw: 1.5 },
    { max: 2.0, label: '1.5–2.0 кВт', minKw: 1.5, maxKw: 2.0 },
    { max: 3.0, label: '2.0–3.0 кВт', minKw: 2.0, maxKw: 3.0 },
    { max: 5.0, label: '3.0–5.0 кВт', minKw: 3.0, maxKw: 5.0 },
    { max: 7.0, label: '5.0–7.0 кВт', minKw: 5.0, maxKw: 7.0 },
    { max: Infinity, label: 'выше 7.0 кВт', minKw: 7.0, maxKw: null },
];
function cleanText(value: unknown): string {
    return String(value || '').toLowerCase().replace(/ё/g, 'е');
}
function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function standardRange(mode: string, requiredPowerKw: number) {
    const ranges = mode === 'cooling' ? coolingRanges : heatingRanges;
    return ranges.find((range) => requiredPowerKw <= range.max) || ranges[ranges.length - 1];
}
function normalizeAvailability(rawStatus: unknown, availableQuantity: number): string {
    const raw = cleanText(rawStatus).replace(/[-\s]+/g, '_');
    if (['in_stock', 'low_stock', 'preorder', 'unavailable'].includes(raw))
        return raw;
    if (raw.includes('заказ') || raw.includes('preorder'))
        return 'preorder';
    if (raw.includes('нет') || raw.includes('unavailable'))
        return 'unavailable';
    if (availableQuantity > 2)
        return 'in_stock';
    if (availableQuantity > 0)
        return 'low_stock';
    return 'preorder';
}
function availabilityRank(status: string): number {
    if (status === 'in_stock')
        return 0;
    if (status === 'low_stock')
        return 1;
    if (status === 'preorder')
        return 2;
    return 99;
}
/** Exported read-only for the full catalog export audit. */
export function parsePowerKw(row: ProductRow, mode: string): number | null {
    const explicit = Number(mode === 'cooling' ? row.cooling_power_kw : row.heating_power_kw);
    if (Number.isFinite(explicit) && explicit > 0)
        return round2(explicit);
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text, row.series_name].join(' '));
    const modeSpecific = mode === 'cooling'
        ? text.match(/(?:охл\\.?|охлажд\w*)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*квт/)
        : text.match(/(?:нагр\\.?|отопл\w*)[^\d]{0,12}(\d+(?:[.,]\d+)?)\s*квт/);
    if (modeSpecific)
        return round2(Number(modeSpecific[1].replace(',', '.')));
    const kw = text.match(/(\d+(?:[.,]\d+)?)\s*квт/);
    if (kw)
        return round2(Number(kw[1].replace(',', '.')));
    const watt = text.match(/(\d{3,5})\s*w\b|(?<!\d)(\d{3,5})\s*вт/);
    const watts = Number(watt?.[1] || watt?.[2] || 0);
    if (watts > 0 && watts <= 30000)
        return round2(watts / 1000);
    return null;
}
function matchesCoolingMain(row: ProductRow): boolean {
    const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type].join(' '));
    if (Number(row.suitable_for_cooling || 0) === 1)
        return true;
    return ['кондиционер', 'фанкойл', 'тепловой насос', 'чиллер', 'охлажд'].some((needle) => text.includes(needle));
}
function matchesHeatingMain(row: ProductRow): boolean {
    const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type].join(' '));
    if (Number(row.suitable_for_heating || 0) === 1)
        return true;
    return ['конвектор', 'радиатор', 'тепловой насос', 'водонагреватель', 'котел', 'нагревательный мат', 'нагревательный кабель', 'теплый пол', 'отопл'].some((needle) => text.includes(needle));
}
function accessoryKeywords(mode: string): string[] {
    return mode === 'cooling'
        ? ['кронштейн', 'медн', 'дренаж', 'кабель', 'автомат', 'вилка', 'розетк', 'монтажн']
        : ['термостат', 'кабель', 'автомат', 'креплен', 'кронштейн', 'фитинг', 'кран', 'арматур', 'монтажн', 'защит'];
}
function accessoryScore(row: ProductRow, mode: string): number {
    const text = cleanText([row.name_ru, row.category_name, row.series_name, row.accessory_group].join(' '));
    if (Number(row.accessory_default_enabled ?? 1) === 0)
        return -1;
    if (mode === 'cooling' && ['нагрев', 'теплый пол', 'тёплый пол', 'devisnow', 'eftcc', 'радиатор', 'конвектор'].some((needle) => text.includes(needle)))
        return -1;
    if (mode === 'heating' && ['охлажд', 'чиллер'].some((needle) => text.includes(needle)))
        return -1;
    const preferred = mode === 'cooling'
        ? ['кронштейн', 'медн', 'дренаж', 'монтажн', 'автомат', 'розетк', 'вилка', 'кабель']
        : ['термостат', 'креплен', 'кронштейн', 'фитинг', 'кран', 'арматур', 'защит', 'автомат', 'кабель', 'монтажн'];
    const index = preferred.findIndex((needle) => text.includes(needle));
    if (index >= 0)
        return index;
    if (Number(row.is_calculator_accessory || 0) === 1)
        return 20;
    return -1;
}
function matchesAccessory(row: ProductRow, mode: string): boolean {
    return accessoryScore(row, mode) >= 0;
}
function productDto(row: ProductRow, mode: string, kind: string): ProductDto {
    const availableQuantity = Number(row.available_quantity || 0);
    const availabilityStatus = normalizeAvailability(row.availability_status, availableQuantity);
    const powerKw = kind === 'main' ? parsePowerKw(row, mode) : null;
    return {
        id: Number(row.id),
        slug: row.slug,
        sku: row.sku,
        name: row.name_ru,
        brand: row.brand_name || '',
        article: row.supplier_reference || row.sku,
        powerKw,
        price: Number(row.show_price ?? 1) === 1 && Number(row.price_amd || 0) > 0 ? Number(row.price_amd) : null,
        currency: row.currency || 'AMD',
        image: row.cover_image || '',
        availabilityStatus,
        availabilityLabel: availabilityStatus === 'in_stock' ? 'В наличии' : availabilityStatus === 'low_stock' ? 'Мало' : availabilityStatus === 'preorder' ? 'Под заказ' : 'Недоступно',
        preorderNote: availabilityStatus === 'preorder' ? 'Поставка под заказ, срок уточняется' : '',
        equipmentType: row.equipment_type || '',
        energySource: row.energy_source || '',
        systemType: row.system_type || '',
    };
}
function productRows(): ProductRow[] {
    return db.prepare(`
    SELECT
      p.id, p.sku, p.name_ru, p.slug, p.short_description_ru, p.description_ru,
      p.price_amd, p.currency, p.show_price, p.availability_status,
      p.cooling_power_kw, p.heating_power_kw, p.recommended_area_m2,
      p.equipment_type, p.suitable_for_cooling, p.suitable_for_heating,
      p.is_calculator_accessory, p.accessory_group, p.accessory_default_enabled,
      p.energy_source, p.system_type, p.calculator_priority,
      p.warm_floor_product_type, p.warm_floor_linear_power_wm,
      p.warm_floor_cable_length_m, p.warm_floor_mat_area_m2,
      p.warm_floor_voltage_v, p.warm_floor_room_types,
      p.warm_floor_floor_coverings, p.warm_floor_substrate_types,
      p.warm_floor_wet_zone_allowed,
      b.name as brand_name, b.slug as brand_slug, c.name_ru as category_name, c.slug as category_slug, s.name as series_name,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order, i.id LIMIT 1) AS cover_image,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity,
      COALESCE((SELECT GROUP_CONCAT(feature_name || ' ' || feature_value || ' ' || COALESCE(feature_unit, ''), ' ') FROM product_features pf WHERE pf.product_id = p.id), '') AS feature_text
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE p.is_active = 1
  `).all() as ProductRow[];
}
function getWarmFloorSettings() {
    const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('warm_floor_calculator') as { value_json?: string } | undefined;
    if (!row?.value_json)
        return DEFAULT_WARM_FLOOR_SETTINGS;
    try {
        const saved = JSON.parse(row.value_json);
        return {
            ...DEFAULT_WARM_FLOOR_SETTINGS,
            ...saved,
            powerPresetsWm2: { ...DEFAULT_WARM_FLOOR_SETTINGS.powerPresetsWm2, ...(saved.powerPresetsWm2 || {}) },
            coveringCompatibility: { ...DEFAULT_WARM_FLOOR_SETTINGS.coveringCompatibility, ...(saved.coveringCompatibility || {}) },
            substrateCompatibility: { ...DEFAULT_WARM_FLOOR_SETTINGS.substrateCompatibility, ...(saved.substrateCompatibility || {}) },
            mountingTape: { ...DEFAULT_WARM_FLOOR_SETTINGS.mountingTape, ...(saved.mountingTape || {}) },
            accessoryRules: { ...DEFAULT_WARM_FLOOR_SETTINGS.accessoryRules, ...(saved.accessoryRules || {}) },
            warningTexts: { ...DEFAULT_WARM_FLOOR_SETTINGS.warningTexts, ...(saved.warningTexts || {}) },
        };
    }
    catch {
        return DEFAULT_WARM_FLOOR_SETTINGS;
    }
}
function textMatches(product: ProductDto, queries: string[]): boolean {
    const text = cleanText([product.name, product.brand, product.sku, product.article].join(' '));
    return queries.some((query) => text.includes(cleanText(query)));
}
function compatibleWarmFloorProduct(product: ProductDto, input: ProductRow): boolean {
    if (product.availabilityStatus === 'unavailable')
        return false;
    if (input.wetZone && product.wetZoneAllowed === false)
        return false;
    if (product.roomTypes?.length && !product.roomTypes.includes(input.roomPurpose))
        return false;
    if (product.floorCoverings?.length && !product.floorCoverings.includes(input.floorCovering))
        return false;
    if (product.substrateTypes?.length && !product.substrateTypes.includes(input.substrateType))
        return false;
    if (input.preferredBrands?.length && !input.preferredBrands.some((brand: unknown) => cleanText(product.brand).includes(cleanText(brand))))
        return false;
    return true;
}
function selectWarmFloorAccessories(products: ProductDto[], settings: typeof DEFAULT_WARM_FLOOR_SETTINGS, systemType: string): ProductDto[] {
    const wanted = [
        settings.accessoryRules.thermostat.query,
        settings.accessoryRules.floorSensor.query,
        settings.accessoryRules.corrugatedTube.query,
        settings.accessoryRules.protection.query,
    ];
    if (systemType === 'heating_cable' && settings.accessoryRules.mountingTape.requiredForCable)
        wanted.push(settings.accessoryRules.mountingTape.query);
    const accessories: ProductDto[] = [];
    for (const queries of wanted) {
        const found = products
            .filter((product) => !['heating_cable', 'heating_mat'].includes(product.productType))
            .filter((product) => product.availabilityStatus !== 'unavailable')
            .filter((product) => textMatches(product, queries))
            .sort((a, b) => (a.availabilityStatus === 'in_stock' ? 0 : 1) - (b.availabilityStatus === 'in_stock' ? 0 : 1) || Number(a.price || 999999999) - Number(b.price || 999999999))[0];
        if (found && !accessories.some((item) => item.id === found.id))
            accessories.push(found);
    }
    return accessories.slice(0, 8);
}
function selectMainProducts(mode: string, requiredPowerKw: number): ProductDto[] {
    const rows = productRows();
    const matches = rows
        .filter((row) => Number(row.is_calculator_accessory || 0) !== 1)
        .filter((row) => mode === 'cooling' ? matchesCoolingMain(row) : matchesHeatingMain(row))
        .map((row) => ({ row, powerKw: parsePowerKw(row, mode), status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)) }))
        .filter((item) => item.status !== 'unavailable')
        .map((item) => {
        const power = item.powerKw || 0;
        const powerDistance = power > 0 ? Math.abs(Math.max(requiredPowerKw, 0.1) - power) : 20;
        const underPenalty = power > 0 && power < requiredPowerKw ? 12 : 0;
        return { ...item, score: availabilityRank(item.status) * 100 + underPenalty + powerDistance };
    })
        .sort((a, b) => a.score - b.score || Number(b.row.price_amd || 0) - Number(a.row.price_amd || 0))
        .slice(0, 8)
        .map((item) => productDto(item.row, mode, 'main'));
    return matches;
}
function selectAccessories(mode: string): ProductDto[] {
    return productRows()
        .filter((row) => matchesAccessory(row, mode))
        .map((row) => ({ row, status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)) }))
        .filter((item) => item.status !== 'unavailable')
        .sort((a, b) => availabilityRank(a.status) - availabilityRank(b.status) || accessoryScore(a.row, mode) - accessoryScore(b.row, mode) || Number(b.row.price_amd || 0) - Number(a.row.price_amd || 0))
        .slice(0, 8)
        .map((item) => productDto(item.row, mode, 'accessory'));
}
const systemLabels = {
    gas_boiler: 'Газовый котёл',
    electric_boiler: 'Электрический котёл',
    heat_pump: 'Тепловой насос',
    electric_convector: 'Электрический конвектор',
    floor_heating: 'Тёплый пол / нагревательный кабель',
    infrared_heating: 'Инфракрасное отопление',
};
function systemMainScore(row: ProductRow, systemType: string): number {
    const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type, row.system_type, row.energy_source].join(' '));
    if (row.system_type === systemType)
        return 0;
    if (systemType === 'gas_boiler') {
        if (['электр', 'конвектор', 'тепловой насос', 'фанкойл', 'нагревательный кабель', 'теплый пол', 'инфракрас'].some((needle) => text.includes(needle)))
            return -1;
        if (text.includes('газ') && (text.includes('котел') || text.includes('котёл') || text.includes('boiler')))
            return 1;
        if ((text.includes('котел') || text.includes('котёл')) && ['beretta', 'riello', 'baltur'].some((needle) => text.includes(needle)))
            return 2;
    }
    if (systemType === 'electric_boiler') {
        if (['газ', 'конвектор', 'тепловой насос', 'фанкойл', 'нагревательный кабель', 'теплый пол'].some((needle) => text.includes(needle)))
            return -1;
        if (text.includes('электр') && (text.includes('котел') || text.includes('котёл')))
            return 1;
        if ((text.includes('котел') || text.includes('котёл')) && text.includes('квт'))
            return 4;
    }
    if (systemType === 'heat_pump') {
        if (['тепловой насос', 'heat pump'].some((needle) => text.includes(needle)))
            return 1;
    }
    if (systemType === 'electric_convector') {
        if (text.includes('конвектор') && !text.includes('водян'))
            return 1;
        if (text.includes('электр') && text.includes('обогрев'))
            return 3;
    }
    if (systemType === 'floor_heating') {
        if (['devisnow', 'iceguard', 'pipeguard', 'снегота', 'саморегулир', 'зеркал', 'ecofilm'].some((needle) => text.includes(needle)))
            return -1;
        if (['нагревательный мат', 'нагревательный кабель', 'теплый пол', 'тёплый пол', 'devimat', 'deviflex', 'deviheat'].some((needle) => text.includes(needle)))
            return 1;
    }
    if (systemType === 'infrared_heating') {
        if (['инфракрас', 'ик-', 'ir heater'].some((needle) => text.includes(needle)))
            return 1;
    }
    return -1;
}
function systemAccessoryScore(row: ProductRow, systemType: string): number {
    const text = cleanText([row.name_ru, row.category_name, row.series_name, row.equipment_type, row.accessory_group, row.system_type, row.energy_source].join(' '));
    if (Number(row.accessory_default_enabled ?? 1) === 0)
        return -1;
    if (row.system_type === 'accessory' || Number(row.is_calculator_accessory || 0) === 1) {
        const group = cleanText(row.accessory_group);
        if (group && (group.includes(systemType) || group.includes('universal')))
            return 0;
    }
    const lists: Record<string, string[]> = {
        gas_boiler: ['дымоход', 'коаксиал', 'насос', 'расширительный бак', 'группа безопасности', 'фильтр', 'кран', 'термостат', 'стабилизатор', 'ups', 'радиатор', 'коллектор', 'труб'],
        electric_boiler: ['автомат', 'дифавтомат', 'узо', 'кабель', 'термостат', 'насос', 'расширительный бак', 'группа безопасности', 'фитинг', 'кран'],
        heat_pump: ['кронштейн', 'автомат', 'кабель', 'дренаж', 'гидромодуль', 'буфер', 'термостат', 'монтажн'],
        electric_convector: ['термостат', 'розетк', 'вилка', 'автомат', 'кабель', 'креплен', 'кронштейн'],
        floor_heating: ['терморегулятор', 'devireg', 'датчик пола', 'монтажная лента', 'devifast', 'гофра', 'batibox', 'подрозетник', 'монтажная коробка', 'узо', 'вдт', 'авдт', 'дифавтомат', 'автоматический выключатель', 'контактор'],
        infrared_heating: ['термостат', 'розетк', 'вилка', 'автомат', 'кабель', 'креплен', 'кронштейн'],
    };
    if (systemType === 'floor_heating') {
        if (['охладител', 'бутылок', 'devisnow', 'снегота', 'eto2', 'etog', 'etor', 'devireg 850', 'радиаторн термо', 'living connect'].some((needle) => text.includes(needle)))
            return -1;
        if (['выключатель одноклавиш', 'выключатель двухклавиш', 'розетка 2к'].some((needle) => text.includes(needle)))
            return -1;
    }
    if (systemType === 'gas_boiler' && ['нагревательный кабель', 'devimat', 'deviflex', 'конвектор'].some((needle) => text.includes(needle)))
        return -1;
    if (systemType !== 'floor_heating' && ['devimat', 'deviflex', 'нагревательный мат', 'нагревательный кабель'].some((needle) => text.includes(needle)))
        return -1;
    const index = lists[systemType].findIndex((needle) => text.includes(needle));
    return index >= 0 ? index + 1 : -1;
}
function selectSystemMainProducts(mode: string, systemType: string, requiredPowerKw: number): ProductDto[] {
    return productRows()
        .filter((row) => Number(row.is_calculator_accessory || 0) !== 1)
        .map((row) => ({ row, systemScore: systemMainScore(row, systemType), powerKw: parsePowerKw(row, mode), status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)) }))
        .filter((item) => item.systemScore >= 0 && item.status !== 'unavailable')
        .map((item) => {
        const power = item.powerKw || 0;
        const powerDistance = power > 0 ? Math.abs(requiredPowerKw - power) : 12;
        const underPenalty = power > 0 && power < requiredPowerKw ? 8 : 0;
        const priority = Number(item.row.calculator_priority || 0);
        return { ...item, score: availabilityRank(item.status) * 100 + item.systemScore * 10 + underPenalty + powerDistance - priority };
    })
        .sort((a, b) => a.score - b.score || Number(b.row.price_amd || 0) - Number(a.row.price_amd || 0))
        .slice(0, 8)
        .map((item) => productDto(item.row, mode, 'main'));
}
function selectSystemAccessories(mode: string, systemType: string): ProductDto[] {
    // For electric floor heating reuse the professional warm-floor kit matcher.
    if (systemType === 'floor_heating') {
        try {
            const area = Math.max(4, Number(arguments[2]?.installationAreaM2 || 8));
            const result = matchWarmFloorProductsV3({
                roomType: 'other',
                roomAreaM2: area * 1.2,
                installationAreaM2: area,
                substrateType: 'concrete_screed',
                floorCovering: 'tile',
                heatingPurpose: 'comfort_floor',
                insulationLevel: 'standard',
                budgetLevel: 'optimal',
                includeAccessories: true,
                systemPreference: 'auto',
                wetZone: false,
                preferredBrands: [],
            });
            return ((result.accessories || []) as ProductDto[]).slice(0, 12).map((item) => ({
                id: item.id,
                slug: item.slug,
                sku: item.sku,
                name: item.name,
                brand: item.brand || '',
                article: item.article || item.sku,
                powerKw: null,
                price: item.price,
                currency: item.currency || 'AMD',
                image: item.image || '',
                availabilityStatus: item.availabilityStatus,
                availabilityLabel: item.availabilityLabel,
                preorderNote: item.availabilityStatus === 'preorder' ? 'Поставка под заказ, срок уточняется' : '',
                equipmentType: item.productType || item.accessoryGroup || 'accessory',
                energySource: 'electric',
                systemType: 'floor_heating',
                required: Boolean(item.required),
                accessoryGroup: item.accessoryGroup || '',
                note: item.note || '',
            }));
        }
        catch (err) {
            console.error('floor_heating accessory kit fallback:', err);
        }
    }
    const rows = productRows()
        .map((row) => ({ row, accessoryScore: systemAccessoryScore(row, systemType), status: normalizeAvailability(row.availability_status, Number(row.available_quantity || 0)) }))
        .filter((item) => item.accessoryScore >= 0 && item.status !== 'unavailable')
        .sort((a, b) => availabilityRank(a.status) - availabilityRank(b.status) || a.accessoryScore - b.accessoryScore || Number(b.row.price_amd || 0) - Number(a.row.price_amd || 0));
    // Diversify by keyword group so we don't return 8 similar thermostats.
    const picked: typeof rows = [];
    const used = new Set<any>();
    const groupNeedles: Record<string, string[]> = {
        gas_boiler: ['дымоход', 'коаксиал', 'насос', 'расширитель', 'групп', 'фильтр', 'кран', 'термостат', 'стабилиз', 'ups', 'радиатор', 'коллектор', 'труб'],
        electric_boiler: ['автомат', 'дифавт', 'узо', 'кабель', 'термостат', 'насос', 'расширитель', 'групп', 'фитинг', 'кран'],
        heat_pump: ['кронштейн', 'автомат', 'кабель', 'дренаж', 'гидромодул', 'буфер', 'термостат', 'монтажн'],
        electric_convector: ['термостат', 'розетк', 'вилка', 'автомат', 'кабель', 'креплен', 'кронштейн'],
        infrared_heating: ['термостат', 'розетк', 'вилка', 'автомат', 'кабель', 'креплен', 'кронштейн'],
        floor_heating: ['терморегулятор', 'devireg', 'датчик', 'лента', 'гофр', 'batibox', 'подрозет', 'узо', 'автоматический', 'контактор'],
    };
    const needles = groupNeedles[systemType] || [];
    for (const needle of needles) {
        const found = rows.find((item) => !used.has(item.row.id) && cleanText([item.row.name_ru, item.row.category_name, item.row.accessory_group].join(' ')).includes(needle));
        if (!found)
            continue;
        used.add(found.row.id);
        picked.push(found);
        if (picked.length >= 10)
            break;
    }
    for (const item of rows) {
        if (picked.length >= 10)
            break;
        if (used.has(item.row.id))
            continue;
        used.add(item.row.id);
        picked.push(item);
    }
    return picked.map((item) => productDto(item.row, mode, 'accessory'));
}
/**
 * Resolve system type from heating type + gas availability.
 * For water heating with gas → gas_boiler
 * For water heating without gas → electric_boiler
 * For electric heating → returns null (user picks sub-type on frontend)
 */
function resolveHeatingSystem(heatingType: string, hasGas: boolean): string | null {
    if (heatingType === 'water')
        return hasGas ? 'gas_boiler' : 'electric_boiler';
    return null; // electric — give generic products, user picks sub-type
}
function calculatePower(mode: string, area: number, ceilingHeight: number, optionKeys: string[]) {
    // Preliminary envelope method; full HVAC/heat-loss design requires a project calculation.
    const volumeRawM3 = area * ceilingHeight;
    const baseSpecificPowerKwM3 = mode === 'cooling' ? 0.040 : 0.050;
    const basePowerRawKw = volumeRawM3 * baseSpecificPowerKwM3;
    const allowedOptions = calculatorOptions.filter((option) => option.modes.includes(mode));
    const selectedOptions = allowedOptions.filter((option) => optionKeys.includes(option.key));
    const correctionRaw = selectedOptions.reduce((sum, option) => sum + option.coefficient, 0);
    const coefficientRaw = 1 + correctionRaw;
    const calculatedPowerRawKw = basePowerRawKw * coefficientRaw;
    const range = standardRange(mode, calculatedPowerRawKw);
    return {
        roomAreaM2: area,
        ceilingHeightM: ceilingHeight,
        volumeM3: round2(volumeRawM3),
        baseSpecificPowerWm3: baseSpecificPowerKwM3 * 1000,
        basePowerKw: round2(basePowerRawKw),
        coefficient: round2(coefficientRaw),
        correctionFactors: selectedOptions.map((option) => ({ key: option.key, coefficient: option.coefficient })),
        calculatedPowerKw: round2(calculatedPowerRawKw),
        requiredPowerKw: round2(calculatedPowerRawKw),
        recommendedPowerRange: { minKw: range.minKw, maxKw: range.maxKw },
        specificWm2: round2((calculatedPowerRawKw * 1000) / area),
        range,
        selectedOptions,
        method: mode === 'cooling' ? 'volume_specific_power_cooling' : 'volume_specific_power_heating',
        formula: mode === 'cooling' ? 'P = V * 0.040 * (1 + sum(k))' : 'P = V * 0.050 * (1 + sum(k))',
        disclaimerCode: 'calculator.power.result.engineeringDisclaimer',
    };
}

function buildPowerCalculationDetails(calculation: ReturnType<typeof calculatePower>, mode: string) {
    return {
        mode,
        roomAreaM2: calculation.roomAreaM2,
        area: calculation.roomAreaM2,
        ceilingHeightM: calculation.ceilingHeightM,
        ceilingHeight: calculation.ceilingHeightM,
        volumeM3: calculation.volumeM3,
        baseSpecificPowerWm3: calculation.baseSpecificPowerWm3,
        baseRate: calculation.baseSpecificPowerWm3 / 1000,
        basePowerKw: calculation.basePowerKw,
        correctionFactors: calculation.correctionFactors,
        coefficient: calculation.coefficient,
        calculatedPowerKw: calculation.calculatedPowerKw,
        recommendedPowerRange: calculation.recommendedPowerRange,
        specificWm2: calculation.specificWm2,
        method: calculation.method,
        formula: calculation.formula,
        selectedOptions: calculation.selectedOptions.map((option) => ({ key: option.key, coefficient: option.coefficient })),
        range: { minKw: calculation.range.minKw, maxKw: calculation.range.maxKw },
        disclaimerCode: calculation.disclaimerCode,
    };
}

router.get('/', (_req, res) => res.json(tools));
router.get('/power-calculator/options', (_req, res) => {
    res.json({ options: calculatorOptions, coolingRanges, heatingRanges });
});
router.get('/warm-floor/settings', (_req, res) => {
    res.json(getWarmFloorSettings());
});
import { matchWarmFloorProductsV3 } from '../utils/warmFloorMatcherV3.js';
function warmFloorSystemPreference(value: unknown): string {
    const text = String(value || 'auto');
    return text === 'mat' || text === 'cable' || text === 'auto' ? text : 'auto';
}
function warmFloorPreferredBrands(value: unknown): string[] {
    if (!Array.isArray(value))
        return [];
    return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5);
}
router.post('/warm-floor/recommendations', (req, res) => {
    const input = {
        roomType: req.body.roomPurpose || 'other',
        roomAreaM2: req.body.totalAreaM2,
        excludedAreaM2: req.body.excludedAreaM2,
        installationAreaM2: req.body.heatedAreaM2,
        substrateType: req.body.substrateType || 'concrete_screed',
        floorCovering: req.body.floorCovering || 'tile',
        heatingPurpose: req.body.heatingGoal || 'comfort_floor',
        insulationLevel: req.body.insulationLevel || 'standard',
        budgetLevel: req.body.budgetLevel || 'premium',
        includeAccessories: req.body.includeAccessories !== false,
        systemPreference: warmFloorSystemPreference(req.body.systemPreference),
        wetZone: Boolean(req.body.wetZone),
        preferredBrands: warmFloorPreferredBrands(req.body.preferredBrands),
        heatLossW: req.body.heatLossW,
        regionProfile: req.body.regionProfile || 'AM',
    };
    try {
        const result = matchWarmFloorProductsV3(input);
        res.json(result);
    }
    catch (err) {
        console.error('Warm floor recommendations error:', err);
        res.status(500).json({ error: (err as any).message });
    }
});
router.post('/power-calculator', (req, res) => {
    const mode = String(req.body?.mode || '');
    const area = Number(req.body?.area);
    const ceilingHeight = Number(req.body?.ceilingHeight ?? 2.7);
    const optionKeys = Array.isArray(req.body?.options) ? req.body.options.map(String) : [];
    const includeAccessories = req.body?.includeAccessories !== false;
    // New: heating-specific params
    const heatingType = String(req.body?.heatingType || '');
    const hasGas = req.body?.hasGas === true;
    if (!['cooling', 'heating'].includes(mode))
        return res.status(400).json({ errorCode: 'calculator.power.errors.invalidMode' });
    if (!Number.isFinite(area) || area <= 0 || area > 10000)
        return res.status(400).json({ errorCode: 'calculator.power.errors.invalidArea' });
    if (!Number.isFinite(ceilingHeight) || ceilingHeight <= 0 || ceilingHeight > 20)
        return res.status(400).json({ errorCode: 'calculator.power.errors.invalidHeight' });
    const calculation = calculatePower(mode, area, ceilingHeight, optionKeys);
    // If heating mode with explicit heatingType → use system-specific filtering directly
    if (mode === 'heating' && (heatingType === 'water' || heatingType === 'electric')) {
        const resolvedSystem = resolveHeatingSystem(heatingType, hasGas);
        if (resolvedSystem) {
            // Water heating resolved to a specific system type
            const mainProducts = selectSystemMainProducts(mode, resolvedSystem, calculation.requiredPowerKw);
            const accessories = includeAccessories ? selectSystemAccessories(mode, resolvedSystem) : [];
            return res.json({
                requiredPowerKw: calculation.requiredPowerKw,
                recommendedRange: calculation.recommendedPowerRange,
                mainProducts,
                accessories,
                heatingType,
                hasGas,
                resolvedSystem,
                calculationDetails: buildPowerCalculationDetails(calculation, mode),
            });
        }
        else {
            // Electric heating — give generic heating products, sub-type selection comes separately
            const mainProducts = selectMainProducts(mode, calculation.requiredPowerKw);
            const accessories = includeAccessories ? selectAccessories(mode) : [];
            return res.json({
                requiredPowerKw: calculation.requiredPowerKw,
                recommendedRange: calculation.recommendedPowerRange,
                mainProducts,
                accessories,
                heatingType,
                hasGas,
                resolvedSystem: null,
                calculationDetails: buildPowerCalculationDetails(calculation, mode),
            });
        }
    }
    // Default flow (cooling or heating without inline selection)
    const mainProducts = selectMainProducts(mode, calculation.requiredPowerKw);
    const accessories = includeAccessories ? selectAccessories(mode) : [];
    res.json({
        requiredPowerKw: calculation.requiredPowerKw,
        recommendedRange: calculation.recommendedPowerRange,
        mainProducts,
        accessories,
        calculationDetails: buildPowerCalculationDetails(calculation, mode),
    });
});
router.post('/power-calculator/recommendations', (req, res) => {
    const mode = String(req.body?.mode || 'heating');
    const energySource = String(req.body?.energySource || '');
    const systemType = String(req.body?.systemType || '');
    const requiredPowerKw = Number(req.body?.requiredPowerKw);
    const includeAccessories = req.body?.includeAccessories !== false;
    const allowedSystems = ['gas_boiler', 'electric_boiler', 'heat_pump', 'electric_convector', 'floor_heating', 'infrared_heating'];
    if (!['cooling', 'heating'].includes(mode))
        return res.status(400).json({ errorCode: 'calculator.power.errors.invalidMode' });
    if (!['gas', 'electric'].includes(energySource))
        return res.status(400).json({ error: 'energySource must be gas or electric' });
    if (!allowedSystems.includes(systemType))
        return res.status(400).json({ error: 'invalid systemType' });
    if (energySource === 'gas' && systemType !== 'gas_boiler')
        return res.status(400).json({ error: 'gas energySource supports only gas_boiler' });
    if (energySource === 'electric' && systemType === 'gas_boiler')
        return res.status(400).json({ error: 'electric energySource cannot use gas_boiler' });
    if (!Number.isFinite(requiredPowerKw) || requiredPowerKw <= 0 || requiredPowerKw > 200)
        return res.status(400).json({ error: 'requiredPowerKw must be a positive number' });
    const mainProducts = selectSystemMainProducts(mode, systemType, requiredPowerKw);
    const accessories = includeAccessories ? selectSystemAccessories(mode, systemType) : [];
    const notes = [
        { code: 'calculator.power.recommendations.nextStep', params: { systemType, requiredPowerKw: round2(requiredPowerKw) } },
        { code: 'calculator.power.result.engineeringDisclaimer', params: {} },
    ];
    if (!mainProducts.length)
        notes.push({ code: 'calculator.power.recommendations.noCatalogProduct', params: { systemType, requiredPowerKw: round2(requiredPowerKw) } });
    res.json({ systemType, energySource, mainProducts, accessories, notes });
});
router.post('/power-calculator/email', async (req, res) => {
    const { email, subject, htmlBody, textBody } = req.body || {};
    if (!email || !htmlBody) {
        return res.status(400).json({ error: 'email и htmlBody обязательны' });
    }
    // Build SMTP transporter from env
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || '587');
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const fromName = process.env.SMTP_FROM_NAME || 'OhmX.am';
    const fromEmail = process.env.SMTP_FROM || 'noreply@ohmx.am';
    if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(501).json({ error: 'SMTP не настроен. Укажите SMTP_HOST, SMTP_USER, SMTP_PASS в .env' });
    }
    try {
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: email,
            subject: subject || 'Подбор оборудования OhmX.am',
            text: textBody || '',
            html: htmlBody,
        });
        res.json({ ok: true, message: 'Письмо отправлено' });
    }
    catch (err) {
        console.error('Email send error:', (err as any)?.message);
        res.status(500).json({ error: 'Ошибка отправки письма: ' + ((err as any)?.message || 'неизвестная ошибка') });
    }
});
export default router;
