// Drag to reorder a short list with a mouse, a pen or a finger (LOG-4 platform rows, LOG-5 train
// cars). A press on the handle that moves more than a few pixels starts a drag: the item nearest
// the pointer is marked (`sort-over`), the item held is `sort-source`, and letting go calls
// `onDrop(to)`; Escape or a cancelled pointer drops nothing. A press that does not
// move is left alone, so a handle that is also a button still clicks. The keyboard has its own
// controls beside the handle (the ↑ ↓ buttons, the arrow keys on a car), so this is the pointer's
// way only. Nothing here touches the saved state: the caller reorders its draft in `onDrop`.
import { nearestIndex } from '../train-stations.ts';

// How far (px) the pointer must move before a press becomes a drag.
export const DRAG_START = 6;

export interface SortDrag {
  // The sortable items now, in order (read again on every move: they may reflow).
  items: () => HTMLElement[];
  // The index of the item pressed.
  from: number;
  onDrop: (to: number) => void;
}

export function beginSortDrag(event: PointerEvent, drag: SortDrag): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const { clientX: startX, clientY: startY, pointerId } = event;
  let active = false;
  let target = drag.from;
  const mark = () => {
    drag.items().forEach((item, i) => {
      item.classList.toggle('sort-source', active && i === drag.from);
      item.classList.toggle('sort-over', active && i === target && i !== drag.from);
    });
  };
  const move = (e: PointerEvent) => {
    if (!active && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_START) return;
    active = true;
    const centres = drag.items().map(item => {
      const box = item.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const at = nearestIndex(centres, e.clientX, e.clientY);
    target = at < 0 ? drag.from : at;
    mark();
  };
  const finish = (commit: boolean) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
    try {
      handle.releasePointerCapture?.(pointerId);
    } catch {}
    const dropped = active && commit && target !== drag.from;
    active = false;
    mark();
    if (dropped) drag.onDrop(target);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  try {
    handle.setPointerCapture?.(pointerId);
  } catch {}
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key, true);
}
