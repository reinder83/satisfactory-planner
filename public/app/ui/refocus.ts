// Where focus goes after a confirmed removal (#286). The control that asked goes with the row it
// removes, so the confirmation (ui/confirm.ts) cannot give focus back to it and focus would fall
// to <body>: the next Tab would start again at "Skip to planner". One rule for every list:
// focus the same control in the row that takes the removed row's place, else in the nearest
// row before it, else the first fallback on the page (the list's "Add…" control or its tabs),
// else <main>.
//
// Call refocusAfterRemoval() before asking, while the trigger is still in its row, and call the
// function it returns only once the removal is saved and redrawn (after render() or boot()): a
// declined or failed removal never calls it, so focus stays on the trigger the confirmation gave
// it back to. It waits for the redraw (nextTick) and then moves focus only when it was lost: on
// <body>, or still on the trigger's element, which Vue may have reused for another control (the
// floor's Remove becomes the next floor's Hide). Focus the user moved elsewhere is left alone.
import { nextTick } from 'vue';

export interface RefocusOptions {
  // The list's rows, as a selector for the whole page ('.task', '.profile-card').
  row?: string;
  // The control to focus inside a row: the trigger's counterpart in its neighbour.
  control?: string;
  // Tried in order when no row is left, or for a removal with no rows (a floor).
  fallback?: string[];
}

export function refocusAfterRemoval(
  trigger: EventTarget | null,
  { row, control, fallback = [] }: RefocusOptions,
): () => Promise<void> {
  const rows = row ? [...document.querySelectorAll(row)] : [];
  const at = trigger instanceof Node ? rows.findIndex(r => r.contains(trigger)) : -1;
  return async () => {
    await nextTick();
    const current = document.activeElement;
    if (current && current !== document.body && current !== trigger && current.isConnected) return;
    const now = row ? [...document.querySelectorAll(row)] : [];
    // The row now in the removed one's place and those after it, then the rows before it.
    const order = at < 0 ? [] : [...now.slice(at), ...now.slice(0, at).reverse()];
    const inRows = control
      ? order.map(r => r.querySelector<HTMLElement>(control)).find(el => el)
      : undefined;
    const target =
      inRows ??
      [...fallback, '#main'].map(s => document.querySelector<HTMLElement>(s)).find(el => el);
    target?.focus();
  };
}
