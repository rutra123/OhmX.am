/** User-supplied pilot art. Sources: scripts/visual-catalog-assets.py.
 * Independent transparent layers; numeric source stems never imply SKU identity.
 * Public files live in client/pwa (the configured Vite publicDir).
 */
export type CompositionLayer = {
  src: string;
  srcSet: string;
  sizes: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sourceStem: string;
  sourceVariant: 'inspyrenet' | 'birefnet';
  widthPct: number;
  leftPct: number;
  bottomPct: number;
  z: number;
  /** Provenance only; adjacent category copy names the decorative artwork. */
  alt: string;
};
/**
 * description: Russian copy, also the fallback for descriptionKey (i18n, ru/en/hy).
 * layers: [] while the owner-supplied PNG art is pending; the card then shows the category's existing image.
 */
export type CategoryComposition = { slug: string; descriptionKey: string; description: string; layers: CompositionLayer[] };
const PARENT = 'hvac-i-teplosnabzhenie-avtomatika-hvac';
const AUTOMATION_PARENT = 'avtomatika-i-upravlenie';
const COMPOSITION_PARENTS = new Set([PARENT, AUTOMATION_PARENT]);
const ART = '/category-art/hvac-automation-v1';

/** Explicit build opt-in. A query preview can never enable a production build. */
export function isCategoryCompositionEnabled(slug: string | undefined, buildEnabled: boolean, development: boolean, queryValue: string | null): boolean {
  return Boolean(slug && COMPOSITION_PARENTS.has(slug)) && (buildEnabled || (development && queryValue === 'pilot'));
}

function layer(folder: string, name: string, sourceStem: string, sourceVariant: CompositionLayer['sourceVariant'], intrinsicWidth: number, intrinsicHeight: number, widthPct: number, leftPct: number, bottomPct: number, z: number, alt: string): CompositionLayer {
  const size = (cardWidth: number) => `${Math.ceil(cardWidth * 0.9 * widthPct / 100)}px`;
  // Stage is 90% of the card; mobile cards follow the viewport (34px page gutters, 12px column gap).
  const fluid = (columns: number, gutter: number) => `calc(${(0.9 * widthPct / 100 / columns).toFixed(4)} * (100vw - ${gutter}px))`;
  const smallWidth = sourceStem === '7335' ? 172 : Math.round(intrinsicWidth * Math.min(1, 320 / Math.max(intrinsicWidth, intrinsicHeight)));
  return {
    src: `${ART}/${folder}/${name}-640.webp`,
    srcSet: `${ART}/${folder}/${name}-320.webp ${smallWidth}w, ${ART}/${folder}/${name}-640.webp ${intrinsicWidth}w`,
    sizes: `(max-width: 699px) ${fluid(1, 34)}, (max-width: 767px) ${fluid(2, 46)}, (max-width: 1023px) ${size(460)}, ${size(630)}`,
    intrinsicWidth, intrinsicHeight, sourceStem, sourceVariant, widthPct, leftPct, bottomPct, z, alt,
  };
}

