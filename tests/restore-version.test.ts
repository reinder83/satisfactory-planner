// "Restore this version" (#1071), in both editions: a recalculation in place links the version it
// keeps to the profile (backupOf), and POST /api/restore-version, scoped to that kept version,
// swaps it back: the profile keeps its id and name and gets the kept version's plan and progress,
// and the version it replaces takes the kept version's place, still linked, so a second restore
// round-trips. Nothing is deleted or added. A stale plan (409), a missing kept version and a
// profile that is no kept version are refused and write nothing. The link survives a full export
// and import (remapped to the new ids), is left out of a one-profile export or share, and every
// save from before it (the oldest export, a backup a recalculation kept before the link) loads,
// exports and imports unchanged, with no restore offered.
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
import {
  notAKeptVersion,
  planReplaced,
  restoredVersions,
  restoreStale,
  restoreTarget,
  restoreTargetGone,
  checkRestore,
} from '../public/state.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  Recipe,
  SaveExport,
  StoredProfile,
  WorkspaceFile,
  WorkspaceSummary,
} from '../public/types/index.ts';

const SETTINGS = { phase: '1', goal: 'minimal' };
const EDITED = { phase: '1', goal: 'balanced' };
const UNLOCK = 'unlock-Schematic_1-1_C';

interface Created {
  saveId: string;
  profileId: string;
}
interface Recalculated extends Created {
  backupId: string;
}

// One edition: a request (POST with a body, GET without; a refusal rejects), the same request
// answered with its refusal, and the stored saves.
type Headers = Record<string, string>;
interface Edition {
  request: <T>(route: string, body?: unknown, headers?: Headers) => Promise<T>;
  refused: (
    route: string,
    body?: unknown,
    headers?: Headers,
  ) => Promise<{ status: number; error: string }>;
  saves: () => Promise<{ id: string; activeProfile: string; profiles: StoredProfile[] }[]>;
}

// Every calc- check of a context's plan, as its tick key.
const rowKeys = (context: ContextReply) =>
  Object.entries(context.plan!.stages).flatMap(([phase, stage]) =>
    (stage?.rows || []).map(row => `calc-${phase}-${row.id}`),
  );
const withoutRevision = ({ state }: StoredProfile) => {
  const { revision: _revision, ...rest } = state;
  return rest;
};
// The content a restore moves: plan and progress (the revision moves on).
function assertContent(profile: StoredProfile | undefined, from: StoredProfile, what: string) {
  assert.ok(profile, what);
  assert.deepEqual(profile.plan, from.plan, what + ': the plan');
  assert.deepEqual(withoutRevision(profile), withoutRevision(from), what + ': the progress');
}

