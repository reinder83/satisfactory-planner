// Drag to reorder a short list with a mouse, a pen or a finger (LOG-4 platform rows, LOG-5 train
// cars). A press on the handle that moves more than a few pixels starts a drag: the item nearest
// the pointer is marked (`sort-over`), the item held is `sort-source`, and letting go calls
// `onDrop(to)`; Escape or a cancelled pointer drops nothing. A press that does not
// move is left alone, so a handle that is also a button still clicks. The keyboard has its own
// controls beside the handle (the ↑ ↓ buttons, the arrow keys on a car), so this is the pointer's
// way only. Nothing here touches the saved state: the caller reorders its draft in `onDrop`.
import { hitIndex } from '../train-stations.ts';

// How far (px) the pointer must move before a press becomes a drag.
export const DRAG_START = 6;

// Auto-scroll (#1399): within this many px of the top or bottom edge of the scrolling box the list
// sits in, the box scrolls while the pointer is held there, faster the nearer the edge.
export const SCROLL_EDGE = 40;
const SCROLL_MAX = 16;

// The nearest ancestor that scrolls vertically (the dialog's body), or null.
export function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}
// How many px to scroll for a pointer at `y` in a box spanning `top`..`bottom`: negative up,
// positive down, 0 away from both edges.
export function scrollStep(y: number, top: number, bottom: number): number {
  const edge = Math.min(SCROLL_EDGE, (bottom - top) / 2);
  if (y < top + edge) return -Math.ceil((SCROLL_MAX * Math.min(top + edge - y, edge)) / edge);
  if (y > bottom - edge)
    return Math.ceil((SCROLL_MAX * Math.min(y - (bottom - edge), edge)) / edge);
  return 0;
}

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
  let last = { x: startX, y: startY };
  let frame = 0;
  const mark = () => {
    drag.items().forEach((item, i) => {
      item.classList.toggle('sort-source', active && i === drag.from);
      item.classList.toggle('sort-over', active && i === target && i !== drag.from);
    });
  };
  // The row under the pointer takes the drop (a tall row from its top edge on, #1399).
  const retarget = () => {
    const at = hitIndex(
      drag.items().map(item => item.getBoundingClientRect()),
      last.x,
      last.y,
    );
    target = at < 0 ? drag.from : at;
    mark();
  };
  // While the pointer rests near an edge of the scrolling box, scroll it a step per frame and
  // look again at what lies under the pointer (it does not move, the rows do).
  const scroller = scrollParent(drag.items()[drag.from] ?? handle);
  const tick = () => {
    frame = 0;
    if (!active || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const step = scrollStep(last.y, box.top, box.bottom);
    if (step) {
      const before = scroller.scrollTop;
      scroller.scrollTop += step;
      if (scroller.scrollTop !== before) retarget();
      frame = requestAnimationFrame(tick);
    }
  };
  const move = (e: PointerEvent) => {
    if (!active && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_START) return;
    active = true;
    last = { x: e.clientX, y: e.clientY };
    retarget();
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const finish = (commit: boolean) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
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
