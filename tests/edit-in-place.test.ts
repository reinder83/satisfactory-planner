// Edit settings, "Recalculate in place" (#1071), in both editions: the profile keeps its id and
// gets the new plan and name, its progress is carried from itself (ticks whose production lines
// need no more machines and no more input stay ticked, the rest are kept unticked for review, and
// world records stay), and the previous version is kept whole as a profile of its own right after
// it, so nothing is lost. A profile recalculated meanwhile is refused (409) and nothing changes.
// Also the default names a new profile gets (profile-edit.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { calculate, catalog } from '../planner.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { validateTransfer } from '../public/transfer.ts';
import { backupName, defaultProfileName, nameDate } from '../public/app/profile-edit.ts';
import { recalculatedElsewhere } from '../public/state.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  Recipe,
  SaveExport,
  StoredProfile,
  WorkspaceFile,
} from '../public/types/index.ts';

const SETTINGS = { phase: '1', goal: 'minimal' };
const EDITED = { phase: '1', goal: 'balanced' };

interface Recalculated {
  saveId: string;
  profileId: string;
  backupId: string;
  reviewCount: number;
}

// Every calc- check of a context's plan, as its tick key.
const rowKeys = (context: ContextReply) =>
  Object.entries(context.plan!.stages).flatMap(([phase, stage]) =>
    (stage?.rows || []).map(row => `calc-${phase}-${row.id}`),
  );

// The previous version, kept as the backup: the stored profile as it was, under a new id and name.
function assertBackup(backup: StoredProfile, before: StoredProfile, name: string) {
  assert.equal(backup.name, name);
  assert.notEqual(backup.id, before.id);
  assert.deepEqual({ ...backup, id: before.id, name: before.name }, before);
}

