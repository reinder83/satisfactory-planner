// Existing-production rows ("Production you already run") and their item search.
// Shown on wizard step 1 and as the guided "What are you already producing?"
// question. Two things are kept apart: wizard.supplyRows, the rows as typed
// (possibly half-finished), and settings.existingSupply, the { item: rate } map
// the planner receives. Keyboard and input handlers live in events/views.js.
import { $, esc, itemIcon } from '../format.js';
import { wizard, workspace } from '../session.js';
import { render } from '../shell.js';
import { readGuidedForm } from './guided.js';
import { readWizard } from './wizard.js';

// Production you already run, entered as a rate. Matching an existing factory
// against the plan's own rows does not work — your Modular Frame line is
// whatever recipe and machine count you happened to build, not the one this
// solve would pick — so the honest input is the number you can read off your
// own factory. The planner credits it and drops the chain behind it.
//
// One row per declared item plus a blank one, so there is nothing to press
// before typing and no way to leave a half-finished row behind.
// Suggestions are drawn in the page rather than by a native <datalist>: that
// popup is browser chrome, so it cannot be themed, cannot be read back, and
// Chrome suppresses it outright on an input with autocomplete off. A list we
// own works the same everywhere and can be driven from the keyboard.
const SUPPLY_SUGGESTIONS = 8;

// Up to SUPPLY_SUGGESTIONS catalog items for the typed text, case-insensitive:
// names that start with it first, then names that merely contain it.
function supplyMatches(query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const starts = [],
    contains = [];
  for (const n of workspace.catalog.supplyItems || []) {
    const l = n.toLowerCase();
    if (l.startsWith(q)) starts.push(n);
    else if (l.includes(q)) contains.push(n);
  }
  return [...starts, ...contains].slice(0, SUPPLY_SUGGESTIONS);
}

// The rows being edited, which is not the same thing as the rows that count. A
// half-finished row — a name with no rate yet — has to survive a re-render, or
// picking a suggestion would erase what you just picked.
// Created lazily from settings.existingSupply the first time it is needed, then
// kept on the draft; readSupply and the Remove button (events/views.js) edit it.
export function supplyRows(w) {
  if (!Array.isArray(w.supplyRows))
    w.supplyRows = Object.entries(w.settings.existingSupply || {}).map(([name, rate]) => ({
      name,
      rate: String(rate),
    }));
  return w.supplyRows;
}

// HTML for the rows plus one blank row to type into. `s` is unused: the rows come
// from wizard.supplyRows. Each row pairs a supplyItem and a supplyRate input.
export function supplyRowsHtml(s) {
  const rows = [...supplyRows(wizard), { name: '', rate: '' }];
  const known = new Set(workspace.catalog.supplyItems || []);
  // The icon is kept in step while you type too, so it appears the moment what
  // you have typed is a real item rather than only once the field is committed.
  const hint = r =>
    !r.name.trim()
      ? ''
      : !known.has(r.name.trim())
        ? '<span class="supply-hint warn">No item of that name — pick one from the list.</span>'
        : !String(r.rate).trim()
          ? '<span class="supply-hint">Add a rate and this line is credited; leave it blank and it is not.</span>'
          : '';
  const row = (r, i) => `<div class="supply-row" data-supply-row="${i}">
  <div class="supply-field">
   <label class="field">Item<span class="supply-input${known.has(r.name.trim()) ? ' has-icon' : ''}" data-icon="${known.has(r.name.trim()) ? esc(r.name.trim()) : ''}">${known.has(r.name.trim()) ? itemIcon(r.name.trim()) : ''}<input name="supplyItem" value="${esc(r.name)}" maxlength="80" autocomplete="off" spellcheck="false" placeholder="Search item" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="supply-options-${i}" aria-label="Search for an item you already produce"></span></label>
   <div class="supply-options" id="supply-options-${i}" role="listbox" hidden></div>
  </div>
  <label class="field">Per minute<input name="supplyRate" type="number" min="0" max="1000000" step="any" value="${esc(r.rate)}" aria-label="Rate you already produce, per minute"></label>
  <button type="button" class="btn quiet supply-remove${r.name.trim() ? '' : ' is-blank'}" data-supply-remove="${i}" ${r.name.trim() ? `aria-label="Remove ${esc(r.name)}"` : 'tabindex="-1" aria-hidden="true"'}>Remove</button>
  ${hint(r)}
 </div>`;
  return `<div class="supply-picker">
  <div class="supply-list">${rows.map(row).join('')}</div>
  <p class="small muted">The plan credits these and builds only the remainder — and it does not build the chain behind them either. What you make it with is your business: the recipe and machine count do not have to match anything this plan would choose. Their ore and their power are already spent in your world, so enter your resource budgets and spare power net of them, exactly as for any other existing factory.</p>
 </div>`;
}

