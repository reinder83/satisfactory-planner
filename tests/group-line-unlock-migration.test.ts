// Saved progress for #1020 (from the #1041 review): before #1041 a new profile's picked unlocks
// (pickedRecipeUnlocks in public/state/carry.ts) ticked 'recipe-unlock-<recipe>:<group>' for a
// factory group's own line made on site ('<recipe>:<group>'), a step the build plan never
// showed. mergeGroupLineUnlocks (public/state/validate.ts, run with the amplified twin's merge as
// mergeOldUnlockKeys) merges such a tick into 'recipe-unlock-<recipe>': the recipe's step is
// ticked when either was, and the group line's key goes. Only a key whose prefix is a known
// alternate recipe (ALTERNATE_RECIPE_IDS) and whose suffix is a group id is merged; anything else
// stays exactly as it was, so no tick is dropped. No state version changes: the result holds only
// keys every release reads. Covers validateState, transfers, both editions' load, import and
// export, and the pre-merge copy (workspace.json.pre-901, the browser edition's pre-901 key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import recipesJson from '../recipes.json' with { type: 'json' };
import { createApp } from '../server.ts';
import { createCommitQueue, loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore, PRE_901 } from '../public/browser-store.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import {
  ALTERNATE_RECIPE_IDS,
  holdsOldUnlockKeys,
  mergeGroupLineUnlocks,
  mutate,
  validateState,
} from '../public/state.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { saveExport, states, version14 } from './types/fixtures.ts';
import type {
  BrowserWorkspace,
  ProgressState,
  SavedState,
  SaveExport,
  WorkspaceFile,
} from '../public/types/index.ts';

const COKE = 'Recipe_Alternate_CokeSteelIngot_C',
  CONCRETE = 'Recipe_Alternate_WetConcrete_C',
  QUICKWIRE = 'Recipe_Alternate_Quickwire_C',
  SCREW = 'Recipe_Alternate_Screw_C';
const unlock = (recipe: string) => 'recipe-unlock-' + recipe;
const lineUnlock = (recipe: string, group = 'fg-plates1') => unlock(recipe) + ':' + group;

// Keys that look like a group line's unlock but are not one, kept exactly as they are: a prefix
// that is no recipe id, a recipe the game data never had, a standard recipe (no unlock step, and
// pickedRecipeUnlocks only ever ticked alternates), a suffix that is no group id, and a key with a
// second ':'.
const KEPT = {
  [lineUnlock('notARecipe')]: true,
  [lineUnlock('Recipe_Alternate_Bogus_C')]: true,
  [lineUnlock('Recipe_IronPlate_C')]: true,
  [unlock(QUICKWIRE) + ':stock']: true,
  [lineUnlock(QUICKWIRE, 'fg-AB')]: true,
  [lineUnlock(QUICKWIRE) + ':fg-motors1']: true,
};

// A version 14 state (the release the group lines came with) as a profile carried before #1041
// saved it: Coke Steel's group line ticked with the recipe's own step ticked too (the usual case),
// Wet Concrete's group line ticked alone, Screw's group line ticked in two groups with the
// recipe's step unticked, and the look-alikes above. The group line's factory tick, a row key,
// is no unlock and stays.
const before = (): SavedState => ({
  ...structuredClone(version14),
  checks: {
    [unlock(COKE)]: true,
    [lineUnlock(COKE)]: true,
    [lineUnlock(CONCRETE)]: true,
    [unlock(SCREW)]: false,
    [lineUnlock(SCREW)]: true,
    [lineUnlock(SCREW, 'fg-motors1')]: true,
    ['calc-3-' + COKE + ':fg-plates1']: true,
    'unlock-Schematic_3-1_C': true,
    ...KEPT,
  },
});
// What validateState makes of it.
const after = (): ProgressState => ({
  ...validateState({ ...before(), checks: {} }),
  checks: {
    [unlock(COKE)]: true,
    [unlock(CONCRETE)]: true,
    [unlock(SCREW)]: true,
    ['calc-3-' + COKE + ':fg-plates1']: true,
    'unlock-Schematic_3-1_C': true,
    ...KEPT,
  },
});

test('validateState merges a group line’s unlock tick into its recipe’s step', () => {
  const input = before(),
    copy = structuredClone(input);
  const merged = validateState(input);
  assert.deepEqual(merged, after());
  assert.equal(merged.version, 14, 'the content version is unchanged');
  assert.deepEqual(input, copy, 'the input is left as it was');
});

