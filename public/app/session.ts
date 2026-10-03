// The open workspace, save and profile, and the UI state every screen reads.
// boot() starts the app and loadContext() switches save/profile; both fill the bindings
// below, which every view reads directly and other modules change through the setters.
import { readStoredData } from '../browser-store.ts';
import { milestoneOnlyPhase } from '../progression.ts';
import { initialState } from '../state.ts';
import { downloadJson, request, toast, writeQueue } from './api.ts';
import { required } from './format.ts';
import { phaseToOpen } from './opening-phase.ts';
import { render } from './shell.ts';
import { showSignedOut, unmountShell } from './ui/mount.ts';
import { startWizard, type WizardDraft } from './wizard/wizard.ts';
import type {
  ContextReply,
  Handbook,
  Phase,
  ProfileKind,
  Progression,
  ProgressState,
  StageKey,
  StoredCalculatedPlan,
  StoredPayoff,
  WorkspaceSummary,
} from '../types/index.ts';

// The hash routes, one per page.
export const VIEWS = [
  'plan',
  'factories',
  'logistics',
  'storage',
  'resources',
  'notes',
  'backup',
  'profiles',
  'wizard',
  'account',
] as const;
export type View = (typeof VIEWS)[number];
// The route a hash names: an unknown one shows the plan.
export const viewOf = (hash: string): View =>
  (VIEWS as readonly string[]).includes(hash) ? (hash as View) : 'plan';

// The open save and profile. kind is 'original' for the preserved handbook and 'calculated'
// for a wizard-made profile; the empty workspace's placeholder profile has none.
export interface OpenSave {
  id: string;
  name: string;
}
export interface OpenProfile {
  id: string;
  name: string;
  kind?: ProfileKind;
}

// progression.json (unlocks and milestones), read by views/calculated.ts and flow.ts.
export let progressionData: Progression;
// /api/workspace: the signed-in user, every save with its profile summaries, the catalog.
export let workspace: WorkspaceSummary;
export let currentSave: OpenSave;
export let currentProfile: OpenProfile;
// The open profile's frozen calculated plan, or null for the original handbook.
// Views branch on this to pick the calculated or the handbook rendering.
export let calculated: StoredCalculatedPlan | null = null;
// The open profile's stored hard-drive payoff ranking (#203), while it matches the plan.
export let payoff: StoredPayoff | null = null;
// The in-progress wizard (settings being edited, step, preview) while #wizard is open.
export let wizard: WizardDraft | null = null;
// Which form the signed-out screen shows; see ui/SignedOut.vue.
export let authMode: 'login' | 'register' = 'login';
// plan.json as fetched at boot; the fallback when a profile carries no handbook of its own.
let basePlan: Handbook | undefined;
// The handbook in use: the profile's own copy for an original profile, otherwise plan.json.
export let plan: Handbook;
// The open profile's saved progress (settings, checks, notes, deliveries, customTasks,
// taskEdits, ...). Replaced wholesale by every successful save() in api.ts. Unset until boot()
// opens a profile and blank while signed out: `stateLoaded` says whether it is a profile's.
export let state: ProgressState;
export let stateLoaded = false;
// The current hash route; render() in shell.ts picks the view from it.
export let view: View = 'plan';
// The current page's search text and UI toggles. View state only, never saved;
// loadContext() and route changes reset some of them.
export let query = '';
// The storage floor shown: a built-in id ('ground', 'upper', 'workshop') or an added 'cf-…'.
export let floor = 'ground';
// The status filter chip on both factories pages (statusFilter() in views/factories.ts,
// drawn by ui/factories/FilterChips.vue).
export let factoryFilter = 'all';
// "Hide completed" on the build plan. A view preference rather than progress, so like
// ADA's mute switch it is remembered in this browser and never touches a saved profile.
const HIDE_DONE_KEY = 'planner-hide-done';
export let hideDone = hideDoneStored();
export let layoutEditing = false;
export let planEditing = false;
// The id of the build-plan step whose edit form is open.
export let editingTask: string | null = null;
export let factoryEditing = false;

