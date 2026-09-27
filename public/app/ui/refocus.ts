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

// Where focus goes when an action opens another page or another profile and its control goes
// with the page it was on (#304): Open profile, Duplicate, the wizard's Create profile and
// Cancel, New profile, All settings and Guided start, Round up production and Recalculate with
// transport fuel (#300). One rule for all of them: the new page's heading (PageHeader's h1,
// tabindex="-1"), which a screen reader reads out and where the next Tab starts, else <main>.
// Focus that is still somewhere on the page is left alone, so a sidebar link keeps focus after
// it is clicked, as it always has: the frame stays, and the user may want the next link.
const lost = (trigger?: EventTarget | null) => {
  const current = document.activeElement;
  return !current || current === document.body || current === trigger || !current.isConnected;
};

// The new page starts at its top, as a route change does (the hashchange listener in
// listeners.ts): focus() alone would scroll only as far as the heading's own edge, cutting off
// the line above it, and a screen change inside #wizard has no route change to scroll it.
function focusHeading() {
  const target =
    document.querySelector<HTMLElement>('#main h1') ?? document.querySelector<HTMLElement>('#main');
  target?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// For render() in shell.ts, right after a page took the place of another: focus the heading
// when focus went with the old page. Every page change passes here, whatever started it (a
// button's navigate(), a link inside the page, Back), so no handler needs its own call.
export function focusOpenedPage() {
  if (lost()) focusHeading();
}

// For an action that opens another profile on the page already shown (Round up production,
// Recalculate with transport fuel): the page is redrawn rather than replaced, so its button
// just disappears. Call it before the work, like refocusAfterRemoval(), and the function it
// returns after the redraw; that focuses the heading once the redraw has landed, when focus was
// lost (on <body>, or still on the trigger's element).
export function refocusOnOpenedPage(trigger: EventTarget | null): () => Promise<void> {
  return async () => {
    await nextTick();
    if (lost(trigger)) focusHeading();
  };
}
