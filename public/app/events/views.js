// Delegated DOM event handlers for the controls several components share (checkboxes, notes,
// dialog links, "Create a save") and for navigation. Every listener sits on document or
// window and dispatches on data-* attributes. Each page's own controls, the wizard's included,
// are handled in its components. Stage 8 of the Vue migration moves these shared ones into
// the components too (see public/AGENTS.md).
// Progress changes go through save() in api.js: it queues the write, toasts a failure
// itself and rejects. The empty `catch {}` blocks below therefore only skip the redraw
// (or put the control back); a success toast never follows a failed write.
// Shared UI state lives in session.js and is changed through its setX() setters.

// Registration order matters where listeners share an event type: app.js imports this
// module, and tests/ui/app-modules.test.mjs pins the order. In order: main page click,
// change, image error (capture), hashchange, #detail backdrop click, beforeunload, then the
// second click listener.
import { pending, save, toast } from '../api.js';
import { openCalculatedFactory, openFactory } from '../factory-detail.js';
import { $ } from '../format.js';
import { setActiveDetail, setQuery, setView, state } from '../session.js';
import { render } from '../shell.js';
import { startWizard } from '../wizard/wizard.js';

// Click 1 of 2: buttons and links on the planner pages.
// Index: dialogs (close, factory), notes. The pages' own controls are handled in their
// components (ui/pages/ and the folders beside it).
// The branches are separate ifs, each keyed on its own attribute.
document.addEventListener('click', async e => {
  const target = e.target.closest('button,a');
  if (!target) return;
  // --- Dialogs ---
  // The × in a detail dialog's header (ui/detail/DialogFrame.vue): close #detail.
  // There is no unsaved-notes check, so an unsaved note edit in the dialog is dropped.
  if (target.hasAttribute('data-close')) {
    $('#detail').close();
    setActiveDetail(null);
  }
  // A handbook factory's name or "Details ↗" link (factory cards, flow diagrams, storage
  // details, other dialogs): open that factory's detail dialog.
  if (target.dataset.factory) openFactory(target.dataset.factory);
  // --- Notes ---
  // "Save notes" under a notes box: phase notes (plan page), save-wide notes (Backup
  // page) and the notes in factory and container dialogs. data-save-note is the notes key
  // and data-input the textarea's id. Inside a dialog a successful save also closes it.
  // There is no redraw: save() has already stored the new state. "Notes saved." only
  // appears after the write succeeded.
  if (target.dataset.saveNote) {
    const noteDialog = target.closest('dialog');
    target.disabled = true;
    try {
      await save({
        type: 'note',
        key: target.dataset.saveNote,
        value: document.getElementById(target.dataset.input).value,
      });
      if (noteDialog?.open && noteDialog.contains(target)) {
        noteDialog.close();
        setActiveDetail(null);
      }
      toast('Notes saved.');
    } catch {
    } finally {
      target.disabled = false;
    }
  }
});

// Change events: the progress checkboxes, which save when ticked.
document.addEventListener('change', async e => {
  const el = e.target;
  // --- Checkmarks ---
  // Any progress checkbox: plan steps, a factory's "Running", calculated rows, storage and
  // commissioning checklists, the factory dialog's target check. A failed write puts the
  // box back.
  if (el.dataset.check) {
    const value = el.checked;
    el.disabled = true;
    try {
      await save({ type: 'check', key: el.dataset.check, value });
      render();
    } catch {
      el.checked = !value;
    } finally {
      el.disabled = false;
    }
  }
});

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
// closes the detail dialog. Being on #detail, it runs before the document listeners.
$('#detail').addEventListener('click', e => {
  if (e.target === $('#detail')) {
    $('#detail').close();
    setActiveDetail(null);
  }
});

// Ask before closing or reloading the tab while a save is still in flight (pending in
// api.js). Unsaved note edits are not covered.
window.addEventListener('beforeunload', e => {
  if (pending) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Click 2 of 2 on document: a new save and the calculated factory dialog.
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  // --- Starting the wizard (startWizard checks for unsaved notes itself) ---
  // "Create a save" on the profiles page, and in the wizard when there is no draft.
  if (b.hasAttribute('data-new-save')) startWizard();
  // --- Dialogs ---
  // A calculated plan's factory name, "Details ↗" or "Open factory" link: its dialog.
  if (b.dataset.calcFactory) openCalculatedFactory(b.dataset.calcFactory);
});
