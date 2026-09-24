// The router that renders the current view into the page frame (ui/Shell.vue), and the
// helpers the legacy pages share: the heading row and the browser edition's notice.
import { $ } from './format.js';
import { html } from './html.js';
import { calculated, view } from './session.js';
import { invalidate } from './ui/bridge.js';
import { mountPage, mountShell, unmountPage } from './ui/mount.js';
import { vuePage } from './ui/pages.js';
import { renderWizard } from './wizard/wizard.js';

// HTML for the heading row at the top of every page. Plain strings are escaped, so pass
// save/profile names as they are; pass html`` for markup. (ui/PageHeader.vue for components.)
export function header(eyebrow, title, subtitle = '', badge = '') {
  return html`<div class="heading-row">
    <div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      ${subtitle && html`<div class="subtitle">${subtitle}</div>`}
    </div>
    ${badge && html`<span class="badge orange">${badge}</span>`}
  </div>`;
}

// HTML notice that saves are browser-local, at the top of the browser edition's wizard,
// guided-start and extraction-survey pages. (ui/BrowserNotice.vue for components.)
export function browserNotice() {
  return html`<div class="notice blue">
    Your saves stay in this browser on this device. Clearing site data or using private browsing can
    remove them. Export a full backup before switching devices or website addresses.
    <a href="#backup">Backups & transfer</a>
  </div>`;
}

// Hash route -> legacy view function returning HTML, for the pages that are not components
// yet (ui/pages.js has those).
const legacyRoutes = () => ({
  wizard: renderWizard,
});

// Redraws the page for the current `view` from session state. Called after every change
// (save, navigation, toggles). The frame is ui/Shell.vue, mounted on the first call and
// refreshed through invalidate(); so is a page that is a component, mounted into <main>
// when it becomes the current one. A legacy page is rebuilt through innerHTML,
// synchronously, because some handlers read it right after calling render(); so this keeps
// what a rebuild would lose: open step <details>, the focused field and its caret.
export function render() {
  const open = [...document.querySelectorAll('details[open][data-task]')].map(x => x.dataset.task);
  const focused = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  mountShell($('#app'));
  invalidate();
  const component = vuePage(view, calculated);
  if (component) {
    mountPage($('#main'), component);
    return;
  }
  unmountPage();
  $('#main').innerHTML = legacyRoutes()[view]?.() ?? '';
  // Restore what the rebuild reset.
  open.forEach(id =>
    document.querySelector(`details[data-task="${id}"]`)?.setAttribute('open', ''),
  );
  if (focused && document.getElementById(focused)) {
    const e = document.getElementById(focused);
    e.focus({ preventScroll: true });
    if (typeof selection === 'number' && e.setSelectionRange)
      e.setSelectionRange(selection, selection);
  }
}
