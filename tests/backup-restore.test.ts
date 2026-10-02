// Retiring the handbook, part 4d-2 (#606): a progress-only backup made of a handbook profile,
// restored onto the profile it was migrated into (one whose state has handbookOrigin), is re-keyed
// as the migration re-keyed the profile (restoreProgress in public/handbook-migration.ts). The
// migration records what it mapped (handbookOrigin.mapping, state version 13), so this works
// without the handbook, in both editions. A profile migrated before that record existed is
// re-keyed with the server's frozen handbook when its version matches; otherwise, and always in
// the Pages edition, which has no handbook, the backup's handbook-keyed records are kept for
// review in handbookOrigin.unmapped. Nothing is dropped. A backup made after the migration, and
// any backup onto an ordinary profile, restores as it is; a refused one changes nothing.
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
import {
  handbookMapping,
  handbookToPlan,
  migrateHandbookState,
  migrateOriginalProfile,
  restoreProgress,
} from '../public/handbook-migration.ts';
import { validateState } from '../public/state.ts';
import { calculate, catalog } from '../planner.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { frozenHandbook, recipes } from './helpers/data.ts';
import { everyRecordKept } from './helpers/records.ts';
import { version11, version12, version13 } from './types/fixtures.ts';
import type {
  BrowserSave,
  BrowserWorkspace,
  Handbook,
  ProgressState,
  SavedState,
  StoredProfile,
} from '../public/types/index.ts';

const { pureLimits } = catalog();
const migration = { recipes, pureLimits };
// The first release's handbook profile (2026-09-13): a version 1 state with handbook-keyed ticks,
// notes and a delivery, and the handbook it was made with.
const exported = JSON.parse(
  readFileSync(new URL('./fixtures/export-2026-09-13.json', import.meta.url), 'utf8'),
);
const firstState: SavedState = exported.saves[0].profiles[0].state;
const ownHandbook: Handbook = exported.saves[0].profiles[0].handbook;
// A version 11 backup of a handbook profile: the same records, plus group assignments and a step
// link under handbook factory ids and a link from one raw resource (version 11).
const factory = frozenHandbook.factories.find(f => f.id === 'iron-ingot')!;
const v11State: SavedState = {
  ...structuredClone(firstState),
  version: 11,
  storageEdits: structuredClone(version11.storageEdits),
  taskEdits: { ...structuredClone(version11.taskEdits), links: { 'phase-3-survey': factory.id } },
  factoryGroups: {
    ...structuredClone(version11.factoryGroups),
    assignments: {
      [factory.id]: [{ group: 'fg-plates1', rate: null }],
      'no-such-factory': [{ group: 'fg-plates1', rate: 5 }],
    },
  },
};
const backupOf = (state: unknown, profileId = 'original') => ({
  format: 'satisfactory-planner-backup',
  exportedAt: '2026-09-20T10:00:00.000Z',
  saveName: 'My Satisfactory save',
  profileName: 'Original',
  profileId,
  state,
});
// What the migration made of `state` with `handbook`, the result a restore must equal.
const migrated = (state: SavedState, handbook: Handbook) =>
  migrateHandbookState(state, handbook, handbookToPlan(handbook, recipes, pureLimits));
const withoutRevision = ({ revision: _revision, ...rest }: ProgressState) => rest;
// A profile migrated before handbookOrigin.mapping existed: version 12, no mapping.
const premapping = (state: SavedState, handbook: Handbook, version = handbook.version) => {
  const progress = migrated(state, handbook);
  delete progress.handbookOrigin!.mapping;
  progress.handbookOrigin!.version = version;
  return validateState(progress);
};

test('the migration records what it mapped, as state version 13', () => {
  const conversion = handbookToPlan(frozenHandbook, recipes, pureLimits);
  const mapping = handbookMapping(frozenHandbook, conversion);
  assert.deepEqual(mapping.rows, {
    '3': conversion.rows['3'],
    '4': conversion.rows['4'],
    '5': conversion.rows['5'],
  });
  assert.deepEqual(
    mapping.factories,
    frozenHandbook.factories.map(f => f.id),
  );
  assert.deepEqual(mapping.knownChecks, frozenHandbook.knownChecks);
  assert.deepEqual(mapping.deliveries, { '3-versatile-framework': 125000 });
  const profile = migrateOriginalProfile(
    { id: 'original', name: 'Original', kind: 'original', state: structuredClone(firstState) },
    frozenHandbook,
    recipes,
    pureLimits,
  );
  assert.equal(profile.state.version, 13);
  assert.deepEqual(profile.state.handbookOrigin!.mapping, mapping);
  // The rest of the migration is what it was: the same state without the mapping is version 12.
  const { mapping: _mapping, ...origin } = profile.state.handbookOrigin!;
  assert.equal(validateState({ ...profile.state, handbookOrigin: origin }).version, 12);
});

