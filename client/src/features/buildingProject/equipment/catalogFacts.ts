/**
 * Engineering facts for OhmX catalog SKUs used by the BOM engine.
 *
 * This is NOT a product database: it never holds prices, availability or
 * products that are not in the OhmX catalog. Codes, names, prices and units
 * are always read live from the catalog API; a SKU missing there turns the
 * BOM line into a "missing in catalog" line.
 *
 * Every fact cites evidence. Compatibility is selectable only when the
 * evidence is an official manufacturer document listing both codes
 * (EXACT_CODE) or official documents whose interface parameters match
 * (PARAMETER_MATCH). Catalog-record values (CATALOG_RECORD) may be used for
 * preliminary sizing only and always keep the result preliminary.
 */

export type EvidenceLevel = 'EXACT_CODE' | 'PARAMETER_MATCH' | 'CATALOG_RECORD';

export interface EvidenceDoc {
  id: string;
  title: string;
  url: string;
  sha256: string | null;
  statement: string;
}

export const EVIDENCE: Record<string, EvidenceDoc> = {
  'DAN-FHF-2020': {
    id: 'DAN-FHF-2020',
    title: 'Danfoss Data Sheet FHF Floor Heating Manifold, 2020.03, AI010286478228en-000601',
    url: 'https://res.cloudinary.com/evoleska/image/upload/v1703169442/tzgjdpsllhz9jcjavwwt.pdf',
    sha256: 'dfb12f1e22866e1e5bb3ac9c42f7918f8bdec0aa4574d2075c51059b1db417ca',
    statement: 'Ordering p.2–3: FHF-2…12 088U0502…0512; FHF-EA 088U0785, FHF-EM 088U0786, FHF-E 088U0582, FHF-C 088U0583, FHF-MB 088U0585, FHF-BV 088U0822 (2 × ball valve 1"); TWA-A 088H3110 (24 V NC) / 088H3112 (230 V NC) "Danfoss RA connection to valve"; compression fittings G ¾" for ALUPEX/PERT-AL-PERT 16×2 013G4186 (6 bar, 95 °C).',
  },
  'DAN-FHF-STORE-088U0504': {
    id: 'DAN-FHF-STORE-088U0504',
    title: 'Danfoss store page 088U0504 (accessed 2026-10-13)',
    url: 'https://store.danfoss.com/en/p/088U0504',
    sha256: null,
    statement: 'Manifold FHF 4+4: valve connection Danfoss RA; flow temperature max 90 °C; working pressure 10 bar; max Δp 0.6 bar; presetting yes; flowmeter no; bleed valve not included.',
  },
  'DAN-SSM-STORE-088U0754': {
    id: 'DAN-SSM-STORE-088U0754',
    title: 'Danfoss store page 088U0754 (accessed 2026-10-13)',
    url: 'https://store.danfoss.com/en/p/088U0754',
    sha256: null,
    statement: 'Manifold SSM-F 4+4 with flowmeter: valve connection Danfoss RA; flow temperature max 60 °C; working pressure 6 bar; max Δp 0.6 bar; manual bleed valve.',
  },
  'DAN-TWA-2025': {
    id: 'DAN-TWA-2025',
    title: 'Danfoss Data Sheet TWA Thermal Wax Actuator, 2025.09, AI187386475671en-011202',
    url: 'https://assets.danfoss.com/documents/527077/AI187386475671en-011202.pdf',
    sha256: 'dd3eb70568cc5faff8660b3472f85f20815e07a176308c37fbab389e6809454a',
    statement: 'p.1: TWA-A connection type RA: 088H3110 24 V NC, 088H3111 24 V NO, 088H3112 230 V NC, 088H3113 230 V NO. p.2: power 2 W, closing force 110 N, travel ≈3 min, on/off & PWM; combination table: SSM (M) kvs 0.10–1.10, max Δp 0.6 bar → TWA-A.',
  },
  'DAN-ICON24-2020': {
    id: 'DAN-ICON24-2020',
    title: 'Danfoss Data Sheet Icon 24V Master Controller, 2020.03, AI289334683789en-000102',
    url: 'https://assets.danfoss.com/documents/latest/43387/AI289334683789en-010102.pdf',
    sha256: 'c5c6d5bd25b782c743416ca277352645b05b91be69b9368cd08711973cd2e5f6',
    statement: '088U1071 (10 ch) / 088U1072 (15 ch); actuator outputs 24 V DC, max 2 W per output, 1 actuator per output terminal; NC/NO actuators; cooling change-over requires Expansion Module 088U1100; 230 V output for circulation pump.',
  },
  'DAN-ICON230-DISPLAY-2016': {
    id: 'DAN-ICON230-DISPLAY-2016',
    title: 'Danfoss Data Sheet Icon Display Room Thermostat 230 V, 2016.06, AI189586480083en-GB0201',
    url: 'https://assets.danfoss.com/documents/83216/AI189586480083en-GB0201.pdf',
    sha256: '62070fc386bd271dc8d24225b5a23af5098072735065461cab8d7b2421dbd076',
    statement: 'p.1: 088U1010 in-wall 80×80 Euro, 088U1011, 088U1012, 088U1015 on-wall; mains powered, stand-alone or with FH-WC; triac output, up to 5 thermal actuators; 230 V NC or NO actuators; heating icon only (no cooling mode stated). p.2: max continuous load < 50 mA / 10 W (= 5 pcs. Danfoss TWA actuators); max inrush 3 A ≤ 100 ms; supply 220–240 V 50/60 Hz; PWM control; 3G1.5 cable to thermostat without wiring center.',
  },
  'DAN-ICON230-DIAL-2021': {
    id: 'DAN-ICON230-DIAL-2021',
    title: 'Danfoss Data Sheet Icon Dial Room Thermostats 230 V, 2021.07, AI155586480022en-GB0301',
    url: 'https://assets.danfoss.com/documents/187304/AI155586480022en-GB0301.pdf',
    sha256: '89972cd89eba1e072a16a47685105920592007aa5eafd263071190991201528a',
    statement: '088U1001 in-wall 86×86, 088U1005 on-wall; relay output, up to 5 thermal actuators, 230 V NC or NO; max continuous load < 50 mA / 10 W (= 5 pcs. TWA); inrush 3 A ≤ 100 ms; On/Off with thermal accelerator; temperature range 5–30 °C. Code 088U1000 is NOT listed.',
  },
  'DAN-FHMC-2025': {
    id: 'DAN-FHMC-2025',
    title: 'Danfoss FHM-C1/C2 mixing shunt data sheet (web summary, AI303556008317en; file hash not recorded)',
    url: 'https://assets.danfoss.com/documents/461554/AI303556008317en-010302.pdf',
    sha256: null,
    statement: 'FHM-C1 ≈7 kW at 5 K / ≈15 kW at 10 K secondary ΔT with Grundfos UPM3 Auto 15-70; mounts directly on the Danfoss manifold, left or right; built-in check valve.',
  },
  'OHMX-CATALOG': {
    id: 'OHMX-CATALOG',
    title: 'OhmX catalog record (product features / description), read-only copy 2026-10-13',
    url: '',
    sha256: null,
    statement: 'Values stated in the OhmX product card. Not cross-checked with a manufacturer curve.',
  },
  'OHMX-ENG-FC': {
    id: 'OHMX-ENG-FC',
    title: 'OhmX engineering_value FAN_COIL profiles (approved RT4.1/RT4.2 data), snapshot',
    url: '',
    sha256: null,
    statement: 'Fan-coil water flow / pressure drop / connection at the rated operating point (7/12 °C, 70/60 °C).',
  },
};

