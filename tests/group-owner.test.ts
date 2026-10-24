// Co-op slice 2 (#1199, part of #1077): each factory group can have an owner, free text such as
// "Anna", set with the `factoryGroupOwner` update; a blank owner means nobody and is not stored. A
// state with an owner is progress state version 20, and only while a group has one, so every other
// state keeps the version an older release reads. The owner is part of the group, so it travels
// wherever groups travel: reloads, full exports and imports, shares, a new profile carried from it,
// and a co-op tick merge (#1160) leaves it as it is. "Me" and "Mine only" are view preferences
// (app/mine.ts), tested here as pure rules; the pages are in tests/ui/group-owner.test.ts. The
// progress side covers both editions: the Docker server (createApp, workspace.json) and the browser
// edition (createBrowserApi over openBrowserStore).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog } from '../planner.ts';
import {
  initialState,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { mergeChunks, readProgressFile, ticksExport } from '../public/app/progress-merge.ts';
import { anyOwner, ownedBy, sameOwner } from '../public/app/mine.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version19, version20 } from './types/fixtures.ts';
import type {
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const owner = (id: string, name: string): UpdateOp => ({
  type: 'factoryGroupOwner',
  id,
  owner: name,
});
const grouped = (): ProgressState => {
  let state = initialState();
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-plates1', name: 'Plates' });
  state = mutate(state, { type: 'factoryGroupAdd', id: 'fg-motors1', name: 'Motors' });
  return state;
};

test('an owner is stored trimmed, restored on load, kept by a rename and cleared by a blank', () => {
  let state = grouped();
  assert.equal(state.version, 3);
  state = mutate(state, owner('fg-plates1', '  Anna  '));
  assert.deepEqual(state.factoryGroups.groups, [
    { id: 'fg-plates1', name: 'Plates', owner: 'Anna' },
    { id: 'fg-motors1', name: 'Motors' },
  ]);
  assert.equal(state.version, 20);
  // It loads again as it was.
  assert.deepEqual(validateState(json(state)), state);
  // A rename keeps it; another owner replaces it.
  state = mutate(state, { type: 'factoryGroupRename', id: 'fg-plates1', name: 'Plate works' });
  assert.equal(state.factoryGroups.groups[0]!.owner, 'Anna');
  state = mutate(state, owner('fg-plates1', 'Bram'));
  assert.equal(state.factoryGroups.groups[0]!.owner, 'Bram');
  // A blank owner means nobody: the field goes, and so does version 20.
  for (const blank of ['', '   ']) {
    const cleared = mutate(state, owner('fg-plates1', blank));
    assert.equal('owner' in cleared.factoryGroups.groups[0]!, false);
    assert.equal(cleared.version, 3);
  }
});

test('version 20 is set only while a group has an owner, and dropped when none has', () => {
  let state = mutate(grouped(), owner('fg-plates1', 'Anna'));
  state = mutate(state, owner('fg-motors1', 'Bram'));
  assert.equal(state.version, 20);
  // One owner left keeps 20; the last one cleared drops it.
  state = mutate(state, owner('fg-plates1', ''));
  assert.equal(state.version, 20);
  state = mutate(state, owner('fg-motors1', ''));
  assert.equal(state.version, 3);
  // Removing the last owned group drops it too.
  state = mutate(mutate(state, owner('fg-motors1', 'Bram')), {
    type: 'factoryGroupRemove',
    id: 'fg-motors1',
  });
  assert.equal(state.version, 3);
  assert.deepEqual(state.factoryGroups.groups, [{ id: 'fg-plates1', name: 'Plates' }]);
  // A state that says less than it holds is marked for what it holds, and one that says 20
  // without an owner is marked for what it holds.
  const owned = mutate(grouped(), owner('fg-plates1', 'Anna'));
  assert.equal(validateState({ ...json(owned), version: 3 }).version, 20);
  assert.equal(validateState({ ...json(grouped()), version: 20 }).version, 3);
  // A higher version gets the update message.
  assert.throws(
    () => validateState({ ...json(owned), version: 26 }),
    /newer planner version\. Update the app to import it\./,
  );
  // An owner beside the other contents still wins: version19 with an owner is 20, and without it
  // falls back to 19.
  assert.equal(validateState(json(version20)).version, 20);
  const { factoryGroups, ...rest } = json(version20);
  assert.equal(
    validateState({
      ...rest,
      factoryGroups: {
        ...factoryGroups,
        groups: factoryGroups.groups.map(({ id, name }) => ({ id, name })),
      },
    }).version,
    19,
  );
});

test('a malformed owner is refused, in an update and in a stored state', () => {
  const state = grouped();
  assert.throws(() => mutate(state, owner('fg-nobody1', 'Anna')), /Unknown factory\./);
  assert.throws(
    () => mutate(state, owner('fg-plates1', 'x'.repeat(41))),
    /Invalid factory owner\./,
  );
  assert.throws(
    () => mutate(state, { type: 'factoryGroupOwner', id: 'fg-plates1', owner: 7 } as never),
    /Invalid factory owner\./,
  );
  assert.equal(
    mutate(state, owner('fg-plates1', 'x'.repeat(40))).factoryGroups.groups[0]!.owner!.length,
    40,
  );
  const stored = (value: unknown) =>
    validateState({
      ...json(state),
      factoryGroups: {
        groups: [{ id: 'fg-plates1', name: 'Plates', owner: value }],
        assignments: {},
      },
    });
  for (const bad of [7, null, true, ['Anna'], { name: 'Anna' }, 'y'.repeat(41)])
    assert.throws(() => stored(bad), /Invalid factory owner\./, JSON.stringify(bad));
  // A blank owner in a stored state is nobody, as the update makes it.
  assert.deepEqual(stored('  ').factoryGroups.groups, [{ id: 'fg-plates1', name: 'Plates' }]);
  assert.equal(stored('  ').version, 3);
  assert.equal(stored(' Anna ').factoryGroups.groups[0]!.owner, 'Anna');
});

test('every released state loads with the same version and groups, and no owner', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    if (version < 20) {
      assert.equal(JSON.stringify(clean.factoryGroups).includes('owner'), false);
      if (state.factoryGroups && 'groups' in state.factoryGroups)
        assert.deepEqual(clean.factoryGroups.groups, state.factoryGroups.groups);
    }
  }
  assert.deepEqual(
    validateState(json(version20)).factoryGroups.groups,
    version20.factoryGroups.groups,
  );
  assert.equal(validateState(json(version19)).version, 19);
});

