import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  browserRequest,
  createBrowserApi,
  workerCalculator,
  type CalculatorWorker,
} from '../public/browser-api.ts';
import { calculate, catalog } from '../planner.ts';
import { openBrowserStore, PRE_HANDBOOK } from '../public/browser-store.ts';
import { handbookToPlan } from '../public/handbook-migration.ts';
import { initialState } from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import recipesJson from '../recipes.json' with { type: 'json' };
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { handbook, recipes } from './helpers/data.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  ProgressState,
  SaveExport,
  WorkspaceSummary,
} from '../public/types/index.ts';

// What POST /api/profiles answers with, as far as these tests read it (the stand-in API
// resolves to unknown, like a fetched reply).
interface ProfileReply {
  saveId: string;
  profileId: string;
  reviewCount: number;
}
test('browser imports reject invalid data atomically and deletion preserves other profiles', async () => {
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
  // These tests read nothing from the catalog, so an empty one stands in for catalog.json.
  const api = createBrowserApi(store, calculate, {} as Catalog),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const first = (await post('/api/profiles', {
    saveName: 'Test save',
    name: 'First',
    settings: { phase: '1', goal: 'minimal' },
  })) as ProfileReply;
  await post('/api/update', { type: 'check', key: 'remember', value: true });
  const second = (await post('/api/profiles', {
    saveId: first.saveId,
    name: 'Second',
    settings: { phase: '1', goal: 'minimal' },
  })) as ProfileReply;
  const before = structuredClone(data);
  await assert.rejects(
    post('/api/import-saves', { format: 'satisfactory-planner-saves', version: 1, saves: [{}] }),
  );
  assert.deepEqual(data, before);
  await assert.rejects(
    post('/api/remove-profile', { saveId: first.saveId, profileId: first.profileId }),
  );
  assert.deepEqual(data, before);
  await post('/api/remove-profile', {
    saveId: first.saveId,
    profileId: second.profileId,
    confirmed: true,
  });
  assert.equal(((await api('/api/state')) as ProgressState).checks.remember, true);
  // A progress backup is refused under any other format, as the server refuses it.
  const backup = (await api('/api/export')) as { format: string };
  const unchanged = structuredClone(data);
  await assert.rejects(
    post('/api/import', { ...backup, format: 'satisfactory-planner-saves' }),
    /Wrong backup format/,
  );
  assert.deepEqual(data, unchanged);
  await post('/api/import', backup);
  const exported = await api('/api/export-saves');
  await post('/api/import-saves', exported);
  const workspace = (await api('/api/workspace')) as WorkspaceSummary;
  assert.equal(workspace.saves.length, 2);
  assert.notEqual(workspace.saves[0]!.id, workspace.saves[1]!.id);
  assert.notEqual(workspace.saves[0]!.profiles[0]!.id, workspace.saves[1]!.profiles[0]!.id);
  assert.equal(((await api('/api/state')) as ProgressState).checks.remember, true);
});

test('preview and profile calculation forward the progress callback to the calculator', async () => {
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
  const api = createBrowserApi(
    store,
    (settings, onProgress) => {
      onProgress?.(4);
      return calculate(settings);
    },
    {} as Catalog,
  );
  const phases: number[] = [];
  await api('/api/preview', {
    body: JSON.stringify({ settings: { phase: '1', goal: 'minimal' } }),
    onProgress: phase => phases.push(phase),
  });
  await api('/api/profiles', {
    body: JSON.stringify({
      saveName: 'Progress save',
      name: 'Progress',
      settings: { phase: '1', goal: 'minimal' },
    }),
    onProgress: phase => phases.push(phase),
  });
  assert.deepEqual(phases, [4, 4], 'both calculating endpoints report solver progress');
});

