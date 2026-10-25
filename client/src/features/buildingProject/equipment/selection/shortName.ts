/**
 * Short, readable card title for a catalog product.
 *
 * Catalog names follow "<Type> - <Model> [- <Colour / variant>] [- <Brand>]" (sometimes with the model
 * inside the first part: "Радиатор алюминиевый - Sira Primavera 500 - 103 Вт"). The picker shows
 * `title` (the model) big and `caption` (type · brand) small; the full catalog name stays available
 * as a tooltip and in the specification. Nothing is invented: both parts are cut from the real name.
 */
export interface ShortName {
  /** Model / series, e.g. "Pegasus", "KVZ 230-80-1200". */
  title: string;
  /** Variant details (size, colour), e.g. "шаг 50, высота 800 мм · белый"; empty when none. */
  variant: string;
  /** Product type · brand. */
  caption: string;
}

const MAX_TITLE = 60;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function shortProductName(name: string, brand?: string | null): ShortName {
  const b = (brand || '').trim();
  const parts = String(name || '').split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  // Trailing brand part ("... - Korado", "... - Licon") is shown as the brand, not repeated in the title.
  if (b && parts.length > 1 && parts[parts.length - 1].toLowerCase() === b.toLowerCase()) parts.pop();
  if (parts.length === 0) return { title: '', variant: '', caption: b };
  // Model written inside the first part ("Внутрипольный конвектор Licon - PK-120", "Отопительные регистры Licon OR-D2"):
  // the leading Cyrillic words are the type, the rest (from the first Latin / digit word) belongs to the model.
  const words = parts[0].split(/\s+/);
  // A Latin word after a preposition ('с WIFI', 'для DIN') is a feature of the type, not the model.
  const firstModelWord = words.findIndex((w, i) => i > 0 && /[A-Za-z0-9]/.test(w) && !(words[i - 1].length <= 3 && /^[а-яё]+$/i.test(words[i - 1])));
  let type = parts.length > 1 ? parts[0] : '';
  const rest = parts.slice(1);
  if (firstModelWord > 0) {
    type = words.slice(0, firstModelWord).join(' ');
    rest.unshift(words.slice(firstModelWord).join(' '));
  } else if (parts.length === 1) {
    rest.length = 0;
    rest.push(parts[0]);
  }
  const model = rest.join(' · ');
  let title = model;
  if (b) title = title.replace(new RegExp(`\\s*\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'i'), ' ').replace(/\s{2,}/g, ' ').trim() || model;
  const [head, ...tail] = title.split(' · ');
  return { title: clip(head, MAX_TITLE), variant: clip(tail.join(' · '), MAX_TITLE * 2), caption: [clip(type, 40), b].filter(Boolean).join(' · ') };
}
