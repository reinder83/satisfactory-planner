// Keeps the #toast strip off the control it is about (#663) and out from behind a phone's
// on-screen keyboard (#731). The strip sits at the bottom of the window. It moves to the top
// instead when a toast shows while the focused field or button lies under it (a refused
// factory-group rate at 375 px, its field scrolled to the bottom), so what was typed stays
// readable beside the reason it was refused. At phone width (the stylesheet's 720px
// breakpoint) it also moves up whenever a form field has focus, whatever its place: the
// keyboard that field opened covers the bottom of the screen, and a strip positioned against
// the window would show behind it. At the top it covers the top bar or edit bar for the few
// seconds it shows, which the owner chose over measuring the keyboard (#731).
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

// The phone layout, as in style.css.
const PHONE = '(max-width: 720px)';

// Whether two boxes on screen share any area.
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Whether a focused form field on a phone may have its keyboard up.
const keyboardMayShow = (focused: HTMLElement) =>
  focused.matches(FIELD) && globalThis.matchMedia?.(PHONE).matches === true;

// Puts a toast that has just been shown at the bottom, or at the top when the focused control
// is under it there or, on a phone, is a form field. A hidden toast takes the bottom again.
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