test('the browser edition carries the same world progress into a new profile', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const settings = { phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' };
  const first = (await post('/api/profiles', {
    saveName: 'Browser world',
    name: 'First',
    settings,
  })) as ProfileReply;
  await post('/api/update', {
    type: 'checks',
    keys: ['unlock-Schematic_1-1_C', 'slot-A01-built', 'calc-1-Recipe_IngotIron_C'],
    value: true,
  });
  await post('/api/update', { type: 'delivery', key: '1-smart-plating', value: 120 });
  const same = (await post('/api/profiles', {
    saveId: first.saveId,
    name: 'Second',
    settings,
    carryFrom: first.profileId,
  })) as ProfileReply;
  let state = (await api('/api/state')) as ProgressState;
  assert.equal(
    state.checks['slot-A01-built'],
    true,
    'the built storage room carries in the browser edition',
  );
  assert.equal(
    state.checks['calc-1-Recipe_IngotIron_C'],
    true,
    'an unchanged production line stays marked running',
  );
  assert.equal(state.deliveries['1-smart-plating'], 120, 'deliveries handed in carry');
  assert.equal(same.reviewCount, 0, 'an identical plan needs no review');
  const bigger = (await post('/api/profiles', {
    saveId: first.saveId,
    name: 'Third',
    settings: { ...settings, multiplier: 2 },
    carryFrom: first.profileId,
  })) as ProfileReply;
  state = (await api('/api/state')) as ProgressState;
  assert.ok(bigger.reviewCount > 0, 'expanded production lines are reported for review');
  assert.equal(
    state.checks['calc-1-Recipe_IngotIron_C'],
    false,
    'a line that needs more machines is left unticked',
  );
  assert.equal(state.checks['unlock-Schematic_1-1_C'], true, 'unlocks carry into a different plan');
  await post('/api/profiles', {
    saveId: first.saveId,
    name: 'Fourth',
    settings,
    carryFrom: first.profileId,
    carry: {},
  });
  assert.deepEqual(
    ((await api('/api/state')) as ProgressState).checks,
    {},
    'clearing every option starts empty',
  );
  await assert.rejects(
    post('/api/profiles', { saveId: first.saveId, name: 'Fifth', settings, carryFrom: 'missing' }),
  );
  const source = data.saves[0]!.profiles[0]!;
  assert.equal(
    source.state.checks['calc-1-Recipe_IngotIron_C'],
    true,
    'the profile carried from is untouched',
  );
});

test('with no save open, a server-only route says it needs a server, not "Save not found"', async () => {
  const empty: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(empty);
      return (change ? change(copy) : copy) as T;
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  await assert.rejects(api('/api/logout', { body: '{}' }), /needs a self-hosted server/);
  await assert.rejects(api('/api/state'), /Save not found/, 'a real save route still says so');
});

test('a failed start is not cached: the next browser request tries again', async () => {
  const saved = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  let fetches = 0;
  // Enough of an IndexedDB to pass the first check; the catalog request then fails.
  Object.assign(globalThis, {
    indexedDB: {},
    fetch: async () => (fetches++, new Response('', { status: 503 })),
  });
  try {
    await assert.rejects(browserRequest('/api/workspace'), /recipe catalog/);
    await assert.rejects(browserRequest('/api/workspace'), /recipe catalog/);
    assert.equal(fetches, 2, 'the catalog is requested again');
  } finally {
    Object.assign(globalThis, saved);
  }
});

// progression.json, which the summary's step counts read (#746), is loaded with the catalog: a
// failed load fails the start the same way, and the next request tries again.
test('a failed progression.json load is not cached either', async () => {
  const saved = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  const fetched: string[] = [];
  Object.assign(globalThis, {
    indexedDB: {},
    fetch: async (url: URL) => {
      const name = url.pathname.split('/').pop()!;
      fetched.push(name);
      return name === 'catalog.json'
        ? new Response(JSON.stringify(catalog()))
        : new Response('', { status: 503 });
    },
  });
  try {
    await assert.rejects(browserRequest('/api/workspace'), /milestone data/);
    await assert.rejects(browserRequest('/api/workspace'), /milestone data/);
    assert.deepEqual(fetched, [
      'catalog.json',
      'progression.json',
      'catalog.json',
      'progression.json',
    ]);
  } finally {
    Object.assign(globalThis, saved);
  }
});

