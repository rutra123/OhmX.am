/**
 * Export of the equipment specification: "Всё в корзину" and PDF (pdfmake, loaded only on click).
 * Builders are pure so they can be tested without a browser.
 */
import { MATCH_CLASS_LABEL } from './selection/types';
import type { BomLine, EquipmentSpec, LineGroup } from './equipmentEngine';

export const EXPORT_GROUP_TITLE: Record<LineGroup, string> = {
  main: '1. Тепловой источник и терминальные приборы',
  distribution: '2. Гидравлическое распределение',
  pumps: '3. Циркуляция, разделение и безопасность',
  automation: '4. Автоматика и управление',
  fittings: '5. Трубы, арматура и принадлежности',
};
const GROUPS = Object.keys(EXPORT_GROUP_TITLE) as LineGroup[];

/** Four independent statuses of a position (availability, price, engineering selection, what is still required). */
export function lineStatuses(line: BomLine): { availability: string; price: string; engineering: string; required: string | null } {
  const p = line.product;
  const qtyStock = line.match?.stock?.source === 'quantity' ? line.match.stock : null;
  const availability = line.status !== 'catalog' || !p ? 'не применимо'
    : qtyStock ? (qtyStock.status === 'SUFFICIENT' ? `достаточно (${qtyStock.available} шт.)` : qtyStock.status === 'INSUFFICIENT' ? `не хватает: есть ${qtyStock.available} из ${qtyStock.required}` : 'нет на складе')
      : p.inStock === true ? 'в наличии (количество не подтверждено)' : p.inStock === false ? 'под заказ' : 'не подтверждено';
  const price = line.status !== 'catalog' || !p ? 'нет цены' : p.priceAmd != null ? `подтверждена: ${Math.round(p.priceAmd).toLocaleString('ru-RU')} драм` : 'по запросу';
  const engineering = line.match ? MATCH_CLASS_LABEL[line.match.verdict]
    : line.engineering === 'verified' ? 'подтверждён' : line.engineering === 'preliminary' ? 'предварительный' : line.status === 'catalog' ? 'по паспорту' : 'не определён';
  const required = line.engineering === 'preliminary' ? 'инженерное подтверждение до заказа' : null;
  return { availability, price, engineering, required };
}

export type SpecCartItem = {
  productId: number;
  slug: string;
  sku: string;
  name: string;
  price: number;
  image?: string;
  quantity: number;
  unit?: string;
  group?: LineGroup;
};

/** Lines that can go to the cart right now (catalog product, on stock with a price, known quantity). */
export function cartItemsFromSpec(spec: EquipmentSpec, options: { includePreliminary?: boolean } = {}): { items: SpecCartItem[]; skipped: BomLine[] } {
  const items: SpecCartItem[] = [];
  const skipped: BomLine[] = [];
  for (const line of spec.lines) {
    if (line.status !== 'catalog' || line.excluded) continue;
    // Engineering candidates (heat pump, pumps without a Q–H curve, separator) are added only on explicit request.
    if (line.engineering === 'preliminary' && !options.includePreliminary) {
      skipped.push(line);
      continue;
    }
    const product = line.product;
    const quantity = line.quantity != null ? Math.ceil(line.quantity) : 0;
    if (!product || !product.id || !product.canAddToCart || product.priceAmd == null || quantity <= 0) {
      skipped.push(line);
      continue;
    }
    items.push({ productId: product.id, slug: product.slug, sku: product.sku, name: product.name, price: product.priceAmd, image: product.image || undefined, quantity, unit: line.unit !== 'шт' ? line.unit : undefined, group: line.group });
  }
  return { items, skipped };
}

