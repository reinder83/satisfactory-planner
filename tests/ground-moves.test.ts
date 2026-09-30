// The handbook's ground-floor moves as a to-do (SP-25, #260): the storage page's Done ticks the
// existing storage step `storage-filter-moves`, an ordinary check in the profile's checks map. So
// the saved format does not change: the key passes the validator in both editions, a state
// holding it stays version 1 (every earlier release imports it), it is kept per profile, and
// saves made before it load exactly as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, initialState } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import { mutate, validateState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import type { BrowserStore } from '../public/browser-store.ts';
import { calculate } from '../planner.ts';
import { saveExport, states } from './types/fixtures.ts';
import type {
  BrowserWorkspace,
  Catalog,
  Handbook,
  ProgressState,
  SaveExport,
} from '../public/types/index.ts';

const KEY = 'storage-filter-moves';
const handbook: Handbook = JSON.parse(
  await fs.readFile(new URL('../public/plan.json', import.meta.url), 'utf8'),
);

test('the Done key is the handbook’s own storage step, so nothing new is saved', () => {
  const step = handbook.storageTasks.find(t => t.id === KEY);
  assert.ok(step, 'the handbook has the step the notice ticks');
  assert.match(step.body, /Gas Filters from G08 to H02/);
  assert.match(step.body, /Nobelisks from H02 to H08/);
});

test('a state with the key validates unchanged and stays version 1', () => {
  const ticked = mutate(initialState(), { type: 'check', key: KEY, value: true });
  assert.equal(ticked.version, 1, 'an older release still imports it');
  assert.equal(ticked.checks[KEY], true);
  assert.equal(ticked.checks['storage-ground-shell'], true, 'the shell tick is untouched');
  assert.deepEqual(validateState(structuredClone(ticked)), ticked);
  // Unticked again (the checklist's undo), it is kept as false, as any unticked step is.
  const back = mutate(ticked, { type: 'check', key: KEY, value: false });
  assert.equal(back.checks[KEY], false);
  assert.equal(back.version, 1);
  // Every released state keeps its version and records with the key added.
  for (const [state, version] of states) {
    const clean = mutate(structuredClone(state), { type: 'check', key: KEY, value: true });
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, { ...state.checks, [KEY]: true });
    assert.deepEqual(clean.notes, state.notes);
  }
});

test('saves made before the change load exactly as they were', () => {
  for (const [state] of states) {
    const clean = validateState(structuredClone(state));
    assert.equal(KEY in clean.checks, KEY in state.checks, 'nothing adds or drops the key');
    assert.deepEqual(clean.checks, state.checks);
  }
  const transfer = validateTransfer(structuredClone(saveExport));
  assert.deepEqual(
    transfer.saves[0]!.profiles[0]!.state.checks,
    saveExport.saves[0]!.profiles[0]!.state.checks,
  );
});

async function start(dir: string) {
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Listening on a TCP port, so address() is an AddressInfo.
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const close = (server: Server) => new Promise(resolve => server.close(resolve));
const post = (url: string, endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
    body: JSON.stringify(body),
  });
const json = async (response: Response) => {
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};

test('Docker edition: Done is kept per profile, a copy gets its own, and survives a restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-ground-moves-'));
  let app = await start(dir);
  try {
    // The default profile (migrated from a handbook one, #495) and a second profile beside it.
    const originalHeaders = { 'X-Save-Id': 'original-save', 'X-Profile-Id': 'original' };
    const before = await json(await fetch(app.url + '/api/state', { headers: originalHeaders }));
    assert.equal(before.checks[KEY], undefined, 'a fresh handbook starts with the moves to do');
    const other = await json(
      await post(app.url, '/api/profiles', {
        saveId: 'original-save',
        name: 'Other',
        settings: {},
      }),
    );
    const otherHeaders = { 'X-Save-Id': other.saveId, 'X-Profile-Id': other.profileId };
    await json(
      await post(app.url, '/api/update', { type: 'check', key: KEY, value: true }, originalHeaders),
    );
    const done = await json(await fetch(app.url + '/api/state', { headers: originalHeaders }));
    assert.equal(done.checks[KEY], true);
    assert.equal(done.version, before.version, 'a tick leaves the content version as it was');
    assert.deepEqual(
      { ...done.checks, [KEY]: undefined },
      { ...before.checks, [KEY]: undefined },
      'every other check is as it was',
    );
    assert.deepEqual(done.deliveries, before.deliveries);
    const untouched = await json(await fetch(app.url + '/api/state', { headers: otherHeaders }));
    assert.equal(untouched.checks[KEY], undefined, 'the other profile still has the moves to do');
    // A copy starts from the source's progress and then keeps its own.
    const copy = await json(
      await post(app.url, '/api/duplicate-profile', {
        saveId: 'original-save',
        profileId: 'original',
      }),
    );
    const copyHeaders = { 'X-Save-Id': copy.saveId, 'X-Profile-Id': copy.profileId };
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: copyHeaders }))).checks[KEY],
      true,
    );
    await json(
      await post(app.url, '/api/update', { type: 'check', key: KEY, value: false }, copyHeaders),
    );
    await close(app.server);
    app = await start(dir);
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: originalHeaders }))).checks[KEY],
      true,
    );
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: copyHeaders }))).checks[KEY],
      false,
    );
    assert.equal(
      (await json(await fetch(app.url + '/api/state', { headers: otherHeaders }))).checks[KEY],
      undefined,
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('browser edition: Done is kept per profile, in a copy too, and goes along in a full export', async () => {
  const handbookState = (): ProgressState => initialState();
  let data: BrowserWorkspace = {
    version: 1,
    activeSave: 's',
    lastBackup: null,
    saves: [
      {
        id: 's',
        name: 'Imported handbook',
        activeProfile: 'a',
        profiles: [
          { id: 'a', name: 'A', kind: 'original', handbook, state: handbookState() },
          { id: 'b', name: 'B', kind: 'original', handbook, state: handbookState() },
        ],
      },
    ],
  };
  function transaction(): Promise<BrowserWorkspace>;
  function transaction<T>(change: (data: BrowserWorkspace) => T): Promise<T>;
  async function transaction<T>(change?: (data: BrowserWorkspace) => T) {
    const copy = structuredClone(data);
    if (!change) return copy;
    const result = change(copy);
    data = copy;
    return structuredClone(result);
  }
  const store: BrowserStore = { transaction };
  // The routes used here never read the catalog.
  const api = createBrowserApi(store, calculate, {} as Catalog),
    send = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const stateOf = async (profile: string) =>
    (await api(`/api/state?save=s&profile=${profile}`)) as ProgressState;
  await send('/api/update', { type: 'check', key: KEY, value: true });
  assert.equal((await stateOf('a')).checks[KEY], true);
  assert.equal((await stateOf('a')).version, 1);
  assert.equal((await stateOf('b')).checks[KEY], undefined, 'profile B is unaffected');
  const copy = (await send('/api/duplicate-profile', { saveId: 's', profileId: 'a' })) as {
    profileId: string;
  };
  await send('/api/update', { type: 'check', key: KEY, value: false });
  assert.equal((await stateOf(copy.profileId)).checks[KEY], false, 'the copy was unticked');
  assert.equal((await stateOf('a')).checks[KEY], true, 'its source keeps its Done');
  const full = (await api('/api/export-saves')) as SaveExport;
  const exported = full.saves[0]!.profiles.find(p => p.id === 'a')!.state;
  assert.equal(exported.checks[KEY], true);
  assert.equal(validateTransfer(structuredClone(full)).saves[0]!.profiles[0]!.state.version, 1);
});