// A stand-in worker that records what it is sent; the test answers for it with reply().
function fakeWorkers() {
  interface Spawned {
    posted: unknown[];
    terminated: boolean;
    worker: CalculatorWorker;
  }
  const spawned: Spawned[] = [];
  const spawn = () => {
    const entry: Spawned = {
      posted: [],
      terminated: false,
      worker: {
        onmessage: null,
        onerror: null,
        postMessage: (message: unknown) => entry.posted.push(message),
        terminate: () => (entry.terminated = true),
      },
    };
    spawned.push(entry);
    return entry.worker;
  };
  const reply = (index: number, data: object) =>
    spawned[index]!.worker.onmessage?.(new MessageEvent('message', { data }));
  return { spawned, spawn, reply };
}
// The worker tests run on mock timers (#221): real ones slip on a busy machine, and a 40 ms wait
// that took past a 60 ms limit made the second test time out once in a while. tick() moves the
// clock exactly, then lets the promises it settled run.
async function onMockTimers(
  t: TestContext,
  body: (tick: (ms: number) => Promise<void>) => Promise<void>,
) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await body(async ms => {
    t.mock.timers.tick(ms);
    await new Promise(resolve => setImmediate(resolve));
  });
}

test('a calculation timeout fails only the running calculation; queued ones move to a fresh worker', t =>
  onMockTimers(t, async tick => {
    const { spawned, spawn, reply } = fakeWorkers();
    const calculate = workerCalculator(spawn, 40);
    const first = Promise.resolve(calculate({ n: 1 }));
    const second = Promise.resolve(calculate({ n: 2 }));
    const firstFailed = assert.rejects(first, /timed out/);
    await tick(39);
    assert.equal(spawned.length, 1, 'not yet at the limit');
    await tick(1);
    await firstFailed;
    assert.equal(spawned.length, 2, 'a fresh worker was started');
    assert.equal(spawned[0]!.terminated, true);
    assert.deepEqual(spawned[1]!.posted, [{ id: 2, settings: { n: 2 } }]);
    reply(1, { id: 2, result: { name: 'second' } });
    assert.deepEqual(await second, { name: 'second' });
  }));

test("a queued calculation's time limit starts when it runs, not while it waits", t =>
  onMockTimers(t, async tick => {
    const { spawned, spawn, reply } = fakeWorkers();
    const calculate = workerCalculator(spawn, 60);
    const progress: number[] = [];
    const first = Promise.resolve(calculate({ n: 1 }));
    const second = Promise.resolve(calculate({ n: 2 }, phase => progress.push(phase)));
    // Progress restarts the running calculation's limit.
    await tick(40);
    reply(0, { id: 1, phase: 2 });
    await tick(40);
    reply(0, { id: 1, result: { name: 'first' } });
    assert.deepEqual(await first, { name: 'first' });
    // 80 ms after it was queued, past the 60 ms limit, the second one is only now starting.
    await tick(59);
    reply(0, { id: 2, phase: 1 });
    await tick(59);
    reply(0, { id: 2, result: { name: 'second' } });
    assert.deepEqual(await second, { name: 'second' });
    assert.deepEqual(progress, [1]);
    assert.equal(spawned.length, 1, 'no timeout restarted the worker');
  }));

test('a full export past the import limit is not recorded as a backup', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'Big', name: 'P', settings: { phase: '1', goal: 'minimal' } }),
  });
  // An oversized note written straight into the record, past what the page could download.
  data.saves[0]!.profiles[0]!.state.notes.huge = 'x'.repeat(51 * 1024 * 1024);
  await api('/api/export-saves');
  assert.equal(data.lastBackup, null, 'the refused export left the reminder alone');
  delete data.saves[0]!.profiles[0]!.state.notes.huge;
  await api('/api/export-saves');
  assert.ok(data.lastBackup, 'a normal full export still counts as a backup');
});

