// Where focus goes when the control that was pressed leaves the page: after a confirmed removal
// (#286), and after an action without a confirmation whose button goes with its row or makes way
// for another control (#290: Restore, a container's ✕, Mute). Focus would fall to <body>, where
// nothing shows a focus ring and a screen reader loses its place. One rule for every list: focus
// the same control in the row that takes the removed row's place, else in the nearest row before
// it, else the first fallback on the page (the list's "Add…" control or its tabs, or the control
// that took the trigger's place), else <main>.
//
// Call refocusAfterRemoval() before asking or saving, while the trigger is still in its row, and
// call the function it returns only once the change is saved and redrawn (after render(),
// invalidate() or boot()): a declined or failed removal never calls it, so focus stays on the
// trigger the confirmation gave it back to. It waits for the redraw (nextTick) and then moves focus
// only when it was lost: on <body>, or still on the trigger's element, which Vue may have reused
// for another control (the floor's Remove becomes the next floor's Hide). Focus the user moved
// elsewhere is left alone.
import { nextTick } from 'vue';

export interface RefocusOptions {
  // The list's rows, as a selector for the whole page ('.task', '.profile-card'), or for `scope`.
  row?: string;
  // The control to focus inside a row: the trigger's counterpart in its neighbour. Without one
  // the row itself is focused (rows that are buttons, such as a factory's ✕ per group).
  control?: string;
  // Tried in order when no row is left, or for a change with no rows (a floor, a toggle).
  fallback?: string[];
  // Rows are looked up inside this element (one bay, one factory card's group editor) while it is
  // still on the page, else in the whole page; so are the fallbacks, all inside it first.
  scope?: Element | null;
}

export function refocusAfterRemoval(
  trigger: EventTarget | null,
  { row, control, fallback = [], scope }: RefocusOptions,
): () => Promise<void> {
  const within = (): ParentNode => (scope?.isConnected ? scope : document);
  const rows = row ? [...within().querySelectorAll(row)] : [];
  const at = trigger instanceof Node ? rows.findIndex(r => r.contains(trigger)) : -1;
  return async () => {
    await nextTick();
    const current = document.activeElement;
    if (current && current !== document.body && current !== trigger && current.isConnected) return;
    const now = row ? [...within().querySelectorAll(row)] : [];
    // The row now in the removed one's place and those after it, then the rows before it.
    const order = at < 0 ? [] : [...now.slice(at), ...now.slice(0, at).reverse()];
    const inRows = order
      .map(r => (control ? r.querySelector<HTMLElement>(control) : (r as HTMLElement)))
      .find(el => el);
    const first = (root: ParentNode) =>
      fallback.map(s => root.querySelector<HTMLElement>(s)).find(el => el);
    const target =
      inRows ?? first(within()) ?? first(document) ?? document.querySelector<HTMLElement>('#main');
    target?.focus();
  };
}
