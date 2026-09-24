// The router that renders the current view into the page frame (ui/Shell.vue).
import { $ } from './format.js';
import { calculated, view, wizard } from './session.js';
import { invalidate } from './ui/bridge.js';
import { mountPage, mountShell, unmountPage } from './ui/mount.js';
import { vuePage } from './ui/pages.js';

// Redraws the page for the current `view` from session state. Called after every change
// (save, navigation, toggles). The frame is ui/Shell.vue, mounted on the first call; the page
// is the route's component (ui/pages.js), mounted into <main> when it becomes the current
// one. invalidate() refreshes both. Mounting is synchronous, so a handler can read the new
// page as soon as this returns; an update to a page already shown lands on the next tick.
export function render() {
  mountShell($('#app'));
  invalidate();
  const component = vuePage(view, calculated, wizard);
  if (component) mountPage($('#main'), component);
  else {
    unmountPage();
    $('#main').textContent = '';
  }
}
