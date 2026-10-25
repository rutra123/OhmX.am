import i18next from 'i18next';
import { normalizeLanguage } from '../i18n/types';

export const BRANDLESS_SLUG = 'без-бренда';

export const rootBrandMatrix: Record<string, string[]> = {
  elektrika: ['Legrand', 'GEYA', 'Finder', 'Bastion', 'HIF', 'JSL Electro', 'Techno', 'Без бренда'],
  'rozetki-i-vyklyuchateli': ['Legrand (France)', 'JSL Electro (Portugal)', 'GEYA', 'Techno', 'Без бренда'],
  'shchity-i-shkafy': ['Legrand', 'GEYA', 'Finder', 'Bastion', 'HIF', 'JSL Electro', 'Techno', 'Без бренда'],
  'kabelnye-sistemy': ['LAPP', 'Top Cable', 'FLEXICORE', 'Cablofil', 'JSL Electro', 'Techno', 'OJT TAPE 21', 'Без бренда'],
  osveshchenie: ['Philips', 'Massive', 'Ideal Lux', 'Lena Lighting', 'Techno', 'HIF', 'Без бренда'],
  'elektricheskoe-otoplenie': ['DEVI', 'Danfoss', 'Fenix', 'OJ Electronics', 'Techno Heat', 'Thermostats', 'OJT TAPE 21', 'Без бренда'],
  'vodyanoe-otoplenie-i-kotelnaya': ['Danfoss', 'Emmeti', 'F.I.V.', 'Riello', 'Beretta', 'Baltur', 'Carlo Poletti', 'Tecofi', 'Sira', 'Korado', 'KVZ-Heat', 'Krats', 'Licon', 'Techno', 'Без бренда'],
  'hvac-i-okhlazhdenie': ['BPS Clima', 'TICA', 'Intuis - Airelec', 'Riello', 'Danfoss', 'OJ Electronics', 'Tecofi', 'IMAS', 'Techno', 'Без бренда'],
  'truboprovodnaya-armatura-i-gidravlika': ['DAB', 'Calpeda', 'Emmeti', 'F.I.V.', 'Tecofi', 'Danfoss', 'Carlo Poletti', 'Techno', 'Без бренда'],
  'avtomatika-i-upravlenie': ['Finder', 'Danfoss', 'OJ Electronics', 'GEYA', 'Bastion', 'HIF', 'Thermostats', 'Techno', 'Без бренда'],
  'silovoe-oborudovanie-i-ups': ['APC', 'Bastion', 'GEYA', 'Без бренда'],
  'zapchasti-i-servis': ['Riello', 'Beretta', 'Baltur', 'DAB', 'Calpeda', 'Danfoss', 'BPS Clima', 'TICA', 'OJ Electronics', 'Finder', 'Tecofi', 'Без бренда'],
};

export const rootBrandFirst = new Set<string>();

export const branchBrandFirst = new Set([
  'water-heating-boiler-клапаны',
  '444-светильники',
  'ups-power-ups-ибп',
]);

export const switchesSeriesShowcase = [
  { title: 'Legrand серия Inspiria', categoryName: 'Legrand серия Inspiria' },
  { title: 'Legrand серия Niloe', categoryName: 'Legrand серия Niloe' },
  { title: 'Legrand серия Niloe Step', categoryName: 'Legrand серия Niloe Step' },
  { title: 'Legrand серия Valena Life', categoryName: 'Legrand серия Valena Life' },
  { title: 'Legrand серия Valena Allure', categoryName: 'Legrand серия Valena Allure' },
  { title: 'Legrand серия Arteor', categoryName: 'Legrand серия Arteor' },
  { title: 'Legrand серия Mosaic', categoryName: 'Legrand серия Mosaic' },
  { title: 'Legrand серия Mallia Senses', categoryName: 'Legrand серия Mallia Senses' },
  { title: 'Legrand серия Suno', categoryName: 'Legrand серия Suno' },
  { title: 'Legrand серия Celiane', categoryName: 'Legrand серия Celiane' },
  { title: 'Legrand серия Valena Classic', categoryName: 'Legrand серия Valena Classic' },
  { title: 'Legrand серия Cariva', categoryName: 'Legrand серия Cariva' },
  { title: 'Legrand серия Quteo/Forix', categoryName: 'Legrand серия Quteo/Forix' },
  { title: 'Legrand серия Plexo IP 55/IP 66', categoryName: 'Legrand серия Plexo IP 55/ IP 66' },
];

