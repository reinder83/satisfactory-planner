// The five-step profile wizard ("All settings"): creating the draft, reading the
// form back into the draft, moving between steps, calculating the Review preview
// and creating the profile. The draft is the `wizard` object in session.ts (set
// with setWizard). The guided start (guided.ts) and the resource survey
// (extraction.ts) edit the same draft. The screens are components:
// ui/pages/WizardPage.vue (the five steps, ui/wizard/), GuidedPage.vue (ui/guided/)
// and SurveyPage.vue (ui/survey/), which read their forms back through the
// readers here and handle their own controls.
import {
  GUIDED_TOPUP_RATE,
  knownWorld,
  matchingPreset,
  presetSurvey,
  resourceDefaults,
} from '../../preferences.ts';
import { stepsBeforeStart } from '../../progression.ts';
import { carryOptions } from '../../state.ts';
import { allowSwitch, navigate, post, toast } from '../api.ts';
import { markBusy } from '../busy.ts';
import { esc, plural, required } from '../format.ts';
import {
  draft,
  loadContext,
  progressionData,
  setWizard,
  setWorkspace,
  wizard,
  workspace,
} from '../session.ts';
import { render } from '../shell.ts';
import { confirmAction } from '../ui/confirm.ts';
import { extractionOf } from './extraction.ts';
import { guidedBuiltKeys, guidedFlow } from './guided.ts';
import { readSupply } from './supply.ts';
import type {
  CurrentSettings,
  FirstReleaseSettings,
  ItemRates,
  SaveSummary,
  StoredCalculatedPlan,
  Survey,
  WorkspaceSummary,
} from '../../types/index.ts';

// The resource survey being edited (extraction.ts).
export type { Survey };

// The settings being edited: the planner's input. A draft starts from the fields every
// release has stored (the active profile's settings, or the literals in startWizard) and the
// screens add the rest. The forms write their values as typed; the planner's settings()
// checks and normalises them on /api/preview and /api/profiles.
type DraftRequired = Exclude<FirstReleaseSettings, 'modNotes'>;
export type WizardSettings = Pick<CurrentSettings, DraftRequired> &
  Partial<Omit<CurrentSettings, DraftRequired | 'extraction'>> & { extraction?: Survey | null };

// Where the survey returns to (extraction.ts).
export interface SurveyReturn {
  mode: WizardDraft['mode'];
  step: number;
  guidedStep: number;
}

// The in-progress wizard, `wizard` in session.ts. See startWizard for the fields.
export interface WizardDraft {
  step: number;
  saveId: string | null;
  saveName: string;
  name: string;
  settings: WizardSettings;
  // Arrives as JSON, so a phase that never finishes has hours null, as in a stored plan.
  preview: StoredCalculatedPlan | null;
  carryFrom: string | null;
  carry: Record<string, boolean>;
  mode: 'guided' | 'advanced' | 'extraction';
  guidedStep: number;
  guidedAsk: string[] | null;
  guidedTopics?: string[];
  tutorial: string;
  // Review's "Everything before Phase N is done" (#1068, ui/wizard/EarlierDone.vue): draft only,
  // sent as the steps it ticks (earlierDoneKeys), never stored as a setting.
  earlierDone?: boolean;
  supplyRows?: { name: string; rate: string }[];
  extraction?: Survey;
  extractionStep?: number;
  extractionReturn?: SurveyReturn | null;
  extractionUndo?: Survey | null;
  // What extractionUndo undoes: "Reset all counts", or a refill that replaced typed counts.
  extractionUndoKind?: 'reset' | 'refill';
}

// The reply of POST /api/profiles.
interface CreatedProfile {
  workspace: WorkspaceSummary;
  saveId: string;
  profileId: string;
  carriedChecks: number;
  reviewCount: number;
}

