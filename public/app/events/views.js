// Delegated DOM event handlers: the controls shared by the Vue pages and the pages that are
// still HTML strings redrawn by render() in shell.js (checkboxes, notes, dialog links), the
// wizard, and navigation. Every listener sits on document or window and dispatches on
// data-* attributes, element ids or form ids.
// Progress changes go through save() in api.js: it queues the write, toasts a failure
// itself and rejects. The empty `catch {}` blocks below therefore only skip the redraw
// (or put the control back); a success toast never follows a failed write.
// Shared UI state lives in session.js and is changed through its setX() setters.

// Registration order matters where listeners share an event type: app.js imports this
// module first, and tests/app-modules.test.mjs pins the order. In order: main page
// click, change, search input, supply input, supply keydown, supply
// focusout, image error (capture), hashchange, #detail
// backdrop click, beforeunload, then the wizard submit in profiles.js.
import { navigate, pending, post, save, toast } from '../api.js';
import { openCalculatedFactory, openFactory } from '../factory-detail.js';
import { $, num } from '../format.js';
import {
  setActiveDetail,
  setQuery,
  setView,
  setWizard,
  state,
  wizard,
  workspace,
} from '../session.js';
import { render } from '../shell.js';
import { openExtraction } from '../wizard/extraction.js';
import { moveGuided, readGuidedForm, toAdvanced, toGuided } from '../wizard/guided.js';
import { alternatesUsed, openAltRecipe } from '../wizard/recipes.js';
import {
  hideSupplyOptions,
  pickSupplyOption,
  showSupplyOptions,
  supplyRows,
  syncSupplyIcon,
} from '../wizard/supply.js';
import {
  calcProgress,
  moveWizard,
  readWizard,
  startWizard,
  wizardError,
} from '../wizard/wizard.js';

