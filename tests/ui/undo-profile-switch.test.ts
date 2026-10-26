// The build plan's tick Undo (#1054) belongs to the profile the step was ticked on (#1166). The
// profiles of a save share step ids, so an Undo still live after a switch unticked the same step
// in the profile opened next. Now opening another profile, signing out or boot() hides the toast
// with its Undo (dropToastAction in api.ts), and Undo itself does nothing once another profile is
// open (undoTick in ui/plan/tick-hold.ts). Checked against the server's replies (the Docker
// edition) and against the browser edition's own request handler (browser-api.ts).
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { dropToastAction, toastShortcut } from '../../public/app/api.ts';
import {
  currentProfile,
  loadContext,
  progressionData,
  setWorkspace,
  state,
} from '../../public/app/session.ts';
import { render } from '../../public/app/shell.ts';
import { openProfile, signOut } from '../../public/app/ui/actions.ts';
import { createBrowserApi } from '../../public/browser-api.ts';
import { initialState } from '../../public/state.ts';
import {
  $,
  $$,
  applyUpdate,
  catalog,
  generatedWith,
  go,
  migratedPlan,
  open,
  page,
  stubFetch,
} from './setup.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  CurrentCalculatedPlan,
  UpdateOp,
  WorkspaceSummary,
} from '../../public/types/index.ts';

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await nextTick();
  }
};
const openIds = () => $$('#main [data-open-steps] > .task [data-check]').map(e => e.dataset.check!);
async function tickFirst() {
  const box = $$<HTMLInputElement>('#main [data-open-steps] > .task input[data-check]')[0]!;
  box.focus();
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
const undoButton = () => $<HTMLButtonElement>('#toast [data-toast-action]');
const toastShown = () => $('#toast')!.classList.contains('show');
const ctrlZ = async () => {
  toastShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  await settle();
};

beforeEach(() => page());
afterEach(() => {
  dropToastAction();
  vi.unstubAllGlobals();
});

// The Docker edition: the server's replies, stubbed. Profile "p" is open; "original" in the same
// save has the same steps, and the first of them ticked.
const workspace = (): WorkspaceSummary => ({
  user: { id: 'owner', username: 'Pioneer' },
  accountsEnabled: true,
  catalog: {} as WorkspaceSummary['catalog'],
  saves: [
    {
      id: 's',
      name: 'World',
      activeProfile: 'original',
      profiles: [
        { id: 'original', kind: 'calculated', name: 'First try', completed: 1, phase: '3' },
        { id: 'p', kind: 'calculated', name: 'Second try', completed: 0, phase: '3' },
      ],
    },
  ],
});
const other = (ticked: string): ContextReply => ({
  save: { id: 's', name: 'World' },
  profile: { id: 'original', kind: 'calculated', name: 'First try' },
  state: { ...initialState(), revision: 3, settings: { phase: '3' }, checks: { [ticked]: true } },
  plan: migratedPlan(),
});
function openServerPlan() {
  open({ workspace: workspace() });
  go('plan');
  render();
  return stubFetch<UpdateOp>({ '/api/update': applyUpdate });
}

test('opening another profile hides the tick toast, and Undo or Ctrl+Z then writes nothing', async () => {
  openServerPlan();
  await nextTick();
  const [first] = openIds();
  assert.ok(first);
  await tickFirst();
  const button = undoButton();
  assert.ok(button && toastShown(), 'the toast offers Undo');
  const calls = stubFetch<UpdateOp>({
    '/api/select': workspace(),
    '/api/context': other(first),
    '/api/update': applyUpdate,
  });
  await openProfile('s', 'original');
  await settle();
  assert.equal(currentProfile.id, 'original');
  assert.equal(toastShown(), false, 'the toast went with the profile it was about');
  await ctrlZ();
  button.click();
  await settle();
  assert.deepEqual(
    calls.map(call => call[0].split('?')[0]),
    ['/api/select', '/api/context'],
    'no update reached the profile opened next',
  );
  assert.equal(state.checks[first], true, 'its step stays ticked');
});

test('Undo does nothing once another profile is open, even with the toast still up', async () => {
  const calls = openServerPlan();
  await nextTick();
  const [first] = openIds();
  assert.ok(first);
  await tickFirst();
  assert.equal(calls.length, 1, 'the tick was saved');
  // Another profile of the same save opens without loadContext's clean-up.
  open({ workspace: workspace(), profileId: 'original', state: { checks: { [first]: true } } });
  render();
  await nextTick();
  assert.ok(undoButton() && toastShown(), 'still offered');
  await ctrlZ();
  assert.equal(calls.length, 1, 'nothing was written');
  assert.equal(state.checks[first], true, 'the other profile keeps its tick');
});

test('Undo still unticks the step while its own profile stays open', async () => {
  const calls = openServerPlan();
  await nextTick();
  const [first] = openIds();
  await tickFirst();
  await ctrlZ();
  assert.deepEqual(calls.at(-1), ['/api/update', { type: 'check', key: first, value: false }]);
  assert.equal(state.checks[first!], false);
});

test('signing out hides the tick toast with its Undo', async () => {
  openServerPlan();
  await nextTick();
  await tickFirst();
  assert.ok(undoButton() && toastShown());
  const calls = stubFetch({
    '/api/logout': {},
    '/api/workspace': { user: null, registration: false },
  });
  await signOut();
  await settle();
  assert.equal(toastShown(), false);
  await ctrlZ();
  assert.deepEqual(
    calls.map(call => call[0]),
    ['/api/logout', '/api/workspace'],
    'Ctrl+Z sends nothing after signing out',
  );
});

test('a toast without a button is left up', async () => {
  openServerPlan();
  await nextTick();
  await tickFirst();
  // Unticking says so, without Undo.
  const box = $$<HTMLInputElement>('#main [data-open-steps] > .task input[data-check]')[0]!;
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.equal(undoButton(), null);
  dropToastAction();
  assert.ok(toastShown(), 'only a toast with an action is taken away');
});

// The browser edition: its own request handler, with the workspace in memory. Two profiles of one
// save made from the same plan, so they share their step ids.
test('in the browser edition, Undo after a switch leaves the other profile’s tick alone', async () => {
  const plan: CurrentCalculatedPlan = generatedWith({ phase: '1', goal: 'minimal' });
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  let made = 0;
  const api = createBrowserApi(
    {
      async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
        const copy = structuredClone(data);
        if (!change) return copy as T;
        const result = change(copy);
        data = copy;
        return structuredClone(result);
      },
    },
    () => ({
      ...structuredClone(plan),
      createdAt: new Date(Date.UTC(2026, 9, 26, 10, made++)).toISOString(),
    }),
    catalog(),
    undefined,
    undefined,
    progressionData,
  );
  const writes: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const path = String(input);
    if (path.startsWith('/api/update')) writes.push(String(options.body));
    try {
      const reply = await api(path, {
        body: options.body ?? null,
        headers: { ...(options.headers as Record<string, string> | undefined) },
      });
      return new Response(JSON.stringify(reply), { status: 200 });
    } catch (error) {
      const { message, status } = error as Error & { status?: number };
      return new Response(JSON.stringify({ error: message }), { status: status ?? 400 });
    }
  };
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    api(route, { body: JSON.stringify(body), headers });
  const a = (await post('/api/profiles', {
    saveName: 'World',
    name: 'A',
    settings: { phase: '1' },
  })) as { saveId: string; profileId: string };
  const b = (await post('/api/profiles', {
    saveId: a.saveId,
    name: 'B',
    settings: { phase: '1' },
  })) as { saveId: string; profileId: string };
  setWorkspace((await api('/api/workspace')) as WorkspaceSummary);
  await loadContext(a.saveId, a.profileId);
  go('plan');
  render();
  await settle();
  const [first] = openIds();
  assert.ok(first);
  await post(
    '/api/update',
    { type: 'check', key: first, value: true },
    { 'X-Save-Id': b.saveId, 'X-Profile-Id': b.profileId },
  );
  const stored = (id: string) =>
    data.saves[0]!.profiles.find(profile => profile.id === id)!.state.checks[first];

  await tickFirst();
  assert.equal(stored(a.profileId), true, 'ticked in A');
  const button = undoButton();
  assert.ok(button);
  writes.length = 0;
  await openProfile(b.saveId, b.profileId);
  await settle();
  assert.equal(currentProfile.id, b.profileId);
  assert.equal(toastShown(), false);
  await ctrlZ();
  button.click();
  await settle();
  assert.deepEqual(writes, [], 'nothing was written');
  assert.equal(stored(b.profileId), true, 'B keeps its tick');
  assert.equal(stored(a.profileId), true, 'and so does A');
});