// Recalculates a profile in place, then restores the kept version and restores again, with every
// refusal on the way; then exports and imports the save. The same steps in both editions.
async function restoreTwice(edition: Edition) {
  const created = await edition.request<Created>('/api/profiles', {
    saveName: 'World',
    name: 'Minimal',
    settings: SETTINGS,
  });
  const other = await edition.request<Created>('/api/profiles', {
    saveId: created.saveId,
    name: 'Other',
    settings: SETTINGS,
  });
  const P = created.profileId;
  const scope = (profileId: string) => ({ 'X-Save-Id': created.saveId, 'X-Profile-Id': profileId });
  const context = (id: string) =>
    edition.request<ContextReply>('/api/context', undefined, scope(id));
  const update = (id: string, change: unknown) => edition.request('/api/update', change, scope(id));
  const stored = async () => (await edition.saves())[0]!.profiles;
  const find = async (id: string) => (await stored()).find(p => p.id === id)!;

  const first = await context(P);
  for (const key of [...rowKeys(first).slice(0, 4), UNLOCK])
    await update(P, { type: 'check', key, value: true });
  await update(P, { type: 'note', key: 'global', value: 'Before the edit' });
  const done = await edition.request<Recalculated>(
    '/api/recalculate',
    {
      name: 'Balanced',
      backupName: 'Minimal (before edit)',
      settings: EDITED,
      planCreatedAt: first.plan!.createdAt,
    },
    scope(P),
  );
  const B = done.backupId;
  // Progress made after the edit belongs to the edited version.
  await update(P, { type: 'note', key: 'global', value: 'After the edit' });
  const edited = await find(P),
    kept = await find(B),
    otherBefore = await find(other.profileId);
  assert.equal(kept.backupOf, P, 'the kept version is linked to the profile');
  assert.equal(edited.backupOf, undefined);

  // Only the kept version's card offers a restore, naming the profile and both plans.
  const cards = (await edition.request<WorkspaceSummary>('/api/workspace')).saves[0]!.profiles;
  const card = (id: string) => cards.find(p => p.id === id)!;
  assert.equal(card(B).backupOf, P);
  assert.equal(card(B).planCreatedAt, kept.plan!.createdAt);
  assert.equal(card(P).planCreatedAt, edited.plan!.createdAt);
  assert.equal(card(P).backupOf, undefined);
  assert.equal(card(other.profileId).backupOf, undefined);

  // Refusals write nothing: a kept version that is gone, a profile that is no kept version, and a
  // request made on another plan of either profile.
  const before = await edition.saves();
  const body = {
    into: P,
    planCreatedAt: edited.plan!.createdAt,
    backupPlanCreatedAt: kept.plan!.createdAt,
    backupName: 'Balanced (before restore)',
  };
  // A status of 0: only the message is compared (the browser edition throws a plain Error there).
  const refusals: [Headers, object, number, string][] = [
    [scope('gone'), body, 0, 'Profile not found.'],
    [scope(B), { ...body, backupName: '' }, 0, 'Enter a name with 1–80 characters.'],
    [scope(other.profileId), { ...body, into: P }, 404, notAKeptVersion],
    [scope(B), { ...body, planCreatedAt: first.plan!.createdAt }, 409, restoreStale],
    [scope(B), { ...body, backupPlanCreatedAt: edited.plan!.createdAt }, 409, restoreStale],
    [scope(B), { ...body, into: other.profileId }, 409, restoreStale],
  ];
  for (const [headers, request, status, error] of refusals) {
    const refused = await edition.refused('/api/restore-version', request, headers);
    assert.equal(refused.error, error, JSON.stringify(request));
    if (status) assert.equal(refused.status, status, JSON.stringify(request));
  }
  assert.deepEqual(await edition.saves(), before, 'a refused restore writes nothing');

  // The restore: the profile keeps its id, name and place and gets the kept version back; the
  // version it replaced takes the kept version's place, linked, under the name sent.
  const restored = await edition.request<Recalculated>('/api/restore-version', body, scope(B));
  assert.deepEqual([restored.profileId, restored.backupId], [P, B]);
  let saves = await edition.saves();
  assert.deepEqual(
    saves[0]!.profiles.map(p => p.id),
    before[0]!.profiles.map(p => p.id),
    'no profile is added, removed or moved',
  );
  assert.equal(saves[0]!.activeProfile, before[0]!.activeProfile, 'the active profile stays');
  let profile = await find(P);
  assert.equal(profile.name, 'Balanced', 'the profile keeps its name');
  assert.equal(profile.backupOf, undefined);
  assertContent(profile, kept, 'the profile has the kept version');
  assert.ok(profile.state.revision > Math.max(edited.state.revision, kept.state.revision));
  let replaced = await find(B);
  assert.equal(replaced.name, 'Balanced (before restore)');
  assert.equal(replaced.backupOf, P, 'the replaced version is kept, linked');
  assertContent(replaced, edited, 'the replaced version');
  assert.deepEqual(await find(other.profileId), otherBefore, 'the other profile is untouched');
  const now = await context(P);
  assert.equal(now.profile.id, P);
  assert.equal(now.state.notes.global, 'Before the edit');
  assert.equal(now.state.checks[UNLOCK], true);

  // A tab still showing the edited plan is refused its state, so it opens the restored one.
  const stale = await edition.refused('/api/state', undefined, {
    ...scope(P),
    'X-Planner-Plan': edited.plan!.createdAt,
  });
  assert.deepEqual(stale, { status: 409, error: planReplaced });
  // The same request again names plans the profiles no longer have.
  const again = await edition.refused('/api/restore-version', body, scope(B));
  assert.deepEqual(again, { status: 409, error: restoreStale });

  // Restoring the replaced version round-trips.
  await edition.request(
    '/api/restore-version',
    {
      into: P,
      planCreatedAt: kept.plan!.createdAt,
      backupPlanCreatedAt: edited.plan!.createdAt,
      backupName: 'Balanced (before restore 2)',
    },
    scope(B),
  );
  profile = await find(P);
  assertContent(profile, edited, 'restored twice, the profile is the edited version again');
  assert.equal((await context(P)).state.notes.global, 'After the edit');
  replaced = await find(B);
  assertContent(replaced, kept, 'and the kept version is the one kept by the edit');
  assert.equal(replaced.backupOf, P);
  saves = await edition.saves();

  // A full export carries the link; its import links the copies by their new ids.
  const exported = await edition.request<SaveExport>('/api/export-saves');
  const exportedSave = exported.saves.find(save => save.id === created.saveId)!;
  assert.equal(exportedSave.profiles.find(p => p.id === B)!.backupOf, P);
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles, exportedSave.profiles);
  await edition.request('/api/import-saves', exported);
  const copy = (await edition.saves()).find(save => save.id !== created.saveId)!;
  const [copyP, copyB] = [copy.profiles[0]!, copy.profiles[1]!];
  assert.ok(![P, B].includes(copyP.id) && ![P, B].includes(copyB.id), 'new ids');
  assert.equal(copyB.backupOf, copyP.id, 'the link follows the profile to its new id');
  assert.equal(copyP.backupOf, undefined);
  assertContent(copyB, replaced, 'the copy of the kept version');
  const imported = (await edition.request<WorkspaceSummary>('/api/workspace')).saves.find(
    save => save.id === copy.id,
  )!;
  assert.equal(imported.profiles[1]!.backupOf, copyP.id, 'the copy offers its restore');

  // One profile's export, or a share, leaves the link out: the profile it names is not in it.
  for (const share of ['', '&share=1']) {
    const single = await edition.request<SaveExport>(
      `/api/export-saves?save=${created.saveId}&profile=${B}${share}`,
    );
    assert.equal(single.saves[0]!.profiles.length, 1);
    assert.equal('backupOf' in single.saves[0]!.profiles[0]!, false, 'no link' + share);
  }
  assert.deepEqual(
    (await edition.saves()).find(save => save.id === created.saveId),
    saves[0],
    'exporting changes nothing',
  );

  // A copy made with Duplicate is no kept version.
  const duplicated = await edition.request<Created>('/api/duplicate-profile', {
    saveId: created.saveId,
    profileId: B,
  });
  assert.equal((await find(duplicated.profileId)).backupOf, undefined);
}

