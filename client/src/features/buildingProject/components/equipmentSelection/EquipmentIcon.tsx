/**
 * OhmX HVAC equipment pictograms — one consistent family.
 *
 * Grid: 32×32 viewBox, 1.6 stroke, round caps/joins, currentColor only.
 * Each glyph = a primary outline (`d`), optional secondary detail drawn at
 * reduced opacity (`detail`), an optional faint construction layer (`faint`)
 * and optional solid dots. Icons depict the physical
 * device or installation, never a generic flame/snowflake/fan for unrelated
 * equipment. Family-id → glyph mapping lives in utils/equipmentPresentation.ts.
 */
import type { CSSProperties } from 'react';

export type EquipmentGlyphKey =
  | 'convector' | 'heating_cable' | 'heating_mat' | 'floor_electric' | 'floor_water'
  | 'radiator_aluminum' | 'radiator_bimetal' | 'radiator_panel' | 'fan_coil' | 'trench_convector'
  | 'hp_air_air' | 'hp_air_water' | 'hp_reversible' | 'gas_boiler' | 'gas_condensing_boiler' | 'electric_boiler'
  | 'split_wall' | 'cassette' | 'floor_ceiling' | 'column' | 'multi_split' | 'vrf' | 'ducted' | 'chiller'
  | 'building_supply' | 'custom_scheme' | 'none_heating' | 'none_cooling'
  | 'towel_rail_water' | 'towel_rail_electric'
  | 'circ_pump' | 'manifold' | 'buffer_tank' | 'hydraulic_separator' | 'controller' | 'pipe_valve' | 'fallback';

export type GlyphDef = { d: string; detail?: string; faint?: string; dots?: Array<[number, number, number]> };
type Glyph = GlyphDef;

const RAD_SECTIONS = [5.3, 9.9, 14.5, 19.1, 23.7]
  .map((x) => `M${x} 9.2a1.7 1.7 0 0 1 3.4 0v13.6a1.7 1.7 0 0 1-3.4 0z`).join('') + 'M3 10.5h2.3M27.1 23.5H29';
const BOILER_BODY = 'M9.5 3h13a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM19.8 16a3.8 3.8 0 1 1-7.6 0 3.8 3.8 0 1 1 7.6 0z';
const FLAME_SMALL = 'M16 13.4c1.3 1.4 1.9 2.4 1.9 3.3a1.9 1.9 0 0 1-3.8 0c0-.9.6-1.9 1.9-3.3z';
const FLOOR_SECTION = 'M3 12h26v3.5H3zM11.5 12v3.5M20.5 12v3.5M3 15.5V27h26V15.5';
const HEAT_WAVES = 'M8 10c-1-1 1-2 0-3s1-2 0-3M14 10c-1-1 1-2 0-3s1-2 0-3';
const HP_OUTDOOR = 'M4 8h16a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 20 24H4a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 4 8zM15.5 16a5 5 0 1 1-10 0 5 5 0 1 1 10 0z';
const HP_OUTDOOR_DETAIL = 'M18.5 11v10M10.5 16c0-2 1-3.2 2.6-3.6M10.5 16c1.8.9 2.3 2.4 1.6 3.9M10.5 16c-1.7 1-3.2.9-4.1-.4M5 24v2.5M18 24v2.5';

