// The open workspace, save and profile, and the UI state every screen reads.
// boot() starts the app and loadContext() switches save/profile; both fill the bindings
// below, which every view reads directly and other modules change through the setters.
import { browserMode } from '../browser-api.js';
import { pending, request, writeQueue } from './api.js';
import { $ } from './format.js';
import { html } from './html.js';
import { render } from './shell.js';
import { renderSignedOut } from './views/account.js';
import { startWizard } from './wizard/wizard.js';

// progression.json (unlocks and milestones), read by views/calculated.js and flow.js.
export let progressionData;
// /api/workspace: the signed-in user, every save with its profile summaries, the catalog.
export let workspace;
// { id, name } of the open save and { id, name, kind } of the open profile. kind is
// 'original' for the preserved handbook and 'calculated' for a wizard-made profile.
export let currentSave;
export let currentProfile;
// The open profile's frozen calculated plan, or null for the original handbook.
// Views branch on this to pick the calculated or the handbook rendering.
export let calculated = null;
// The in-progress wizard (settings being edited, step, preview) while #wizard is open.
export let wizard = null;
// Which form the signed-out screen shows ('login' or 'register'); see views/account.js.
export let authMode = 'login';
// plan.json as fetched at boot; the fallback when a profile carries no handbook of its own.
let basePlan;
// The handbook in use: the profile's own copy for an original profile, otherwise plan.json.
export let plan;
// The open profile's saved progress (settings, checks, notes, deliveries, customTasks,
// taskEdits, ...). Replaced wholesale by every successful save() in api.js.
export let state;
// The current hash route; render() in shell.js picks the view from it.
export let view = 'plan';
// The current page's search text and UI toggles. View state only, never saved;
// loadContext() and route changes reset some of them.
export let query = '';
export let floor = 'ground';
export let factoryFilter = 'all';
export let hideDone = false;
export let activeDetail = null;
export let layoutEditing = false;
export let planEditing = false;
export let editingTask = null;
export let factoryEditing = false;

// Other modules cannot assign imported bindings, so they change these through setters.
export function setWorkspace(value) {
  workspace = value;
}
export function setWizard(value) {
  wizard = value;
}
export function setAuthMode(value) {
  authMode = value;
}
export function setState(value) {
  state = value;
}
export function setView(value) {
  view = value;
}
export function setQuery(value) {
  query = value;
}
export function setFloor(value) {
  floor = value;
}
export function setFactoryFilter(value) {
  factoryFilter = value;
}
export function setHideDone(value) {
  hideDone = value;
}
export function setActiveDetail(value) {
  activeDetail = value;
}
export function setLayoutEditing(value) {
  layoutEditing = value;
}
export function setPlanEditing(value) {
  planEditing = value;
}
export function setEditingTask(value) {
  editingTask = value;
}
export function setFactoryEditing(value) {
  factoryEditing = value;
}

// A profile records the phase it was created for. Earlier phases are already
// behind the user, so their steps and targets are not theirs to build.
// The original handbook (no calculated plan) covers Phase 3 onward.
export const startPhase = () => (calculated ? String(calculated.settings?.phase || '1') : '3');

// The phase being worked on: the saved setting, raised to the profile's start phase.
export const phase = () => {
  const p = state.settings.phase;
  return p !== 'post' && Number(p) < Number(startPhase()) ? startPhase() : p;
};

// The data key for the phase: post-game has no stage of its own and uses Phase 5's
// factories and calculated stage. Checklist ids like factory-<stage>-<id> use this.
export const stage = () => (phase() === 'post' ? '5' : phase());

// Choices for the phase picker in the header. Without an open save (fresh start) every
// phase is offered; otherwise phases before the profile's start phase are left out.
export const phaseOptions = () =>
  !currentSave.id
    ? ['1', '2', '3', '4', '5', 'post']
    : [...['1', '2', '3', '4', '5'].filter(p => Number(p) >= Number(startPhase())), 'post'];

// [phase, data] entries of a per-phase object, from the profile's start phase on.
export const fromStart = stages =>
  Object.entries(stages || {}).filter(([ph]) => Number(ph) >= Number(startPhase()));

// Checklist lookups. The id is a stable saved key (e.g. factory-<stage>-<id>,
// calc-<stage>-<rowId>, slot-<address>-<step>) and must not change between releases.
// doneAttr gives the `checked` attribute for a checkbox in an HTML template.
export const checked = id => !!state.checks[id];
export const doneAttr = id => (checked(id) ? 'checked' : '');
export const phaseLabel = p => (p === 'post' ? 'Post Phase 5' : 'Phase ' + p);

// Opens a save/profile: fetches its state and plan from /api/context and resets the
// per-page UI state and the factory dialog. Does not render; callers render or navigate.
// Waits for queued saves first so they land in the profile they were made in.
export async function loadContext(saveId, profileId) {
  await writeQueue;
  const c = await request(
    '/api/context?save=' + encodeURIComponent(saveId) + '&profile=' + encodeURIComponent(profileId),
  );
  currentSave = c.save;
  currentProfile = c.profile;
  state = c.state;
  calculated = c.plan;
  plan = c.handbook || basePlan || plan;
  query = '';
  activeDetail = null;
  planEditing = false;
  editingTask = null;
  factoryEditing = false;
  layoutEditing = false;
  $('#detail').close();
}

// The calculated plan's data for the current stage (rows, delivery, power, raw use).
// Only valid while `calculated` is set.
export const calcStage = () => calculated.stages[stage()];

// Starts the app; run again after an import, profile removal, sign-in/out or a retry.
// Signed out: shows the sign-in screen. No saves yet: opens the wizard with a blank
// placeholder save/profile. Otherwise opens the active save and renders the routed view.
export async function boot() {
  try {
    workspace = await request('/api/workspace');
    if (!workspace.user) {
      authMode = 'login';
      renderSignedOut();
      return;
    }
    [plan, progressionData] = await Promise.all([
      request('/plan.json'),
      request('/progression.json'),
    ]);
    basePlan = plan;
    // Open the workspace's active save at its active profile, then honour a deep link.
    const save = workspace.saves.find(s => s.id === workspace.activeSave) || workspace.saves[0];
    if (save) {
      await loadContext(save.id, save.activeProfile);
      view = [
        'plan',
        'factories',
        'storage',
        'resources',
        'backup',
        'profiles',
        'wizard',
        'account',
      ].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : 'plan';
      // The wizard lives only in memory, so #wizard after a reload lands on the profiles page.
      if (view === 'wizard' && !wizard) view = 'profiles';
      render();
    } else {
      // Empty workspace: a placeholder save/profile (empty ids) so the frame can render,
      // then the wizard to create the first save. startWizard() navigates to #wizard.
      currentSave = { id: '', name: 'New save' };
      currentProfile = { id: '', name: 'Choose a profile' };
      state = {
        settings: { phase: browserMode ? '1' : '3' },
        checks: {},
        notes: {},
        deliveries: {},
        customTasks: [],
      };
      calculated = null;
      startWizard();
    }
  } catch (e) {
    // Any failure while opening replaces the page with an error and a retry button.
    $('#app').innerHTML = String(
      html`<section class="loading">
        <h1>Could not open the planner</h1>
        <p>${e.message}</p>
        <button class="btn" id="retry">Try again</button>
      </section>`,
    );
    $('#retry').onclick = boot;
  }
}