// ---------------------------------------------------------------------------
// Manifolds
// ---------------------------------------------------------------------------

export interface ManifoldFact {
  sku: string;
  family: 'FHF' | 'SSM-F';
  outlets: number;
  maxFlowTempC: number;
  maxDpBar: number;
  valveConnection: 'RA';
  flowmeter: boolean;
  /** Kvs of the outlet valve insert when documented (SSM via TWA table). */
  kvsMax: number | null;
  evidence: string[];
}

const fhf = (n: number, sku: string): ManifoldFact => ({
  sku, family: 'FHF', outlets: n, maxFlowTempC: 90, maxDpBar: 0.6, valveConnection: 'RA', flowmeter: false, kvsMax: null,
  evidence: ['DAN-FHF-2020', 'DAN-FHF-STORE-088U0504'],
});
const ssm = (n: number, sku: string): ManifoldFact => ({
  sku, family: 'SSM-F', outlets: n, maxFlowTempC: 60, maxDpBar: 0.6, valveConnection: 'RA', flowmeter: true, kvsMax: 1.1,
  evidence: ['DAN-SSM-STORE-088U0754', 'DAN-TWA-2025'],
});

export const MANIFOLDS: ManifoldFact[] = [
  fhf(2, '088U0502'), fhf(3, '088U0503'), fhf(4, '088U0504'), fhf(5, '088U0505'), fhf(6, '088U0506'), fhf(7, '088U0507'),
  fhf(8, '088U0508'), fhf(9, '088U0509'), fhf(10, '088U0510'), fhf(11, '088U0511'), fhf(12, '088U0512'),
  ssm(2, '088U0752'), ssm(3, '088U0753'), ssm(4, '088U0754'), ssm(5, '088U0755'), ssm(6, '088U0756'), ssm(7, '088U0757'),
  ssm(8, '088U0758'), ssm(9, '088U0759'), ssm(10, '088U0760'), ssm(11, '088U0761'), ssm(12, '088U0762'),
];

