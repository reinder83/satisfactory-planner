// The handlers for the controls several components share: progress checkboxes, links to a
// factory's dialog, the dialog's ×, and "Create a save". Each component binds
// them itself (@change, @click, or v-bind with factoryLink()). The data-* attributes stay
// on the elements: they carry the saved keys these handlers read, and browser-check.ts,
// the tests and allowSwitch() in api.ts look for them.
// Progress changes go through save() in api.ts: it queues the write, toasts a failure
// itself and rejects. The empty `catch {}` blocks below therefore only skip the redraw
// (or put the control back); a success toast never follows a failed write.
import { allowSwitch, save, toast } from '../api.ts';
import { openCalculatedFactory, openFactory } from '../factory-detail.ts';
import { render } from '../shell.ts';
import { startWizard } from '../wizard/wizard.ts';
import { required } from '../format.ts';
import { containerMove } from '../views/storage.ts';

// A link to a factory's dialog: a handbook factory or a calculated row.
export type FactoryLink = { factory: string } | { calcFactory: string };

// @change on any progress checkbox (data-check is its saved key): plan steps, a factory's
// "Running", calculated rows, storage and commissioning checklists, the power checks, the
// factory dialog's target check. It saves when ticked; a failed write puts the box back.
// None of these boxes binds :disabled, so setting it here cannot fight a redraw.
export async function toggleCheck(e: Event) {
  const el = e.target as HTMLInputElement;
  const value = el.checked;
  el.disabled = true;
  try {
    await save({ type: 'check', key: el.dataset.check || '', value });
    render();
  } catch {
    el.checked = !value;
  } finally {
    el.disabled = false;
  }
}

// A link to another factory's dialog, as the flow models, the group chain and the plan's
// steps carry it: { factory: <handbook id> } or { calcFactory: <calculated row id> }. Bound
// with v-bind, it gives the button its data-factory or data-calc-factory attribute and the
// click that opens that dialog.
export const factoryLink = (link: FactoryLink | null | undefined) =>
  !link
    ? {}
    : 'calcFactory' in link
      ? {
          'data-calc-factory': link.calcFactory,
          onClick: () => openCalculatedFactory(link.calcFactory),
        }
      : { 'data-factory': link.factory, onClick: () => openFactory(link.factory) };

// Closes the shared #detail dialog (its × or a backdrop click). Closing unmounts the dialog's
// app (ui/detail.ts), so allowSwitch() first sends a note still waiting for its pause in
// typing, and asks about one that could not be saved (the question opens above the dialog);
// the dialog stays open when the user keeps it. Notes save themselves (ui/note-draft.ts), so
// saving one no longer closes it.
export async function closeDetail() {
  const d = required<HTMLDialogElement>('#detail');
  if (!d.open) return;
  const asked = allowSwitch(d);
  if (asked === true || (await asked)) d.close();
}

// Escape on #detail (bound in listeners.ts): the browser closes the dialog itself after this
// cancel event, so with a note that could not be saved the close is cancelled here and the
// note asked about, as the × does; leaving anyway closes it then. A browser may still close
// it after repeated presses, whatever the answer.
export function cancelDetail(e: Event) {
  const d = required<HTMLDialogElement>('#detail');
  const asked = allowSwitch(d);
  if (asked === true) return;
  e.preventDefault();
  void asked.then(ok => {
    if (ok && d.open) d.close();
  });
}

// "Create a save" on the profiles page, and in the wizard when there is no draft.
// startWizard checks for unsaved notes itself.
export const newSave = () => startWizard();

// A storage container dropped on another position (#208, StoragePage.vue): one save that moves
// it, or swaps it with the container there, its checks and note going along.
export async function moveContainer(from: string, to: string) {
  const op = containerMove(from, to);
  if (!op || op.type !== 'storageSlotMove') return;
  try {
    await save(op);
    toast(
      op.toName
        ? `${op.fromName} and ${op.toName} swapped places (${from} ↔ ${to}), each with its checkmarks and note.`
        : `${op.fromName} moved from ${from} to ${to}, with its checkmarks and note.`,
    );
  } catch {
  } finally {
    render();
  }
}