test('the Docker server recalculates a profile in place, carries its ticks and keeps the old version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-edit-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const send = (endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  const ok = async <T>(response: Response): Promise<T> => {
    assert.ok(response.ok, await response.clone().text());
    return response.json() as Promise<T>;
  };
  const stored = async () =>
    JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')) as WorkspaceFile;
  try {
    const first = await ok<Recalculated>(
      await send('/api/profiles', { saveName: 'World', name: 'Minimal', settings: SETTINGS }),
    );
    const other = await ok<Recalculated>(
      await send('/api/profiles', { saveId: first.saveId, name: 'Other', settings: SETTINGS }),
    );
    const headers = { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId };
    const context = async () => ok<ContextReply>(await fetch(url + '/api/context', { headers }));
    const original = await context();
    const ticks = rowKeys(original);
    assert.ok(ticks.length > 0);
    for (const key of [...ticks, 'unlock-Schematic_1-1_C'])
      await ok(await send('/api/update', { type: 'check', key, value: true }, headers));
    await ok(await send('/api/update', { type: 'note', key: 'global', value: 'Keep me' }, headers));
    const before = await context();

    // The same settings again: every tick stays, and the backup is the profile as it was.
    const storedBefore = (await stored()).saves[0]!.profiles[0]!;
    const same = await ok<Recalculated>(
      await send(
        '/api/recalculate',
        {
          name: 'Minimal',
          backupName: 'Minimal (before edit)',
          settings: SETTINGS,
          planCreatedAt: before.plan!.createdAt,
        },
        headers,
      ),
    );
    assert.equal(same.profileId, first.profileId, 'the profile keeps its id');
    assert.equal(same.reviewCount, 0);
    const again = await context();
    for (const key of ticks) assert.equal(again.state.checks[key], true, key);
    assert.equal(again.state.checks['unlock-Schematic_1-1_C'], true);
    assert.equal(again.state.notes.global, 'Keep me');
    assert.equal(again.state.revision, before.state.revision + 1, 'past the previous version');
    let file = await stored();
    const profiles = file.saves[0]!.profiles;
    assert.deepEqual(
      profiles.map(p => p.id),
      [first.profileId, same.backupId, other.profileId],
      'the backup sits right after the profile; the other profile is untouched',
    );
    assertBackup(profiles[1]!, storedBefore, 'Minimal (before edit)');
    assert.equal(file.saves[0]!.activeProfile, first.profileId);

    // Changed settings: ticks whose lines the new plan still has are carried (kept unticked for
    // review where the line grew), world records stay, and the backup is the version before.
    const storedMiddle = profiles[0]!;
    const changed = await ok<Recalculated>(
      await send(
        '/api/recalculate',
        {
          name: 'Balanced',
          backupName: 'Minimal (before edit 2)',
          settings: EDITED,
          planCreatedAt: again.plan!.createdAt,
          carry: { unlocks: true, notes: true, factories: true },
        },
        headers,
      ),
    );
    const after = await context();
    assert.equal(after.profile.name, 'Balanced');
    assert.equal(after.plan!.settings.goal, 'balanced');
    const kept = rowKeys(after).filter(key => ticks.includes(key));
    assert.ok(kept.length > 0, 'some lines are in both plans');
    for (const key of kept) assert.equal(typeof after.state.checks[key], 'boolean', key);
    assert.equal(
      kept.filter(key => after.state.checks[key] === false).length,
      changed.reviewCount,
      'the ticks not kept are the ones left for review',
    );
    assert.equal(after.state.checks['unlock-Schematic_1-1_C'], true);
    assert.equal(after.state.notes.global, 'Keep me');
    file = await stored();
    assert.deepEqual(
      file.saves[0]!.profiles.map(p => p.id),
      [first.profileId, changed.backupId, same.backupId, other.profileId],
    );
    assertBackup(file.saves[0]!.profiles[1]!, storedMiddle, 'Minimal (before edit 2)');

    // A tab that edited the settings of the plan before is refused, and nothing changes.
    const stale = await send(
      '/api/recalculate',
      {
        name: 'Stale',
        backupName: 'Stale backup',
        settings: SETTINGS,
        planCreatedAt: again.plan!.createdAt,
      },
      headers,
    );
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { error: string }).error, recalculatedElsewhere);
    assert.deepEqual(await stored(), file, 'a refused recalculation writes nothing');
    // A name is required for the profile and for the backup.
    const unnamed = await send(
      '/api/recalculate',
      { name: 'X', settings: SETTINGS, planCreatedAt: after.plan!.createdAt },
      headers,
    );
    assert.equal(unnamed.status, 400);
    assert.deepEqual(await stored(), file);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition recalculates in place, refuses a full save and exports the backup', async () => {
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
  const api = createBrowserApi(store, calculate, {} as Catalog),
    post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const first = (await post('/api/profiles', {
    saveName: 'World',
    name: 'Minimal',
    settings: SETTINGS,
  })) as Recalculated;
  const context = async () => (await api('/api/context')) as ContextReply;
  const ticks = rowKeys(await context());
  for (const key of [...ticks, 'unlock-Schematic_1-1_C'])
    await post('/api/update', { type: 'check', key, value: true });
  const before = await context();
  const storedBefore = structuredClone(data.saves[0]!.profiles[0]!);
  const done = (await post('/api/recalculate', {
    name: 'Balanced',
    backupName: 'Minimal (before edit)',
    settings: EDITED,
    planCreatedAt: before.plan!.createdAt,
  })) as Recalculated;
  assert.equal(done.profileId, first.profileId);
  const after = await context();
  assert.equal(after.profile.id, first.profileId);
  assert.equal(after.plan!.settings.goal, 'balanced');
  assert.equal(after.state.checks['unlock-Schematic_1-1_C'], true);
  const kept = rowKeys(after).filter(key => ticks.includes(key));
  assert.ok(kept.length > 0);
  for (const key of kept) assert.equal(typeof after.state.checks[key], 'boolean', key);
  assert.deepEqual(
    data.saves[0]!.profiles.map(p => p.id),
    [first.profileId, done.backupId],
  );
  assertBackup(data.saves[0]!.profiles[1]!, storedBefore, 'Minimal (before edit)');

  // Restoring: the backup opens as the profile was, plan and progress alike.
  const restored = (await api('/api/context', {
    headers: { 'X-Save-Id': first.saveId, 'X-Profile-Id': done.backupId },
  })) as ContextReply;
  assert.deepEqual(restored.state, before.state);
  assert.deepEqual(restored.plan, before.plan);

  // A full export carries both versions, and imports as new copies with both.
  const exported = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    validateTransfer(exported).saves[0]!.profiles.map(p => p.name),
    ['Balanced', 'Minimal (before edit)'],
  );

  // A stale plan is refused; so is a save with no room for the backup. Nothing changes.
  const snapshot = structuredClone(data);
  await assert.rejects(
    post('/api/recalculate', {
      name: 'Stale',
      backupName: 'Stale backup',
      settings: SETTINGS,
      planCreatedAt: before.plan!.createdAt,
    }),
    new RegExp(recalculatedElsewhere.slice(0, 40)),
  );
  assert.deepEqual(data, snapshot);
  const save = data.saves[0]!;
  while (save.profiles.length < 30)
    save.profiles.push({
      ...structuredClone(save.profiles[1]!),
      id: 'filler' + save.profiles.length,
    });
  const full = structuredClone(data);
  await assert.rejects(
    post('/api/recalculate', {
      name: 'Full',
      backupName: 'Full backup',
      settings: SETTINGS,
      planCreatedAt: after.plan!.createdAt,
    }),
    /no room to keep the current version/,
  );
  assert.deepEqual(data, full);
});

