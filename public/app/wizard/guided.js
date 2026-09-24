// Guided start: the short question sequence in front of the wizard. It is the
// default for a new profile (startWizard sets mode 'guided'). The questions and
// the settings each answer writes are data in preferences.js (guidedQuestions,
// guidedStandingQuestion); this module sequences, draws and reads them. Draft
// fields used: guidedStep (1-based index into guidedFlow()), guidedAsk, tutorial.
// Continue is the #wizard-form submit (events/profiles.js -> moveGuided).
import { browserMode } from '../../browser-api.js';
import {
  GUIDED_TOPUP_RATE,
  guidedQuestions,
  guidedStandingQuestion,
  guidedTopupItems,
  storageOptions,
  tutorialKeys,
} from '../../preferences.js';
import { $, esc, itemIcon, num } from '../format.js';
import { wizard, workspace } from '../session.js';
import { header, render } from '../shell.js';
import { browserNotice } from '../views/backup.js';
import { field, help } from './fields.js';
import { readSupply, supplyRowsHtml } from './supply.js';
import { calculateWizard, readWizard, wizardBusy } from './wizard.js';

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
const GUIDED_GLYPHS = {
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

// A card's inline SVG from GUIDED_GLYPHS, falling back to the balanced one.
const guidedGlyph = name =>
  `<span class="guided-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GUIDED_GLYPHS[name] || GUIDED_GLYPHS.balanced}</svg></span>`;

// A card's artwork from up to four bundled item icons (the phase cards).
const guidedItemArt = items =>
  `<span class="guided-art items" aria-hidden="true">${items
    .slice(0, 4)
    .map(n => itemIcon(n))
    .join('')}</span>`;

// The questions actually asked. The tutorial/already-built question follows the
// phase because it depends on the answer; for a save that already has profiles
// the Review step's carry panel is the better instrument, so it is left out.
// Order: the preferences.js list (phase, goal, recipes, stock, exact), with the
// tutorial question (Phase 1) or the "already producing" question (later
// phases) inserted after phase for a new save. When wizard.guidedAsk is set
// (the "What is different" screen), only those ids are kept. renderWizard and
// the submit handler compare guidedStep with this length to know when the
// questions are finished; ada-panel.js reads it too.
export function guidedFlow() {
  const w = wizard,
    list = [];
  for (const q of guidedQuestions) {
    list.push(q);
    if (q.id === 'phase' && !w.saveId)
      list.push(guidedStandingQuestion(String(w.settings.phase || '3')));
  }
  return w.guidedAsk ? list.filter(q => w.guidedAsk.includes(q.id)) : list;
}

// The option value currently chosen for a question, derived from the settings
// (so a change made in All settings shows up here). 'tutorial' lives on the
// draft rather than the settings. No question has the id 'standing'.
const guidedAnswer = q => {
  const w = wizard,
    s = w.settings;
  if (q.id === 'tutorial') return w.tutorial || 'doing';
  if (q.id === 'standing') return w.standing || 'none';
  if (q.id === 'exact') return s.wholeMachines === false ? 'precise' : 'whole';
  if (q.id === 'stock')
    return q.options.some(o => o.value === s.storage) ? s.storage : 'construction';
  return String(s[q.id] ?? '');
};

// A question's options as radio cards named "guided:<id>", read by readGuided.
function guidedCardsHtml(q) {
  const picked = guidedAnswer(q);
  return `<div class="guided-grid">${q.options
    .map(
      o => `<label class="guided-card${o.value === picked ? ' is-picked' : ''}">
  <input type="radio" name="guided:${q.id}" value="${esc(o.value)}" aria-label="${esc(o.label + '. ' + o.detail)}" ${o.value === picked ? 'checked' : ''}>
  ${o.items ? guidedItemArt(o.items) : guidedGlyph(o.glyph)}
  <strong>${esc(o.label)}</strong><p>${esc(o.detail)}</p>
  ${o.handoff ? '<span class="badge">Opens All settings</span>' : ''}
 </label>`,
    )
    .join('')}</div>`;
}

// The materials you carry out by hand. A floor for one of them costs about 1%
// more buildings; the general construction rate that would reach the same
// number costs 81-425%, because it applies to all eighteen at once.
// Checkboxes named "topup"; readGuided turns the ticked ones into
// storageOverrides of GUIDED_TOPUP_RATE each. Only on the stock question.
function guidedTopupHtml(s) {
  if (s.storage === 'none') return '';
  const over = s.storageOverrides || {};
  return `<fieldset class="guided-topup"><legend>Which of these do you keep running out of? ${help('guidedTopup')}</legend>
 <p class="small muted">Containers fill from surplus on their own — a default Phase 3 plan already spills 29 Wire and 19 Iron Plate a minute into storage. These get a guaranteed ${num(GUIDED_TOPUP_RATE)}/min on top, which costs about 1% more buildings each. Concrete is picked for you because it is the one the plan leaves least spare.</p>
 <div class="guided-chips">${guidedTopupItems.map(n => `<label class="guided-chip${over[n] !== undefined ? ' is-picked' : ''}"><input type="checkbox" name="topup" value="${esc(n)}" aria-label="Guarantee ${num(GUIDED_TOPUP_RATE)} ${esc(n)} a minute" ${over[n] !== undefined ? 'checked' : ''}>${itemIcon(n)}<span>${esc(n)}</span></label>`).join('')}</div></fieldset>`;
}

// A second profile for a save you already play starts from the settings of the
// profile you are on, so the useful question is what changed rather than all of
// them again.
// Shown instead of a question while wizard.saveId is set and guidedAsk is null.
// Ticked "topic" boxes become wizard.guidedAsk, which narrows guidedFlow().
function guidedTopicsHtml() {
  const w = wizard,
    s = w.settings,
    save = workspace.saves.find(x => x.id === w.saveId);
  const from =
    save?.profiles.find(p => p.id === (w.carryFrom || save.activeProfile)) || save?.profiles[0];
  const known = [
    ['Phase', 'Phase ' + (s.phase || '3')],
    ['Goal', (workspace.catalog.goals.find(g => g.id === s.goal) || {}).name || s.goal],
    [
      'Recipes',
      s.recipes === 'all'
        ? 'All alternates'
        : s.recipes === 'custom'
          ? num((s.alternateRecipes || []).length) + ' picked'
          : 'Standard only',
    ],
    ['Stocked', (storageOptions.find(([v]) => v === s.storage) || [, s.storage])[1]],
    ['Machines', s.wholeMachines === false ? 'Exact ratios' : 'Whole machines'],
  ];
  return `<h2>What is different this time?</h2>
 <p>Starting from the settings of <b>${esc(from?.name || 'this save')}</b>. Tick only what changes; the rest is kept as it is.</p>
 <div class="guided-known">${known.map(([k, v]) => `<span><b>${esc(k)}</b>${esc(v)}</span>`).join('')}</div>
 <div class="guided-topics">${guidedQuestions.map(q => `<label class="check-row"><input type="checkbox" name="topic" value="${q.id}" ${q.id === 'phase' ? 'checked' : ''}>${esc(q.title)}</label>`).join('')}</div>
 <p class="small muted">Progress from ${esc(from?.name || 'the other profile')} can be carried over on the Review step, including the production lines this plan does not expand.</p>`;
}

// The checklist keys a new profile should start with. The Phase 1 HUB steps are
// the only ones a guided answer can tick: everything else it learns is a rate,
// which changes the plan rather than its progress.
// Sent as `built` by the profile-create submit (events/profiles.js), which also
// passes the form; only `w` is used.
export function guidedBuiltKeys(w) {
  return w.tutorial === 'done' ? [...tutorialKeys] : [];
}

// Copy the current guided screen into the draft. The mapping from answer to
// settings is the chosen option's `set` object (preferences.js), merged into
// wizard.settings: the same fields All settings writes (phase, goal, recipes,
// pureIngots, storage, collectables, wholeMachines). The tutorial answer is kept
// on the draft instead. Clears the preview, so Review must recalculate.
function readGuided(form) {
  const w = wizard,
    s = w.settings,
    f = new FormData(form);
  if (form.querySelector?.('.guided-topics')) {
    const on = f.getAll('topic').map(String);
    w.guidedAsk = guidedQuestions.filter(q => on.includes(q.id)).map(q => q.id);
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
    const over = {};
    for (const n of chosen) over[n] = GUIDED_TOPUP_RATE;
    s.storageOverrides = over;
  }
  if (s.goal !== 'timed') s.phaseTime = 'every';
  if (s.storage === 'none') s.storageOverrides = {};
  w.preview = null;
}

// The row of question names above the form, marking done and current ones.
function guidedProgressHtml(flow, index) {
  return `<div class="guided-progress" role="list">${flow.map((q, i) => `<span role="listitem" class="${i === index ? 'current' : i < index ? 'done' : ''}" ${i === index ? 'aria-current="step"' : ''}><i></i>${esc(q.short || q.title.replace(/\?$/, ''))}</span>`).join('')}</div>`;
}

// HTML for the guided screen: the "What is different" topics screen, the
// question at guidedStep, or "Ready to calculate" when no questions remain.
// The name box is the save name for a new save and the profile name otherwise.
// "All settings" jumps to the five-step wizard step that owns this question.
export function renderGuided() {
  const w = wizard,
    s = w.settings,
    flow = guidedFlow();
  const topics = w.saveId && w.guidedAsk === null;
  const index = topics ? -1 : Math.min(w.guidedStep - 1, flow.length - 1);
  const q = topics ? null : flow[index];
  let content;
  if (topics) content = guidedTopicsHtml();
  else if (!q) content = '<h2>Ready to calculate</h2>';
  else
    content =
      `<h2>${esc(q.title)}</h2><p>${esc(q.lead)}</p>` +
      (q.kind === 'supply' ? supplyRowsHtml(s) : guidedCardsHtml(q)) +
      (q.id === 'goal' && s.goal === 'timed'
        ? `<div class="form-grid guided-follow">${field('Hours per phase', 'hours', s.hours ?? 8, 'number', 'min="0.25" max="2000" step="0.25" required')}</div>`
        : '') +
      (q.id === 'stock' ? guidedTopupHtml(s) : '');
  const last = topics ? false : index >= flow.length - 1;
  const advancedStep = q?.step || 1;
  return (
    (browserMode ? browserNotice() : '') +
    header(
      'A FEW QUESTIONS',
      w.saveId ? 'Add a profile to ' + esc(w.saveName) : 'Create your factory plan',
      'Answer what matters and the planner fills in the rest. Every setting is still there under All settings.',
    ) +
    (topics ? '' : guidedProgressHtml(flow, index)) +
    `<form id="wizard-form" class="panel wizard-panel guided-panel">
   ${topics ? '' : `<label class="field guided-name">${w.saveId ? 'Profile name' : 'Save name'}<input name="${w.saveId ? 'profileName' : 'saveName'}" type="text" value="${esc(w.saveId ? w.name : w.saveName)}" ${w.saveId ? '' : 'required'} maxlength="80" placeholder="${w.saveId ? 'Named after your goal if left blank' : 'My Satisfactory save'}"></label>`}
   ${content}
   <div class="wizard-actions">
    <button type="button" class="btn" ${topics || w.guidedStep <= 1 ? 'data-cancel-wizard' : 'data-guided-back'}>${topics || w.guidedStep <= 1 ? 'Cancel' : 'Back'}</button>
    <span class="guided-escape"><button type="button" class="btn quiet" data-guided-advanced="${advancedStep}">All settings →</button>
    <button class="btn primary" type="submit">${last ? 'Calculate plan' : 'Continue →'}</button></span>
   </div>
   <p id="wizard-error" class="form-error" role="alert"></p>
  </form>`
  );
}

// Go to question `target` (1-based): read the screen, then re-render, hand over
// to All settings, or, past the last question, calculate and show Review.
// Forward moves must pass the form's own validation first.
export async function moveGuided(target) {
  const w = wizard,
    form = $('#wizard-form');
  if (wizardBusy || !w) return;
  if (target > w.guidedStep && form && !form.reportValidity()) return;
  // "What is different this time?" chooses which questions follow, so leaving it
  // starts that list at the beginning rather than stepping past it.
  const wasTopics = !!w.saveId && w.guidedAsk === null;
  if (form) readGuidedForm(form);
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
// Also used by the survey and supply code before they re-render.
export function readGuidedForm(form) {
  const w = wizard,
    f = new FormData(form);
  if (f.has('saveName')) w.saveName = String(f.get('saveName'));
  if (f.has('profileName')) w.name = String(f.get('profileName'));
  readGuided(form);
}

// Switching to All settings keeps every answer: both modes write the same
// settings object, so nothing is recalculated or lost either way.
// Lands on `step`, clamped to 1-4: Review is only reached by calculating.
export function toAdvanced(step) {
  const w = wizard;
  const form = $('#wizard-form');
  if (form && w.mode === 'guided') readGuidedForm(form);
  w.mode = 'advanced';
  w.usedGuided = true;
  w.step = Math.min(Math.max(step || 1, 1), 4);
  render();
}

// "← Guided start" from the five-step wizard: read that form, then resume the
// questions at the last guided step, clamped to the current flow.
export function toGuided() {
  const w = wizard;
  const form = $('#wizard-form');
  if (form && w.mode !== 'guided') readWizard(form);
  w.mode = 'guided';
  const flow = guidedFlow();
  if (!(w.guidedStep >= 1)) w.guidedStep = 1;
  w.guidedStep = Math.min(w.guidedStep, Math.max(flow.length, 1));
  render();
}
