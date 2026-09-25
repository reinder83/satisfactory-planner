// The page-wide listeners that belong to no component: broken item artwork, the hash route,
// a click on the dialog's backdrop and the close-tab warning. The controls several
// components share (checkboxes, notes, factory links, the dialog's ×, "Create a save") are
// bound in the components themselves, with the handlers in ui/actions.js.

// Registration order: app.js imports this module, and tests/ui/app-modules.test.mjs pins
// the order. In order: image error (capture), hashchange, #detail backdrop click,
// beforeunload.
import { pending } from './api.js';
import { $ } from './format.ts';
import { setQuery, setView, state } from './session.js';
import { render } from './shell.js';
import { closeDetail } from './ui/actions.js';

// Custom container names may have no bundled artwork; keep the tile without a broken-image glyph.
// Registered for the capture phase (the final true), since error events do not bubble.
document.addEventListener(
  'error',
  e => {
    const t = e.target;
    if (t?.tagName === 'IMG' && t.classList?.contains('item-icon')) t.style.visibility = 'hidden';
  },
  true,
);

// The address hash is the page: sidebar links and navigate() in api.js both land here.
// An unknown hash shows the plan. Clears the search and scrolls to the top; before the
// first load (no state) nothing is drawn. Unsaved notes are not checked here.
window.addEventListener('hashchange', () => {
  setView(
    [
      'plan',
      'factories',
      'storage',
      'resources',
      'backup',
      'profiles',
      'wizard',
      'account',
    ].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'plan',
  );
  setQuery('');
  if (state) render();
  window.scrollTo(0, 0);
});

// A click on the dialog's backdrop (the <dialog> element itself, not its content)
// closes the detail dialog.
$('#detail').addEventListener('click', e => {
  if (e.target === $('#detail')) closeDetail();
});

// Ask before closing or reloading the tab while a save is still in flight (pending in
// api.js). Unsaved note edits are not covered.
window.addEventListener('beforeunload', e => {
  if (pending) {
    e.preventDefault();
    e.returnValue = '';
  }
});
