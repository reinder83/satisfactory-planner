// The shared #detail <dialog>: a handbook factory, a calculated factory, a factory group's
// build order, a storage container or an alternate recipe (ui/detail/). Each opening mounts a
// fresh app, so a dialog starts from saved state; it reads session state through the bridge
// and refreshes on render(). Closing the dialog unmounts it too, so a closed dialog never
// redraws for a profile or phase it was not opened for.
import { createApp } from 'vue';
import DetailDialog from './detail/DetailDialog.vue';

let app = null;
let listening = false;

// Opens `target` ({ kind: 'factory' | 'calc' | 'group' | 'slot' | 'alt', id }) in #detail, replacing whatever
// it shows, and opens the dialog if it is not open yet.
export function showDetail(target) {
  const d = document.querySelector('#detail');
  if (!listening) {
    d.addEventListener('close', unmountDetail);
    listening = true;
  }
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
