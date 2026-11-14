// The quick-jump search (#1351): Ctrl+K (⌘K) or "/" opens <dialog id="jump"> (JumpDialog.vue) over
// the page, a search over the open profile's production lines, factories, build-plan steps,
// storage containers and notes (jump-index.ts). Choosing a result closes it and goes there: a
// line or container opens its dialog, a factory its flow page, a step the build plan scrolled to
// it, a note its page or the dialog the note is in. Focus goes back to what had it before, as for
// the confirmation (ui/confirm.ts). The dialog is made on first use and mounted afresh each time.
import { createApp, type App } from 'vue';
import { allowSwitch, navigate } from '../api.ts';
import { onBackdropClick } from '../backdrop.ts';
import { openCalculatedFactory } from '../factory-detail.ts';
import type { JumpResult } from '../jump-index.ts';
import { flowRoute, stateLoaded } from '../session.ts';
import { setJumpTarget } from '../step-jump.ts';
import { openSlot } from '../views/storage.ts';
import JumpDialog from './JumpDialog.vue';
import { reserveScrollbar } from './scroll-lock.ts';

let mounted: { app: App; trigger: HTMLElement | null; dialog: HTMLDialogElement } | null = null;

// Unmounts the search and puts focus back; the close event and a new opening both call it, so a
// close event that arrives late (browsers fire it after other tasks) finds nothing to do.
function tidy() {
  if (!mounted) return;
  const { app, trigger } = mounted;
  mounted = null;
  app.unmount();
  if (trigger?.isConnected) trigger.focus();
}

function jumpDialog(): HTMLDialogElement {
  let dialog = document.querySelector<HTMLDialogElement>('#jump');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'jump';
    dialog.setAttribute('aria-labelledby', 'jump-title');
    document.body.append(dialog);
    const element = dialog;
    onBackdropClick(element, () => element.close());
    // Escape closes natively; the close event does the tidying for every way of closing.
    element.addEventListener('close', () => {
      if (!element.open) tidy();
    });
  }
  return dialog;
}

export function openJump() {
  if (mounted && !(mounted.dialog.isConnected && mounted.dialog.open)) tidy();
  if (!stateLoaded || mounted || document.querySelector('dialog[open]')) return;
  const dialog = jumpDialog();
  const active = document.activeElement;
  const trigger = active instanceof HTMLElement && active !== document.body ? active : null;
  const app = createApp(JumpDialog, {
    close: () => dialog.close(),
    choose: (result: JumpResult) => {
      dialog.close();
      void jumpTo(result);
    },
  });
  mounted = { app, trigger, dialog };
  app.mount(dialog);
  reserveScrollbar();
  dialog.showModal();
  dialog.querySelector<HTMLElement>('[data-jump-input]')?.focus();
}

// Goes to a result. Like a link, it first asks about a note that could not be saved.
export async function jumpTo(result: JumpResult) {
  if (!(await allowSwitch())) return;
  switch (result.kind) {
    case 'line':
      openCalculatedFactory(result.id);
      break;
    case 'container':
      openSlot(result.id);
      break;
    case 'factory':
      location.hash = '#' + flowRoute(result.id);
      break;
    case 'step':
      setJumpTarget(result.id);
      navigate('plan');
      break;
    case 'note':
      if (result.id.startsWith('factory-')) openCalculatedFactory(result.id.slice(8));
      else if (result.id.startsWith('slot-')) openSlot(result.id.slice(5));
      else navigate('notes');
  }
}

// The shortcut (bound in listeners.ts): Ctrl+K or ⌘K, or "/" alone. It never fires while typing
// in a field, a select or an editable element (a "/" belongs to the text), with another dialog
// open, or when another handler took the key.
export function jumpShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.repeat) return;
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (!(ctrl ? key === 'k' && !event.shiftKey : key === '/' && !event.shiftKey)) return;
  const target = event.target as Element | null;
  if (
    target?.closest?.(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  openJump();
}
