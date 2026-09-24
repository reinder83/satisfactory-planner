// Form controls shared by the wizard steps.
import { helpText } from '../../preferences.js';
import { esc, num } from '../format.js';

export const option = (value, label, selected) =>
  `<option value="${value}" ${value === String(selected) ? 'selected' : ''}>${label}</option>`;

export function help(key) {
  return helpText[key]
    ? `<span class="setting-help" tabindex="0" aria-label="${esc(helpText[key])}">ⓘ<span role="tooltip">${esc(helpText[key])}</span></span>`
    : '';
}

export const power = mw => num(mw > 1000 ? mw / 1000 : mw) + (mw > 1000 ? ' GW' : ' MW');

export function field(label, key, value, type = 'number', extra = '') {
  return `<label class="field">${label} ${help(key)}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

export function selectField(label, key, options, value) {
  return `<label class="field">${label} ${help(key)}<select name="${key}">${options.map(([v, l]) => option(v, l, value)).join('')}</select></label>`;
}