// Copy the carry panel's choices into wizard.carryFrom / wizard.carry. Does
// nothing when the panel is not on screen. Also called by the create submit.
export function readCarry(form: HTMLFormElement | null, data?: FormData) {
  const wizardDraft = draft();
  if (!form?.querySelector('.carry-list')) return;
  const formData = data || new FormData(form),
    ticked = new Set(formData.getAll('carry').map(String));
  wizardDraft.carryFrom = (formData.get('carryFrom') as string | null) || null;
  wizardDraft.carry = Object.fromEntries(carryOptions.map(([key]) => [key, ticked.has(key)]));
}

// Open a new draft and show it: saveId null creates a new save, otherwise the
// profile is added to that save. Callers: "Create a save" / "Try another
// profile" buttons (ui/actions.ts, ProfilesPage.vue) and session.ts when there is no save.
// Unsaved notes are asked about first; with none it opens before this returns.
export function startWizard(saveId: string | null = null) {
  const asked = allowSwitch();
  if (asked === true) openWizard(saveId);
  else
    void asked.then(ok => {
      if (ok) openWizard(saveId);
    });
}

function openWizard(saveId: string | null) {
  const existing = workspace.saves.find(s => s.id === saveId);
  setWizard(newDraft(saveId, existing, startingSettings(existing)));
  navigate('wizard');
}

// The settings a new draft starts from. A new profile for an existing save starts from a
// copy of its active profile's settings (the workspace summary exposes plan.settings); anything
// else from freshSettings.
function startingSettings(existing: SaveSummary | undefined): WizardSettings {
  const selected = existing?.profiles.find(p => p.id === existing.activeProfile);
  const previous: WizardSettings | undefined = selected?.settings;
  return previous ? structuredClone(previous) : freshSettings();
}

// A fresh plan's settings. Concrete starts pre-ticked as a guided top-up, and both
// editions start at Phase 1, where a new player starts (#561).
function freshSettings(): WizardSettings {
  const settings: WizardSettings = {
    phase: '1',
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
    // Mining and belts per phase (#1065): a new plan's budgets follow each phase's miners and
    // belts. A draft from an existing profile keeps that profile's choice (absent: off).
    phaseMining: true,
  };
  settings.storageOverrides = { Concrete: GUIDED_TOPUP_RATE };
  return settings;
}

// A new draft for the save `existing` (saveId null creates a new save) starting from
// `settings`. The draft. Fields:
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
//   guidedStep, guidedAsk, tutorial  guided.ts state; tutorial also feeds
//                     guidedBuiltKeys and ada-panel.ts
// Added later: guidedTopics (guided.ts), supplyRows (supply.ts) and extraction, extractionStep,
// extractionReturn, extractionUndo (extraction.ts).
function newDraft(
  saveId: string | null,
  existing: SaveSummary | undefined,
  settings: WizardSettings,
): WizardDraft {
  return {
    step: 1,
    saveId,
    saveName: existing?.name || '',
    name: '',
    // A plan the wizard calculates fills protected storage from surplus first (#1061), also when
    // it starts from a profile calculated before.
    settings: { ...settings, storageFromSurplus: true },
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
    tutorial: 'doing',
  };
}

// Drafts the user has entered or changed something in since startWizard: a typed or chosen
// value on any wizard screen (the input/change listener in listeners.ts) or a survey button
// that changes counts (Fill in, Reset, Apply). Reading an untouched screen into the draft
// fills in defaults, so comparing the draft itself with how it started would count that too.
const edited = new WeakSet<WizardDraft>();
export function noteWizardEdit() {
  if (wizard) edited.add(wizard);
}

// "Cancel" on the first screen of either mode: drop the draft and show the profiles page.
// Nothing has been saved yet, so it only asks when something was entered (the owner's choice
// in #58), in the in-app confirmation; an untouched draft goes without a question, at once.
export function cancelWizard() {
  const wizardDraft = draft();
  if (!edited.has(wizardDraft)) return dropWizard();
  void confirmAction({
    title: 'Discard these answers?',
    body: 'Discard the answers you entered? Nothing has been saved yet.',
    confirmLabel: 'Discard answers',
    danger: true,
  }).then(ok => {
    // Only while the draft asked about is still the open one.
    if (ok && wizard === wizardDraft) dropWizard();
  });
}

