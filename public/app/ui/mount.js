// Mounts the Vue parts of the page. Until every page is a component, three separate apps
// share the session state: the frame (Shell.vue) in #app, the current page in the frame's
// <main> when that page is a component, and the sign-in screen, which replaces #app.
// Mounting is synchronous, so the DOM is there as soon as these return.
import { createApp } from 'vue';
import Shell from './Shell.vue';
import SignedOut from './SignedOut.vue';

let shell = null;
let page = null;
let screen = null;

// Mounts the frame unless it is already on the page.
export function mountShell(root) {
  if (shell?.el.isConnected) return;
  unmountShell();
  root.textContent = '';
  const app = createApp(Shell);
  app.mount(root);
  shell = { app, el: root.firstElementChild };
}

// Also takes the page and the sign-in screen with it.
export function unmountShell() {
  unmountPage();
  screen?.unmount();
  screen = null;
  shell?.app.unmount();
  shell = null;
}

// Shows `component` as the page in `host` (the frame's <main>), unless it already is.
export function mountPage(host, component) {
  if (page?.component === component && page.host === host && host.isConnected) return;
  unmountPage();
  const app = createApp(component);
  app.mount(host);
  page = { app, component, host };
}

// When <main> shows no page.
export function unmountPage() {
  page?.app.unmount();
  page = null;
}

// The sign-in screen in place of the whole app (boot() with no signed-in user, sign-out).
export function showSignedOut(root) {
  unmountShell();
  root.textContent = '';
  screen = createApp(SignedOut);
  screen.mount(root);
}
