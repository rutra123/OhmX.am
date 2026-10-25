/**
 * householdMenu hierarchy is REMOVED.
 * Canonical catalog navigation comes only from GET /api/navigation
 * (server NavigationComposer / contract 2026-07-12.1).
 *
 * This file no longer defines order, names, or membership of catalog menus.
 * Keep empty export only so any residual import does not invent a second hierarchy.
 */

export type MenuCard = {
  id?: number | string;
  title: string;
  icon?: string;
  priority?: number;
  slugs: string[];
  categoryIds?: Array<number | string>;
  description?: string;
  isCollapsed?: boolean;
  order?: number;
};

export type MenuGroup = {
  id?: string;
  title: string;
  icon?: string;
  order: number;
  cards: MenuCard[];
  description?: string;
};

/** @deprecated Hierarchy removed. Always empty. Use useNavigation(). */
export const householdMenu: MenuGroup[] = [];