// Other modules cannot assign imported bindings, so they change these through setters.
export function setWorkspace(value: WorkspaceSummary) {
  workspace = value;
}
export function setProgressionData(value: Progression) {
  progressionData = value;
}
export function setWizard(value: WizardDraft | null) {
  wizard = value;
}
// The open wizard draft, for code that only runs while one is open (the wizard's screens and
// their readers). Throws if there is none, where reading a field of null would have thrown.
export function draft(): WizardDraft {
  if (!wizard) throw Error('No wizard draft is open.');
  return wizard;
}
export function setAuthMode(value: 'login' | 'register') {
  authMode = value;
}
export function setState(value: ProgressState) {
  state = value;
  stateLoaded = true;
}
export function setPayoff(value: StoredPayoff | null) {
  payoff = value;
}
export function setView(value: View) {
  view = value;
}
export function setQuery(value: string) {
  query = value;
}
export function setFloor(value: string) {
  floor = value;
}
export function setFactoryFilter(value: string) {
  factoryFilter = value;
}
export function setHideDone(value: boolean) {
  hideDone = value;
  try {
    localStorage.setItem(HIDE_DONE_KEY, value ? 'on' : 'off');
  } catch {}
}
function hideDoneStored() {
  try {
    return localStorage.getItem(HIDE_DONE_KEY) === 'on';
  } catch {
    return false;
  }
}
// The factory groups and shared sites folded on the factories pages (SP-17, #252), as
// "<save>/<profile>/<section>" (a group id, or 'site-oil' and 'site-nuclear'). Like "Hide
// completed" a view preference remembered in this browser, never in a saved profile: nothing
// stored, or anything unreadable, means every section is open. Kept in memory as well, so the
// toggle still works where the browser refuses storage, and capped so it cannot grow unbounded.
const COLLAPSED_KEY = 'planner-collapsed-sections';
const COLLAPSED_MAX = 500;
const collapsedSections = new Set(collapsedStored());
function collapsedStored(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
const sectionPath = (id: string) => `${currentSave?.id}/${currentProfile?.id}/${id}`;
export const sectionCollapsed = (id: string) => collapsedSections.has(sectionPath(id));
export function setSectionCollapsed(id: string, value: boolean) {
  const path = sectionPath(id);
  collapsedSections.delete(path);
  if (value) collapsedSections.add(path);
  // A Set keeps insertion order, so the oldest entries go first.
  for (const old of [...collapsedSections].slice(0, -COLLAPSED_MAX)) collapsedSections.delete(old);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSections]));
  } catch {}
}
export function setLayoutEditing(value: boolean) {
  layoutEditing = value;
}
export function setPlanEditing(value: boolean) {
  planEditing = value;
}
export function setEditingTask(value: string | null) {
  editingTask = value;
}
export function setFactoryEditing(value: boolean) {
  factoryEditing = value;
}

// A profile records the phase it was created for: its production is planned from there on.
// Earlier phases are already behind the user, so their production lines and targets are not
// theirs to build. The original handbook (no calculated plan) covers Phase 3 onward.
export const startPhase = (): StageKey =>
  calculated ? (String(calculated.settings?.phase || '1') as StageKey) : '3';

// The first phase the profile offers. A calculated profile offers the phases before its start
// phase as milestone-only phases (#759, milestoneOnlyPhase in progression.ts): their build plan
// lists the milestones that belong there and nothing else. A plan guide (a profile moved from
// the handbook) and the original handbook have no such phases, so they start at the start phase.
export const firstPhase = (): StageKey => (calculated && !calculated.guide ? '1' : startPhase());

// Whether `shown` (the current phase unless given) is a milestone-only phase of the open profile.
export const milestoneOnly = (shown: Phase = phase()): boolean =>
  !!calculated && milestoneOnlyPhase(calculated, shown);

