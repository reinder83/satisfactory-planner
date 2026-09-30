// Retiring the handbook, part 4d-1 (#605, #498): a full transfer or profile share holding an
// original profile is converted on import into a calculated one with its own handbook
// (importableTransfer in public/transfer.ts), in both editions. Every record is kept, re-keyed or
// kept for review in handbookOrigin.unmapped; an already migrated export imports unchanged.
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
import { openBrowserStore, PRE_HANDBOOK, type BrowserStore } from '../public/browser-store.ts';
import {
  handbookToPlan,
  migrateOriginalProfile,
  type HandbookConversion,
} from '../public/handbook-migration.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { shareState, validateState } from '../public/state.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { version11 } from './types/fixtures.ts';
import type {
  BrowserWorkspace,
  ProgressState,
  Recipe,
  SaveExport,
  SavedState,
  WorkspaceFile,
} from '../public/types/index.ts';

// The first release with full transfers (2026-09-13) exported an original profile with plan
// null, its handbook (plan.json of that day) and a version 1 state. A JSON import widens its
// string unions, so each test parses its own copy of the file instead.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const exportText = read('./fixtures/export-2026-09-13.json');
const firstExport = (): SaveExport => JSON.parse(exportText);
const recipes: Recipe[] = JSON.parse(read('../recipes.json')).recipes;
const { pureLimits } = catalog();
const migration = { recipes, pureLimits };
type Transfer = Omit<SaveExport, 'exportedAt'>;
const originalOf = (data: Transfer) => data.saves[0]!.profiles[0]!;
// The fixture's original profile carries its handbook.
const handbookOf = (data: Transfer) => originalOf(data).handbook!;
// importableTransfer ran every state through validateState, so it is the current ProgressState.
const importedOf = (data: Transfer) => {
  const profile = originalOf(data);
  return { ...profile, state: profile.state as ProgressState };
};

// Checks, independently of migrateHandbookState, that every record of `before` is in `after`:
// under its own key, re-keyed to its factory's row, or kept for review in unmapped.
function everyRecordKept(before: SavedState, after: ProgressState, { rows }: HandbookConversion) {
  const unmapped = after.handbookOrigin!.unmapped;
  const rowsOf = (factoryId: string) =>
    [...new Set(['3', '4', '5'].map(phase => rows[phase]?.[factoryId]))].filter(
      (row): row is string => !!row,
    );
  for (const [key, ticked] of Object.entries(before.checks)) {
    const factory = /^factory-([345])-(.+)$/.exec(key);
    const row = factory && rows[factory[1]!]?.[factory[2]!];
    if (row) assert.equal(after.checks[`calc-${factory[1]}-${row}`], ticked, key);
    else if (factory) assert.equal(unmapped.checks[key], ticked, key + ' is kept for review');
    else assert.equal(after.checks[key], ticked, key);
  }
  for (const [key, note] of Object.entries(before.notes)) {
    const targets = key.startsWith('factory-') ? rowsOf(key.slice('factory-'.length)) : [key];
    if (targets.length)
      for (const target of targets)
        assert.equal(
          after.notes[key.startsWith('factory-') ? 'factory-' + target : target],
          note,
          key,
        );
    else assert.equal(unmapped.notes[key], note, key + ' is kept for review');
  }
  for (const [id, count] of Object.entries(before.deliveries))
    assert.equal(after.deliveries[id], count, id);
  assert.deepEqual(after.customTasks, before.customTasks);
  assert.equal(after.settings.phase, before.settings.phase);
}

test('a first-release export converts its original profile with its own handbook', async () => {
  const data = firstExport();
  const handbook = handbookOf(data);
  const before = originalOf(data).state;
  const conversion = handbookToPlan(handbook, recipes, pureLimits);
  let loads = 0;
  const imported = await importableTransfer(data, async () => (loads++, migration));
  assert.equal(loads, 1);
  const profile = importedOf(imported);
  assert.equal(profile.kind, 'calculated');
  assert.equal('handbook' in profile, false);
  assert.equal(profile.id, 'original', 'ids are only remapped by the store');
  assert.equal(profile.name, 'Original · 50× complete automation');
  assert.deepEqual(profile.plan, conversion.plan);
  assert.equal(profile.state.version, 12);
  assert.equal(profile.state.handbookOrigin!.version, '2026-09-13');
  everyRecordKept(before, profile.state, conversion);
  // The ticks decision 6B leaves for review, and a note for a factory the handbook lacks.
  assert.equal(profile.state.handbookOrigin!.unmapped.checks['factory-4-plastic'], true);
  assert.equal(profile.state.handbookOrigin!.unmapped.checks['factory-4-rubber'], true);
  assert.equal(profile.state.handbookOrigin!.unmapped.notes['factory-old-campus'], 'Moved east');
  assert.equal(profile.state.checks['calc-3-' + conversion.rows['3']!['iron-ingot']], true);
  // The same conversion the stores run on the profiles they hold.
  const validated = originalOf(validateTransfer(firstExport()));
  assert.deepEqual(profile, migrateOriginalProfile(validated, handbook, recipes, pureLimits));
});

