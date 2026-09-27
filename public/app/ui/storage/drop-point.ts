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
