import { db } from '../db.js';
import { productSelect } from '../utils/query.js';
import { toPublicProductCardDto } from '../utils/productDtos.js';
// Series kit ("Дополните комплект"): for wiring devices, suggest the most used
// items of the same design family (frames, switches, sockets, ...) and expose
// colour variants of the same model. Legrand names follow
// "<Type> [- <N модуль>] - <Family> [- <Colour>]", while series rows are
// fragmented (e.g. "Celiane белый", "Механизмы Valena Allure/Life"), so the
// family is resolved from both the series name and the product name.
const KIT_ROOT_SLUG = 'rozetki-i-vyklyuchateli';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 400;
const SERIES_WRAPPER_RE = /^(электроустановочные изделия|электротехнические изделия|главная|разное|специальные предложения|системы кабель-каналов|удлинители.*|legrand:.*|action)$/iu;
const SERIES_PREFIX_RE = /^(legrand серия|механизмы|рамки|лицевые панели|универсальные суппорты)\s+/iu;
const SERIES_COLOR_SUFFIX_RE = /\s+(белый|слоновая кость|графит|титан|антрацит|алюминий|серый|черный|чёрный|шампань|champagne)$/iu;
const GROUP_ORDER = [
    'Рамки',
    'Выключатели и кнопки',
    'Силовые розетки',
    'Розетки с USB',
    'Слаботочные и мультимедийные розетки',
    'Лицевые панели и клавиши',
    'Диммеры и светорегуляторы',
    'Датчики движения и присутствия',
    'Регуляторы вентилятора',
    'Термостаты',
    'Влагозащищенные и накладные выключатели',
    'Влагозащищенные и накладные розетки',
    'Монтажные коробки, суппорты и аксессуары',
];
// Lower index = more commonly needed in a typical apartment/house fit-out.
const ESSENTIAL_PATTERNS = [
    /^рамка 1 пост|^рамка 2 модул|^рамка одноместн/u,
    /^выключатель одноклавишный/u,
    /^(двойная )?розетка.*(2к\s*\+\s*з|2p\s*\+\s*e)/u,
    /^рамка 2 пост|^рамка 4 модул/u,
    /^выключатель двухклавишный/u,
    /^переключатель одноклавишный/u,
    /^лицевая панель.*(1 клавиш|выключател)/u,
    /^лицевая панель.*розетк/u,
    /^рамка 3 пост|^рамка 6 модул/u,
    /usb/u,
    /rj45/u,
    /tv|тв/u,
    /^переключатель двухклавишный/u,
    /светорегулятор|диммер/u,
    /суппорт|монтажная коробка/u,
    /^рамка [4-5] пост|^рамка 8 модул/u,
];
// Function words shared by a colourless mechanism and its cover plate ("Лицевая панель для розетки 2К+З").
const GENERIC_TOKENS = ['розетк', 'выключател', 'переключател', 'кнопк'];
const SPEC_TOKENS: [string, RegExp][] = [
    ['2к+з', /2к\+з/], ['2к', /2к(?![а-я])/], ['usb', /usb/], ['rj45', /rj45/], ['rj11', /rj11/], ['tv', /tv/], ['hdmi', /hdmi/],
    ['акустич', /акустич/], ['аудио', /аудио/], ['двойн', /двойн|2х2к/], ['одноклавиш', /одноклавиш|1клавиш/],
    ['двухклавиш', /двухклавиш|2клавиш/], ['трехклавиш', /трехклавиш|3клавиш/], ['светорегулятор', /светорегулятор|диммер/],
    ['термостат', /термостат/], ['датчик', /датчик/], ['жалюзи', /жалюзи/], ['звонок', /звонок/], ['подсветк', /подсветк/], ['ключ-карт', /ключ-карт/],
];
const PLATE_MATCH_MIN_SCORE = 10;
const PREFERRED_DEFAULT_COLORS = ['белый', 'white', 'matt white'];
const LATIN_HOMOGLYPHS: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к' };
type FamilyRegistry = {
    loadedAt: number;
    subtreeIds: Set<number>;
    families: Map<string, string>;
    seriesFamilies: Map<number, string[]>;
    aliases: Map<string, string>;
};
type ProductInfo = { familyKeys: string[]; typeKey: string; typeLabel: string; color: string; colorKey: string };
type FunctionTokens = { generic: string[]; spec: string[] };
type Candidate = { row: any; info: ProductInfo; plateMatch?: number };
type KitGroup = { key: string; title: string; items: Candidate[] };
type ColorCount = { key: string; label: string; count: number };

