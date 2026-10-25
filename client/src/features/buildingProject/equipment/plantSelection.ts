/**
 * Heat source + hydraulic topology assessment (pure, deterministic).
 *
 * Policy: connected terminal capacity is NOT a building load. Every result is PRELIMINARY unless the
 * manufacturer capacity at the design outdoor/water temperatures and the building loads are both known —
 * which this module cannot establish from nominal ratings, so `verified` is never set by it.
 * Nothing here invents manufacturer data: unknown values stay `null` and are reported as unresolved.
 */

export interface HeatPumpFact {
  sku: string;
  name: string;
  family: string;
  /** Heating rating, kW, with its rating point. */
  heating: { kw: number; condition: string }[];
  cooling: { kw: number; condition: string }[];
  cop?: number | null;
  eer?: number | null;
  electricalInputHeatingKw?: number | null;
  electricalInputCoolingKw?: number | null;
  maxWaterTempC: number | null;
  minWaterTempCoolingC: number | null;
  outdoorMinC: number | null;
  outdoorMaxC: number | null;
  refrigerant: string | null;
  power: string | null;
  connection: string | null;
  /** Dimensions H×W×D, mm, per unit. */
  dimensions: { label: string; hMm: number; wMm: number; dMm: number }[];
  /** null = not documented in OhmX records (never assumed). */
  integratedPump: boolean | null;
  minFlowM3h: number | null;
  minWaterVolumeL: number | null;
  modulationMinPct: number | null;
  weightKg: number | null;
  /** Factory set composition (split systems): what the OhmX SKU physically is. */
  set?: { officialName: string; odu: string; idu: string; complete: boolean; withBackupHeater: boolean | null; notes: string[] };
  /** Documented pump / hydraulic limits (null = not documented). */
  pumpMaxHeadM?: number | null;
  flowRangeM3h?: [number, number] | null;
  flowSwitchOpenM3h?: number | null;
  internalWaterL?: number | null;
  expansionVesselL?: number | null;
  clearancesMm?: string | null;
  refrigerantLines?: string | null;
  weightsKg?: string | null;
  /** Engineering data readiness in the OhmX catalog. */
  profileState: 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'NONE';
  evidence: string[];
  notes: string[];
}

/**
 * Riello heat pumps present in the OhmX catalog (audit 2026-10-14).
 * 20205767 / 20205776: engineering_value rows (profile COMPLETE) + catalog card dimensions.
 * 20203649: catalog card text only (profile BLOCKED, legacy import) — candidate, never "verified".
 */