function dropWizard() {
  setWizard(null);
  navigate('profiles');
}

// Copy the five-step form on screen into the draft (all steps share this one
// reader; each only finds its own fields). Mutates wizard and wizard.settings
// and clears the preview. Does not re-render.
export function readWizard(form: HTMLFormElement) {
  const data = new FormData(form),
    wizardDraft = draft(),
    settings = wizardDraft.settings,
    oldPreset = worldPreset(settings);
  readFields(data, wizardDraft);
  readSloops(form, data, settings);
  readAlternates(form, data, settings);
  const supply = readSupply(form, data);
  if (supply) settings.existingSupply = supply;
  readStorageOverrides(form, data, settings);
  readStepChecks(data, wizardDraft);
  readCarry(form, data);
  if (wizardDraft.step === 1 && oldPreset !== worldPreset(settings))
    resetForNewWorld(wizardDraft, oldPreset);
  wizardDraft.preview = null;
}

// The settings a form field of the same name writes: as a number, and as the text it holds.
const NUMBER_SETTINGS = new Set([
  'utilityPercent',
  'droneFuelRate',
  'droneBridgeRate',
  'multiplier',
  'powerFactor',
  'uraniumReactors',
  'storageRate',
  'buildRate',
  'cellsPerMinute',
  'somersloops',
  'augmenters',
  'fueledAugmenters',
  'amplifySloops',
  'hours',
]);
const TEXT_SETTINGS = new Set([
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
]);

// Which world the settings plan for: purity and distribution, as "purity|distribution".
const worldPreset = (settings: WizardSettings) => settings.purity + '|' + settings.distribution;

// Copy every named field into the draft: MW fields are stored as GW, saveName/profileName go
// on the draft, "limit:<r>" into settings.limits, then numeric, boolean and text settings.
// Other names (carry, alt, rate:, supply rows, sloop) are read by the readers below.
function readFields(data: FormData, wizardDraft: WizardDraft) {
  for (const [name, value] of data) readField(wizardDraft, name, value);
}

function readField(wizardDraft: WizardDraft, name: string, value: FormDataEntryValue) {
  const settings = wizardDraft.settings,
    // The name-driven writes go through this view of the same object. The form's fields
    // carry the settings' own values, which calculate() checks again.
    byName: Record<string, unknown> = settings;
  if (name === 'availablePowerMW') settings.availablePowerGW = Number(value) / 1000;
  else if (name === 'installedPowerMW') settings.installedPowerGW = Number(value) / 1000;
  else if (name === 'saveName') wizardDraft.saveName = String(value);
  else if (name === 'profileName') wizardDraft.name = String(value);
  else if (name.startsWith('limit:')) settings.limits[name.slice(6)] = Number(value);
  else if (NUMBER_SETTINGS.has(name)) byName[name] = Number(value);
  else if (name === 'collectables') settings.collectables = value === 'true';
  else if (name === 'pureIngots') settings.pureIngots = value === 'true';
  else if (TEXT_SETTINGS.has(name)) byName[name] = value;
}

// The somersloop ledger's ticked items, when the ledger is on screen.
function readSloops(form: HTMLFormElement, data: FormData, settings: WizardSettings) {
  if (form.querySelector('[name=sloop]'))
    settings.sloopReserved = data.getAll('sloop').map(String) as WizardSettings['sloopReserved'];
}

// The recipe picker's ticked alternates, and the starred ones among them, when it is on screen.
function readAlternates(form: HTMLFormElement, data: FormData, settings: WizardSettings) {
  if (!form.querySelector('.alt-list')) return;
  const alternates = data.getAll('alt').map(String);
  settings.alternateRecipes = alternates;
  settings.preferredRecipes = data
    .getAll('altpref')
    .map(String)
    .filter(id => alternates.includes(id));
}