let familyCache: FamilyRegistry | null = null;
function fixHomoglyphs(value: string) {
    // "cлоновая", "слoновая" -> Cyrillic; only inside words that are otherwise Cyrillic.
    return value.replace(/[a-zа-я]+/g, (word) => (/[а-я]/.test(word) ? word.replace(/[acepoxyk]/g, (ch) => LATIN_HOMOGLYPHS[ch]) : word));
}
function normalizeKey(value: unknown) {
    return fixHomoglyphs(String(value || '')
        .toLocaleLowerCase('ru')
        .replace(/ё/g, 'е'))
        .replace(/aluminum/g, 'aluminium')
        .replace(/\s+/g, ' ')
        .trim();
}
function compactKey(value: unknown) {
    return normalizeKey(value).replace(/\s+/g, '');
}
function splitFamilyList(value: unknown) {
    const parts = String(value || '').split('/').map((item) => item.trim()).filter(Boolean);
    const result: string[] = [];
    for (const part of parts) {
        if (/^ip\s*\d/i.test(part))
            continue;
        // "Valena Allure/Life" -> "Valena Allure", "Valena Life"
        if (!/\s/.test(part) && result.length && /\s/.test(result[0]))
            result.push(`${result[0].split(/\s+/)[0]} ${part}`);
        else
            result.push(part);
    }
    return result;
}
function familiesFromSeriesName(seriesName: unknown) {
    let value = String(seriesName || '').trim();
    if (!value || SERIES_WRAPPER_RE.test(value))
        return [];
    value = value.replace(SERIES_PREFIX_RE, '').replace(SERIES_COLOR_SUFFIX_RE, '').trim();
    if (!value || SERIES_WRAPPER_RE.test(value))
        return [];
    return splitFamilyList(value);
}
function getFamilyRegistry(): FamilyRegistry {
    if (familyCache && Date.now() - familyCache.loadedAt < CACHE_TTL_MS)
        return familyCache;
    const root = db.prepare('SELECT id FROM categories WHERE slug = ? AND is_active = 1').get(KIT_ROOT_SLUG) as { id: number } | undefined;
    const subtreeIds = root ? db.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT ? UNION ALL SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.is_active = 1
      ) SELECT id FROM tree`).all(root.id).map((row: any) => Number(row.id)) as number[] : [];
    const seriesRows = subtreeIds.length ? db.prepare(`
      SELECT DISTINCT s.id, s.name FROM series s
      JOIN products p ON p.series_id = s.id AND p.is_active = 1
      WHERE COALESCE(p.primary_category_id, p.category_id) IN (${subtreeIds.map(() => '?').join(',')})`).all(...subtreeIds) as { id: number; name: string }[] : [];
    const families = new Map<string, string>(); // compact key -> display name
    const seriesFamilies = new Map<number, string[]>(); // series id -> family keys
    for (const row of seriesRows) {
        const names = familiesFromSeriesName(row.name);
        const keys: string[] = [];
        for (const name of names) {
            const key = compactKey(name);
            if (!key)
                continue;
            if (!families.has(key))
                families.set(key, name);
            keys.push(key);
        }
        seriesFamilies.set(Number(row.id), keys);
    }
    // Short aliases ("Mallia" -> "Mallia Senses", "Plexo" -> "Plexo IP 55") only when unambiguous.
    const firstWordCounts = new Map<string, number>();
    for (const name of families.values()) {
        const first = compactKey(name.split(/\s+/)[0]);
        firstWordCounts.set(first, (firstWordCounts.get(first) || 0) + 1);
    }
    const aliases = new Map<string, string>();
    for (const [key, name] of families) {
        aliases.set(key, key);
        const first = compactKey(name.split(/\s+/)[0]);
        if (first.length >= 4 && firstWordCounts.get(first) === 1 && !families.has(first))
            aliases.set(first, key);
    }
    familyCache = { loadedAt: Date.now(), subtreeIds: new Set(subtreeIds), families, seriesFamilies, aliases };
    return familyCache;
}
function parseProductName(name: unknown, registry: FamilyRegistry): ProductInfo {
    const parts = String(name || '').split(/\s+-\s+/).map((item) => item.trim()).filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
        let keys = splitFamilyList(parts[index])
            .map((part) => registry.aliases.get(compactKey(part)))
            .filter(Boolean) as string[];
        if (!keys.length) // e.g. "Адаптер - Arteor Mallia - Matt Black"
            keys = parts[index].split(/\s+/).map((word) => registry.aliases.get(compactKey(word))).filter(Boolean) as string[];
        if (!keys.length)
            continue;
        const colorPart = parts[index + 1] || '';
        const color = colorPart && !/\d/.test(colorPart) && colorPart.length <= 40 ? colorPart : '';
        return {
            familyKeys: keys,
            typeKey: normalizeKey(parts.slice(0, index).join(' - ')),
            typeLabel: parts[0],
            color,
            colorKey: normalizeKey(color),
        };
    }
    return { familyKeys: [], typeKey: normalizeKey(parts[0] || ''), typeLabel: parts[0] || '', color: '', colorKey: '' };
}
function describeProduct(row: any, registry: FamilyRegistry): ProductInfo {
    const parsed = parseProductName(row.name_ru, registry);
    const seriesKeys = registry.seriesFamilies.get(Number(row.series_id)) || [];
    const familyKeys = Array.from(new Set([...parsed.familyKeys, ...seriesKeys]));
    return { ...parsed, familyKeys };
}
function essentialRank(typeKey: string) {
    const index = ESSENTIAL_PATTERNS.findIndex((pattern) => pattern.test(typeKey));
    return index === -1 ? ESSENTIAL_PATTERNS.length : index;
}
function functionTokens(typeKey: string): FunctionTokens {
    const compact = typeKey.replace(/\s+/g, '')
        .replace(/(\d)k/g, '$1к') // latin "2K"
        .replace(/\+3/g, '+з'); // digit "2К+3"
    const generic = GENERIC_TOKENS.filter((token) => compact.includes(token));
    const spec = SPEC_TOKENS.filter(([, pattern]) => pattern.test(compact)).map(([name]) => name);
    // A switch mechanism without a key count is a single-key one ("Лицевая панель 1 клавиша").
    if (!/^лицевая панель/.test(typeKey) && (generic.includes('выключател') || generic.includes('переключател')) && !spec.some((token) => token.endsWith('клавиш')))
        spec.push('одноклавиш');
    return { generic, spec };
}
// Cover plate for a colourless mechanism: must share its specific function and add no other one.
function plateMatchScore(selfTokens: FunctionTokens | null, typeKey: string) {
    if (!selfTokens || !/^лицевая панель/.test(typeKey))
        return 0;
    const tokens = functionTokens(typeKey);
    const sharedSpec = tokens.spec.filter((token) => selfTokens.spec.includes(token)).length;
    const extraSpec = tokens.spec.filter((token) => !selfTokens.spec.includes(token)).length;
    const sharedGeneric = tokens.generic.filter((token) => selfTokens.generic.includes(token)).length;
    const score = sharedSpec * 10 + sharedGeneric - extraSpec * 10;
    return score >= PLATE_MATCH_MIN_SCORE ? score : 0;
}
function groupRank(categoryName: unknown) {
    const index = GROUP_ORDER.indexOf(String(categoryName || ''));
    return index === -1 ? GROUP_ORDER.length : index;
}
function salesByProduct(productIds: number[]) {
    if (!productIds.length)
        return new Map<number, number>();
    const rows = db.prepare(`SELECT product_id, SUM(quantity) AS qty FROM order_items WHERE product_id IN (${productIds.map(() => '?').join(',')}) GROUP BY product_id`).all(...productIds) as { product_id: number; qty: number }[];
    return new Map<number, number>(rows.map((row) => [Number(row.product_id), Number(row.qty) || 0]));
}
function toKitItemDto(row: any, info: ProductInfo) {
    const dto = toPublicProductCardDto(row);
    return {
        id: dto.id,
        slug: dto.slug,
        sku: dto.sku,
        name_ru: dto.name_ru,
        brand_name: dto.brand_name,
        price_amd: dto.price_amd,
        show_price: dto.show_price,
        unit: dto.unit,
        availability_status: dto.availability_status,
        availability_label: dto.availability_label,
        can_add_to_cart: dto.can_add_to_cart,
        cover_image: dto.cover_image,
        images: dto.images,
        color: info.color,
        color_key: info.colorKey,
        type_label: info.typeLabel,
    };
}
export function getProductSeriesKit(product: any) {
    const registry = getFamilyRegistry();
    const categoryId = Number(product.primary_category_id || product.category_id || 0);
    if (!registry.subtreeIds.has(categoryId))
        return null;
    const self = describeProduct(product, registry);
    if (!self.familyKeys.length)
        return null;
    const familyNames = self.familyKeys.map((key) => registry.families.get(key)).filter(Boolean) as string[];
    const seriesIds = Array.from(registry.seriesFamilies.entries())
        .filter(([, keys]) => keys.some((key) => self.familyKeys.includes(key)))
        .map(([id]) => id);
    const likeTerms = Array.from(new Set(familyNames.map((name) => name.split(/\s+/)[0])));
    const where = ['p.is_active = 1', 'p.id <> ?', `COALESCE(p.primary_category_id, p.category_id) IN (${Array.from(registry.subtreeIds).map(() => '?').join(',')})`];
    const params: unknown[] = [product.id, ...registry.subtreeIds];
    if (product.brand_id) {
        where.push('p.brand_id = ?');
        params.push(product.brand_id);
    }
    const anyOf: string[] = [];
    if (seriesIds.length) {
        anyOf.push(`p.series_id IN (${seriesIds.map(() => '?').join(',')})`);
        params.push(...seriesIds);
    }
    for (const term of likeTerms) {
        anyOf.push('p.name_ru LIKE ?');
        params.push(`%${term}%`);
    }
    if (!anyOf.length)
        return null;
    where.push(`(${anyOf.join(' OR ')})`);
    const rows = productSelect(where.join(' AND '), params).slice(0, MAX_CANDIDATES);
    const candidates: Candidate[] = rows
        .map((row: any) => ({ row, info: describeProduct(row, registry) }))
        .filter(({ info }: Candidate) => info.familyKeys.some((key) => self.familyKeys.includes(key)));
    if (!candidates.length)
        return null;
    const sales = salesByProduct(candidates.map(({ row }) => Number(row.id)));
    const selfTokens = self.colorKey ? null : functionTokens(self.typeKey);
    for (const candidate of candidates)
        candidate.plateMatch = plateMatchScore(selfTokens, candidate.info.typeKey);
    const score = ({ row, info, plateMatch }: Candidate) => {
        const inStock = Number(row.available_quantity) > 0 ? 1 : 0;
        const rank = plateMatch ? -plateMatch : essentialRank(info.typeKey);
        return rank * 1000 - Math.min(sales.get(Number(row.id)) || 0, 500) - inStock * 5;
    };
    const colorVariants = candidates
        .filter(({ info }) => info.typeKey === self.typeKey && info.colorKey && info.colorKey !== self.colorKey)
        .sort((a, b) => a.info.color.localeCompare(b.info.color, 'ru'))
        .map(({ row, info }) => ({ slug: String(row.slug), name_ru: String(row.name_ru), color: info.color, color_key: info.colorKey, cover_image: String(row.cover_image || ''), availability_status: toPublicProductCardDto(row).availability_status }));
    const groupsMap = new Map<string, KitGroup>();
    const colorCounts = new Map<string, ColorCount>();
    for (const candidate of candidates) {
        if (candidate.info.typeKey === self.typeKey)
            continue; // same model in another colour -> colorVariants
        const name = String(candidate.row.category_name || 'Другое');
        if (!groupsMap.has(name))
            groupsMap.set(name, { key: String(candidate.row.category_slug || name), title: name, items: [] });
        groupsMap.get(name)!.items.push(candidate);
        if (candidate.info.colorKey) {
            const entry = colorCounts.get(candidate.info.colorKey) || { key: candidate.info.colorKey, label: candidate.info.color, count: 0 };
            entry.count += 1;
            colorCounts.set(candidate.info.colorKey, entry);
        }
    }
    const hasPlateMatch = (group: KitGroup) => (group.items.some((item) => item.plateMatch! > 0) ? 0 : 1);
    const groups = Array.from(groupsMap.values())
        .sort((a, b) => hasPlateMatch(a) - hasPlateMatch(b) || groupRank(a.title) - groupRank(b.title) || a.title.localeCompare(b.title, 'ru'))
        .map((group) => ({
        key: group.key,
        title: group.title,
        items: group.items.sort((a, b) => score(a) - score(b) || String(a.row.name_ru).localeCompare(String(b.row.name_ru), 'ru')).map(({ row, info, plateMatch }) => ({ ...toKitItemDto(row, info), matches_product: plateMatch! > 0 })),
    }));
    if (!groups.length && !colorVariants.length)
        return null;
    const colors = Array.from(colorCounts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
    const preferredColor = PREFERRED_DEFAULT_COLORS.find((key) => colorCounts.has(key));
    const defaultColorKey = self.colorKey && colorCounts.has(self.colorKey) ? self.colorKey : (preferredColor || colors[0]?.key || '');
    return {
        familyName: familyNames.join(' / '),
        productColor: self.color,
        productColorKey: self.colorKey,
        defaultColorKey,
        colors,
        colorVariants,
        groups,
    };
}
