// The page frame (sidebar, header, profile footer) and the router that renders a view.
import { browserMode } from '../browser-api.js';
import { purities } from '../preferences.js';
import { adaPanel } from './ada-panel.js';
import { saveIndicator } from './api.js';
import { $, esc, num } from './format.js';
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

export function header(eyebrow, title, subtitle = '', badge = '') {
  return `<div class="heading-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}</div>${badge ? `<span class="badge orange">${badge}</span>` : ''}</div>`;
}

function profileFooter() {
  if (calculated) {
    const s = calculated.settings;
    const date = new Date(calculated.createdAt);
    return `${esc(currentProfile.name)}<br>${esc(purities.find(([id]) => id === s.purity)?.[1] || s.purity)} purity · ${num(s.multiplier)}× elevator parts<br>${num(s.powerFactor)}× power consumption${Number.isNaN(date.getTime()) ? '' : '<br>Plan created ' + esc(date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}`;
  }
  if (currentProfile?.kind === 'original')
    return `${esc(currentProfile.name)}<br>Pure nodes · 50× elevator parts<br>Half power consumption<br>Plan revised 13 September 2026`;
  return 'Create or select a profile';
}

const shell = () =>
  `<div class="layout"><aside class="sidebar"><div class="brand"><img src="./favicon.svg" alt=""><div>Project Assembly<div class="eyebrow">FICSIT compliance terminal</div></div></div><nav class="nav" aria-label="Main navigation">${[
    ['plan', '◫', 'Build plan'],
    ['factories', '▥', 'Factories'],
    ['storage', '▦', 'Storage room'],
    ['resources', '↗', 'Power & resources'],
    ['backup', '⇅', 'Backup & notes'],
  ]
    .map(
      ([id, icon, label]) =>
        `<a href="#${id}" class="${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''}><span class="navicon" aria-hidden="true">${icon}</span>${label}</a>`,
    )
    .join(
      '',
    )}</nav>${adaPanel()}<div class="save-status"><span class="dot"></span><span id="saved">${browserMode ? 'Saved in this browser' : 'Saved on server'}</span></div><div class="sidebar-foot">${profileFooter()}</div></aside><div><header class="topbar"><div class="breadcrumbs"><a href="#profiles">${esc(currentSave.name)}</a> <span aria-hidden="true"> / </span> ${phaseLabel(phase())}</div><label class="small">Working on <select id="phase-picker" aria-label="Working phase" ${!currentSave.id ? 'disabled' : ''}>${phaseOptions()
    .map(p => `<option value="${p}" ${phase() === p ? 'selected' : ''}>${phaseLabel(p)}</option>`)
    .join(
      '',
    )}</select></label></header><main id="main" class="workspace" tabindex="-1"></main></div></div>`;

export function render() {
  const open = [...document.querySelectorAll('details[open][data-task]')].map(x => x.dataset.task);
  const focused = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  $('#app').innerHTML = shell();
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