test('the browser edition refuses a stale whole-value write like the server', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'W', name: 'P', settings: { phase: '1', goal: 'minimal' } }),
  });
  const seen = data.saves[0]!.profiles[0]!.state.revision ?? 0;
  const update = (change: object, revision: number) =>
    api('/api/update', {
      body: JSON.stringify(change),
      headers: { 'X-Planner-Revision': String(revision) },
    });
  await update({ type: 'note', key: 'n', value: 'one' }, seen);
  await assert.rejects(
    update({ type: 'note', key: 'n', value: 'two' }, seen),
    (error: Error & { status?: number }) =>
      error.status === 409 && /changed in another tab/.test(error.message),
  );
  await update({ type: 'check', key: 'k', value: true }, seen);
  const state = data.saves[0]!.profiles[0]!.state;
  assert.equal(state.notes.n, 'one');
  assert.equal(state.checks.k, true);
});

// The Pages edition never made handbook profiles; like the server, it refuses the retired
// kind outright instead of calculating one (#496), and stores nothing.
test("POST /api/profiles refuses kind 'original'", async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  let solved = 0;
  const api = createBrowserApi(
    store,
    ((settings: unknown) => (solved++, calculate(settings as never))) as typeof calculate,
    {} as Catalog,
  );
  await assert.rejects(
    api('/api/profiles', {
      body: JSON.stringify({ saveName: 'World', name: 'Handbook', kind: 'original' }),
    }),
    /can no longer be created/,
  );
  assert.equal(solved, 0, 'nothing is calculated');
  assert.deepEqual(data.saves, []);
});