// The per-item storage rates ("rate:<item>"), when they are on screen: blank or non-numeric
// boxes stay unset, zero is kept.
function readStorageOverrides(form: HTMLFormElement, data: FormData, settings: WizardSettings) {
  if (!form.querySelector('.rate-list')) return;
  const overrides: ItemRates = {};
  for (const [name, value] of data)
    if (name.startsWith('rate:') && String(value).trim() !== '' && Number.isFinite(Number(value)))
      overrides[name.slice(5)] = Number(value);
  settings.storageOverrides = overrides;
}

// An unticked checkbox is absent from FormData, so these are read only on the
// step that draws them, or leaving another step would clear them.
function readStepChecks(data: FormData, wizardDraft: WizardDraft) {
  const settings = wizardDraft.settings;
  if (wizardDraft.step === 3) {
    settings.roundRates = data.has('roundRates');
    settings.wholeMachines = data.has('wholeMachines');
  }
  if (wizardDraft.step === 4) {
    settings.limitsConfirmed = data.has('limitsConfirmed');
    settings.phaseMining = data.has('phaseMining');
  }
}

// Changing purity or distribution on step 1 replaces the budgets with that
// world's starting estimates, which then need confirming again. A node survey that
// still holds the old world's preset counts follows to the new world's when that is
// fully known (presetSurvey keeps the mark, clock, usage and the wells it does not
// fill). Counts that differ from the old preset were typed, and stay as they are,
// since the survey is not on screen to show the change. The draft survey is a full
// copy (extractionOf), so nothing edits the applied settings.extraction.
// `oldPreset` is the worldPreset before the form was read.
function resetForNewWorld(wizardDraft: WizardDraft, oldPreset: string) {
  const settings = wizardDraft.settings;
  settings.limits = resourceDefaults(settings.purity, settings.distribution).limits;
  settings.limitsConfirmed = false;
  const [oldPurity = '', oldDistribution] = oldPreset.split('|');
  if (
    (wizardDraft.extraction || settings.extraction) &&
    knownWorld(settings.purity, settings.distribution) &&
    knownWorld(oldPurity, oldDistribution) &&
    matchingPreset(extractionOf(wizardDraft)) === oldPurity
  )
    wizardDraft.extraction = presetSurvey(
      settings.purity,
      extractionOf(wizardDraft),
      settings.distribution,
    );
}

// True while calculateWizard runs; the move functions here, in guided.ts and in
// extraction.ts ignore clicks meanwhile, so a second request cannot start.
export let wizardBusy = false;

