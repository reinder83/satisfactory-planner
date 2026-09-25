// The five-step profile wizard ("All settings"): creating the draft, reading the
// form back into the draft, moving between steps, calculating the Review preview
// and creating the profile. The draft is the `wizard` object in session.js (set
// with setWizard). The guided start (guided.js) and the resource survey
// (extraction.js) edit the same draft. The screens are components:
// ui/pages/WizardPage.vue (the five steps, ui/wizard/), GuidedPage.vue (ui/guided/)
// and SurveyPage.vue (ui/survey/), which read their forms back through the
// readers here and handle their own controls.
import { browserMode } from '../../browser-api.js';
import { GUIDED_TOPUP_RATE, resourceDefaults } from '../../preferences.js';
import { carryOptions } from '../../state.js';
import { allowSwitch, navigate, post, toast } from '../api.js';
import { $, esc, plural } from '../format.js';
import { loadContext, setWizard, setWorkspace, wizard, workspace } from '../session.js';
import { render } from '../shell.js';
import { guidedBuiltKeys, guidedFlow } from './guided.js';
import { readSupply } from './supply.js';

// Copy the carry panel's choices into wizard.carryFrom / wizard.carry. Does
// nothing when the panel is not on screen. Also called by the create submit.
export function readCarry(form, data) {
  const w = wizard;
  if (!form?.querySelector('.carry-list')) return;
  const f = data || new FormData(form),
    on = new Set(f.getAll('carry').map(String));
  w.carryFrom = f.get('carryFrom') || null;
  w.carry = Object.fromEntries(carryOptions.map(([key]) => [key, on.has(key)]));
}

// Open a new draft and show it: saveId null creates a new save, otherwise the
// profile is added to that save. Callers: "Create a save" / "Try another
// profile" buttons (ui/actions.js, ProfilesPage.vue) and session.js when there is no save.
export function startWizard(saveId = null) {
  if (!allowSwitch()) return;
  const existing = workspace.saves.find(s => s.id === saveId);
  const selected = existing?.profiles.find(p => p.id === existing.activeProfile);
  // A new profile for an existing save starts from its active profile's
  // settings (the workspace summary exposes plan.settings). The preserved
  // handbook profile ('original') has no calculated settings, so this literal
  // stands in for the handbook's own assumptions.
  const previous =
    selected?.settings ||
    (selected?.kind === 'original'
      ? {
          phase: '3',
          purity: 'pure',
          distribution: 'randomized',
          multiplier: 50,
          powerFactor: 0.5,
          availablePowerGW: 0,
          recipes: 'all',
          pureIngots: true,
          sam: 'needed',
          nuclear: 'recycle',
          uraniumReactors: 1,
          storage: 'all',
          storageRate: 1,
          cellsPerMinute: 20,
          goal: 'timed',
          hours: 8,
          roundRates: true,
          wholeMachines: true,
          limitsConfirmed: false,
          limits: { ...workspace.catalog.pureLimits },
        }
      : null);
  // The draft. Fields:
  //   step              five-step wizard position, 1-5 (5 = Review)
  //   saveId, saveName  target save (null = create one) and its name
  //   name              profile name; blank takes the goal's name on calculate
  //   settings          everything the planner calculates from; both the guided
  //                     questions and the five steps write it; sent to
  //                     /api/preview and /api/profiles
  //   preview           the last calculated plan, shown on Review; any form
  //                     read clears it. Creating the profile calculates again.
  //   carryFrom, carry  source profile id and carryOptions picks (Review panel)
  //   mode              'guided' | 'advanced' | 'extraction': which screen draws
  //   guidedStep, guidedAsk, tutorial  guided.js state; tutorial also feeds
  //                     guidedBuiltKeys and ada-panel.js
  //   usedGuided        set by toAdvanced; nothing reads it at present
  // Added later: guidedTopics (guided.js), supplyRows (supply.js) and extraction, extractionStep,
  // extractionReturn, extractionUndo (extraction.js).
  setWizard({
    step: 1,
    saveId,
    saveName: existing?.name || '',
    name: '',
    settings: previous
      ? structuredClone(previous)
      : {
          phase: '3',
          purity: 'vanilla',
          distribution: 'original',
          multiplier: 1,
          powerFactor: 1,
          availablePowerGW: 0,
          recipes: 'standard',
          pureIngots: false,
          sam: 'needed',
          nuclear: 'none',
          uraniumReactors: 1,
          storage: 'construction',
          storageRate: 1,
          cellsPerMinute: 0,
          goal: 'balanced',
          hours: 8,
          roundRates: true,
          wholeMachines: true,
          limitsConfirmed: false,
          limits: { ...workspace.catalog.limits },
        },
    preview: null,
    carryFrom: existing?.activeProfile || null,
    carry: Object.fromEntries(carryOptions.map(([key]) => [key, true])),
    // The guided start asks a handful of plain questions and writes the same
    // settings object; All settings is the wizard exactly as it was. A save you
    // already play arrives with settings worth keeping, so it is asked what
    // changed rather than everything again.
    mode: 'guided',
    guidedStep: 1,
    guidedAsk: null,
    usedGuided: false,
    tutorial: 'doing',
  });
  // Fresh settings only: Concrete starts pre-ticked as a guided top-up, and the
  // browser-only edition starts a fresh plan at Phase 1.
  if (!previous) wizard.settings.storageOverrides = { Concrete: GUIDED_TOPUP_RATE };
  if (browserMode && !previous) wizard.settings.phase = '1';
  navigate('wizard');
}

