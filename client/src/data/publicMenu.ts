/**
 * Presentation metadata only — NOT a navigation hierarchy source.
 * Catalog order/labels/membership come from GET /api/navigation.
 */

export type PublicCategoryPresentation = {
  title: string;
  slug: string;
  to: string;
  description: string;
  imageUrl?: string;
  accent: string;
  imagePrompt?: string;
};

/** Presentation map keyed by category slug (images/accents/blurbs). */
export const categoryPresentationBySlug: Record<string, PublicCategoryPresentation> = {
  'rozetki-i-vyklyuchateli': {
    title: 'Розетки и выключатели',
    slug: 'rozetki-i-vyklyuchateli',
    to: '/catalog/rozetki-i-vyklyuchateli',
    description: 'механизмы, рамки, розетки, выключатели и аксессуары',
    imageUrl: '/storage/images/root-category-rozetki-i-vyklyuchateli.png',
    accent: 'from-orange-600/90 to-white/10',
  },
  'avtomatika-i-upravlenie': {
    title: 'Автоматика и управление',
    slug: 'avtomatika-i-upravlenie',
    to: '/catalog/avtomatika-i-upravlenie',
    description: 'реле, контроллеры, датчики, приводы и управление',
    imageUrl: '/storage/images/root-category-avtomatika-i-upravlenie.png',
    accent: 'from-fuchsia-700/90 to-white/10',
  },
  'elektrika-i-schitovoe-oborudovanie-schity-shkafy-i-boksy': {
    title: 'Щиты, шкафы и боксы',
    slug: 'elektrika-i-schitovoe-oborudovanie-schity-shkafy-i-boksy',
    to: '/catalog/elektrika-i-schitovoe-oborudovanie-schity-shkafy-i-boksy',
    description: 'щитовое оборудование и корпуса',
    imageUrl: '/storage/images/root-category-elektrika-i-schitovoe-oborudovanie-schity-shkafy-i-boksy.png',
    accent: 'from-red-700/90 to-white/10',
  },
  'elektrika-i-schitovoe-oborudovanie-avtomaty-i-zaschita': {
    title: 'Автоматы и защита',
    slug: 'elektrika-i-schitovoe-oborudovanie-avtomaty-i-zaschita',
    to: '/catalog/elektrika-i-schitovoe-oborudovanie-avtomaty-i-zaschita',
    description: 'модульная и силовая защита',
    imageUrl: '/storage/images/root-category-elektrika-i-schitovoe-oborudovanie-avtomaty-i-zaschita.png',
    accent: 'from-red-700/90 to-white/10',
  },
  'kabel-kabel-kanaly-i-montazh': {
    title: 'Кабели, кабель-каналы и монтаж',
    slug: 'kabel-kabel-kanaly-i-montazh',
    to: '/catalog/kabel-kabel-kanaly-i-montazh',
    description: 'кабели, провода, кабель-каналы, лотки, крепёж и монтаж',
    imageUrl: '/storage/images/root-category-kabel-kabel-kanaly-i-montazh.png',
    accent: 'from-amber-600/90 to-white/10',
  },
  'elektrika-i-schitovoe-oborudovanie-promyshlennye-rozetki-vilki-i-razemy': {
    title: 'Промышленная электрика',
    slug: 'elektrika-i-schitovoe-oborudovanie-promyshlennye-rozetki-vilki-i-razemy',
    to: '/catalog/elektrika-i-schitovoe-oborudovanie-promyshlennye-rozetki-vilki-i-razemy',
    description: 'промышленные разъёмы, контакторы, силовая защита',
    imageUrl: '/storage/images/root-category-elektrika-i-schitovoe-oborudovanie-promyshlennye-rozetki-vilki-i-razemy.png',
    accent: 'from-red-700/90 to-white/10',
  },
  osveschenie: {
    title: 'Освещение',
    slug: 'osveschenie',
    to: '/catalog/osveschenie',
    description: 'технические светильники, LED-решения и промышленный свет',
    imageUrl: '/storage/images/root-category-osveshchenie.png',
    accent: 'from-yellow-500/90 to-white/10',
  },
  'hvac-i-teplosnabzhenie': {
    title: 'HVAC и теплоснабжение',
    slug: 'hvac-i-teplosnabzhenie',
    to: '/catalog/hvac-i-teplosnabzhenie',
    description: 'вентиляция, фанкойлы, радиаторы, котельная и климатические системы',
    imageUrl: '/storage/images/root-category-hvac-i-teplosnabzhenie.png',
    accent: 'from-sky-600/90 to-white/10',
  },
  'elektricheskoe-otoplenie': {
    title: 'Электрическое отопление',
    slug: 'elektricheskoe-otoplenie',
    to: '/catalog/elektricheskoe-otoplenie',
    description: 'тёплый пол, нагревательные маты, кабели, термостаты',
    imageUrl: '/storage/images/root-category-elektricheskoe-otoplenie.png',
    accent: 'from-red-500/90 to-white/10',
  },
  'hvac-i-teplosnabzhenie-nasosy': {
    title: 'Насосы и водоснабжение',
    slug: 'hvac-i-teplosnabzhenie-nasosy',
    to: '/catalog/hvac-i-teplosnabzhenie-nasosy',
    description: 'насосы и водоснабжение',
    imageUrl: '/storage/images/root-category-hvac-i-teplosnabzhenie-nasosy.png',
    accent: 'from-indigo-700/90 to-white/10',
  },
  'truboprovodnaya-armatura-i-gidravlika': {
    title: 'Трубопроводная арматура и гидравлика',
    slug: 'truboprovodnaya-armatura-i-gidravlika',
    to: '/catalog/truboprovodnaya-armatura-i-gidravlika',
    description: 'клапаны, фитинги, насосы, гидравлика и водоснабжение',
    imageUrl: '/storage/images/root-category-truboprovodnaya-armatura-i-gidravlika.png',
    accent: 'from-indigo-700/90 to-white/10',
  },
  'kabel-kabel-kanaly-i-montazh-kabelnye-aksessuary-markirovka-i-krepezh': {
    title: 'Крепёж',
    slug: 'kabel-kabel-kanaly-i-montazh-kabelnye-aksessuary-markirovka-i-krepezh',
    to: '/catalog/kabel-kabel-kanaly-i-montazh-kabelnye-aksessuary-markirovka-i-krepezh',
    description: 'крепёж и монтажные аксессуары',
    imageUrl: '/storage/images/root-category-kabel-kabel-kanaly-i-montazh-kabelnye-aksessuary-markirovka-i-krepezh.png',
    accent: 'from-amber-600/90 to-white/10',
  },
  'elektrika-i-schitovoe-oborudovanie': {
    title: 'Электрика и щитовое оборудование',
    slug: 'elektrika-i-schitovoe-oborudovanie',
    to: '/catalog/elektrika-i-schitovoe-oborudovanie',
    description: 'автоматы, защита, щитовое оборудование и инженерные комплектующие',
    imageUrl: '/storage/images/root-category-elektrika.png',
    accent: 'from-red-700/90 to-white/10',
  },
};

