// The pre-merge copy for #901 (AGENTS.md: keep a recoverable copy of the data before a migration
// changes it). Saved progress from before #901 holds an amplified twin's unlock records
// ('recipe-unlock-amp:<recipe>'), which mergeAmplifiedUnlocks merges into the recipe's step
// (amplified-unlock-migration.test.ts). Before the first write that stores the merge, the Docker
// edition keeps workspace.json as it was read in workspace.json.pre-901, and the browser edition
// keeps its record under the key PRE_901 in that write's own transaction. Each is written once and
// never replaced; data without such records never gets one; a failed write leaves everything as
// it was. Imports need no copy: the imported file is the copy.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommitQueue, loadWorkspace } from '../server/persistence.ts';
import { openBrowserStore, PRE_901 } from '../public/browser-store.ts';
import { holdsAmplifiedUnlocks, validateState } from '../public/state.ts';
import { fakeIndexedDB, type FakeControls } from './helpers/fake-indexeddb.ts';
import { saveExport, version3 } from './types/fixtures.ts';
import type {
  BrowserWorkspace,
  SavedState,
  SaveExport,
  WorkspaceFile,
} from '../public/types/index.ts';

const COKE = 'Recipe_Alternate_CokeSteelIngot_C',
  QUICKWIRE = 'Recipe_Alternate_Quickwire_C';
const unlock = (recipe: string) => 'recipe-unlock-' + recipe;
const twinUnlock = (recipe: string) => 'recipe-unlock-amp:' + recipe;

// A state as a release before #901 saved it: a ticked twin step with a title of its own, and
// Quickwire's twin and recipe steps both titled, so the twin's title stays under its old id.
const old = (): SavedState => ({
  ...structuredClone(version3),
  checks: { [twinUnlock(COKE)]: true, [unlock(QUICKWIRE)]: true, 'phase-3-survey': true },
  taskEdits: {
    titles: {
      [twinUnlock(COKE)]: 'Coke Steel drive',
      [twinUnlock(QUICKWIRE)]: 'Quickwire (amplified)',
      [unlock(QUICKWIRE)]: 'Quickwire for the cable lines',
    },
  },
});
// The same progress without such records.
const current = (): SavedState => ({
  ...structuredClone(version3),
  checks: { [unlock(COKE)]: true, 'phase-3-survey': true },
});
const saves = (state: SavedState): SaveExport['saves'] => {
  const data = structuredClone(saveExport.saves);
  data[0]!.profiles[0]!.state = state;
  return data;
};

test('holdsAmplifiedUnlocks: only records the merge would change, and it changes nothing', () => {
  const state = old(),
    copy = structuredClone(state);
  assert.equal(holdsAmplifiedUnlocks(state), true);
  assert.deepEqual(state, copy, 'the state is left as it was');
  assert.equal(holdsAmplifiedUnlocks(current()), false);
  // What stays after the merge (the twin's title kept under its old id) needs no copy.
  assert.equal(holdsAmplifiedUnlocks(validateState(old())), false);
  assert.equal(holdsAmplifiedUnlocks({ taskEdits: { order: { '3': [twinUnlock(COKE)] } } }), true);
});

// ---- Docker edition: workspace.json.pre-901 ----

const workspaceFile = (state: SavedState): WorkspaceFile => ({
  version: 2,
  revision: 0,
  accountsEnabled: false,
  registration: false,
  users: [{ id: 'owner', username: 'Local pioneer', activeSave: 's1' }],
  saves: saves(state).map(save => ({ ...save, userId: 'owner' })),
  sessions: [],
});
const dataDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'planner-pre-901-'));
const read = (dir: string, name = 'workspace.json') => fs.readFile(path.join(dir, name), 'utf8');
const exists = (dir: string, name: string) =>
  fs.access(path.join(dir, name)).then(
    () => true,
    () => false,
  );
// Opens dataDir as the server does and returns its commit queue.
const open = async (dir: string) => createCommitQueue(dir, await loadWorkspace(dir, validateState));
const rename = (name: string) => (draft: WorkspaceFile) => {
  draft.saves[0]!.name = name;
};