// Returns null when the form has no supply list (another step), so callers
// leave settings.existingSupply as it was; otherwise the credited map.
// Side effect: replaces wizard.supplyRows with the non-empty rows as typed.
// Name plus rate, paired by position. Every row is kept for editing; only the
// ones naming a real item at a real rate are handed to the planner.
export function readSupply(form, f) {
  if (!form?.querySelector?.('.supply-list')) return null;
  const known = new Set(workspace.catalog.supplyItems || []);
  const names = f.getAll('supplyItem').map(x => String(x));
  const rates = f.getAll('supplyRate').map(x => String(x));
  const rows = names
    .map((name, i) => ({ name, rate: rates[i] ?? '' }))
    .filter(r => r.name.trim() || String(r.rate).trim());
  wizard.supplyRows = rows;
  const out = {};
  for (const r of rows) {
    const name = r.name.trim(),
      q = Number(r.rate);
    if (known.has(name) && String(r.rate).trim() !== '' && Number.isFinite(q) && q > 0)
      out[name] = q;
  }
  return out;
}

// Fill a row's suggestion list in place. Re-rendering the whole screen on every
// keystroke would take the focus with it.
export function showSupplyOptions(input) {
  const field = input.closest('.supply-field');
  if (!field) return;
  const box = field.querySelector('.supply-options');
  if (!box) return;
  const matches = supplyMatches(input.value).filter(
    n => n.toLowerCase() !== input.value.trim().toLowerCase(),
  );
  if (!matches.length) {
    hideSupplyOptions(input);
    return;
  }
  box.innerHTML = matches
    .map(
      n =>
        `<button type="button" role="option" aria-selected="false" class="supply-option" data-supply-pick="${esc(n)}">${itemIcon(n)}<span>${esc(n)}</span></button>`,
    )
    .join('');
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

// Typing updates the suggestion list without redrawing the screen, so the icon
// beside the field has to be kept in step the same way.
export function syncSupplyIcon(input) {
  const wrap = input.closest('.supply-input');
  if (!wrap) return;
  const typed = input.value.trim();
  const name = (workspace.catalog.supplyItems || []).includes(typed) ? typed : '';
  if (wrap.dataset.icon === name) return;
  wrap.dataset.icon = name;
  wrap.querySelector('.item-icon')?.remove();
  wrap.classList.toggle('has-icon', !!name);
  if (name) wrap.insertAdjacentHTML('afterbegin', itemIcon(name));
}

// Close and empty a row's suggestion list.
export function hideSupplyOptions(input) {
  const box = input?.closest('.supply-field')?.querySelector('.supply-options');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  input?.setAttribute('aria-expanded', 'false');
}

// Picking a suggestion commits it and moves to the rate, which is the next
// thing you were going to type anyway.
// Re-reads the whole form into the draft and re-renders; the row index is what
// finds its rate field again afterwards.
export function pickSupplyOption(button) {
  const field = button.closest('.supply-field'),
    input = field?.querySelector('input[name=supplyItem]');
  if (!input) return;
  // Read the row before closing the list: emptying it orphans this button.
  const index = Number(button.closest('.supply-row')?.dataset.supplyRow ?? -1);
  input.value = button.dataset.supplyPick;
  hideSupplyOptions(input);
  const form = $('#wizard-form');
  if (form) wizard.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
  render();
  [...document.querySelectorAll('.supply-row')][index]
    ?.querySelector('input[name=supplyRate]')
    ?.focus();
}
