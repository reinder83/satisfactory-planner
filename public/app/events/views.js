// Delegated DOM event handlers for the planner views: checklist, factories,
// storage, dialogs and navigation.
// The pages are HTML strings redrawn by render() in shell.js, so every listener sits on
// document or window and dispatches on data-* attributes, element ids or form ids.
// Progress changes go through save() in api.js: it queues the write, toasts a failure
// itself and rejects. The empty `catch {}` blocks below therefore only skip the redraw
// (or put the control back); a success toast never follows a failed write.
// Shared UI state lives in session.js and is changed through its setX() setters.

// Registration order matters where listeners share an event type: app.js imports this
// module first, and tests/app-modules.test.mjs pins the order. In order: main page
// click, change, search input, supply input, supply keydown, supply
// focusout, add-task submit, editor submit, image error (capture), hashchange, #detail
// backdrop click, beforeunload, then the wizard submit in profiles.js.
import { knownWorld, nodePresets, presetSurvey } from '../../preferences.js';
import { bayCapacity } from '../../state.js';
import { allowSwitch, navigate, pending, post, save, toast, writeQueue } from '../api.js';
import { openFactory, openGroupChain } from '../factory-detail.js';
import { $, num } from '../format.js';
import {
  calculated,
  currentProfile,
  factoryEditing,
  floor,
  layoutEditing,
  loadContext,
  phase,
  plan,
  planEditing,
  setActiveDetail,
  setEditingTask,
  setFactoryEditing,
  setFactoryFilter,
  setFloor,
  setHideDone,
  setLayoutEditing,
  setPlanEditing,
  setQuery,
  setView,
  setWizard,
  setWorkspace,
  state,
  wizard,
  workspace,
} from '../session.js';
import { render } from '../shell.js';
import { autoTaskLink, basePlanTasks, planTasks } from '../tasks.js';
import { calculatedDelivery, openCalculatedFactory } from '../views/calculated.js';
import { membershipsOf } from '../views/factories.js';
import { nextBayLetter, openSlot, slotKeys, storageBays } from '../views/storage.js';
import {
  extractionOf,
  leaveExtraction,
  moveExtraction,
  openExtraction,
  readExtraction,
  resetExtraction,
  undoExtractionReset,
} from '../wizard/extraction.js';
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
// Index: dialogs (close, factory, container), storage room (complete room, floor tabs),
// ADA panel (another remark, mute), edit-mode toggles, build-plan step editing (move,
// edit, cancel, remove, restore), factory groups (remove, unassign), storage layout
// (clear container, remove bay, remove floor), notes, delete personal task.
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
  // A container tile in the storage room: open that address's detail dialog.
  if (target.dataset.slot) openSlot(target.dataset.slot);
  // --- Storage room ---
  // "Complete room X" on a bay: tick every check of every named container in the bay in
  // one write, then redraw. The button is disabled while saving.
  if (target.dataset.completeBay) {
    const bay = storageBays().find(b => b.id === target.dataset.completeBay);
    if (bay) {
      target.disabled = true;
      try {
        await save({
          type: 'checks',
          keys: bay.items.filter(x => x.name).flatMap(x => slotKeys(x.id)),
          value: true,
        });
        render();
        toast('Room ' + bay.id + ' completed. You can uncheck individual containers if needed.');
      } catch {
      } finally {
        target.disabled = false;
      }
    }
  }
  // A floor tab above the storage room: switch floor, clear the search, redraw.
  if (target.dataset.floor) {
    setFloor(target.dataset.floor);
    setQuery('');
    render();
  }
  // --- Edit-mode toggles (view state only, nothing is saved) ---
  // "Edit layout" / "Done editing" on the storage page: show or hide the layout editor.
  if (target.hasAttribute('data-toggle-layout')) {
    setLayoutEditing(!layoutEditing);
    render();
  }
  // "Edit steps" / "Done editing" on the plan checklist; either way closes any step form.
  if (target.hasAttribute('data-toggle-plan-edit')) {
    setPlanEditing(!planEditing);
    setEditingTask(null);
    render();
  }
  // "Edit groups" / "Done editing" on the factories page: show or hide the group editor.
  if (target.hasAttribute('data-toggle-factory-edit')) {
    setFactoryEditing(!factoryEditing);
    render();
  }
  // --- Build-plan step editing (plan page, after "Edit steps") ---
  // ↑ / ↓ beside a step (data-dir is -1 or 1): swap it with its neighbour and save this
  // phase's whole order (taskOrder). Nothing happens at either end of the list.
  if (target.dataset.moveTask) {
    const ids = planTasks().map(t => t.id),
      i = ids.indexOf(target.dataset.moveTask),
      j = i + Number(target.dataset.dir);
    if (i >= 0 && j >= 0 && j < ids.length) {
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try {
        await save({ type: 'taskOrder', phase: phase(), ids });
        render();
      } catch {}
    }
  }
  // "Edit" beside a step: swap it for its edit form (taskEditForm in tasks.js). The form
  // is saved by the data-task-edit branch of the editor submit listener below.
  if (target.dataset.editTask) {
    setEditingTask(target.dataset.editTask);
    render();
  }
  // "Cancel" in a step's edit form: close it without saving.
  if (target.hasAttribute('data-cancel-task-edit')) {
    setEditingTask(null);
    render();
  }
  // "Remove" beside a step, after a confirmation. A personal task (id custom-…) is
  // deleted; a plan step is only hidden (taskRemove) and keeps its checkmark, so it can
  // be put back from "Removed steps in this phase".
  if (target.dataset.removeStep) {
    const id = target.dataset.removeStep;
    if (id.startsWith('custom-')) {
      if (confirm('Delete this personal task?')) {
        try {
          await save({ type: 'removeTask', id });
          render();
        } catch {}
      }
    } else if (
      confirm(
        'Remove this step from your build plan? Its checkmark is kept and you can restore the step while editing.',
      )
    ) {
      try {
        await save({ type: 'taskRemove', id });
        render();
      } catch {}
    }
  }
  // "Restore" in the "Removed steps in this phase" list: show a removed plan step again.
  if (target.dataset.restoreTask) {
    try {
      await save({ type: 'taskRestore', id: target.dataset.restoreTask });
      render();
    } catch {}
  }
  // --- Factory groups (factories page, after "Edit groups") ---
  // "Remove group", after a confirmation: only the group goes; its factories and their
  // progress stay.
  if (
    target.dataset.removeGroup &&
    confirm('Remove this group? The factories stay in the list and keep their progress.')
  ) {
    try {
      await save({ type: 'factoryGroupRemove', id: target.dataset.removeGroup });
      render();
    } catch {}
  }
  // ✕ beside a group in a factory card's group editor: save the factory's memberships
  // without that group (data-group), keeping the other groups' rates.
  if (target.dataset.unassign) {
    const key = target.dataset.unassign,
      groups = membershipsOf(key)
        .filter(m => m.group !== target.dataset.group)
        .map(m => ({ group: m.group, rate: m.rate }));
    try {
      await save({ type: 'factoryAssign', key, groups });
      render();
    } catch {}
  }
  // --- Storage layout editing (storage page, after "Edit layout") ---
  // ✕ on a container: take the item off that address. Its checkmarks stay saved with the
  // address. Re-enabled only on failure, since a success redraws the button away.
  if (target.dataset.clearSlot) {
    target.disabled = true;
    try {
      await save({ type: 'storageSlotClear', key: target.dataset.clearSlot });
      render();
      toast('Container cleared. Its saved checkmarks are kept with the address.');
    } catch {
      target.disabled = false;
    }
  }
  // "Remove bay" on an added bay (handbook bays have none), after a confirmation.
  if (
    target.dataset.removeBay &&
    confirm('Remove this added bay? Saved checkmarks for its addresses are kept.')
  ) {
    target.disabled = true;
    try {
      await save({ type: 'storageBayRemove', id: target.dataset.removeBay });
      render();
    } catch {
      target.disabled = false;
    }
  }
  // "Remove this floor" for an added floor, after a confirmation; then back to the ground
  // floor. The button is rendered disabled while the floor still has bays.
  if (target.dataset.removeFloor && confirm('Remove this added floor?')) {
    target.disabled = true;
    try {
      await save({ type: 'storageFloorRemove', id: target.dataset.removeFloor });
      setFloor('ground');
      render();
    } catch {
      target.disabled = false;
    }
  }
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
  // "Delete personal task" inside a personal task's details (outside edit mode), after a
  // confirmation.
  if (target.dataset.remove && confirm('Delete this personal task?')) {
    try {
      await save({ type: 'removeTask', id: target.dataset.remove });
      render();
    } catch {}
  }
});