export const HEAT_PUMPS: HeatPumpFact[] = [
  {
    sku: '20205767',
    name: 'Riello Family Sprint 012M R32 (SET SPRINT 12 KW M BH)',
    family: 'Family Sprint (сплит: наружный блок + внутренний гидромодуль)',
    heating: [
      { kw: 12.1, condition: 'наруж. +7 °C / вода 30→35 °C (EN 14511)' },
      { kw: 12.3, condition: 'наруж. +7 °C / вода 40→45 °C (EN 14511), COP 3.8' },
      { kw: 12.0, condition: 'наруж. +7 °C / вода 47→55 °C (EN 14511), COP 3.1' },
    ],
    cooling: [
      { kw: 11.6, condition: 'наруж. +35 °C / вода 12→7 °C (EN 14511)' },
      { kw: 12.0, condition: 'наруж. +35 °C / вода 23→18 °C (EN 14511), EER 4.0' },
    ],
    cop: 4.95, eer: 2.75, electricalInputHeatingKw: 2.44, electricalInputCoolingKw: 4.22,
    maxWaterTempC: 65, minWaterTempCoolingC: 5, outdoorMinC: -25, outdoorMaxC: 43, refrigerant: 'R32', power: '220–240 В / 1 ф / 50 Гц (наружный блок)',
    connection: 'вода R1" (вход/выход), хладагент: газ Ø15,9 / жидкость Ø9,52 мм',
    dimensions: [{ label: 'внутренний блок (Ш×В×Г)', hMm: 790, wMm: 420, dMm: 270 }, { label: 'наружный блок (Ш×В×Г)', hMm: 865, wMm: 1118, dMm: 523 }],
    integratedPump: true, minFlowM3h: 0.7, minWaterVolumeL: 40, modulationMinPct: null, weightKg: null,
    set: {
      officialName: 'SET SPRINT 12 KW M BH', odu: 'HP EXTERNAL UNIT R32/012 (20198974)', idu: 'HP INTERNAL UNIT SPRINT WH, 20198967', complete: true, withBackupHeater: true,
      notes: ['Комплект «наружный + внутренний блок» продаётся одним артикулом — отдельные блоки не добавляются.', 'Вариант W/O BH (без электронагревателя) имеет другой артикул: SET SPRINT 12 KW M — 20205766; в каталоге OhmX его нет.', 'Мощность электронагревателя: по руководству 3 кВт для 220–240 В и 9 кВт для 3N 380–415 В; для кода 20198967 прямо не указана.'],
    },
    pumpMaxHeadM: 9.5, flowRangeM3h: [0.7, 3.0], flowSwitchOpenM3h: 0.6, internalWaterL: 5, expansionVesselL: 8,
    clearancesMm: 'наружный блок: A ≥ 3000 перед, B1 ≥ 2000, B2 ≥ 150 сзади/сбоку (в ряд ≥ 300), C ≥ 600 (руководство ODU, п. 7.4)',
    refrigerantLines: 'до 30 м, перепад до 20 м; доп. заправка 38 г/м (руководство ODU, 15.1)',
    weightsKg: 'внутренний блок ≈ 45 кг (с нагревателем 3 кВт, 12/16 кВт), наружный 97 кг (1 ф.)',
    profileState: 'COMPLETE', evidence: ['OHMX-ENG-HP', 'RIELLO-SPRINT-IOM', 'OHMX-CATALOG'],
    notes: [
      'Остаточный напор встроенного насоса при расходе в руководстве не приведён (только макс. напор 9,5 м, 5–90 Вт, DC inverter).',
      'Минимальный объём воды 40 л без внутреннего объёма блока (5 л) — должен сохраняться при закрытых клапанах всех зон.',
      'Реле протока: размыкается ниже 0,6 м³/ч, замыкается при 0,66 м³/ч.',
    ],
  },
  {
    sku: '20205776',
    name: 'Riello Family Sprint 016M R32 (SET SPRINT 16 KW M BH)',
    family: 'Family Sprint (сплит: наружный блок + внутренний гидромодуль)',
    heating: [
      { kw: 16.0, condition: 'наруж. +7 °C / вода 30→35 °C (EN 14511)' },
      { kw: 16.0, condition: 'наруж. +7 °C / вода 40→45 °C (EN 14511), COP 3.6' },
      { kw: 16.0, condition: 'наруж. +7 °C / вода 47→55 °C (EN 14511), COP 2.9' },
    ],
    cooling: [
      { kw: 14.0, condition: 'наруж. +35 °C / вода 12→7 °C (EN 14511)' },
      { kw: 14.2, condition: 'наруж. +35 °C / вода 23→18 °C (EN 14511), EER 3.61' },
    ],
    cop: 4.5, eer: 2.45, electricalInputHeatingKw: 3.56, electricalInputCoolingKw: 5.71,
    maxWaterTempC: 65, minWaterTempCoolingC: 5, outdoorMinC: -25, outdoorMaxC: 43, refrigerant: 'R32', power: '220–240 В / 1 ф / 50 Гц (наружный блок)',
    connection: 'вода R1" (вход/выход), хладагент: газ Ø15,9 / жидкость Ø9,52 мм',
    dimensions: [{ label: 'внутренний блок (Ш×В×Г)', hMm: 790, wMm: 420, dMm: 270 }, { label: 'наружный блок (Ш×В×Г)', hMm: 865, wMm: 1118, dMm: 523 }],
    integratedPump: true, minFlowM3h: 0.7, minWaterVolumeL: 40, modulationMinPct: null, weightKg: null,
    set: {
      officialName: 'SET SPRINT 16 KW M BH', odu: 'HP EXTERNAL UNIT R32/016 (20198976)', idu: 'HP INTERNAL UNIT SPRINT WH, 20198967', complete: true, withBackupHeater: true,
      notes: ['Комплект «наружный + внутренний блок» продаётся одним артикулом — отдельные блоки не добавляются.', 'Вариант W/O BH (без электронагревателя) имеет другой артикул: SET SPRINT 16 KW M — 20205773; в каталоге OhmX его нет.', 'Мощность электронагревателя: по руководству 3 кВт для 220–240 В и 9 кВт для 3N 380–415 В; для кода 20198967 прямо не указана.'],
    },
    pumpMaxHeadM: 9.5, flowRangeM3h: [0.7, 3.0], flowSwitchOpenM3h: 0.6, internalWaterL: 5, expansionVesselL: 8,
    clearancesMm: 'наружный блок: A ≥ 3000 перед, B1 ≥ 2000, B2 ≥ 150 сзади/сбоку (в ряд ≥ 300), C ≥ 600 (руководство ODU, п. 7.4)',
    refrigerantLines: 'до 30 м, перепад до 20 м; доп. заправка 38 г/м (руководство ODU, 15.1)',
    weightsKg: 'внутренний блок ≈ 45 кг (с нагревателем 3 кВт, 12/16 кВт), наружный 97 кг (1 ф.)',
    profileState: 'COMPLETE', evidence: ['OHMX-ENG-HP', 'RIELLO-SPRINT-IOM', 'OHMX-CATALOG'],
    notes: [
      'Остаточный напор встроенного насоса при расходе в руководстве не приведён (только макс. напор 9,5 м, 5–90 Вт, DC inverter).',
      'Минимальный объём воды 40 л без внутреннего объёма блока (5 л) — должен сохраняться при закрытых клапанах всех зон.',
      'Реле протока: размыкается ниже 0,6 м³/ч, замыкается при 0,66 м³/ч.',
    ],
  },
  {
    sku: '20203649',
    name: 'Riello NXHM 12 кВт (моноблок воздух–вода)',
    family: 'NXHM (моноблок)',
    heating: [{ kw: 12.1, condition: 'наруж. +7 °C / вода 35 °C' }, { kw: 12.3, condition: 'наруж. +7 °C / вода 45 °C' }],
    cooling: [{ kw: 11.5, condition: 'наруж. +35 °C / вода 12→7 °C' }, { kw: 12.0, condition: 'наруж. +35 °C / вода 23→18 °C' }],
    cop: 4.95, eer: 2.75, electricalInputHeatingKw: null, electricalInputCoolingKw: null,
    maxWaterTempC: null, minWaterTempCoolingC: null, outdoorMinC: null, outdoorMaxC: null, refrigerant: null, power: '230 В / 50 Гц', connection: null,
    dimensions: [{ label: 'моноблок (В×Ш×Г по карточке каталога)', hMm: 945, wMm: 1385, dMm: 526 }],
    integratedPump: true, minFlowM3h: null, minWaterVolumeL: null, modulationMinPct: null, weightKg: null,
    profileState: 'BLOCKED', evidence: ['OHMX-CATALOG'],
    notes: ['Первичный насос встроен — по тексту карточки; напор и расход не указаны.', 'Инженерный профиль в каталоге не подтверждён (BLOCKED, legacy-import).'],
  },
];

