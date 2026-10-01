// Creating a profile of the retired original type, and rounding up a profile that is not
// calculated or already uses whole machines, are refused by both editions with one shared
// message per case (#705). The messages describe the profile, not the retired handbook (owner
// decision 8 on #387), and say what to do instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { profileRoutes } from '../server/profile-routes.ts';
import type { ScopedRequest, WorkspaceContext } from '../server/routing.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import {
  alreadyWholeMachines,
  checkNewProfileKind,
  checkRoundUp,
  initialState,
  retiredProfileType,
  roundUpNeedsCalculated,
} from '../public/state.ts';
import { calculate, rankAlternates } from '../planner.ts';
import type { BrowserWorkspace, Catalog, StageKey, StoredProfile } from '../public/types/index.ts';

const messages = [retiredProfileType, roundUpNeedsCalculated, alreadyWholeMachines];

test('the shared checks refuse each case with its own message and accept the rest', () => {
  assert.throws(() => checkNewProfileKind('original'), {
    status: 400,
    message: retiredProfileType,
  });
  for (const kind of ['calculated', undefined, null])
    assert.doesNotThrow(() => checkNewProfileKind(kind));
  assert.throws(() => checkRoundUp({ kind: 'original' }), {
    status: 400,
    message: roundUpNeedsCalculated,
  });
  assert.throws(
    () => checkRoundUp({ kind: 'calculated', plan: { settings: { wholeMachines: true } } }),
    {
      status: 400,
      message: alreadyWholeMachines,
    },
  );
  for (const wholeMachines of [false, undefined])
    assert.doesNotThrow(() =>
      checkRoundUp({ kind: 'calculated', plan: { settings: { wholeMachines } } }),
    );
});

test('the refusals name neither the handbook nor an original profile, and say what to do', () => {
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.doesNotMatch(message, /handbook|original/i, message);
    assert.match(message, /Create a calculated profile|Round up a profile/, message);
  }
});

test('both editions refuse through the shared checks, with no wording of their own', () => {
  const files = {
    '../public/browser-api.ts': ['checkNewProfileKind(', 'checkRoundUp('],
    '../server/save-routes.ts': ['checkNewProfileKind('],
    '../server/profile-routes.ts': ['checkRoundUp('],
  };
  for (const [file, calls] of Object.entries(files)) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const call of calls) assert.ok(source.includes(call), file + ' calls ' + call);
    assert.doesNotMatch(
      source,
      /can no longer be created|preserved handbook|whole-machine planning\.|without whole-machine production/,
      file,
    );
  }
});

// A workspace with a stored 'original' profile, as an older Pages record could hold one.
const originalProfile = (): StoredProfile => ({
  id: 'old',
  name: 'Old',
  kind: 'original',
  state: initialState(),
});

test('the Pages edition gives the shared message for each refusal', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    // Like openBrowserStore: without `change` the answer is the record itself.
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const ranker = (settings: unknown, phase: StageKey) =>
    rankAlternates(settings as Parameters<typeof rankAlternates>[0], { phase });
  const api = createBrowserApi(store, calculate, {} as Catalog, ranker),
    post = (route: string, body: unknown, headers?: Record<string, string>) =>
      api(route, { body: JSON.stringify(body), ...(headers ? { headers } : {}) });
  await assert.rejects(
    post('/api/profiles', { saveName: 'World', name: 'Old', kind: 'original', settings: {} }),
    { message: retiredProfileType },
  );
  assert.equal(data.saves.length, 0);
  const created = (await post('/api/profiles', {
    saveName: 'World',
    name: 'Precise',
    settings: {},
  })) as { saveId: string; profileId: string };
  const rounded = (await post('/api/round-up', {})) as { profileId: string };
  await assert.rejects(
    post('/api/round-up', {}, { 'X-Save-Id': created.saveId, 'X-Profile-Id': rounded.profileId }),
    { message: alreadyWholeMachines },
  );
  data.saves[0]!.profiles.push(originalProfile());
  const before = structuredClone(data);
  await assert.rejects(
    post('/api/round-up', {}, { 'X-Save-Id': created.saveId, 'X-Profile-Id': 'old' }),
    { message: roundUpNeedsCalculated },
  );
  assert.deepEqual(data, before);
});

test('the Docker edition gives the same message for each refusal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-refusals-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // Listening on a TCP port, so address() is an AddressInfo.
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const original = await post('/api/profiles', {
      saveName: 'World',
      name: 'Old',
      kind: 'original',
      settings: {},
    });
    assert.equal(original.status, 400);
    assert.equal((await original.json()).error, retiredProfileType);
    const created = await post('/api/profiles', {
      saveName: 'World',
      name: 'Precise',
      settings: {},
    });
    assert.ok(created.ok, await created.clone().text());
    const { saveId, profileId } = await created.json();
    const rounded = await post(
      '/api/round-up',
      {},
      { 'X-Save-Id': saveId, 'X-Profile-Id': profileId },
    );
    assert.ok(rounded.ok, await rounded.clone().text());
    const again = await post(
      '/api/round-up',
      {},
      { 'X-Save-Id': saveId, 'X-Profile-Id': (await rounded.json()).profileId },
    );
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, alreadyWholeMachines);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
  // The server migrates every stored original profile when it loads the workspace, so the
  // route is reached with one only directly. checkRoundUp runs before the route uses its context.
  const routes = profileRoutes({} as WorkspaceContext);
  await assert.rejects(
    // A partial request: the refusal reads only the profile.
    routes.roundUp({ profile: originalProfile() } as ScopedRequest),
    { status: 400, message: roundUpNeedsCalculated },
  );
});
