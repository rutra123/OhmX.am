/**
 * Room-type and object-type pictograms (same 32×32 / 1.6 stroke family as the
 * equipment glyphs). Mapped by the server's stable room-type / object-type
 * values; unknown values fall back to a neutral room-plan glyph.
 */
import type { CSSProperties } from 'react';
import { GlyphSvg, type GlyphDef } from './EquipmentIcon';

const BED: GlyphDef = { d: 'M4 8v17M4 20h24M28 25v-7.5a3 3 0 0 0-3-3H14V20', detail: 'M6.5 17.5a2.75 2.75 0 1 1 5.5 0' };
const DOOR: GlyphDef = { d: 'M8 28V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v23M4 28h24', dots: [[20, 16.5, 1.2]] };
const DESK: GlyphDef = { d: 'M3 14h26M6 14v13M26 14v13M17 14v13', detail: 'M17 19h9M17 23h9M9 4h10v6.5H9zM14 10.5V14' };
const KITCHEN: GlyphDef = { d: 'M6 5h20a1 1 0 0 1 1 1v21H5V6a1 1 0 0 1 1-1zM5 12h22', detail: 'M10 18h12v6H10zM12.3 8.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 1 1 3.6 0zM23.3 8.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 1 1 3.6 0z' };
const BALCONY: GlyphDef = { d: 'M3 16h26M3 27h26M6 16v11M11 16v11M16 16v11M21 16v11M26 16v11', detail: 'M9 13V5h14v8' };

const ROOM_GLYPHS: Record<string, GlyphDef> = {
  bedroom: BED,
  guest_room: BED,
  child_room: { d: 'M5 8v18M27 8v18M5 22h22M5 12h22', detail: 'M10 12v10M14 12v10M18 12v10M22 12v10' },
  living_room: { d: 'M6 15v-4a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v4M4 15.5a2 2 0 0 1 4 0V19h16v-3.5a2 2 0 0 1 4 0V24H4z', detail: 'M7 24v2.5M25 24v2.5' },
  office: DESK,
  commercial_office: DESK,
  dressing_room: { d: 'M7 4h18v22H7zM16 4v22', detail: 'M13.5 14v2.5M18.5 14v2.5M8.5 26v2M23.5 26v2' },
  kitchen: KITCHEN,
  kitchen_living: KITCHEN,
  corridor: DOOR,
  hallway: DOOR,
  hall: DOOR,
  stairwell: { d: 'M4 27h6v-5h6v-5h6v-5h6V6' },
  bathroom: { d: 'M3 15h26M5 15v5a6 6 0 0 0 6 6h10a6 6 0 0 0 6-6v-5', detail: 'M8 26l-1 2.5M24 26l1 2.5M8 15V8a3 3 0 0 1 6 0' },
  shower: { d: 'M8 28V10a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5M15 10h8', detail: 'M17 14v2M21 14v2M19 18.5v2M23 18.5v2M17 23v2M21 23v2' },
  wc: { d: 'M9 4h7v9H9zM6 13h18a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7zM12 20l-1.5 8h9L18 20' },
  laundry: { d: 'M7 4h18a1 1 0 0 1 1 1v23H6V5a1 1 0 0 1 1-1zM6 9h20M21 18.5a5 5 0 1 1-10 0 5 5 0 1 1 10 0z', dots: [[10, 6.5, .9], [13, 6.5, .9]] },
  balcony: BALCONY,
  loggia: BALCONY,
  terrace: BALCONY,
  basement: { d: 'M3 14 16 6l13 8M2 19.5h28M5 19.5V28h22v-8.5', detail: 'M5 14v5.5M27 14v5.5M9 28v-2h2.5v-2H14v-2h2.5' },
  garage: { d: 'M3 13 16 5l13 8v15H3zM8 28V17h16v11', detail: 'M8 20h16M8 23h16M8 26h16' },
  storage: { d: 'M5 16h10v10H5zM17 16h10v10H17zM11 5h10v11H11z', detail: 'M8.5 16v3M20.5 16v3M14.5 5v3' },
  technical: { d: 'M3 16h8M21 16h8M11 11v10l10-10v10z', detail: 'M16 16V8M12 6h8' },
  boiler_room: { d: 'M10 3h12a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', detail: 'M12 7h8v3h-8zM12 22v6M16 22v6M20 22v6M16 13.5c1.2 1.3 1.8 2.2 1.8 3a1.8 1.8 0 0 1-3.6 0c0-.8.6-1.7 1.8-3z' },
  sales_floor: { d: 'M4 12h24l-2.5-6h-19zM5.5 12v15h21V12M13 27v-7h6v7', detail: 'M8.7 12a2.2 2.2 0 0 0 4.3 0M15.2 12a2.2 2.2 0 0 0 4.3 0M21.6 12a2.2 2.2 0 0 0 4.3 0' },
  warehouse: { d: 'M4 28V5M28 28V5M4 12h24M4 19.5h24M4 27h24', detail: 'M7 7.5h5v4.5H7zM15 15h6v4.5h-6zM19 22.5h6V27h-6z' },
  server_room: { d: 'M8 3h16v26H8zM8 9.5h16M8 16h16M8 22.5h16', dots: [[11, 6.25, .9], [11, 12.75, .9], [11, 19.25, .9], [11, 25.75, .9]] },
  restaurant: { d: 'M10 4v24M7 4v6a3 3 0 0 0 6 0V4M22 28V4c-3 2-4.5 6-4.5 10H22' },
  workshop: { d: 'M20.5 4.5a6 6 0 0 0-6.6 8.2L4.5 22.1a2.4 2.4 0 0 0 3.4 3.4l9.4-9.4a6 6 0 0 0 8.2-6.6l-3.7 3.7-3.4-.9-.9-3.4z' },
  meeting_room: { d: 'M6 13h20v6H6zM9 19v6M23 19v6', detail: 'M6 9.5h4M14 9.5h4M22 9.5h4M6 27h4M22 27h4' },
  reception: { d: 'M3 17h26v10H3z', detail: 'M11 13a5 5 0 0 1 10 0zM16 7v1M9 13h14' },
  other: { d: 'M4 4h24v24H4z', detail: 'M4 16h9M19 4v8M19 18v10' },
};

