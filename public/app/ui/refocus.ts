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
  // What identifies a row across redraws (a build-plan step's checklist key). With it, the
  // removed row's place is found again by its neighbours when the change lands, not by its
  // position: other rows may have left the list in the meantime, as a step ticked just before
  // whose save landed first does (#822).
  key?: (row: Element) => string | undefined;
}

export function refocusAfterRemoval(
  trigger: EventTarget | null,
  { row, control, fallback = [], scope, key }: RefocusOptions,
): () => Promise<void> {
  const within = (): ParentNode => (scope?.isConnected ? scope : document);
  const rows = row ? [...within().querySelectorAll(row)] : [];
  const at = trigger instanceof Node ? rows.findIndex(r => r.contains(trigger)) : -1;
  const neighbours = key && at >= 0 ? neighbourKeys(rows, at, key) : null;
  return async () => {
    await nextTick();
    const current = document.activeElement;
    if (current && current !== document.body && current !== trigger && current.isConnected) return;
    const now = row ? [...within().querySelectorAll(row)] : [];
    // The row now in the removed one's place and those after it, then the rows before it.
    const byPlace = at < 0 ? [] : [...now.slice(at), ...now.slice(0, at).reverse()];
    const byNeighbour = neighbours && key ? rowsByKey(now, neighbours, key) : [];
    const order = byNeighbour.length ? byNeighbour : byPlace;
    const inRows = order
      .map(r => (control ? r.querySelector<HTMLElement>(control) : (r as HTMLElement)))
      .find(el => el);
    const first = (root: ParentNode) =>
      fallback.map(selector => root.querySelector<HTMLElement>(selector)).find(el => el);
    const target =
      inRows ?? first(within()) ?? first(document) ?? document.querySelector<HTMLElement>('#main');
    target?.focus();
  };
}

// The keys of the rows after the removed one, nearest first, then of the rows before it,
// nearest first: the order refocusAfterRemoval() tries them in.
function neighbourKeys(rows: Element[], at: number, key: (row: Element) => string | undefined) {
  return [...rows.slice(at + 1), ...rows.slice(0, at).reverse()]
    .map(key)
    .filter((id): id is string => !!id);
}

// The rows still listed whose keys are among `keys`, in the order of `keys`.
function rowsByKey(rows: Element[], keys: string[], key: (row: Element) => string | undefined) {
  const byKey = new Map(rows.map(r => [key(r), r]));
  return keys.map(id => byKey.get(id)).filter((r): r is Element => !!r);
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

// For the wizard's five steps and the guided start (#608): Continue and Back replace the screen's
// form, so the pressed button goes with it. Focus goes to the new screen's heading
// (ui/form/StepHeading.vue, tabindex="-1"), whose name says which step it is, and only when focus
// was lost: a step tab stays on the page and keeps it. The screen starts at the top of the page,
// as a new page does; where that leaves the heading below the window, or under the estimate's
// bar at the foot of a phone's screen (#449), the step indicator above the form comes to the top
// instead, with the heading under it.
export function focusNewStep() {
  if (!lost()) return;
  const heading = document.querySelector<HTMLElement>('#wizard-form [data-step-heading]');
  if (!heading) return;
  heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (inView(heading)) return;
  document
    .querySelector<HTMLElement>('#main .wizard-progress, #main .guided-stepper')
    ?.scrollIntoView({ block: 'start' });
  if (!inView(heading)) heading.scrollIntoView({ block: 'start' });
}

// Whether all of `el` shows in the window, above the estimate's bar when there is one.
function inView(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  const bar = document.querySelector('[data-estimate-peek]')?.getBoundingClientRect().height ?? 0;
  return box.top >= 0 && box.bottom <= window.innerHeight - bar;
}

// For the factories pages' jump bar (SP-17, #252): the same move within a page. The section
// comes to the top of the window (its scroll-margin keeps a gap above it) and its heading takes
// focus, which a screen reader reads out and where the next Tab starts: the h2 (tabindex="-1",
// the ring after a key press only, like the page's h1), or the group's name field in its place
// while groups are edited.
export function focusSection(section: HTMLElement) {
  const target = section.querySelector<HTMLElement>('[data-section-heading]') ?? section;
  target.focus({ preventScroll: true });
  section.scrollIntoView({ block: 'start' });
}

// For render() in shell.ts, right after a page took the place of another: focus the heading
// when focus went with the old page. Every page change passes here, whatever started it (a
// button's navigate(), a link inside the page, Back), so no handler needs its own call.
export function focusOpenedPage() {
  if (lost()) focusHeading();
}

// For a control that swaps its row for another view of it and back: a build-plan step's Edit
// opens its form in the step's place, and the form's Cancel and Save step put the step back
// (#562). The pressed control goes with the redraw, so focus goes to the named control of the
// view that took its place (the form's Step title field, the step's Edit). Call it before the
// work, like refocusAfterRemoval(), and the function it returns after the redraw; that moves
// focus only when it was lost (on <body>, or still on the trigger's element).
export function refocusOn(trigger: EventTarget | null, selector: string): () => Promise<void> {
  return async () => {
    await nextTick();
    if (lost(trigger)) document.querySelector<HTMLElement>(selector)?.focus();
  };
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

// For a write refused after another tab or device changed the profile (queuedWrite in api.ts,
// #722): the page is redrawn from the saved state, and the control that was pressed may go with
// it (a Remove on a bay that is already gone, a Restore on a letter that another bay took). Call
// it before the reload with the control that had focus, and the function it returns after the
// redraw; that focuses the page's heading, without scrolling, only when the redraw took focus
// away (on <body>, or the element left the page). Focus that was nowhere stays nowhere, and a
// control that is still there keeps it, also when Vue patched it in place.
export function refocusAfterRefresh(focused: Element | null): () => Promise<void> {
  const had = !!focused && focused !== document.body;
  return async () => {
    await nextTick();
    const current = document.activeElement;
    if (!had || (current && current !== document.body && current.isConnected)) return;
    const target =
      document.querySelector<HTMLElement>('#main h1') ??
      document.querySelector<HTMLElement>('#main');
    target?.focus({ preventScroll: true });
  };
}
