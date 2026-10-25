import { db } from '../db.js';
// In-memory catalog search (≈5k products): one SQL load, then millisecond queries.
// Handles Russian word forms (simple stemming), Cyrillic/Latin look-alikes in technical
// tokens ("16А" = "16A", "3х2,5" = "3x2.5"), Russian spellings of brands/series,
// domain synonyms, typo tolerance and wrong keyboard layout.
const REFRESH_CHECK_MS = 30 * 1000;
const STOP_WORDS = new Set(['и', 'в', 'во', 'на', 'с', 'со', 'для', 'по', 'под', 'из', 'от', 'до', 'к', 'без', 'или', 'а', 'the', 'for', 'with', 'and', 'шт']);
const RU_ENDINGS = ['иями', 'ями', 'ами', 'ыми', 'ими', 'его', 'ого', 'ему', 'ому', 'ешь', 'ете', 'ией', 'ий', 'ый', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ую', 'юю', 'ов', 'ев', 'ей', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ью', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь', 'й'];
// Cyrillic letters that users type instead of Latin ones in technical tokens (inside tokens with digits).
const TECH_HOMOGLYPHS: Record<string, string> = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', х: 'x', у: 'y', з: '3' };
// Russian spellings of Latin brand / series names (added to the indexed brand/series text).
const NAME_ALIASES: Record<string, string[]> = {
    legrand: ['легранд', 'лигранд', 'легран'], danfoss: ['данфосс', 'данфос'], emmeti: ['эммети', 'емети', 'эмети'], riello: ['риелло', 'риэлло', 'риело'],
    fiv: ['фив'], devi: ['деви', 'devireg'], fenix: ['феникс'], geya: ['гея', 'гейя'], bps: ['бпс'], kvz: ['квз'], jsl: ['джсл'], apc: ['апс', 'эпс'],
    massive: ['массив'], beretta: ['беретта', 'берета'], ideal: ['идеал'], lux: ['люкс'], flexicore: ['флексикор'], poletti: ['полетти', 'полети'],
    lapp: ['лапп', 'лап'], tecofi: ['текофи'], licon: ['ликон'], intuis: ['интуис'], airelec: ['айрелек', 'эрелек'], krats: ['кратс'], dab: ['даб'],
    cablofil: ['каблофил'], bastion: ['бастион'], finder: ['финдер'], imas: ['имас'], korado: ['корадо'], philips: ['филипс'], calpeda: ['кальпеда', 'калпеда'],
    baltur: ['балтур'], tica: ['тика'], sira: ['сира'], savva: ['савва'], longwell: ['лонгвел'], thermostats: ['термостатс'],
    arteor: ['артеор', 'артиор'], valena: ['валена'], allure: ['аллюр', 'алюр'], life: ['лайф'], suno: ['суно'], niloe: ['нилое', 'нилоэ', 'нило'], step: ['степ'],
    mosaic: ['мозаик', 'мозаика'], plexo: ['плексо'], mallia: ['маллия', 'малия', 'маллиа'], senses: ['сенсес'], inspiria: ['инспирия'], celiane: ['селиан', 'селиане'],
    quteo: ['кутео'], forix: ['форикс'], cariva: ['карива'], etika: ['этика'], practibox: ['практибокс'], wago: ['ваго'], schuko: ['шуко'],
};
// Query-side synonyms: stem -> alternative stems (any of them satisfies the query word).
const SYNONYMS: Record<string, string[]> = {
    заземл: ['заземл', '2k+3', '2p+e', 'schuko'],
    двойн: ['двойн', 'двухклавиш', '2x2k+3'], двухклавишн: ['двухклавиш', 'двойн'],
    проходн: ['проходн', 'переключател'], дифавтомат: ['авдт', 'дифференц', 'дифавтомат'], диф: ['авдт', 'дифференц', 'дифавтомат'], дифф: ['авдт', 'дифференц'],
    автомат: ['автомат'], кондиционер: ['кондиционер', 'сплит', 'фанкойл'], кондей: ['кондиционер', 'сплит', 'фанкойл'],
    зарядк: ['заряд', 'usb'], зарядн: ['заряд', 'usb'], интернет: ['rj45', 'интернет', 'информацион'], компьютерн: ['rj45', 'информацион'],
    тв: ['tv', 'тв', 'телевиз'], телевизионн: ['tv', 'тв', 'телевиз'], телевизор: ['tv', 'тв', 'телевиз'], антенн: ['tv', 'антенн'],
    терморегулятор: ['терморегулятор', 'термостат'], термостат: ['термостат', 'терморегулятор'],
    щиток: ['щит', 'бокс', 'шкаф'], щит: ['щит', 'бокс', 'шкаф'], бокс: ['бокс', 'щит'],
    гофр: ['гофр', 'электропроводк'], гофротруб: ['гофр', 'электропроводк'], ваго: ['wago', 'клемм'], wago: ['wago', 'клемм'], клемм: ['клемм', 'wago'],
    удлинител: ['удлинител', 'многорозеточн'], переноск: ['удлинител', 'многорозеточн'], тройник: ['тройник', 'многорозеточн'],
    лампочк: ['ламп'], провод: ['провод', 'кабел'], кабел: ['кабел', 'провод'], светорегулятор: ['светорегулятор', 'диммер'], диммер: ['диммер', 'светорегулятор'],
    бел: ['бел', 'white'], white: ['white', 'бел'], черн: ['черн', 'black'], black: ['black', 'черн'], сер: ['сер', 'grey', 'gray'],
    сереб: ['сереб', 'silver'], золот: ['золот', 'gold'], бронз: ['бронз', 'bronze'], алюмин: ['алюмин', 'aluminium', 'aluminum'],
    слонов: ['слонов', 'ivory'], бежев: ['беж', 'бежев'], котел: ['котл', 'котел'], котл: ['котл', 'котел'], насос: ['насос'],
    счетчик: ['счетчик', 'счетч'], пускател: ['пускател', 'контактор'], контактор: ['контактор', 'пускател'],
};
// Multi-word phrases rewritten before tokenizing.
const PHRASES: [RegExp, string][] = [
    [/двойн\S*\s+выключател\S*|выключател\S*\s+двойн\S*/g, 'выключатель двухклавишный'],
    [/тройн\S*\s+выключател\S*|выключател\S*\s+тройн\S*/g, 'выключатель трехклавишный'],
    [/двойн\S*\s+рамк\S*|рамк\S*\s+двойн\S*/g, 'рамка 2 поста'],
    [/тройн\S*\s+рамк\S*|рамк\S*\s+тройн\S*/g, 'рамка 3 поста'],
    [/одинарн\S*\s+рамк\S*|рамк\S*\s+одинарн\S*/g, 'рамка 1 пост'],
    [/кабель[\s-]+канал\S*/g, 'кабель-канал'],
    [/диф\S*\s+автомат\S*/g, 'дифавтомат'],
    [/сплит[\s-]+систем\S*/g, 'сплит кондиционер'],
    [/тепл\S*\s+пол\S*/g, 'теплый пол'],
];
const EN_TO_RU_LAYOUT: Record<string, string> = Object.fromEntries([...'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`'].map((ch, i) => [ch, 'йцукенгшщзхъфывапролджэячсмитьбюё'[i]]));
const RU_TO_EN_LAYOUT: Record<string, string> = Object.fromEntries(Object.entries(EN_TO_RU_LAYOUT).map(([en, ru]) => [ru, en]));
const FIELD_WEIGHTS: Record<SearchField | 'sku', number> = { sku: 6, name: 5, alias: 4, series: 3, brand: 3, category: 3, feature: 2, description: 1 };
type SearchField = 'name' | 'alias' | 'series' | 'brand' | 'category' | 'feature' | 'description';

export type IndexedProduct = {
    id: number;
    skuCompact: string;
    refCompact: string;
    nameFolded: string;
    firstStem: string;
    fields: Record<SearchField, string[]>;
    inStock: boolean;
    hasPrice: boolean;
    hasImage: boolean;
    isFeatured: boolean;
};

export type CatalogSearchIndex = {
    signature: string;
    builtAt: number;
    products: IndexedProduct[];
    categories: { id: number; stems: Set<string>; sortOrder: number }[];
    brands: { id: number; stems: Set<string> }[];
    vocabulary: string[];
};

type QueryGroup = { token: string; alternatives: string[]; fuzzy: string[]; hasDirect: boolean; matchMap: Map<string, number> };
type ParsedQuery = { groups: QueryGroup[]; folded: string; fuzzyUsed: boolean };
export type CatalogSearchResult = { ids: number[]; relaxed: boolean; correctedQuery: string; fuzzy: boolean; query: ParsedQuery };

type CategoryRow = { id: number; parent_id: number | null; name_ru: string; slug: string; sort_order: number; is_public: number };
type ProductRow = {
    id: number; sku: string; supplier_reference: string; name_ru: string; name_en: string; name_hy: string;
    short_description_ru: string; category_id: number | null; is_featured: number; price_amd: number;
    brand_name: string | null; series_name: string | null;
};
type Scored = { id: number; score: number; featured: boolean };

let index: CatalogSearchIndex | null = null;
let lastCheckAt = 0;
export function foldText(value: unknown) {
    // toLowerCase (not toLocaleLowerCase): identical for ru/en and ~4x faster on the Pi
    let text = String(value ?? '');
    if (text.includes('<'))
        text = text.replace(/<[^>]*>/g, ' ');
    if (text.includes('&'))
        text = text.replace(/&nbsp;|&[a-z]+;/gi, ' ');
    text = text.normalize('NFKC').toLowerCase();
    if (text.includes('ё'))
        text = text.replace(/ё/g, 'е');
    if (/\d/.test(text)) {
        text = text.replace(/×/g, 'x').replace(/(\d)\s*[*хx]\s*(\d)/g, '$1x$2').replace(/(\d),(\d)/g, '$1.$2');
    }
    return text;
}
function canonicalTechToken(token: string) {
    // digits ("16а", "3х2.5") or mixed scripts ("аrteor"): Cyrillic look-alikes -> Latin
    if (!/\d/.test(token) && !(/[a-z]/.test(token) && /[а-я]/.test(token)))
        return token;
    return token.replace(/[а-я]/g, (ch) => TECH_HOMOGLYPHS[ch] || ch);
}
export function stemWord(token: string) {
    if (!/^[а-я]+$/.test(token) || token.length <= 3)
        return token;
    for (const ending of RU_ENDINGS) {
        if (token.endsWith(ending) && token.length - ending.length >= 3)
            return token.slice(0, -ending.length);
    }
    return token;
}
const TOKEN_SPLIT_RE = /[^\p{L}\p{N}+.]+/u;
/** Tokens of a folded text, including numeric sub-parts ("c16a" -> c16a, c16, c, 16, a). */
function tokenize(text: unknown) {
    const out: string[] = [];
    for (let token of foldText(text).split(TOKEN_SPLIT_RE)) {
        if (!token)
            continue;
        if (token.includes('.') || token.includes('+'))
            token = token.replace(/^[.+]+|[.+]+$/g, '');
        if (!token)
            continue;
        token = canonicalTechToken(token);
        out.push(token);
        if (!/\d/.test(token) || !/[a-zа-я]/.test(token))
            continue;
        const unitless = token.match(/^([a-z]+\d+(?:\.\d+)?)[a-z]+$/); // "c16a" -> "c16"
        if (unitless)
            out.push(unitless[1]);
        for (const part of token.split(/(\d+(?:\.\d+)?)/)) {
            const clean = part.replace(/^[+.]+|[+.]+$/g, '');
            if (clean && clean !== token)
                out.push(clean);
        }
    }
    return out;
}
function stemsOf(text: unknown) {
    return tokenize(text).map(stemWord);
}
function aliasText(text: unknown) {
    const words = foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return words.flatMap((word) => NAME_ALIASES[word] || []).join(' ');
}
function loadSignature(): string {
    return db.prepare(`SELECT
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') || ':' || SUM(is_active) FROM products) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM product_images) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM categories) || '|' ||
      (SELECT COUNT(*) FROM brands) || '|' || (SELECT COUNT(*) FROM series) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM product_features) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM product_attributes WHERE attribute_key = 'product_type') AS sig`).get().sig;
}
async function buildIndex(signature: string, cooperative: boolean): Promise<CatalogSearchIndex> {
    const categories = db.prepare('SELECT id, parent_id, name_ru, slug, sort_order, COALESCE(is_public, 1) AS is_public FROM categories WHERE is_active = 1').all() as CategoryRow[];
    const categoryById = new Map(categories.map((row) => [Number(row.id), row]));
    const isAncestorOf = (candidateId: number, categoryId: number) => {
        let current = categoryById.get(Number(categoryId));
        const seen = new Set<number>();
        while (current?.parent_id && !seen.has(current.id)) {
            seen.add(current.id);
            if (Number(current.parent_id) === candidateId)
                return true;
            current = categoryById.get(Number(current.parent_id));
        }
        return false;
    };
    // Only the product's own (leaf) categories: the root "Розетки и выключатели" must not make every frame match "розетка".
    const leafCategoryNames = (ids: number[]) => ids
        .filter((id) => !ids.some((other) => other !== id && isAncestorOf(id, other)))
        .map((id) => categoryById.get(id)?.name_ru || '');
    const rows = db.prepare(`
      SELECT p.id, p.sku, COALESCE(p.supplier_reference, '') AS supplier_reference, p.name_ru, COALESCE(p.name_en, '') AS name_en, COALESCE(p.name_hy, '') AS name_hy,
        COALESCE(p.short_description_ru, '') AS short_description_ru, COALESCE(p.primary_category_id, p.category_id) AS category_id,
        COALESCE(p.is_featured, 0) AS is_featured, COALESCE(p.price_amd, 0) AS price_amd,
        b.name AS brand_name, s.name AS series_name
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN series s ON s.id = p.series_id
      WHERE p.is_active = 1`).all() as ProductRow[];
    const qtyByProduct = new Map<number, number>(db.prepare('SELECT product_id, SUM(available_quantity) AS qty FROM stock GROUP BY product_id').all().map((row: any) => [Number(row.product_id), Number(row.qty) || 0]));
    const withImage = new Set(db.prepare("SELECT DISTINCT product_id FROM product_images WHERE image_url LIKE '/storage/%'").all().map((row: any) => Number(row.product_id)));
    const linkedCategories = new Map<number, number[]>();
    for (const row of db.prepare('SELECT product_id, category_id FROM product_categories').all() as { product_id: number; category_id: number }[]) {
        const list = linkedCategories.get(Number(row.product_id)) || [];
        list.push(Number(row.category_id));
        linkedCategories.set(Number(row.product_id), list);
    }
    const featureRows = db.prepare("SELECT product_id, feature_name, feature_value FROM product_features WHERE LOWER(TRIM(feature_name)) <> 'source'").all() as { product_id: number; feature_name: string; feature_value: string }[];
    const featuresByProduct = new Map<number, string[]>();
    for (const row of featureRows) {
        const list = featuresByProduct.get(row.product_id) || [];
        list.push(`${row.feature_value}`);
        featuresByProduct.set(row.product_id, list);
    }
    // Merged "... и аксессуары" categories: equipment (product_attributes.product_type) must not match "аксессуары" via the
    // category name, so accessory queries keep returning the accessories first.
    const equipmentIds = new Set((db.prepare("SELECT DISTINCT product_id FROM product_attributes WHERE attribute_key = 'product_type' AND value_text = 'equipment'").all() as { product_id: number }[])
        .map((row) => Number(row.product_id)));
    const vocabulary = new Set<string>();
    // brand/series/category/feature strings repeat thousands of times: fold + stem each distinct string once
    const stemCache = new Map<string, string[]>();
    const unique = (text: unknown) => {
        const key = String(text ?? '');
        let stems = stemCache.get(key);
        if (!stems) {
            stems = Array.from(new Set(stemsOf(key)));
            stemCache.set(key, stems);
        }
        return stems;
    };
    const merge = (...lists: string[][]) => Array.from(new Set(lists.flat()));
    const buildProduct = (row: ProductRow): IndexedProduct => {
        const categoryIds = Array.from(new Set([Number(row.category_id), ...(linkedCategories.get(Number(row.id)) || [])].filter((id) => id && categoryById.has(id))));
        const leafText = leafCategoryNames(categoryIds).join(' ');
        const categoryText = equipmentIds.has(Number(row.id)) ? leafText.replace(/аксессуар\p{L}*|accessor\p{L}*/giu, ' ') : leafText;
        const nameTokens = tokenize(row.name_ru);
        const nameStems = nameTokens.map(stemWord);
        const fields = {
            name: merge(nameStems, unique(row.name_en)),
            brand: unique(row.brand_name),
            series: unique(row.series_name),
            alias: merge(unique(aliasText(`${row.brand_name || ''} ${row.series_name || ''}`)), unique(aliasText(`${row.name_ru} ${row.name_en}`))),
            category: unique(categoryText),
            feature: merge(...(featuresByProduct.get(row.id) || []).map(unique)),
            // descriptions are long (2M chars total) and low-weight: the first lines carry the key specs
            description: unique(String(row.short_description_ru || '').replace(/<[^>]*>/g, ' ').slice(0, 500)),
        };
        for (const set of Object.values(fields))
            for (const stem of set)
                vocabulary.add(stem);
        return {
            id: Number(row.id),
            skuCompact: foldText(row.sku).replace(/[^\p{L}\p{N}]+/gu, ''),
            refCompact: foldText(row.supplier_reference).replace(/[^\p{L}\p{N}]+/gu, ''),
            nameFolded: ` ${nameTokens.join(' ')} `, // used for phrase bonus
            firstStem: nameStems[0] || '',
            fields,
            inStock: (qtyByProduct.get(Number(row.id)) || 0) > 0,
            hasPrice: Number(row.price_amd) > 0,
            hasImage: withImage.has(Number(row.id)),
            isFeatured: Number(row.is_featured) === 1,
        };
    };
    const products: IndexedProduct[] = [];
    for (let i = 0; i < rows.length; i += 1) {
        products.push(buildProduct(rows[i]));
        // background rebuilds give the event loop a turn every 200 products (~0.1 s)
        if (cooperative && i % 200 === 199)
            await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const publicCategories = categories.filter((row) => Number(row.is_public) !== 0).map((row) => ({
        id: Number(row.id),
        stems: new Set(stemsOf(row.name_ru)),
        sortOrder: Number(row.sort_order) || 0,
    }));
    const brands = (db.prepare('SELECT id, name, slug, country, sort_order FROM brands WHERE is_active = 1').all() as { id: number; name: string; slug: string }[]).map((row) => ({
        id: Number(row.id),
        stems: new Set(stemsOf(`${row.name} ${aliasText(row.name)} ${row.slug}`)),
    }));
    for (const item of [...publicCategories, ...brands])
        for (const stem of item.stems)
            vocabulary.add(stem);
    return { signature, builtAt: Date.now(), products, categories: publicCategories, brands, vocabulary: Array.from(vocabulary) };
}
let building: Promise<CatalogSearchIndex> | null = null;
/**
 * Current index. The first build is awaited; later catalog changes (checked every 30 s)
 * are rebuilt in the background while the previous index keeps serving queries.
 */
export async function ensureCatalogSearchIndex(): Promise<CatalogSearchIndex> {
    const now = Date.now();
    if (index && now - lastCheckAt <= REFRESH_CHECK_MS)
        return index;
    lastCheckAt = now;
    const signature = loadSignature();
    if (index && index.signature === signature)
        return index;
    if (!building) {
        building = buildIndex(signature, Boolean(index))
            .then((built) => {
            index = built;
            return built;
        })
            .finally(() => {
            building = null;
        });
    }
    return index || building;
}
function levenshtein(a: string, b: string, max: number) {
    if (Math.abs(a.length - b.length) > max)
        return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const next = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j += 1) {
            next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            rowMin = Math.min(rowMin, next[j]);
        }
        if (rowMin > max)
            return max + 1;
        prev = next;
    }
    return prev[b.length];
}
function stemMatches(queryStem: string, indexStem: string) {
    if (queryStem === indexStem)
        return true;
    if (queryStem.length < 4 || /^\d/.test(queryStem))
        return false; // numbers and short words must match exactly
    return indexStem.startsWith(queryStem);
}
const SYNONYM_KEYS = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
function synonymsFor(token: string, stem: string): string[] {
    for (const key of SYNONYM_KEYS) {
        if (key === stem || key === token || (key.length >= 5 && token.startsWith(key)))
            return SYNONYMS[key];
    }
    return [];
}
function queryTokens(text: string) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of foldText(text).split(/[^\p{L}\p{N}+.]+/u)) {
        const token = canonicalTechToken(raw.replace(/^[.+]+|[.+]+$/g, ''));
        if (!token || STOP_WORDS.has(token) || (token.length === 1 && !/\d/.test(token)) || seen.has(token))
            continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}
