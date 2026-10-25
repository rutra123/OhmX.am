// RECOVERY: parity-first TypeScript source reconstructed from verified production runtime JavaScript.
import { db } from '../db.js';
import { getPublicAvailabilityStatus } from './publicAvailability.js';
import type { WarmFloorCatalogProduct } from './warmFloorCalculator.js';

type ProductRow = Record<string, any>;

function cleanText(value: unknown): string {
    return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function parseNumber(text: string, patterns: RegExp[]): number | null {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const raw = match?.[1] || match?.[2];
        if (raw) {
            const number = Number(String(raw).replace(',', '.'));
            if (Number.isFinite(number) && number > 0)
                return number;
        }
    }
    return null;
}

function parseList(value: unknown): string[] {
    const text = String(value || '').trim();
    if (!text)
        return [];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed))
            return parsed.map(String).filter(Boolean);
    }
    catch {
        // fall through
    }
    return text.split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function hasAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
}

/** Products that must never enter electric warm-floor selection. */
function isExcludedFromWarmFloor(text: string): boolean {
    return hasAny(text, [
        'devisnow',
        'iceguard',
        'pipeguard',
        'снегота',
        'снегоплав',
        'антиобледен',
        'roofhook',
        'для желоб',
        'для кровл',
        'для труб',
        'трубопровод',
        'зеркал',
        'ecofilm mhf',
        'охладител',
        'бутылок',
        'жидкост',
        'радиаторн',
        'living connect',
        'devireg 850',
        'eto2',
        'etog-',
        'etor-',
        'etr2-',
        'для холодиль',
        'для кондиционер',
        'для бойлер',
        'комфорт для воздуха',
    ]);
}

function isElectricFloorThermostat(text: string): boolean {
    if (isExcludedFromWarmFloor(text))
        return false;
    // Explicit outdoor / hydronic room stats without floor heating context
    if (hasAny(text, ['комнатный термостат']) && !hasAny(text, ['датчик пола', 'теплого пола', 'тёплого пола', 'warm floor', 'underfloor', 'devireg']))
        return false;
    if (hasAny(text, ['danfoss icon']) && !hasAny(text, ['датчик пола', 'ик датчик пола']))
        return false;
    return hasAny(text, [
        'devireg',
        'терморегулятор',
        'термостат',
    ]) && hasAny(text, [
        'датчик пола',
        'пола/воздуха',
        'теплого пола',
        'тёплого пола',
        'warm floor',
        'underfloor',
        'floor sensor',
        'devireg',
        'oj electronics',
        'etr/f',
        'otn-',
        'mwd5',
        'ocd5',
    ]);
}

function isModularBreaker(text: string, category: string): boolean {
    const hay = `${text} ${category}`;
    if (hasAny(hay, ['воздушный автоматический', 'dmx', 'dpx', 'силовой автоматический', 'защиты электродвигател']))
        return false;
    return hasAny(hay, [
        'автоматический выключатель',
        'модульн',
        'mcb',
        'tx³',
        'tx3',
        'dx³',
        'dx3',
        'rx³',
        'rx3',
    ]) && !hasAny(hay, ['узо', 'вдт', 'авдт', 'дифавт', 'rcd', 'rcbo']);
}

function isRcdOrRcbo(text: string, category: string): boolean {
    const hay = `${text} ${category}`;
    return hasAny(hay, ['узо', 'вдт', 'авдт', 'дифавт', 'дифференциальн', 'rcd', 'rcbo'])
        && !hasAny(hay, ['монтажная панель', 'без дифференциальной']);
}