export interface HeatPumpRequirement {
  /** kW. null = unknown. */
  heatingKw: number | null;
  coolingKw: number | null;
  /** 'override' = engineer typed design loads; 'building_load' = calculated; 'connected_terminals' = sum of selected terminals. */
  basis: 'override' | 'building_load' | 'connected_terminals' | 'unknown';
  /** Highest supply-water temperature required by terminals (e.g. 70 for radiators), °C. */
  requiredSupplyC: number | null;
  needsCooling: boolean;
}

export type HeatPumpVerdict = 'suitable_preliminary' | 'insufficient' | 'incompatible';

export interface HeatPumpAssessment {
  sku: string;
  fact: HeatPumpFact;
  verdict: HeatPumpVerdict;
  heatingKw: number;
  coolingKw: number;
  reasons: string[];
  /** What must still be confirmed before the choice can be called verified. */
  unresolved: string[];
  inStock: boolean | null;
  priceAmd: number | null;
}

export function describeHeatPump(f: HeatPumpFact): string[] {
  const out: string[] = [];
  out.push(`Производитель: Riello · ${f.family}`);
  if (f.set) {
    out.push(`Состав: ${f.set.officialName} — ${f.set.complete ? 'полный комплект' : 'не полный комплект'}: ${f.set.odu} + ${f.set.idu}`);
    for (const n of f.set.notes) out.push(n);
  }
  out.push(`Нагрев: ${f.heating.map((h) => `${h.kw} кВт (${h.condition})`).join('; ')}${f.cop != null ? `; COP ${f.cop} (A7/W35)` : ''}`);
  out.push(`Охлаждение: ${f.cooling.map((c) => `${c.kw} кВт (${c.condition})`).join('; ')}${f.eer != null ? `; EER ${f.eer} (A35/W7)` : ''}`);
  if (f.electricalInputHeatingKw != null || f.electricalInputCoolingKw != null) {
    out.push(`Потребляемая мощность: нагрев ${f.electricalInputHeatingKw ?? '—'} кВт, охлаждение ${f.electricalInputCoolingKw ?? '—'} кВт`);
  }
  out.push(`Температура воды: ${f.maxWaterTempC != null ? `нагрев до ${f.maxWaterTempC} °C` : 'не подтверждено'}${f.minWaterTempCoolingC != null ? `, охлаждение от ${f.minWaterTempCoolingC} °C` : ''}; наружный воздух: ${f.outdoorMinC != null && f.outdoorMaxC != null ? `${f.outdoorMinC}…+${f.outdoorMaxC} °C` : 'не подтверждено'}; хладагент: ${f.refrigerant ?? 'не подтверждено'}`);
  out.push(`Гидравлическое подключение и хладагентные линии: ${f.connection ?? 'не подтверждено'}; питание: ${f.power ?? 'не подтверждено'}`);
  out.push(`Габариты: ${f.dimensions.map((d) => `${d.label} ${d.wMm}×${d.hMm}×${d.dMm} мм`.replace('Ш×В×Г) ', 'Ш×В×Г) ')).join('; ')}; вес: ${f.weightsKg ?? (f.weightKg != null ? `${f.weightKg} кг` : 'не подтверждено')}`);
  out.push(`Встроенный насос: ${f.integratedPump == null ? 'не подтверждено' : f.integratedPump ? `да${f.pumpMaxHeadM != null ? `, макс. напор ${f.pumpMaxHeadM} м` : ''} (остаточный напор при расходе не опубликован)` : 'нет'}; расход воды: ${f.flowRangeM3h ? `${f.flowRangeM3h[0]}–${f.flowRangeM3h[1]} м³/ч` : 'не подтверждено'}${f.flowSwitchOpenM3h != null ? `, реле протока < ${f.flowSwitchOpenM3h} м³/ч` : ''}`);
  out.push(`Мин. объём воды в контуре: ${f.minWaterVolumeL != null ? `${f.minWaterVolumeL} л (без внутренних ${f.internalWaterL ?? '—'} л), сохраняется при закрытых клапанах` : 'не подтверждено'}; расширительный бак в блоке: ${f.expansionVesselL != null ? `${f.expansionVesselL} л` : 'не подтверждено'}`);
  out.push(`Минимальная модуляция мощности: ${f.modulationMinPct != null ? `${f.modulationMinPct} %` : 'не подтверждено (в руководстве не опубликована)'}`);
  out.push(`Монтажные зазоры и трасса: ${f.clearancesMm ?? 'не подтверждены'}${f.refrigerantLines ? `; ${f.refrigerantLines}` : ''}`);
  return out;
}