// Click 1 of 2: buttons and links on the planner pages.
// Index: dialogs (close, factory), notes. The pages' own controls are handled in their
// components (ui/pages/ and the folders beside it).
// The branches are separate ifs, each keyed on its own attribute.
document.addEventListener('click', async e => {
  const target = e.target.closest('button,a');
  if (!target) return;
  // --- Dialogs ---
  // The × in a detail dialog's header (dialog() in factory-detail.js): close #detail.
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

// Change events: checkboxes, selects and fields that save when committed, plus the
// wizard fields that reshape its form.
// Index: progress checkmarks, wizard redraws (settings, guided, existing supply),
// alternate recipe ticks. The node survey handles its own (ui/pages/SurveyPage.vue).
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
  // --- Profile wizard (nothing is saved until the profile is created) ---
  // Settings whose answer changes what the five-step wizard shows: read the form into the
  // wizard and redraw.
  if (['recipes', 'mainPower', 'pureIngots'].includes(el.name) && wizard && $('#wizard-form')) {
    readWizard($('#wizard-form'));
    render();
  }
  // Guided questions: a question's radio (guided:…), a top-up choice or the "what is
  // different" topics. Read the answers and redraw, since they decide what follows.
  if (
    wizard?.mode === 'guided' &&
    $('#wizard-form') &&
    (String(el.name).startsWith('guided:') || el.name === 'topup' || el.name === 'topic')
  ) {
    readGuidedForm($('#wizard-form'));
    render();
  }
  // An existing-supply item or rate, once committed: close the suggestions, read the rows
  // into the settings and redraw.
  if (['supplyItem', 'supplyRate'].includes(el.name) && wizard && $('#wizard-form')) {
    hideSupplyOptions(el);
    wizard.mode === 'guided' ? readGuidedForm($('#wizard-form')) : readWizard($('#wizard-form'));
    render();
  }
  // Ticking an alternate recipe in the picker: update the "· N selected" heading in place,
  // and allow its preference box (altpref) only while it is ticked. No redraw.
  if (el.name === 'alt') {
    const p = el.closest('.alt-picker');
    const head = p?.querySelector('.alt-picker-head b');
    if (head)
      head.textContent = `Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;
    const star = el.closest('.alt-row')?.querySelector('input[name=altpref]');
    if (star) {
      star.disabled = !el.checked;
      if (!el.checked) star.checked = false;
    }
  }
});

// Input events on search and filter boxes, as you type.
document.addEventListener('input', e => {
  // The alternate recipe picker's filter (wizard): hide rows in place, without a redraw.
  if (e.target.id === 'alt-filter') {
    const q = e.target.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('.alt-row'))
      row.hidden = q !== '' && !row.dataset.altText.includes(q);
  }
  // The per-item storage rate filter (wizard): the same, for the rate rows.
  if (e.target.id === 'rate-filter') {
    const q = e.target.value.trim().toLowerCase();
    for (const row of document.querySelectorAll('.rate-row'))
      row.hidden = q !== '' && !row.dataset.rateText.includes(q);
  }
  // Each per-item box shows the rate its group would give it, so editing either
  // group rate has to refresh the placeholders the list is already showing.
  if (['buildRate', 'storageRate'].includes(e.target.name)) refreshRatePlaceholders();
});

// Each per-item rate row shows its group's rate as the placeholder: 0 for delivered
// items, the build rate (or the general rate when empty) for build materials, and the
// general storage rate for the rest.
function refreshRatePlaceholders() {
  const rows = document.querySelectorAll('.rate-row');
  if (!rows.length) return;
  const read = name => {
    const value = document.querySelector('[name=' + name + ']')?.value;
    return value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  };
  const general = read('storageRate'),
    build = read('buildRate') ?? general;
  for (const row of rows) {
    const rate =
      row.dataset.rateGroup === 'delivered'
        ? 0
        : row.dataset.rateGroup === 'build'
          ? build
          : general;
    const input = row.querySelector('input');
    if (input && rate !== null) input.placeholder = num(rate);
  }
}

// The item search: suggestions as you type, with the keyboard alone if you like.
// This and the next two listeners drive the wizard's existing-supply item field
// (wizard/supply.js): input fills the suggestions, keydown walks them, focusout closes.
document.addEventListener('input', e => {
  if (e.target?.name === 'supplyItem' && wizard) {
    syncSupplyIcon(e.target);
    showSupplyOptions(e.target);
  }
});

// Keyboard in the existing-supply item field: ↓ opens or walks the suggestions, ↑ walks
// back, Enter picks the highlighted one (or the first), Escape closes the list.
// Every other field and key is left alone.
document.addEventListener('keydown', e => {
  const input = e.target;
  if (input?.name !== 'supplyItem' || !wizard) return;
  const box = input.closest('.supply-field')?.querySelector('.supply-options');
  const options = box && !box.hidden ? [...box.querySelectorAll('.supply-option')] : [];
  if (e.key === 'Escape') {
    if (options.length) {
      e.preventDefault();
      hideSupplyOptions(input);
    }
    return;
  }
  if (e.key === 'ArrowDown' && !options.length) {
    showSupplyOptions(input);
    e.preventDefault();
    return;
  }
  if (!options.length) return;
  const at = options.findIndex(o => o.getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next =
      e.key === 'ArrowDown' ? (at + 1) % options.length : at <= 0 ? options.length - 1 : at - 1;
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    options[next].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    // Enter picks the highlighted suggestion rather than submitting the step.
    e.preventDefault();
    pickSupplyOption(options[at >= 0 ? at : 0]);
  }
});

// Leaving the row closes its list; moving inside it (input to suggestion) does not.
document.addEventListener('focusout', e => {
  const input = e.target;
  if (input?.name !== 'supplyItem') return;
  const field = input.closest('.supply-field');
  if (field && !field.contains(e.relatedTarget)) hideSupplyOptions(input);
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

// Click 2 of 2 on document: the profile wizard and the dialogs it and the calculated pages
// open. Index: new save (also on the Vue profiles page), the calculated factory dialog, the
// alternate recipe picker, wizard and guided navigation, opening the node survey (whose own
// controls are in ui/pages/SurveyPage.vue), existing-supply rows, cancel wizard.
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  // --- Starting the wizard (startWizard checks for unsaved notes itself) ---
  // "Create a save" on the profiles page (and in the wizard).
  if (b.hasAttribute('data-new-save')) startWizard();
  // --- Dialogs ---
  // A calculated plan's factory name, "Details ↗" or "Open factory" link: its dialog.
  if (b.dataset.calcFactory) openCalculatedFactory(b.dataset.calcFactory);
  // "recipe ↗" beside an alternate in the recipe picker: show that recipe.
  if (b.dataset.altInfo) openAltRecipe(b.dataset.altInfo);
  // --- Alternate recipe picker (wizard) ---
  // "Select all" / "Clear all": tick or clear the rows the filter currently shows, keeping
  // the preference boxes and the "· N selected" heading in step. In place, no redraw.
  if (b.hasAttribute('data-alt-all') || b.hasAttribute('data-alt-none')) {
    const on = b.hasAttribute('data-alt-all'),
      p = b.closest('.alt-picker');
    for (const box of p.querySelectorAll('.alt-row:not([hidden]) input[name=alt]')) {
      box.checked = on;
      const star = box.closest('.alt-row').querySelector('input[name=altpref]');
      if (star) {
        star.disabled = !on;
        if (!on) star.checked = false;
      }
    }
    p.querySelector('.alt-picker-head b').textContent =
      `Alternate recipes · ${p.querySelectorAll('input[name=alt]:checked').length} selected`;
  }
  // "Planner's choice": calculate once with every alternate allowed, then tick exactly
  // the alternates that plan uses. Only the wizard's settings change; nothing is saved.
  if (b.hasAttribute('data-alt-best') && wizard && !b.disabled) {
    b.disabled = true;
    const label = b.textContent;
    try {
      readWizard($('#wizard-form'));
      const preview = await post(
        '/api/preview',
        { settings: { ...wizard.settings, recipes: 'all' } },
        true,
        calcProgress(b, 'Calculating…'),
      );
      wizard.settings.alternateRecipes = alternatesUsed(preview);
      render();
      toast(
        `Selected ${wizard.settings.alternateRecipes.length} alternate recipes the planner uses with your current settings.`,
      );
    } catch (err) {
      wizardError($('#wizard-form'), err);
      b.disabled = false;
      b.textContent = label;
    }
  }
  // --- Wizard navigation ---
  // The five-step wizard's numbered tabs. moveWizard validates before going forward and
  // calculates the preview on reaching step 5 (Review).
  if (b.dataset.wizardStep) await moveWizard(Number(b.dataset.wizardStep));
  // "Back" in the five-step wizard (on step 1 that button is "Cancel" instead).
  if (b.hasAttribute('data-wizard-back')) await moveWizard(wizard.step - 1);
  // "Back" in the guided questions.
  if (b.hasAttribute('data-guided-back')) await moveGuided(wizard.guidedStep - 1);
  // "All settings →" in guided mode: the five-step wizard at that step, keeping every answer.
  if (b.dataset.guidedAdvanced) toAdvanced(Number(b.dataset.guidedAdvanced));
  // "← Guided start" in the five-step wizard: back to the guided questions.
  if (b.hasAttribute('data-guided-start')) toGuided();
  // --- Node survey ---
  // "Work these out from my nodes →": open the survey, remembering where to return to.
  if (b.hasAttribute('data-open-extraction')) openExtraction();
  // --- Existing supply rows (wizard) ---
  // A suggestion under an item field: fill it in and focus the rate. Stop here, since
  // pickSupplyOption has redrawn the page.
  if (b.dataset.supplyPick) {
    pickSupplyOption(b);
    return;
  }
  // "Remove" on an existing-supply row: drop the row and rebuild existingSupply from the
  // rest, keeping known items with a rate above 0. The preview no longer matches, so it
  // is cleared.
  if (b.dataset.supplyRemove && wizard) {
    const form = $('#wizard-form');
    if (form) wizard.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
    const rows = supplyRows(wizard);
    rows.splice(Number(b.dataset.supplyRemove), 1);
    wizard.settings.existingSupply = Object.fromEntries(
      rows
        .filter(r => Number(r.rate) > 0)
        .map(r => [r.name.trim(), Number(r.rate)])
        .filter(([n]) => (workspace.catalog.supplyItems || []).includes(n)),
    );
    wizard.preview = null;
    render();
  }
  // "Cancel" in the wizard: drop it without a confirmation and show the profiles page.
  // Nothing has been saved yet; the profile is only created on Review.
  if (b.hasAttribute('data-cancel-wizard')) {
    setWizard(null);
    navigate('profiles');
  }
});
