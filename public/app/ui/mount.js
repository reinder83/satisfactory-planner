// Mounts the Vue page frame (Shell.vue) into #app. The sign-in and error screens replace
// #app wholesale, so they unmount the frame first; render() mounts it again when needed.
import { createApp } from 'vue';
import Shell from './Shell.vue';

let app = null;
let frame = null;

// Mounts the frame unless it is already on the page. Mounting is synchronous, so #main
// exists as soon as this returns.
export function mountShell(root) {
  if (app && frame?.isConnected) return;
  unmountShell();
  root.textContent = '';
  app = createApp(Shell);
  app.mount(root);
  frame = root.firstElementChild;
}

export function unmountShell() {
  app?.unmount();
  app = null;
  frame = null;
}
