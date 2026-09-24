// The shared #detail <dialog> when it shows a component: a handbook factory, a calculated
// factory or a factory group's build order (ui/detail/). Each opening mounts a fresh app, so
// a dialog starts from saved state as the HTML dialogs do; it reads session state through the
// bridge and refreshes on render(). The dialogs that are not components yet (the storage
// container, the wizard's alternate recipe) fill #detail through dialog() in
// factory-detail.js, which unmounts this first. Closing the dialog unmounts it too, so a
// closed dialog never redraws for a profile or phase it was not opened for.
import { createApp } from 'vue';
import DetailDialog from './detail/DetailDialog.vue';

let app = null;
let listening = false;

// Opens `target` ({ kind: 'factory' | 'calc' | 'group', id }) in #detail, replacing whatever
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