const HEATING_RATING_PRIORITY = 0; // first listed heating rating is the standard A7/W35 EN 14511 point

export function nominalFlowM3h(kw: number, deltaT = 5): number {
  return Math.round((0.86 * kw / deltaT) * 100) / 100;
}

export function assessHeatPump(
  fact: HeatPumpFact,
  req: HeatPumpRequirement,
  stock: { inStock: boolean | null; priceAmd: number | null },
): HeatPumpAssessment {
  const heatingKw = fact.heating[HEATING_RATING_PRIORITY].kw;
  const coolingKw = fact.cooling[0]?.kw ?? 0;
  const reasons: string[] = [];
  const unresolved: string[] = [];
  let verdict: HeatPumpVerdict = 'suitable_preliminary';

  if (req.requiredSupplyC != null && fact.maxWaterTempC != null && fact.maxWaterTempC < req.requiredSupplyC) {
    verdict = 'incompatible';
    reasons.push(`Максимальная температура воды ${fact.maxWaterTempC} °C ниже требуемой ${req.requiredSupplyC} °C.`);
  }
  if (req.needsCooling && coolingKw <= 0) {
    verdict = 'incompatible';
    reasons.push('Нет данных об охлаждении, а система требует охлаждения.');
  }
  if (verdict !== 'incompatible') {
    if (req.heatingKw != null && heatingKw < req.heatingKw) {
      verdict = 'insufficient';
      reasons.push(`Нагрев ${heatingKw} кВт меньше требуемых ${req.heatingKw.toFixed(2)} кВт.`);
    }
    if (req.needsCooling && req.coolingKw != null && coolingKw < req.coolingKw) {
      verdict = 'insufficient';
      reasons.push(`Охлаждение ${coolingKw} кВт меньше требуемых ${req.coolingKw.toFixed(2)} кВт.`);
    }
  }
  if (verdict === 'suitable_preliminary') {
    reasons.push(`Номинальные мощности (${heatingKw} кВт нагрев / ${coolingKw} кВт охлаждение) покрывают ${req.basis === 'connected_terminals' ? 'сумму подключённых приборов' : 'заданную нагрузку'}.`);
  }
  if (req.basis !== 'override' && req.basis !== 'building_load') unresolved.push('Расчётная нагрузка здания не определена — подбор по мощности приборов не является расчётом здания.');
  unresolved.push('Мощность при расчётной наружной температуре и требуемой температуре воды не подтверждена таблицами производителя.');
  if (fact.minFlowM3h == null) unresolved.push('Минимальный расход воды не подтверждён.');
  if (fact.minWaterVolumeL == null) unresolved.push('Минимальный объём воды в контуре не подтверждён.');
  if (fact.modulationMinPct == null) unresolved.push('Минимальная модуляция не опубликована в руководстве — риск частых пусков не оценён.');
  if (fact.integratedPump == null) unresolved.push('Наличие и напор встроенного насоса не подтверждены.');
  else if (fact.integratedPump) unresolved.push('Остаточный напор встроенного насоса при расчётном расходе не опубликован (нужна кривая из технического листа).');
  if (fact.profileState !== 'COMPLETE') unresolved.push('Инженерный профиль в каталоге не подтверждён.');
  return { sku: fact.sku, fact, verdict, heatingKw, coolingKw, reasons, unresolved, inStock: stock.inStock, priceAmd: stock.priceAmd };
}