export const MAX_MANIFOLD_OUTLETS = 12;

/** FHF accessories, exact codes from the FHF data sheet. */
export const FHF_ACCESSORIES = {
  ballValves: { sku: '088U0822', name: 'Шаровые краны FHF-BV 1" для коллектора (2 шт. в комплекте)' },
  autoAirVent: { sku: '088U0785', name: 'Концевая секция FHF-EA с автоматическим воздухоотводчиком и сливным краном' },
  brackets: { sku: '088U0585', name: 'Кронштейны FHF-MB для крепления коллектора (комплект)' },
  connectionPieces: { sku: '088U0583', name: 'Присоединительные штуцеры FHF-C (комплект)' },
  compressionFitting16: { sku: '013G4186', name: 'Компрессионный фитинг G ¾" для трубы PERT-AL-PERT / ALUPEX 16×2' },
} as const;

/** Floor-heating pipe compatible with 013G4186 (PERT-AL-PERT 16×2 per catalog name and data sheet note 2). */
export const UFH_PIPE = { sku: '28107000', name: 'Металлопластиковая труба для тёплого пола PERT-AL-PERT 16×2', innerDiameterM: 0.012 };

// ---------------------------------------------------------------------------
// Actuators and controls
// ---------------------------------------------------------------------------

export interface ActuatorFact {
  sku: string;
  model: 'TWA-A';
  voltage: 24 | 230;
  function: 'NC' | 'NO';
  connection: 'RA';
  powerW: number;
  closingForceN: number;
  evidence: string[];
}

export const ACTUATORS: ActuatorFact[] = [
  { sku: '088H3110', model: 'TWA-A', voltage: 24, function: 'NC', connection: 'RA', powerW: 2, closingForceN: 110, evidence: ['DAN-TWA-2025', 'DAN-FHF-2020'] },
  { sku: '088H3111', model: 'TWA-A', voltage: 24, function: 'NO', connection: 'RA', powerW: 2, closingForceN: 110, evidence: ['DAN-TWA-2025'] },
  { sku: '088H3112', model: 'TWA-A', voltage: 230, function: 'NC', connection: 'RA', powerW: 2, closingForceN: 110, evidence: ['DAN-TWA-2025', 'DAN-FHF-2020'] },
  { sku: '088H3113', model: 'TWA-A', voltage: 230, function: 'NO', connection: 'RA', powerW: 2, closingForceN: 110, evidence: ['DAN-TWA-2025'] },
];

export interface ControllerFact {
  sku: string;
  name: string;
  outputs: number;
  outputVoltage: 24;
  maxWPerOutput: number;
  actuatorsPerOutput: 1;
  evidence: string[];
}

export const ICON_MASTERS: ControllerFact[] = [
  { sku: '088U1071', name: 'Мастер-контроллер Danfoss Icon 24 В, 10 каналов', outputs: 10, outputVoltage: 24, maxWPerOutput: 2, actuatorsPerOutput: 1, evidence: ['DAN-ICON24-2020'] },
  { sku: '088U1072', name: 'Мастер-контроллер Danfoss Icon 24 В, 15 каналов', outputs: 15, outputVoltage: 24, maxWPerOutput: 2, actuatorsPerOutput: 1, evidence: ['DAN-ICON24-2020'] },
];
export const ICON_EXPANSION = { sku: '088U1100', name: 'Модуль расширения Danfoss Icon Expansion (переключение отопление/охлаждение)', evidence: ['DAN-ICON24-2020'] };

// ---------------------------------------------------------------------------
// Mixing units and pumps
// ---------------------------------------------------------------------------

export interface MixingUnitFact {
  sku: string;
  name: string;
  maxKwDt5: number;
  maxKwDt10: number;
  pump: string;
  evidence: string[];
}

