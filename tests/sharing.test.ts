import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import type { BrowserStore } from '../public/browser-store.ts';
import { calculate } from '../planner.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ProgressState,
  SaveExport,
  WorkspaceSummary,
} from '../public/types/index.ts';
async function start(dir: string) {
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  // Listening on a TCP port, so address() is an AddressInfo.
  return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}
const close = (s: Server) => new Promise(r => s.close(r));
const post = (url: string, endpoint: string, b: unknown, headers: Record<string, string> = {}) =>
  fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
    body: JSON.stringify(b),
  });
const json = async (r: Response) => {
  assert.ok(r.ok, await r.clone().text());
  return r.json();
};

test('a shared profile exports one profile without progress and imports as a fresh copy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-share-'));
  const app = await start(dir);
  try {
    const a = await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Shared world',
        name: 'Balanced',
        settings: {},
      }),
    );
    const ah = { 'X-Save-Id': a.saveId, 'X-Profile-Id': a.profileId };
    await post(
      app.url,
      '/api/update',
      { type: 'check', key: 'calc-3-iron-ingot', value: true },
      ah,
    );
    await post(
      app.url,
      '/api/update',
      { type: 'note', key: 'global', value: 'Private seed notes' },
      ah,
    );
    await post(
      app.url,
      '/api/update',
      { type: 'factoryGroupAdd', id: 'fg-cable01', name: 'Cable factory' },
      ah,
    );
    const share = await json(
      await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=${a.profileId}&share=1`),
    );
    assert.equal(share.saves.length, 1);
    assert.equal(share.saves[0].profiles.length, 1, 'only the shared profile is included');
    const state: ProgressState = share.saves[0].profiles[0].state;
    assert.deepEqual(state.checks, {});
    assert.deepEqual(state.notes, {});
    assert.ok(
      state.factoryGroups.groups.some(g => g.name === 'Cable factory'),
      'the factory grouping travels with the shared plan',
    );
    assert.ok(
      state.factoryGroups.groups.some(g => g.name === 'Iron & steel works'),
      'default groups travel too',
    );
    assert.ok(share.saves[0].profiles[0].plan, 'the calculation snapshot travels with the share');
    assert.ok(!JSON.stringify(share).includes('Private seed notes'));
    const w: WorkspaceSummary = await json(await post(app.url, '/api/import-saves', share));
    assert.equal(w.saves.length, 3, 'the default save, the shared world and the imported copy');
    const importedSave = w.saves.find(s => s.id !== a.saveId && s.name === 'Shared world');
    assert.ok(importedSave, 'the share imports as a new copy');
    assert.equal(
      importedSave.profiles[0]!.completed,
      0,
      'the imported copy starts without progress',
    );
    const original = await json(await fetch(app.url + '/api/state', { headers: ah }));
    assert.equal(
      original.checks['calc-3-iron-ingot'],
      true,
      'sharing never changes the source profile',
    );
    assert.equal(original.notes.global, 'Private seed notes');
    const scoped = await json(
      await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=${a.profileId}`),
    );
    assert.equal(
      scoped.saves[0].profiles[0].state.notes.global,
      'Private seed notes',
      'without share=1 the scoped export keeps progress',
    );
    assert.equal((await fetch(`${app.url}/api/export-saves?save=missing`)).status, 404);
    assert.equal(
      (await fetch(`${app.url}/api/export-saves?save=${a.saveId}&profile=missing`)).status,
      404,
    );
    // A selection of saves (#160): exactly those, and any unknown id refuses the whole export.
    const all = (await (await fetch(`${app.url}/api/export-saves`)).json()) as SaveExport;
    assert.ok(all.saves.length >= 3);
    const picked = [all.saves[0]!.id, all.saves[2]!.id];
    const chosen = (await (
      await fetch(`${app.url}/api/export-saves?saves=${picked.join(',')}`)
    ).json()) as SaveExport;
    assert.deepEqual(
      chosen.saves.map(s => s.id),
      picked,
    );
    assert.equal(
      (await fetch(`${app.url}/api/export-saves?saves=${picked[0]},missing`)).status,
      404,
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('duplicating a profile copies plan and progress and keeps the original independent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-copy-'));
  const app = await start(dir);
  try {
    const a = await json(
      await post(app.url, '/api/profiles', {
        saveName: 'Copy world',
        name: 'Precise',
        settings: {},
      }),
    );
    const ah = { 'X-Save-Id': a.saveId, 'X-Profile-Id': a.profileId };
    await post(
      app.url,
      '/api/update',
      { type: 'check', key: 'calc-3-iron-ingot', value: true },
      ah,
    );
    const b = await json(
      await post(app.url, '/api/duplicate-profile', { saveId: a.saveId, profileId: a.profileId }),
    );
    assert.notEqual(b.profileId, a.profileId);
    const bh = { 'X-Save-Id': b.saveId, 'X-Profile-Id': b.profileId };
    const copy = await json(await fetch(app.url + '/api/context', { headers: bh }));
    assert.match(copy.profile.name, /· copy$/);
    assert.equal(
      copy.state.checks['calc-3-iron-ingot'],
      true,
      'the copy starts from the current progress',
    );
    assert.ok(copy.plan, 'the copy keeps the frozen calculation snapshot');
    await post(
      app.url,
      '/api/update',
      { type: 'check', key: 'calc-3-iron-ingot', value: false },
      bh,
    );
    await post(app.url, '/api/update', { type: 'note', key: 'global', value: 'Experiment' }, bh);
    const original = await json(await fetch(app.url + '/api/state', { headers: ah }));
    assert.equal(
      original.checks['calc-3-iron-ingot'],
      true,
      'edits in the copy never reach the original',
    );
    assert.equal(original.notes.global, undefined);
    assert.equal((await post(app.url, '/api/duplicate-profile', { saveId: a.saveId })).status, 400);
    assert.equal(
      (await post(app.url, '/api/duplicate-profile', { saveId: a.saveId, profileId: 'missing' }))
        .status,
      404,
    );
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('browser edition shares and duplicates through the same portable format', async () => {
  // The record starts never exported, which the test checks a share does not change.
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
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
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  // The replies are unknown to the API's type; each is cast to the shape its route returns.
  type Created = { saveId: string; profileId: string };
  const a = (await post('/api/profiles', {
    saveName: 'Browser world',
    name: 'Balanced',
    settings: { phase: '1', goal: 'minimal' },
  })) as Created;
  await post('/api/update', { type: 'check', key: 'calc-1-iron-ingot', value: true });
  await post('/api/update', { type: 'factoryGroupAdd', id: 'fg-cable01', name: 'Cable factory' });
  const share = (await api(
    `/api/export-saves?save=${a.saveId}&profile=${a.profileId}&share=1`,
  )) as SaveExport;
  assert.equal(share.saves.length, 1);
  assert.deepEqual(share.saves[0]!.profiles[0]!.state.checks, {});
  assert.ok(
    share.saves[0]!.profiles[0]!.state.factoryGroups!.groups!.some(g => g.name === 'Cable factory'),
  );
  assert.equal(data.lastBackup, null, 'a share is not recorded as a full backup');
  await post('/api/import-saves', share);
  assert.equal(((await api('/api/workspace')) as WorkspaceSummary).saves.length, 2);
  const copy = (await post('/api/duplicate-profile', {
    saveId: a.saveId,
    profileId: a.profileId,
  })) as Created;
  assert.notEqual(copy.profileId, a.profileId);
  assert.equal(
    ((await api('/api/state')) as ProgressState).checks['calc-1-iron-ingot'],
    true,
    'the duplicate becomes active and carries progress',
  );
  await post('/api/update', { type: 'check', key: 'calc-1-iron-ingot', value: false });
  const original = (await api(
    `/api/state?save=${a.saveId}&profile=${a.profileId}`,
  )) as ProgressState;
  assert.equal(
    original.checks['calc-1-iron-ingot'],
    true,
    'the original profile is untouched by the experiment',
  );
  const full = (await api('/api/export-saves')) as SaveExport;
  assert.ok(data.lastBackup, 'a full export still counts as a backup');
  assert.equal(full.saves.length, 2);
  // A selection of saves (#160): only those, and it is not recorded as a full backup.
  data.lastBackup = null;
  const [first, second] = full.saves.map(s => s.id);
  const one = (await api('/api/export-saves?saves=' + second)) as SaveExport;
  assert.deepEqual(
    one.saves.map(s => s.id),
    [second],
  );
  const both = (await api(`/api/export-saves?saves=${first},${second}`)) as SaveExport;
  assert.equal(both.saves.length, 2);
  assert.equal(data.lastBackup, null, 'a selection is not a full backup');
  await assert.rejects(api(`/api/export-saves?saves=${first},missing`), /Save not found/);
});
