export interface CategoryNode {
  name: string;
  slug: string;
  icon?: string;
  subcategories?: CategoryNode[];
}

export const OHMX_ROOT_CATEGORIES: CategoryNode[] = [
  { name: 'Электрика', slug: 'elektrika' },
  { name: 'Розетки и выключатели', slug: 'rozetki-i-vyklyuchateli' },
  { name: 'Щиты и шкафы', slug: 'shchity-i-shkafy' },
  { name: 'Кабельные системы', slug: 'kabelnye-sistemy' },
  { name: 'Освещение', slug: 'osveshchenie' },
  { name: 'Электрическое отопление', slug: 'elektricheskoe-otoplenie' },
  { name: 'Водяное отопление и котельная', slug: 'vodyanoe-otoplenie-i-kotelnaya' },
  { name: 'HVAC и охлаждение', slug: 'hvac-i-okhlazhdenie' },
  { name: 'Трубопроводная арматура и гидравлика', slug: 'truboprovodnaya-armatura-i-gidravlika' },
  { name: 'Силовое оборудование и UPS', slug: 'silovoe-oborudovanie-i-ups' },
  { name: 'Автоматика и управление', slug: 'avtomatika-i-upravlenie' },
  { name: 'Запчасти и сервис', slug: 'zapchasti-i-servis' },
  { name: 'Акции', slug: 'akcii' },
];

export const CATEGORY_MAPPING: Record<string, string> = {
  // Old category name exact match -> New root category slug
  'Электротехнические изделия Legrand (Франция)': 'elektrika',
  'Электротехнические изделия GEYA (Китай)': 'avtomatika-i-upravlenie', // fallback, script logic will also check brand
  'Электротехнические изделия JSL Electro (Португалия)': 'rozetki-i-vyklyuchateli',
  'Оборудование и системы электрического отопления': 'elektricheskoe-otoplenie',
  'Водяное отопление - котлы, батареи, радиаторы отопления': 'vodyanoe-otoplenie-i-kotelnaya',
  'Система теплоснабжения и охлаждения': 'hvac-i-okhlazhdenie',
  'Фанкойлы': 'hvac-i-okhlazhdenie',
  'Система кондиционирования воздуха': 'hvac-i-okhlazhdenie',
  'UPS': 'silovoe-oborudovanie-i-ups',
  'Специальные предложения': 'akcii',
  'Action': 'akcii',
  'Электрические кабели и провода': 'kabelnye-sistemy',
  'Освещение': 'osveshchenie',
  'Промышленное оборудование Finder': 'avtomatika-i-upravlenie',
  'Насосы': 'truboprovodnaya-armatura-i-gidravlika',
  'Контрольно-измерительные приборы и автоматика': 'avtomatika-i-upravlenie',
  'Водопроводная и запорная арматура': 'truboprovodnaya-armatura-i-gidravlika',
  'Mеталлопластиковые трубы и фитинги': 'truboprovodnaya-armatura-i-gidravlika',
  'Преобразователи частоты Danfoss VLT': 'avtomatika-i-upravlenie',
  'Бойлеры-аккумуляторы, баки для воды': 'vodyanoe-otoplenie-i-kotelnaya',
};

export function getMappedCategorySlug(oldCategoriesStr: string, productName: string): string {
  const parts = oldCategoriesStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (CATEGORY_MAPPING[part]) {
      return CATEGORY_MAPPING[part];
    }
  }
  
  const lowerName = productName.toLowerCase();
  if (lowerName.includes('розетк') || lowerName.includes('выключател')) return 'rozetki-i-vyklyuchateli';
  if (lowerName.includes('кабель') || lowerName.includes('провод')) return 'kabelnye-sistemy';
  if (lowerName.includes('светильник') || lowerName.includes('лампа')) return 'osveshchenie';
  if (lowerName.includes('насос')) return 'truboprovodnaya-armatura-i-gidravlika';
  if (lowerName.includes('терморегулятор') || lowerName.includes('теплый пол') || lowerName.includes('тёплый пол') || lowerName.includes('мат') || lowerName.includes('кабель нагревательный')) return 'elektricheskoe-otoplenie';
  if (lowerName.includes('котел') || lowerName.includes('котёл') || lowerName.includes('радиатор')) return 'vodyanoe-otoplenie-i-kotelnaya';
  if (lowerName.includes('ибп') || lowerName.includes('ups') || lowerName.includes('стабилизатор')) return 'silovoe-oborudovanie-i-ups';
  if (lowerName.includes('реле') || lowerName.includes('контактор')) return 'avtomatika-i-upravlenie';

  return 'elektrika'; // fallback root
}
