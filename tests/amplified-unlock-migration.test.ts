// Saved progress for #901: releases before it gave an amplified alternate line ('amp:<recipe>') an
// unlock step of its own, 'recipe-unlock-amp:<recipe>'. Now it shares its recipe's step
// (amplified-unlock.test.ts), and mergeAmplifiedUnlocks (public/state/validate.ts) merges those
// records into the recipe's: the recipe's step is ticked when either was, the twin's own step
// edits move to the recipe's step where it has none, and nothing else changes. validateState runs
// it on every load, import, update and new profile in both editions; the browser edition also on
// each record it reads, since it serves stored progress without validating it. No state version
// changes, so every released version loads, and a state without such keys comes out as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { mergeAmplifiedUnlocks, mutate, validateState } from '../public/state.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { saveExport, states, version1, version15, version3 } from './types/fixtures.ts';
import type {
  BrowserWorkspace,
  ProgressState,
  SavedState,
  SaveExport,
  WorkspaceFile,
} from '../public/types/index.ts';

const COKE = 'Recipe_Alternate_CokeSteelIngot_C',
  CONCRETE = 'Recipe_Alternate_WetConcrete_C',
  QUICKWIRE = 'Recipe_Alternate_Quickwire_C';
const unlock = (recipe: string) => 'recipe-unlock-' + recipe;
const twinUnlock = (recipe: string) => 'recipe-unlock-amp:' + recipe;

// A version 3 state as a release before #901 saved it: an amplified Coke Steel line ticked on its
// own step, which the user renamed and moved; Wet Concrete's twin step ticked while its recipe's
// step was left unticked, and the twin's step removed; Quickwire's twin step left unticked with the
// recipe's ticked, both with a title of their own. The amplified line's factory tick, a row key,
// is no unlock and stays as it is.
const before = (): SavedState => ({
  ...structuredClone(version3),
  checks: {
    [twinUnlock(COKE)]: true,
    [twinUnlock(CONCRETE)]: true,
    [unlock(CONCRETE)]: false,
    [twinUnlock(QUICKWIRE)]: false,
    [unlock(QUICKWIRE)]: true,
    ['calc-3-amp:' + COKE]: true,
    'unlock-Schematic_3-1_C': true,
  },
  taskEdits: {
    order: {
      '3': ['hard-drives-3', twinUnlock(COKE), unlock(QUICKWIRE), twinUnlock(QUICKWIRE)],
    },
    removed: ['phase-3-retire-power', twinUnlock(CONCRETE)],
    titles: {
      [twinUnlock(COKE)]: 'Coke Steel from the crash site drive',
      [twinUnlock(QUICKWIRE)]: 'Quickwire (amplified)',
      [unlock(QUICKWIRE)]: 'Quickwire for the cable lines',
    },
    bodies: { [twinUnlock(COKE)]: 'Scan it next to the oil field.' },
    links: { [twinUnlock(COKE)]: 'amp:' + COKE },
  },
});
// What validateState makes of it.
const after = (): ProgressState => ({
  ...validateState({ ...before(), checks: {}, taskEdits: undefined }),
  checks: {
    [unlock(COKE)]: true,
    [unlock(CONCRETE)]: true,
    [unlock(QUICKWIRE)]: true,
    ['calc-3-amp:' + COKE]: true,
    'unlock-Schematic_3-1_C': true,
  },
  taskEdits: {
    // The twin's place goes to the recipe's step; Quickwire's step already had one.
    order: { '3': ['hard-drives-3', unlock(COKE), unlock(QUICKWIRE), twinUnlock(QUICKWIRE)] },
    // Removing the duplicate does not hide the recipe's step.
    removed: ['phase-3-retire-power', twinUnlock(CONCRETE)],
    titles: {
      [unlock(COKE)]: 'Coke Steel from the crash site drive',
      // The recipe's own title stays; the twin's is kept under its old id.
      [twinUnlock(QUICKWIRE)]: 'Quickwire (amplified)',
      [unlock(QUICKWIRE)]: 'Quickwire for the cable lines',
    },
    bodies: { [unlock(COKE)]: 'Scan it next to the oil field.' },
    links: { [unlock(COKE)]: 'amp:' + COKE },
  },
});

test('validateState merges a twin’s unlock ticks and step edits into its recipe’s step', () => {
  const input = before(),
    copy = structuredClone(input);
  const merged = validateState(input);
  assert.deepEqual(merged, after());
  assert.equal(merged.version, 3, 'the content version is unchanged');
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
  for (const [own, twin, ticked] of cases) {
    const checks: Record<string, boolean> = { [twinUnlock(COKE)]: twin };
    if (own !== undefined) checks[unlock(COKE)] = own;
    assert.deepEqual(
      validateState({ ...structuredClone(version1), checks }).checks,
      { [unlock(COKE)]: ticked },
      `recipe's ${own}, twin's ${twin}`,
    );
  }
});

