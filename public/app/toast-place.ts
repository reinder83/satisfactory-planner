// Keeps the #toast strip off the control it is about (#663) and out from behind a phone's
// on-screen keyboard (#731). The strip sits at the bottom of the window. It moves to the top
// instead when a toast shows while the focused field or button lies under it (a refused
// factory-group rate at 375 px, its field scrolled to the bottom), so what was typed stays
// readable beside the reason it was refused. At phone width (the stylesheet's 720px
// breakpoint) or on a touch screen it also moves up whenever a form field has focus, whatever
// its place: the keyboard that field opened covers the bottom of the screen, and a strip
// positioned against the window would show behind it. A phone held sideways or a tablet is
// wider than 720px but has that keyboard too (#803). At the top it covers the top bar or edit
// bar for the few seconds it shows, which the owner chose over measuring the keyboard (#731).
// `data-place="top"` carries that (style.css), since toast() in api.ts sets the className.

// The focusable controls a toast can be about. A focused page heading or <main> (after a
// page change) is a whole region, which any placement would overlap.
const CONTROL = 'input, select, textarea, button, [contenteditable="true"]';

// The form fields that open an on-screen keyboard or picker on a phone: not a button, and not
// an input drawn as a box or button (a tick, a slider), for which nothing slides up.
const FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], ' +
  '[type="button"], [type="submit"], [type="reset"], [type="image"]), ' +
  'select, textarea, [contenteditable="true"]';

// The screens with an on-screen keyboard: the phone layout, as in style.css, and any screen
// whose main pointer is a finger, such as a phone held sideways or a tablet (#803). Only the
// keyboard rule reads this; the toast's width and gutters stay on the 720px breakpoint.
const KEYBOARD = '(max-width: 720px), (pointer: coarse)';

// Whether two boxes on screen share any area.
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Whether a focused form field on a phone or tablet may have its keyboard up.
const keyboardMayShow = (focused: HTMLElement) =>
  focused.matches(FIELD) && globalThis.matchMedia?.(KEYBOARD).matches === true;

// Puts a toast that has just been shown at the bottom, or at the top when the focused control
// is under it there or, on a phone or tablet, is a form field. A hidden toast takes the bottom again.
export function placeToast(el: HTMLElement) {
  delete el.dataset.place;
  if (!el.classList.contains('show')) return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.matches(CONTROL) || el.contains(focused))
    return;
  if (
    keyboardMayShow(focused) ||
    overlaps(el.getBoundingClientRect(), focused.getBoundingClientRect())
  )
    el.dataset.place = 'top';
}

// Places the toast each time toast() shows or hides it. The observer runs before the next
// paint, so the strip never flashes over the field first.
export function watchToast(el: HTMLElement) {
  new MutationObserver(() => placeToast(el)).observe(el, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

// How much of two boxes on screen overlaps, in square pixels.
const overlapArea = (a: DOMRect, b: DOMRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// Keeps a toast that is showing off `subject`, the part of the page it is about when that is not
// the focused control: a notes box's conflict notice, which appears just after the toast about
// it (note-draft.ts, #1052). At 390 px the strip at the bottom covered the notice's choices for
// as long as it showed. Over it at the bottom, the toast goes to the top, unless it would cover
// more of the notice there. A toast already at the top stays there.
export function keepToastOff(subject: Element) {
  const el = document.getElementById('toast');
  if (!el?.classList.contains('show') || el.dataset.place === 'top') return;
  const covered = () => overlapArea(el.getBoundingClientRect(), subject.getBoundingClientRect());
  const atBottom = covered();
  if (!atBottom) return;
  el.dataset.place = 'top';
  if (covered() > atBottom) delete el.dataset.place;
}
