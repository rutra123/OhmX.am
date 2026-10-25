/**
 * Phase 3.2L — mobile navigation / scroll policy model (pure, framework-free).
 *
 * The calculator has exactly ONE scroll owner: `.mobile-scroll-content` (the
 * `main` in `PublicLayout`). This module holds the pure navigation-state
 * transitions and the guarded DOM scroll helpers so step changes, focused room
 * edits, and the Professional missing-input flow can reset the scroll target
 * to the top of the working content without `window.scrollTo` and without
 * `scrollIntoView` fighting the sticky header.
 */
import type { BuildingLoadMode } from '../types';

export type CalcStep = 'object' | 'rooms' | 'systems' | 'review' | 'loads';

/**
 * Whether a manual step change must reset the wizard scroll target to top.
 * A no-op (same step) or the initial mount (prev === null) must NOT scroll.
 */
export function stepChangeResetsScroll(prev: CalcStep | null, next: CalcStep): boolean {
  return prev !== null && prev !== next;
}

/**
 * A focused engineering edit launched from the Professional missing-input
 * summary. `returnStep` is TRANSIENT UI state — never persisted to any
 * engineering snapshot.
 */
export interface MissingEditTarget {
  roomId: string;
  sectionKey: string;
  returnStep: CalcStep;
}

export function missingEditTarget(roomId: string, sectionKey: string): MissingEditTarget {
  return { roomId, sectionKey, returnStep: 'loads' };
}

/** Where to return after a focused engineering edit completes / is cancelled. */
export function resolveReturnTarget(
  target: MissingEditTarget | null,
  loadMode: BuildingLoadMode,
): { step: CalcStep; loadMode: BuildingLoadMode } | null {
  if (!target) return null;
  return { step: target.returnStep, loadMode };
}

export interface RoomsCompactState {
  addRoomOpen: boolean;
  editingRoomId: string | null;
}

/** Initial mobile state: the room-type catalogue is hidden and no room editor is open. */
export function roomsDefaultCompactState(): RoomsCompactState {
  return { addRoomOpen: false, editingRoomId: null };
}

// ---------------------------------------------------------------------------
// Scroll policy (DOM). Guarded so the module stays importable under node.
// ---------------------------------------------------------------------------

export function getWizardScrollContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  return (document.querySelector('.mobile-scroll-content') as HTMLElement | null) ?? undefined;
}

/** Reset the real scroll container to the top of the wizard content. */
export function scrollWizardToTop(): void {
  const el = getWizardScrollContainer();
  if (el) {
    el.scrollTo({ top: 0 });
    return;
  }
  if (typeof window !== 'undefined') window.scrollTo(0, 0);
}

/** Scroll the real container to bring an element into view, respecting the sticky bar. */
export function scrollWizardToElement(target: HTMLElement | null): void {
  if (!target) return;
  const container = getWizardScrollContainer();
  if (container) {
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - 8) });
  } else {
    target.scrollIntoView({ block: 'start' });
  }
}