// Change events: checkboxes, selects and fields that save when committed, plus the
// wizard fields that reshape its form.
// Index: container Done, progress checkmarks, working phase, factory filter, hide
// completed, wizard redraws (settings, guided, node survey, existing supply), alternate
// recipe ticks, bay and group renames, group assignment and rate, elevator deliveries.
document.addEventListener('change', async e => {
  const el = e.target;
  // --- Checkmarks ---
  // "Done" on a storage container: set all of that address's checks in one write. A failed
  // write unticks it again.
  if (el.dataset.completeSlot) {
    const value = el.checked;
    el.disabled = true;
    try {
      await save({ type: 'checks', keys: slotKeys(el.dataset.completeSlot), value });
      render();
    } catch {
      el.checked = !value;
    } finally {
      el.disabled = false;
    }
  }
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
  // --- Page controls ---
  // The factory status filter on the factories page (view state only).
  if (el.id === 'factory-filter') {
    setFactoryFilter(el.value);
    render();
  }
  // "Hide completed" above the plan checklist (view state only).
  if (el.id === 'hide-done') {
    setHideDone(el.checked);
    render();
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
  // Node survey fields. Choosing a purity and distribution whose world is fully known
  // (knownWorld) refills every count from that preset.
  if (
    wizard?.mode === 'extraction' &&
    $('#wizard-form') &&
    /^(mark|clock|purity|distribution|node:|well:|used:)/.test(String(el.name))
  ) {
    readExtraction($('#wizard-form'));
    if (['purity', 'distribution'].includes(el.name)) {
      const s = wizard.settings;
      if (knownWorld(s.purity, s.distribution))
        wizard.extraction = presetSurvey(s.purity, extractionOf(wizard), s.distribution);
    }
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
  // --- Storage and factory group editing ---
  // A bay's name field in the layout editor. Redrawn whether or not the save worked, so a
  // failed rename shows the saved name again.
  if (el.dataset.bayRename) {
    el.disabled = true;
    try {
      await save({ type: 'storageBayRename', id: el.dataset.bayRename, name: el.value });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  // A group's name field while editing groups; redrawn either way, like the bay name.
  if (el.dataset.groupRename) {
    el.disabled = true;
    try {
      await save({ type: 'factoryGroupRename', id: el.dataset.groupRename, name: el.value });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  // "+ Add to group…" select on a factory card: add the factory to that group with no
  // rate (the whole output, or the remainder when it is in other groups too).
  if (el.dataset.assignAdd && el.value) {
    const key = el.dataset.assignAdd,
      groups = [
        ...membershipsOf(key).map(m => ({ group: m.group, rate: m.rate })),
        { group: el.value, rate: null },
      ];
    el.disabled = true;
    try {
      await save({ type: 'factoryAssign', key, groups });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  // The per-minute rate beside a group in a factory card's group editor. Empty means the
  // whole output or the remainder; anything else must be above 0, or a toast explains and
  // the redraw shows the saved rate again.
  if (el.dataset.assignRate) {
    const key = el.dataset.assignRate,
      raw = el.value.trim();
    let rate = null;
    if (raw !== '') {
      rate = Number(raw);
      if (!Number.isFinite(rate) || rate <= 0) {
        toast(
          'Enter a rate above 0, or leave the field empty for the whole output or the remainder.',
          true,
        );
        render();
        return;
      }
    }
    const groups = membershipsOf(key).map(m =>
      m.group === el.dataset.group ? { group: m.group, rate } : { group: m.group, rate: m.rate },
    );
    el.disabled = true;
    try {
      await save({ type: 'factoryAssign', key, groups });
    } catch {
    } finally {
      el.disabled = false;
      render();
    }
  }
  // --- Deliveries and restore ---
  // A Space Elevator delivery count on the plan page: a whole number from 0 to the target.
  // An invalid entry or a failed write resets the field to the saved count (without one:
  // the handbook's initial count for the original profile, otherwise 0).
  if (el.dataset.delivery) {
    const d = calculated
        ? calculatedDelivery(el.dataset.delivery)
        : plan.deliveries.find(x => x.id === el.dataset.delivery),
      v = Number(el.value);
    if (!Number.isInteger(v) || v < 0 || v > d.target) {
      toast('Enter a whole number between 0 and ' + num(d.target) + '.', true);
      el.value = state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
      return;
    }
    try {
      await save({ type: 'delivery', key: d.id, value: v });
      render();
    } catch {
      el.value = state.deliveries[d.id] ?? (currentProfile.id === 'original' ? d.initial : 0);
    }
  }
});

// Input events on search and filter boxes, as you type.
document.addEventListener('input', e => {
  // The find boxes on the factories, storage and plan pages: store the query and redraw.
  if (['factory-search', 'storage-search', 'plan-search'].includes(e.target.id)) {
    setQuery(e.target.value);
    render();
  }
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

// Submit 1 of 3 (then the editor forms below, then profiles.js): "Add task" under the
// plan checklist adds a personal task to the current phase with a random custom-… id.
// The button stays disabled after success because the redraw replaces the form.
document.addEventListener('submit', async e => {
  if (e.target.id === 'add-task') {
    e.preventDefault();
    const title = new FormData(e.target).get('title').trim();
    if (!title) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await save({
        type: 'addTask',
        id:
          'custom-' +
          Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        phase: phase(),
        title,
      });
      render();
    } catch {
      btn.disabled = false;
    }
  }
});

// Submit 2 of 3: the inline forms of the storage layout editor, the factory group
// editor and the step edit form. Each ignores an empty name.
// Index: add floor, rename floor, add bay, add container, add group, save step.
document.addEventListener('submit', async e => {
  const f = e.target,
    read = () => String(new FormData(f).get('name') || '').trim();
  // --- Storage layout editor ---
  // "Add floor": a new floor with a random cf-… id.
  if (f.id === 'add-floor') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({
        type: 'storageFloorAdd',
        id:
          'cf-' +
          Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        label: name,
      });
      render();
    } catch {}
  }
  // "Rename floor": renames the floor being shown.
  if (f.id === 'rename-floor') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({ type: 'storageFloorRename', id: floor, label: name });
      render();
    } catch {}
  }
  // "+ Add bay": a new bay on the floor being shown, named by the next free letter so
  // existing addresses (and their progress) never move.
  if (f.id === 'add-bay') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    const letter = nextBayLetter();
    if (!letter) {
      toast('No free bay letters left.', true);
      return;
    }
    try {
      await save({ type: 'storageBayAdd', id: letter, name, floor });
      render();
    } catch {}
  }
  // "+ Add" under a bay: put an item in that bay (data-bay).
  if (f.classList.contains('add-container')) {
    e.preventDefault();
    const name = read();
    if (!name) return;
    const bay = storageBays().find(b => b.id === f.dataset.bay);
    if (!bay) return;
    // Fill a free position first; a bay with none gets the next address after its last.
    const free =
      bay.items.find(x => !x.name)?.id ||
      (bay.items.length < bayCapacity
        ? bay.id + String(bay.items.length + 1).padStart(2, '0')
        : null);
    if (!free) {
      toast('This bay holds the most addresses it can. Add another bay.', true);
      return;
    }
    try {
      await save({ type: 'storageSlotAssign', key: free, name });
      render();
    } catch {}
  }
  // --- Factory groups ---
  // "+ Add group" in the group editor: a new, empty group with a random fg-… id.
  if (f.id === 'add-group') {
    e.preventDefault();
    const name = read();
    if (!name) return;
    try {
      await save({
        type: 'factoryGroupAdd',
        id:
          'fg-' +
          Array.from(crypto.getRandomValues(new Uint8Array(6)), b =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        name,
      });
      render();
    } catch {}
  }
  // --- Build-plan step editing ---
  // "Save step" in a step's edit form. A title or details equal to the plan's own text
  // is saved as empty, meaning "no override"; the link likewise when it is the automatic
  // one. The checkmark is untouched.
  if (f.dataset.taskEdit) {
    e.preventDefault();
    const id = f.dataset.taskEdit,
      fd = new FormData(f);
    const base = basePlanTasks().find(t => t.id === id);
    const title = String(fd.get('title') || '').trim(),
      body = String(fd.get('body') || '').trim(),
      link = String(fd.get('link') || '');
    if (!title) return;
    try {
      await save({
        type: 'taskEdit',
        id,
        title: base && title === base.title ? '' : title,
        body: base && body === String(base.body || '').trim() ? '' : body,
        link: link === autoTaskLink(id) ? '' : link,
      });
      setEditingTask(null);
      render();
    } catch {}
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

// Click 2 of 2 on document: the profile wizard and the dialogs it and the calculated pages
// open. Index: new save (also on the Vue profiles page), calculated factory and group
// build-order dialogs, the alternate recipe picker, round up, wizard and guided navigation,
// the node survey, existing-supply rows, cancel wizard.
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  // --- Starting the wizard (startWizard checks for unsaved notes itself) ---
  // "Create a save" on the profiles page (and in the wizard).
  if (b.hasAttribute('data-new-save')) startWizard();
  // --- Dialogs ---
  // A calculated plan's factory name, "Details ↗" or "Open factory" link: its dialog.
  if (b.dataset.calcFactory) openCalculatedFactory(b.dataset.calcFactory);
  // "Build order ↗" on a factory group with more than one factory.
  if (b.dataset.groupChain) openGroupChain(b.dataset.groupChain);
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
  // --- Profile actions ---
  // "Round up production" on a calculated plan: after the unsaved-notes check and any
  // queued saves, the server creates a new profile with whole machines and it is opened.
  // The old profile keeps its progress; the toast says how many checks need review.
  if (b.hasAttribute('data-round-up')) {
    if (!allowSwitch()) return;
    b.disabled = true;
    try {
      await writeQueue;
      const r = await post('/api/round-up', {}, true, calcProgress(b, 'Recalculating…'));
      setWorkspace(r.workspace);
      await loadContext(r.saveId, r.profileId);
      render();
      toast(
        'Created rounded profile. ' +
          r.reviewCount +
          ' completed factory checks need review; previous progress is preserved.',
      );
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
      b.textContent = 'Round up production';
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
  // --- Node survey (wizard extraction mode) ---
  // "Work these out from my nodes →": open the survey, remembering where to return to.
  if (b.hasAttribute('data-open-extraction')) openExtraction();
  // "Fill in the counts below": fill every count from the default world at that purity.
  // It also forgets any pending "Undo reset".
  if (b.dataset.nodePreset && wizard) {
    const form = $('#wizard-form');
    if (form) readExtraction(form);
    wizard.extraction = presetSurvey(
      b.dataset.nodePreset,
      extractionOf(wizard),
      wizard.settings.distribution,
    );
    wizard.extractionUndo = null;
    // Keep the profile's recorded purity in step with the counts it now holds.
    wizard.settings.purity = b.dataset.nodePreset;
    render();
    toast(
      'Filled in the default world at ' +
        (nodePresets.find(([v]) => v === b.dataset.nodePreset)?.[1] || 'that purity') +
        '. Change any count that does not match your save.',
    );
  }
  // "Reset all counts to zero". No confirmation, because "Undo reset" can bring the counts
  // back (see resetExtraction).
  if (b.hasAttribute('data-node-reset') && wizard) {
    const form = $('#wizard-form');
    if (form) readExtraction(form);
    resetExtraction();
    render();
    toast(
      'Cleared. Every count is zero, your miner mark and clock are kept — and Undo reset puts it all back.',
    );
  }
  // "Undo reset": put back the counts from before the last reset.
  if (b.hasAttribute('data-node-undo') && wizard) {
    undoExtractionReset();
    render();
    toast('Put back the counts you had before the reset.');
  }
  // The survey's numbered tabs, and its "Back" (from the first step it leaves the survey).
  if (b.dataset.extractionStep) await moveExtraction(Number(b.dataset.extractionStep));
  if (b.hasAttribute('data-extraction-back')) await moveExtraction(wizard.extractionStep - 1);
  // "Leave these budgets alone": leave the survey without applying its counts.
  if (b.hasAttribute('data-extraction-cancel')) leaveExtraction();
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