test('a tick on either step ticks the recipe’s step; no tick is lost', () => {
  const cases: [boolean | undefined, boolean, boolean][] = [
    [undefined, true, true],
    [undefined, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
    [false, false, false],
  ];
  for (const [own, line, ticked] of cases) {
    const checks: Record<string, boolean> = { [lineUnlock(COKE)]: line };
    if (own !== undefined) checks[unlock(COKE)] = own;
    assert.deepEqual(
      validateState({ ...structuredClone(version14), checks }).checks,
      { [unlock(COKE)]: ticked },
      `recipe's ${own}, group line's ${line}`,
    );
  }
});

test('a key that is not a known alternate’s group line stays exactly as it was', () => {
  const state = { ...structuredClone(version14), checks: { ...KEPT } };
  assert.equal(mergeGroupLineUnlocks(state), false);
  assert.deepEqual(state.checks, KEPT);
  assert.deepEqual(validateState(state).checks, KEPT);
  assert.equal(holdsOldUnlockKeys(state), false, 'and needs no pre-merge copy');
});

test('every released state version loads, and keeps its version', () => {
  for (const [state, version] of states) {
    const plain = validateState(structuredClone(state));
    const merged = validateState({
      ...structuredClone(state),
      checks: { ...state.checks, [lineUnlock(COKE)]: true },
    });
    assert.equal(merged.version, version);
    assert.deepEqual(merged, { ...plain, checks: { ...plain.checks, [unlock(COKE)]: true } });
  }
});

test('the merge runs once: again changes nothing, and a later untick stays', () => {
  const merged = validateState(before());
  assert.deepEqual(validateState(structuredClone(merged)), merged);
  const raw = before();
  assert.equal(mergeGroupLineUnlocks(raw), true);
  const once = structuredClone(raw);
  assert.equal(mergeGroupLineUnlocks(raw), false, 'a second run changes nothing');
  assert.deepEqual(raw, once);
  const unticked = mutate(structuredClone(merged), {
    type: 'check',
    key: unlock(COKE),
    value: false,
  });
  assert.equal(validateState(structuredClone(unticked)).checks[unlock(COKE)], false);
  assert.equal(holdsOldUnlockKeys(merged), false, 'merged data needs no copy');
  const unmerged = before();
  assert.equal(holdsOldUnlockKeys(unmerged), true, 'unmerged data needs one');
  assert.deepEqual(unmerged, before(), 'and asking changes nothing');
});

test('an amplified twin’s key and a group line’s key in one state both merge', () => {
  const merged = validateState({
    ...structuredClone(version14),
    checks: { ['recipe-unlock-amp:' + COKE]: true, [lineUnlock(QUICKWIRE)]: true },
  });
  assert.deepEqual(merged.checks, { [unlock(COKE)]: true, [unlock(QUICKWIRE)]: true });
});

test('mergeGroupLineUnlocks leaves a malformed record for validateState to refuse', () => {
  const raw: Record<string, unknown> = {
    checks: { [lineUnlock(COKE)]: 'yes', [lineUnlock(CONCRETE)]: true, [unlock(CONCRETE)]: 1 },
  };
  assert.equal(mergeGroupLineUnlocks(raw), false);
  assert.deepEqual(raw, {
    checks: { [lineUnlock(COKE)]: 'yes', [lineUnlock(CONCRETE)]: true, [unlock(CONCRETE)]: 1 },
  });
  assert.equal(mergeGroupLineUnlocks({ checks: null }), false);
  assert.throws(() => validateState({ ...structuredClone(version14), checks: raw.checks }));
});

test('ALTERNATE_RECIPE_IDS lists every alternate in recipes.json, each a plain recipe id', () => {
  const listed = new Set(ALTERNATE_RECIPE_IDS);
  for (const recipe of recipesJson.recipes)
    if (recipe.alternate) assert.ok(listed.has(recipe.id), recipe.id + ' is listed');
  assert.equal(listed.size, ALTERNATE_RECIPE_IDS.length, 'no duplicates');
  for (const id of ALTERNATE_RECIPE_IDS) assert.match(id, /^Recipe_[A-Za-z0-9_]+_C$/);
});

// A full export of a release before #1041 with the state above.
const oldExport = (): SaveExport => {
  const data = structuredClone(saveExport);
  data.saves[0]!.profiles[0]!.state = before();
  return data;
};
const stateOf = (data: { saves: { profiles: { state: unknown }[] }[] }, save = 0) =>
  data.saves[save]!.profiles[0]!.state;

test('an old full export imports merged, and exporting and importing again changes nothing', async () => {
  const imported = await importableTransfer(oldExport());
  assert.deepEqual(stateOf(imported), after());
  assert.deepEqual(validateTransfer(oldExport()), imported);
  const again = await importableTransfer({ ...structuredClone(imported), exportedAt: 'x' });
  assert.deepEqual(again, imported);
});

const close = (server: Server) => new Promise(resolve => server.close(resolve));
const workspaceFile = (state: SavedState): WorkspaceFile => ({
  version: 2,
  revision: 0,
  accountsEnabled: false,
  registration: false,
  users: [{ id: 'owner', username: 'Local pioneer', activeSave: 's1' }],
  saves: [{ ...structuredClone(oldExport().saves[0]!), userId: 'owner' }].map(save => {
    save.profiles[0]!.state = state;
    return save;
  }),
  sessions: [],
});

test('Docker edition: an old workspace.json loads merged, keeps its copy, exports and imports merged', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-group-unlock-'));
  const file = path.join(dir, 'workspace.json');
  const raw = JSON.stringify(workspaceFile(before()));
  await fs.writeFile(file, raw);
  const start = async () => {
    const server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
  };
  let app: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const loaded = await loadWorkspace(dir, validateState);
    assert.deepEqual(stateOf(loaded), after());
    app = await start();
    assert.equal(await fs.readFile(file, 'utf8'), raw, 'loading writes nothing');
    const state = await (await fetch(app.url + '/api/state?save=s1&profile=p1')).json();
    assert.deepEqual(state, after());
    const exported = await (await fetch(app.url + '/api/export-saves')).json();
    assert.deepEqual(stateOf(exported), after(), 'an export carries the merged keys');
    // Importing the old file itself: merged on the way in.
    const response = await fetch(app.url + '/api/import-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(oldExport()),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      await fs.readFile(file + '.pre-901', 'utf8'),
      raw,
      'the first write kept the file as read',
    );
    const stored: WorkspaceFile = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(stateOf(stored, 0), after(), 'the first write stores the merge');
    assert.deepEqual(stateOf(stored, 1), after(), 'the imported copy');
    await close(app.server);
    app = await start();
    assert.deepEqual(
      JSON.parse(await fs.readFile(file, 'utf8')),
      stored,
      'a restart changes nothing',
    );
    const { commit } = createCommitQueue(dir, await loadWorkspace(dir, validateState));
    await commit(draft => {
      draft.saves[0]!.name = 'Again';
    });
    assert.equal(await fs.readFile(file + '.pre-901', 'utf8'), raw, 'the copy is written once');
  } finally {
    if (app) await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Pages edition: an old record reads merged, a change writes it back with its copy, export and import', async () => {
  const record: BrowserWorkspace = {
    version: 1,
    activeSave: 's1',
    saves: structuredClone(oldExport().saves),
    lastBackup: null,
  };
  const records = new Map<string, unknown>([['main', structuredClone(record)]]);
  const store = openBrowserStore(fakeIndexedDB(2, records));
  // This edition keeps the state as stored, only merged; validateState normalises it where used.
  const merged = { ...before(), checks: after().checks };
  assert.deepEqual(stateOf(await store.transaction()), merged);
  assert.deepEqual(validateState(merged), after());
  assert.deepEqual(records.get('main'), record, 'a read writes nothing');
  assert.equal(records.has(PRE_901), false);
  const api = createBrowserApi(store, calculate, catalog());
  assert.deepEqual(await api('/api/state'), merged);
  const exported = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(stateOf(exported), merged, 'an export carries the merged keys');
  // Importing the old file itself: merged on the way in.
  await api('/api/import-saves', { body: JSON.stringify(oldExport()) });
  const saves = (records.get('main') as BrowserWorkspace).saves;
  assert.equal(saves.length, 2);
  assert.deepEqual(stateOf({ saves }, 0), merged, 'the write stored the merge');
  assert.deepEqual(stateOf({ saves }, 1), after(), 'the imported copy');
  assert.deepEqual(records.get(PRE_901), record, 'the record as it was before the merge');
  // A reload reads the merged record: nothing left to keep, and the copy stays.
  await openBrowserStore(fakeIndexedDB(2, records)).transaction(data => (data.activeSave = 's1'));
  assert.deepEqual(records.get(PRE_901), record);
});
