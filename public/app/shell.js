// The page frame (sidebar, header, profile footer) and the router that renders a view.
import { browserMode } from '../browser-api.js';
import { purities } from '../preferences.js';
import { adaPanel } from './ada-panel.js';
import { saveIndicator } from './api.js';
import { $, num } from './format.js';
import { html, raw } from './html.js';
import {
  calculated,
  currentProfile,
  currentSave,
  phase,
  phaseLabel,
  phaseOptions,
  view,
} from './session.js';
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

// HTML for the sidebar footer: the open profile's name and the game settings it was
// planned for. The original handbook's settings are fixed, so they are written out.
function profileFooter() {
  if (calculated) {
    const s = calculated.settings;
    const date = new Date(calculated.createdAt);
    const purity = purities.find(([id]) => id === s.purity)?.[1] || s.purity;
    return html`${currentProfile.name}<br />${purity} purity · ${num(s.multiplier)}× elevator
      parts<br />${num(s.powerFactor)}× power consumption
      ${!Number.isNaN(date.getTime()) &&
      html`<br />Plan created
        ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`}`;
  }
  if (currentProfile?.kind === 'original')
    return html`${currentProfile.name}<br />Pure nodes · 50× elevator parts<br />Half power
      consumption<br />Plan revised 13 September 2026`;
  return 'Create or select a profile';
}

// The sidebar's navigation: route, icon, label.
const NAV = [
  ['plan', '◫', 'Build plan'],
  ['factories', '▥', 'Factories'],
  ['storage', '▦', 'Storage room'],
  ['resources', '↗', 'Power & resources'],
  ['backup', '⇅', 'Backup & notes'],
];

// HTML for the page frame: sidebar navigation, ADA, save status, profile footer, and the
// top bar with breadcrumbs and the phase picker. The view goes into the empty <main>.
const shell = () =>
  String(
    html`<div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <img src="./favicon.svg" alt="" />
          <div>
            Project Assembly
            <div class="eyebrow">FICSIT compliance terminal</div>
          </div>
        </div>
        <nav class="nav" aria-label="Main navigation">
          ${NAV.map(
            ([id, icon, label]) =>
              html`<a
                href="#${id}"
                class="${view === id ? 'active' : ''}"
                ${view === id && raw('aria-current="page"')}
                ><span class="navicon" aria-hidden="true">${icon}</span>${label}</a
              >`,
          )}
        </nav>
        ${adaPanel()}
        <div class="save-status">
          <span class="dot"></span
          ><span id="saved">${browserMode ? 'Saved in this browser' : 'Saved on server'}</span>
        </div>
        <div class="sidebar-foot">${profileFooter()}</div>
      </aside>
      <div>
        <header class="topbar">
          <div class="breadcrumbs">
            <a href="#profiles">${currentSave.name}</a> <span aria-hidden="true"> / </span>
            ${phaseLabel(phase())}
          </div>
          <label class="small"
            >Working on
            <select
              id="phase-picker"
              aria-label="Working phase"
              ${!currentSave.id && raw('disabled')}
            >
              ${phaseOptions().map(
                p =>
                  html`<option value="${p}" ${phase() === p && raw('selected')}>
                    ${phaseLabel(p)}
                  </option>`,
              )}
            </select></label
          >
        </header>
        <main id="main" class="workspace" tabindex="-1"></main>
      </div>
    </div>`,
  );

// Redraws the whole page for the current `view` from session state. Called after every
// change (save, navigation, toggles). Everything is rebuilt through innerHTML, so it keeps
// what a rebuild would lose: open step <details>, the focused field and its caret.
export function render() {
  const open = [...document.querySelectorAll('details[open][data-task]')].map(x => x.dataset.task);
  const focused = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  $('#app').innerHTML = shell();
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
  saveIndicator();
}