/**
 * Preference: suitable first; then on stock (sale now); then the smallest rating that still covers the need
 * (cooling-led systems compare cooling and heating); deterministic SKU tie-break.
 * When nothing is suitable the nearest candidate is returned flagged `insufficient` (never claimed as suitable).
 */
export function rankHeatPumps(list: HeatPumpAssessment[]): HeatPumpAssessment[] {
  const rank = (v: HeatPumpVerdict) => (v === 'suitable_preliminary' ? 0 : v === 'insufficient' ? 1 : 2);
  return [...list].sort((a, b) => rank(a.verdict) - rank(b.verdict)
    || Number(b.inStock === true) - Number(a.inStock === true)
    // a unit with an approved engineering profile beats one whose profile is still pending
    || Number(b.fact.profileState === 'COMPLETE') - Number(a.fact.profileState === 'COMPLETE')
    || (a.verdict === 'suitable_preliminary' ? a.heatingKw - b.heatingKw : b.heatingKw - a.heatingKw)
    || a.sku.localeCompare(b.sku));
}

// ---------------------------------------------------------------------------
// Hydraulic topology
// ---------------------------------------------------------------------------

export type TopologyConfig = 'A' | 'B' | 'C' | 'D' | 'E';
export type NeedLevel = 'required' | 'recommended' | 'not_required' | 'unknown';

