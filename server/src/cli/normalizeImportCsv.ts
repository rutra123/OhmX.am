
import { db } from '../db.js';

// V2 Safety Guard
if (
  (() => {
    try {
      return (db.prepare(`
        SELECT COUNT(*) AS count
        FROM categories
        WHERE id IN (910001,910002,910003,910004,910005,910006,910007,910008)
          AND parent_id IS NULL
          AND is_active = 1
      `).get() as any)?.count === 8;
    } catch {
      return false;
    }
  })()
) {
  console.error("=============================================================================");
  console.error("CRITICAL SAFETY BLOCK: THIS LEGACY SCRIPT IS DISABLED ON V2");
  console.error("The project has migrated to the clean V2 category taxonomy.");
  console.error("Running this legacy script would corrupt or overwrite the production tree.");
  console.error("=============================================================================");
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../utils/importProducts.js';

type Row = Record<string, string>;

type CategoryRule = {
  match: string[];
  category_level_1: string;
  category_level_2?: string;
  category_level_3?: string;
  category_level_4?: string;
  category_level_5?: string;
  category_level_6?: string;
  category_level_7?: string;
  category_level_8?: string;
};

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const defaultMappingRulesPath = path.resolve(projectRoot, 'data/imports/templates/category-mapping.rules.json');

const OUTPUT_HEADERS = [
  'sku',
  'name_ru',
  'name_hy',
  'name_en',
  'slug',
  'brand',
  'series',
  'category_level_1',
  'category_level_2',
  'category_level_3',
  'category_level_4',
  'category_level_5',
  'category_level_6',
  'category_level_7',
  'category_level_8',
  'price_amd',
  'currency',
  'unit',
  'stock_komitas',
  'stock_araratyan',
  'stock_gnuni',
  'stock_nairi_zaryan',
  'stock_araratyan_90_30',
  'short_description_ru',
  'description_ru',
  'features_json',
  'image_urls_json',
  'image_1',
  'image_2',
  'image_3',
  'document_1_name',
  'document_1_type',
  'document_1_url',
  'document_1_language',
  'active',
] as const;

const FIELD_ALIASES: Record<string, string[]> = {
  sku: ['sku', 'артикул', 'код', 'код номенклатуры', 'product code', 'item code'],
  name_ru: ['name_ru', 'наименование', 'название', 'товар', 'product name', 'name', 'имя'],
  name_hy: ['name_hy', 'name_am', 'наименование am'],
  name_en: ['name_en', 'english name'],
  slug: ['slug', 'url rewritten', 'seo url', 'url'],
  brand: ['brand', 'бренд', 'марка', 'manufacturer', 'vendor'],
  series: ['series', 'серия', 'collection', 'subcategory', 'sub category', 'подкатегория'],
  category_source: ['category', 'категория', 'source category', 'old_category_name', 'old category', 'group', 'product group', 'category path', 'original category column'],
  category_level_1: ['category_level_1', 'категория 1', 'level 1', 'root category', 'category level 1'],
  category_level_2: ['category_level_2', 'категория 2', 'level 2', 'category level 2'],
  category_level_3: ['category_level_3', 'категория 3', 'level 3', 'category level 3'],
  category_level_4: ['category_level_4', 'категория 4', 'level 4', 'category level 4'],
  category_level_5: ['category_level_5', 'категория 5', 'level 5', 'category level 5'],
  category_level_6: ['category_level_6', 'категория 6', 'level 6', 'category level 6'],
  category_level_7: ['category_level_7', 'категория 7', 'level 7', 'category level 7'],
  category_level_8: ['category_level_8', 'категория 8', 'level 8', 'category level 8'],
  price_amd: ['price_amd', 'цена', 'price', 'цена amd', 'price amd'],
  currency: ['currency', 'валюта'],
  unit: ['unit', 'ед', 'ед.', 'единица', 'единица измерения', 'uom'],
  stock_total: ['stock_total', 'остаток', 'остаток общий', 'total stock', 'qty', 'quantity', 'количество'],
  stock_komitas: ['stock_komitas', 'комитас', 'остаток комитас'],
  stock_araratyan: ['stock_araratyan', 'араратян', 'остаток араратян'],
  stock_gnuni: ['stock_gnuni', 'гнуни', 'остаток гнуни'],
  stock_nairi_zaryan: ['stock_nairi_zaryan', 'наири зарьян', 'остаток наири зарьян'],
  stock_araratyan_90_30: ['stock_araratyan_90_30', 'араратян 90 30', 'остаток араратян 90 30'],
  short_description_ru: ['short_description_ru', 'короткое описание', 'short description'],
  description_ru: ['description_ru', 'описание', 'полное описание', 'description'],
  features_json: ['features_json', 'характеристики_json', 'features'],
  image_urls_json: ['image_urls_json', 'image urls (x,y,z...)'],
  image_1: ['image_1', 'image', 'изображение', 'image_url', 'main image'],
  image_2: ['image_2'],
  image_3: ['image_3'],
  document_1_name: ['document_1_name', 'document name', 'документ'],
  document_1_type: ['document_1_type', 'document type', 'тип документа'],
  document_1_url: ['document_1_url', 'document url', 'ссылка на документ'],
  document_1_language: ['document_1_language', 'document language', 'язык документа'],
  active: ['active', 'is_active', 'активен', 'published'],
};

function loadCategoryRules(mappingFilePath: string) {
  const raw = fs.readFileSync(mappingFilePath, 'utf8');
  const parsed = JSON.parse(raw) as CategoryRule[];
  return parsed.map((rule) => ({
    ...rule,
    match: (rule.match || []).map((candidate) => normalizeKey(candidate)),
  }));
}

const DIRECT_ROOT_ALIASES: Record<string, string> = {
  'электрика': 'Электрика',
  'розетки и выключатели': 'Розетки и выключатели',
  'щиты и шкафы': 'Щиты и шкафы',
  'кабельные системы': 'Кабельные системы',
  'освещение': 'Освещение',
  'электрическое отопление': 'Электрическое отопление',
  'водяное отопление': 'Водяное отопление',
  'котельное оборудование': 'Котельное оборудование',
  'hvac и теплоснабжение': 'HVAC и теплоснабжение',
  'трубопроводная арматура': 'Трубопроводная арматура',
  'силовое оборудование': 'Силовое оборудование',
  'автоматика и управление': 'Автоматика и управление',
  'запчасти': 'Запчасти',
};

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function normalizeKey(value: string) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function sanitizeNumber(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? String(num) : raw;
}

function pickField(row: Row, headersMap: Map<string, string>, field: string) {
  const aliases = FIELD_ALIASES[field] || [field];
  for (const alias of aliases) {
    const actualHeader = headersMap.get(normalizeKey(alias));
    if (actualHeader && row[actualHeader] !== undefined && String(row[actualHeader]).trim() !== '') {
      return String(row[actualHeader]).trim();
    }
  }
  return '';
}

function splitPath(value: string) {
  return value
    .split(/\s*(?:>|\/|\\|\|)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function splitImageUrls(value: string) {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveCategories(row: Row, headersMap: Map<string, string>, categoryRules: CategoryRule[]) {
  const explicit = Array.from({ length: 8 }, (_, index) => pickField(row, headersMap, `category_level_${index + 1}`)).filter(Boolean);

  if (explicit.length) {
    return {
      category_level_1: explicit[0] || '',
      category_level_2: explicit[1] || '',
      category_level_3: explicit[2] || '',
      category_level_4: explicit[3] || '',
      category_level_5: explicit[4] || '',
      category_level_6: explicit[5] || '',
      category_level_7: explicit[6] || '',
      category_level_8: explicit[7] || '',
      sourceCategory: pickField(row, headersMap, 'category_source'),
      mappingStatus: 'explicit' as const,
    };
  }

  const sourceCategory = pickField(row, headersMap, 'category_source');
  const normalizedSource = normalizeKey(sourceCategory);

  const mappedRule = categoryRules.find((rule) => rule.match.some((candidate) => candidate === normalizedSource));
  if (mappedRule) {
    return {
      category_level_1: mappedRule.category_level_1,
      category_level_2: mappedRule.category_level_2 || '',
      category_level_3: mappedRule.category_level_3 || '',
      category_level_4: mappedRule.category_level_4 || '',
      category_level_5: mappedRule.category_level_5 || '',
      category_level_6: mappedRule.category_level_6 || '',
      category_level_7: mappedRule.category_level_7 || '',
      category_level_8: mappedRule.category_level_8 || '',
      sourceCategory,
      mappingStatus: 'mapped' as const,
    };
  }

  if (DIRECT_ROOT_ALIASES[normalizedSource]) {
    return {
      category_level_1: DIRECT_ROOT_ALIASES[normalizedSource],
      category_level_2: '',
      category_level_3: '',
      category_level_4: '',
      category_level_5: '',
      category_level_6: '',
      category_level_7: '',
      category_level_8: '',
      sourceCategory,
      mappingStatus: 'direct-root' as const,
    };
  }

  const split = splitPath(sourceCategory);
  if (split.length >= 2) {
    return {
      category_level_1: split[0] || '',
      category_level_2: split[1] || '',
      category_level_3: split[2] || '',
      category_level_4: split[3] || '',
      category_level_5: split[4] || '',
      category_level_6: split[5] || '',
      category_level_7: split[6] || '',
      category_level_8: split[7] || '',
      sourceCategory,
      mappingStatus: 'path-split' as const,
    };
  }

    return {
      category_level_1: '',
      category_level_2: '',
      category_level_3: '',
      category_level_4: '',
      category_level_5: '',
      category_level_6: '',
      category_level_7: '',
      category_level_8: '',
      sourceCategory,
      mappingStatus: sourceCategory ? ('unmapped' as const) : ('empty' as const),
    };
}

function csvEscape(value: string) {
  const stringValue = String(value ?? '');
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function resolveInputPath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromCwd = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(projectRoot, filePath);
}

function resolveOutputPath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(projectRoot, filePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  const output = args.output;
  const report = args.report || (output ? output.replace(/\.csv$/i, '.report.json') : '');
  const mapping = args.mapping || defaultMappingRulesPath;

  if (!input || !output) {
    console.error('Usage: tsx src/cli/normalizeImportCsv.ts --input <source.csv> --output <normalized.csv> [--report <report.json>] [--mapping <rules.json>]');
    process.exit(1);
  }

  const inputPath = resolveInputPath(input);
  const outputPath = resolveOutputPath(output);
  const reportPath = report ? resolveOutputPath(report) : '';
  const mappingPath = resolveInputPath(mapping);
  const categoryRules = loadCategoryRules(mappingPath);

  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCsv(raw, detectDelimiter(raw));
  if (parsed.length < 2) {
    throw new Error('Source CSV пустой или некорректный');
  }

  const sourceHeaders = parsed[0].map((header) => String(header || '').replace(/^\ufeff/, '').trim());
  const sourceRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  const headersMap = new Map(sourceHeaders.map((header) => [normalizeKey(header), header]));
  const outputRows: string[][] = [Array.from(OUTPUT_HEADERS)];

  const knownNormalizedHeaders = new Set(Object.keys(FIELD_ALIASES).flatMap((field) => [field, ...(FIELD_ALIASES[field] || [])].map((candidate) => normalizeKey(candidate))));
  const unknownSourceHeaders = sourceHeaders.filter((header) => !knownNormalizedHeaders.has(normalizeKey(header)));

  const reportData = {
    input: inputPath,
    output: outputPath,
    mapping: mappingPath,
    totalRows: sourceRows.length,
    normalizedRows: 0,
    rowsWithMissingSku: 0,
    rowsWithMissingName: 0,
    rowsWithMissingBrand: 0,
    rowsWithUnmappedCategory: 0,
    unknownSourceHeaders,
    unmappedCategories: {} as Record<string, number>,
    mappingStatusCounts: {} as Record<string, number>,
  };

  for (const rawRow of sourceRows) {
    const row = Object.fromEntries(sourceHeaders.map((header, index) => [header, String(rawRow[index] || '').trim()]));
    const categories = resolveCategories(row, headersMap, categoryRules);
    const imageUrls = splitImageUrls(pickField(row, headersMap, 'image_urls_json'));

    const stockTotal = sanitizeNumber(pickField(row, headersMap, 'stock_total'));
    const normalized: Record<(typeof OUTPUT_HEADERS)[number], string> = {
      sku: pickField(row, headersMap, 'sku'),
      name_ru: pickField(row, headersMap, 'name_ru'),
      name_hy: pickField(row, headersMap, 'name_hy'),
      name_en: pickField(row, headersMap, 'name_en'),
      slug: pickField(row, headersMap, 'slug'),
      brand: pickField(row, headersMap, 'brand'),
      series: pickField(row, headersMap, 'series'),
      category_level_1: categories.category_level_1,
      category_level_2: categories.category_level_2,
      category_level_3: categories.category_level_3,
      category_level_4: categories.category_level_4,
      category_level_5: categories.category_level_5,
      category_level_6: categories.category_level_6,
      category_level_7: categories.category_level_7,
      category_level_8: categories.category_level_8,
      price_amd: sanitizeNumber(pickField(row, headersMap, 'price_amd')),
      currency: pickField(row, headersMap, 'currency') || 'AMD',
      unit: pickField(row, headersMap, 'unit') || 'шт',
      stock_komitas: sanitizeNumber(pickField(row, headersMap, 'stock_komitas')),
      stock_araratyan: sanitizeNumber(pickField(row, headersMap, 'stock_araratyan')),
      stock_gnuni: sanitizeNumber(pickField(row, headersMap, 'stock_gnuni')),
      stock_nairi_zaryan: sanitizeNumber(pickField(row, headersMap, 'stock_nairi_zaryan')),
      stock_araratyan_90_30: sanitizeNumber(pickField(row, headersMap, 'stock_araratyan_90_30')),
      short_description_ru: pickField(row, headersMap, 'short_description_ru'),
      description_ru: pickField(row, headersMap, 'description_ru'),
      features_json: pickField(row, headersMap, 'features_json'),
      image_urls_json: imageUrls.length ? JSON.stringify(imageUrls) : '',
      image_1: imageUrls[0] || pickField(row, headersMap, 'image_1'),
      image_2: imageUrls[1] || pickField(row, headersMap, 'image_2'),
      image_3: imageUrls[2] || pickField(row, headersMap, 'image_3'),
      document_1_name: pickField(row, headersMap, 'document_1_name'),
      document_1_type: pickField(row, headersMap, 'document_1_type'),
      document_1_url: pickField(row, headersMap, 'document_1_url'),
      document_1_language: pickField(row, headersMap, 'document_1_language') || 'ru',
      active: pickField(row, headersMap, 'active') || '1',
    };

    if (!normalized.stock_komitas && !normalized.stock_araratyan && !normalized.stock_gnuni && !normalized.stock_nairi_zaryan && !normalized.stock_araratyan_90_30 && stockTotal) {
      normalized.stock_komitas = stockTotal;
    }

    reportData.normalizedRows += 1;
    reportData.mappingStatusCounts[categories.mappingStatus] = (reportData.mappingStatusCounts[categories.mappingStatus] || 0) + 1;
    if (!normalized.sku) reportData.rowsWithMissingSku += 1;
    if (!normalized.name_ru) reportData.rowsWithMissingName += 1;
    if (!normalized.brand) reportData.rowsWithMissingBrand += 1;
    if (!normalized.category_level_1) {
      reportData.rowsWithUnmappedCategory += 1;
      if (categories.sourceCategory) {
        reportData.unmappedCategories[categories.sourceCategory] = (reportData.unmappedCategories[categories.sourceCategory] || 0) + 1;
      }
    }

    outputRows.push(OUTPUT_HEADERS.map((header) => normalized[header] || ''));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(outputRows), 'utf8');

  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2) + '\n', 'utf8');
  }

  console.log(JSON.stringify(reportData, null, 2));
}

main();
