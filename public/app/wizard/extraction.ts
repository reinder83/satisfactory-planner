// Resource survey: node counts, presets and extraction budgets. Opened from
// wizard step 4 ("Work these out from my nodes"), it takes over the screen by
// setting wizard.mode = 'extraction', which ui/pages/SurveyPage.vue draws; its
// controls are handled there and in ui/survey/. This module keeps the draft.
// Draft fields it adds to `wizard`: extraction (the survey being edited),
// extractionStep (1-4), extractionReturn (where to go back to) and
// extractionUndo (the counts before "Reset all counts").
import {
  blankCounts,
  blankExtraction,
  extractionLimits,
  purities3,
  startingSurvey,
} from '../../preferences.js';
import { toast } from '../api.ts';
import { $ } from '../format.ts';
import { draft, wizard, workspace } from '../session.ts';
import { render } from '../shell.ts';
import { readGuidedForm } from './guided.ts';
import { readWizard, wizardBusy, type Survey, type WizardDraft } from './wizard.ts';
import type { NodeCounts } from '../../types/index.ts';

// --- Working out the resource budgets ---------------------------------------
// The thirteen budget boxes want a rate per minute, which nobody knows. What a
// player can actually read off the interactive map is how many impure, normal
// and pure nodes their world holds, so this asks for that and does the
// arithmetic. It writes the same `limits` the boxes write; the survey itself is
// kept on the profile only so it can be reopened and adjusted.
//
// Four short screens rather than one long one: where the numbers come from and
// how you mine, then the ores, then oil and gas, then the total with whatever
// is already spoken for taken off it.
export const EXTRACTION_STEPS = ['How you mine', 'Ore nodes', 'Resource wells', 'Your budgets'];

// The survey being edited, created on first use: a copy of the one saved on the
// settings, or a starting survey for the chosen world settings. Its shape is
// { mark, clock, nodes: { ore: { impure, normal, pure } }, wells: {...}, used }.
// Cached on the draft, so an unapplied survey is still there when reopened.
export function extractionOf(w: WizardDraft): Survey {
  return (w.extraction ??= w.settings.extraction
    ? structuredClone(w.settings.extraction)
    : startingSurvey(w.settings));
}

// Back to an empty survey. Every count goes, including what was already
// committed; the miner mark and clock stay, because they are equipment rather
// than counts and have no meaningful zero. The old counts are kept aside so the
// clearing can be undone, which is why no confirmation is asked for.
export function resetExtraction() {
  const w = draft();
  const previous = extractionOf(w);
  w.extractionUndo = JSON.parse(JSON.stringify(previous));
  w.extraction = { ...blankExtraction(), mark: previous.mark, clock: previous.clock };
}

// Put back the counts resetExtraction set aside; offered until the survey closes.
export function undoExtractionReset() {
  const w = draft();
  if (!w.extractionUndo) return;
  w.extraction = w.extractionUndo;
  w.extractionUndo = null;
}

// Every screen writes straight into the survey, so moving between them keeps
// what was typed even before the budgets are applied.
// Exception: purity and distribution are the step 1 settings themselves, so they
// are written to wizard.settings at once, even if the survey is left unapplied.
// Counts are whole and non-negative; an all-zero row is dropped from the map.
export function readExtraction(form: HTMLFormElement) {
  const w = draft(),
    e = extractionOf(w),
    f = new FormData(form);
  const raw = new Set(workspace.catalog.raw || []);
  for (const [k, v] of f) {
    if (k === 'purity' || k === 'distribution')
      (w.settings as unknown as Record<string, unknown>)[k] = String(v);
    else if (k === 'mark') e.mark = Number(v);
    else if (k === 'clock') e.clock = Number(v);
    else if (k.startsWith('node:') || k.startsWith('well:')) {
      const [kind = '', name = '', purity = ''] = k.split(':');
      if (!raw.has(name) || !purities3.some(([p]) => p === purity)) continue;
      const map = kind === 'well' ? (e.wells ??= {}) : (e.nodes ??= {});
      const row: NodeCounts = map[name] || blankCounts();
      row[purity as keyof NodeCounts] = Math.max(0, Math.floor(Number(v) || 0));
      if (row.impure || row.normal || row.pure) map[name] = row;
      else delete map[name];
    } else if (k.startsWith('used:')) {
      const name = k.slice(5);
      if (!raw.has(name)) continue;
      const q = Number(v);
      if (String(v).trim() !== '' && Number.isFinite(q) && q > 0) (e.used ??= {})[name] = q;
      else delete e.used?.[name];
    }
  }
}

// Go to survey screen `target`. Below 1 leaves without applying; past the last
// screen applies the survey to settings.limits and leaves.
export async function moveExtraction(target: number) {
  const w = wizard,
    form = $<HTMLFormElement>('#wizard-form');
  if (wizardBusy || !w || target === w.extractionStep) return;
  if (form && target > (w.extractionStep ?? 1) && !form.reportValidity()) return;
  if (form) readExtraction(form);
  if (target < 1) {
    leaveExtraction();
    return;
  }
  if (target <= EXTRACTION_STEPS.length) {
    w.extractionStep = target;
    render();
    return;
  }
  // Applying the survey replaces the budgets and the confirmation that went with
  // them: these are counted numbers now, not the starting estimates.
  w.settings.limits = extractionLimits(w.extraction, w.settings.limits);
  w.settings.extraction = structuredClone(w.extraction);
  w.settings.limitsConfirmed = true;
  w.preview = null;
  leaveExtraction();
  toast('Resource budgets set from your nodes. You can still edit any of them in All settings.');
}

// Back to whatever opened the survey, with the five-step wizard as the default.
export function leaveExtraction() {
  const w = draft();
  w.mode = w.extractionReturn?.mode || 'advanced';
  w.step = w.extractionReturn?.step || 4;
  if (w.extractionReturn?.guidedStep) w.guidedStep = w.extractionReturn.guidedStep;
  w.extractionReturn = null;
  w.extractionUndo = null;
  render();
}

// Start the survey: read the current form into the draft first, and remember
// where we came from so leaveExtraction can return there.
export function openExtraction() {
  const w = draft(),
    form = $<HTMLFormElement>('#wizard-form');
  if (form) w.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
  w.extractionReturn = { mode: w.mode, step: w.step, guidedStep: w.guidedStep };
  w.mode = 'extraction';
  w.extractionStep = 1;
  render();
}