function inferProductType(row: ProductRow): string {
    const explicit = String(row.warm_floor_product_type || '').trim();
    if (explicit)
        return explicit;

    const category = cleanText(row.category_name);
    const group = cleanText(row.accessory_group);
    const text = cleanText([
        row.name_ru,
        row.category_name,
        row.series_name,
        row.equipment_type,
        row.accessory_group,
        row.feature_text,
    ].join(' '));

    if (group && [
        'thermostat', 'floor_sensor', 'corrugated_tube', 'mounting_tape',
        'mounting_box', 'junction_box', 'protection', 'rcd', 'rcbo',
        'circuit_breaker', 'contactor', 'heating_cable', 'heating_mat',
    ].includes(group)) {
        return group === 'rcbo' || group === 'rcd' || group === 'circuit_breaker' ? group : group;
    }

    if (isExcludedFromWarmFloor(text)) {
        // Keep snow/pipe products out of floor heating main/accessory pools.
        if (hasAny(text, ['нагревательн']))
            return 'excluded_heating';
        return 'excluded';
    }

    if (hasAny(text, ['нагревательный мат', 'devimat', 'deviheat', 'ldts', 'heating mat'])
        && !hasAny(text, ['зеркал', 'ecofilm']))
        return 'heating_mat';

    if (hasAny(text, ['нагревательный кабель', 'deviflex', 'adpsv', 'adsv', 'asl1p', 'heating cable'])
        && !hasAny(text, ['саморегулир', 'devisnow', 'iceguard', 'pipeguard']))
        return 'heating_cable';

    if (hasAny(text, ['монтажная лента', 'крепежная лента', 'devifast', 'cablefix', 'ojt tape']))
        return 'mounting_tape';

    if (isElectricFloorThermostat(text))
        return 'thermostat';

    if (hasAny(text, ['датчик пола', 'floor sensor']) && !hasAny(text, ['снегота', 'грунта', 'влажност']))
        return 'floor_sensor';

    if (hasAny(text, ['гофра', 'гофротруб', 'трубка для датчик', 'sensor conduit', 'conduit for sensor']))
        return 'corrugated_tube';

    if (hasAny(text, ['batibox', 'подрозетник', 'монтажная коробка'])
        || category.includes('монтажные коробки'))
        return 'mounting_box';

    if (hasAny(text, ['распределительная коробка', 'распаечная коробка', 'junction box']))
        return 'junction_box';

    if (hasAny(text, ['контактор']) || category.includes('контакт'))
        return 'contactor';

    if (isRcdOrRcbo(text, category)) {
        if (hasAny(text, ['авдт', 'дифавт', 'rcbo']))
            return 'rcbo';
        return 'rcd';
    }

    if (isModularBreaker(text, category))
        return 'circuit_breaker';

    return 'accessory';
}

function inferPowerW(row: ProductRow): number | null {
    const explicitKw = Number(row.heating_power_kw || 0);
    if (Number.isFinite(explicitKw) && explicitKw > 0)
        return Math.round(explicitKw * 1000);
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    const watt = parseNumber(text, [/(\d{2,5}(?:[.,]\d+)?)\s*w\b/, /(\d{2,5}(?:[.,]\d+)?)\s*вт/]);
    if (watt && watt <= 50000)
        return Math.round(watt);
    const kw = parseNumber(text, [/(\d+(?:[.,]\d+)?)\s*квт/]);
    if (kw && kw <= 50)
        return Math.round(kw * 1000);
    return null;
}

function inferLinearPowerWm(row: ProductRow): number | null {
    const explicit = Number(row.warm_floor_linear_power_wm || 0);
    if (Number.isFinite(explicit) && explicit > 0)
        return explicit;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    return parseNumber(text, [
        /(\d{1,3}(?:[.,]\d+)?)\s*w\s*\/\s*m/,
        /(\d{1,3}(?:[.,]\d+)?)\s*вт\s*\/\s*м/,
        /(\d{1,3}(?:[.,]\d+)?)\s*вт\/м/,
    ]);
}

function inferCableLengthM(row: ProductRow, powerW: number | null, linearPowerWm: number | null): number | null {
    const explicit = Number(row.warm_floor_cable_length_m || 0);
    if (Number.isFinite(explicit) && explicit > 0)
        return explicit;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    // Prefer explicit length near power markers: "68m, 1220W"
    const paired = text.match(/(\d{1,4}(?:[.,]\d+)?)\s*m\s*,\s*(\d{2,5}(?:[.,]\d+)?)\s*w/);
    if (paired) {
        const length = Number(String(paired[1]).replace(',', '.'));
        if (Number.isFinite(length) && length > 0 && length <= 1000)
            return length;
    }
    const length = parseNumber(text, [/(\d{1,4}(?:[.,]\d+)?)\s*m\b/, /(\d{1,4}(?:[.,]\d+)?)\s*м\b/]);
    if (length && length <= 1000)
        return length;
    if (powerW && linearPowerWm)
        return Math.round((powerW / linearPowerWm) * 100) / 100;
    return null;
}

