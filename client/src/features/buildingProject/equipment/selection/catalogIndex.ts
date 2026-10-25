/**
 * Read-only index over the generated catalog profiles + reviewed datasheet facts.
 *
 * Datasheet values override catalog values of the same key (the catalog value is kept as
 * `catalog:<key>` so a contradiction stays visible). Price and stock are never stored here.
 */
import profiles from './catalogProfiles.json';
import { datasheetFacts } from './datasheetFacts';
import type { Attr, FunctionalType, ProductProfile } from './types';

interface ProfilesFile {
  meta: { schema: string; dbSha256: string; activeProducts: number; exported: number; note: string };
  products: ProductProfile[];
}

export interface CatalogIndex {
  meta: ProfilesFile['meta'];
  get(sku: string): ProductProfile | undefined;
  byType(...types: FunctionalType[]): ProductProfile[];
  all(): ProductProfile[];
}

function merge(p: ProductProfile): ProductProfile {
  const facts = datasheetFacts(p.sku);
  if (!facts) return p;
  const attrs: Record<string, Attr> = { ...p.attrs };
  for (const [k, v] of Object.entries(facts)) {
    const prev = attrs[k];
    if (prev && prev.src !== 'datasheet' && String(prev.v) !== String(v.v)) attrs[`catalog:${k}`] = prev;
    attrs[k] = v;
  }
  return { ...p, attrs };
}

export function createCatalogIndex(file: ProfilesFile): CatalogIndex {
  const list = file.products.map(merge).sort((a, b) => a.sku.localeCompare(b.sku));
  const bySku = new Map(list.map((p) => [p.sku, p]));
  return {
    meta: file.meta,
    get: (sku) => bySku.get(sku),
    byType: (...types) => list.filter((p) => types.includes(p.type)),
    all: () => list,
  };
}

let defaultIndex: CatalogIndex | null = null;

/** Index over the bundled snapshot (built by scripts/build_equipment_catalog_profiles.py). */
export function catalogIndex(): CatalogIndex {
  if (!defaultIndex) defaultIndex = createCatalogIndex(profiles as unknown as ProfilesFile);
  return defaultIndex;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

export function attr(p: ProductProfile | undefined, key: string): Attr | undefined {
  return p?.attrs[key];
}

export function num(p: ProductProfile | undefined, key: string): number | null {
  const a = p?.attrs[key];
  return a && typeof a.v === 'number' && Number.isFinite(a.v) ? a.v : null;
}

export function str(p: ProductProfile | undefined, key: string): string | null {
  const a = p?.attrs[key];
  return a && a.v != null ? String(a.v) : null;
}

export function isVerified(a: Attr | undefined): boolean {
  return Boolean(a && (a.src === 'datasheet' || a.src === 'profile'));
}

const SOURCE_LABEL: Record<Attr['src'], string> = {
  datasheet: 'даташит',
  profile: 'инженерный профиль',
  feature: 'карточка каталога',
  description: 'описание в каталоге',
  name: 'название в каталоге',
};

export function sourceLabel(a: Attr | undefined): string {
  if (!a) return 'нет данных';
  return a.src === 'datasheet' && a.doc ? `${SOURCE_LABEL[a.src]} ${a.doc}` : SOURCE_LABEL[a.src];
}