// The Docker edition on a fresh data directory, and what it stored.
async function dockerEdition(
  dir: string,
): Promise<{ edition: Edition; close: () => Promise<void> }> {
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const send = (route: string, body?: unknown, headers: Headers = {}) =>
    fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    edition: {
      async request<T>(route: string, body?: unknown, headers?: Headers) {
        const response = await send(route, body, headers);
        assert.ok(response.ok, route + ' ' + (await response.clone().text()));
        return (await response.json()) as T;
      },
      async refused(route, body, headers) {
        const response = await send(route, body, headers);
        return {
          status: response.status,
          error: ((await response.json()) as { error: string }).error,
        };
      },
      async saves() {
        const file = JSON.parse(
          await fs.readFile(path.join(dir, 'workspace.json'), 'utf8'),
        ) as WorkspaceFile;
        return file.saves;
      },
    },
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

// The browser edition over `store` (an in-memory one by default).
function browserEdition(
  api: ReturnType<typeof createBrowserApi>,
  saves: () => BrowserWorkspace['saves'],
): Edition {
  const call = (route: string, body?: unknown, headers?: Headers) =>
    api(route, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(headers ? { headers } : {}),
    });
  return {
    request: async <T>(route: string, body?: unknown, headers?: Headers) =>
      (await call(route, body, headers)) as T,
    async refused(route, body, headers) {
      try {
        await call(route, body, headers);
      } catch (error) {
        return {
          status: (error as { status?: number }).status ?? 0,
          error: (error as Error).message,
        };
      }
      return { status: 200, error: '' };
    },
    saves: async () => structuredClone(saves()),
  };
}
// An in-memory store with the IndexedDB store's transaction semantics.
function memoryStore() {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  return {
    data: () => data,
    store: {
      async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
        const copy = structuredClone(data);
        if (!change) return copy as T;
        const result = change(copy);
        data = copy;
        return structuredClone(result);
      },
    },
  };
}