function inferMatAreaM2(row: ProductRow, powerW: number | null): number | null {
    const explicit = Number(row.warm_floor_mat_area_m2 || row.recommended_area_m2 || 0);
    if (Number.isFinite(explicit) && explicit > 0)
        return explicit;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    // DEVIheat style: 0,5x16m
    const roll = text.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*m\b/);
    if (roll) {
        const w = Number(String(roll[1]).replace(',', '.'));
        const l = Number(String(roll[2]).replace(',', '.'));
        if (Number.isFinite(w) && Number.isFinite(l) && w > 0 && l > 0 && w * l <= 200)
            return Math.round(w * l * 100) / 100;
    }
    const area = parseNumber(text, [/(\d{1,3}(?:[.,]\d+)?)\s*m2\b/, /(\d{1,3}(?:[.,]\d+)?)\s*м²/, /(\d{1,3}(?:[.,]\d+)?)\s*м2/]);
    if (area && area <= 200)
        return area;
    if (powerW)
        return Math.round((powerW / 150) * 100) / 100;
    return null;
}

function inferVoltage(row: ProductRow): number {
    const explicit = Number(row.warm_floor_voltage_v || 0);
    if (Number.isFinite(explicit) && explicit > 0)
        return explicit;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    return parseNumber(text, [/(220|230|240|380|400)\s*v\b/, /(220|230|240|380|400)\s*в\b/]) || 230;
}

function inferMaxResistiveLoadA(row: ProductRow, productType: string): number | null {
    if (productType !== 'thermostat' && productType !== 'contactor')
        return null;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    const amps = parseNumber(text, [/(\d{1,3}(?:[.,]\d+)?)\s*a\b/, /(\d{1,3}(?:[.,]\d+)?)\s*а\b/]);
    return amps || (productType === 'thermostat' ? 16 : null);
}

function inferSensorIncluded(row: ProductRow, productType: string): boolean | null {
    if (productType !== 'thermostat')
        return null;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    if (hasAny(text, ['без датчик']))
        return false;
    if (hasAny(text, ['с датчиком пола', 'датчик пола', 'floor sensor', 'датчиком пола/воздуха']))
        return true;
    // DEVIreg family typically ships with floor sensor
    if (hasAny(text, ['devireg']))
        return true;
    return null;
}

function inferRatedCurrentA(row: ProductRow, productType: string): number | null {
    if (!['rcd', 'rcbo', 'circuit_breaker', 'contactor', 'protection'].includes(productType))
        return null;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    const patterns = [
        /\bac\s*(\d{1,3})\s*a\b/,
        /\b[cdb]\s*(\d{1,3})\s*a\b/,
        /\b(\d{1,3})\s*a\b/,
        /\b(\d{1,3})\s*а\b/,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match)
            continue;
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0 && value <= 400)
            return value;
    }
    return null;
}

function inferTripMa(row: ProductRow, productType: string): number | null {
    if (!['rcd', 'rcbo', 'protection'].includes(productType))
        return null;
    const text = cleanText([row.name_ru, row.short_description_ru, row.description_ru, row.feature_text].join(' '));
    return parseNumber(text, [/(\d{1,4})\s*ma\b/, /(\d{1,4})\s*ма\b/]);
}

function availabilityFromRow(row: ProductRow): WarmFloorCatalogProduct['availabilityStatus'] {
    const publicStatus = getPublicAvailabilityStatus(Number(row.available_quantity || 0), Number(row.price_amd || 0));
    if (publicStatus === 'available_to_order')
        return Number(row.available_quantity || 0) > 2 ? 'in_stock' : 'low_stock';
    if (publicStatus === 'preorder' || publicStatus === 'request_price_and_eta' || publicStatus === 'price_on_request')
        return 'preorder';
    return 'unavailable';
}

function availabilityLabel(status: WarmFloorCatalogProduct['availabilityStatus']): string {
    if (status === 'in_stock')
        return 'В наличии';
    if (status === 'low_stock')
        return 'Мало';
    if (status === 'preorder')
        return 'Под заказ';
    return 'Недоступно';
}

/** Catalog rows read by the warm-floor calculator (also used read-only by the full catalog export audit). */
export const WARM_FLOOR_PRODUCT_SQL = `
    SELECT
      p.id, p.sku, p.name_ru, p.slug, p.short_description_ru, p.description_ru,
      p.price_amd, p.currency, p.show_price, p.availability_status,
      p.heating_power_kw, p.recommended_area_m2, p.equipment_type,
      p.accessory_group, p.energy_source, p.system_type, p.calculator_priority,
      p.warm_floor_product_type, p.warm_floor_linear_power_wm,
      p.warm_floor_cable_length_m, p.warm_floor_mat_area_m2,
      p.warm_floor_voltage_v, p.warm_floor_room_types,
      p.warm_floor_floor_coverings, p.warm_floor_substrate_types,
      p.warm_floor_wet_zone_allowed,
      b.name as brand_name, c.name_ru as category_name, s.name as series_name,
      (SELECT image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order, i.id LIMIT 1) AS cover_image,
      COALESCE((SELECT SUM(st.available_quantity) FROM stock st WHERE st.product_id = p.id), 0) AS available_quantity,
      COALESCE((SELECT GROUP_CONCAT(feature_name || ' ' || feature_value || ' ' || COALESCE(feature_unit, ''), ' ') FROM product_features pf WHERE pf.product_id = p.id), '') AS feature_text
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = COALESCE(p.primary_category_id, p.category_id)
    LEFT JOIN series s ON s.id = p.series_id
    WHERE p.is_active = 1
  `;

