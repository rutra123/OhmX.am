import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical } from './Icons';

type RenderMeta = {
  isPinned: boolean;
  dragHandle: ReactNode | null;
  isDragging: boolean;
};

type PinnedCollectionProps<T> = {
  items: T[];
  pinnedIds: string[];
  getId: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T, meta: RenderMeta) => ReactNode;
  listClassName: string;
  pinnedTitle: string;
  allTitle: string;
};

/** The source takes the target's original slot, so adjacent moves work in both directions. */
export const moveIdToIndex = (ids: string[], fromId: string, toIndex: number) => {
  const fromIndex = ids.indexOf(fromId);
  const index = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (fromIndex === -1 || fromIndex === index) return ids;
  const next = ids.filter((id) => id !== fromId);
  next.splice(index, 0, fromId);
  return next;
};

export const reorderIds = (ids: string[], fromId: string, toId: string) => {
  const toIndex = ids.indexOf(toId);
  return toIndex === -1 ? ids : moveIdToIndex(ids, fromId, toIndex);
};

const POINTER_DRAG_THRESHOLD_PX = 6;

type PointerDrag = { id: string; pointerId: number; startX: number; startY: number; active: boolean; overId: string | null };

export function PinnedCollection<T>({ items, pinnedIds, getId, onReorder, renderItem, listClassName, pinnedTitle, allTitle }: PinnedCollectionProps<T>) {
  const { t } = useTranslation();
  // Persistent order changes only when a gesture completes; hover just marks the target.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nativeDragId = useRef<string | null>(null);
  const pointerDrag = useRef<PointerDrag | null>(null);
  const pinnedListRef = useRef<HTMLDivElement | null>(null);
  const focusAfterMove = useRef<string | null>(null);

  const pinnedItems = useMemo(() => pinnedIds.map((id) => items.find((item) => getId(item) === id)).filter(Boolean) as T[], [getId, items, pinnedIds]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const unpinnedItems = useMemo(() => items.filter((item) => !pinnedSet.has(getId(item))), [getId, items, pinnedSet]);
  const visiblePinnedIds = useMemo(() => pinnedItems.map(getId), [getId, pinnedItems]);

  const clearDrag = () => {
    nativeDragId.current = null;
    pointerDrag.current = null;
    setDraggingId(null);
    setOverId(null);
  };

  const commitReorder = (fromId: string | null, toId: string | null) => {
    if (!fromId || !toId || fromId === toId) return false;
    const next = reorderIds(pinnedIds, fromId, toId);
    if (next === pinnedIds) return false;
    onReorder(next);
    const visible = next.filter((id) => visiblePinnedIds.includes(id));
    setAnnouncement(t('catalog.shared.pin.reorderMoved', { position: visible.indexOf(fromId) + 1, total: visible.length }));
    return true;
  };

  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    pinnedListRef.current?.querySelector<HTMLElement>(`[data-pin-handle="${CSS.escape(id)}"]`)?.focus();
  }, [pinnedIds]);

  useEffect(() => {
    if (!draggingId) return undefined;
    const cancelOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && pointerDrag.current) clearDrag();
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [draggingId]);

  const pinIdAt = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pin-id]');
    return row && pinnedListRef.current?.contains(row) ? row.dataset.pinId ?? null : null;
  };

  // Mouse uses native HTML5 drag; touch and pen use pointer capture on the handle.
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerDrag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, overId: null };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < POINTER_DRAG_THRESHOLD_PX) return;
      drag.active = true;
      setDraggingId(drag.id);
    }
    event.preventDefault();
    const target = pinIdAt(event.clientX, event.clientY);
    drag.overId = target && target !== drag.id ? target : null;
    setOverId(drag.overId);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.active) {
      const target = pinIdAt(event.clientX, event.clientY);
      commitReorder(drag.id, target && target !== drag.id ? target : null);
    }
    clearDrag();
  };

  const cancelPointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerDrag.current?.pointerId === event.pointerId) clearDrag();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = visiblePinnedIds.indexOf(id);
    const targetIndex = {
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      Home: 0,
      End: visiblePinnedIds.length - 1,
    }[event.key];
    if (targetIndex === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    // Neighbours are taken from the visible list; hidden pins keep their slots.
    const targetId = visiblePinnedIds[Math.max(0, Math.min(visiblePinnedIds.length - 1, targetIndex))];
    focusAfterMove.current = id;
    if (!commitReorder(id, targetId)) focusAfterMove.current = null;
  };

  const buildHandle = (id: string) => (
    <button
      type="button"
      className="pin-drag-handle"
      draggable
      data-pin-handle={id}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => handleKeyDown(event, id)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
        // A native drag supersedes any pointer gesture that started it.
        pointerDrag.current = null;
        nativeDragId.current = id;
        setDraggingId(id);
      }}
      onDragEnd={clearDrag}
      onPointerDown={(event) => handlePointerDown(event, id)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      // Chrome fires pointercancel when a native mouse drag starts; it must not end that drag.
      onPointerCancel={cancelPointerDrag}
      onLostPointerCapture={cancelPointerDrag}
      aria-label={t('catalog.shared.pin.reorderAria')}
      aria-keyshortcuts="ArrowUp ArrowDown Home End"
      title={t('catalog.shared.pin.reorderTitle')}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  const renderPinnedRow = (item: T) => {
    const id = getId(item);
    return (
      <div
        key={`pinned-${id}`}
        data-pin-id={id}
        data-pin-drop-target={overId === id ? 'true' : undefined}
        onDragOver={(event) => {
          if (!nativeDragId.current) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const target = nativeDragId.current === id ? null : id;
          if (overId !== target) setOverId(target);
        }}
        onDragLeave={(event) => {
          if (overId === id && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOverId(null);
        }}
        onDrop={(event) => {
          if (!nativeDragId.current) return;
          event.preventDefault();
          commitReorder(nativeDragId.current, id);
          clearDrag();
        }}
      >
        {renderItem(item, { isPinned: true, dragHandle: buildHandle(id), isDragging: draggingId === id })}
      </div>
    );
  };

  if (!pinnedItems.length) {
    return <div className={listClassName}>{items.map((item) => renderItem(item, { isPinned: false, dragHandle: null, isDragging: false }))}</div>;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="pinned-section-title">{pinnedTitle}</div>
        <div ref={pinnedListRef} className={listClassName}>{pinnedItems.map(renderPinnedRow)}</div>
        <span className="sr-only" aria-live="polite">{announcement}</span>
      </section>
      <section className="space-y-3">
        <div className="pinned-section-title muted">{allTitle}</div>
        <div className={listClassName}>{unpinnedItems.map((item) => renderItem(item, { isPinned: false, dragHandle: null, isDragging: false }))}</div>
      </section>
    </div>
  );
}