test('Docker: the first write keeps workspace.json as read in workspace.json.pre-901, once', async () => {
  const dir = await dataDir();
  try {
    const raw = JSON.stringify(workspaceFile(old()));
    await fs.writeFile(path.join(dir, 'workspace.json'), raw);
    const { commit } = await open(dir);
    assert.equal(await exists(dir, 'workspace.json.pre-901'), false, 'loading writes nothing');
    assert.equal(await read(dir), raw);
    await commit(rename('First'));
    assert.equal(await read(dir, 'workspace.json.pre-901'), raw, 'the pre-merge copy');
    const stored = JSON.parse(await read(dir)) as WorkspaceFile;
    assert.equal(stored.saves[0]!.profiles[0]!.state.checks[unlock(COKE)], true, 'merged');
    assert.equal(twinUnlock(COKE) in stored.saves[0]!.profiles[0]!.state.checks, false);
    await commit(rename('Second'));
    // A restart reads the merged file: nothing left to keep.
    const again = await open(dir);
    await again.commit(rename('Third'));
    assert.equal(await read(dir, 'workspace.json.pre-901'), raw, 'written once');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Docker: a workspace without such records never gets a pre-901 copy', async () => {
  const dir = await dataDir();
  try {
    await fs.writeFile(path.join(dir, 'workspace.json'), JSON.stringify(workspaceFile(current())));
    const { commit } = await open(dir);
    await commit(rename('First'));
    await commit(rename('Second'));
    assert.equal(await exists(dir, 'workspace.json.pre-901'), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Docker: an existing workspace.json.pre-901 is never replaced', async () => {
  const dir = await dataDir();
  try {
    const earlier = JSON.stringify({ kept: 'earlier' });
    await fs.writeFile(path.join(dir, 'workspace.json.pre-901'), earlier);
    await fs.writeFile(path.join(dir, 'workspace.json'), JSON.stringify(workspaceFile(old())));
    const { commit } = await open(dir);
    await commit(rename('First'));
    assert.equal(await read(dir, 'workspace.json.pre-901'), earlier);
    const stored = JSON.parse(await read(dir)) as WorkspaceFile;
    assert.equal(stored.saves[0]!.name, 'First', 'the write itself goes ahead');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Docker: a failed copy stops the write and leaves everything as it was; the next write keeps it', async () => {
  const dir = await dataDir();
  try {
    const raw = JSON.stringify(workspaceFile(old()));
    await fs.writeFile(path.join(dir, 'workspace.json'), raw);
    const { commit, current: now } = await open(dir);
    const loaded = structuredClone(now());
    const writeFile = fs.writeFile;
    const failing = mock.method(fs, 'writeFile', (async (file, ...rest) =>
      String(file).endsWith('.pre-901')
        ? Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
        : writeFile(file, ...rest)) as typeof fs.writeFile);
    try {
      await assert.rejects(commit(rename('Lost')), /disk full/);
    } finally {
      failing.mock.restore();
    }
    assert.equal(await read(dir), raw, 'workspace.json is as it was');
    assert.equal(await exists(dir, 'workspace.json.bak'), false, 'no backup written either');
    assert.equal(await exists(dir, 'workspace.json.pre-901'), false);
    assert.deepEqual(now(), loaded, 'the workspace in memory is as it was');
    await commit(rename('Kept'));
    assert.equal(await read(dir, 'workspace.json.pre-901'), raw);
    assert.equal((JSON.parse(await read(dir)) as WorkspaceFile).saves[0]!.name, 'Kept');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---- Browser edition: the PRE_901 key ----

const controls = (): FakeControls => ({ db: null, failNextCommit: false, writes: 0 });
const record = (state: SavedState): BrowserWorkspace => ({
  version: 1,
  activeSave: 's1',
  saves: saves(state),
  lastBackup: null,
});
const stateIn = (records: Map<string, unknown>) =>
  (records.get('main') as BrowserWorkspace).saves[0]!.profiles[0]!.state;

test('Pages: the first write keeps the record as read under PRE_901 in its own transaction, once', async () => {
  const seeded = record(old());
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const fake = controls();
  const store = openBrowserStore(fakeIndexedDB(2, records, fake));
  await store.transaction();
  assert.equal(records.has(PRE_901), false, 'a read writes nothing');
  await store.transaction(data => (data.activeSave = 's1'));
  assert.equal(fake.writes, 1, 'one transaction wrote both keys');
  assert.deepEqual(records.get(PRE_901), seeded, 'the record as it was before the merge');
  assert.equal(stateIn(records).checks[unlock(COKE)], true, 'main is stored merged');
  assert.equal(twinUnlock(COKE) in stateIn(records).checks, false);
  await store.transaction(data => (data.saves[0]!.name = 'Again'));
  // A new connection (a reload) reads the merged record: nothing left to keep.
  await openBrowserStore(fakeIndexedDB(2, records)).transaction(data => (data.activeSave = 's1'));
  assert.deepEqual(records.get(PRE_901), seeded, 'written once');
});

test('Pages: a record without such records never gets a PRE_901 copy', async () => {
  const records = new Map<string, unknown>([['main', record(current())]]);
  const store = openBrowserStore(fakeIndexedDB(2, records));
  await store.transaction(data => (data.activeSave = 's1'));
  await store.transaction(data => (data.saves[0]!.name = 'Again'));
  assert.equal(records.has(PRE_901), false);
});

test('Pages: an existing PRE_901 copy is never replaced', async () => {
  const earlier = { kept: 'earlier' };
  const records = new Map<string, unknown>([
    ['main', record(old())],
    [PRE_901, earlier],
  ]);
  const store = openBrowserStore(fakeIndexedDB(2, records));
  await store.transaction(data => (data.saves[0]!.name = 'First'));
  assert.deepEqual(records.get(PRE_901), earlier);
  assert.equal((records.get('main') as BrowserWorkspace).saves[0]!.name, 'First');
  assert.equal(stateIn(records).checks[unlock(COKE)], true);
});

test('Pages: a failed write stores neither key; the next write keeps the copy', async () => {
  const seeded = record(old());
  const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
  const fake = controls();
  const store = openBrowserStore(fakeIndexedDB(2, records, fake));
  await assert.rejects(
    store.transaction(() => {
      throw Error('change failed');
    }),
    /change failed/,
  );
  fake.failNextCommit = true;
  await assert.rejects(store.transaction(data => (data.saves[0]!.name = 'Lost')));
  assert.deepEqual(records.get('main'), seeded, 'the record is as it was');
  assert.equal(records.has(PRE_901), false, 'and no copy is half written');
  await store.transaction(data => (data.saves[0]!.name = 'Kept'));
  assert.deepEqual(records.get(PRE_901), seeded);
  assert.equal((records.get('main') as BrowserWorkspace).saves[0]!.name, 'Kept');
});