function prefixLevenshtein(stem: string, vocab: string, max: number) {
    return Math.min(levenshtein(stem, vocab, max), vocab.length > stem.length ? levenshtein(stem, vocab.slice(0, stem.length), max) : max + 1);
}
/** Turns the raw query into groups of alternative stems; every group must match. */
function parseQuery(raw: string, idx: CatalogSearchIndex): ParsedQuery {
    let text = foldText(raw);
    for (const [pattern, replacement] of PHRASES)
        text = text.replace(pattern, replacement);
    const groups: QueryGroup[] = [];
    let fuzzyUsed = false;
    for (const token of queryTokens(text)) {
        const stem = stemWord(token);
        const alternatives = new Set([stem, ...synonymsFor(token, stem)]);
        // "16a" / "40a": also accept the bare number ("автомат 16а" -> C16 breakers)
        const unit = token.match(/^([a-z]?\d+(?:\.\d+)?)(a|ma|ka|v|w|kw|mm|m)$/);
        if (unit)
            alternatives.add(unit[1]);
        const hasDirect = Array.from(alternatives).some((alt) => idx.vocabulary.some((vocab) => stemMatches(alt, vocab)));
        const fuzzy: string[] = [];
        if (!hasDirect && /^\p{L}+$/u.test(stem) && stem.length >= 4) {
            const maxDistance = stem.length >= 7 ? 2 : 1;
            for (const vocab of idx.vocabulary) {
                if (vocab.length >= 3 && prefixLevenshtein(stem, vocab, maxDistance) <= maxDistance)
                    fuzzy.push(vocab);
                if (fuzzy.length > 40)
                    break;
            }
            if (fuzzy.length)
                fuzzyUsed = true;
        }
        // stem -> factor (1 exact word, 0.9 synonym, 0.6 typo); products are scored by Map lookups only
        const matchMap = new Map<string, number>();
        const altList = Array.from(alternatives);
        for (const vocab of idx.vocabulary) {
            for (let i = 0; i < altList.length; i += 1) {
                if (stemMatches(altList[i], vocab)) {
                    const factor = i === 0 ? 1 : 0.9;
                    if ((matchMap.get(vocab) || 0) < factor)
                        matchMap.set(vocab, factor);
                }
            }
        }
        for (const vocab of fuzzy)
            if (!matchMap.has(vocab))
                matchMap.set(vocab, 0.6);
        groups.push({ token, alternatives: altList, fuzzy, hasDirect, matchMap });
    }
    return { groups, folded: foldText(raw).trim(), fuzzyUsed };
}
const FIELD_ORDER = (Object.entries(FIELD_WEIGHTS).filter(([field]) => field !== 'sku') as [SearchField, number][]).sort((a, b) => b[1] - a[1]);
function groupWeight(group: QueryGroup, product: IndexedProduct) {
    let best = 0;
    for (const [field, weight] of FIELD_ORDER) {
        if (weight <= best)
            break;
        for (const stem of product.fields[field]) {
            const factor = group.matchMap.get(stem);
            if (factor && weight * factor > best) {
                best = weight * factor;
                if (factor === 1)
                    break;
            }
        }
    }
    return best;
}
function scoreProduct(product: IndexedProduct, query: ParsedQuery) {
    const compact = query.folded.replace(/[^\p{L}\p{N}]+/gu, '');
    let skuScore = 0;
    if (compact && (product.skuCompact === compact || (product.refCompact && product.refCompact === compact)))
        skuScore = 1000;
    else if (compact.length >= 3 && /\d/.test(compact) && (product.skuCompact.startsWith(compact) || (product.refCompact && product.refCompact.startsWith(compact))))
        skuScore = 300;
    let matched = 0;
    let textScore = 0;
    for (const group of query.groups) {
        const weight = groupWeight(group, product);
        if (weight > 0) {
            matched += 1;
            textScore += weight;
        }
    }
    if (!skuScore && matched === 0)
        return null;
    let score = skuScore + textScore * 10;
    const phrase = ` ${tokenize(query.folded).join(' ')} `;
    if (phrase.trim() && product.nameFolded.includes(phrase))
        score += 25;
    if (phrase.trim() && product.nameFolded.startsWith(phrase))
        score += 15;
    // product type = first words of the name: "Розетка ..." ranks above "Рамка для розетки"
    const firstGroup = query.groups[0];
    if (firstGroup && firstGroup.matchMap.has(product.firstStem))
        score += 12;
    if (product.inStock)
        score += 6;
    if (product.hasPrice)
        score += 2;
    if (product.hasImage)
        score += 3;
    if (product.isFeatured)
        score += 2;
    return { score, matched, skuScore };
}
/**
 * Ranked product ids for a query.
 * relaxed: no product matched every word, results match all but one.
 * correctedQuery: query re-typed from the wrong keyboard layout.
 */