// The public edition reports each phase from the calculator worker; the server edition shows the static label.
// Returns the options object for post(): relabels `button` now and on progress.
// `button` is anything with a text to set: a button, or a stand-in that keeps the label.
export const calcProgress = (
  button: { textContent: string | null } | null | undefined,
  label: string,
) => {
  if (button) button.textContent = label;
  return {
    onProgress: (phase: number) => {
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
// there is none). A timeout gets suggestions; the message itself is escaped. The line sits
// above the step's buttons as an error notice (SP-34) and takes focus, which scrolls it into
// view on a long step and has a screen reader read it out.
export function wizardError(form: HTMLFormElement | null, error: Error) {
  const el = form?.querySelector<HTMLElement>('.form-error');
  if (!el) {
    toast(error.message, true);
    return;
  }
  if (/timed out/i.test(error.message)) el.innerHTML = esc(error.message) + TIMEOUT_ADVICE;
  else el.textContent = error.message;
  el.focus();
}

// Review, "Create profile": create the profile (in a new save when saveId is empty) and open
// it on its plan page; the toast says what was carried over. readCarry reads which records
// to copy from a sibling profile of the same save; guidedBuiltKeys marks the tutorial steps
// built when the guided answers say it is done. Nothing is created until the post succeeds.
// `button` shows the progress (see calcProgress). A failure goes in the form's error line.
export async function createProfile(form: HTMLFormElement, button: HTMLElement | null) {
  const wizardDraft = draft();
  readCarry(form);
  const created = await post<CreatedProfile>(
    '/api/profiles',
    {
      saveId: wizardDraft.saveId,
      saveName: wizardDraft.saveName,
      name: wizardDraft.name,
      settings: wizardDraft.settings,
      carryFrom: wizardDraft.saveId ? wizardDraft.carryFrom : null,
      carry: wizardDraft.carry,
      built: [...guidedBuiltKeys(wizardDraft), ...earlierDoneKeys(wizardDraft)],
    },
    true,
    calcProgress(button, 'Saving profile…'),
  );
  setWorkspace(created.workspace);
  await loadContext(created.saveId, created.profileId);
  setWizard(null);
  navigate('plan');
  const carried = [
    created.carriedChecks ? plural(created.carriedChecks, 'step') + ' carried over' : '',
    created.reviewCount
      ? plural(created.reviewCount, 'expanded production line') + ' left for review'
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  toast(
    'Profile created' +
      (carried ? ': ' + carried + '. ' : '. ') +
      'Your other progress is unchanged.',
  );
}

// The steps "Everything before Phase N is done" ticks in the new profile (#1068): every step the
// milestone-only phases before its start phase list in the preview (stepsBeforeStart), all of them
// unlock-<id> keys, which newProfileState accepts as finished work. Records carried from another
// profile still win over them there, an untick included. None while the box is clear.
export function earlierDoneKeys(wizardDraft: WizardDraft): string[] {
  if (!wizardDraft.earlierDone || !wizardDraft.preview) return [];
  return stepsBeforeStart(wizardDraft.preview, { checks: {} }, progressionData);
}

// The primary button's label on the current screen: the guided questions, the five steps.
export const submitLabel = (wizardDraft: WizardDraft) =>
  wizardDraft.mode === 'guided' && wizardDraft.guidedStep <= guidedFlow().length
    ? wizardDraft.guidedStep >= guidedFlow().length
      ? 'Calculate plan'
      : 'Continue →'
    : wizardDraft.step === 5
      ? 'Create profile'
      : wizardDraft.step === 4
        ? 'Calculate plan'
        : 'Continue →';

// Go to step `target` (1-5): read the form first, validating only when moving
// forward. Reaching step 5 always recalculates the preview.
export async function moveWizard(target: number) {
  if (wizardBusy || !wizard || target === wizard.step || target < 1 || target > 5) return;
  const form = required<HTMLFormElement>('#wizard-form');
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
// step and submit buttons are busy meanwhile (busy.ts): not disabled, so the
// pressed one keeps focus (#299), and a click on one does nothing. On failure
// the draft stays where it was and the error is shown in the form.
export async function calculateWizard(form: HTMLFormElement | null) {
  const wizardDraft = draft();
  wizardBusy = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '[data-wizard-step],[data-guided-advanced],#wizard-form button',
  );
  buttons.forEach(button => markBusy(button, true));
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]'),
    label = submit?.textContent ?? '';
  try {
    // The goal is one of the catalog's: the guided cards and the Goals step only offer those.
    wizardDraft.name =
      wizardDraft.name.trim() ||
      workspace.catalog.goals.find(g => g.id === wizardDraft.settings.goal)!.name;
    wizardDraft.preview = await post<StoredCalculatedPlan>(
      '/api/preview',
      { settings: wizardDraft.settings },
      true,
      calcProgress(submit, 'Calculating…'),
    );
    wizardDraft.step = 5;
    wizardDraft.guidedStep = guidedFlow().length + 1;
    render();
  } catch (error) {
    wizardError(form, error as Error);
    if (submit) submit.textContent = label;
  } finally {
    wizardBusy = false;
    buttons.forEach(button => markBusy(button, false));
  }
}
