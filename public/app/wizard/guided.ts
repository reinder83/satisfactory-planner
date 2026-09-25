// Guided start: the short question sequence in front of the wizard. It is the
// default for a new profile (startWizard sets mode 'guided'). The questions and
// the settings each answer writes are data in preferences.js (guidedQuestions,
// guidedStandingQuestion); this module sequences and reads them, and
// ui/pages/GuidedPage.vue (with ui/guided/) draws them. Draft fields used:
// guidedStep (1-based index into guidedFlow()), guidedAsk, guidedTopics, tutorial.
import {
  GUIDED_TOPUP_RATE,
  guidedQuestions,
  guidedStandingQuestion,
  guidedTopupItems,
  tutorialKeys,
} from '../../preferences.js';
import { $ } from '../format.ts';
import { draft, wizard } from '../session.ts';
import { render } from '../shell.ts';
import { readSupply } from './supply.ts';
import { calculateWizard, readWizard, wizardBusy, type WizardDraft } from './wizard.ts';
import type { GuidedQuestion, ItemRates } from '../../types/index.ts';

// --- The guided start -------------------------------------------------------
// A short illustrated sequence that writes the same settings object the
// five-step wizard writes, so a profile created here is indistinguishable from
// one built by hand. "All settings" is offered on every screen and lands on the
// advanced step that owns the same question, keeping the two continuous.
//
// Drawn in repo rather than bundled: there is no game artwork for "build as
// little as possible", and inline SVG themes with currentColor, needs no build
// allowlist entry and raises no attribution question. The concrete questions
// use the item icons already bundled and attributed in icons/sources.json.
export const GUIDED_GLYPHS: Record<string, string> = {
  minimal: '<path d="M4 20h4v-6H4zM10 20h4v-9h-4z"/><path d="M17 5v9M17 14l-2.5-3M17 14l2.5-3"/>',
  balanced: '<path d="M12 4v16M6 20h12"/><path d="M3 9h18"/><path d="M6 9l-3 5h6zM18 9l-3 5h6z"/>',
  timed: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>',
  maximum: '<path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 18l5-6"/><path d="M12 18h.01"/>',
  standard: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 10h8M8 14h5"/>',
  alternates:
    '<path d="M5 19V9a3 3 0 0 1 3-3h11"/><path d="M16 3l3 3-3 3"/><path d="M5 19h6a3 3 0 0 0 3-3v-1"/>',
  custom: '<path d="M4 7h9M4 12h9M4 17h6"/><path d="M15 15l2.5 2.5L22 13"/>',
  'stock-none':
    '<path d="M4 8h16v11H4z"/><path d="M4 8l2-3h12l2 3"/><path d="M9 12h6" opacity=".35"/>',
  'stock-build': '<path d="M4 8h16v11H4z"/><path d="M4 8l2-3h12l2 3"/><path d="M8 12h8M8 15h8"/>',
  'stock-all': '<path d="M3 13h8v7H3zM13 13h8v7h-8z"/><path d="M8 4h8v7H8z"/>',
  whole:
    '<rect x="3" y="7" width="5" height="11"/><rect x="9.5" y="7" width="5" height="11"/><rect x="16" y="7" width="5" height="11"/><path d="M3 4h18"/>',
  precise:
    '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/>',
  tutorial: '<path d="M6 4v16"/><path d="M6 5h11l-2.5 3.5L17 12H6z"/>',
  'tutorial-done':
    '<path d="M6 4v16"/><path d="M6 5h11l-2.5 3.5L17 12H6z"/><path d="M13 18l2 2 4-4"/>',
};

// The questions actually asked. The tutorial/already-built question follows the
// phase because it depends on the answer; for a save that already has profiles
// the Review step's carry panel is the better instrument, so it is left out.
// Order: the preferences.js list (phase, goal, recipes, stock, exact), with the
// tutorial question (Phase 1) or the "already producing" question (later
// phases) inserted after phase for a new save. When wizard.guidedAsk is set
// (the "What is different" screen), only those ids are kept. vuePage (ui/pages.ts)
// and the screens compare guidedStep with this length to know when the questions
// are finished; ada-panel.ts reads it too.
export function guidedFlow(): GuidedQuestion[] {
  const w = draft(),
    ask = w.guidedAsk,
    list: GuidedQuestion[] = [];
  for (const q of guidedQuestions) {
    list.push(q);
    if (q.id === 'phase' && !w.saveId)
      list.push(guidedStandingQuestion(String(w.settings.phase || '3')));
  }
  return ask ? list.filter(q => ask.includes(q.id)) : list;
}

// The option value currently chosen for a question, derived from the settings
// (so a change made in All settings shows up here). 'tutorial' lives on the
// draft rather than the settings.
export const guidedAnswer = (q: GuidedQuestion): string => {
  const w = draft(),
    s = w.settings;
  if (q.id === 'tutorial') return w.tutorial || 'doing';
  if (q.id === 'exact') return s.wholeMachines === false ? 'precise' : 'whole';
  if (q.id === 'stock')
    return q.options?.some(o => o.value === s.storage) ? s.storage : 'construction';
  return String((s as unknown as Record<string, unknown>)[q.id] ?? '');
};