test('handbookOrigin.mapping is kept exactly, and a malformed one is refused', () => {
  const clean = validateState(structuredClone(version13));
  assert.equal(clean.version, 13);
  assert.deepEqual(clean.handbookOrigin, version13.handbookOrigin);
  const mapping = version13.handbookOrigin.mapping;
  for (const bad of [
    null,
    [],
    { ...mapping, rows: { '2': {} } },
    { ...mapping, rows: { '3': { 'bad id': 'Recipe_IronPlate_C' } } },
    { ...mapping, rows: { '3': { 'iron-plate': 5 } } },
    { ...mapping, factories: 'iron-plate' },
    { ...mapping, factories: ['iron-plate', 'iron-plate'] },
    { ...mapping, knownChecks: { 'storage-ground-shell': 'yes' } },
    { ...mapping, deliveries: { '3-versatile-framework': -1 } },
    { ...mapping, deliveries: { '3-versatile-framework': 1.5 } },
    { rows: {}, factories: [], knownChecks: {} },
  ])
    assert.throws(
      () =>
        validateState({
          ...structuredClone(version13),
          handbookOrigin: { ...version13.handbookOrigin, mapping: bad },
        }),
      /Invalid record of an earlier profile conversion\./,
      JSON.stringify(bad),
    );
});

test('restoreProgress re-keys a backup made before the migration by the recorded mapping', () => {
  const current = migrated(firstState, frozenHandbook);
  for (const backup of [firstState, v11State]) {
    const restored = restoreProgress(current, validateState(structuredClone(backup)));
    assert.deepEqual(restored, migrated(backup, frozenHandbook));
    everyRecordKept(backup, restored, handbookToPlan(frozenHandbook, recipes, pureLimits));
    assert.equal(restored.version, 13);
  }
  // The frozen mapping is never used where the profile records its own.
  const other = { version: frozenHandbook.version, mapping: version13.handbookOrigin.mapping };
  assert.deepEqual(
    restoreProgress(current, validateState(structuredClone(firstState)), other),
    migrated(firstState, frozenHandbook),
  );
});

test('restoreProgress uses the frozen mapping only for its own version, else keeps for review', () => {
  const conversion = handbookToPlan(frozenHandbook, recipes, pureLimits);
  const frozen = { version: '2026-09-13', mapping: handbookMapping(frozenHandbook, conversion) };
  const backup = validateState(structuredClone(v11State));
  // Migrated before the mapping existed, from the frozen handbook: re-keyed with it.
  const restored = restoreProgress(premapping(firstState, frozenHandbook), backup, frozen);
  assert.deepEqual(restored, migrated(v11State, frozenHandbook));
  // From another handbook, or with no frozen copy (the Pages edition): nothing is guessed.
  for (const [current, given] of [
    [premapping(firstState, frozenHandbook, '2026-08-01'), frozen],
    [premapping(firstState, frozenHandbook), undefined],
  ] as const) {
    const kept = restoreProgress(current, backup, given);
    everyRecordKept(v11State, kept, { rows: {} });
    const unmapped = kept.handbookOrigin!.unmapped;
    assert.equal(kept.handbookOrigin!.version, current.handbookOrigin!.version);
    assert.equal('mapping' in kept.handbookOrigin!, false);
    assert.equal(kept.version, 12);
    assert.deepEqual(unmapped.checks, {
      'factory-3-iron-ingot': true,
      'factory-3-wire': false,
      'factory-3-plastic': true,
      'factory-4-plastic': true,
      'factory-4-rubber': true,
      'factory-5-computer': true,
    });
    assert.deepEqual(unmapped.notes, {
      'factory-wire': 'By the river',
      'factory-old-campus': 'Moved east',
    });
    assert.deepEqual(unmapped.assignments, v11State.factoryGroups!.assignments);
    assert.deepEqual(kept.factoryGroups.assignments, {});
    // Every other record restores as it is, the step link included (it cannot be placed).
    assert.equal(kept.checks['phase-3-survey'], true);
    assert.equal(kept.notes.global, 'Seed 1234, north-east start');
    assert.deepEqual(kept.deliveries, { '3-modular-engine': 1200 });
    assert.deepEqual(kept.taskEdits.links, { 'phase-3-survey': factory.id });
    assert.deepEqual(kept.factoryGroups.links, backup.factoryGroups.links);
    assert.deepEqual(kept.storageEdits, backup.storageEdits);
  }
});