export type PublicCategory = PublicCategoryPresentation;

/**
 * @deprecated Do not use for hierarchy/order.
 * Presentation values only; prefer categoryPresentationBySlug + useNavigation().
 */
export const publicCategories: PublicCategory[] = Object.values(categoryPresentationBySlug);

export function getCategoryPresentation(slug?: string | null): PublicCategoryPresentation | undefined {
  if (!slug) return undefined;
  return categoryPresentationBySlug[slug];
}

export const publicHeaderItems = [
  { to: '/', label: 'Главная' },
  { to: '/catalog', label: 'Каталог' },
  { to: '/brands', label: 'Бренды' },
  { to: '/tools', label: 'Инструменты' },
  { to: '/promotions', label: 'Акции' },
  { to: '/documentation', label: 'Документация' },
  { to: '/contacts', label: 'Контакты' },
] as const;

export const featuredBrands = [
  'Legrand', 'Danfoss', 'Emmeti', 'Riello', 'F.I.V.', 'DEVI', 'Fenix', 'Beretta', 'GEYA', 'BPS Clima', 'KVZ-Heat', 'JSL Electro', 'Thermostats', 'APC', 'Massive', 'Ideal Lux', 'Carlo Poletti', 'FLEXICORE', 'LAPP', 'Baltur', 'Tecofi', 'Licon', 'HIF', 'DAB', 'Intuis - Airelec', 'Krats', 'Bastion', 'Cablofil', 'Finder', 'Top Cable', 'IMAS', 'OJ Electronics', 'Korado', 'Techno Heat', 'Philips', 'Sira', 'Techno', 'TICA', 'Lena Lighting', 'Calpeda', 'OJT TAPE 21', 'Без бренда',
] as const;

export const contactCards = [
  { title: 'Телефон', value: '+374 (00) 00-00-00', hint: 'для заказов и подбора' },
  { title: 'Telegram / WhatsApp', value: '@ohmxam', hint: 'отправьте SKU, фото или задачу' },
  { title: 'Адрес', value: 'Ереван, шоурум / склад', hint: 'самовывоз и консультации по согласованию' },
] as const;
