/**
 * Fan-coil installation type: what the customer chooses per room, and which catalog series fit it.
 *
 * The catalog has no normalized mounting field (engineering parameter `mounting_type` is empty), so the
 * series → installation mapping is reviewed code with its source:
 *   MFR  = manufacturer document (Emmeti "Silence e UTO-UTV" scheda tecnica IT04; BPS Clima FC technical sheet);
 *   CARD = OhmX catalog card description ("Тип …").
 */
import { catalogIndex, str } from './selection/catalogIndex';

export type FanCoilMounting = 'EXPOSED_FLOOR_WALL' | 'EXPOSED_CEILING' | 'CONCEALED_WALL' | 'CONCEALED_CEILING' | 'CASSETTE';

export const FAN_COIL_MOUNTINGS: FanCoilMounting[] = ['EXPOSED_FLOOR_WALL', 'EXPOSED_CEILING', 'CONCEALED_WALL', 'CONCEALED_CEILING', 'CASSETTE'];

export const FAN_COIL_MOUNTING_TEXT: Record<FanCoilMounting, { label: string; sub: string; short: string }> = {
  EXPOSED_FLOOR_WALL: { label: 'Открытый: у пола или на стене', sub: 'В корпусе, вертикальный — стоит у пола или висит на стене', short: 'открытый, пол/стена' },
  EXPOSED_CEILING: { label: 'Открытый: под потолком', sub: 'В корпусе, горизонтальный — крепится к потолку', short: 'открытый, под потолком' },
  CONCEALED_WALL: { label: 'Скрытый: в стене или нише', sub: 'Встраиваемый без корпуса — видна только решётка или панель', short: 'скрытый, в стене' },
  CONCEALED_CEILING: { label: 'Скрытый: за подвесным потолком', sub: 'Встраиваемый / канальный — воздух через решётки в потолке', short: 'скрытый, в потолке' },
  CASSETTE: { label: 'Кассетный: в подвесной потолок', sub: 'Корпус над потолком, снизу видна только декоративная панель', short: 'кассетный' },
};

interface SeriesRule {
  /** Series in engineering_product_profile (+ optional model suffix test for BPS FC). */
  series: string;
  model?: RegExp;
  mountings: FanCoilMounting[];
  source: 'MFR' | 'CARD';
  note?: string;
}

const RULES: SeriesRule[] = [
  // BPS Clima FC: VM = with cabinet vertical, OM = with cabinet horizontal, IO = without cabinet horizontal (technical sheet: "Versions with / without cabinet").
  { series: 'FC', model: /-VM\d/, mountings: ['EXPOSED_FLOOR_WALL'], source: 'MFR' },
  { series: 'FC', model: /-OM\d/, mountings: ['EXPOSED_CEILING'], source: 'MFR' },
  { series: 'FC', model: /-IO\d/, mountings: ['CONCEALED_CEILING'], source: 'MFR' },
  // Emmeti Silence (scheda tecnica p.10–11): MV/MO "completa di mobile di copertura", IVO/IVP "da incasso".
  { series: 'MV', mountings: ['EXPOSED_FLOOR_WALL'], source: 'MFR' },
  { series: 'MO', mountings: ['EXPOSED_CEILING'], source: 'MFR' },
  { series: 'IVO', mountings: ['CONCEALED_WALL', 'CONCEALED_CEILING'], source: 'MFR' },
  { series: 'IVP', mountings: ['CONCEALED_WALL'], source: 'MFR' },
  // Emmeti UTO / UTV: "unità termoventilanti canalizzabili", to be configured with plenums / duct accessories.
  { series: 'UTO', mountings: ['CONCEALED_CEILING'], source: 'MFR', note: 'Канальный блок: нужны плёнумы / воздуховоды и решётки (аксессуары Emmeti), напор вентилятора проверить по сети воздуховодов.' },
  { series: 'UTV', mountings: ['CONCEALED_WALL'], source: 'MFR', note: 'Канальный вертикальный блок: нужна обвязка по воздуху (плёнум, решётки) — подобрать аксессуары Emmeti.' },
  // Riello: catalog cards — Design Inverter "вертикально-горизонтальный" designer cabinet; In Inverter built-in (thin walls, mounting box);
  // RK N "кассетные … для установки в потолок".
  { series: 'Design Inverter', mountings: ['EXPOSED_FLOOR_WALL', 'EXPOSED_CEILING'], source: 'CARD' },
  { series: 'In Inverter', mountings: ['CONCEALED_WALL', 'CONCEALED_CEILING'], source: 'CARD', note: 'Встраиваемый блок: нужны монтажная коробка и фронтальная панель In Inverter (есть в каталоге).' },
  { series: 'RK N', mountings: ['CASSETTE'], source: 'CARD' },
];

export interface FanCoilMountingInfo {
  mountings: FanCoilMounting[];
  source: 'MFR' | 'CARD' | null;
  note: string | null;
}

export function fanCoilMountingInfo(sku: string): FanCoilMountingInfo {
  const p = catalogIndex().get(sku);
  const series = str(p, 'series');
  const model = str(p, 'model') ?? p?.name ?? '';
  const rule = RULES.find((r) => r.series === series && (!r.model || r.model.test(model)));
  if (rule) return { mountings: rule.mountings, source: rule.source, note: rule.note ?? null };
  // Unprofiled catalog cassette units (e.g. BPS CA): the type is in the card name; no engineering data → never auto-selected.
  if (p && /^кассетн\w+ фанко/i.test(p.name)) return { mountings: ['CASSETTE'], source: 'CARD', note: null };
  return { mountings: [], source: null, note: null };
}

export function fanCoilFits(sku: string, mounting: FanCoilMounting): boolean {
  return fanCoilMountingInfo(sku).mountings.includes(mounting);
}

/** How many profiled catalog fan coils exist per installation type (shown next to the choice). */
export function fanCoilCountByMounting(): Record<FanCoilMounting, number> {
  const out = Object.fromEntries(FAN_COIL_MOUNTINGS.map((m) => [m, 0])) as Record<FanCoilMounting, number>;
  for (const p of catalogIndex().byType('FAN_COIL')) for (const m of fanCoilMountingInfo(p.sku).mountings) out[m] += 1;
  return out;
}

export function isFanCoilMounting(v: unknown): v is FanCoilMounting {
  return typeof v === 'string' && (FAN_COIL_MOUNTINGS as string[]).includes(v);
}
