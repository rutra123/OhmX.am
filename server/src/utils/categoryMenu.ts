import fs from 'node:fs';
import path from 'node:path';

export type CategoryMenuNode = {
  id: number;
  parent_id: number | null;
  level: number;
  name_ru: string;
  name_en: string;
  slug: string;
  image_url: string;
  path_ru: string;
  path_en: string;
  has_children: boolean;
  children: CategoryMenuNode[];
};

type CsvRow = {
  id: string;
  parent_id: string;
  level: string;
  ru_title: string;
  en_title: string;
  image_url: string;
  detected_image_url: string;
  ru_slug: string;
  en_slug: string;
  path_ru: string;
  path_en: string;
  category_default_image_url: string;
};

const csvPath = path.resolve(process.cwd(), '..', 'ohmx_category_structure_with_images_en.clean.csv');
const hiddenRootIds = new Set([67, 68, 69, 87, 236, 263, 267, 271]);
const rootOrder = new Map<number, number>([
  [7, 1],
  [44, 2],
  [57, 3],
  [27, 4],
  [8, 5],
  [98, 6],
  [60, 7],
  [59, 8],
  [63, 9],
]);
const rootTitleOverrides = new Map<number, string>([
  [7, 'Электрика'],
  [44, 'Щиты и шкафы'],
  [57, 'Освещение'],
  [87, 'Домашнее освещение'],
  [27, 'Электрическое отопление'],
  [8, 'Водяное отопление'],
  [98, 'Котельное оборудование'],
  [60, 'HVAC и теплоснабжение'],
  [59, 'Силовое оборудование'],
  [63, 'Автоматика и управление'],
]);
const titleOverrides = new Map<number, string>([
  [15, 'Модульная защита'],
  [16, 'УЗО'],
  [17, 'Розетки и выключатели'],
  [31, 'Сопутствующие товары'],
  [101, 'Саморегулируемые кабели'],
  [102, 'Аксессуары для котельного оборудования'],
  [103, 'Конвекторы'],
  [104, 'Напольные конвекторы'],
  [105, 'Регулирующие клапаны'],
  [106, 'Пластинчатые теплообменники'],
  [107, 'Трубопроводная арматура'],
  [108, 'Редукторные электроприводы'],
  [109, 'Аксессуары Devi и Airelec'],
  [151, 'Клапаны для тёплого пола'],
  [152, 'Комнатные термостаты'],
  [153, 'Смесительные узлы'],
  [154, 'Термоэлектрические приводы'],
  [156, 'Термостатические элементы'],
  [157, 'Коллекторы и аксессуары'],
  [158, 'Трубы и фитинги Danfoss'],
  [165, 'Балансировочные клапаны'],
  [166, 'Контроллеры тепловых пунктов'],
  [167, 'Регуляторы давления'],
  [171, 'Реле давления и температуры'],
  [173, 'Аксессуары DX³'],
  [176, 'Монтаж и промышленные разъёмы'],
  [177, 'Клеммные блоки Viking 3'],
  [178, 'Трансформаторы управления'],
  [180, 'Промышленные разъёмы P17 Tempra'],
  [181, 'Клеммы, блоки и шины'],
  [182, 'Воздушные выключатели'],
  [183, 'Промышленные контакторы'],
  [185, 'Выключатели-разъединители'],
  [186, 'Защита электродвигателей'],
  [188, 'Защита от импульсных перенапряжений'],
  [190, 'Шкафы XL³ 400'],
  [191, 'Шкафы XL³ 800'],
  [192, 'Щиты Atlantic IP66'],
  [193, 'Мини-каналы DLPlus'],
  [194, 'Кабель-каналы DLP'],
  [196, 'Напольные кабель-каналы и блоки'],
  [197, 'Радиаторное отопление'],
  [198, 'Внутрипольные конвекторы'],
  [199, 'Настенные конвекторы'],
  [200, 'Системы отопления'],
  [201, 'Дисковые затворы'],
  [202, 'Шаровые краны'],
  [203, 'Сетчатые фильтры'],
  [204, 'Обратные клапаны'],
  [207, 'Седельные регулирующие клапаны'],
  [208, 'Поворотные регулирующие клапаны'],
  [209, 'Зональные клапаны'],
  [211, 'Кондиционирование'],
  [212, 'Комнатные термостаты'],
  [213, 'Клапаны VZ'],
  [214, 'Клапаны VZL'],
  [215, 'Балансировочные клапаны AB-QM'],
  [216, 'Зональные клапаны'],
  [217, 'Редукторные электроприводы'],
  [218, 'Термоэлектрические приводы'],
  [219, 'Кабельные лотки'],
  [222, 'Специальные конвекторы'],
  [223, 'Электрическая регулировка'],
  [224, 'Регулировка теплоносителя'],
  [243, 'Автоматические выключатели RX³'],
  [244, 'УЗО RX³'],
  [255, 'Автоматические выключатели DRX'],
  [277, 'Отопительные приборы'],
  [278, 'Алюминиевые радиаторы Sira'],
  [282, 'Аксессуары для радиаторов Korado'],
  [292, 'Кабель-каналы Metra / DLP-S'],
  [293, 'Мини-каналы Metra / DLP-S'],
  [294, 'Беспроводное управление'],
  [318, 'Системы обогрева Fenix'],
  [319, 'Одножильные кабели ASL1P'],
  [320, 'Двухжильные кабели ADPSV'],
  [321, 'Обогрев зеркал Ecofilm MHF'],
  [325, 'Запчасти для котлов'],
]);
let cache: { mtimeMs: number; roots: CategoryMenuNode[]; bySlug: Map<string, CategoryMenuNode>; breadcrumbs: Map<string, CategoryMenuNode[]> } | null = null;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      if (current.length || row.length) {
        row.push(current.trim());
        rows.push(row);
      }
      current = '';
      row = [];
    } else {
      current += char;
    }
  }
  if (current.length || row.length) {
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function cleanMenuTitle(title: string, id: number) {
  const override = titleOverrides.get(id) || rootTitleOverrides.get(id);
  if (override) return override;
  let value = title.trim();
  value = value.replace(/\s+\d+\s+товар(?:ов|а)?\.?$/iu, '').trim();
  return value.replace(/\s*»\s*$/u, '').trim();
}

function cloneForMenu(node: CategoryMenuNode): CategoryMenuNode {
  return {
    ...node,
    name_ru: cleanMenuTitle(node.name_ru, node.id),
    children: node.children.map(cloneForMenu),
  };
}

function loadMenu() {
  const stat = fs.statSync(csvPath);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  const headers = rows[0] || [];
  const data = rows.slice(1).filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] || '']))) as CsvRow[];

  const byId = new Map<number, CategoryMenuNode>();
  const bySlug = new Map<string, CategoryMenuNode>();
  const breadcrumbs = new Map<string, CategoryMenuNode[]>();

  for (const row of data) {
    const node: CategoryMenuNode = {
      id: Number(row.id),
      parent_id: row.parent_id ? Number(row.parent_id) : null,
      level: Number(row.level || 0),
      name_ru: row.ru_title,
      name_en: row.en_title,
      slug: row.en_slug || row.ru_slug,
      image_url: row.image_url || row.detected_image_url || row.category_default_image_url || '',
      path_ru: row.path_ru,
      path_en: row.path_en,
      has_children: false,
      children: [],
    };
    byId.set(node.id, node);
    if (node.slug) bySlug.set(node.slug, node);
  }

  for (const node of byId.values()) {
    if (!node.parent_id) continue;
    const parent = byId.get(node.parent_id);
    if (!parent) continue;
    parent.children.push(node);
    parent.has_children = true;
  }

  for (const node of byId.values()) {
    node.children.sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'));
  }

  const roots = [...byId.values()]
    .filter((node) => !node.parent_id && node.children.length > 0 && !hiddenRootIds.has(node.id))
    .sort((a, b) => {
      const orderA = rootOrder.get(a.id) ?? 999;
      const orderB = rootOrder.get(b.id) ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return cleanMenuTitle(a.name_ru, a.id).localeCompare(cleanMenuTitle(b.name_ru, b.id), 'ru');
    })
    .map(cloneForMenu);

  const lightingRoot = roots.find((node) => node.id === 57);
  const domesticLighting = byId.get(87);
  if (lightingRoot && domesticLighting) {
    const merged = domesticLighting.children.map(cloneForMenu);
    const seen = new Set(lightingRoot.children.map((child) => child.id));
    for (const child of merged) {
      if (!seen.has(child.id)) lightingRoot.children.push(child);
    }
    lightingRoot.children.sort((a, b) => a.name_ru.localeCompare(b.name_ru, 'ru'));
  }

  const makeTrail = (node: CategoryMenuNode) => {
    const trail: CategoryMenuNode[] = [];
    let current: CategoryMenuNode | undefined = node;
    while (current) {
      trail.unshift(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    breadcrumbs.set(node.slug, trail);
  };

  for (const node of byId.values()) makeTrail(node);

  cache = { mtimeMs: stat.mtimeMs, roots, bySlug, breadcrumbs };
  return cache;
}

export function getCategoryMenuRoots() {
  return loadMenu().roots;
}

export function getCategoryMenuNode(slug: string) {
  const state = loadMenu();
  return state.bySlug.get(slug) || null;
}

export function getCategoryMenuBreadcrumbs(slug: string) {
  const state = loadMenu();
  return state.breadcrumbs.get(slug) || [];
}
