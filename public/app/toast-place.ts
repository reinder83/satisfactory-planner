// Keeps the #toast strip off the control it is about (#663). The strip sits at the bottom of
// the window; when a toast shows while the focused field or button lies under it (a refused
// factory-group rate at 375 px, its field scrolled to the bottom), it moves to the top
// instead, so what was typed stays readable beside the reason it was refused.
// `data-place="top"` carries that (style.css), since toast() in api.ts sets the className.

// The focusable controls a toast can be about. A focused page heading or <main> (after a
// page change) is a whole region, which any placement would overlap.
const CONTROL = 'input, select, textarea, button, [contenteditable="true"]';

// Whether two boxes on screen share any area.
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Puts a toast that has just been shown at the bottom, or at the top when the focused control
// is under it there. A hidden toast takes the bottom again.
export function placeToast(el: HTMLElement) {
  delete el.dataset.place;
  if (!el.classList.contains('show')) return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.matches(CONTROL) || el.contains(focused))
    return;
  if (overlaps(el.getBoundingClientRect(), focused.getBoundingClientRect()))
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
