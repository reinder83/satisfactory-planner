// The shared #detail <dialog>: a calculated factory, a storage container or an alternate recipe
// (ui/detail/). Each opening mounts a fresh app, so a dialog starts from saved state; it reads
// session state through the bridge and refreshes on render(). Closing the dialog unmounts it too, so a closed dialog never
// redraws for a profile or phase it was not opened for.
import { createApp, type App } from 'vue';
import { allowSwitch } from '../api.ts';
import { required } from '../format.ts';
import DetailDialog from './detail/DetailDialog.vue';

// What #detail shows: a calculated row, a storage container (by address) or an alternate recipe
// (by recipe id). A factory group's build order is a page of its own, #factories/<group>/flow
// (#895).
export interface DetailTarget {
  kind: 'calc' | 'slot' | 'alt';
  id: string;
}

let app: App | null = null;
// The #detail element the close listener is on (a test page may replace it).
let listening: HTMLDialogElement | null = null;
// The control that had focus when the dialog opened, where closing it puts focus back. A link
// inside the dialog that puts another one in its place keeps it: the dialog never closed.
let opener: HTMLElement | null = null;

// Opens `target` ({ kind: 'calc' | 'slot' | 'alt', id }) in #detail, replacing whatever
// it shows, and opens the dialog if it is not open yet. Replacing an open dialog drops its
// unsaved note, so that is asked about first; kept, the dialog stays as it is. With nothing to
// ask it opens at once, before this returns.
export function showDetail(target: DetailTarget) {
  const dialog = required<HTMLDialogElement>('#detail');
  if (listening !== dialog) {
    // Browsers fire close a few milliseconds after close(), after other tasks and even after
    // a click that opened another dialog meanwhile (Escape and an immediate click on another
    // opener, #322). That late event belongs to the dialog already gone: an open dialog is left
    // alone, or it would unmount the new content and leave an open, empty dialog.
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      unmountDetail();
      returnFocus(dialog);
    });
    listening = dialog;
  }
  const asked = dialog.open ? allowSwitch(dialog) : true;
  if (asked === true) replaceDetail(dialog, target);
  else
    void asked.then(ok => {
      if (ok) replaceDetail(dialog, target);
    });
}

function replaceDetail(dialog: HTMLDialogElement, target: DetailTarget) {
  unmountDetail();
  dialog.textContent = '';
  app = createApp(DetailDialog, { target });
  app.mount(dialog);
  if (!dialog.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  } else if (!dialog.contains(document.activeElement)) {
    // Replaced while open (a link inside it, #319): emptying the dialog took the focused link
    // away, and showModal() does not run again, so focus would fall to <body>. It goes where
    // showModal() puts it on opening, so a replaced dialog starts like a freshly opened one.
    focusFirstControl(dialog);
  }
  // The <dialog> is the scroll container and keeps its offset while closed and while its
  // content is replaced, so each opening would start where the last dialog was left (#316).
  // Reset it after showModal(): a closed dialog has no box to scroll. showModal() focuses the
  // first control, which sits in the sticky header, so the reset never hides the focus.
  dialog.scrollTop = 0;
}

// What showModal() focuses: an [autofocus] element, else the first control that takes focus,
// which in every #detail dialog sits in the sticky header (a Running box, else the ×). Hidden
// and disabled controls refuse focus(), so the first one that accepts it wins. The dialog is
// scrolled to its top right after, so focus() does not scroll it.
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable]';
function focusFirstControl(dialog: HTMLDialogElement) {
  const candidates = [dialog.querySelector('[autofocus]'), ...dialog.querySelectorAll(FOCUSABLE)];
  for (const el of candidates) {
    if (!(el instanceof HTMLElement) || el.matches(':disabled')) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return;
  }
}

// On close, focus goes back to the control that opened the dialog, however many dialogs
// replaced the first one in between. Browsers do this themselves for a modal dialog (so this
// usually finds focus already there and leaves it), but only while the opener is still on the
// page; one that is gone is left to the page. A dialog opened again before this close event
// arrived keeps its own opener: the close listener ignores that late event.
function returnFocus(dialog: HTMLDialogElement) {
  const back = opener;
  opener = null;
  const current = document.activeElement;
  const lost =
    !current || current === document.body || !current.isConnected || dialog.contains(current);
  if (lost && back?.isConnected) back.focus();
}

export function unmountDetail() {
  app?.unmount();
  app = null;
}
