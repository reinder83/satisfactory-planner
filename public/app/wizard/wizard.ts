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
import { alternateHunts, ownedAlternateKeys, stepsBeforeStart } from '../../progression.ts';
import { carryOptions } from '../../state.ts';
import { allowSwitch, navigate, post, request, toast } from '../api.ts';
import { markBusy } from '../busy.ts';
import { esc, plural, required } from '../format.ts';
import { backupName, defaultProfileName } from '../profile-edit.ts';
import {
  calculated,
  currentProfile,
  currentSave,
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
  ContextReply,
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
  // Review's "What you already have" (#1068, ui/wizard/AlreadyHave.vue): "Everything before Phase
  // N is done" and the `recipe-unlock-<recipe>` keys of the alternates owned. Draft only, sent as
  // the steps they tick (alreadyHaveKeys), never stored as settings.
  earlierDone?: boolean;
  ownedAlternates?: string[];
  supplyRows?: { name: string; rate: string }[];
  extraction?: Survey;
  extractionStep?: number;
  extractionReturn?: SurveyReturn | null;
  extractionUndo?: Survey | null;
  // What extractionUndo undoes: "Reset all counts", or a refill that replaced typed counts.
  extractionUndoKind?: 'reset' | 'refill';
  // Edit settings (#1071, startEdit): the profile whose settings the draft edits, with the plan
  // they were read from. Review then lists what changes, and its button recalculates that
  // profile in place. Draft only, never stored.
  edit?: EditTarget | null;
}

// The profile Edit settings recalculates: its id, its name and plan when the edit started.
export interface EditTarget {
  profileId: string;
  name: string;
  plan: StoredCalculatedPlan;
}