test('the owner travels with the group: a share and a new profile carried from it keep it', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  const source = mutate(mutate(grouped(), owner('fg-plates1', 'Anna')), {
    type: 'check',
    key: 'space-elevator-1',
    value: true,
  });
  // A share drops progress, not the factories or who builds them.
  const shared = shareState(source);
  assert.deepEqual(shared.checks, {});
  assert.equal(shared.factoryGroups.groups[0]!.owner, 'Anna');
  assert.equal(shared.version, 20);
  // A new profile carried from it (the plan's edits picked, as by default) keeps the groups.
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(
    carried.factoryGroups.groups.find(group => group.id === 'fg-plates1'),
    { id: 'fg-plates1', name: 'Plates', owner: 'Anna' },
  );
  assert.equal(carried.version, 20);
  // Without its plan edits the new profile starts from the default groups, none of them owned.
  const fresh = newProfileState(plan, source, plan, { planEdits: false }, undefined).state;
  assert.equal(anyOwner(fresh.factoryGroups), false);
  assert.ok(fresh.version < 20);
});

test('a co-op tick merge reads a version-20 file and leaves the owners as they are', () => {
  const anna = mutate(mutate(grouped(), owner('fg-plates1', 'Anna')), {
    type: 'checks',
    keys: ['space-elevator-1', 'hub-1'],
    value: true,
  });
  // A progress backup of a profile with owners is read for its ticks.
  const backup = {
    format: 'satisfactory-planner-backup',
    exportedAt: '2026-10-21T10:00:00.000Z',
    saveName: 'Coop world',
    profileName: 'Anna',
    profileId: 'anna',
    state: json(anna),
  };
  assert.deepEqual(readProgressFile(json(backup)).ticks.sort(), ['hub-1', 'space-elevator-1']);
  // Bram's profile has its own owners; merging Anna's ticks sends `checks` updates only.
  let bram = mutate(mutate(grouped(), owner('fg-plates1', 'Anna')), owner('fg-motors1', 'Bram'));
  const groupsBefore = structuredClone(bram.factoryGroups);
  const file = readProgressFile(json(ticksExport(anna.checks, 'Coop world', 'Anna')));
  for (const keys of mergeChunks(file.ticks, bram.checks))
    bram = mutate(bram, { type: 'checks', keys, value: true });
  assert.equal(bram.checks['hub-1'], true);
  assert.deepEqual(bram.factoryGroups, groupsBefore);
  assert.equal(bram.version, 20);
});

