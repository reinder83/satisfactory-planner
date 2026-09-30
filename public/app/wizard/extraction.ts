// Resource survey: node counts, presets and extraction budgets. Opened from
// wizard step 4 ("Work these out from my nodes"), it takes over the screen by
// setting wizard.mode = 'extraction', which ui/pages/SurveyPage.vue draws; its
// controls are handled there and in ui/survey/. This module keeps the draft.
// Draft fields it adds to `wizard`: extraction (the survey being edited),
// extractionStep (1-4), extractionReturn (where to go back to) and
// extractionUndo with extractionUndoKind (the counts before "Reset all counts", or typed
// counts a refill replaced).
import {
  blankCounts,
  blankExtraction,
  extractionLimits,
  matchingPreset,
  presetSurvey,
  purities3,
  startingSurvey,
} from '../../preferences.ts';
import { toast } from '../api.ts';
import { $ } from '../format.ts';
import { draft, wizard, workspace } from '../session.ts';
import { render } from '../shell.ts';
import { readGuidedForm } from './guided.ts';
import { noteWizardEdit, readWizard, wizardBusy, type Survey, type WizardDraft } from './wizard.ts';
import type { Distribution, NodeCounts, Purity } from '../../types/index.ts';

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
export function extractionOf(wizardDraft: WizardDraft): Survey {
  return (wizardDraft.extraction ??= wizardDraft.settings.extraction
    ? structuredClone(wizardDraft.settings.extraction)
    : startingSurvey(wizardDraft.settings));
}

// Back to an empty survey. Every count goes, including what was already
// committed; the miner mark and clock stay, because they are equipment rather
// than counts and have no meaningful zero. The old counts are kept aside so the
// clearing can be undone, which is why no confirmation is asked for.
export function resetExtraction() {
  const wizardDraft = draft();
  noteWizardEdit();
  const previous = extractionOf(wizardDraft);
  wizardDraft.extractionUndo = JSON.parse(JSON.stringify(previous));
  wizardDraft.extractionUndoKind = 'reset';
  wizardDraft.extraction = { ...blankExtraction(), mark: previous.mark, clock: previous.clock };
}

// The survey's purity or distribution changed to a fully known world: every count is refilled
// from that world's preset. Counts that match no preset were typed by hand (a reading of a
// Random world, say), so they are kept aside to undo, as a reset's are. A preset's own counts,
// or none at all, lose nothing: any earlier undo is kept, so a reset or typed counts stay
// recoverable through several refills in a row (arrowing through the select changes it once
// per step).
export function refillExtraction() {
  const wizardDraft = draft(),
    settings = wizardDraft.settings;
  const previous = extractionOf(wizardDraft);
  const counted = [previous.nodes, previous.wells].some(map =>
    Object.values(map || {}).some(c => c.impure || c.normal || c.pure),
  );
  // matchingPreset compares the ordinary nodes only. On the default distribution the refill also
  // replaces nitrogen, so a nitrogen row that differs from the matched preset's was typed too.
  const preset = matchingPreset(previous);
  const countsKey = (counts?: NodeCounts) =>
    [counts?.impure || 0, counts?.normal || 0, counts?.pure || 0].join();
  const nitrogenTyped =
    !!preset &&
    settings.distribution === 'original' &&
    countsKey(previous.wells?.['Nitrogen Gas']) !==
      countsKey(presetSurvey(preset).wells['Nitrogen Gas']);
  if (counted && (!preset || nitrogenTyped)) {
    wizardDraft.extractionUndo = JSON.parse(JSON.stringify(previous));
    wizardDraft.extractionUndoKind = 'refill';
  }
  wizardDraft.extraction = presetSurvey(settings.purity, previous, settings.distribution);
}

// Put back the counts resetExtraction or refillExtraction set aside; offered until the survey
// closes.
export function undoExtractionReset() {
  const wizardDraft = draft();
  if (!wizardDraft.extractionUndo) return;
  wizardDraft.extraction = wizardDraft.extractionUndo;
  wizardDraft.extractionUndo = null;
}

