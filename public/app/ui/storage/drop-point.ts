// Where a storage container drag may land (#298): only on the position the pointer is over. A drop
// released anywhere else puts the card back and saves nothing.
//
// dnd-kit's default collision detection falls back to the dragged card's shape when the pointer is
// over no position, so a card let go in the aisle or beside a bay was dropped on whichever position
// the card overlapped. A pointer that left the window still hit the positions below or beside it
// that are out of sight. And while the page auto-scrolls under a pointer that has stopped, dnd-kit
// keeps the target it found at the pointer's last move, so a drop there was saved to a position
// that had since scrolled away: G02 swapped with C05, a bay the pointer never reached.
import { pointerIntersection } from '@dnd-kit/collision';
import type { DragDropManager } from '@dnd-kit/vue';

// The part of a drag operation these checks read.
export interface DropOperation {
  readonly activatorEvent: Event | null;
  readonly position: { readonly current: { readonly x: number; readonly y: number } };
}

// Whether the drag's point is where the user can see it: inside the window for a mouse, pen or
// finger. The keyboard's point is the moved card's centre; a keyboard drag does not auto-scroll,
// so it is not held to the window.
export function inView({ activatorEvent, position }: DropOperation): boolean {
  if (activatorEvent instanceof KeyboardEvent) return true;
  const { x, y } = position.current;
  return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
}

// The drop targets' collision detector (ui/storage/SlotCell.vue): a position is the target only
// while the pointer (for a keyboard drag, the moved card's centre) is inside it, in the window.
export const pointerOnly: typeof pointerIntersection = input =>
  inView(input.dragOperation) ? pointerIntersection(input) : null;

// Keeps the drop target on the position under the pointer while the page scrolls during a drag
// (#303): an auto-scroll under a pointer held still, or the mouse wheel. dnd-kit 0.5 works the
// target out again only when the pointer moves or a position's stored box changes; it updates
// those boxes up to 75 ms late, and skips the check when the pointer has not moved. So the
// highlight stayed on a position that had scrolled away, and the one under the pointer had none,
// until the pointer moved. Called at the start of a drag (StoragePage.vue); from then until the
// drag ends, each frame with a scroll measures the positions again and redoes the check.
export function followScroll(manager: DragDropManager): void {
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const { source } = manager.dragOperation;
    for (const droppable of manager.registry.droppables)
      if (!droppable.disabled && (!source || droppable.accepts(source))) droppable.refreshShape();
    manager.collisionObserver.forceUpdate();
  };
  const scrolled = () => {
    frame ||= requestAnimationFrame(refresh);
  };
  // Capturing on the document also catches a scrolling element, whose scroll event does not bubble.
  const options = { capture: true, passive: true };
  document.addEventListener('scroll', scrolled, options);
  const stop = manager.monitor.addEventListener('dragend', () => {
    document.removeEventListener('scroll', scrolled, options);
    cancelAnimationFrame(frame);
    stop();
  });
}

// Whether a finished drop is on the position dnd-kit named, as the page is drawn at the release:
// the release point inside that position's box, and in the window.
export function landsOnTarget(
  operation: DropOperation & { readonly target: { readonly element?: Element } | null },
): boolean {
  const element = operation.target?.element;
  if (!element || !inView(operation)) return false;
  const { x, y } = operation.position.current;
  const box = element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}
