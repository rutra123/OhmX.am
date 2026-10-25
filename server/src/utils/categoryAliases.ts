import { db } from '../db.js';

/**
 * categories.old_aliases: comma-separated slugs of archived categories merged into this one.
 * Only active categories own aliases; a slug still used by an active category is never treated as an alias.
 */
export function parseCategoryAliases(raw: unknown): string[] {
  return String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);
}

type CategoryRef = { id: number; parent_id: number | null; slug: string };

function activeCategoryBySlug(slug: string): CategoryRef | undefined {
  return db.prepare('SELECT id, parent_id, slug FROM categories WHERE slug = ? AND is_active = 1').get(slug) as CategoryRef | undefined;
}

/** Active category that absorbed `slug`, or null when `slug` is live or unknown. */
export function resolveCategoryAlias(slug: string): CategoryRef | null {
  if (!slug || activeCategoryBySlug(slug)) return null;
  const owners = db.prepare("SELECT id, parent_id, slug, old_aliases FROM categories WHERE is_active = 1 AND COALESCE(old_aliases, '') <> ''").all() as (CategoryRef & { old_aliases: string })[];
  const owner = owners.find((row) => parseCategoryAliases(row.old_aliases).includes(slug));
  return owner ? { id: owner.id, parent_id: owner.parent_id, slug: owner.slug } : null;
}

/** Public URL of an active category: /catalog/<root>[/<descendant slugs>], matching the client routes. */
export function canonicalCategoryPath(categoryId: number): string | null {
  const trail: string[] = [];
  const seen = new Set<number>();
  let current = db.prepare('SELECT id, parent_id, slug FROM categories WHERE id = ? AND is_active = 1').get(categoryId) as CategoryRef | undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current.slug);
    current = current.parent_id
      ? db.prepare('SELECT id, parent_id, slug FROM categories WHERE id = ? AND is_active = 1').get(current.parent_id) as CategoryRef | undefined
      : undefined;
  }
  return trail.length ? `/catalog/${trail.map(encodeURIComponent).join('/')}` : null;
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Permanent-redirect target for a /catalog/... or /category/<slug> page URL that names a merged category,
 * straight to the final canonical path (no chains). Null when the URL needs no redirect.
 */
export function canonicalCatalogRedirect(pathname: string): string | null {
  const match = /^\/(catalog|category)\/(.+?)\/?$/.exec(pathname);
  if (!match) return null;
  const segments = match[2].split('/').filter(Boolean).map(decodeSegment);
  const aliasTargets = segments.map(resolveCategoryAlias);
  if (!aliasTargets.some(Boolean)) return null;
  const last = segments[segments.length - 1];
  const targetId = aliasTargets[aliasTargets.length - 1]?.id ?? activeCategoryBySlug(last)?.id;
  if (!targetId) return null;
  const target = canonicalCategoryPath(targetId);
  return target && target !== pathname ? target : null;
}