test('a new profile is named after its goal, what changed and the day; a backup after the edit', () => {
  const goals = [
    { id: 'balanced', name: 'Balanced progression' },
    { id: 'minimal', name: 'Minimal construction' },
  ];
  const day = new Date(2026, 9, 7, 14, 5);
  const settings = { goal: 'balanced', phase: '1', wholeMachines: true, recipes: 'standard' };
  assert.equal(
    defaultProfileName(settings, null, goals, day),
    'Balanced progression · ' + nameDate(day),
    'a first profile on the defaults is its goal and the day',
  );
  assert.equal(
    defaultProfileName(
      { ...settings, goal: 'minimal', wholeMachines: false },
      settings,
      goals,
      day,
    ),
    'Minimal construction · exact ratios · ' + nameDate(day),
    'a second profile says what differs from the one it carries from',
  );
  assert.equal(
    defaultProfileName(
      { ...settings, phase: '3', recipes: 'all', multiplier: 2 },
      settings,
      goals,
      day,
    ),
    'Balanced progression · from Phase 3 · all alternates · ' + nameDate(day),
    'at most two changes',
  );
  assert.notEqual(
    defaultProfileName({ ...settings, goal: 'minimal' }, settings, goals, day),
    defaultProfileName(settings, settings, goals, day),
    'two goals, two names',
  );
  const long = backupName('N'.repeat(80), day);
  assert.ok(long.length <= 80, 'a backup name fits the 80 characters a name may have');
  assert.match(long, /^N+ \(before edit, .+\)$/);
});

// The oldest released format: the first full export (2026-09-13), an original profile with a
// version 1 state, imported into the browser edition's IndexedDB (migrated to a calculated
// profile on the way in) and then edited in place. The backup is the migrated record exactly, and
// the edited profile keeps what the migration could not place (handbookOrigin).
test('an old export, imported and then edited in place, keeps the imported version whole', async () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  const migration = {
    recipes: (JSON.parse(read('../recipes.json')) as { recipes: Recipe[] }).recipes,
    pureLimits: catalog().pureLimits,
  };
  const records = new Map<string, unknown>();
  const load = async () => migration;
  const store = openBrowserStore(fakeIndexedDB(0, records), undefined, load);
  const api = createBrowserApi(store, calculate, catalog(), undefined, load);
  const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  await api('/api/workspace');
  await post('/api/import-saves', JSON.parse(read('./fixtures/export-2026-09-13.json')));
  const imported = structuredClone(
    (records.get('main') as BrowserWorkspace).saves[0]!.profiles[0]!,
  );
  const before = (await api('/api/context')) as ContextReply;
  const ticked = Object.keys(before.state.checks).filter(key => before.state.checks[key]);
  const done = (await post('/api/recalculate', {
    name: imported.name,
    backupName: 'Imported (before edit)',
    settings: { phase: '3', goal: 'balanced' },
    planCreatedAt: before.plan!.createdAt,
  })) as Recalculated;
  const record = records.get('main') as BrowserWorkspace;
  assert.deepEqual(
    record.saves[0]!.profiles.map(p => p.id),
    [imported.id, done.backupId],
  );
  assertBackup(record.saves[0]!.profiles[1]!, imported, 'Imported (before edit)');
  const after = (await api('/api/context')) as ContextReply;
  assert.deepEqual(after.state.handbookOrigin, before.state.handbookOrigin);
  for (const key of rowKeys(after).filter(key => ticked.includes(key)))
    assert.equal(typeof after.state.checks[key], 'boolean', key);
  for (const key of ticked.filter(key => key.startsWith('unlock-')))
    assert.equal(after.state.checks[key], true, key);
});