test('the Docker server restores a kept version into the profile and back again', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-restore-'));
  const { edition, close } = await dockerEdition(dir);
  try {
    await restoreTwice(edition);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition restores a kept version into the profile and back again', async () => {
  const memory = memoryStore();
  const api = createBrowserApi(memory.store, calculate, catalog());
  await restoreTwice(browserEdition(api, () => memory.data().saves));
});

test('the swap and its refusals, shared by both editions', () => {
  const plan = (createdAt: string) => ({ createdAt });
  const profile = (id: string, createdAt: string, extra: object = {}) =>
    ({
      id,
      name: id,
      kind: 'calculated',
      plan: plan(createdAt),
      state: { revision: id === 'b' ? 7 : 3, checks: { [id]: true } },
      ...extra,
    }) as StoredProfile;
  const request = { into: 'p', planCreatedAt: 'new', backupPlanCreatedAt: 'old' };
  const p = profile('p', 'new', { backupOf: 'q' }),
    b = profile('b', 'old', { backupOf: 'p', payoff: { planCreatedAt: 'old' } });
  assert.equal(restoreTarget([p, b], b), 'p');
  assert.equal(restoreTarget([b], b), undefined, 'a link to a profile that is gone');
  assert.equal(restoreTarget([p, b], { id: 'p', backupOf: 'p' }), undefined, 'a link to itself');
  assert.equal(restoreTarget([p, b], { id: 'x', backupOf: 4 }), undefined);
  assert.throws(() => checkRestore([b], b, { into: 'p' }), { message: restoreTargetGone });
  const plainProfile = profile('x', 'x');
  assert.throws(() => checkRestore([p, b, plainProfile], plainProfile, {}), {
    message: notAKeptVersion,
  });
  assert.throws(() => checkRestore([p, b], b, { ...request, planCreatedAt: 'older' }), {
    message: restoreStale,
  });
  assert.equal(checkRestore([p, b], b, request), p);
  const { restored, kept } = restoredVersions(p, b, 'p (before restore)');
  assert.deepEqual(restored, {
    id: 'p',
    name: 'p',
    kind: 'calculated',
    plan: plan('old'),
    state: { revision: 8, checks: { b: true } },
    payoff: { planCreatedAt: 'old' },
    backupOf: 'q',
  });
  assert.deepEqual(kept, {
    id: 'b',
    name: 'p (before restore)',
    kind: 'calculated',
    plan: plan('new'),
    state: { revision: 8, checks: { p: true } },
    backupOf: 'p',
  });
  assert.equal(p.state.revision, 3, 'the inputs are not changed');
});

// Saves from before the link: the oldest export, and a backup a recalculation in place kept
// before this release (an ordinary profile without backupOf), on the Docker server and in the
// browser edition's IndexedDB.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const oldExport = () => JSON.parse(read('./fixtures/export-2026-09-13.json')) as SaveExport;
// An export without its date and ids, to compare two exports of the same saves.
const comparable = (exported: SaveExport) =>
  exported.saves.map(save => ({
    name: save.name,
    profiles: save.profiles.map(({ id: _id, ...profile }) => ({
      ...profile,
      state: { ...profile.state, revision: 0 },
    })),
  }));

