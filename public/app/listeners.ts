// The page-wide listeners that belong to no component: broken item artwork, the hash route,
// a click on the dialog's backdrop and the close-tab warning. The controls several
// components share (checkboxes, notes, factory links, the dialog's ×, "Create a save") are
// bound in the components themselves, with the handlers in ui/actions.ts.

// Registration order: app.ts imports this module, and tests/ui/app-modules.test.ts pins
// the order. In order: image error (capture), hashchange, #detail backdrop click, #detail
// cancel (Escape), beforeunload, wizard input and change (capture), visibilitychange.
import { acceptRoute, hasUnsavedNotes, pending, refreshState } from './api.ts';
import { required } from './format.ts';
import { onBackdropClick } from './backdrop.ts';
import { setQuery, setView, stateLoaded, viewOf } from './session.ts';
import { render } from './shell.ts';
import { cancelDetail, closeDetail } from './ui/actions.ts';
import { noteWizardEdit } from './wizard/wizard.ts';

// Custom container names may have no bundled artwork; keep the tile without a broken-image glyph.
// Registered for the capture phase (the final true), since error events do not bubble.
document.addEventListener(
  'error',
  e => {
    const t = e.target;
    if (t instanceof HTMLImageElement && t.classList.contains('item-icon'))
      t.style.visibility = 'hidden';
  },
  true,
);

// The address hash is the page: sidebar links and navigate() in api.ts both land here.
// An unknown hash shows the plan. Clears the search and scrolls to the top; before the
// first load (no state) nothing is drawn. Unsaved notes are asked about first (acceptRoute),
// and when the user keeps them the page stays as it is.
window.addEventListener('hashchange', () => {
  if (!acceptRoute()) return;
  setView(viewOf(location.hash.slice(1)));
  setQuery('');
  if (stateLoaded) render();
  window.scrollTo(0, 0);
});

// A click on the dialog's backdrop (outside the dialog's box, pressed there too) closes the
// detail dialog.
onBackdropClick(required('#detail'), closeDetail);

// Escape closes the dialog natively; cancelDetail asks about an unsaved note first.
required('#detail').addEventListener('cancel', cancelDetail);

// Ask before closing or reloading the tab while a save is still in flight (pending in
// api.ts) or a notes box holds unsaved text.
window.addEventListener('beforeunload', e => {
  if (pending || hasUnsavedNotes()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// A value typed or chosen on any wizard screen (guided, the five steps, the survey) marks the
// draft as edited, so Cancel asks before dropping it (cancelWizard in wizard/wizard.ts).
// Capture, so it sees the event whatever the screen's own handlers do with it.
for (const type of ['input', 'change'])
  document.addEventListener(
    type,
    e => {
      if ((e.target as Element | null)?.closest?.('#wizard-form')) noteWizardEdit();
    },
    true,
  );

// Coming back to this tab: pick up changes another tab or device saved meanwhile, so the
// page does not show, or write from, an old copy (#165). A failed refresh changes nothing.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshState().catch(() => {});
});
