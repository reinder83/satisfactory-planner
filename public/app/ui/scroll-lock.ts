// The page behind a modal dialog does not scroll (#1325). style.css hides the page's scrollbar
// while any <dialog> is open (html:has(dialog[open])), and keeps its width (scrollbar-gutter:
// stable) so nothing shifts sideways: the sidebar and every column stay where they were, and
// the page, laid out at the same width all the way through the close, keeps its scroll position
// (#1330: padding standing in for the scrollbar was dropped a moment before the scrollbar came
// back, and a page opened at its very bottom jumped up by the height that the wider layout
// saved). A page with no scrollbar has none to keep, and a gutter would push it 15px left, so
// this notes whether the page has one in --scroll-gutter, which the rule reads. Call it just
// before showModal(). A second modal over the first (the confirmation over #detail) finds the
// scrollbar already gone, so what was noted for the first one is kept.
export function reserveScrollbar() {
  if (document.querySelector('dialog[open]')) return;
  const root = document.documentElement;
  const hasScrollbar = window.innerWidth - root.clientWidth > 0;
  root.style.setProperty('--scroll-gutter', hasScrollbar ? 'stable' : 'auto');
}