// The reply of POST /api/recalculate (#1071): the profile's id stays, backupId is the previous
// version's.
interface RecalculatedProfile extends CreatedProfile {
  backupId: string;
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
// `at` opens All settings on its `step` instead of the guided start, from the settings of
// `profileId` in that save, which the new profile carries from: "Change Extra utilities power in
// Preferences" on the Resources page (#1090), which knows the profile its tab shows.
export function startWizard(
  saveId: string | null = null,
  at?: { profileId: string; step: number },
) {
  const asked = allowSwitch();
  if (asked === true) openWizard(saveId, at);
  else
    void asked.then(ok => {
      if (ok) openWizard(saveId, at);
    });
}

function openWizard(saveId: string | null, at?: { profileId: string; step: number }) {
  const existing = workspace.saves.find(s => s.id === saveId);
  const from = at && existing?.profiles.some(p => p.id === at.profileId) ? at : undefined;
  const wizardDraft = newDraft(saveId, existing, startingSettings(existing, from?.profileId));
  if (from) {
    wizardDraft.carryFrom = from.profileId;
    wizardDraft.mode = 'advanced';
    wizardDraft.step = Math.min(Math.max(from.step, 1), 4);
  }
  setWizard(wizardDraft);
  navigate('wizard');
}

// "Edit settings" on a calculated profile (#1071): All settings on step 1, from the settings its
// plan was calculated with, named as it is, ending on Review with "Recalculate in place". The
// open profile's plan is at hand; another profile's is read first (GET /api/context, which
// changes nothing). Nothing is recalculated until the user presses that button. Unsaved notes
// are asked about first, as for startWizard.
export async function startEdit(saveId: string, profileId: string) {
  const asked = allowSwitch();
  if (asked !== true && !(await asked)) return;
  const open = currentSave?.id === saveId && currentProfile?.id === profileId && calculated;
  const context = open
    ? { profile: { name: currentProfile.name }, plan: calculated! }
    : await request<ContextReply>('/api/context', {
        headers: { 'X-Save-Id': saveId, 'X-Profile-Id': profileId },
      });
  const existing = workspace.saves.find(s => s.id === saveId);
  if (!context.plan || !existing) {
    toast('This profile has no calculated plan to edit.', true);
    return;
  }
  const wizardDraft = newDraft(saveId, existing, structuredClone(context.plan.settings));
  wizardDraft.name = context.profile.name;
  wizardDraft.carryFrom = profileId;
  wizardDraft.mode = 'advanced';
  wizardDraft.edit = { profileId, name: context.profile.name, plan: context.plan };
  setWizard(wizardDraft);
  navigate('wizard');
}

// The profile name box's placeholder, on the Goals step and the guided start (#1071).
export const NAME_HINT = 'Named after its goal, changes and date if left blank';

// The name the profile gets: the typed one, else one that says what it is (defaultProfileName in
// profile-edit.ts): its goal, what differs from the profile it carries from (a new save's
// defaults when it carries from none) and today's date. Review shows it, and the create sends it.
export function profileNameOf(wizardDraft: WizardDraft): string {
  const typed = wizardDraft.name.trim();
  if (typed) return typed;
  const source = wizardDraft.saveId
    ? workspace.saves
        .find(s => s.id === wizardDraft.saveId)
        ?.profiles.find(p => p.id === wizardDraft.carryFrom)
    : undefined;
  return defaultProfileName(
    wizardDraft.settings,
    source?.settings as Record<string, unknown> | undefined,
    workspace.catalog.goals,
  );
}

// The settings a new draft starts from. A new profile for an existing save starts from a
// copy of its active profile's settings (the workspace summary exposes plan.settings); anything
// else from freshSettings.
function startingSettings(existing: SaveSummary | undefined, profileId?: string): WizardSettings {
  const selected = existing?.profiles.find(p => p.id === (profileId ?? existing.activeProfile));
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
//   name              profile name; blank takes profileNameOf's on Review and create
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
    // "Miners you already have" (#1068), drawn only with the box ticked: absent means none.
    const owned = data.has('ownedMiner') ? Number(data.get('ownedMiner')) : 0;
    if (settings.phaseMining && (owned === 2 || owned === 3)) settings.ownedMiner = owned;
    else delete settings.ownedMiner;
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
      name: profileNameOf(wizardDraft),
      settings: wizardDraft.settings,
      carryFrom: wizardDraft.saveId ? wizardDraft.carryFrom : null,
      carry: wizardDraft.carry,
      built: [...guidedBuiltKeys(wizardDraft), ...alreadyHaveKeys(wizardDraft)],
    },
    true,
    calcProgress(button, 'Saving profile…'),
  );
  setWorkspace(created.workspace);
  await loadContext(created.saveId, created.profileId);
  setWizard(null);
  navigate('plan');
  // Steps ticked in a profile that carries nothing were not carried from anywhere: they are the
  // finished work it was told about (the HUB tutorial, "What you already have", #1068).
  const carriedFrom = !!(wizardDraft.saveId && wizardDraft.carryFrom);
  const carried = [
    created.carriedChecks
      ? plural(created.carriedChecks, 'step') + (carriedFrom ? ' carried over' : ' start ticked')
      : '',
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

// Review of Edit settings, "Recalculate in place" (#1071): POST /api/recalculate replaces the
// edited profile's plan, name and progress (carried from itself with the carry panel's picks,
// the rules a new profile carried from it follows) and keeps its previous version as a profile
// of its own named "<name> (before edit, <date>)". The request names the plan the edit started
// from, so a profile recalculated meanwhile elsewhere is refused rather than replaced. Then the
// profile opens on its plan page. Only this button calls it. A failure goes in the form's error
// line, and nothing has changed.
export async function recalculateProfile(form: HTMLFormElement, button: HTMLElement | null) {
  const wizardDraft = draft(),
    edit = wizardDraft.edit!;
  readCarry(form);
  const kept = backupName(edit.name);
  const done = await post<RecalculatedProfile>(
    '/api/recalculate',
    {
      name: profileNameOf(wizardDraft),
      backupName: kept,
      settings: wizardDraft.settings,
      planCreatedAt: edit.plan.createdAt,
      carry: wizardDraft.carry,
      built: [...guidedBuiltKeys(wizardDraft), ...alreadyHaveKeys(wizardDraft)],
    },
    { save: wizardDraft.saveId!, profile: edit.profileId },
    calcProgress(button, 'Recalculating…'),
  );
  setWorkspace(done.workspace);
  await loadContext(done.saveId, done.profileId);
  setWizard(null);
  navigate('plan');
  const review = done.reviewCount
    ? ' ' + plural(done.reviewCount, 'production line') + ' left unticked for review.'
    : '';
  toast(
    `Recalculated in place.${review} The previous version is kept as “${kept}” under Profiles.`,
  );
}

// The steps Review's "What you already have" ticks in the new profile (#1068), from the preview:
// with "Everything before Phase N is done" every step the milestone-only phases before its start
// phase list (stepsBeforeStart, unlock-<id> keys), and for the alternates owned their unlock steps
// and each phase's hunt that has nothing left to hunt (ownedAlternateKeys). newProfileState accepts
// them as finished work; records carried from another profile still win there, an untick included.
// None while every box is clear.
export function alreadyHaveKeys(wizardDraft: WizardDraft): string[] {
  const plan = wizardDraft.preview;
  if (!plan || !progressionData?.buildings) return [];
  const owned = new Set(wizardDraft.ownedAlternates || []);
  return [
    ...(wizardDraft.earlierDone ? stepsBeforeStart(plan, { checks: {} }, progressionData) : []),
    ...(owned.size ? ownedAlternateKeys(alternateHunts(plan, progressionData), owned) : []),
  ];
}

// The primary button's label on the current screen: the guided questions, the five steps.
export const submitLabel = (wizardDraft: WizardDraft) =>
  wizardDraft.mode === 'guided' && wizardDraft.guidedStep <= guidedFlow().length
    ? wizardDraft.guidedStep >= guidedFlow().length
      ? 'Calculate plan'
      : 'Continue →'
    : wizardDraft.step === 5
      ? wizardDraft.edit
        ? 'Recalculate in place'
        : 'Create profile'
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