// Copy the five-step form on screen into the draft (all steps share this one
// reader; each only finds its own fields). Mutates wizard and wizard.settings
// and clears the preview. Does not re-render.
export function readWizard(form) {
  const f = new FormData(form),
    w = wizard,
    s = w.settings,
    oldPreset = s.purity + '|' + s.distribution;
  // Name -> setting: MW fields are stored as GW, saveName/profileName go on the
  // draft, "limit:<r>" into s.limits, then numeric, boolean and text settings.
  // Other names (carry, alt, rate:, supply rows, sloop) are handled below.
  for (const [k, v] of f) {
    if (k === 'availablePowerMW') s.availablePowerGW = Number(v) / 1000;
    if (k === 'installedPowerMW') s.installedPowerGW = Number(v) / 1000;
    if (k === 'saveName') w.saveName = v;
    if (k === 'profileName') w.name = v;
    else if (k.startsWith('limit:')) s.limits[k.slice(6)] = Number(v);
    else if (
      [
        'utilityPercent',
        'droneFuelRate',
        'droneBridgeRate',
        'multiplier',
        'powerFactor',
        'availablePowerGW',
        'uraniumReactors',
        'storageRate',
        'buildRate',
        'cellsPerMinute',
        'somersloops',
        'augmenters',
        'fueledAugmenters',
        'amplifySloops',
        'hours',
      ].includes(k)
    )
      s[k] = Number(v);
    else if (k === 'collectables') s.collectables = v === 'true';
    else if (k === 'pureIngots') s[k] = v === 'true';
    else if (
      [
        'phase',
        'purity',
        'distribution',
        'recipes',
        'sam',
        'nuclear',
        'storage',
        'goal',
        'phaseTime',
        'modNotes',
        'mainPower',
        'worldSeed',
        'droneFuel',
      ].includes(k)
    )
      s[k] = v;
  }
  if (form.querySelector('[name=sloop]')) s.sloopReserved = f.getAll('sloop').map(String);
  if (form.querySelector('.alt-list')) {
    s.alternateRecipes = f.getAll('alt').map(String);
    s.preferredRecipes = f
      .getAll('altpref')
      .map(String)
      .filter(id => s.alternateRecipes.includes(id));
  }
  {
    const supply = readSupply(form, f);
    if (supply) s.existingSupply = supply;
  }
  if (form.querySelector('.rate-list')) {
    const over = {};
    for (const [k, v] of f)
      if (k.startsWith('rate:') && String(v).trim() !== '' && Number.isFinite(Number(v)))
        over[k.slice(5)] = Number(v);
    s.storageOverrides = over;
  }
  // An unticked checkbox is absent from FormData, so these are read only on the
  // step that draws them, or leaving another step would clear them.
  if (w.step === 3) {
    s.roundRates = f.has('roundRates');
    s.wholeMachines = f.has('wholeMachines');
  }
  if (w.step === 4) s.limitsConfirmed = f.has('limitsConfirmed');
  readCarry(form, f);
  // Changing purity or distribution on step 1 replaces the budgets with that
  // world's starting estimates, which then need confirming again.
  if (w.step === 1 && oldPreset !== s.purity + '|' + s.distribution) {
    s.limits = resourceDefaults(s.purity, s.distribution).limits;
    s.limitsConfirmed = false;
  }
  w.preview = null;
}

// True while calculateWizard runs; the move functions here, in guided.js and in
// extraction.js ignore clicks meanwhile, so a second request cannot start.
export let wizardBusy = false;

// The public edition reports each phase from the calculator worker; the server edition shows the static label.
// Returns the options object for post(): relabels `button` now and on progress.
export const calcProgress = (button, label) => {
  if (button) button.textContent = label;
  return {
    onProgress: phase => {
      if (button) button.textContent = `${label} Phase ${phase} of 5…`;
    },
  };
};

