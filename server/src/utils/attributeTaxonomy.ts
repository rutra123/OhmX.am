export type TaxonomyClassification =
  | 'VALID_COLOR'
  | 'VALID_MATERIAL'
  | 'VALID_FINISH'
  | 'PRODUCT_TYPE'
  | 'TECHNICAL_ATTRIBUTE'
  | 'SERIES_OR_BRAND'
  | 'STATUS_OR_COMMERCIAL'
  | 'DOCUMENT_OR_MEDIA'
  | 'REVIEW'
  | 'INVALID_FOR_COLOR';

const COLOR_WHITELIST = new Set([
  'белый', 'чёрный', 'черный', 'серый', 'светло-серый', 'тёмно-серый',
  'антрацит', 'графит', 'слоновая кость', 'кремовый', 'бежевый',
  'шампань', 'коричневый', 'красный', 'синий', 'зелёный', 'жёлтый',
  'оранжевый', 'прозрачный', 'дымчатый', 'алюминий', 'титан',
  'сталь', 'бронза', 'золото', 'хром', 'никель', 'магний',
  'жемчужный', 'песочный', 'терракотовый', 'крем', 'беж', 'серебро'
]);

const MATERIAL_WHITELIST = new Set([
  'пластик', 'металл', 'сталь', 'нержавеющая сталь', 'оцинкованная сталь',
  'алюминий', 'латунь', 'медь', 'пвх', 'pvc', 'поликарбонат', 'abs',
  'резина', 'керамика', 'стекло', 'дерево', 'термопласт', 'полиамид'
]);

const FINISH_WHITELIST = new Set([
  'матовый', 'глянцевый', 'сатин', 'лакированный', 'шлифованный'
]);

const TECHNICAL_PATTERNS = [
  /\b\d+[a-zа-яё%]/i, // 16A, 10kA, 30mA
  /\b\d+[\s-]*[пp]\b/i, // 1P, 2P
  /\bip\d+/i, // IP20, IP55
  /\b\d+[\s-]*модул/i,
  /\b\d+[\s-]*пост/i,
  /\b\d+\s*вт\b/i,
  /\b\d+\s*v\b/i,
  /\b\d+\s*в\b/i
];

const PRODUCT_TYPE_PATTERNS = [
  /розетка/i, /выключатель/i, /рамка/i, /механизм/i, /автомат/i,
  /узо/i, /дифавтомат/i, /щит/i, /шкаф/i, /бокc/i, /панель/i, /адаптер/i, /удлинитель/i
];

export function classifyAttributeValue(key: string, value: string): TaxonomyClassification {
  const k = String(key || '').toLowerCase();
  const v = String(value || '').toLowerCase().trim();

  if (v === '' || v === 'n/a' || v === 'нет' || v === 'да') return 'INVALID_FOR_COLOR';
  if (v.length > 50) return 'INVALID_FOR_COLOR'; // Too long for a color/material

  const isColorKey = k.includes('цвет') || k.includes('color') || k.includes('отделка') || k.includes('finish');
  const isMaterialKey = k.includes('материал') || k.includes('material');

  if (COLOR_WHITELIST.has(v)) {
    if (isMaterialKey && MATERIAL_WHITELIST.has(v)) return 'VALID_MATERIAL';
    return 'VALID_COLOR';
  }

  if (MATERIAL_WHITELIST.has(v)) return 'VALID_MATERIAL';
  if (FINISH_WHITELIST.has(v)) return 'VALID_FINISH';

  if (TECHNICAL_PATTERNS.some(p => p.test(v))) return 'TECHNICAL_ATTRIBUTE';
  if (PRODUCT_TYPE_PATTERNS.some(p => p.test(v))) return 'PRODUCT_TYPE';

  if (isColorKey) return 'REVIEW';
  
  return 'INVALID_FOR_COLOR';
}

export function isAllowedInColor(key: string, value: string): boolean {
  const classification = classifyAttributeValue(key, value);
  return classification === 'VALID_COLOR' || classification === 'VALID_FINISH';
}

export function isAllowedInMaterial(key: string, value: string): boolean {
  const classification = classifyAttributeValue(key, value);
  return classification === 'VALID_MATERIAL';
}
