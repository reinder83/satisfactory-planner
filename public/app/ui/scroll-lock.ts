// The page behind a modal dialog does not scroll (#1325). style.css hides the page's scrollbar
// while any <dialog> is open (html:has(dialog[open])), which would widen the page by the
// scrollbar's width and shift the sidebar and every column; this notes that width in
// --scrollbar-width first, and the same rule pads the page by it. Call it just before
// showModal(). A second modal over the first (the confirmation over #detail) finds the
// scrollbar already gone, so the width noted for the first one is kept.
export function reserveScrollbar() {
  if (document.querySelector('dialog[open]')) return;
  const root = document.documentElement;
  const width = Math.max(0, window.innerWidth - root.clientWidth);
  root.style.setProperty('--scrollbar-width', width + 'px');
}
