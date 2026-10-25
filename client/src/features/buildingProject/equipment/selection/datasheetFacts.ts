/**
 * Manufacturer-document facts per catalog SKU (reviewed code, not generated).
 *
 * Only values printed in an EVIDENCE document (catalogFacts.ts) are recorded here; each
 * attribute names its document. These are the only values the validators accept as
 * "verified". Catalog card values stay in catalogProfiles.json with their own source.
 */
import type { Attr } from './types';

type Facts = Record<string, Attr>;

const ds = (v: Attr['v'], doc: string, u: string | null = null): Attr => ({ v, u, src: 'datasheet', doc });

// ---------------------------------------------------------------------------
// Thermal actuators — Danfoss TWA data sheet 2025.09 (ordering table + technical specifications)
// ---------------------------------------------------------------------------

const twa = (model: string, iface: string, voltage: 24 | 230, fn: 'NC' | 'NO'): Facts => ({
  model: ds(model, 'DAN-TWA-2025'),
  valve_interface: ds(iface, 'DAN-TWA-2025'),
  voltage_v: ds(voltage, 'DAN-TWA-2025', 'V'),
  current: ds(voltage === 24 ? 'AC/DC' : 'AC', 'DAN-TWA-2025'),
  function: ds(fn, 'DAN-TWA-2025'),
  power_w: ds(2, 'DAN-TWA-2025', 'W'),
  inrush_ma: ds(voltage === 24 ? 350 : 250, 'DAN-TWA-2025', 'mA'),
  closing_force_n: ds(110, 'DAN-TWA-2025', 'N'),
  // TWA data sheet: "230 V max. 3 A pre-fuse"
  ...(voltage === 230 ? { prefuse_max_a: ds(3, 'DAN-TWA-2025', 'A') } : {}),
});

const ACTUATORS: Record<string, Facts> = {
  '088H3110': twa('TWA-A', 'RA', 24, 'NC'),
  '088H3111': twa('TWA-A', 'RA', 24, 'NO'),
  '088H3112': twa('TWA-A', 'RA', 230, 'NC'),
  '088H3113': twa('TWA-A', 'RA', 230, 'NO'),
  '088H3120': twa('TWA-V', 'RAV/VMT', 24, 'NC'),
  '088H3121': twa('TWA-V', 'RAV/VMT', 24, 'NO'),
  '088H3122': twa('TWA-V', 'RAV/VMT', 230, 'NC'),
  '088H3123': twa('TWA-V', 'RAV/VMT', 230, 'NO'),
  '088H3130': twa('TWA-L', 'RAVL', 24, 'NC'),
  '088H3131': twa('TWA-L', 'RAVL', 24, 'NO'),
  '088H3132': twa('TWA-L', 'RAVL', 230, 'NC'),
  '088H3133': twa('TWA-L', 'RAVL', 230, 'NO'),
  '088H3140': twa('TWA-K', 'M30x1.5', 24, 'NC'),
  '088H3141': twa('TWA-K', 'M30x1.5', 24, 'NO'),
  '088H3142': twa('TWA-K', 'M30x1.5', 230, 'NC'),
  '088H3143': twa('TWA-K', 'M30x1.5', 230, 'NO'),
};

// ---------------------------------------------------------------------------
// Manifolds
// ---------------------------------------------------------------------------

const fhf = (outlets: number): Facts => ({
  series: ds('FHF', 'DAN-FHF-2020'),
  outlets: ds(outlets, 'DAN-FHF-2020'),
  valve_interface: ds('RA', 'DAN-FHF-2020'),
  // FHF data sheet lists TWA-A 088H3110 / 088H3112 as the actuators for this manifold (exact codes).
  documented_actuators: ds('088H3110,088H3112', 'DAN-FHF-2020'),
  max_temp_c: ds(90, 'DAN-FHF-2020', '°C'),
  max_dp_bar: ds(0.6, 'DAN-FHF-2020', 'bar'),
  max_pressure_bar: ds(10, 'DAN-FHF-2020', 'bar'),
  presetting: ds(true, 'DAN-FHF-STORE-088U0504'),
  // Outlets take the "G ¾" internal thread" compression fittings of the data sheet -> outlet is G ¾" external.
  // The sealing geometry (eurocone or flat) of the outlet is NOT stated in the data sheet.
  outlet_thread: ds('3/4"', 'DAN-FHF-2020'),
  outlet_gender: ds('M', 'DAN-FHF-2020'),
});