export const MIXING_UNITS: MixingUnitFact[] = [
  { sku: '088U0093', name: 'Смесительный узел Danfoss FHM-C5 (насос UPS 15-40)', maxKwDt5: 4.5, maxKwDt10: 9, pump: 'Grundfos UPS 15-40', evidence: ['OHMX-CATALOG'] },
  { sku: '088U0096', name: 'Смесительный узел Danfoss FHM-C6 (насос UPS 15-60)', maxKwDt5: 7, maxKwDt10: 13, pump: 'Grundfos UPS 15-60', evidence: ['OHMX-CATALOG'] },
  { sku: '088U0094', name: 'Смесительный узел Danfoss FHM-C1 (насос UPM3 Auto 15-70)', maxKwDt5: 7, maxKwDt10: 15, pump: 'Grundfos UPM3 Auto 15-70', evidence: ['DAN-FHMC-2025', 'OHMX-CATALOG'] },
];

export interface PumpFact {
  sku: string;
  name: string;
  /** Max head (zero flow), m — catalog record. */
  hMaxM: number;
  /** Max flow (zero head), m³/h — catalog record. */
  qMaxM3h: number;
  evidence: string[];
  /** Selection priority: Riello first, DAB second, anything else only when nothing of those fits. */
  brand?: 'Riello' | 'DAB' | 'other';
  /** Nominal diameter / connection as written in the catalog name. */
  dn?: string;
  /** Face-to-face installation length from the catalog card, mm (not the overall size). */
  installLengthMm?: number;
}