/** One catalog row as the warm-floor calculator sees it, including inferred values; excluded types are kept here. */
export function warmFloorProductFromRow(row: ProductRow): WarmFloorCatalogProduct & Record<string, any> {
        const productType = inferProductType(row);
        const powerW = inferPowerW(row);
        const linearPowerWm = inferLinearPowerWm(row);
        const cableLengthM = productType === 'heating_cable' ? inferCableLengthM(row, powerW, linearPowerWm) : null;
        const matAreaM2 = productType === 'heating_mat' ? inferMatAreaM2(row, powerW) : null;
        const availabilityStatus = availabilityFromRow(row);
        const accessoryGroup = String(row.accessory_group || '').trim() || (
            ['thermostat', 'floor_sensor', 'corrugated_tube', 'mounting_tape', 'mounting_box', 'junction_box', 'rcd', 'rcbo', 'circuit_breaker', 'contactor', 'protection'].includes(productType)
                ? productType
                : ''
        );
        const substrateTypes = parseList(row.warm_floor_substrate_types);
        const floorCoverings = parseList(row.warm_floor_floor_coverings);
        const seriesText = cleanText(`${row.brand_name || ''} ${row.name_ru || ''} ${row.name_hy || ''} ${row.name_en || ''}`);
        const seriesApprovedForThinLayer = /deviheat|devimat|fenix\s+ldts/.test(seriesText);
        const seriesApprovedForWetZone = /deviheat|devimat|deviflex|fenix\s+(?:ldts|adsv|asv)/.test(seriesText);
        return {
            id: Number(row.id),
            slug: row.slug,
            sku: row.sku,
            name: row.name_ru,
            brand: row.brand_name || '',
            article: row.supplier_reference || row.sku,
            price: Number(row.show_price ?? 1) === 1 && Number(row.price_amd || 0) > 0 ? Number(row.price_amd) : null,
            currency: row.currency || 'AMD',
            image: row.cover_image || '',
            availabilityStatus,
            availabilityLabel: availabilityLabel(availabilityStatus),
            productType,
            accessoryGroup,
            powerW,
            powerKw: powerW ? Math.round((powerW / 1000) * 100) / 100 : null,
            linearPowerWm,
            cableLengthM,
            matAreaM2,
            voltageV: inferVoltage(row),
            maxResistiveLoadA: inferMaxResistiveLoadA(row, productType),
            sensorIncluded: inferSensorIncluded(row, productType),
            ratedCurrentA: inferRatedCurrentA(row, productType),
            tripCurrentMa: inferTripMa(row, productType),
            roomTypes: parseList(row.warm_floor_room_types),
            floorCoverings,
            substrateTypes,
            metadataExplicit: Boolean(String(row.warm_floor_product_type || '').trim()),
            approvedForThinLayer: substrateTypes.some((value) => ['tile_adhesive', 'old_tile'].includes(cleanText(value).replace(/[\s-]+/g, '_'))) || seriesApprovedForThinLayer,
            isSpecialDrySystem: cleanText([row.system_type, row.equipment_type, row.feature_text].join(' ')).includes('dry_system'),
            wetZoneAllowed: row.warm_floor_wet_zone_allowed === null || row.warm_floor_wet_zone_allowed === undefined
                ? (seriesApprovedForWetZone ? true : null)
                : Boolean(row.warm_floor_wet_zone_allowed),
            calculatorPriority: Number(row.calculator_priority || 0),
            categoryName: row.category_name || '',
        } as WarmFloorCatalogProduct & Record<string, any>;
}

export function warmFloorProductRows(): WarmFloorCatalogProduct[] {
    const rows = db.prepare(WARM_FLOOR_PRODUCT_SQL).all() as ProductRow[];
    return rows.map(warmFloorProductFromRow).filter((product) => !String(product.productType || '').startsWith('excluded'));
}