test('every released state version loads, the oldest (1) and the last (15) included', () => {
  for (const [state, version] of states) {
    const plain = validateState(structuredClone(state));
    const merged = validateState({
      ...structuredClone(state),
      checks: { ...state.checks, [twinUnlock(COKE)]: true },
    });
    assert.equal(merged.version, version);
    assert.deepEqual(merged, { ...plain, checks: { ...plain.checks, [unlock(COKE)]: true } });
  }
  // Those two by name, with step edits on top.
  for (const state of [version1, version15]) {
    const merged = validateState({
      ...structuredClone(state),
      checks: { ...state.checks, [twinUnlock(COKE)]: true },
      taskEdits: { titles: { [twinUnlock(COKE)]: 'Coke Steel' } },
    });
    assert.equal(merged.checks[unlock(COKE)], true);
    assert.deepEqual(merged.taskEdits.titles, { [unlock(COKE)]: 'Coke Steel' });
    assert.equal(merged.version, Math.max(state.version, 3), 'step edits are version 3, as ever');
  }
});

test('the merge runs once: again changes nothing, and a later untick stays', () => {
  const merged = validateState(before());
  assert.deepEqual(validateState(structuredClone(merged)), merged);
  const unticked = mutate(structuredClone(merged), {
    type: 'check',
    key: unlock(COKE),
    value: false,
  });
  assert.equal(unticked.checks[unlock(COKE)], false);
  assert.equal(validateState(structuredClone(unticked)).checks[unlock(COKE)], false);
  // A state without such keys comes out exactly as before.
  for (const [state] of states)
    assert.deepEqual(
      validateState(structuredClone(state)),
      validateState(validateState(structuredClone(state))),
    );
});

test('a tick sent by a tab of an earlier release lands on the recipe’s step', () => {
  const state = validateState(structuredClone(version1));
  const ticked = mutate(state, { type: 'check', key: twinUnlock(COKE), value: true });
  assert.equal(ticked.checks[unlock(COKE)], true);
  assert.equal(twinUnlock(COKE) in ticked.checks, false);
});

test('mergeAmplifiedUnlocks leaves a malformed record for validateState to refuse', () => {
  const raw: Record<string, unknown> = {
    checks: { [twinUnlock(COKE)]: 'yes', [twinUnlock(CONCRETE)]: true, [unlock(CONCRETE)]: 1 },
    taskEdits: { order: { '3': [7, twinUnlock(COKE)] }, titles: 'none' },
  };
  mergeAmplifiedUnlocks(raw);
  assert.deepEqual(raw, {
    checks: { [twinUnlock(COKE)]: 'yes', [twinUnlock(CONCRETE)]: true, [unlock(CONCRETE)]: 1 },
    taskEdits: { order: { '3': [7, unlock(COKE)] }, titles: 'none' },
  });
  assert.throws(() => validateState({ ...structuredClone(version1), checks: raw.checks }));
});

// A full export of a release before #901 with the state above.
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

test('Docker edition: an old workspace.json loads merged, exports and imports merged', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-amp-unlock-'));
  const file = path.join(dir, 'workspace.json');
  const workspace: WorkspaceFile = {
    version: 2,
    revision: 0,
    accountsEnabled: false,
    registration: false,
    users: [{ id: 'owner', username: 'Local pioneer', activeSave: 's1' }],
    saves: [{ ...structuredClone(oldExport().saves[0]!), userId: 'owner' }],
    sessions: [],
  };
  const raw = JSON.stringify(workspace);
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
    assert.deepEqual(stateOf(exported), after());
    const response = await fetch(app.url + '/api/import-saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(exported),
    });
    assert.equal(response.status, 200, await response.clone().text());
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
  } finally {
    if (app) await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Pages edition: an old record reads merged, a change writes it back, export and import', async () => {
  const record: BrowserWorkspace = {
    version: 1,
    activeSave: 's1',
    saves: structuredClone(oldExport().saves),
    lastBackup: null,
  };
  const records = new Map<string, unknown>([['main', structuredClone(record)]]);
  const store = openBrowserStore(fakeIndexedDB(1, records));
  // This edition keeps the state as stored, only merged; validateState normalises it where used.
  const merged = { ...before(), checks: after().checks, taskEdits: after().taskEdits };
  assert.deepEqual(stateOf(await store.transaction()), merged);
  assert.deepEqual(validateState(merged), after());
  assert.deepEqual(records.get('main'), record, 'a read writes nothing');
  const api = createBrowserApi(store, calculate, catalog());
  assert.deepEqual(await api('/api/state'), merged);
  const exported = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(stateOf(exported), merged);
  await api('/api/import-saves', { body: JSON.stringify(exported) });
  const saves = (records.get('main') as BrowserWorkspace).saves;
  assert.equal(saves.length, 2);
  assert.deepEqual(stateOf({ saves }, 0), merged, 'the write stored the merge');
  assert.deepEqual(stateOf({ saves }, 1), after(), 'the imported copy');
});
