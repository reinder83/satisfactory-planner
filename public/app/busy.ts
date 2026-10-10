// A control stays focusable while its work runs (#299). A browser moves focus off a focused
// control the moment it becomes disabled: Edge and Chrome put it on <body>, where nothing shows a
// focus ring and a screen reader loses its place, and it stays there once the control is enabled
// again. So a busy control is never `disabled`: it gets aria-disabled="true" instead (announced
// as unavailable, and dimmed like a disabled one by style.css, with the wait cursor), a text
// field is also read-only, and a click on it is swallowed until the work is done, so a second
// press cannot send the same change twice (a checkbox is not ticked, a button's handler does not
// run, a form is not submitted by its busy button or by Enter in one of its fields).
//
// Two forms, one rule:
// - whileBusy(el, work) for a control its handler marks itself (an @change on a checkbox, select
//   or field, a button that shows a calculation's progress). A handler that asks or reads
//   something before it starts the work checks isBusy(el) first, as does one on a select, whose
//   value a key can still change: it puts the saved value back.
// - A busy flag in a ref, bound as :aria-disabled="flag || undefined" (never as :disabled), for a
//   control the template already draws from state; its handler returns while the flag is set.
// A control that stays disabled because of what it did (a completed room, the first bay's Move
// left) sends focus on with refocusAfterRemoval() from ui/refocus.ts, as a removed one does.
// This is a plain module, so the wizard's calculation (wizard/wizard.ts) uses it too.

export const isBusy = (el: EventTarget | null): boolean =>
  el instanceof Element && el.getAttribute('aria-disabled') === 'true';

// A click on a busy control does nothing: no default action and no other listener on it.
// Capture, so it runs before the component's own.
function swallowClick(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

const typedField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type));

// Whether a field marked busy was read-only already, so it stays so afterwards.
const readOnlyBefore = new WeakMap<Element, boolean>();

// Marks `el` busy (on) or ready again (off).
export function markBusy(el: HTMLElement, busy: boolean) {
  if (busy === isBusy(el)) return;
  if (busy) {
    el.setAttribute('aria-disabled', 'true');
    el.addEventListener('click', swallowClick, true);
  } else {
    el.removeAttribute('aria-disabled');
    el.removeEventListener('click', swallowClick, true);
  }
  if (typedField(el)) {
    if (busy) readOnlyBefore.set(el, el.readOnly);
    el.readOnly = busy || !!readOnlyBefore.get(el);
  }
}

// Runs `work` with `el` busy and returns what it returns (or throws what it throws). A control
// that is busy already runs nothing and resolves undefined.
export async function whileBusy<T>(
  el: HTMLElement,
  work: () => Promise<T>,
): Promise<T | undefined> {
  if (isBusy(el)) return undefined;
  markBusy(el, true);
  try {
    return await work();
  } finally {
    markBusy(el, false);
  }
}
