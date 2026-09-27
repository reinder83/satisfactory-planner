// Mounts the Vue parts of the page. Until every page is a component, three separate apps
// share the session state: the frame (Shell.vue) in #app, the current page in the frame's
// <main> when that page is a component, and the sign-in screen, which replaces #app.
// Mounting is synchronous, so the DOM is there as soon as these return.
import { createApp, type App, type Component } from 'vue';
import Shell from './Shell.vue';
import SignedOut from './SignedOut.vue';

// The frame's app and its root element, which tells whether the frame is still on the page.
let shell: { app: App; el: Element | null } | null = null;
let page: { app: App; component: Component; host: Element } | null = null;
let screen: App | null = null;
// True while the page's app is being unmounted. Taking a focused field off the page makes
// Edge and Chrome fire its change event there and then when it holds a value typed since the
// last one (#366), so a page's change handler, and the render() it calls, can run in the
// middle of Vue's unmount. render() waits for the unmount to finish (see pageUnmounting).
let unmounting = false;

// Mounts the frame unless it is already on the page.
export function mountShell(root: Element) {
  if (shell?.el?.isConnected) return;
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

// Shows `component` as the page in `host` (the frame's <main>), unless it already is. Returns
// true when it took the place of another page in the same frame (#304: render() then puts focus
// on the new page when it went with the old one), false for none or the first page of a frame.
export function mountPage(host: Element, component: Component): boolean {
  if (page?.component === component && page.host === host && host.isConnected) return false;
  const replaced = page?.host === host && host.isConnected;
  unmountPage();
  const app = createApp(component);
  app.mount(host);
  page = { app, component, host };
  return replaced;
}

// When <main> shows no page.
export function unmountPage() {
  if (!page || unmounting) return;
  unmounting = true;
  try {
    page.app.unmount();
  } finally {
    page = null;
    unmounting = false;
  }
}

// Whether the page is being unmounted right now: a render() called then would unmount the same
// app a second time from inside its own unmount, and Vue then walks DOM nodes it has already
// removed ("Cannot read properties of null (reading 'nextSibling')", #366).
export const pageUnmounting = () => unmounting;

// The sign-in screen in place of the whole app (boot() with no signed-in user, sign-out).
export function showSignedOut(root: Element) {
  unmountShell();
  root.textContent = '';
  screen = createApp(SignedOut);
  screen.mount(root);
}