// The checklist keys a new profile should start with. The Phase 1 HUB steps are
// the only ones a guided answer can tick: everything else it learns is a rate,
// which changes the plan rather than its progress.
// Sent as `built` by createProfile (wizard.ts).
export function guidedBuiltKeys(w: WizardDraft): string[] {
  return w.tutorial === 'done' ? [...tutorialKeys] : [];
}

// Copy the current guided screen into the draft. The mapping from answer to
// settings is the chosen option's `set` object (preferences.js), merged into
// wizard.settings: the same fields All settings writes (phase, goal, recipes,
// pureIngots, storage, collectables, wholeMachines). The tutorial answer is kept
// on the draft instead. Clears the preview, so Review must recalculate.
// On the "What is different" screen the ticked topics are kept as guidedTopics,
// so a redraw keeps them; only `topics` (leaving the screen) makes them
// guidedAsk, which ends that screen and narrows guidedFlow().
function readGuided(form: HTMLFormElement, topics: boolean) {
  const w = draft(),
    s = w.settings,
    f = new FormData(form);
  if (form.querySelector?.('.guided-topics')) {
    const on = f.getAll('topic').map(String);
    w.guidedTopics = guidedQuestions.filter(q => on.includes(q.id)).map(q => q.id);
    if (topics) w.guidedAsk = w.guidedTopics;
  }
  for (const q of guidedFlow()) {
    if (!q.options) continue;
    const value = f.get('guided:' + q.id);
    if (value === null) continue;
    const option = q.options.find(o => o.value === String(value));
    if (!option) continue;
    if (q.id === 'tutorial') w.tutorial = option.value;
    Object.assign(s, option.set);
  }
  {
    const supply = readSupply(form, f);
    if (supply) s.existingSupply = supply;
  }
  if (f.has('hours')) s.hours = Number(f.get('hours'));
  // A guided plan never raises the general construction rate: it is the single
  // most expensive control in the app and the per-item floors below do the same
  // job for a fortieth of the buildings.
  if (form.querySelector?.('.guided-topup')) {
    s.storageRate = 1;
    s.buildRate = 1;
    const chosen = f
      .getAll('topup')
      .map(String)
      .filter(n => guidedTopupItems.includes(n));
    const over: ItemRates = {};
    for (const n of chosen) over[n] = GUIDED_TOPUP_RATE;
    s.storageOverrides = over;
  }
  if (s.goal !== 'timed') s.phaseTime = 'every';
  if (s.storage === 'none') s.storageOverrides = {};
  w.preview = null;
}

// Go to question `target` (1-based): read the screen, then re-render, hand over
// to All settings, or, past the last question, calculate and show Review.
// Forward moves must pass the form's own validation first.
export async function moveGuided(target: number) {
  const w = wizard,
    form = $<HTMLFormElement>('#wizard-form');
  if (wizardBusy || !w) return;
  if (target > w.guidedStep && form && !form.reportValidity()) return;
  // "What is different this time?" chooses which questions follow, so leaving it
  // starts that list at the beginning rather than stepping past it.
  const wasTopics = !!w.saveId && w.guidedAsk === null;
  if (form) readGuidedForm(form, { topics: true });
  const flow = guidedFlow();
  if (wasTopics && flow.length) {
    w.guidedStep = 1;
    render();
    return;
  }
  if (target < 1) {
    w.guidedStep = 1;
    render();
    return;
  }
  // A choice that only All settings can answer hands over rather than pretending
  // to ask it here: picking recipes one by one, or confirming resource budgets
  // before maximum output.
  const previous = flow[Math.min(w.guidedStep - 1, flow.length - 1)];
  const handoff = previous?.options?.find(o => o.value === guidedAnswer(previous))?.handoff;
  if (handoff && target > w.guidedStep) {
    toAdvanced(handoff);
    return;
  }
  if (target <= flow.length) {
    w.guidedStep = target;
    render();
    return;
  }
  await calculateWizard(form);
}

// readGuided plus the name box, which every guided screen but the topics one has.
// Also used by the survey and supply code before they re-render. `topics` applies
// the ticked topics (see readGuided): Continue and All settings do, a change does not.
export function readGuidedForm(form: HTMLFormElement, { topics = false } = {}) {
  const w = draft(),
    f = new FormData(form);
  if (f.has('saveName')) w.saveName = String(f.get('saveName'));
  if (f.has('profileName')) w.name = String(f.get('profileName'));
  readGuided(form, topics);
}

// Switching to All settings keeps every answer: both modes write the same
// settings object, so nothing is recalculated or lost either way.
// Lands on `step`, clamped to 1-4: Review is only reached by calculating.
export function toAdvanced(step?: number) {
  const w = draft();
  const form = $<HTMLFormElement>('#wizard-form');
  if (form && w.mode === 'guided') readGuidedForm(form, { topics: true });
  w.mode = 'advanced';
  w.usedGuided = true;
  w.step = Math.min(Math.max(step || 1, 1), 4);
  render();
}

// "← Guided start" from the five-step wizard: read that form, then resume the
// questions at the last guided step, clamped to the current flow.
export function toGuided() {
  const w = draft();
  const form = $<HTMLFormElement>('#wizard-form');
  if (form && w.mode !== 'guided') readWizard(form);
  w.mode = 'guided';
  const flow = guidedFlow();
  if (!(w.guidedStep >= 1)) w.guidedStep = 1;
  w.guidedStep = Math.min(w.guidedStep, Math.max(flow.length, 1));
  render();
}
