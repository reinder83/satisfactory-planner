// The page-wide listeners that belong to no component: broken item artwork, the hash route
// (with the history's scroll restoration), a click on the dialog's backdrop, the close-tab
// warning and the toast's placement. The controls several
// components share (checkboxes, notes, factory links, the dialog's ×, "Create a save") are
// bound in the components themselves, with the handlers in ui/actions.ts.

// Registration order: app.ts imports this module, and tests/ui/app-modules.test.ts pins
// the order. In order: image error (capture), hashchange, #detail backdrop click, #detail
// cancel (Escape), beforeunload, wizard input and change (capture), visibilitychange, focus,
// keydown (the toast's Ctrl+Z).
import {
  acceptRoute,
  flushNotes,
  hasUnsavedChoices,
  hasUnsavedNotes,
  pending,
  refreshState,
  refreshWorkspace,
  toastShortcut,
} from './api.ts';
import { required } from './format.ts';
import { onBackdropClick } from './backdrop.ts';
import { setQuery, setView, stateLoaded, viewOf } from './session.ts';
import { render } from './shell.ts';
import { watchToast } from './toast-place.ts';
import { cancelDetail, closeDetail } from './ui/actions.ts';
import { refocusAfterRefresh } from './ui/refocus.ts';
import { noteWizardEdit } from './wizard/wizard.ts';

// Custom container names may have no bundled artwork; keep the tile without a broken-image glyph.
// Registered for the capture phase (the final true), since error events do not bubble.
document.addEventListener(
  'error',
  event => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.classList.contains('item-icon'))
      target.style.visibility = 'hidden';
  },
  true,
);

// The address hash is the page: sidebar links and navigate() in api.ts both land here.
// An unknown hash shows the plan. Clears the search and scrolls to the top; before the
// first load (no state) nothing is drawn. Unsaved notes are asked about first (acceptRoute),
// and when the user keeps them the page stays as it is. The scroll comes before the redraw, so
// the new page starts at its top unless render() brings something else into view: a group's
// "Build order →" or a step's "Open factory: <name> →" on the way back from its flow page (#917,
// #1047, focusOpenedPage in ui/refocus.ts).
window.addEventListener('hashchange', () => {
  if (!acceptRoute()) return;
  setView(viewOf(location.hash.slice(1)));
  setQuery('');
  window.scrollTo(0, 0);
  if (stateLoaded) render();
});

// Back and Forward start the page at its top too (#925). Left to the browser ('auto'), Chrome
// restores the history entry's scroll after the listener above has run, while the page is still
// being drawn: with focus kept on a sidebar link the page opened part way down, not even where
// the user had left it. A browser without the setting keeps its own behaviour.
const browserHistory: History | undefined = globalThis.history;
if (browserHistory && 'scrollRestoration' in browserHistory)
  browserHistory.scrollRestoration = 'manual';

// A click on the dialog's backdrop (outside the dialog's box, pressed there too) closes the
// detail dialog.
onBackdropClick(required('#detail'), closeDetail);

// Escape closes the dialog natively; cancelDetail asks about an unsaved note first.
required('#detail').addEventListener('cancel', cancelDetail);

// Ask before closing or reloading the tab while a save is still in flight (pending in
// api.ts), a notes box holds unsaved text, or a "Made on site" choice (#930) or a step's edit
// form (#969) is not saved (hasUnsavedChoices; only their Save stores them, so nothing is sent
// here). A note still waiting
// for its pause in typing is sent first, so staying on the page lets it finish.
window.addEventListener('beforeunload', event => {
  flushNotes();
  if (pending || hasUnsavedNotes() || hasUnsavedChoices()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// A value typed or chosen on any wizard screen (guided, the five steps, the survey) marks the
// draft as edited, so Cancel asks before dropping it (cancelWizard in wizard/wizard.ts).
// Capture, so it sees the event whatever the screen's own handlers do with it.
for (const type of ['input', 'change'])
  document.addEventListener(
    type,
    event => {
      if ((event.target as Element | null)?.closest?.('#wizard-form')) noteWizardEdit();
    },
    true,
  );

// Coming back to this tab: pick up changes another tab or device saved meanwhile, so the
// page does not show, or write from, an old copy (#165). A failed refresh changes nothing.
// When the redraw takes away the control that had focus (a step ticked elsewhere moves to
// "Done"), focus goes to the page's heading rather than to <body> (#809), as after a refused write.
// It also asks where the user's other tabs and devices are, so a tab left on a profile the
// others have moved away from says so (refreshWorkspace, #1052).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const refocus = refocusAfterRefresh(document.activeElement);
  refreshState()
    .then(changed => (changed ? refocus() : undefined))
    .catch(() => {});
  refreshWorkspace().catch(() => {});
});

// Coming back to this window from another one (the game, another browser window), which fires no
// visibilitychange when the tab stayed visible beside it: the same check of where the others are.
window.addEventListener('focus', () => {
  refreshWorkspace().catch(() => {});
});

// Ctrl+Z (⌘Z) presses the button of a toast that offers one, such as Undo after a tick (#1054).
document.addEventListener('keydown', toastShortcut);

// A toast that would cover the focused control it is about goes to the top (#663).
watchToast(required('#toast'));
