/**
 * Fast data entry helpers for the Building Project wizard.
 *
 * Pure functions only (no React, no DOM except `focusNextEntry`), so the exact
 * behaviour is unit-testable. Nothing here changes engineering methodology:
 *   - parseQuickNumber only turns what the user typed into ONE number for an
 *     existing field. "+" sums parts of the same quantity (e.g. an L-shaped
 *     room = 12 + 4.5 m², several external walls = 4.2 + 3.6 m), "×" multiplies
 *     length × width. No averaging, no hidden coefficients.
 *   - An empty field is ALWAYS "empty" (null), never 0.
 *   - STANDARD_ROOM_SETS only preselects which room ROWS exist in a new
 *     project; it never fills an engineering value (areas stay empty).
 */
import type { ObjectType } from '../types';

export type QuickNumberResult =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; value: number; expression: boolean };

const TOKEN_RE = /^\d+(?:\.\d+)?$/;

/**
 * Parse a user-typed number for a positive physical quantity.
 * Accepts "12,5", "12.5", "3,5*4", "3.5x4", "3,5×4", "12+4,5", "3*4+2*1,5".
 * Multiplication binds tighter than addition (ordinary arithmetic).
 * Result is rounded to 0.01 to remove floating-point noise.
 */
export function parseQuickNumber(raw: string, opts: { allowZero?: boolean } = {}): QuickNumberResult {
  const text = raw.trim();
  if (text === '') return { status: 'empty' };
  const normalized = text
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[xх×*]/gi, '*');
  if (normalized.includes('-')) return { status: 'invalid', message: 'Значение не может быть отрицательным' };
  const sums = normalized.split('+');
  let total = 0;
  for (const part of sums) {
    const factors = part.split('*');
    let product = 1;
    for (const f of factors) {
      if (!TOKEN_RE.test(f)) return { status: 'invalid', message: 'Введите число, например 12,5 или 3,5×4' };
      product *= Number(f);
    }
    total += product;
  }
  const value = Math.round(total * 100) / 100;
  if (!Number.isFinite(value)) return { status: 'invalid', message: 'Слишком большое число' };
  if (value === 0 && !opts.allowZero) return { status: 'invalid', message: 'Значение должно быть больше нуля' };
  return { status: 'ok', value, expression: sums.length > 1 || normalized.includes('*') };
}

/** Display a stored number in Russian notation (decimal comma). */
export function formatQuickNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

export interface StandardRoomRow { roomType: string; count: number }

/**
 * Standard room rows preselected for a NEW project, by object type. These are
 * just rows the user would otherwise add one by one; every count is editable
 * (0 removes the row) before the project is created. No areas are filled in.
 */
export const STANDARD_ROOM_SETS: Record<ObjectType, StandardRoomRow[]> = {
  apartment: [
    { roomType: 'living_room', count: 1 },
    { roomType: 'bedroom', count: 1 },
    { roomType: 'kitchen', count: 1 },
    { roomType: 'bathroom', count: 1 },
    { roomType: 'hallway', count: 1 },
  ],
  private_house: [
    { roomType: 'living_room', count: 1 },
    { roomType: 'bedroom', count: 2 },
    { roomType: 'kitchen', count: 1 },
    { roomType: 'bathroom', count: 1 },
    { roomType: 'wc', count: 1 },
    { roomType: 'hallway', count: 1 },
  ],
  commercial: [
    { roomType: 'commercial_office', count: 1 },
    { roomType: 'meeting_room', count: 1 },
    { roomType: 'wc', count: 1 },
    { roomType: 'corridor', count: 1 },
  ],
};

export function standardRoomSet(objectType: ObjectType): StandardRoomRow[] {
  return (STANDARD_ROOM_SETS[objectType] || []).map((row) => ({ ...row }));
}

/** Expand counted rows into the `rooms` array accepted by the existing create API. */
export function expandRoomRows(rows: StandardRoomRow[]): Array<{ roomType: string; areaM2: null }> {
  const out: Array<{ roomType: string; areaM2: null }> = [];
  for (const row of rows) {
    const n = Math.max(0, Math.min(30, Math.floor(row.count)));
    for (let i = 0; i < n; i += 1) out.push({ roomType: row.roomType, areaM2: null });
  }
  return out;
}

/** Area-entry progress for the completion indicator. Empty / non-positive = missing. */
export function areaProgress(rooms: Array<{ areaM2: number | null }>): { filled: number; total: number; percent: number } {
  const total = rooms.length;
  const filled = rooms.filter((r) => r.areaM2 != null && Number(r.areaM2) > 0).length;
  return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
}

export const QUICK_ENTRY_ATTR = 'data-bp-entry';

/**
 * Enter → move to the next quick-entry field (like Tab), selecting its text so
 * a value can be typed over immediately. Prefers the next EMPTY field so the
 * user jumps straight to what is still missing.
 */
export function focusNextEntry(current: HTMLElement, preferEmpty = true): boolean {
  if (typeof document === 'undefined') return false;
  const all = Array.from(document.querySelectorAll<HTMLInputElement>(`[${QUICK_ENTRY_ATTR}]`))
    .filter((el) => !el.disabled && el.offsetParent !== null);
  const idx = all.indexOf(current as HTMLInputElement);
  const after = all.slice(idx + 1);
  const target = (preferEmpty ? after.find((el) => el.value.trim() === '') : undefined) ?? after[0];
  if (!target) {
    current.blur();
    return false;
  }
  target.focus();
  target.select?.();
  return true;
}