test('"me" matches an owner once trimmed, whatever the case; only owners count', () => {
  assert.equal(sameOwner('Anna', 'anna'), true);
  assert.equal(sameOwner(' Anna ', 'ANNA '), true);
  assert.equal(sameOwner('Anna', 'Ann'), false);
  assert.equal(sameOwner(undefined, 'Anna'), false);
  assert.equal(sameOwner('Anna', '  '), false);
  const groups = mutate(
    mutate(grouped(), owner('fg-plates1', 'Anna')),
    owner('fg-motors1', 'Bram'),
  ).factoryGroups;
  assert.deepEqual([...ownedBy(groups, 'anna')], ['fg-plates1']);
  assert.deepEqual([...ownedBy(groups, 'Carl')], []);
  assert.equal(anyOwner(grouped().factoryGroups), false);
  assert.equal(anyOwner(groups), true);
});

// Both editions: setting an owner saves the progress state only (version 20), never recalculates
// the plan, survives a reload, a full export and its import, and a share; a merge's `checks` leave
// it; clearing it brings the version back; old saves import unchanged.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'Coop world', name: 'Shared', settings: {} });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-anna01', name: 'Smelting' });
  await request('/api/update', { type: 'factoryGroupAdd', id: 'fg-bram01', name: 'Wire works' });
  const before = await context();
  assert.ok(before.state.version < 20);
  await request('/api/update', owner('fg-anna01', ' Anna '));
  await request('/api/update', owner('fg-bram01', 'Bram'));
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 20);
  const owned = (state: { factoryGroups?: { groups?: { id: string; owner?: string }[] } }) =>
    Object.fromEntries(
      (state.factoryGroups?.groups || []).filter(g => g.owner).map(g => [g.id, g.owner]),
    );
  assert.deepEqual(owned(after.state), { 'fg-anna01': 'Anna', 'fg-bram01': 'Bram' });
  // A co-op merge's ticks are `checks` updates: the owners stay.
  const ids = after.plan.stages[after.state.settings.phase as '3']!.rows!.slice(0, 2).map(
    row => 'calc-' + after.state.settings.phase + '-' + row.id,
  );
  await request('/api/update', { type: 'checks', keys: ids, value: true });
  const merged = await context();
  assert.deepEqual(owned(merged.state), owned(after.state));
  assert.equal(merged.state.version, 20);
  // A full export carries the owners and passes the import's check; importing it makes a copy
  // with them.
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 20);
  assert.deepEqual(owned(carried), owned(after.state));
  const save = exported.saves[0]!,
    profile = save.profiles[0]!;
  // A share keeps who builds what, not the progress.
  const share = (await request(
    `/api/export-saves?save=${save.id}&profile=${profile.id}&share=1`,
  )) as SaveExport;
  const sharedState = share.saves[0]!.profiles[0]!.state;
  assert.deepEqual(owned(sharedState), owned(after.state));
  assert.deepEqual(sharedState.checks, {});
  // Saves from before (versions 1, 3, 7 and 19) and a version-20 one import as they were.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-21T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v1-0',
        profiles: states
          .filter(([, version]) => [1, 3, 7, 19, 20].includes(version))
          .map(([state, version], i) => ({
            ...profile,
            id: 'v' + version + '-' + i,
            name: 'Version ' + version + ' #' + i,
            state: json(state),
          })),
      },
    ],
  };
  await request('/api/import-saves', old);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const imported = all.saves.find(s => s.name.startsWith('Old world'))!;
  assert.equal(imported.profiles.length, old.saves[0]!.profiles.length);
  for (const [i, sent] of old.saves[0]!.profiles.entries()) {
    const got = imported.profiles[i]!.state;
    assert.equal(got.version, sent.state.version, sent.name);
    assert.deepEqual(got.checks, sent.state.checks, sent.name);
    assert.deepEqual(
      got.factoryGroups?.groups ?? [],
      sent.state.factoryGroups?.groups ?? [],
      sent.name,
    );
  }
  // Cleared again: the open profile is readable by older releases again.
  await request('/api/update', owner('fg-anna01', ''));
  await request('/api/update', owner('fg-bram01', '   '));
  await reload();
  const cleared = await context();
  assert.ok(cleared.state.version < 20, 'version ' + cleared.state.version);
  assert.deepEqual(owned(cleared.state), {});
  assert.deepEqual(cleared.state.checks, merged.state.checks, 'the ticks stay');
}

test('the Docker server keeps owners in workspace.json and never recalculates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-group-owner-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(res.ok, route + ' ' + res.status + ' ' + (await res.clone().text()));
    return res.json();
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      await listen();
    });
    // workspace.json holds no factory owner once cleared, and the imported version-20 profile's
    // where it was imported (a save's own "owner" is its user, not a factory's).
    const disk = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    assert.equal((disk.match(/"owner":\s*"Anna"/g) || []).length, 1, 'the imported profile');
    assert.equal((disk.match(/"owner":\s*"Bram"/g) || []).length, 0, 'cleared');
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps owners in IndexedDB and never recalculates', async () => {
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
  await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
});
