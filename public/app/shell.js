// The router that renders the current view into the page frame (ui/Shell.vue), and the
// heading row the pages share.
import { $ } from './format.js';
import { html } from './html.js';
import { calculated, view } from './session.js';
import { invalidate } from './ui/bridge.js';
import { mountShell } from './ui/mount.js';
import { renderAccount } from './views/account.js';
import { renderBackup } from './views/backup.js';
import {
  renderCalculatedFactories,
  renderCalculatedPlan,
  renderCalculatedResources,
} from './views/calculated.js';
import { renderFactories } from './views/factories.js';
import { renderPlan } from './views/plan.js';
import { renderProfiles } from './views/profiles.js';
import { renderResources } from './views/resources.js';
import { renderStorage } from './views/storage.js';
import { renderWizard } from './wizard/wizard.js';

// HTML for the heading row at the top of every page. Plain strings are escaped, so pass
// save/profile names as they are; pass html`` for markup.
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

// Redraws the page for the current `view` from session state. Called after every change
// (save, navigation, toggles). The frame is the Vue component ui/Shell.vue, mounted on the
// first call and refreshed through invalidate(). The page itself is still rebuilt through
// innerHTML, synchronously, because some handlers read it right after calling render(); so
// this keeps what a rebuild would lose: open step <details>, the focused field and its caret.
export function render() {
  const open = [...document.querySelectorAll('details[open][data-task]')].map(x => x.dataset.task);
  const focused = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  mountShell($('#app'));
  invalidate();
  // Hash route -> view function returning HTML. A calculated profile has its own plan,
  // factories and resources pages; storage, backup and the rest are shared.
  const routes = {
    profiles: renderProfiles,
    wizard: renderWizard,
    account: renderAccount,
    plan: calculated ? renderCalculatedPlan : renderPlan,
    factories: calculated ? renderCalculatedFactories : renderFactories,
    storage: renderStorage,
    resources: calculated ? renderCalculatedResources : renderResources,
    backup: renderBackup,
  };
  $('#main').innerHTML = routes[view]();
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
