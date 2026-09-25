// The handlers for the controls several components share: progress checkboxes, "Save notes",
// links to a factory's dialog, the dialog's ×, and "Create a save". Each component binds
// them itself (@change, @click, or v-bind with factoryLink()). The data-* attributes stay
// on the elements: they carry the saved keys these handlers read, and browser-check.mjs,
// the tests and allowSwitch() in api.js look for them.
// Progress changes go through save() in api.js: it queues the write, toasts a failure
// itself and rejects. The empty `catch {}` blocks below therefore only skip the redraw
// (or put the control back); a success toast never follows a failed write.
import { save, toast } from '../api.js';
import { openCalculatedFactory, openFactory } from '../factory-detail.js';
import { setActiveDetail } from '../session.js';
import { render } from '../shell.js';
import { startWizard } from '../wizard/wizard.js';

// @change on any progress checkbox (data-check is its saved key): plan steps, a factory's
// "Running", calculated rows, storage and commissioning checklists, the power checks, the
// factory dialog's target check. It saves when ticked; a failed write puts the box back.
// None of these boxes binds :disabled, so setting it here cannot fight a redraw.
export async function toggleCheck(e) {
  const el = e.target;
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

// @click on "Save notes" under a notes box: phase notes (plan page), save-wide notes (Backup
// page) and the notes in factory and container dialogs. data-save-note is the notes key and
// data-input the textarea's id. Inside a dialog a successful save also closes it. There is
// no redraw: save() has already stored the new state. "Notes saved." only appears after the
// write succeeded.
export async function saveNote(e) {
  const button = e.currentTarget;
  const noteDialog = button.closest('dialog');
  button.disabled = true;
  try {
    await save({
      type: 'note',
      key: button.dataset.saveNote,
      value: document.getElementById(button.dataset.input).value,
    });
    if (noteDialog?.open && noteDialog.contains(button)) closeDetail();
    toast('Notes saved.');
  } catch {
  } finally {
    button.disabled = false;
  }
}

// A link to another factory's dialog, as the flow models, the group chain and the plan's
// steps carry it: { factory: <handbook id> } or { calcFactory: <calculated row id> }. Bound
// with v-bind, it gives the button its data-factory or data-calc-factory attribute and the
// click that opens that dialog.
export const factoryLink = link =>
  !link
    ? {}
    : link.calcFactory
      ? {
          'data-calc-factory': link.calcFactory,
          onClick: () => openCalculatedFactory(link.calcFactory),
        }
      : { 'data-factory': link.factory, onClick: () => openFactory(link.factory) };

// Closes the shared #detail dialog (its ×, a backdrop click, a saved note). Closing unmounts
// the dialog's app (ui/detail.js). There is no unsaved-notes check, so an unsaved note edit
// in the dialog is dropped.
export function closeDetail() {
  document.querySelector('#detail').close();
  setActiveDetail(null);
}

// "Create a save" on the profiles page, and in the wizard when there is no draft.
// startWizard checks for unsaved notes itself.
export const newSave = () => startWizard();