export const categoryTitleOverrides: Record<string, string> = {
  'water-heating-boiler-клапаны': 'Радиаторная арматура',
  'ups-power-ups-ибп': 'UPS / ИБП',
  '444-офисное-и-промышленное-освещение': 'Промышленное освещение',
  akcii: 'Акции и спецпредложения',
  'hvac-i-okhlazhdenie': 'HVAC и охлаждение',
};

export const categoryDescriptionOverrides: Record<string, string> = {
  elektrika: 'автоматы, защита, модульная электрика и инженерные комплектующие',
  'rozetki-i-vyklyuchateli': 'розетки, выключатели, рамки, механизмы',
  'shchity-i-shkafy': 'автоматы, УЗО, щиты, реле, модульная защита',
  'kabelnye-sistemy': 'кабель, лотки, каналы, крепёж и монтаж',
  osveshchenie: 'светильники, домашнее и промышленное освещение',
  'elektricheskoe-otoplenie': 'кабели, маты, термостаты, датчики и тёплый пол',
  'vodyanoe-otoplenie-i-kotelnaya': 'клапаны, коллекторы, котлы, радиаторная арматура',
  'hvac-i-okhlazhdenie': 'фанкойлы, кондиционирование, теплообменники и HVAC',
  'truboprovodnaya-armatura-i-gidravlika': 'насосы, арматура, фильтры и гидравлика',
  'avtomatika-i-upravlenie': 'контроллеры, приводы, реле и датчики',
  'silovoe-oborudovanie-i-ups': 'UPS, стабилизаторы, батареи и защита питания',
  'zapchasti-i-servis': 'запчасти для HVAC, насосов, котлов и автоматики',
  akcii: 'акции, спецпредложения и приоритетные позиции',
  brands: 'каталог производителей и брендовые витрины',
  docs: 'каталоги, datasheet, инструкции и сертификаты',
};

/** Localized one-line descriptions of the top-level catalog sections (home and catalog pages). */
export const categoryDescriptionKeyBySlug: Record<string, string> = {
  'rozetki-i-vyklyuchateli': 'home.categories.descriptions.electrical',
  'avtomatika-i-upravlenie': 'home.categories.descriptions.automation',
  'elektrika-i-schitovoe-oborudovanie-schity-shkafy-i-boksy': 'home.categories.descriptions.switchboards',
  'elektrika-i-schitovoe-oborudovanie-avtomaty-i-zaschita': 'home.categories.descriptions.protection',
  'kabel-kabel-kanaly-i-montazh': 'home.categories.descriptions.cableManagement',
  'elektrika-i-schitovoe-oborudovanie-promyshlennye-rozetki-vilki-i-razemy': 'home.categories.descriptions.industrialElectrical',
  'osveschenie': 'home.categories.descriptions.lighting',
  'hvac-i-teplosnabzhenie': 'home.categories.descriptions.hvac',
  'elektricheskoe-otoplenie': 'home.categories.descriptions.heating',
  'hvac-i-teplosnabzhenie-nasosy': 'home.categories.descriptions.waterSupply',
  'truboprovodnaya-armatura-i-gidravlika': 'home.categories.descriptions.plumbing',
  'kabel-kabel-kanaly-i-montazh-kabelnye-aksessuary-markirovka-i-krepezh': 'home.categories.descriptions.fasteners',
  'elektrika-i-schitovoe-oborudovanie': 'home.categories.descriptions.electricalEquipment',
};

type LocalizedCategory = { slug?: string; name_ru?: string; name_en?: string | null; name_hy?: string | null; label_ru?: string };

function currentLanguage(language?: string) {
  return normalizeLanguage(language ?? i18next.resolvedLanguage ?? i18next.language);
}

/** Category name in the UI language; untranslated categories keep their Russian name (never a blank label). */
export function getLocalizedCategoryName(category: LocalizedCategory, language?: string) {
  const lang = currentLanguage(language);
  const russian = category.name_ru || category.label_ru || '';
  if (lang === 'en') return category.name_en || russian;
  if (lang === 'hy') return category.name_hy || russian;
  return russian;
}

export function getCategoryTitle(category: LocalizedCategory, language?: string) {
  const lang = currentLanguage(language);
  if (lang !== 'ru') return getLocalizedCategoryName(category, lang);
  return categoryTitleOverrides[category.slug || ''] || category.name_ru || '';
}

/** Descriptions exist only in Russian: other languages get '' and callers show their localized fallback. */
export function getCategoryDescription(category: { slug?: string; description_ru?: string; short_description_ru?: string }, language?: string) {
  if (currentLanguage(language) !== 'ru') return '';
  return categoryDescriptionOverrides[category.slug || ''] || category.short_description_ru || category.description_ru || '';
}
