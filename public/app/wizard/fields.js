// Form controls shared by the wizard steps. Each returns an HTML string; the
// `name` a control gets is the key readWizard (wizard.js) reads back, and doubles
// as the helpText key for its ⓘ tooltip. Also imported outside the wizard
// (power by flow.js, calculated.js and ada-panel.js; field by views/account.js).
import { helpText } from '../../preferences.js';
import { esc, num } from '../format.js';

// One <option>, selected when it equals `selected` compared as a string. value
// and label are inserted raw: callers pass fixed text or run esc() themselves.
export const option = (value, label, selected) =>
  `<option value="${value}" ${value === String(selected) ? 'selected' : ''}>${label}</option>`;

// The ⓘ tooltip for a setting, or '' when preferences.js has no help text for it.
export function help(key) {
  return helpText[key]
    ? `<span class="setting-help" tabindex="0" aria-label="${esc(helpText[key])}">ⓘ<span role="tooltip">${esc(helpText[key])}</span></span>`
    : '';
}

// A power figure for display: MW, or GW above 1000 MW.
export const power = mw => num(mw > 1000 ? mw / 1000 : mw) + (mw > 1000 ? ' GW' : ' MW');

// A labelled <input>. `value` is escaped; `extra` is raw attribute text
// (min/max/required/readonly) and must never carry user input.
export function field(label, key, value, type = 'number', extra = '') {
  return `<label class="field">${label} ${help(key)}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

// A labelled <select> from [value, label] pairs; labels are inserted unescaped.
export function selectField(label, key, options, value) {
  return `<label class="field">${label} ${help(key)}<select name="${key}">${options.map(([v, l]) => option(v, l, value)).join('')}</select></label>`;
}