const resultCache = new Map<string, CatalogSearchResult>();
const RESULT_CACHE_SIZE = 300;
export function searchCatalog(rawQuery: string, idx: CatalogSearchIndex = index!): CatalogSearchResult {
    const cacheKey = `${idx.signature}\u0000${rawQuery}`;
    const cached = resultCache.get(cacheKey);
    if (cached) {
        resultCache.delete(cacheKey); // LRU: move to the end
        resultCache.set(cacheKey, cached);
        return cached;
    }
    const result = searchCatalogUncached(rawQuery, idx);
    resultCache.set(cacheKey, result);
    if (resultCache.size > RESULT_CACHE_SIZE)
        resultCache.delete(resultCache.keys().next().value!);
    return result;
}
function searchCatalogUncached(rawQuery: string, idx: CatalogSearchIndex): CatalogSearchResult {
    const run = (text: string) => {
        const query = parseQuery(text, idx);
        if (!query.groups.length && !query.folded.replace(/[^\p{L}\p{N}]+/gu, ''))
            return { query, strict: [] as Scored[], loose: [] as Scored[] };
        const strict: Scored[] = [];
        const loose: Scored[] = [];
        for (const product of idx.products) {
            const result = scoreProduct(product, query);
            if (!result)
                continue;
            if (result.skuScore >= 1000 || result.matched === query.groups.length)
                strict.push({ id: product.id, score: result.score, featured: product.isFeatured });
            else if (query.groups.length >= 2 && result.matched >= query.groups.length - 1)
                loose.push({ id: product.id, score: result.score, featured: product.isFeatured });
        }
        const order = (a: Scored, b: Scored) => b.score - a.score || Number(b.featured) - Number(a.featured) || b.id - a.id;
        strict.sort(order);
        loose.sort(order);
        return { query, strict, loose };
    };
    let result = run(rawQuery);
    let correctedQuery = '';
    if (!result.strict.length) {
        const folded = foldText(rawQuery);
        let switched = '';
        if (/^[a-z\s[\];',.`]+$/.test(folded) && /[a-z]/.test(folded))
            switched = [...folded].map((ch) => EN_TO_RU_LAYOUT[ch] || ch).join('');
        else if (/^[а-яё\s]+$/.test(folded))
            switched = [...folded].map((ch) => RU_TO_EN_LAYOUT[ch] || ch).join('');
        if (switched) {
            const retry = run(switched);
            if (retry.strict.length) {
                result = retry;
                correctedQuery = switched.trim();
            }
        }
    }
    const relaxed = !result.strict.length && result.loose.length > 0;
    return {
        ids: (relaxed ? result.loose : result.strict).map((item) => item.id),
        relaxed,
        correctedQuery,
        fuzzy: result.query.fuzzyUsed,
        query: result.query,
    };
}
export function searchCatalogCategories(rawQuery: string, limit = 5, idx: CatalogSearchIndex = index!): number[] {
    const query = parseQuery(rawQuery, idx);
    if (!query.groups.length)
        return [];
    return (idx.categories
        .map((category) => {
        let score = 0;
        for (const group of query.groups) {
            if (!Array.from(category.stems).some((stem) => group.matchMap.get(stem)! >= 0.9))
                return null;
            score += 1;
        }
        return { id: category.id, score: score * 100 - category.sortOrder * 0.01 - category.stems.size };
    })
        .filter(Boolean) as { id: number; score: number }[])
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.id);
}
export function searchCatalogBrands(rawQuery: string, limit = 4, idx: CatalogSearchIndex = index!): number[] {
    const query = parseQuery(rawQuery, idx);
    if (!query.groups.length)
        return [];
    return idx.brands
        .filter((brand) => query.groups.every((group) => Array.from(brand.stems).some((stem) => group.matchMap.get(stem) === 1 || (group.fuzzy.includes(stem) && !group.hasDirect))))
        .slice(0, limit)
        .map((brand) => brand.id);
}