// The phase being worked on: the saved setting, raised to the profile's first phase. With
// no save open (the empty workspace's placeholder) there is no profile to raise it to, so
// the top bar follows the phase picked in the open wizard draft, else the placeholder's (#561).
export const phase = (): Phase => {
  const saved = state.settings.phase;
  if (!currentSave.id) return wizard?.settings.phase || saved;
  // Opened on an earlier phase with open checks (#570), while the saved phase is still the one
  // that was worked out from: another tab picking a phase shows that one.
  if (openedOn?.saved === saved) return openedOn.phase;
  return saved !== 'post' && Number(saved) < Number(firstPhase()) ? firstPhase() : saved;
};

// The data key for the phase: post-game has no stage of its own and uses Phase 5's
// factories and calculated stage. Checklist ids like factory-<stage>-<id> use this.
export const stage = (): StageKey => {
  const current = phase();
  return current === 'post' ? '5' : current;
};

// Choices for the phase picker in the header. Without an open save (fresh start) every
// phase is offered; otherwise phases before the profile's first phase (firstPhase) are left out,
// so a calculated profile offers every phase, the ones before its start phase milestone-only.
const PHASES: Phase[] = ['1', '2', '3', '4', '5', 'post'];
export const phaseOptions = (): Phase[] =>
  !currentSave.id
    ? PHASES
    : [...PHASES.filter(p => p !== 'post' && Number(p) >= Number(firstPhase())), 'post'];

// [phase, data] entries of a per-phase object, from the profile's start phase on: the phases it
// plans production for (a factory's expansion table), so milestone-only phases are left out.
export const fromStart = <T>(stages: Partial<Record<string, T>> | undefined): [string, T][] =>
  (Object.entries(stages || {}) as [string, T][]).filter(
    ([phaseKey]) => Number(phaseKey) >= Number(startPhase()),
  );

// Checklist lookups. The id is a stable saved key (e.g. factory-<stage>-<id>,
// calc-<stage>-<rowId>, slot-<address>-<step>) and must not change between releases.
export const checked = (id: string) => !!state.checks[id];
export const phaseLabel = (phaseKey: string) =>
  phaseKey === 'post' ? 'Post Phase 5' : 'Phase ' + phaseKey;

// Opens a save/profile: fetches its state and plan from /api/context and resets the
// per-page UI state and the factory dialog. Does not render; callers render or navigate.
// Waits for queued saves first so they land in the profile they were made in.
export async function loadContext(saveId: string, profileId: string) {
  await writeQueue;
  setContext(
    await request<ContextReply>(
      '/api/context?save=' +
        encodeURIComponent(saveId) +
        '&profile=' +
        encodeURIComponent(profileId),
    ),
  );
  required<HTMLDialogElement>('#detail').close();
  openOnPhase();
}

// The phase the profile just opened shows (#570, app/opening-phase.ts): the saved working phase,
// or an earlier one that still has open checks. It is not saved: the saved phase stays the one the
// user picked, so each opening looks again. The phase picker drops it (setOpenedPhase(null)) once
// it has saved the phase picked, and opening another profile replaces it.
let openedOn: { saved: Phase; phase: Phase } | null = null;
export function setOpenedPhase(value: typeof openedOn) {
  openedOn = value;
}
// The saved working phase while the profile shows an earlier one it opened on, else null (ADA).
export const openedFrom = (): Phase | null =>
  openedOn?.saved === state.settings.phase ? openedOn.saved : null;
// Works out where the profile just opened starts. A failure here must not stop it opening, so it
// then shows the saved phase, as before.
function openOnPhase() {
  try {
    const saved = state.settings.phase,
      open = phaseToOpen();
    // Only an earlier phase, which openingPhase finds from the start phase on.
    openedOn = open === saved ? null : { saved, phase: open };
  } catch {
    openedOn = null;
  }
}

// Makes an /api/context reply the open save and profile ({ save, profile, state, plan,
// handbook }): its state, its calculated plan (null for the handbook) and the handbook it
// reads, and resets the per-page UI state. Also used by the component tests.
export function setContext(reply: ContextReply) {
  currentSave = reply.save;
  currentProfile = reply.profile;
  state = reply.state;
  stateLoaded = true;
  calculated = reply.plan;
  payoff = reply.payoff ?? null;
  plan = reply.handbook || basePlan || plan;
  query = '';
  openedOn = null;
  endEditing();
}

