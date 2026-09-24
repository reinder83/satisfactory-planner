// Existing-production rows ("Production you already run") and their item search.
// Shown on wizard step 1 and as the guided "What are you already producing?"
// question. Two things are kept apart: wizard.supplyRows, the rows as typed
// (possibly half-finished), and settings.existingSupply, the { item: rate } map
// the planner receives. The rows and their item search are drawn and handled by
// ui/wizard/SupplyRows.vue.
import { wizard, workspace } from '../session.js';
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
export function supplyMatches(query) {
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
// kept on the draft; readSupply and removeSupplyRow edit it.
export function supplyRows(w) {
  if (!Array.isArray(w.supplyRows))
    w.supplyRows = Object.entries(w.settings.existingSupply || {}).map(([name, rate]) => ({
      name,
      rate: String(rate),
    }));
  return w.supplyRows;
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

// Reads the screen the rows are on into the draft: the guided question or All settings
// step 1. Before a redraw, so what was typed elsewhere on the screen is kept.
export function readScreen(form) {
  if (form) wizard.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
}

// "Remove" on row `index`: drop it and rebuild existingSupply from the rest, keeping known
// items with a rate above 0. The preview no longer matches, so it is cleared.
export function removeSupplyRow(form, index) {
  readScreen(form);
  const rows = supplyRows(wizard);
  rows.splice(index, 1);
  wizard.settings.existingSupply = Object.fromEntries(
    rows
      .filter(r => Number(r.rate) > 0)
      .map(r => [r.name.trim(), Number(r.rate)])
      .filter(([n]) => (workspace.catalog.supplyItems || []).includes(n)),
  );
  wizard.preview = null;
}
