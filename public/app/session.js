// The open workspace, save and profile, and the UI state every screen reads.
import { browserMode } from '../browser-api.js';
import { pending, request, writeQueue } from './api.js';
import { $, esc } from './format.js';
import { render } from './shell.js';
import { renderSignedOut } from './views/account.js';
import { startWizard } from './wizard/wizard.js';

export let progressionData;
export let workspace;
export let currentSave;
export let currentProfile;
export let calculated = null;
export let wizard = null;
export let authMode = 'login';
let basePlan;
export let plan;
export let state;
export let view = 'plan';
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
export const startPhase = () => (calculated ? String(calculated.settings?.phase || '1') : '3');

export const phase = () => {
  const p = state.settings.phase;
  return p !== 'post' && Number(p) < Number(startPhase()) ? startPhase() : p;
};

export const stage = () => (phase() === 'post' ? '5' : phase());

export const phaseOptions = () =>
  !currentSave.id
    ? ['1', '2', '3', '4', '5', 'post']
    : [...['1', '2', '3', '4', '5'].filter(p => Number(p) >= Number(startPhase())), 'post'];

export const fromStart = stages =>
  Object.entries(stages || {}).filter(([ph]) => Number(ph) >= Number(startPhase()));

export const checked = id => !!state.checks[id];
export const doneAttr = id => (checked(id) ? 'checked' : '');
export const phaseLabel = p => (p === 'post' ? 'Post Phase 5' : 'Phase ' + p);

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

export const calcStage = () => calculated.stages[stage()];

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
      if (view === 'wizard' && !wizard) view = 'profiles';
      render();
    } else {
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
    $('#app').innerHTML =
      `<section class="loading"><h1>Could not open the planner</h1><p>${esc(e.message)}</p><button class="btn" id="retry">Try again</button></section>`;
    $('#retry').onclick = boot;
  }
}