// Closes every editing mode: step editing and its open step form, factory editing and the
// storage layout editor. They belong to the profile on screen, so opening another profile,
// the empty workspace or the sign-in screen starts without them.
function endEditing() {
  planEditing = false;
  editingTask = null;
  factoryEditing = false;
  layoutEditing = false;
}

// The calculated plan's data for the current stage (rows, delivery, power, raw use).
// undefined while no calculated profile is open: a component of the profile just left can be
// redrawn once more before render() swaps it for the new profile's page. Also undefined in a
// milestone-only phase (#759): the planner solved that stage too, but the profile does not build
// it, so no page shows its production lines, deliveries, power or resources.
export const calcStage = () => (milestoneOnly() ? undefined : calculated?.stages[stage()]);

// Starts the app; run again after an import, profile removal, sign-in/out or a retry.
// Signed out: shows the sign-in screen. No saves yet: opens the wizard with a blank
// placeholder save/profile. Otherwise opens the active save and renders the routed view.
export async function boot() {
  try {
    workspace = await request<WorkspaceSummary>('/api/workspace');
    if (!workspace.user) {
      authMode = 'login';
      // Signed out: the previous user's progress is dropped, and no page reads the state until
      // the next boot(); the hashchange listener checks stateLoaded before drawing. So is an
      // unfinished wizard draft (their save id and settings), which the next boot() would
      // otherwise reopen for whoever signs in on this tab.
      state = initialState();
      stateLoaded = false;
      wizard = null;
      // The rest of the view state goes too, so whoever signs in next starts on the default
      // floor and filter with no editing mode open (#132). "Hide completed" stays: like ADA's
      // mute switch it is this browser's preference, kept in localStorage, not the user's.
      query = '';
      floor = 'ground';
      factoryFilter = 'all';
      endEditing();
      // #detail sits outside #app, which showSignedOut replaces, so a factory or storage
      // dialog still open would stay modal over the sign-in form with the previous user's data.
      document.querySelector<HTMLDialogElement>('#detail')?.close();
      showSignedOut(required('#app'));
      return;
    }
    [plan, progressionData] = await Promise.all([
      request<Handbook>('/plan.json'),
      request<Progression>('/progression.json'),
    ]);
    basePlan = plan;
    // Open the workspace's active save at its active profile, then honour a deep link.
    const save = workspace.saves.find(s => s.id === workspace.activeSave) || workspace.saves[0];
    if (save) {
      await loadContext(save.id, save.activeProfile);
      view = viewOf(location.hash.slice(1));
      // The wizard lives only in memory, so #wizard after a reload lands on the profiles page.
      if (view === 'wizard' && !wizard) view = 'profiles';
      render();
    } else {
      // Empty workspace: a placeholder save/profile (empty ids) so the frame can render,
      // then the wizard to create the first save. startWizard() navigates to #wizard.
      currentSave = { id: '', name: 'New save' };
      currentProfile = { id: '', name: 'Choose a profile' };
      state = { ...initialState(), settings: { phase: '1' } };
      stateLoaded = true;
      calculated = null;
      endEditing();
      startWizard();
    }
  } catch (error) {
    // Any failure while opening replaces the page with an error and a retry button.
    unmountShell();
    // The markup is fixed; the message goes in as text.
    required('#app').innerHTML =
      '<section class="loading"><h1>Could not open the planner</h1><p></p>' +
      '<button class="btn" id="retry">Try again</button></section>';
    required('#app .loading p').textContent =
      error instanceof Error ? error.message : String(error);
    required('#retry').onclick = boot;
    // The browser edition refused its own stored data (damaged, or from a newer release): offer
    // that data as a file, since nothing in this browser can open or restore it (#142).
    if ((error as { storedData?: boolean } | null)?.storedData) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.id = 'download-stored-data';
      button.textContent = 'Download the stored data';
      button.onclick = () =>
        readStoredData(indexedDB).then(
          data => downloadJson(data ?? null, 'satisfactory-planner-browser-data.json'),
          (err: Error) => toast('The stored data could not be read: ' + err.message, true),
        );
      required('#retry').after(' ', button);
    }
  }
}