// Retiring the handbook, part 4c (#497), through browserRequest as the Pages edition starts it:
// the store it opens migrates an original profile with its own handbook before the first
// request is answered, loading recipes.json only for that. Runs last in this file, because the
// API it starts stays cached for the tab (the failed-start test above needs none cached).
test('the Pages edition opens an upgraded browser with its original profile migrated', async () => {
  const recipesText = JSON.stringify(recipesJson);
  const progressionText = fs.readFileSync(
    new URL('../public/progression.json', import.meta.url),
    'utf8',
  );
  const conversion = handbookToPlan(handbook, recipes, catalog().pureLimits);
  const factory = handbook.factories.find(f => conversion.rows['3']![f.id])!;
  const row = conversion.rows['3']![factory.id]!;
  const seeded = {
    version: 1,
    activeSave: 's',
    lastBackup: null,
    saves: [
      {
        id: 's',
        name: 'Imported world',
        activeProfile: 'p',
        profiles: [
          {
            id: 'p',
            name: 'Original · 50× complete automation',
            kind: 'original',
            handbook,
            state: {
              ...initialState(),
              // An original profile works on Phase 3 or later (checkPlanStart).
              settings: { phase: '3' },
              revision: 4,
              checks: { ['factory-3-' + factory.id]: true, 'storage-ground-shell': true },
            },
          },
        ],
      },
    ],
  };
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const fetched: string[] = [];
  const saved = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  Object.assign(globalThis, {
    indexedDB: fakeIndexedDB(1, records),
    fetch: async (url: URL) => {
      const name = url.pathname.split('/').pop()!;
      fetched.push(name);
      if (name === 'catalog.json') return new Response(JSON.stringify(catalog()));
      if (name === 'recipes.json') return new Response(recipesText);
      if (name === 'progression.json') return new Response(progressionText);
      return new Response('', { status: 404 });
    },
  });
  try {
    const summary = (await browserRequest('/api/workspace')) as WorkspaceSummary;
    assert.deepEqual(fetched, ['catalog.json', 'progression.json', 'recipes.json']);
    const listed = summary.saves[0]!.profiles[0]!;
    // The summary counts each phase's steps from progression.json (#746), up to the phase
    // worked on: the ones the card reads (#804).
    assert.deepEqual(
      listed.phases!.map(entry => [entry.phase, !!entry.steps]),
      [
        ['3', true],
        ['4', false],
        ['5', false],
      ],
    );
    assert.equal(listed.kind, 'calculated');
    assert.equal(listed.transcribed, true);
    assert.equal(listed.name, 'Original · 50× complete automation');
    const context = (await browserRequest('/api/context')) as ContextReply;
    assert.equal(context.handbook, undefined);
    assert.equal(context.plan!.engine, 'handbook-' + handbook.version);
    assert.equal(context.state.checks['calc-3-' + row], true, 'the factory tick, re-keyed');
    assert.equal(context.state.checks['storage-ground-shell'], true);
    // The migrated profile takes progress like any calculated one.
    await browserRequest('/api/update', {
      body: JSON.stringify({ type: 'check', key: 'phase-3-survey', value: true }),
    });
    assert.equal(((await browserRequest('/api/state')) as ProgressState).revision, 5);
    // And it exports as a calculated profile that imports again.
    const exported = (await browserRequest('/api/export-saves')) as SaveExport;
    const [profile] = validateTransfer(exported).saves[0]!.profiles;
    assert.equal(profile!.kind, 'calculated');
    assert.equal('handbook' in profile!, false);
    assert.deepEqual(records.get(PRE_HANDBOOK), seeded, 'the pre-migration copy');
    // A reload opens the store again: nothing is migrated or copied again.
    const before = structuredClone(records);
    const again = createBrowserApi(
      openBrowserStore(fakeIndexedDB(1, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
    assert.equal(
      ((await again('/api/workspace')) as WorkspaceSummary).saves[0]!.profiles[0]!.kind,
      'calculated',
    );
    assert.deepEqual(records, before);
  } finally {
    Object.assign(globalThis, saved);
  }
});

// request() looks each route up in one of three tables (#525): an unknown route is refused before
// any transaction or scope lookup, reads of the scoped profile use a readonly transaction and
// its changes a readwrite one, and only select and remove-profile take the profile from the body.
test('each route runs in the transaction it always did, and an unknown one opens none', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const opened: string[] = [];
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      opened.push(change ? 'readwrite' : 'readonly');
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const settings = { phase: '1', goal: 'minimal' };
  const first = (await post('/api/profiles', {
    saveName: 'S',
    name: 'A',
    settings,
  })) as ProfileReply;
  const second = (await post('/api/profiles', {
    saveId: first.saveId,
    name: 'B',
    settings,
  })) as ProfileReply;
  const modes = async (run: () => Promise<unknown>) => {
    opened.length = 0;
    await run();
    return [...opened];
  };
  for (const route of ['/api/login', '/api/logout', '/api/nothing', '/api/rank-alternates']) {
    opened.length = 0;
    await assert.rejects(post(route, {}), /^Error: This feature needs a self-hosted server\.$/);
    assert.deepEqual(opened, [], route + ' is refused before any transaction');
  }
  for (const route of ['/api/workspace', '/api/context', '/api/state', '/api/export'])
    assert.deepEqual(await modes(() => api(route)), ['readonly'], route);
  assert.deepEqual(await modes(() => api('/api/export-saves')), ['readwrite']);
  const update = () => post('/api/update', { type: 'note', key: 'n', value: 'x' });
  assert.deepEqual(await modes(update), ['readwrite']);
  // The active profile is B; rename ignores the body's ids, select follows them.
  const ids = { saveId: first.saveId, profileId: first.profileId };
  await post('/api/rename', { ...ids, target: 'profile', name: 'Renamed' });
  const names = () => data.saves[0]!.profiles.map(p => p.name);
  assert.deepEqual(names(), ['A', 'Renamed']);
  assert.equal(data.saves[0]!.activeProfile, second.profileId);
  assert.deepEqual(await modes(() => post('/api/select', ids)), ['readwrite']);
  assert.equal(data.saves[0]!.activeProfile, first.profileId);
  // The scope is still looked up before a route's own checks.
  await assert.rejects(
    api('/api/remove-profile', { body: '{}', headers: { 'X-Save-Id': 'gone' } }),
    /Save not found/,
  );
  await assert.rejects(post('/api/remove-profile', ids), /Confirm profile removal first/);
  assert.equal(data.saves[0]!.profiles.length, 2);
});