// Suggestions shown after a calculation that timed out. Fixed markup, no user text.
const TIMEOUT_ADVICE = [
  '<span class="error-options"><b>Ways to get a plan:</b>',
  '<span>Try again — speed varies with your device and other open tabs.</span>',
  '<span>In the recipe picker, use <b>Planner’s choice</b> or untick alternates you don’t need; ' +
    'many recipes for the same product slow the search the most.</span>',
  '<span>In Goals, turn off whole-machine production — exact balancing calculates much ' +
    'faster.</span>',
  '<span>Lower the elevator multiplier or allow more hours per phase.</span></span>',
].join('');

// Show a failed calculation or create in the form's error line (a toast when
// there is none). A timeout gets suggestions; the message itself is escaped.
export function wizardError(form, err) {
  const el = form?.querySelector('.form-error');
  if (!el) {
    toast(err.message, true);
    return;
  }
  if (/timed out/i.test(err.message)) el.innerHTML = esc(err.message) + TIMEOUT_ADVICE;
  else el.textContent = err.message;
}

// Review, "Create profile": create the profile (in a new save when saveId is empty) and open
// it on its plan page; the toast says what was carried over. readCarry reads which records
// to copy from a sibling profile of the same save; guidedBuiltKeys marks the tutorial steps
// built when the guided answers say it is done. Nothing is created until the post succeeds.
// `button` shows the progress (see calcProgress). A failure goes in the form's error line.
export async function createProfile(form, button) {
  const w = wizard;
  readCarry(form);
  const r = await post(
    '/api/profiles',
    {
      saveId: w.saveId,
      saveName: w.saveName,
      name: w.name,
      settings: w.settings,
      carryFrom: w.saveId ? w.carryFrom : null,
      carry: w.carry,
      built: guidedBuiltKeys(w),
    },
    true,
    calcProgress(button, 'Saving profile…'),
  );
  setWorkspace(r.workspace);
  await loadContext(r.saveId, r.profileId);
  setWizard(null);
  navigate('plan');
  const carried = [
    r.carriedChecks ? plural(r.carriedChecks, 'step') + ' carried over' : '',
    r.reviewCount ? plural(r.reviewCount, 'expanded production line') + ' left for review' : '',
  ]
    .filter(Boolean)
    .join('; ');
  toast(
    'Profile created' +
      (carried ? ': ' + carried + '. ' : '. ') +
      'Your other progress is unchanged.',
  );
}

// The primary button's label on the current screen: the guided questions, the five steps.
export const submitLabel = w =>
  w.mode === 'guided' && w.guidedStep <= guidedFlow().length
    ? w.guidedStep >= guidedFlow().length
      ? 'Calculate plan'
      : 'Continue →'
    : w.step === 5
      ? 'Create profile'
      : w.step === 4
        ? 'Calculate plan'
        : 'Continue →';

// Go to step `target` (1-5): read the form first, validating only when moving
// forward. Reaching step 5 always recalculates the preview.
export async function moveWizard(target) {
  if (wizardBusy || !wizard || target === wizard.step || target < 1 || target > 5) return;
  const form = $('#wizard-form');
  if (target > wizard.step && !form.reportValidity()) return;
  readWizard(form);
  if (target !== 5) {
    wizard.step = target;
    render();
    return;
  }
  await calculateWizard(form);
}

// Shared by both modes: the guided questions and the five-step wizard reach the
// same Review with the same settings, so they calculate through one path.
// Posts the settings to /api/preview (server, or the browser worker in the
// Pages edition), stores the result as wizard.preview and shows Review. All
// step and submit buttons are disabled meanwhile; on failure the draft stays
// where it was and the error is shown in the form.
export async function calculateWizard(form) {
  wizardBusy = true;
  const buttons = document.querySelectorAll(
    '[data-wizard-step],[data-guided-advanced],#wizard-form button',
  );
  buttons.forEach(b => (b.disabled = true));
  const submit = form?.querySelector('button[type="submit"]'),
    label = submit?.textContent;
  try {
    wizard.name =
      wizard.name.trim() || workspace.catalog.goals.find(g => g.id === wizard.settings.goal).name;
    wizard.preview = await post(
      '/api/preview',
      { settings: wizard.settings },
      true,
      calcProgress(submit, 'Calculating…'),
    );
    wizard.step = 5;
    wizard.guidedStep = guidedFlow().length + 1;
    render();
  } catch (err) {
    wizardError(form, err);
    if (submit) submit.textContent = label;
  } finally {
    wizardBusy = false;
    buttons.forEach(b => (b.disabled = false));
  }
}
