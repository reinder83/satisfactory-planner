// The router that renders the current view into the page frame (ui/Shell.vue).
import { required } from './format.ts';
import { calculated, currentSave, view, wizard } from './session.ts';
import { invalidate } from './ui/bridge.ts';
import { mountPage, mountShell, pageUnmounting, unmountPage } from './ui/mount.ts';
import { vuePage } from './ui/pages.ts';
import { focusOpenedPage } from './ui/refocus.ts';

// A render() asked for during an unmount, still to run.
let renderAgain = false;

// Redraws the page for the current `view` from session state. Called after every change
// (save, navigation, toggles). The frame is ui/Shell.vue, mounted on the first call; the page
// is the route's component (ui/pages.ts), mounted into <main> when it becomes the current
// one. invalidate() refreshes both. Mounting is synchronous, so a handler can read the new
// page as soon as this returns; an update to a page already shown lands on the next tick.
// When a new page replaces another and focus went with the old one, focus goes to the new
// page's heading (focusOpenedPage, #304).
// A render() asked for while the old page is being unmounted (a focused field's change event,
// which Edge and Chrome fire as the field goes, #366) waits until the unmount is over and then
// runs, so it still draws what its caller changed but never re-enters Vue's unmount.
export function render() {
  if (pageUnmounting()) {
    renderAgain = true;
    return;
  }
  do {
    renderAgain = false;
    drawPage();
  } while (renderAgain);
}

function drawPage() {
  mountShell(required('#app'));
  invalidate();
  const component = vuePage(view, calculated, wizard, !!currentSave.id);
  if (component) {
    if (mountPage(required('#main'), component)) focusOpenedPage();
  } else {
    unmountPage();
    required('#main').textContent = '';
  }
}
