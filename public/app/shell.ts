// The router that renders the current view into the page frame (ui/Shell.vue).
import { required } from './format.ts';
import { calculated, view, wizard } from './session.ts';
import { invalidate } from './ui/bridge.ts';
import { mountPage, mountShell, unmountPage } from './ui/mount.ts';
import { vuePage } from './ui/pages.ts';
import { focusOpenedPage } from './ui/refocus.ts';

// Redraws the page for the current `view` from session state. Called after every change
// (save, navigation, toggles). The frame is ui/Shell.vue, mounted on the first call; the page
// is the route's component (ui/pages.ts), mounted into <main> when it becomes the current
// one. invalidate() refreshes both. Mounting is synchronous, so a handler can read the new
// page as soon as this returns; an update to a page already shown lands on the next tick.
// When a new page replaces another and focus went with the old one, focus goes to the new
// page's heading (focusOpenedPage, #304).
export function render() {
  mountShell(required('#app'));
  invalidate();
  const component = vuePage(view, calculated, wizard);
  if (component) {
    if (mountPage(required('#main'), component)) focusOpenedPage();
  } else {
    unmountPage();
    required('#main').textContent = '';
  }
}
