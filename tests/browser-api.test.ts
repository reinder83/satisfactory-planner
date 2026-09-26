import test from 'node:test';
import assert from 'node:assert/strict';
import { browserRequest, createBrowserApi } from '../public/browser-api.ts';
import { calculate } from '../planner.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ProgressState,
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
  // A partial fixture: an empty workspace, without lastBackup.
  const blank: Omit<BrowserWorkspace, 'lastBackup'> = { version: 1, activeSave: null, saves: [] };
  let data = blank as BrowserWorkspace;
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
  // A partial fixture: an empty workspace, without lastBackup.
  const blank: Omit<BrowserWorkspace, 'lastBackup'> = { version: 1, activeSave: null, saves: [] };
  let data = blank as BrowserWorkspace;
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
    onProgress: p => phases.push(p),
  });
  await api('/api/profiles', {
    body: JSON.stringify({
      saveName: 'Progress save',
      name: 'Progress',
      settings: { phase: '1', goal: 'minimal' },
    }),
    onProgress: p => phases.push(p),
  });
  assert.deepEqual(phases, [4, 4], 'both calculating endpoints report solver progress');
});

test('the browser edition carries the same world progress into a new profile', async () => {
  // A partial fixture: an empty workspace, without lastBackup.
  const blank: Omit<BrowserWorkspace, 'lastBackup'> = { version: 1, activeSave: null, saves: [] };
  let data = blank as BrowserWorkspace;
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
  const empty: Omit<BrowserWorkspace, 'lastBackup'> = { version: 1, activeSave: null, saves: [] };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(empty) as BrowserWorkspace;
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

test('a full export past the import limit is not recorded as a backup', async () => {
  // A partial fixture: an empty workspace, without lastBackup.
  const blank: Omit<BrowserWorkspace, 'lastBackup'> = { version: 1, activeSave: null, saves: [] };
  let data = blank as BrowserWorkspace;
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
  assert.equal(data.lastBackup, undefined, 'the refused export left the reminder alone');
  delete data.saves[0]!.profiles[0]!.state.notes.huge;
  await api('/api/export-saves');
  assert.ok(data.lastBackup, 'a normal full export still counts as a backup');
});
