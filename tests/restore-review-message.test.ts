// Restoring an old progress backup can keep some of its records for review (#760): onto a profile
// moved from the original plan whose mapping cannot place them, its handbook-keyed ticks, notes
// and group assignments go to handbookOrigin.unmapped, which the Notes page lists under "From the
// original plan". The Backup page then says how many the restore newly put there
// (restoreMessage in public/app/views/backup.ts), from the state it had and the state
// /api/import replied with. Both editions reply the same way, so they give the same message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { handbookToPlan, migrateHandbookState } from '../public/handbook-migration.ts';
import { validateState } from '../public/state.ts';
import { newlyForReview, restoreMessage } from '../public/app/views/backup.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { frozenHandbook, recipes } from './helpers/data.ts';
import { version11 } from './types/fixtures.ts';
import type {
  BrowserSave,
  BrowserWorkspace,
  HandbookOrigin,
  ProgressState,
  SavedState,
  StoredProfile,
} from '../public/types/index.ts';

const { pureLimits } = catalog();
const migration = { recipes, pureLimits };
// The first release's handbook profile (2026-09-13), with handbook-keyed ticks and notes.
const exported = JSON.parse(
  readFileSync(new URL('./fixtures/export-2026-09-13.json', import.meta.url), 'utf8'),
);
const firstState: SavedState = exported.saves[0].profiles[0].state;
const backupOf = (state: unknown, profileId: string) => ({
  format: 'satisfactory-planner-backup',
  exportedAt: '2026-09-20T10:00:00.000Z',
  saveName: 'My Satisfactory save',
  profileName: 'Original',
  profileId,
  state,
});
// A profile migrated from a handbook the server has no copy of and with no mapping recorded:
// a backup made before its migration cannot be re-keyed, so its handbook-keyed records are kept
// for review in both editions.
const foreignState = () => {
  const plan = handbookToPlan(frozenHandbook, recipes, pureLimits);
  const progress = migrateHandbookState(structuredClone(firstState), frozenHandbook, plan);
  delete progress.handbookOrigin!.mapping;
  progress.handbookOrigin!.version = '2026-08-01';
  // Its review list is empty: what the migration kept there was looked at and cleared.
  progress.handbookOrigin!.unmapped = { checks: {}, notes: {}, assignments: {} };
  return validateState(progress);
};
const plan = handbookToPlan(frozenHandbook, recipes, pureLimits).plan;
const save = (): BrowserSave => ({
  id: 'save-a',
  name: 'My Satisfactory save',
  activeProfile: 'foreign',
  profiles: [
    { id: 'foreign', name: 'Migrated earlier', kind: 'calculated', plan, state: foreignState() },
    {
      id: 'ordinary',
      name: 'Balanced',
      kind: 'calculated',
      plan: calculate({ phase: '3' }),
      state: validateState(structuredClone(version11)),
    },
  ] as StoredProfile[],
});

type Request = (route: string, profile: string, body?: unknown) => Promise<unknown>;
type Edition = { request: Request; close: () => Promise<unknown> };

async function docker(): Promise<Edition> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-review-'));
  await fs.writeFile(
    path.join(dataDir, 'workspace.json'),
    JSON.stringify({
      version: 2,
      revision: 3,
      accountsEnabled: false,
      registration: false,
      users: [{ id: 'owner', username: 'Local pioneer', activeSave: 'save-a' }],
      saves: [{ ...save(), userId: 'owner' }],
      sessions: [],
    }),
  );
  const server = await createApp({ dataDir, password: '' }).catch(async error => {
    await fs.rm(dataDir, { recursive: true, force: true });
    throw error;
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    request: async (route, profile, body) => {
      const response = await fetch(url + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Planner-Request': '1',
          'X-Save-Id': 'save-a',
          'X-Profile-Id': profile,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const reply = await response.json();
      if (!response.ok) throw Error(reply.error);
      return reply;
    },
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
async function pages(): Promise<Edition> {
  const record: BrowserWorkspace = {
    version: 1,
    activeSave: 'save-a',
    saves: [save()],
    lastBackup: null,
  };
  const load = async () => migration;
  const store = openBrowserStore(
    fakeIndexedDB(1, new Map<string, unknown>([['main', record]])),
    undefined,
    load,
  );
  const api = createBrowserApi(store, calculate, catalog(), undefined, load);
  return {
    request: (route, profile, body) =>
      api(route, {
        headers: { 'X-Save-Id': 'save-a', 'X-Profile-Id': profile },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    close: async () => undefined,
  };
}

// The handbook-keyed records of the first release's backup: six ticks and two notes.
const sentForReview = 'Backup restored. 8 items from the original plan need your review in Notes.';

for (const [edition, open] of [
  ['Docker', docker],
  ['Pages', pages],
] as const)
  test(`${edition} edition: a restore that keeps records for review says how many, and where`, async () => {
    const { request, close } = await open();
    const state = async (profile: string) =>
      (await request('/api/state', profile)) as ProgressState;
    const restore = async (profile: string, backup: unknown) => {
      const before = await state(profile);
      const after = (await request('/api/import', profile, backup)) as ProgressState;
      return restoreMessage(before, after);
    };
    try {
      assert.equal(await restore('foreign', backupOf(firstState, 'foreign')), sentForReview);
      // The same backup again puts nothing new there: those records are already waiting.
      assert.equal(await restore('foreign', backupOf(firstState, 'foreign')), 'Backup restored.');
      // A backup made after the restore brings back the same list, so nothing new either.
      const later = await request('/api/export', 'foreign');
      assert.equal(await restore('foreign', later), 'Backup restored.');
      // Onto an ordinary profile nothing goes to review.
      assert.equal(await restore('ordinary', backupOf(firstState, 'ordinary')), 'Backup restored.');
    } finally {
      await close();
    }
  });

test('newlyForReview counts only the ticks, notes and assignments that were not listed before', () => {
  const origin = (unmapped: Partial<HandbookOrigin['unmapped']>) => ({
    handbookOrigin: {
      version: '2026-09-13',
      unmapped: { checks: {}, notes: {}, assignments: {}, ...unmapped },
    },
  });
  const after = origin({
    checks: { 'factory-3-wire': true, 'factory-4-plastic': false },
    notes: { 'factory-wire': 'By the river' },
    assignments: { rubber: [{ group: 'fg-oil', rate: null }] },
  });
  assert.equal(newlyForReview({}, after), 4);
  assert.equal(newlyForReview(origin({}), after), 4);
  assert.equal(newlyForReview(origin({ checks: { 'factory-3-wire': false } }), after), 3);
  assert.equal(newlyForReview(after, after), 0);
  assert.equal(newlyForReview(after, {}), 0);
  assert.equal(
    restoreMessage(
      origin({ checks: { 'factory-3-wire': true } }),
      origin({
        checks: { 'factory-3-wire': true, 'factory-3-plastic': true },
      }),
    ),
    'Backup restored. 1 item from the original plan needs your review in Notes.',
  );
  assert.equal(restoreMessage({}, {}), 'Backup restored.');
});