const ssmF = (outlets: number): Facts => ({
  series: ds('SSM-F', 'DAN-SSM-STORE-088U0754'),
  outlets: ds(outlets, 'DAN-SSM-STORE-088U0754'),
  valve_interface: ds('RA', 'DAN-SSM-STORE-088U0754'),
  // TWA data sheet combination table: SSM (M) -> TWA-A, kvs 0.10–1.10, max Δp 0.6 bar.
  documented_actuator_model: ds('TWA-A', 'DAN-TWA-2025'),
  kvs_max: ds(1.1, 'DAN-TWA-2025', 'm3/h'),
  max_temp_c: ds(60, 'DAN-SSM-STORE-088U0754', '°C'),
  max_dp_bar: ds(0.6, 'DAN-SSM-STORE-088U0754', 'bar'),
  max_pressure_bar: ds(6, 'DAN-SSM-STORE-088U0754', 'bar'),
  flowmeters: ds(true, 'DAN-SSM-STORE-088U0754'),
});

const MANIFOLDS: Record<string, Facts> = {};
for (let n = 2; n <= 12; n += 1) {
  MANIFOLDS[`088U05${String(n).padStart(2, '0')}`] = fhf(n);
  MANIFOLDS[`088U07${String(50 + n)}`] = ssmF(n);
}

// ---------------------------------------------------------------------------
// Room thermostats and controllers
// ---------------------------------------------------------------------------

const iconDisplay230 = (mounting: 'IN_WALL' | 'ON_WALL'): Facts => ({
  family: ds('Danfoss Icon 230 V', 'DAN-ICON230-DISPLAY-2016'),
  supply_v: ds(230, 'DAN-ICON230-DISPLAY-2016', 'V'),
  output: ds('TRIAC_230V', 'DAN-ICON230-DISPLAY-2016'),
  output_voltage_v: ds(230, 'DAN-ICON230-DISPLAY-2016', 'V'),
  max_actuators: ds(5, 'DAN-ICON230-DISPLAY-2016'),
  max_continuous_w: ds(10, 'DAN-ICON230-DISPLAY-2016', 'W'),
  max_continuous_ma: ds(50, 'DAN-ICON230-DISPLAY-2016', 'mA'),
  max_inrush_a: ds(3, 'DAN-ICON230-DISPLAY-2016', 'A'),
  actuator_function: ds('NC,NO', 'DAN-ICON230-DISPLAY-2016'),
  modes: ds('HEATING', 'DAN-ICON230-DISPLAY-2016'),
  standalone: ds(true, 'DAN-ICON230-DISPLAY-2016'),
  mounting: ds(mounting, 'DAN-ICON230-DISPLAY-2016'),
});

const THERMOSTATS: Record<string, Facts> = {
  '088U1010': iconDisplay230('IN_WALL'),
  '088U1011': iconDisplay230('IN_WALL'),
  '088U1012': iconDisplay230('IN_WALL'),
  '088U1015': iconDisplay230('ON_WALL'),
};

const iconMaster24 = (channels: number): Facts => ({
  family: ds('Danfoss Icon 24 V', 'DAN-ICON24-2020'),
  output_voltage_v: ds(24, 'DAN-ICON24-2020', 'V'),
  channels: ds(channels, 'DAN-ICON24-2020'),
  actuators_per_output: ds(1, 'DAN-ICON24-2020'),
  max_w_per_output: ds(2, 'DAN-ICON24-2020', 'W'),
  cooling_requires: ds('088U1100', 'DAN-ICON24-2020'),
});

const CONTROLLERS: Record<string, Facts> = {
  '088U1071': iconMaster24(10),
  '088U1072': iconMaster24(15),
};

const ALL: Record<string, Facts> = { ...ACTUATORS, ...MANIFOLDS, ...THERMOSTATS, ...CONTROLLERS };

export function datasheetFacts(sku: string): Facts | undefined {
  return ALL[sku];
}

export function documentedSkus(): string[] {
  return Object.keys(ALL).sort();
}