test('an original profile converts with its own handbook, not the frozen one', async () => {
  const data = firstExport();
  const handbook = handbookOf(data);
  // A handbook of another day, whose Phase 3 iron plate uses another recipe.
  handbook.version = '2026-09-12';
  const plate = handbook.factories.find(f => f.id === 'iron-plate')!;
  plate.stages['3']!.recipe = 'Alternate: Coated Iron Plate';
  originalOf(data).state.checks['factory-3-iron-plate'] = true;
  const coated = recipes.find(r => r.name === 'Alternate: Coated Iron Plate')!.id;
  const profile = importedOf(await importableTransfer(data, async () => migration));
  assert.equal(profile.plan!.engine, 'handbook-2026-09-12');
  assert.equal(profile.state.handbookOrigin!.version, '2026-09-12');
  assert.equal(profile.state.checks['calc-3-' + coated], true);
  assert.ok(profile.plan!.stages['3']!.rows!.some(row => row.id === coated));
});

// A release just before the migration wrote version 11 states, with factory groups and step
// links keyed by handbook factory ids; an install that skipped every release in between imports
// it straight into the migrated shape.
test('a skipped-version export (state version 11) re-keys groups and step links too', async () => {
  const data = firstExport();
  const state: SavedState = {
    ...structuredClone(version11),
    checks: { 'factory-3-iron-plate': true, 'factory-5-gone': true, 'phase-3-iron': true },
    notes: { 'factory-iron-plate': 'Plates by the lake' },
    taskEdits: { ...structuredClone(version11.taskEdits), links: { 'phase-3-iron': 'iron-plate' } },
    factoryGroups: {
      ...structuredClone(version11.factoryGroups),
      assignments: {
        'iron-plate': [{ group: 'fg-plates1', rate: null }],
        'old-campus': [{ group: 'fg-plates1', rate: 30 }],
      },
    },
  };
  originalOf(data).state = state;
  const conversion = handbookToPlan(handbookOf(data), recipes, pureLimits);
  const plate = conversion.rows['3']!['iron-plate']!;
  const profile = importedOf(await importableTransfer(data, async () => migration));
  everyRecordKept(state, profile.state, conversion);
  assert.equal(profile.state.handbookOrigin!.unmapped.checks['factory-5-gone'], true);
  assert.deepEqual(profile.state.factoryGroups.assignments[plate], [
    { group: 'fg-plates1', rate: null },
  ]);
  assert.deepEqual(profile.state.handbookOrigin!.unmapped.assignments['old-campus'], [
    { group: 'fg-plates1', rate: 30 },
  ]);
  assert.equal(profile.state.taskEdits.links['phase-3-iron'], plate);
  assert.deepEqual(profile.state.storageEdits, validateState(state).storageEdits);
});

test('a profile share of an original profile converts without bringing back progress', async () => {
  const data = firstExport();
  const shared = originalOf(data);
  shared.state = shareState(validateState(shared.state));
  const profile = importedOf(await importableTransfer(data, async () => migration));
  assert.equal(profile.kind, 'calculated');
  assert.equal(profile.state.checks['calc-3-' + 'iron-ingot'], undefined);
  assert.deepEqual(profile.state.handbookOrigin!.unmapped.checks, {});
  assert.deepEqual(profile.state.notes, {});
  assert.deepEqual(
    profile,
    migrateOriginalProfile(
      originalOf(validateTransfer(structuredClone(data))),
      handbookOf(data),
      recipes,
      pureLimits,
    ),
  );
});

test('an already migrated export imports exactly as validateTransfer returns it', async () => {
  const migrated = await importableTransfer(firstExport(), async () => migration);
  const again = { ...structuredClone(migrated), exportedAt: '2026-09-30T00:00:00.000Z' };
  const imported = await importableTransfer(again, async () => {
    throw Error('not needed');
  });
  assert.deepEqual(imported, validateTransfer(structuredClone(again)));
  assert.deepEqual(imported, migrated);
});