export const CATEGORY_COMPOSITIONS: CategoryComposition[] = [
  {
    slug: `${PARENT}-kontrollery-teplovyh-punktov`,
    descriptionKey: 'catalog.compositions.hvacControllers',
    description: 'Контроллеры и модули для управления тепловым пунктом.',
    layers: [
      layer('controllers', 'controllers-terminal-panel', '7280', 'birefnet', 640, 381, 34, 1, 10, 1, 'Клеммная панель ECL Comfort 210'),
      layer('controllers', 'controllers-ecl-comfort-310', '7247', 'birefnet', 640, 373, 52, 30, 14, 2, 'Контроллер Danfoss ECL Comfort 310'),
      layer('controllers', 'controllers-ecl-application-key-a266', '7279', 'inspyrenet', 485, 408, 17, 81, 60, 3, 'Ключ приложения Danfoss A266 для ECL Comfort'),
    ],
  },
  {
    slug: `${PARENT}-datchiki-rele-i-izmeritelnye-pribory`,
    descriptionKey: 'catalog.compositions.hvacSensors',
    description: 'Контроль температуры и давления в инженерных системах.',
    layers: [
      layer('sensors', 'sensors-kpi36-pressure-switch', '7332', 'birefnet', 618, 640, 28, 1, 10, 1, 'Реле давления Danfoss KPI 36'),
      layer('sensors', 'sensors-kp61-capillary', '7329', 'birefnet', 394, 640, 25, 33, 5, 2, 'Реле температуры Danfoss KP61 с капиллярной трубкой'),
      layer('sensors', 'sensors-pressure-gauge', '7338', 'birefnet', 284, 366, 18, 65, 45, 3, 'Манометр со шкалой 0–6 бар'),
      layer('sensors', 'sensors-mbs3000-transmitter', '7335', 'inspyrenet', 345, 640, 12, 86, 10, 1, 'Датчик давления Danfoss MBS 3000'),
    ],
  },
  {
    slug: `${PARENT}-termostaty-i-pulty-upravleniya`,
    descriptionKey: 'catalog.compositions.hvacThermostats',
    description: 'Термостаты и панели для отопления и фанкойлов.',
    layers: [
      layer('thermostats', 'thermostats-fancoil-display', '7309', 'birefnet', 640, 571, 29, 1, 17, 1, 'Термостат для фанкойла с цветным дисплеем'),
      layer('thermostats', 'thermostats-underfloor-control', '7315', 'birefnet', 512, 577, 34, 33, 7, 2, 'Терморегулятор для тёплого пола BT02-HT-b'),
      layer('thermostats', 'thermostats-round-display', '7310', 'inspyrenet', 327, 317, 24, 75, 25, 3, 'Круглый электронный термостат; модель не установлена'),
    ],
  },
  {
    slug: `${PARENT}-elektroprivody-klapanov`,
    descriptionKey: 'catalog.compositions.hvacActuators',
    description: 'Линейные, поворотные и термоэлектрические приводы.',
    layers: [
      layer('actuators', 'actuators-amb182', '7305', 'birefnet', 640, 556, 33, 1, 13, 1, 'Поворотный электропривод Danfoss AMB 182'),
      layer('actuators', 'actuators-linear-linkage', '7295', 'birefnet', 420, 640, 25, 40, 5, 2, 'Линейный электропривод Danfoss с тягами'),
      layer('actuators', 'actuators-thermal-cable', '7304', 'birefnet', 484, 463, 27, 71, 15, 3, 'Термоэлектрический привод Danfoss с кабелем'),
    ],
  },
  // Approved order 1–7 of "Автоматика и управление"; art follows the owner PNG list (reports/catalog-consolidation-20261021).
  ...([
    ['promezhutochnye-rele-i-taymery', 'automationRelaysTimers', 'Промежуточные и импульсные реле, реле времени, таймеры и модули защиты.'],
    ['rele-kontrolya-i-zaschity', 'automationMonitoringRelays', 'Контроль напряжения, фаз, тока, температуры и уровня жидкости.'],
    ['kontrolno-izmeritelnye-pribory', 'automationMeasuring', 'Мультиметры, счётчики, вольтметры и амперметры для щитов.'],
    ['kontrollery-avr', 'automationAts', 'Контроллеры и переключатели автоматического ввода резерва.'],
    ['knopki-indikatory-i-posty-upravleniya', 'automationPushbuttons', 'Кнопки, переключатели, кнопочные посты и комплектующие.'],
    ['chastotnye-preobrazovateli', 'automationDrives', 'Преобразователи частоты для двигателей и панели управления.'],
    ['domofony-i-dvernye-zvonki', 'automationIntercoms', 'Видеодомофоны и дверные звонки для квартир и домов.'],
  ] as const).map(([slugPart, key, description]) => ({
    slug: `${AUTOMATION_PARENT}-${slugPart}`,
    descriptionKey: `catalog.compositions.${key}`,
    description,
    layers: [],
  })),
];

export function getCategoryComposition(slug: string): CategoryComposition | undefined {
  return CATEGORY_COMPOSITIONS.find((composition) => composition.slug === slug);
}
