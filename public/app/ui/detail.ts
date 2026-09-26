// The shared #detail <dialog>: a handbook factory, a calculated factory, a factory group's
// build order, a storage container or an alternate recipe (ui/detail/). Each opening mounts a
// fresh app, so a dialog starts from saved state; it reads session state through the bridge
// and refreshes on render(). Closing the dialog unmounts it too, so a closed dialog never
// redraws for a profile or phase it was not opened for.
import { createApp, type App } from 'vue';
import { allowSwitch } from '../api.ts';
import { required } from '../format.ts';
import DetailDialog from './detail/DetailDialog.vue';

// What #detail shows: a handbook factory, a calculated row, a factory group's build order, a
// storage container (by address) or an alternate recipe (by recipe id).
export interface DetailTarget {
  kind: 'factory' | 'calc' | 'group' | 'slot' | 'alt';
  id: string;
}

let app: App | null = null;
let listening = false;

// Opens `target` ({ kind: 'factory' | 'calc' | 'group' | 'slot' | 'alt', id }) in #detail, replacing whatever
// it shows, and opens the dialog if it is not open yet. Replacing an open dialog drops its
// unsaved note, so that is asked about first; kept, the dialog stays as it is.
export function showDetail(target: DetailTarget) {
  const d = required<HTMLDialogElement>('#detail');
  if (!listening) {
    d.addEventListener('close', unmountDetail);
    listening = true;
  }
  if (d.open && !allowSwitch(d)) return;
  unmountDetail();
  d.textContent = '';
  app = createApp(DetailDialog, { target });
  app.mount(d);
  if (!d.open) d.showModal();
}

export function unmountDetail() {
  app?.unmount();
  app = null;
}