test('an original profile whose handbook is incomplete is refused with 400', async () => {
  const data = firstExport();
  // @ts-expect-error a partial handbook no release exported, which the import refuses
  originalOf(data).handbook = { factories: [], phases: {}, storage: [] };
  await assert.rejects(
    importableTransfer(data, async () => migration),
    {
      status: 400,
      message:
        'This save file comes from an older planner and is incomplete or damaged, so it cannot be imported. Export it again from the planner that made it.',
    },
  );
});

const close = (server: Server) => new Promise(resolve => server.close(resolve));
const post = (url: string, endpoint: string, body: unknown) =>
  fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
    body: JSON.stringify(body),
  });

test('Docker edition: /api/import-saves stores the converted profile, and a restart keeps it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-import-migration-'));
  const start = async () => {
    const server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
  };
  const stored = async () =>
    JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')) as WorkspaceFile;
  let app = await start();
  try {
    const response = await post(app.url, '/api/import-saves', firstExport());
    assert.equal(response.status, 200, await response.clone().text());
    const expected = importedOf(await importableTransfer(firstExport(), async () => migration));
    const [save] = (await stored()).saves;
    const profile = save!.profiles[0]!;
    assert.equal(save!.userId, 'owner');
    assert.notEqual(profile.id, 'original', 'the import got a fresh id');
    assert.deepEqual({ ...profile, id: expected.id }, expected);
    // A partial handbook is refused before anything is written.
    const bad = firstExport();
    // @ts-expect-error a partial handbook no release exported, which the import refuses
    originalOf(bad).handbook = { factories: [], phases: {}, storage: [] };
    const refused = await post(app.url, '/api/import-saves', bad);
    assert.equal(refused.status, 400);
    assert.equal(
      (await refused.json()).error,
      'This save file comes from an older planner and is incomplete or damaged, so it cannot be imported. Export it again from the planner that made it.',
    );
    // Exporting and importing the migrated save again adds an identical copy.
    const exported = await (await fetch(app.url + '/api/export-saves')).json();
    assert.equal((await post(app.url, '/api/import-saves', exported)).status, 200);
    const saves = (await stored()).saves;
    assert.equal(saves.length, 2);
    assert.deepEqual(
      { ...saves[1]!.profiles[0]!, id: expected.id },
      expected,
      'the re-import changed nothing',
    );
    // Nothing original was stored, so a restart migrates nothing and writes no pre-migration copy.
    const before = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    await close(app.server);
    app = await start();
    assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), before);
    await assert.rejects(fs.stat(path.join(dir, 'workspace.json.pre-handbook')));
  } finally {
    await close(app.server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Pages edition: /api/import-saves stores the converted profile in IndexedDB', async () => {
  const records = new Map<string, unknown>();
  let loads = 0;
  const load = async () => (loads++, migration);
  const store = openBrowserStore(fakeIndexedDB(0, records), undefined, load);
  const api = createBrowserApi(store, calculate, catalog(), undefined, load);
  const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  await api('/api/workspace');
  await post('/api/import-saves', firstExport());
  assert.equal(loads, 1, 'recipes.json is loaded for the import only');
  const expected = importedOf(await importableTransfer(firstExport(), async () => migration));
  const record = records.get('main') as BrowserWorkspace;
  const profile = record.saves[0]!.profiles[0]!;
  assert.deepEqual({ ...profile, id: expected.id }, expected);
  assert.equal(record.activeSave, record.saves[0]!.id);
  assert.equal(records.has(PRE_HANDBOOK), false, 'nothing original was stored to migrate');
  // Re-importing the migrated export adds an identical copy without loading anything.
  const exported = await api('/api/export-saves');
  await post('/api/import-saves', exported);
  assert.equal(loads, 1);
  const saves = (records.get('main') as BrowserWorkspace).saves;
  assert.equal(saves.length, 2);
  assert.deepEqual({ ...saves[1]!.profiles[0]!, id: expected.id }, expected);
});

test('Pages edition: a failed conversion or recipe fetch leaves the record unchanged', async () => {
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
  const failing = async (): Promise<typeof migration> => {
    throw Error('Could not load the recipes');
  };
  const post = (api: ReturnType<typeof createBrowserApi>, body: unknown) =>
    api('/api/import-saves', { body: JSON.stringify(body) });
  const before = structuredClone(data);
  await assert.rejects(
    post(createBrowserApi(store, calculate, catalog(), undefined, failing), firstExport()),
    /Could not load the recipes/,
  );
  const bad = firstExport();
  // @ts-expect-error a partial handbook no release exported, which the import refuses
  originalOf(bad).handbook = { factories: [], phases: {}, storage: [] };
  await assert.rejects(
    post(
      createBrowserApi(store, calculate, catalog(), undefined, async () => migration),
      bad,
    ),
    /incomplete or damaged/,
  );
  assert.deepEqual(data, before);
});