export interface TopologyInput {
  heatPump: HeatPumpFact | null;
  /** Design heating power carried by the primary circuit, kW (null = unknown). */
  primaryKw: number | null;
  groups: Array<{
    id: string; kind: 'ufh' | 'fan_coil' | 'radiator' | string; flowM3h: number; hasZoneValves: boolean;
    /** Own pump already inside the group (e.g. Danfoss FHM mixing unit). */
    hasOwnPump: boolean; waterVolumeL: number; supplyC: number;
    /** Required head of the group's critical path, m (null = unknown). */
    requiredHeadM: number | null;
    /** A separate circulator has to be added for this group (the group has no own pump). */
    needsAddedPump: boolean;
  }>;
  /** Engineer override: minimum system water content, L per kW (used only when the manufacturer value is unknown). */
  minWaterLPerKw: number | null;
  assumedMinWaterLPerKw: number;
  bypassProvided: boolean;
  /** Volume of a buffer tank already in the design, L. */
  bufferVolumeL?: number;
}

export interface TopologyDecision { level: NeedLevel; reason: string }

export interface TopologyResult {
  config: TopologyConfig;
  label: string;
  /** decoupling by a hydraulic separator (or buffer used as separator) */
  separator: TopologyDecision;
  /** flow path that keeps the heat pump's minimum flow when every zone valve closes */
  bypass: TopologyDecision;
  /** system water volume that stays connected when zones close */
  buffer: TopologyDecision;
  needsSeparator: boolean;
  needsBuffer: boolean;
  primaryFlowM3h: number | null;
  secondaryFlowM3h: number;
  minWaterVolumeL: number | null;
  volumeBasis: 'manufacturer' | 'override' | 'assumption' | 'unknown';
  availableVolumeWithZonesClosedL: number;
  zoneValvesCanClose: boolean;
  flowWithinHeatPumpRange: 'yes' | 'no' | 'unknown';
  headCheck: 'covered_unverified' | 'exceeds_pump' | 'unknown';
  defrostNote: string;
  rationale: string[];
  unresolved: string[];
}

const LABEL: Record<TopologyConfig, string> = {
  A: 'A — прямое подключение к тепловому насосу (насос блока обслуживает контуры)',
  B: 'B — гидравлический разделитель и вторичное насосное питание',
  C: 'C — прямое подключение + буферная ёмкость / сохранение объёма',
  D: 'D — буфер, совмещённый с разделителем',
  E: 'E — раздельные первичный и вторичные контуры через разделитель',
};

/**
 * Evaluates four independent questions — they are NOT interchangeable:
 *   separator  — hydraulic decoupling of primary/secondary flows and pumps;
 *   bypass     — keeps minimum FLOW when all zone valves close (adds no volume, no defrost energy);
 *   buffer     — adds water VOLUME (minimum content, defrost reserve) that is available with zones closed;
 *   pump duty  — whether the integrated circulator may serve the secondary circuits.
 * A separator is never added merely because several circulators exist.
 */