const GLYPHS: Record<EquipmentGlyphKey, Glyph> = {
  convector: {
    d: 'M6 9.5h20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z',
    detail: 'M8 12.5v3M11 12.5v3M14 12.5v3M17 12.5v3M20 12.5v3M23 12.5v3M21.5 20h3.5M9.6 17.6 8.2 20h2.4l-1.4 2.2M11 7.5c-1-1 1-1.8 0-2.8M16 7.5c-1-1 1-1.8 0-2.8M21 7.5c-1-1 1-1.8 0-2.8',
  },
  heating_cable: {
    d: 'M7 6.5h16a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h14a3 3 0 0 1 0 6H6.5',
    detail: 'M3 5h4v3H3zM1.5 6.5H3',
    dots: [[6, 24.5, 1.2]],
  },
  heating_mat: {
    d: 'M8 24V9.5a1.75 1.75 0 0 1 3.5 0v13a1.75 1.75 0 0 0 3.5 0v-13a1.75 1.75 0 0 1 3.5 0v13a1.75 1.75 0 0 0 3.5 0v-13a1.75 1.75 0 0 1 3.5 0V24',
    detail: 'M5.5 5h21A1.5 1.5 0 0 1 28 6.5v19a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 4 25.5v-19A1.5 1.5 0 0 1 5.5 5z',
    faint: 'M4 12h24M4 19h24M9.75 5v22M16.75 5v22M23.75 5v22',
  },
  floor_electric: {
    // floor finish over screed with a zig-zag resistive cable and an electric mark
    d: `${FLOOR_SECTION}M24.5 2.5 21.8 6.5h3.4l-2.7 4M5 21.5l2-3 2.5 6 2.5-6 2.5 6 2.5-6 2.5 6 2.5-6 2.5 6 2-3`,
    detail: HEAT_WAVES,
  },
  floor_water: {
    // floor finish over screed with a serpentine water pipe and a water mark
    d: `${FLOOR_SECTION}M3 18.5h20.5a2 2 0 0 1 0 4H8.5a1.75 1.75 0 0 0 0 3.5H29`,
    detail: `${HEAT_WAVES}M23 2.5c-1.8 2.3-2.7 3.6-2.7 4.8a2.7 2.7 0 0 0 5.4 0c0-1.2-.9-2.5-2.7-4.8z`,
  },
  radiator_aluminum: {
    d: RAD_SECTIONS,
    detail: 'M7 25v2M25.4 25v2',
  },
  radiator_bimetal: {
    d: RAD_SECTIONS,
    detail: 'M7 10.5v11M11.6 10.5v11M16.2 10.5v11M20.8 10.5v11M25.4 10.5v11M7 10.5h18.4M7 21.5h18.4',
  },
  radiator_panel: {
    d: 'M5 8.5h22a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 22V10A1.5 1.5 0 0 1 5 8.5zM25 23.5V26h3',
    detail: 'M3.5 11.5h25M7 14v7M10 14v7M13 14v7M16 14v7M19 14v7M22 14v7M25 14v7',
  },
  fan_coil: {
    d: 'M5 7h22a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM15.2 17a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 1 1 8.4 0z',
    detail: 'M5.5 10.2h21M11 17c0-1.7.9-2.8 2.4-3.1M11 17c1.5.8 2 2.2 1.4 3.6M11 17c-1.5.9-2.9.8-3.8-.4M18.5 13v8.5M20.5 13v8.5M22.5 13v8.5M24.5 13v8.5M26.5 13v8.5M20.5 24v3.5M24.5 24v3.5',
  },
  trench_convector: {
    d: 'M2 12.5h6v12h16v-12h6M8 12.5h16M11 18h10v3.5H11z',
    detail: 'M10.5 12.5v2M13 12.5v2M15.5 12.5v2M18 12.5v2M20.5 12.5v2M13 18v3.5M15 18v3.5M17 18v3.5M19 18v3.5M13 10V4.5M11 6.5l2-2 2 2M19 10V4.5M17 6.5l2-2 2 2',
  },
  hp_air_air: {
    d: 'M4 14.5h12a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 25v-9A1.5 1.5 0 0 1 4 14.5zM12.1 20.5a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 1 1 7.2 0zM18.7 4.5h9.1a2.2 2.2 0 0 1 2.2 2.2v1.1a2.2 2.2 0 0 1-2.2 2.2h-9.1a2.2 2.2 0 0 1-2.2-2.2V6.7a2.2 2.2 0 0 1 2.2-2.2z',
    detail: 'M14.5 17.5v6M17.5 18.5H23V10M17.5 22H26V10M19.5 8.2h7M20.5 12.5c0 1.2.6 2 1.6 2.6',
    dots: [[8.5, 20.5, 1]],
  },
  hp_air_water: {
    d: `${HP_OUTDOOR}M21.5 12.5h6M21.5 19.5h6`,
    detail: `${HP_OUTDOOR_DETAIL}M25.5 10.5l2 2-2 2M25 17.5l-2 2 2 2M27.5 23c-1.3 1.6-2 2.5-2 3.4a2 2 0 0 0 4 0c0-.9-.7-1.8-2-3.4z`,
  },
  hp_reversible: {
    d: `${HP_OUTDOOR}M21.5 12.5h6M21.5 19.5h6`,
    detail: `${HP_OUTDOOR_DETAIL}M25.5 10.5l2 2-2 2M25 17.5l-2 2 2 2M23 24.5h6M27 22.5l2 2-2 2M29 28.5h-6M25 26.5l-2 2 2 2`,
  },
  gas_boiler: {
    d: `${BOILER_BODY}${FLAME_SMALL}`,
    detail: 'M11.5 6.5h9v3.5h-9zM10.5 23v5.5M14 23v5.5M18 23v5.5M21.5 23v5.5',
  },
  gas_condensing_boiler: {
    d: `${BOILER_BODY}${FLAME_SMALL}`,
    detail: 'M11.5 6.5h9v3.5h-9zM10.5 23v5.5M14 23v5.5M18 23v5.5M21.5 23v5.5M24.5 18.5h2.5v4.5M27 25c-1 1.3-1.5 2-1.5 2.7a1.5 1.5 0 0 0 3 0c0-.7-.5-1.4-1.5-2.7z',
  },
  electric_boiler: {
    d: `${BOILER_BODY}M16.8 13.4 15 16.3h2l-1.8 2.9`,
    detail: 'M11.5 6.5h9v3.5h-9zM12.5 23v5.5M19.5 23v5.5',
  },
  split_wall: {
    d: 'M3.5 7.5h25A1.5 1.5 0 0 1 30 9v4.8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a1.5 1.5 0 0 1 1.5-1.5z',
    detail: 'M6.5 14h19M9 19.5c-.5 2-1.5 3.6-3 5M16 19.5v6M23 19.5c.5 2 1.5 3.6 3 5M14.3 23.8l1.7 1.7 1.7-1.7',
    dots: [[25.5, 10.4, .9]],
  },
  cassette: {
    d: 'M9 7h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM13 12.5h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5z',
    detail: 'M11 9.5h10M11 22.5h10M9.5 11v10M22.5 11v10M12.5 16h7M16 12.5v7M16 5V1.5M14.5 3 16 1.5 17.5 3M16 27v3.5M14.5 29l1.5 1.5 1.5-1.5M5 16H1.5M3 14.5 1.5 16 3 17.5M27 16h3.5M29 14.5l1.5 1.5-1.5 1.5',
  },
  floor_ceiling: {
    d: 'M2 4.5h28M3 7.5h17l2.5 3.5v2.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    detail: 'M6 4.5v3M17 4.5v3M19.5 12.5h2.5M24 10h5.5M27.5 8l2 2-2 2M24 14c2 0 3.6.6 5 1.6M5 11.5h11',
    faint: 'M5 4.5l-2-2M10 4.5l-2-2M15 4.5l-2-2M20 4.5l-2-2M25 4.5l-2-2M30 4.5l-2-2',
  },
  column: {
    d: 'M8.5 3.5h9a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-21a2 2 0 0 1 2-2z',
    detail: 'M9.5 7h7M9.5 9.5h7M9.5 12h7M9.5 14.5h7M11 19h4M21.5 8.5h6M25.5 6.5l2 2-2 2M21.5 13h6M25.5 11l2 2-2 2',
  },
  multi_split: {
    d: 'M3 4.5h6a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM13 4.5h6a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM23 4.5h6a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM11 19h11a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H11a1.5 1.5 0 0 1-1.5-1.5v-6.5A1.5 1.5 0 0 1 11 19zM17.5 23.75a3 3 0 1 1-6 0 3 3 0 1 1 6 0z',
    detail: 'M12.5 19v-3.5L6 13V9M16 19V9M19.5 19v-3.5L26 13V9M21 21.5v4.5',
  },
  vrf: {
    d: 'M3 3.5h3.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM10.5 3.5H14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM18 3.5h3.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM25.5 3.5H29a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM8.5 18h15a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 27v-7.5A1.5 1.5 0 0 1 8.5 18zM15 23.25a3 3 0 1 1-6 0 3 3 0 1 1 6 0zM23 23.25a3 3 0 1 1-6 0 3 3 0 1 1 6 0z',
    detail: 'M4.75 12h22.5M4.75 7.5V12M12.25 7.5V12M19.75 7.5V12M27.25 7.5V12M16 12v6',
    dots: [[12.25, 12, 1.2], [16, 12, 1.2], [19.75, 12, 1.2]],
  },
  ducted: {
    d: 'M2 15h28M4 6.5h8v6.5H4zM12 8h15.5v4H12',
    detail: 'M17 12v3M24 12v3M17 17.5v4.5M15.5 20.5 17 22l1.5-1.5M24 17.5v4.5M22.5 20.5 24 22l1.5-1.5M6 9h4M6 11h4',
  },
  chiller: {
    d: 'M3.5 13h12a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 2 25.5v-11A1.5 1.5 0 0 1 3.5 13zM9 19a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 1 1 5.2 0zM15.2 19a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 1 1 5.2 0zM21.5 5h7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 21.5 5z',
    detail: 'M17 17h6.5v-4M17 21.5h10v-8.5M4.5 24h10M22.5 8h5M22.5 10h5',
  },
  building_supply: {
    d: 'M2 28h28M4.5 28V6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V28M16.5 18H28M16.5 22.5H28',
    detail: 'M7.5 9.5h2M11.5 9.5h2M7.5 13.5h2M11.5 13.5h2M7.5 17.5h2M11.5 17.5h2M9 28v-4h3v4M26 16l2 2-2 2M18.5 20.5l-2 2 2 2',
  },
  custom_scheme: {
    d: 'M13.4 9a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 1 1 4.8 0zM22.4 16a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 1 1 4.8 0zM16.4 23a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 1 1 4.8 0z',
    detail: 'M5 9h3.6M13.4 9H27M5 16h12.6M22.4 16H27M5 23h6.6M16.4 23H27',
  },
  none_heating: {
    d: 'M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0zM7.5 7.5l17 17',
    detail: 'M11.5 12a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0zM15 12a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0zM18.5 12a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0z',
  },
  none_cooling: {
    d: 'M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0zM7.5 7.5l17 17',
    detail: 'M16 9.5v13M10.4 12.75l11.2 6.5M10.4 19.25l11.2-6.5',
  },
  towel_rail_water: {
    // ladder towel rail on hydronic supply/return
    d: 'M9 4.5v22M22 4.5v22M9 9h13M9 14h13M9 19h13M9 24h13',
    detail: 'M5 6.5h4M22 24.5h4.5M26.5 22.5v4M5 4.5v4',
  },
  towel_rail_electric: {
    // ladder towel rail with a mains cable and an electric mark
    d: 'M7 4.5v22M20 4.5v22M7 9h13M7 14h13M7 19h13M7 24h13',
    detail: 'M20 25c3 0 4.5.8 4.5 3.5M27.6 4 25.4 7.6h2.8l-2.2 3.6',
  },
  circ_pump: {
    // inline circulation pump: volute on the pipe, motor head above
    d: 'M3 20h7M22 20h7M22 20a6 6 0 1 1-12 0 6 6 0 1 1 12 0zM12 4h8a1 1 0 0 1 1 1v8.5h-10V5a1 1 0 0 1 1-1z',
    detail: 'M16 20a2.5 2.5 0 1 0 2.5-2.5M18.5 17.5l-.2 1.9M18.5 17.5l1.8.6M14 7.5h4',
  },
  manifold: {
    // supply/return bars with circuit outlets
    d: 'M4 10h21M4 21h21M25 8v4M25 19v4',
    detail: 'M9 10V5M14 10V5M19 10V5M9 21v6M14 21v6M19 21v6M2 10h2M2 21h2',
    dots: [[9, 5, 1.3], [14, 5, 1.3], [19, 5, 1.3]],
  },
  buffer_tank: {
    // vertical storage vessel with four ports
    d: 'M10 7a6 2.5 0 0 1 12 0v18a6 2.5 0 0 1-12 0z',
    detail: 'M22 11h4M22 21h4M6 11h4M6 21h4M10 7a6 2.5 0 0 0 12 0',
  },
  hydraulic_separator: {
    // low-loss header: vertical body, primary ports left, secondary right
    d: 'M13 3.5h6v25h-6z',
    detail: 'M5 9h8M5 23h8M19 9h8M19 23h8M7 7l-2 2 2 2M25 21l2 2-2 2',
  },
  controller: {
    // room/zone controller: housing with dial and set-point mark
    d: 'M8 4h16a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM21 15a5 5 0 1 1-10 0 5 5 0 1 1 10 0z',
    detail: 'M16 15l2.2-2.6M11 24h10',
  },
  pipe_valve: {
    // pipe run with a ball valve and handle
    d: 'M3 18h8M21 18h8M11 13v10l10-10v10z',
    detail: 'M16 18V9M12 7h8',
  },
  fallback: {
    d: 'M7.5 7h17a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 5 22.5v-13A2.5 2.5 0 0 1 7.5 7z',
    detail: 'M13.5 13.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.7v.4',
    dots: [[16, 20.4, 1.1]],
  },
};

export const EQUIPMENT_GLYPH_KEYS = Object.keys(GLYPHS) as EquipmentGlyphKey[];

export function EquipmentGlyph({ glyph, ...rest }: {
  glyph: EquipmentGlyphKey;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name. Omit for decorative use next to a visible label. */
  title?: string;
}) {
  return <GlyphSvg def={GLYPHS[glyph] || GLYPHS.fallback} glyph={glyph} {...rest} />;
}

/** Shared renderer for every OhmX pictogram family (equipment, rooms, objects). */
export function GlyphSvg({ def: g, glyph, size = 32, className, style, title }: {
  def: GlyphDef;
  glyph: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `eq-glyph ${className}` : 'eq-glyph'}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      data-glyph={glyph}
    >
      {g.faint && <path d={g.faint} opacity={0.38} strokeWidth={1.1} />}
      {g.detail && <path d={g.detail} opacity={0.62} />}
      <path d={g.d} />
      {g.dots?.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />)}
    </svg>
  );
}
