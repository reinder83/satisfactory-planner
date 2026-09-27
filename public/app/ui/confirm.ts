// The in-app confirmation (#241), in place of the browser's confirm(): the <dialog id="confirm">
// in index.html, which opens above the shared #detail dialog when that is open too, since
// showModal() puts the newest modal on top. confirmAction() resolves true when the confirm
// button is pressed and false for Cancel, Escape or a click on the backdrop. Each question
// mounts a fresh ConfirmDialog.vue and unmounts it when answered; focus starts on Cancel for a
// destructive action (`danger`), otherwise on the confirm button, and goes back afterwards to
// whatever had it when the question was asked, if that is still on the page.
import { createApp, type App } from 'vue';
import { required } from '../format.ts';
import ConfirmDialog from './ConfirmDialog.vue';

export interface ConfirmOptions {
  // The dialog's heading, a short question ("Remove this step?").
  title: string;
  // The explanation under it: what happens, and what is kept.
  body: string;
  // The confirm button's text ("Remove step").
  confirmLabel: string;
  // A destructive action: a red confirm button, and focus starts on Cancel.
  danger?: boolean;
}

let open: {
  app: App;
  trigger: HTMLElement | null;
  resolve: (ok: boolean) => void;
} | null = null;
// The #confirm element the listeners below are on (a test page may replace it).
let listening: HTMLDialogElement | null = null;

// Answers the open question: closes and empties the dialog, puts focus back and resolves.
function settle(ok: boolean) {
  const current = open;
  if (!current) return;
  open = null;
  const d = required<HTMLDialogElement>('#confirm');
  if (d.open) d.close();
  current.app.unmount();
  if (current.trigger?.isConnected) current.trigger.focus();
  current.resolve(ok);
}

// A click on the backdrop reaches the <dialog> itself, outside its box; the hazard strip on
// top (dialog::before) is inside the box, so a click there does not cancel.
function backdropClick(e: MouseEvent) {
  const d = e.currentTarget as HTMLDialogElement;
  if (e.target !== d) return;
  const r = d.getBoundingClientRect();
  const inside =
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) settle(false);
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const d = required<HTMLDialogElement>('#confirm');
  if (listening !== d) {
    d.addEventListener('click', backdropClick);
    // Escape: answer Cancel here rather than letting the browser close the dialog by itself.
    d.addEventListener('cancel', e => {
      e.preventDefault();
      settle(false);
    });
    // Closed any other way (a browser that closes it after repeated Escapes regardless): the
    // same as Cancel. The close event of an earlier answer arrives after the next question
    // may have reopened the dialog, so an open dialog is left alone.
    d.addEventListener('close', () => {
      if (!d.open) settle(false);
    });
    listening = d;
  }
  // A second question while one is open (not expected) answers the first one Cancel.
  settle(false);
  const active = document.activeElement;
  const trigger = active instanceof HTMLElement && active !== document.body ? active : null;
  return new Promise<boolean>(resolve => {
    const app = createApp(ConfirmDialog, { ...options, answer: settle });
    app.mount(d);
    open = { app, trigger, resolve };
    d.showModal();
    d.querySelector<HTMLElement>(
      options.danger ? '[data-confirm-cancel]' : '[data-confirm-ok]',
    )?.focus();
  });
}