test('saves from before the link load, export and import unchanged, with no restore offered', async () => {
  // The browser edition: the oldest export, migrated on the way into IndexedDB.
  const migration = {
    recipes: (JSON.parse(read('../recipes.json')) as { recipes: Recipe[] }).recipes,
    pureLimits: catalog().pureLimits,
  };
  const records = new Map<string, unknown>();
  const load = async () => migration;
  const api = createBrowserApi(
    openBrowserStore(fakeIndexedDB(0, records), undefined, load),
    calculate,
    catalog(),
    undefined,
    load,
  );
  const browser = browserEdition(api, () => (records.get('main') as BrowserWorkspace).saves);
  await browser.request('/api/workspace');
  await browser.request('/api/import-saves', oldExport());
  const summary = await browser.request<WorkspaceSummary>('/api/workspace');
  assert.ok(
    summary.saves[0]!.profiles.every(p => p.backupOf === undefined),
    'no restore',
  );
  const stored = await browser.saves();
  assert.ok(
    stored[0]!.profiles.every(p => !('backupOf' in p)),
    'no link is stored',
  );
  const exported = await browser.request<SaveExport>('/api/export-saves');
  assert.ok(exported.saves[0]!.profiles.every(p => !('backupOf' in p)));
  await browser.request('/api/import-saves', exported);
  const again = await browser.request<SaveExport>('/api/export-saves');
  assert.deepEqual(comparable(again).at(-1), comparable(exported)[0], 'imports unchanged');

  // The Docker server: a recalculation in place as the release before this one stored it (the
  // kept version without a link) loads, lists no restore, refuses one and exports unchanged.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-restore-old-'));
  let docker = await dockerEdition(dir);
  try {
    const created = await docker.edition.request<Created>('/api/profiles', {
      saveName: 'World',
      name: 'Minimal',
      settings: SETTINGS,
    });
    const scope = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const context = await docker.edition.request<ContextReply>('/api/context', undefined, scope);
    const done = await docker.edition.request<Recalculated>(
      '/api/recalculate',
      {
        name: 'Minimal',
        backupName: 'Minimal (before edit)',
        settings: EDITED,
        planCreatedAt: context.plan!.createdAt,
      },
      scope,
    );
    await docker.close();
    const file = path.join(dir, 'workspace.json');
    const workspace = JSON.parse(await fs.readFile(file, 'utf8')) as WorkspaceFile;
    delete workspace.saves[0]!.profiles[1]!.backupOf;
    await fs.writeFile(file, JSON.stringify(workspace));
    docker = await dockerEdition(dir);
    const cards = (await docker.edition.request<WorkspaceSummary>('/api/workspace')).saves[0]!
      .profiles;
    assert.deepEqual(
      cards.map(card => card.backupOf),
      [undefined, undefined],
      'a backup kept before the link offers no restore',
    );
    const before = await docker.edition.saves();
    const refused = await docker.edition.refused(
      '/api/restore-version',
      {
        into: created.profileId,
        planCreatedAt: 'any',
        backupPlanCreatedAt: 'any',
        backupName: 'X',
      },
      { 'X-Save-Id': created.saveId, 'X-Profile-Id': done.backupId },
    );
    assert.deepEqual(refused, { status: 404, error: notAKeptVersion });
    assert.deepEqual(await docker.edition.saves(), before, 'nothing is written');
    const exported = await docker.edition.request<SaveExport>('/api/export-saves');
    assert.ok(exported.saves[0]!.profiles.every(p => !('backupOf' in p)));
    await docker.edition.request('/api/import-saves', exported);
    const reimported = await docker.edition.request<SaveExport>('/api/export-saves');
    assert.deepEqual(comparable(reimported)[1], comparable(exported)[0], 'imports unchanged');
    // The oldest export imports into the server too, with no link.
    await docker.edition.request('/api/import-saves', oldExport());
    assert.ok(
      (await docker.edition.saves()).at(-1)!.profiles.every(p => !('backupOf' in p)),
      'the oldest export has no link',
    );
  } finally {
    await docker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the link is optional and additive in a full export; a damaged one is left out, not refused', () => {
  const exported = oldExport();
  const plain = validateTransfer(exported);
  assert.ok(
    plain.saves[0]!.profiles.every(p => !('backupOf' in p)),
    'absent from older exports',
  );
  // A copy of the export's profile, linked to it: the link is the only difference.
  const save = exported.saves[0]!;
  const original = save.profiles[0]!;
  save.profiles.push({ ...structuredClone(original), id: 'kept', backupOf: original.id });
  const linked = validateTransfer(exported).saves[0]!.profiles;
  assert.equal(linked[1]!.backupOf, original.id);
  const { backupOf: _link, ...unlinked } = linked[1]!;
  assert.deepEqual({ ...unlinked, id: original.id }, plain.saves[0]!.profiles[0]);
  // Damaged links: a number, one to itself, one to a profile not in the save.
  for (const backupOf of [4, 'kept', 'elsewhere']) {
    save.profiles[1] = { ...save.profiles[1]!, backupOf } as SaveExport['saves'][0]['profiles'][0];
    const checked = validateTransfer(exported).saves[0]!.profiles[1]!;
    assert.equal('backupOf' in checked, false, String(backupOf));
  }
});
