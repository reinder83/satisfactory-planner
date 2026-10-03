// The items a factory group makes on site (#868, #874): the saved field factoryGroups.local,
// state version 14. Only stored and validated here; nothing reads it yet. Covers both editions:
// the Docker server (createApp, workspace.json) and the browser edition (createBrowserApi over
// openBrowserStore), which share validateState.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import recipesJson from '../recipes.json' with { type: 'json' };
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { validateTransfer } from '../public/transfer.ts';
import {
  ITEM_NAMES,
  initialState,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version3, version13, version14 } from './types/fixtures.ts';
import type {
  ProgressState,
  SavedState,
  SaveExport,
  WorkspaceSummary,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const LOCAL = { 'fg-plates1': ['Iron Rod', 'Screws'] };
// A version 3 state (one group, no links) with items made on site.
const withLocal = (local: unknown = LOCAL) =>
  json({ ...version3, factoryGroups: { ...version3.factoryGroups, local } });
const twoGroups = () => {
  let state = initialState();
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return json({
    ...state,
    factoryGroups: {
      ...state.factoryGroups,
      local: { 'fg-plates1': ['Screws'], 'fg-motors1': ['Wire', 'Copper Sheet'] },
    },
  });
};

test('every item of the game data is a known item, listed once', () => {
  assert.equal(new Set(ITEM_NAMES).size, ITEM_NAMES.length);
  const listed = new Set(ITEM_NAMES);
  for (const name of Object.keys(recipesJson.items)) assert.ok(listed.has(name), name);
});

test('items made on site are kept as version 14; without them the state keeps its version', () => {
  const clean = validateState(withLocal());
  assert.deepEqual(clean.factoryGroups.local, LOCAL);
  assert.equal(clean.version, 14, 'an older release would drop the choice');
  assert.deepEqual(validateState(json(clean)), clean, 'round-trips unchanged');
  // The lowest version the content needs: the same state without the field stays 3.
  assert.equal(validateState(json(version3)).version, 3);
  // An empty map is no content: dropped, and the version stays.
  const empty = validateState(withLocal({}));
  assert.equal('local' in empty.factoryGroups, false);
  assert.equal(empty.version, 3);
  // A newer version is still refused with the update message.
  assert.throws(() => validateState({ ...json(clean), version: 15 }), /newer planner version/);
  // The fixture of the new shape, on top of every earlier version's content.
  assert.equal(validateState(json(version14)).version, 14);
});

test('items made on site are refused, like the rest of the groups, unless every entry is valid', () => {
  const refused: [string, unknown][] = [
    ['not a map', ['Screws']],
    ['an unknown group', { 'fg-gone01': ['Screws'] }],
    ['a group id that is no group id', { plates: ['Screws'] }],
    ['an unknown item', { 'fg-plates1': ['Screws', 'Unobtainium'] }],
    ['an item name in another case', { 'fg-plates1': ['screws'] }],
    ['an item listed twice', { 'fg-plates1': ['Screws', 'Screws'] }],
    ['an empty list', { 'fg-plates1': [] }],
    ['not a list', { 'fg-plates1': 'Screws' }],
    ['a non-string item', { 'fg-plates1': [5] }],
  ];
  for (const [label, local] of refused)
    assert.throws(() => validateState(withLocal(local)), /Invalid items made on site/, label);
});

test('deleting a group drops its items made on site; renaming keeps them', () => {
  let state: ProgressState = validateState(twoGroups());
  assert.equal(state.version, 14);
  state = mutate(state, { type: 'factoryGroupRename', id: 'fg-plates1', name: 'Plate works' });
  assert.deepEqual(state.factoryGroups.local, {
    'fg-plates1': ['Screws'],
    'fg-motors1': ['Wire', 'Copper Sheet'],
  });
  // Other group edits leave them alone too.
  state = mutate(state, { type: 'factoryAssign', key: 'Recipe_Wire_C', groups: [] });
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-motors1' });
  assert.deepEqual(state.factoryGroups.local, { 'fg-plates1': ['Screws'] });
  assert.equal(state.version, 14);
  // The last one going takes the field, and the version, with it.
  state = mutate(state, { type: 'factoryGroupRemove', id: 'fg-plates1' });
  assert.equal('local' in state.factoryGroups, false);
  assert.equal(state.version, 1);
});

test('every released format with groups loads unchanged and round-trips without gaining the field', () => {
  const released = states.filter(([, version]) => version < 14);
  assert.equal(released.length, 14, 'versions 1 to 13, with and without a revision');
  for (const [saved, version] of released) {
    const label = 'version ' + version;
    const clean = validateState(json(saved));
    assert.equal(clean.version, version, label);
    assert.equal('local' in clean.factoryGroups, false, label);
    // The groups, assignments and links as saved, nothing added.
    const groups = saved.factoryGroups;
    assert.deepEqual(
      clean.factoryGroups,
      {
        groups: groups?.groups ?? [],
        assignments: groups?.assignments ?? {},
        ...(groups?.links ? { links: groups.links } : {}),
      },
      label,
    );
    const again = validateState(json(clean));
    assert.deepEqual(again, clean, label + ' round-trips');
    // Group edits, sharing and a carried profile do not add it either.
    let edited = clean;
    for (const group of clean.factoryGroups.groups)
      edited = mutate(edited, { type: 'factoryGroupRename', id: group.id, name: 'Renamed' });
    edited = mutate(edited, { type: 'factoryGroupAdd', id: 'fg-added1', name: 'Added' });
    edited = mutate(edited, { type: 'factoryGroupRemove', id: 'fg-added1' });
    assert.equal('local' in edited.factoryGroups, false, label + ' edited');
    assert.equal(edited.version, version, label + ' edited');
    assert.equal('local' in shareState(json(clean)).factoryGroups, false, label + ' shared');
    const carried = newProfileState(null, json(clean) as SavedState, null, undefined, undefined);
    assert.equal('local' in carried.state.factoryGroups, false, label + ' carried');
  }
});

test('a profile carried from one keeps its groups’ items made on site, and a share keeps them', () => {
  const source = validateState(json(version14));
  const carried = newProfileState(null, json(source), null, { planEdits: true }, undefined).state;
  assert.deepEqual(carried.factoryGroups.local, version14.factoryGroups.local);
  assert.equal(carried.version, 14);
  // Without the plan edits the groups stay behind, and so do their items.
  const bare = newProfileState(null, json(source), null, {}, undefined).state;
  assert.equal('local' in bare.factoryGroups, false);
  // A share strips progress, not plan edits such as the groups.
  assert.deepEqual(shareState(json(source)).factoryGroups.local, version14.factoryGroups.local);
  assert.equal(validateState(json(version13)).version, 13);
});

// The Docker edition: a progress import and its update operations through the server, and the
// field kept in workspace.json across a restart. A bad import is refused and changes nothing.
test('the Docker server stores items made on site, keeps them on restart and drops them with the group', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-local-'));
  const listen = async () => {
    const server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
  };
  const close = (server: { close: (done: () => void) => void }) =>
    new Promise<void>(resolve => server.close(() => resolve()));
  const post = (url: string, endpoint: string, data: unknown) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(data),
    });
  let app = await listen();
  try {
    const made = await post(app.url, '/api/profiles', {
      saveName: 'World',
      name: 'Balanced',
      settings: {},
    });
    assert.equal(made.status, 201);
    const state = async () => (await (await fetch(app.url + '/api/state')).json()) as ProgressState;
    assert.equal((await post(app.url, '/api/import', twoGroups())).status, 200);
    assert.equal((await state()).version, 14);
    const before = await state();
    for (const bad of [{ 'fg-plates1': ['Unobtainium'] }, { 'fg-gone01': ['Screws'] }]) {
      const refused = await post(app.url, '/api/import', withLocal(bad));
      assert.equal(refused.status, 400);
      assert.match((await refused.json()).error, /Invalid items made on site/);
    }
    assert.deepEqual(await state(), before, 'a refused import changes nothing');
    await close(app.server);
    app = await listen();
    const reloaded = await state();
    assert.deepEqual(reloaded.factoryGroups.local, {
      'fg-plates1': ['Screws'],
      'fg-motors1': ['Wire', 'Copper Sheet'],
    });
    const file = JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'));
    assert.deepEqual(
      file.saves[0].profiles[0].state.factoryGroups.local,
      reloaded.factoryGroups.local,
    );
    await post(app.url, '/api/update', {
      type: 'factoryGroupRename',
      id: 'fg-motors1',
      name: 'Motor works',
    });
    await post(app.url, '/api/update', { type: 'factoryGroupRemove', id: 'fg-plates1' });
    const after = await state();
    assert.deepEqual(after.factoryGroups.local, { 'fg-motors1': ['Wire', 'Copper Sheet'] });
    // A full export carries it, and passes the import's check with it.
    const exported = (await (await fetch(app.url + '/api/export-saves')).json()) as SaveExport;
    assert.deepEqual(
      validateTransfer(exported).saves[0]!.profiles[0]!.state.factoryGroups?.local,
      after.factoryGroups.local,
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// The browser edition: the same through createBrowserApi over the IndexedDB store, read back by
// a fresh store as a reload would.
test('the browser edition stores items made on site, keeps them on reload and drops them with the group', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  await post('/api/profiles', {
    saveName: 'World',
    name: 'First',
    settings: { phase: '1', goal: 'minimal' },
  });
  await post('/api/import', twoGroups());
  const before = (await api('/api/state')) as ProgressState;
  assert.equal(before.version, 14);
  await assert.rejects(
    post('/api/import', withLocal({ 'fg-plates1': ['Screws', 'Screws'] })),
    /Invalid items made on site/,
  );
  assert.deepEqual(await api('/api/state'), before, 'a refused import changes nothing');
  api = open();
  const reloaded = (await api('/api/state')) as ProgressState;
  assert.deepEqual(reloaded.factoryGroups.local, before.factoryGroups.local);
  await post('/api/update', { type: 'factoryGroupRename', id: 'fg-plates1', name: 'Plate works' });
  await post('/api/update', { type: 'factoryGroupRemove', id: 'fg-motors1' });
  const after = (await api('/api/state')) as ProgressState;
  assert.deepEqual(after.factoryGroups.local, { 'fg-plates1': ['Screws'] });
  // A full export round-trips through the import as a new copy that keeps it.
  await post('/api/import-saves', await api('/api/export-saves'));
  const summary = (await api('/api/workspace')) as WorkspaceSummary;
  assert.equal(summary.saves.length, 2);
  assert.deepEqual(((await api('/api/state')) as ProgressState).factoryGroups.local, {
    'fg-plates1': ['Screws'],
  });
});