function amd(n: number | null | undefined): string {
  // the bundled Roboto has no Armenian dram sign → spelled out
  return n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} драм`;
}

function qtyText(line: BomLine): string {
  if (line.quantity == null) return line.qtyStatus === 'by_installer' ? 'по месту' : '—';
  return `${Number(line.quantity.toFixed(2))} ${line.unit}${line.qtyStatus === 'estimated' ? '*' : ''}`;
}

function availability(line: BomLine): string {
  if (line.excluded) return 'не включено';
  if (line.status === 'choice' && line.choice?.selectedId) return 'подтверждено';
  if (line.status === 'choice') return 'нужен выбор';
  if (line.status === 'missing') return 'нет в каталоге';
  if (!line.product) return '—';
  if (line.product.inStock === true) return 'в наличии';
  if (line.product.inStock === false) return 'под заказ';
  return line.product.availabilityLabel || '—';
}

function plantSections(spec: EquipmentSpec): unknown[] {
  const out: unknown[] = [];
  const hp = spec.plant.heatPump;
  if (hp) {
    out.push({ text: 'Тепловой источник — кандидаты Riello', style: 'h2' });
    out.push({
      text: `Основание требования: ${hp.basis === 'override' ? 'нагрузка задана инженером' : hp.basis === 'building_load' ? 'предварительный расчёт нагрузок' : hp.basis === 'connected_terminals' ? 'сумма мощностей приборов (не нагрузка здания)' : 'не определено'}; `
        + `нагрев ${hp.requiredHeatingKw != null ? hp.requiredHeatingKw.toFixed(2) : '—'} кВт, охлаждение ${hp.requiredCoolingKw != null ? hp.requiredCoolingKw.toFixed(2) : '—'} кВт.`
        + `${hp.connectedCoolingKw != null ? ` Подключено фанкойлов: охлаждение ${hp.connectedCoolingKw} кВт${hp.connectedHeatingKw != null ? `, нагрев ${hp.connectedHeatingKw} кВт` : ''} (паспортные мощности приборов).` : ''}`,
      style: 'note',
    });
    out.push({
      table: {
        headerRows: 1, widths: ['*', 40, 40, 50, 70],
        body: [
          ['Модель', 'Нагрев, кВт', 'Охл., кВт', 'Наличие', 'Вывод'].map((t) => ({ text: t, style: 'th' })),
          ...hp.candidates.map((c) => [
            { text: `${c.name} (${c.sku})${c.sku === hp.selectedSku ? ' — выбран' : ''}`, bold: c.sku === hp.selectedSku },
            { text: String(c.heatingKw), alignment: 'right' }, { text: String(c.coolingKw), alignment: 'right' },
            c.inStock === true ? 'в наличии' : c.inStock === false ? 'под заказ' : '—',
            c.verdict === 'suitable_preliminary' ? 'подходит предварительно' : c.verdict === 'insufficient' ? 'мощности недостаточно' : 'не подходит',
          ]),
        ],
      },
      layout: 'lightHorizontalLines', style: 'table',
    });
  }
  const t = spec.plant.topology;
  if (t) {
    out.push({ text: 'Гидравлическая схема', style: 'h2' });
    out.push({ text: t.label, bold: true });
    out.push({ ul: [...t.rationale, ...t.unresolved].map((r) => ({ text: r, style: 'note' })) });
  }
  return out;
}

export type SpecPdfMeta = { projectName: string; serviceLabel?: string; date?: Date; siteUrl?: string };

/** pdfmake document definition (plain object). */
export function buildSpecPdfDefinition(spec: EquipmentSpec, meta: SpecPdfMeta): Record<string, unknown> {
  const s = spec.summary;
  const date = (meta.date ?? new Date()).toLocaleDateString('ru-RU');
  const content: unknown[] = [
    { text: 'Спецификация оборудования', style: 'title' },
    { text: `${meta.projectName}${meta.serviceLabel ? ` · ${meta.serviceLabel}` : ''}`, style: 'subtitle' },
    { text: `Дата: ${date}${meta.siteUrl ? ` · ${meta.siteUrl}` : ''}`, style: 'muted', margin: [0, 0, 0, 8] },
    {
      columns: [
        { width: '*', text: [{ text: 'Площадь: ', bold: true }, s.totalAreaM2 != null ? `${Number(s.totalAreaM2.toFixed(1))} м²` : '—'] },
        { width: '*', text: [{ text: 'Отопление: ', bold: true }, s.heatingRequiredW != null ? `${(s.heatingRequiredW / 1000).toFixed(2)} кВт` : '—'] },
        { width: '*', text: [{ text: 'Охлаждение: ', bold: true }, s.coolingW != null ? `${(s.coolingW / 1000).toFixed(2)} кВт` : '—'] },
      ],
      margin: [0, 0, 0, 4],
    },
    { text: [{ text: 'Схема: ', bold: true }, s.configuration || '—'], margin: [0, 0, 0, 6] },
    {
      text: [{ text: 'Статус подбора: ', bold: true }, spec.plant.status === 'verified' ? 'ПОДТВЕРЖДЁН' : 'ПРЕДВАРИТЕЛЬНЫЙ — требует инженерной проверки'],
      color: spec.plant.status === 'verified' ? '#166534' : '#b45309', margin: [0, 0, 0, 2],
    },
    { text: `Комплектность: из каталога ${spec.plant.completeness.fromCatalog} из ${spec.plant.completeness.total} позиций (${spec.plant.completeness.percent} %); кандидатов на проверку ${spec.plant.completeness.candidatesToVerify}, нет в каталоге ${spec.plant.completeness.missing}, нужен выбор ${spec.plant.completeness.choices}.`, style: 'muted', margin: [0, 0, 0, 6] },
    ...(spec.plant.statusReasons.length ? [{ ul: spec.plant.statusReasons.map((r) => ({ text: r, style: 'note' })), margin: [0, 0, 0, 6] }] : []),
    ...plantSections(spec),
  ];

  let n = 0;
  const header = ['№', 'Наименование', 'Код', 'Кол-во', 'Цена', 'Сумма', 'Наличие'].map((t) => ({ text: t, style: 'th' }));
  for (const group of GROUPS) {
    const lines = spec.lines.filter((l) => l.group === group && l.status !== 'missing');
    if (!lines.length) continue;
    const body: unknown[][] = [header];
    for (const line of lines) {
      n += 1;
      const price = line.status === 'catalog' ? line.product?.priceAmd ?? null : null;
      const total = price != null && line.quantity != null ? price * line.quantity : null;
      const name: unknown[] = [{ text: line.status === 'catalog' ? line.product?.name ?? line.name : line.name, bold: line.group === 'main' }];
      if (line.status === 'choice' && line.choice?.selectedId) {
        name.push({ text: line.excluded ? `Не входит в эту спецификацию: ${line.reason}` : `Решение: ${line.reason}`, style: 'note' });
      } else if (line.status === 'choice' && line.candidates.length) {
        name.push({ text: `Варианты: ${line.candidates.map((c) => `${c.sku}${c.inStock ? ' (в наличии)' : ''}`).join(', ')}`, style: 'note' });
      }
      if (line.engineering === 'preliminary') {
        const st = lineStatuses(line);
        name.push({ text: `ПРЕДВАРИТЕЛЬНЫЙ КАНДИДАТ${line.optional ? ' (рекомендуется)' : ''} · наличие: ${st.availability} · цена: ${st.price} · подбор: ${st.engineering} · требуется: ${st.required}`, style: 'note', color: '#b45309', bold: true });
      }
      for (const d of line.details) name.push({ text: d, style: 'note' });
      if (line.checks.length) name.push({ text: `Проверить: ${line.checks.join(' ')}`, style: 'note' });
      body.push([
        { text: String(n), alignment: 'right' },
        { stack: name },
        line.status === 'catalog' && line.sku ? line.sku : '—',
        { text: qtyText(line), alignment: 'right' },
        { text: line.status === 'catalog' ? (price != null ? amd(price) : 'по запросу') : '—', alignment: 'right' },
        { text: total != null ? amd(total) : '—', alignment: 'right' },
        availability(line),
      ]);
    }
    content.push({ text: EXPORT_GROUP_TITLE[group], style: 'h2' });
    content.push({ table: { headerRows: 1, widths: [16, '*', 58, 44, 52, 58, 50], body }, layout: 'lightHorizontalLines', style: 'table' });
  }

  const missing = spec.lines.filter((l) => l.status === 'missing');
  if (missing.length) {
    content.push({ text: '6. Нужно для монтажа, нет в каталоге (закупка отдельно)', style: 'h2' });
    content.push({
      table: {
        headerRows: 1,
        widths: [16, '*', 60],
        body: [
          [{ text: '№', style: 'th' }, { text: 'Наименование', style: 'th' }, { text: 'Кол-во', style: 'th' }],
          ...missing.map((line) => { n += 1; return [{ text: String(n), alignment: 'right' }, line.name, { text: qtyText(line), alignment: 'right' }]; }),
        ],
      },
      layout: 'lightHorizontalLines',
      style: 'table',
    });
  }

  content.push({ text: [{ text: 'Подтверждённая сумма по позициям с ценой: ', bold: true }, { text: amd(spec.totals.pricedSubtotalAmd), bold: true }], margin: [0, 12, 0, 4] });
  if (spec.totals.unpricedPositions.length) {
    content.push({ text: 'Обязательные позиции без цены (не входят в сумму):', bold: true, margin: [0, 4, 0, 2] });
    content.push({ ul: spec.totals.unpricedPositions.slice(0, 40).map((t) => ({ text: t, style: 'note' })) });
  }
  content.push({
    text: `Это не полная стоимость проекта: ${spec.totals.unpricedLines} поз. по запросу цены, ${spec.totals.choiceLines} поз. требуют выбора, ${spec.totals.missingLines} поз. нет в каталоге. Монтажные работы не включены. * — количество ориентировочное. Предварительный подбор: подтверждается менеджером / инженером.`,
    style: 'muted',
  });
  content.push({
    text: 'Позиции со статусом «предварительный кандидат» имеют подтверждённые наличие и цену по каталогу, но подбор требует инженерного подтверждения: документ не является подтверждённым заказом и не заменяет проект.',
    style: 'muted', margin: [0, 4, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [28, 32, 28, 36],
    info: { title: `Спецификация — ${meta.projectName}` },
    content,
    footer: (current: number, count: number) => ({ text: `OhmX.am · стр. ${current} из ${count}`, alignment: 'center', fontSize: 7, color: '#64748b', margin: [0, 10, 0, 0] }),
    defaultStyle: { font: 'Roboto', fontSize: 8, lineHeight: 1.15 },
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
      subtitle: { fontSize: 10, margin: [0, 0, 0, 2] },
      h2: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] },
      th: { bold: true, fillColor: '#f1f5f9' },
      table: { margin: [0, 0, 0, 4] },
      note: { fontSize: 7, color: '#64748b' },
      muted: { fontSize: 7.5, color: '#64748b' },
    },
  };
}

export function specPdfFileName(projectName: string, date = new Date()): string {
  const safe = projectName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'проект';
  return `Спецификация ${safe} ${date.toISOString().slice(0, 10)}.pdf`;
}

function loadClassicScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('не удалось загрузить шрифты PDF'));
    document.head.appendChild(script);
  });
}

/** Loads pdfmake (+ Roboto with Cyrillic) on demand and downloads the PDF. */
export async function downloadSpecPdf(spec: EquipmentSpec, meta: SpecPdfMeta): Promise<void> {
  if (spec.pendingChoices?.length) throw new Error(`не сделан выбор: ${spec.pendingChoices.map((c) => c.name).join('; ')}`);
  // vfs_fonts.js is a classic script ("this.pdfMake.vfs = …"): it must run as <script>, not as an ES module.
  const [pdfMakeModule, fontsUrlModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts.js?url')]);
  const pdfMake: any = (pdfMakeModule as any).default ?? pdfMakeModule;
  const globalPdfMake = () => (window as unknown as { pdfMake?: { vfs?: Record<string, string> } }).pdfMake;
  if (!globalPdfMake()?.vfs) await loadClassicScript(fontsUrlModule.default);
  const vfs = globalPdfMake()?.vfs;
  if (!vfs) throw new Error('шрифты PDF не найдены');
  pdfMake.vfs = vfs;
  pdfMake.createPdf(buildSpecPdfDefinition(spec, meta)).download(specPdfFileName(meta.projectName, meta.date));
}