const OBJECT_GLYPHS: Record<string, GlyphDef> = {
  apartment: { d: 'M6 28V5a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v23M3 28h26', detail: 'M10 8h3M19 8h3M10 13h3M10 18h3M19 18h3M14 28v-5h4v5', dots: [[20.5, 13, 2]] },
  private_house: { d: 'M4 14 16 4l12 10M7 11.5V28h18V11.5M3 28h26', detail: 'M13 28v-7h6v7M10 15h4v3.5h-4zM18 15h4v3.5h-4z' },
  commercial: { d: 'M4 12h24l-2.5-6h-19zM5.5 12v16h21V12M3 28h26', detail: 'M9 16h6v7H9zM18 16h5v12M8.7 12a2.2 2.2 0 0 0 4.3 0M15.2 12a2.2 2.2 0 0 0 4.3 0M21.6 12a2.2 2.2 0 0 0 4.3 0' },
};

export const ROOM_GLYPH_TYPES = Object.keys(ROOM_GLYPHS);
export const OBJECT_GLYPH_TYPES = Object.keys(OBJECT_GLYPHS);
export function hasRoomGlyph(roomType: string): boolean { return Object.prototype.hasOwnProperty.call(ROOM_GLYPHS, roomType); }

type IconProps = { size?: number; className?: string; style?: CSSProperties; title?: string };

export function RoomGlyph({ roomType, size = 20, ...rest }: IconProps & { roomType: string }) {
  return <GlyphSvg def={ROOM_GLYPHS[roomType] || ROOM_GLYPHS.other} glyph={`room-${roomType}`} size={size} {...rest} />;
}

export function ObjectGlyph({ objectType, size = 32, ...rest }: IconProps & { objectType: string }) {
  return <GlyphSvg def={OBJECT_GLYPHS[objectType] || ROOM_GLYPHS.other} glyph={`object-${objectType}`} size={size} {...rest} />;
}