export function assessTopology(input: TopologyInput): TopologyResult {
  const { heatPump, groups } = input;
  const secondary = Math.round(groups.reduce((s, g) => s + g.flowM3h, 0) * 100) / 100;
  const primary = input.primaryKw != null ? nominalFlowM3h(input.primaryKw, 5) : null;
  const zoneValvesCanClose = groups.length > 0 && groups.every((g) => g.hasZoneValves);
  const rationale: string[] = [];
  const unresolved: string[] = [];
  const range = heatPump?.flowRangeM3h ?? null;

  // --- flow window of the heat pump -------------------------------------------------
  const flowWithinHeatPumpRange: TopologyResult['flowWithinHeatPumpRange'] = !range || secondary <= 0 ? 'unknown' : secondary >= range[0] && secondary <= range[1] ? 'yes' : 'no';
  if (range) rationale.push(`Диапазон расхода воды блока ${range[0]}–${range[1]} м³/ч; расчётный расход потребителей ${secondary} м³/ч — ${flowWithinHeatPumpRange === 'yes' ? 'в диапазоне' : flowWithinHeatPumpRange === 'no' ? 'ВНЕ диапазона' : 'не определён'}.`);

  // --- integrated pump vs required head ---------------------------------------------
  const heads = groups.map((g) => g.requiredHeadM).filter((h): h is number => h != null);
  const maxHead = heads.length ? Math.max(...heads) : null;
  let headCheck: TopologyResult['headCheck'] = 'unknown';
  if (heatPump?.integratedPump && heatPump.pumpMaxHeadM != null && maxHead != null) {
    headCheck = maxHead > heatPump.pumpMaxHeadM ? 'exceeds_pump' : 'covered_unverified';
    rationale.push(headCheck === 'exceeds_pump'
      ? `Требуемый напор ${maxHead.toFixed(1)} м превышает максимальный напор встроенного насоса ${heatPump.pumpMaxHeadM} м — нужен дополнительный насос.`
      : `Требуемый напор ${maxHead.toFixed(1)} м не превышает максимальный напор встроенного насоса ${heatPump.pumpMaxHeadM} м; остаточный напор при расходе не опубликован — нужна кривая.`);
  }
  if (heatPump?.integratedPump) unresolved.push('Остаточный напор встроенного насоса при расчётном расходе (кривая Q–H) не опубликован в руководстве.');

  // --- separator: only when decoupling is actually needed ---------------------------
  let separator: TopologyDecision;
  const addedPumpGroups = groups.filter((g) => g.needsAddedPump);
  if (flowWithinHeatPumpRange === 'no' && range && secondary > range[1]) {
    separator = { level: 'required', reason: `Расход потребителей ${secondary} м³/ч больше максимального расхода блока ${range[1]} м³/ч — первичный и вторичный расходы нужно разделить.` };
  } else if (groups.length > 1 && (headCheck === 'exceeds_pump' || addedPumpGroups.length)) {
    separator = { level: 'recommended', reason: `${addedPumpGroups.length ? 'Один из нескольких контуров с отдельным насосом' : 'Напор выше возможностей встроенного насоса'} — развязка предотвращает взаимное влияние насосов; подтверждается схемой производителя.` };
  } else if (groups.length) {
    if (addedPumpGroups.length) unresolved.push('Добавленный насос работает последовательно со встроенным насосом блока — проверить совместную работу по схеме производителя.');
    separator = { level: 'not_required', reason: 'Встроенный насос обслуживает контуры напрямую; насосы смесительных узлов работают как вторичные без отдельной развязки.' };
  } else {
    separator = { level: 'unknown', reason: 'Контуры не определены.' };
  }

  // --- minimum flow / bypass -----------------------------------------------------------
  let bypass: TopologyDecision;
  const minFlow = heatPump?.minFlowM3h ?? null;
  if (!zoneValvesCanClose) {
    bypass = { level: 'not_required', reason: 'Есть контур без зонного клапана — путь для расхода сохраняется.' };
  } else if (input.bypassProvided) {
    bypass = { level: 'not_required', reason: 'Перепускной клапан предусмотрен инженером.' };
  } else {
    bypass = { level: minFlow != null ? 'required' : 'recommended', reason: `Все зоны могут закрыться одновременно; реле протока блока размыкается ниже ${heatPump?.flowSwitchOpenM3h ?? '—'} м³/ч. Нужен перепуск (байпас), сохраняющий минимальный расход ${minFlow ?? '—'} м³/ч. Байпас не добавляет объём воды.` };
  }

  // --- volume / buffer ---------------------------------------------------------------
  const minVolume = heatPump?.minWaterVolumeL != null
    ? { l: heatPump.minWaterVolumeL, basis: 'manufacturer' as const }
    : input.primaryKw == null ? { l: null, basis: 'unknown' as const }
      : input.minWaterLPerKw != null ? { l: Math.ceil(input.primaryKw * input.minWaterLPerKw), basis: 'override' as const }
        : { l: Math.ceil(input.primaryKw * input.assumedMinWaterLPerKw), basis: 'assumption' as const };
  const nonValved = groups.filter((g) => !g.hasZoneValves).reduce((s, g) => s + g.waterVolumeL, 0);
  const availableClosed = Math.round(nonValved + (input.bufferVolumeL ?? 0));
  let buffer: TopologyDecision;
  if (minVolume.l == null) {
    buffer = { level: 'unknown', reason: 'Минимальный объём воды не определён.' };
  } else if (availableClosed >= minVolume.l) {
    buffer = { level: 'not_required', reason: `При закрытых зонах остаётся ≈ ${availableClosed} л ≥ ${minVolume.l} л.` };
  } else if (!zoneValvesCanClose) {
    buffer = { level: 'recommended', reason: `Объём воды контуров без клапанов ≈ ${availableClosed} л < ${minVolume.l} л — уточнить фактический объём труб.` };
  } else {
    buffer = {
      level: minVolume.basis === 'manufacturer' ? 'required' : 'recommended',
      reason: `Минимальный объём воды ${minVolume.l} л (${minVolume.basis === 'manufacturer' ? 'руководство производителя, без внутренних ' + (heatPump?.internalWaterL ?? '—') + ' л блока' : minVolume.basis === 'override' ? 'задан инженером' : 'допущение'}) должен сохраняться при закрытых клапанах; доступно ≈ ${availableClosed} л. Объём даёт буферная ёмкость или трубы контура без клапанов (байпас объём не добавляет).`,
    };
  }
  if (minVolume.basis === 'assumption') unresolved.push(`Минимальный объём воды принят как допущение ${input.assumedMinWaterLPerKw} л/кВт — данные производителя не получены.`);
  if (minVolume.basis === 'unknown') unresolved.push('Минимальный объём воды не определён.');
  if (minFlow == null) unresolved.push('Минимальный расход теплового насоса не подтверждён производителем.');
  const defrostNote = heatPump?.minWaterVolumeL != null
    ? 'Оттайка наружного блока автоматическая (≈ 2–10 мин, руководство ODU п. 14.7); отдельный объём/энергия под оттайку производителем не нормируются — действует минимальный объём воды.'
    : 'Требования к объёму воды на оттайку не подтверждены.';

  if (flowWithinHeatPumpRange === 'unknown' && range) unresolved.push('Расчётный расход потребителей не определён — диапазон расхода не проверен.');
  if (groups.some((g) => g.hasOwnPump && g.kind === 'ufh')) rationale.push('Контур тёплого пола обслуживается насосом смесительного узла: добавлять второй насос не нужно.');
  rationale.push(`Разделитель: ${separator.level === 'required' ? 'ТРЕБУЕТСЯ' : separator.level === 'recommended' ? 'рекомендуется' : separator.level === 'not_required' ? 'не требуется' : 'не определено'} — ${separator.reason}`);
  rationale.push(`Байпас (расход): ${bypass.level === 'required' ? 'ТРЕБУЕТСЯ' : bypass.level === 'recommended' ? 'рекомендуется' : bypass.level === 'not_required' ? 'не требуется' : 'не определено'} — ${bypass.reason}`);
  rationale.push(`Буфер (объём): ${buffer.level === 'required' ? 'ТРЕБУЕТСЯ' : buffer.level === 'recommended' ? 'рекомендуется' : buffer.level === 'not_required' ? 'не требуется' : 'не определено'} — ${buffer.reason}`);

  const needSep = separator.level === 'required';
  const needBuf = buffer.level === 'required' || buffer.level === 'recommended';
  let config: TopologyConfig = 'A';
  if (needSep && needBuf) config = 'D';
  else if (needSep || separator.level === 'recommended') config = groups.length > 1 ? 'E' : 'B';
  else if (needBuf) config = 'C';
  return {
    config, label: LABEL[config], separator, bypass, buffer,
    needsSeparator: needSep, needsBuffer: needBuf,
    primaryFlowM3h: primary, secondaryFlowM3h: secondary, minWaterVolumeL: minVolume.l, volumeBasis: minVolume.basis,
    availableVolumeWithZonesClosedL: availableClosed, zoneValvesCanClose, flowWithinHeatPumpRange, headCheck, defrostNote,
    rationale, unresolved,
  };
}
