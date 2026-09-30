// Recalculate as a new profile (POST /api/profiles with carryFrom) and round-up (POST
// /api/round-up) make a new plan by a fresh solve; a plan guide on the source comes along
// (#472), with factory notes only for rows the new plan still has. Both editions, through their
// real routes: the guide arrives by an import, as nothing else writes one yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { saveExport, version12 } from './types/fixtures.ts';
import type { BrowserWorkspace, Catalog, PlanGuide, SaveExport } from '../public/types/index.ts';

const settings = { phase: '3' };
const plan = calculate(settings);
const kept = plan.stages['3'].rows![0]!.id;
const guide: PlanGuide = {
  phases: { '3': [{ id: 'phase-3-survey', title: 'Survey', body: 'Walk it.' }] },
  storageTasks: [{ id: 'storage-filter-moves', title: 'Filters', body: 'Move them.' }],
  power: { checks: [{ id: 'power-rocket-1', label: 'Block 1' }], blocks: [] },
  factories: { [kept]: { note: 'Kept', local: true }, 'no-such-row': { note: 'Gone' } },
};
const exported = (): SaveExport => {
  const state = { ...structuredClone(saveExport.saves[0]!.profiles[0]!.state), checks: {} };
  return {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: new Date().toISOString(),
    saves: [
      {
        id: 's',
        name: 'Guided',
        activeProfile: 'p',
        profiles: [
          { id: 'p', name: 'Guided', kind: 'calculated', plan: { ...plan, guide }, state },
        ],
      },
    ],
  } as SaveExport;
};
const expected = { ...guide, factories: { [kept]: { note: 'Kept', local: true } } };

type Post = (route: string, body: unknown, headers?: Record<string, string>) => Promise<any>;
test('the Docker edition carries a plan guide to a recalculated and a rounded-up profile', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-guide-carry-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post: Post = async (route, body, headers = {}) => {
    const response = await fetch(url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, route + ': ' + (await response.clone().text()));
    return response.json();
  };
  try {
    const workspace = await post('/api/import-saves', exported());
    const save = workspace.saves.find((x: { name: string }) => x.name === 'Guided');
    const source = save.profiles[0].id;
    const headers = { 'X-Save-Id': save.id, 'X-Profile-Id': source };
    await post(
      '/api/profiles',
      { saveId: save.id, name: 'Recalculated', settings, carryFrom: source },
      headers,
    );
    await post('/api/round-up', {}, headers);
    const all = await (await fetch(url + '/api/export-saves')).json();
    const byName = Object.fromEntries(
      all.saves
        .find((x: { id: string }) => x.id === save.id)
        .profiles.map((p: { name: string; plan: { guide?: PlanGuide } }) => [p.name, p.plan.guide]),
    );
    assert.deepEqual(byName['Guided'], guide, 'the source keeps its whole guide');
    assert.deepEqual(byName['Recalculated'], expected);
    assert.deepEqual(byName['Guided · whole machines'], expected);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the Pages edition carries a plan guide to a recalculated and a rounded-up profile', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (workspace: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  const post: Post = (route, body, headers = {}) =>
    api(route, { body: JSON.stringify(body), headers }) as Promise<any>;
  await post('/api/import-saves', exported());
  const save = data.saves.find(x => x.name === 'Guided')!;
  const source = save.profiles[0]!.id;
  const headers = { 'X-Save-Id': save.id, 'X-Profile-Id': source };
  await post(
    '/api/profiles',
    { saveId: save.id, name: 'Recalculated', settings, carryFrom: source },
    headers,
  );
  await post('/api/round-up', {}, headers);
  const byName = Object.fromEntries(
    data.saves.find(x => x.id === save.id)!.profiles.map(p => [p.name, p.plan?.guide]),
  );
  assert.deepEqual(byName['Guided'], guide);
  assert.deepEqual(byName['Recalculated'], expected);
  assert.deepEqual(byName['Guided · whole machines'], expected);
});

// A profile carried from a migrated one keeps handbookOrigin, the record of what the migration
// could not place (#489), whatever the carry picks; one carried from any other profile is as
// before. Both editions, through Recalculate (POST /api/profiles with carryFrom).
const migrated = (withOrigin: boolean): SaveExport => {
  const transfer = exported();
  const state = structuredClone(version12) as unknown as Record<string, unknown>;
  if (!withOrigin) {
    delete state.handbookOrigin;
    state.version = 11;
  }
  transfer.saves[0]!.profiles[0]!.state = state as never;
  return transfer;
};
for (const edition of ['Docker', 'Pages'] as const)
  test(`the ${edition} edition carries handbookOrigin to a recalculated profile`, async () => {
    const run = edition === 'Docker' ? dockerRoutes : pagesRoutes;
    for (const withOrigin of [true, false]) {
      const { post, profiles, close } = await run();
      try {
        const workspace = await post('/api/import-saves', migrated(withOrigin));
        const save = workspace.saves.find((x: { name: string }) => x.name === 'Guided');
        const source = save.profiles[0].id;
        const headers = { 'X-Save-Id': save.id, 'X-Profile-Id': source };
        // No carry picks at all: the origin still comes along.
        await post(
          '/api/profiles',
          { saveId: save.id, name: 'Recalculated', settings, carryFrom: source, carry: [] },
          headers,
        );
        const state = (await profiles(save.id))['Recalculated']!;
        if (withOrigin) {
          assert.equal(state.version, 12);
          assert.deepEqual(state.handbookOrigin, version12.handbookOrigin);
        } else assert.equal('handbookOrigin' in state, false);
      } finally {
        await close();
      }
    }
  });

type Routes = {
  post: Post;
  profiles: (
    saveId: string,
  ) => Promise<Record<string, { version: number; handbookOrigin?: unknown }>>;
  close: () => Promise<unknown>;
};
async function dockerRoutes(): Promise<Routes> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-origin-carry-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    post: async (route, body, headers = {}) => {
      const response = await fetch(url + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
        body: JSON.stringify(body),
      });
      assert.ok(response.ok, route + ': ' + (await response.clone().text()));
      return response.json();
    },
    profiles: async saveId => {
      const all = await (await fetch(url + '/api/export-saves')).json();
      return Object.fromEntries(
        all.saves
          .find((x: { id: string }) => x.id === saveId)
          .profiles.map((p: { name: string; state: unknown }) => [p.name, p.state]),
      );
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
async function pagesRoutes(): Promise<Routes> {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (workspace: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  return {
    post: (route, body, headers = {}) =>
      api(route, { body: JSON.stringify(body), headers }) as Promise<any>,
    profiles: async saveId =>
      Object.fromEntries(
        data.saves.find(x => x.id === saveId)!.profiles.map(p => [p.name, p.state as never]),
      ),
    close: async () => undefined,
  };
}