// Every screen writes straight into the survey, so moving between them keeps
// what was typed even before the budgets are applied.
// Exception: purity and distribution are the step 1 settings themselves, so they
// are written to wizard.settings at once, even if the survey is left unapplied.
// Counts are whole and non-negative; an all-zero row is dropped from the map.
export function readExtraction(form: HTMLFormElement) {
  const wizardDraft = draft(),
    survey = extractionOf(wizardDraft),
    formData = new FormData(form);
  const raw = new Set(workspace.catalog.raw || []);
  for (const [field, value] of formData) {
    // The two selects offer only the presets' own values; calculate() checks them again.
    if (field === 'purity') wizardDraft.settings.purity = String(value) as Purity;
    else if (field === 'distribution')
      wizardDraft.settings.distribution = String(value) as Distribution;
    else if (field === 'mark') survey.mark = Number(value);
    else if (field === 'clock') survey.clock = Number(value);
    else if (field.startsWith('node:') || field.startsWith('well:')) {
      const [kind = '', name = '', purity = ''] = field.split(':');
      if (!raw.has(name) || !purities3.some(([p]) => p === purity)) continue;
      const map = kind === 'well' ? (survey.wells ??= {}) : (survey.nodes ??= {});
      const row: NodeCounts = map[name] || blankCounts();
      row[purity as keyof NodeCounts] = Math.max(0, Math.floor(Number(value) || 0));
      if (row.impure || row.normal || row.pure) map[name] = row;
      else delete map[name];
    } else if (field.startsWith('used:')) {
      const name = field.slice(5);
      if (!raw.has(name)) continue;
      const rate = Number(value);
      if (String(value).trim() !== '' && Number.isFinite(rate) && rate > 0)
        (survey.used ??= {})[name] = rate;
      else delete survey.used?.[name];
    }
  }
}

// Go to survey screen `target`. Below 1 leaves without applying; past the last
// screen applies the survey to settings.limits and leaves.
export async function moveExtraction(target: number) {
  const wizardDraft = wizard,
    form = $<HTMLFormElement>('#wizard-form');
  if (wizardBusy || !wizardDraft || target === wizardDraft.extractionStep) return;
  if (form && target > (wizardDraft.extractionStep ?? 1) && !form.reportValidity()) return;
  if (form) readExtraction(form);
  if (target < 1) {
    leaveExtraction();
    return;
  }
  if (target <= EXTRACTION_STEPS.length) {
    wizardDraft.extractionStep = target;
    render();
    return;
  }
  // Applying the survey replaces the budgets and the confirmation that went with
  // them: these are counted numbers now, not the starting estimates.
  wizardDraft.settings.limits = extractionLimits(
    wizardDraft.extraction,
    wizardDraft.settings.limits,
  );
  wizardDraft.settings.extraction = structuredClone(wizardDraft.extraction);
  wizardDraft.settings.limitsConfirmed = true;
  noteWizardEdit();
  wizardDraft.preview = null;
  leaveExtraction();
  toast('Resource budgets set from your nodes. You can still edit any of them in All settings.');
}

// Back to whatever opened the survey, with the five-step wizard as the default.
export function leaveExtraction() {
  const wizardDraft = draft();
  wizardDraft.mode = wizardDraft.extractionReturn?.mode || 'advanced';
  wizardDraft.step = wizardDraft.extractionReturn?.step || 4;
  if (wizardDraft.extractionReturn?.guidedStep)
    wizardDraft.guidedStep = wizardDraft.extractionReturn.guidedStep;
  wizardDraft.extractionReturn = null;
  wizardDraft.extractionUndo = null;
  render();
}

// Start the survey: read the current form into the draft first, and remember
// where we came from so leaveExtraction can return there.
export function openExtraction() {
  const wizardDraft = draft(),
    form = $<HTMLFormElement>('#wizard-form');
  if (form) wizardDraft.mode === 'guided' ? readGuidedForm(form) : readWizard(form);
  wizardDraft.extractionReturn = {
    mode: wizardDraft.mode,
    step: wizardDraft.step,
    guidedStep: wizardDraft.guidedStep,
  };
  wizardDraft.mode = 'extraction';
  wizardDraft.extractionStep = 1;
  render();
}