/** Only circulators whose catalog record states both max head and max flow. A Q–H curve is NOT in the catalog. */
export const PUMPS: PumpFact[] = [
  { sku: 'CRS 25/4', name: 'Циркуляционный насос Sibio CRS 25/4', hMaxM: 4, qMaxM3h: 2.4, evidence: ['OHMX-CATALOG'], brand: 'other', installLengthMm: 180 },
  { sku: 'CRS 25/6', name: 'Циркуляционный насос Sibio CRS 25/6', hMaxM: 6, qMaxM3h: 2.4, evidence: ['OHMX-CATALOG'], brand: 'other', installLengthMm: 180 },
  { sku: '60182179H', name: 'Циркуляционный насос DAB VA 55/130', hMaxM: 5, qMaxM3h: 3, evidence: ['OHMX-CATALOG'], brand: 'DAB', dn: '1"1/2 G', installLengthMm: 130 },
  { sku: '60182169H', name: 'Циркуляционный насос DAB VA 65/130', hMaxM: 6, qMaxM3h: 3, evidence: ['OHMX-CATALOG'], brand: 'DAB', dn: '1"1/2 G', installLengthMm: 130 },
  // Riello VegA (catalog card: H, "Максимальный расход воды", length from the card title)
  { sku: '20061648', name: 'Циркуляционный насос Riello VegA RMYA 25-40', hMaxM: 4.1, qMaxM3h: 3, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 25', installLengthMm: 130 },
  { sku: '20188517', name: 'Циркуляционный насос Riello VegA RMYA 25-60', hMaxM: 6, qMaxM3h: 3, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 25', installLengthMm: 130 },
  { sku: '20188521', name: 'Циркуляционный насос Riello VegA RMXA 25-40', hMaxM: 4.1, qMaxM3h: 2.8, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 25', installLengthMm: 180 },
  { sku: '20188522', name: 'Циркуляционный насос Riello VegA RMXA 25-60', hMaxM: 6, qMaxM3h: 3.8, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 25', installLengthMm: 180 },
  { sku: '20061643', name: 'Циркуляционный насос Riello VegA RMXA 32-40', hMaxM: 4.1, qMaxM3h: 2.8, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 32', installLengthMm: 180 },
  { sku: '20061647', name: 'Циркуляционный насос Riello VegA RMXA 32-80', hMaxM: 7.9, qMaxM3h: 4.9, evidence: ['OHMX-CATALOG'], brand: 'Riello', dn: 'DN 32', installLengthMm: 180 },
];

// ---------------------------------------------------------------------------
// Strainers (size from the catalog record name = product designation)
// ---------------------------------------------------------------------------

export const STRAINERS: Array<{ sku: string; thread: string; name: string }> = [
  { sku: '8029012', thread: '1/2"', name: 'Сетчатый фильтр F.I.V. 1/2"' },
  { sku: '8029034', thread: '3/4"', name: 'Сетчатый фильтр F.I.V. 3/4"' },
  { sku: '8029100', thread: '1"', name: 'Сетчатый фильтр F.I.V. 1"' },
  { sku: '8029114', thread: '1 1/4"', name: 'Сетчатый фильтр F.I.V. 1 1/4"' },
  { sku: '8029112', thread: '1 1/2"', name: 'Сетчатый фильтр F.I.V. 1 1/2"' },
  { sku: '8029200', thread: '2"', name: 'Сетчатый фильтр F.I.V. 2"' },
];

/** Automatic air vents (catalog record: thread, PN10). */
export const AIR_VENTS: Array<{ sku: string; thread: string; name: string }> = [
  { sku: 'PU1100-0020', thread: '3/4"', name: 'Автоматический воздухоотводчик Tecofi 3/4" PN10' },
  { sku: 'PU1100-0025', thread: '1"', name: 'Автоматический воздухоотводчик Tecofi 1" PN10' },
];

/** Danfoss radiator valve set (one manufacturer kit: RA-N + RLV-S + RAE head), catalog record. */
export const RADIATOR_VALVE_KIT = { sku: '013G5174', name: 'Комплект радиаторного терморегулятора Danfoss RA-N + RLV-S + RAE (прямой)' };

/** Water towel warmers present in the catalog (no rated output in the records). */
export const WATER_TOWEL_WARMERS = ['P12/800/450/SW', 'P16/1000/500/SW', 'P18/960/500/SW', 'P22/1120/500/SW'];

// ---------------------------------------------------------------------------
// General hydronic fittings — exact catalog records (OhmX catalog audit 2026-10-14).
// Sizes come from the product designation in the catalog name.
// ---------------------------------------------------------------------------

/** F.I.V. full-bore ball valves, female × male thread, by nominal thread. */
export const BALL_VALVES_FM: Record<string, { sku: string; name: string }> = {
  '1/2"': { sku: '8367R004', name: 'Кран шаровой F.I.V. 1/2" (внутренняя/наружная резьба)' },
  '3/4"': { sku: '8367R005', name: 'Кран шаровой F.I.V. 3/4" (внутренняя/наружная резьба)' },
  '1"': { sku: '8367R006', name: 'Кран шаровой F.I.V. 1" (внутренняя/наружная резьба)' },
  '1 1/4"': { sku: '8367R007', name: 'Кран шаровой F.I.V. 1 1/4" (внутренняя/наружная резьба)' },
  '1 1/2"': { sku: '8361R008', name: 'Кран шаровой F.I.V. 1 1/2" с ручкой (внутренняя/наружная резьба)' },
  '2"': { sku: '8361R009', name: 'Кран шаровой F.I.V. 2" с ручкой (внутренняя/наружная резьба)' },
};

/** 1/2" ball valve used as fill / drain point (with a plug or hose adapter). */
export const FILL_DRAIN_VALVE = { sku: '8366R004', name: 'Кран шаровой F.I.V. 1/2" (внутренняя резьба) для заполнения / слива' };

export const THERMOMETER = { sku: '610612', name: 'Термометр аксиальный Emmeti 0–120 °C, Ø63 мм, 1/2"' };

/** 0–6 bar dial: covers the 1.5–3 bar working range of closed heating systems. */
export const MANOMETER = { sku: '612006', name: 'Манометр радиальный Emmeti 0–6 бар, Ø63 мм, 1/4"' };

/** Radiator-type angle valve, 1/2" — towel warmer supply / return. */
export const TOWEL_VALVE = { sku: '1350724', name: 'Угловой вентиль Emmeti Full 1/2" (внутренняя резьба)' };

export const SAFETY_VALVE_3BAR = { sku: '206030', name: 'Предохранительный клапан Emmeti 1/2" 3 бар' };

/**
 * Emmeti DN25 hydraulic separator, SKU 28151040 (catalog card: Ду25, side ports 1", end ports 1/2", air vent + drain, 10 bar, 110 °C).
 * The card gives NO maximum flow and NO external dimensions — nothing is assumed; only connection velocity is checked
 * against a generic engineering criterion (maxVelocityMs, not a manufacturer value).
 */
export const HYDRAULIC_SEPARATOR = { sku: '28151040', name: 'Гидравлический разделитель Emmeti Ду25 (1") с воздухоотводчиком и сливом', maxCircuits: 2, maxVelocityMs: 1.0 };

export const EXPANSION_TANKS: Array<{ sku: string; litres: number }> = [
  { sku: 'VEMS-0019', litres: 19 },
  { sku: 'VEMS-0035', litres: 35 },
];

/** Danfoss compression fitting for 20×2 multilayer pipe (catalog card names the size only — thread to be checked on site). */
export const COMPRESSION_FITTING_20 = { sku: '013G4190', name: 'Компрессионный фитинг Danfoss 20×2 мм' };

