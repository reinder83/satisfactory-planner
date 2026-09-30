// An original profile whose handbook lacks parts the conversion reads (#609): a hand-made or
// damaged export that an import before #605 stored as it was. Such a record must never stop the
// Docker server from starting or the browser edition from opening its saves. Both stores convert
// it with the parts it has, keeping every record (re-keyed, or for review in
// handbookOrigin.unmapped) and their pre-migration copy; an import refuses such a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace } from '../workspace.ts';
import { initialState, mutate, validateState } from '../server.ts';
import { openBrowserStore, PRE_HANDBOOK } from '../public/browser-store.ts';
import {
  handbookToPlan,
  migrateHandbookState,
  migrateOriginalProfile,
  usableHandbook,
} from '../public/handbook-migration.ts';
import { validateTransfer } from '../public/transfer.ts';
import { catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { frozenHandbook as frozen, recipes } from './helpers/data.ts';
import type {
  BrowserWorkspace,
  Handbook,
  ProgressState,
  SaveExport,
  StoredProfile,
  WorkspaceFile,
} from '../public/types/index.ts';

const { pureLimits } = catalog();
const whole = handbookToPlan(frozen, recipes, pureLimits);
// Two Phase 3 factories the whole handbook turns into rows.
const [kept, damaged] = frozen.factories.filter(f => whole.rows['3']![f.id]);
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

// The handbooks no release exported. `bare` is the one the issue names; `broken` is a whole one
// with parts missing or of the wrong shape, so the rest of it still converts. Both are partial
// fixtures, typed as the Handbook a stored profile claims to carry.
function bare(): Handbook {
  const handbook: Partial<Handbook> = { factories: [], phases: {}, storage: [] };
  return handbook as Handbook;
}
function broken(): Handbook {
  const handbook: Partial<Handbook> = structuredClone(frozen);
  delete handbook.version;
  delete handbook.plans;
  delete handbook.deliveries;
  // @ts-expect-error: power of the wrong shape, on purpose.
  handbook.power = 'none';
  const factory = handbook.factories!.find(f => f.id === damaged!.id)!;
  // @ts-expect-error: a stage of the wrong shape, on purpose.
  factory.stages['3'] = { recipe: 5 };
  return handbook as Handbook;
}
// Progress on a handbook profile: a tick and a note on each factory, a step, and a delivery.
const progress = (): ProgressState => ({
  ...initialState(),
  checks: {
    ['factory-3-' + kept!.id]: true,
    ['factory-3-' + damaged!.id]: true,
    'phase-3-survey': true,
  },
  notes: { ['factory-' + kept!.id]: 'By the lake', global: 'My world' },
  deliveries: { '3-versatile-framework': 4000 },
});
const original = (id: string, handbook: Handbook): StoredProfile => ({
  id,
  name: 'Original · ' + id,
  kind: 'original',
  handbook,
  state: progress(),
});

// Checks, independently of migrateHandbookState, that every record of the progress above is in
// `state`: under its own key, re-keyed to its factory's row, or kept for review in unmapped.
function everyRecordKept(state: ProgressState, handbook: Handbook) {
  const { rows } = handbookToPlan(usableHandbook(handbook).handbook, recipes, pureLimits);
  const unmapped = state.handbookOrigin!.unmapped;
  const before = progress();
  for (const [key, ticked] of Object.entries(before.checks)) {
    const factory = /^factory-([345])-(.+)$/.exec(key);
    const row = factory && rows[factory[1]!]?.[factory[2]!];
    if (row) assert.equal(state.checks[`calc-${factory[1]}-${row}`], ticked, key);
    else if (factory) assert.equal(unmapped.checks[key], ticked, key + ' is kept for review');
    else assert.equal(state.checks[key], ticked, key);
  }
  const noteRow = rows['3']?.[kept!.id];
  if (noteRow) assert.equal(state.notes['factory-' + noteRow], 'By the lake');
  else assert.equal(unmapped.notes['factory-' + kept!.id], 'By the lake', 'kept for review');
  assert.equal(state.notes.global, 'My world');
  assert.equal(state.deliveries['3-versatile-framework'], 4000);
  assert.equal(state.settings.phase, before.settings.phase);
}

test('a handbook with parts missing converts with the parts it has', () => {
  for (const handbook of [bare(), broken()]) {
    const usable = usableHandbook(handbook);
    assert.equal(usable.complete, false);
    const migrated = migrateOriginalProfile(original('p', handbook), frozen, recipes, pureLimits);
    assert.equal(migrated.kind, 'calculated');
    assert.equal('handbook' in migrated, false);
    everyRecordKept(migrated.state as ProgressState, handbook);
  }
  // Of the damaged one, only the factory stage that cannot be read is left out.
  const { plan, rows } = handbookToPlan(usableHandbook(broken()).handbook, recipes, pureLimits);
  assert.equal(rows['3']![kept!.id], whole.rows['3']![kept!.id]);
  assert.equal(rows['3']![damaged!.id], undefined);
  assert.equal(plan.engine, 'handbook-unknown');
  assert.equal(plan.stages['4']!.rows!.length > 0, true);
  const state = migrateOriginalProfile(original('p', broken()), frozen, recipes, pureLimits)
    .state as ProgressState;
  assert.equal(state.checks['calc-3-' + whole.rows['3']![kept!.id]], true);
  assert.equal(state.handbookOrigin!.unmapped.checks['factory-3-' + damaged!.id], true);
  assert.equal(state.handbookOrigin!.version, 'unknown');
});

test('every released handbook is complete and used exactly as it is', () => {
  const firstExport = JSON.parse(read('./fixtures/export-2026-09-13.json')) as SaveExport;
  // The Pages edition's empty template (buildPages in build.ts).
  const template = {
    version: 'public-template-v1',
    storage: [],
    storageTasks: [],
    phases: { 3: [], 4: [], 5: [], post: [] },
    factories: [],
    completion: [],
    deliveries: [],
    resources: {},
    capacities: {},
    plans: {},
    power: {},
    knownChecks: {},
    sources: [],
  };
  for (const handbook of [
    frozen,
    JSON.parse(read('../public/plan.json')),
    firstExport.saves[0]!.profiles[0]!.handbook,
    template,
  ]) {
    const usable = usableHandbook(handbook);
    assert.equal(usable.complete, true);
    assert.deepEqual(usable.handbook, handbook);
  }
  // So a whole handbook's profile migrates exactly as before.
  const profile = original('p', structuredClone(frozen));
  const migrated = migrateOriginalProfile(profile, frozen, recipes, pureLimits);
  assert.deepEqual(migrated.plan, whole.plan);
  assert.deepEqual(migrated.state, migrateHandbookState(progress(), frozen, whole));
});

test('an import refuses an original profile with parts of its handbook missing', () => {
  const transfer = (handbook: Handbook) => ({
    format: 'satisfactory-planner-saves',
    version: 1,
    saves: [{ id: 's', name: 'World', activeProfile: 'p', profiles: [original('p', handbook)] }],
  });
  for (const handbook of [bare(), broken()])
    assert.throws(() => validateTransfer(transfer(handbook)), {
      status: 400,
      message:
        'This save file comes from an older planner and is incomplete or damaged, so it cannot be imported. Export it again from the planner that made it.',
    });
  assert.equal(validateTransfer(transfer(structuredClone(frozen))).saves.length, 1);
});

// The Docker edition: a workspace.json that already holds such a profile.
const workspace = (): WorkspaceFile => ({
  version: 2,
  revision: 3,
  accountsEnabled: true,
  registration: false,
  users: [{ id: 'owner', username: 'Owner', password: 'salt:hash', activeSave: 'save-a' }],
  saves: [
    {
      id: 'save-a',
      name: 'Owner world',
      userId: 'owner',
      activeProfile: 'bare',
      profiles: [original('bare', bare()), original('broken', broken())],
    },
  ],
  sessions: [],
});

test('Docker edition: the server starts and migrates such a profile, keeping the file as it was', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-partial-handbook-'));
  try {
    const raw = JSON.stringify(workspace());
    await fs.writeFile(path.join(dir, 'workspace.json'), raw);
    await openWorkspace({ dataDir: dir, validateState, mutate });
    const copy = await fs.readFile(path.join(dir, 'workspace.json.pre-handbook'), 'utf8');
    assert.equal(copy, raw, 'the pre-migration copy');
    const stored = JSON.parse(
      await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'),
    ) as WorkspaceFile;
    assert.equal(stored.revision, 4);
    const [first, second] = stored.saves[0]!.profiles;
    for (const [profile, handbook] of [
      [first!, bare()],
      [second!, broken()],
    ] as const) {
      assert.equal(profile.kind, 'calculated');
      assert.equal('handbook' in profile, false);
      everyRecordKept(profile.state as ProgressState, handbook);
    }
    assert.deepEqual(
      stored.saves[0]!.profiles.map(p => [p.id, p.name]),
      workspace().saves[0]!.profiles.map(p => [p.id, p.name]),
    );
    // Starting again changes nothing.
    const once = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    await openWorkspace({ dataDir: dir, validateState, mutate });
    assert.equal(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'), once);
    assert.equal(await fs.readFile(path.join(dir, 'workspace.json.pre-handbook'), 'utf8'), raw);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// The Pages edition: an IndexedDB record that already holds such a profile, opened by a release
// before the schema upgrade (version 1) and by one after it (version 2, where each connection
// migrates on its first transaction).
const record = (): BrowserWorkspace => ({
  version: 1,
  activeSave: 's',
  saves: [
    {
      id: 's',
      name: 'My world',
      activeProfile: 'bare',
      profiles: [original('bare', bare()), original('broken', broken())],
    },
  ],
  lastBackup: null,
});

for (const schema of [1, 2])
  test(`Pages edition: a schema ${schema} database with such a profile opens and migrates it`, async () => {
    const seeded = record();
    const records = new Map<string, unknown>([['main', structuredClone(seeded)]]);
    const store = openBrowserStore(fakeIndexedDB(schema, records), undefined, async () => ({
      recipes,
      pureLimits,
    }));
    const read = await store.transaction();
    assert.deepEqual(records.get(PRE_HANDBOOK), seeded, 'the pre-migration copy, as it was');
    const main = records.get('main') as BrowserWorkspace;
    assert.deepEqual(read, main);
    const [first, second] = main.saves[0]!.profiles;
    for (const [profile, handbook] of [
      [first!, bare()],
      [second!, broken()],
    ] as const) {
      assert.equal(profile.kind, 'calculated');
      assert.equal('handbook' in profile, false);
      everyRecordKept(profile.state as ProgressState, handbook);
    }
    // Later transactions go through as usual.
    assert.equal(await store.transaction(data => data.saves.length), 1);
  });