test('restoreProgress leaves a post-migration backup, and one onto any other profile, as it is', () => {
  const current = migrated(firstState, frozenHandbook);
  const later = validateState(structuredClone(version13));
  assert.deepEqual(restoreProgress(current, later), later);
  const ordinary = validateState(structuredClone(version11));
  const backup = validateState(structuredClone(firstState));
  assert.deepEqual(restoreProgress(ordinary, backup), backup);
  assert.deepEqual(restoreProgress(validateState(structuredClone(version12)), later), later);
});

// Both editions, through POST /api/import, starting from a store as an earlier release left it:
// an original profile (migrated when the store opens), a profile migrated before the mapping
// existed, and an ordinary calculated profile.
type Edition = {
  // Resolves with the reply, or rejects with the refusal's message.
  request: (route: string, profile: string, body?: unknown) => Promise<unknown>;
  close: () => Promise<unknown>;
};
const plan = handbookToPlan(frozenHandbook, recipes, pureLimits).plan;
const profiles = (original: StoredProfile): StoredProfile[] => [
  original,
  {
    id: 'premapping',
    name: 'Migrated earlier',
    kind: 'calculated',
    plan,
    state: premapping(firstState, frozenHandbook),
  },
  {
    id: 'foreign',
    name: 'Migrated from another handbook',
    kind: 'calculated',
    plan,
    state: premapping(firstState, frozenHandbook, '2026-08-01'),
  },
  {
    id: 'ordinary',
    name: 'Balanced',
    kind: 'calculated',
    plan: calculate({ phase: '3' }),
    state: validateState(structuredClone(version11)),
  },
];
const save = (original: StoredProfile): BrowserSave => ({
  id: 'save-a',
  name: 'My Satisfactory save',
  activeProfile: 'original',
  profiles: profiles(original),
});

// The Docker edition, from a workspace.json whose original profile has no handbook of its own:
// it migrates with the frozen copy.
async function docker(): Promise<Edition> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-restore-'));
  const original: StoredProfile = {
    id: 'original',
    name: 'Original · 50× complete automation',
    kind: 'original',
    state: structuredClone(firstState),
  };
  await fs.writeFile(
    path.join(dataDir, 'workspace.json'),
    JSON.stringify({
      version: 2,
      revision: 3,
      accountsEnabled: false,
      registration: false,
      users: [{ id: 'owner', username: 'Local pioneer', activeSave: 'save-a' }],
      saves: [{ ...save(original), userId: 'owner' }],
      sessions: [],
    }),
  );
  const server = await createApp({ dataDir, password: '' });
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
// The Pages edition, from an IndexedDB record whose original profile carries its own handbook,
// as every one there does.
async function pages(): Promise<Edition> {
  const original: StoredProfile = {
    id: 'original',
    name: 'Original · 50× complete automation',
    kind: 'original',
    handbook: structuredClone(ownHandbook),
    state: structuredClone(firstState),
  };
  const record: BrowserWorkspace = {
    version: 1,
    activeSave: 'save-a',
    saves: [save(original)],
    lastBackup: null,
  };
  const records = new Map<string, unknown>([['main', record]]);
  const load = async () => migration;
  const store = openBrowserStore(fakeIndexedDB(1, records), undefined, load);
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

for (const [edition, open, handbook] of [
  ['Docker', docker, frozenHandbook],
  ['Pages', pages, ownHandbook],
] as const)
  test(`${edition} edition: version 1 and version 11 backups restore onto a migrated profile`, async () => {
    const { request, close } = await open();
    const state = async (profile: string) =>
      (await request('/api/state', profile)) as ProgressState;
    try {
      const after = await state('original');
      assert.equal(after.version, 13, 'the store migrated it, recording the mapping');
      // A tick after the migration, which the restore replaces like any other progress.
      await request('/api/update', 'original', {
        type: 'check',
        key: 'phase-3-retire-power',
        value: true,
      });
      for (const backup of [firstState, v11State]) {
        const before = await state('original');
        const restored = (await request(
          '/api/import',
          'original',
          backupOf(backup),
        )) as ProgressState;
        assert.deepEqual(withoutRevision(restored), withoutRevision(migrated(backup, handbook)));
        assert.equal(restored.revision, before.revision + 1);
        assert.deepEqual(await state('original'), restored);
        everyRecordKept(backup, restored, handbookToPlan(handbook, recipes, pureLimits));
      }
      // A backup made after the migration restores unchanged.
      const later = (await request('/api/export', 'original')) as { state: ProgressState };
      await request('/api/import', 'original', backupOf(firstState));
      const back = (await request('/api/import', 'original', later)) as ProgressState;
      assert.deepEqual(withoutRevision(back), withoutRevision(later.state));
      // A bare state (no backup wrapper) is restored the same way.
      const bare = (await request(
        '/api/import',
        'original',
        structuredClone(firstState),
      )) as ProgressState;
      assert.deepEqual(withoutRevision(bare), withoutRevision(migrated(firstState, handbook)));
    } finally {
      await close();
    }
  });

for (const [edition, open] of [
  ['Docker', docker],
  ['Pages', pages],
] as const)
  test(`${edition} edition: a profile migrated before the mapping existed keeps every record`, async () => {
    const { request, close } = await open();
    try {
      const restored = (await request(
        '/api/import',
        'premapping',
        backupOf(v11State, 'premapping'),
      )) as ProgressState;
      if (edition === 'Docker') {
        // The frozen copy is the handbook this profile came from.
        assert.deepEqual(
          withoutRevision(restored),
          withoutRevision(migrated(v11State, frozenHandbook)),
        );
      } else {
        // No handbook in this edition: the handbook-keyed records are kept for review.
        everyRecordKept(v11State, restored, { rows: {} });
        assert.equal(restored.handbookOrigin!.unmapped.checks['factory-3-iron-ingot'], true);
        assert.equal(restored.version, 12);
      }
      // From a handbook the server has no copy of, nothing is guessed in either edition.
      const foreign = (await request(
        '/api/import',
        'foreign',
        backupOf(v11State, 'foreign'),
      )) as ProgressState;
      everyRecordKept(v11State, foreign, { rows: {} });
      assert.equal(foreign.handbookOrigin!.version, '2026-08-01');
      assert.equal(foreign.handbookOrigin!.unmapped.notes['factory-wire'], 'By the river');
    } finally {
      await close();
    }
  });

for (const [edition, open] of [
  ['Docker', docker],
  ['Pages', pages],
] as const)
  test(`${edition} edition: a backup onto an ordinary profile restores as today; a refused one changes nothing`, async () => {
    const { request, close } = await open();
    const state = async (profile: string) =>
      (await request('/api/state', profile)) as ProgressState;
    try {
      const restored = (await request(
        '/api/import',
        'ordinary',
        backupOf(firstState, 'ordinary'),
      )) as ProgressState;
      assert.deepEqual(withoutRevision(restored), withoutRevision(validateState(firstState)));
      assert.equal('handbookOrigin' in restored, false);
      for (const profile of ['original', 'premapping', 'ordinary']) {
        const before = await state(profile);
        for (const refused of [
          backupOf(firstState, 'someone-else'),
          backupOf({ ...structuredClone(firstState), version: 14 }, profile),
          backupOf({ ...structuredClone(firstState), checks: { 'bad key': true } }, profile),
          { ...backupOf(firstState, profile), format: 'satisfactory-planner-saves' },
        ])
          await assert.rejects(
            request('/api/import', profile, refused),
            JSON.stringify(refused).slice(0, 80),
          );
        assert.deepEqual(await state(profile), before, profile + ' is unchanged');
      }
    } finally {
      await close();
    }
  });
