// The "Rename to …" offer (#1071) for profiles still named after their goal alone, as every
// profile created before #1105 without a typed name is. Which names count, the name offered (goal,
// up to two changes from a new save's defaults, the plan's date) and how two equal offers are
// numbered; then the stored half in both editions: nothing is written until the user acts,
// accepting is an ordinary rename, and dismissing stores the optional profile field
// `renameOfferDismissed`, which round-trips a full export and import, stays with the profile's
// name through a recalculation in place and a restore, and is left behind by Duplicate. Saves from
// before it (the oldest export, a workspace written by the release before) load, export and
// import unchanged, without the field.
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
import { nameDate, renameOffers } from '../public/app/profile-edit.ts';
import type {
  BrowserWorkspace,
  ContextReply,
  Recipe,
  SaveExport,
  StoredProfile,
  WorkspaceFile,
  WorkspaceSummary,
} from '../public/types/index.ts';

const goals = catalog().goals;
const DAY = '2026-10-07T12:00:00.000Z';
const day = nameDate(new Date(DAY));
// A new save's settings (freshSettings in app/wizard/wizard.ts), for the fields a name reads.
const FRESH = {
  goal: 'balanced',
  phase: '1',
  purity: 'vanilla',
  multiplier: 1,
  powerFactor: 1,
  recipes: 'standard',
  wholeMachines: true,
};
const card = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  settings: FRESH,
  planCreatedAt: DAY,
  ...extra,
});

test('only a goal’s own name counts as the default name, and a dismissed offer is not made', () => {
  const offered = (name: string, extra: object = {}) =>
    renameOffers([card('p', name, extra)], goals).get('p');
  // The four goals' names, the names a profile got before #1105 when none was typed.
  for (const goal of goals) assert.ok(offered(goal.name), goal.name);
  assert.deepEqual(
    goals.map(goal => goal.name),
    [
      'Minimal construction',
      'Balanced progression',
      'Target completion time',
      'Maximum elevator output',
    ],
  );
  // Any other name is the user's (or already descriptive), so it gets no offer.
  for (const name of [
    'My base',
    'Balanced progression · copy',
    'Balanced progression · whole machines',
    'Balanced progression · exact ratios · ' + day,
    'Balanced progression (before edit, Oct 7, 2:05 PM)',
    'balanced progression',
    'Balanced',
    'Original · 50× complete automation',
  ])
    assert.equal(offered(name), undefined, name);
  assert.equal(offered('Balanced progression', { renameOfferDismissed: true }), undefined);
  assert.equal(offered('Balanced progression', { settings: undefined }), undefined, 'no plan');
});

test('the offered name: goal, up to two changes from a new save’s defaults, the plan’s date', () => {
  const offer = (settings: object, extra: object = {}) =>
    renameOffers([card('p', 'Balanced progression', { settings, ...extra })], goals).get('p');
  assert.equal(offer(FRESH), 'Balanced progression · ' + day);
  assert.equal(
    offer({ ...FRESH, wholeMachines: false, phase: '3' }),
    'Balanced progression · exact ratios · from Phase 3 · ' + day,
  );
  assert.equal(
    offer({ ...FRESH, goal: 'minimal', recipes: 'all', purity: 'pure', multiplier: 5 }),
    'Minimal construction · all alternates · All Pure purity · ' + day,
    'at most two changes',
  );
  // An edit in place may have changed the goal and kept the name: the offer names the goal the
  // plan has.
  assert.equal(
    offer({ ...FRESH, goal: 'timed' }),
    'Target completion time · ' + day,
    'named after the plan’s goal',
  );
  // The day the plan was made; today when the summary has none or it is no date.
  const today = 'Balanced progression · ' + nameDate(new Date());
  assert.equal(offer(FRESH, { planCreatedAt: undefined }), today);
  assert.equal(offer(FRESH, { planCreatedAt: 'not a date' }), today);
});

test('equal offers are numbered in card order, past every name the save has', () => {
  const four = ['a', 'b', 'c', 'd'].map(id => card(id, 'Balanced progression'));
  const name = 'Balanced progression · ' + day;
  assert.deepEqual(
    [...renameOffers(four, goals).values()],
    [name, name + ' · 2', name + ' · 3', name + ' · 4'],
  );
  // One already renamed to the first name: the others start at · 2.
  const offers = renameOffers([card('x', name), ...four.slice(1)], goals);
  assert.deepEqual([...offers.keys()], ['b', 'c', 'd']);
  assert.deepEqual([...offers.values()], [name + ' · 2', name + ' · 3', name + ' · 4']);
  // A dismissed card takes no number.
  const dismissed = renameOffers(
    [card('a', 'Balanced progression', { renameOfferDismissed: true }), ...four.slice(1)],
    goals,
  );
  assert.deepEqual([...dismissed.values()], [name, name + ' · 2', name + ' · 3']);
  // A long name stays within the 80 characters a name may have, the number kept.
  const long = { ...FRESH, goal: 'maximum', wholeMachines: false, phase: '4', multiplier: 25 };
  const two = renameOffers(
    [
      card('a', 'Maximum elevator output', { settings: long }),
      card('b', 'Maximum elevator output', { settings: long }),
    ],
    goals,
  );
  for (const offered of two.values()) assert.ok(offered.length <= 80, offered);
  assert.match(two.get('b')!, / · 2$/);
});

const SETTINGS = { phase: '1', goal: 'minimal' };
const EDITED = { phase: '1', goal: 'balanced' };
const UNLOCK = 'unlock-Schematic_1-1_C';

interface Created {
  saveId: string;
  profileId: string;
}
type Headers = Record<string, string>;
interface Edition {
  request: <T>(route: string, body?: unknown, headers?: Headers) => Promise<T>;
  saves: () => Promise<{ id: string; activeProfile: string; profiles: StoredProfile[] }[]>;
}
const without = <T extends object>(value: T, key: string) => {
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy[key];
  return copy;
};

// The offer's whole stored life, the same steps in both editions.
async function offerLife(edition: Edition) {
  const created = await edition.request<Created>('/api/profiles', {
    saveName: 'World',
    name: 'Minimal construction',
    settings: SETTINGS,
  });
  const other = await edition.request<Created>('/api/profiles', {
    saveId: created.saveId,
    name: 'Minimal construction',
    settings: SETTINGS,
  });
  const P = created.profileId,
    O = other.profileId;
  const scope = (profileId: string) => ({ 'X-Save-Id': created.saveId, 'X-Profile-Id': profileId });
  const stored = async () => (await edition.saves()).find(s => s.id === created.saveId)!.profiles;
  const find = async (id: string) => (await stored()).find(p => p.id === id)!;
  const cards = async () =>
    (await edition.request<WorkspaceSummary>('/api/workspace')).saves.find(
      s => s.id === created.saveId,
    )!.profiles;
  await edition.request('/api/update', { type: 'check', key: UNLOCK, value: true }, scope(P));

  // Nothing is stored before the user acts: the summary, which the offer is worked out from,
  // writes nothing, and no profile has the field.
  const before = await edition.saves();
  const listed = await cards();
  assert.deepEqual(await edition.saves(), before, 'reading the summary writes nothing');
  assert.ok(listed.every(p => !('renameOfferDismissed' in p)));
  assert.ok((await stored()).every(p => !('renameOfferDismissed' in p)));
  const offers = renameOffers(listed, goals);
  assert.deepEqual([...offers.keys()], [P, O], 'both cards are offered a name');
  assert.notEqual(offers.get(P), offers.get(O), 'numbered apart');

  // Accepting is the ordinary rename: the name changes, nothing else, and no flag is stored.
  const kept = await find(O);
  await edition.request('/api/rename', { target: 'profile', name: offers.get(O) }, scope(O));
  const renamed = await find(O);
  assert.equal(renamed.name, offers.get(O));
  assert.deepEqual(without(renamed, 'name'), without(kept, 'name'), 'only the name changed');
  assert.equal(renameOffers(await cards(), goals).has(O), false, 'no offer after accepting');

  // Dismissing stores the flag and only the flag; doing it again changes nothing.
  const plain = await find(P);
  const reply = await edition.request<WorkspaceSummary>('/api/dismiss-rename-offer', {}, scope(P));
  const dismissed = await find(P);
  assert.equal(dismissed.renameOfferDismissed, true);
  assert.deepEqual(without(dismissed, 'renameOfferDismissed'), plain, 'only the flag changed');
  assert.equal(
    reply.saves.find(s => s.id === created.saveId)!.profiles.find(p => p.id === P)!
      .renameOfferDismissed,
    true,
    'the reply lists it',
  );
  assert.equal((await find(O)).renameOfferDismissed, undefined, 'the other profile is untouched');
  assert.equal(renameOffers(await cards(), goals).size, 0, 'no offer after dismissing');
  const once = await edition.saves();
  await edition.request('/api/dismiss-rename-offer', {}, scope(P));
  assert.deepEqual(
    (await edition.saves()).map(s => s.profiles.map(p => without(p, 'state'))),
    once.map(s => s.profiles.map(p => without(p, 'state'))),
    'a second dismissal changes nothing',
  );

  // A full export keeps it, and so does the import, on the copy.
  const exported = await edition.request<SaveExport>('/api/export-saves');
  const exportedSave = exported.saves.find(s => s.id === created.saveId)!;
  assert.equal(exportedSave.profiles.find(p => p.id === P)!.renameOfferDismissed, true);
  assert.equal('renameOfferDismissed' in exportedSave.profiles.find(p => p.id === O)!, false);
  assert.equal(
    validateTransfer(exported).saves[0]!.profiles.find(p => p.id === P)!.renameOfferDismissed,
    true,
  );
  await edition.request('/api/import-saves', { ...exported, saves: [exportedSave] });
  const copy = (await edition.saves()).at(-1)!;
  assert.notEqual(copy.id, created.saveId);
  assert.deepEqual(
    copy.profiles.map(p => [p.name, p.renameOfferDismissed]),
    [
      ['Minimal construction', true],
      [offers.get(O), undefined],
    ],
    'the imported copy keeps the dismissal',
  );
  // A one-profile export keeps it too.
  const one = await edition.request<SaveExport>(
    '/api/export-saves?save=' + encodeURIComponent(created.saveId) + '&profile=' + P,
  );
  assert.equal(one.saves[0]!.profiles[0]!.renameOfferDismissed, true);

  // Duplicate leaves it behind: the copy has a name of its own.
  const duplicated = await edition.request<Created>('/api/duplicate-profile', {
    saveId: created.saveId,
    profileId: P,
  });
  assert.equal('renameOfferDismissed' in (await find(duplicated.profileId)), false);

  // A recalculation in place that keeps the name keeps the dismissal; its backup, named anew,
  // has none. A restore keeps it with the profile that keeps the name.
  const context = await edition.request<ContextReply>('/api/context', undefined, scope(P));
  const done = await edition.request<Created & { backupId: string }>(
    '/api/recalculate',
    {
      name: 'Minimal construction',
      backupName: 'Minimal construction (before edit)',
      settings: EDITED,
      planCreatedAt: context.plan!.createdAt,
    },
    scope(P),
  );
  assert.equal((await find(P)).renameOfferDismissed, true, 'kept through the recalculation');
  assert.equal('renameOfferDismissed' in (await find(done.backupId)), false, 'not on the backup');
  const edited = await edition.request<ContextReply>('/api/context', undefined, scope(P));
  const backup = await edition.request<ContextReply>(
    '/api/context',
    undefined,
    scope(done.backupId),
  );
  await edition.request(
    '/api/restore-version',
    {
      into: P,
      planCreatedAt: edited.plan!.createdAt,
      backupPlanCreatedAt: backup.plan!.createdAt,
      backupName: 'Minimal construction (before restore)',
    },
    scope(done.backupId),
  );
  assert.equal((await find(P)).renameOfferDismissed, true, 'kept through the restore');
  assert.equal((await find(P)).plan!.createdAt, context.plan!.createdAt, 'restored');
  assert.equal('renameOfferDismissed' in (await find(done.backupId)), false);
}

// The Docker edition on a fresh data directory, and what it stored.
async function dockerEdition(
  dir: string,
): Promise<{ edition: Edition; close: () => Promise<void> }> {
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    edition: {
      async request<T>(route: string, body?: unknown, headers: Headers = {}) {
        const response = await fetch(url + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.ok(response.ok, route + ' ' + (await response.clone().text()));
        return (await response.json()) as T;
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
function browserEdition(
  api: ReturnType<typeof createBrowserApi>,
  saves: () => BrowserWorkspace['saves'],
): Edition {
  return {
    request: async <T>(route: string, body?: unknown, headers?: Headers) =>
      (await api(route, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(headers ? { headers } : {}),
      })) as T,
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

test('the Docker server stores a dismissal only when asked, and keeps it where the name goes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rename-offer-'));
  const { edition, close } = await dockerEdition(dir);
  try {
    await offerLife(edition);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition stores a dismissal only when asked, and keeps it where the name goes', async () => {
  const memory = memoryStore();
  const api = createBrowserApi(memory.store, calculate, catalog());
  await offerLife(browserEdition(api, () => memory.data().saves));
});

test('a dismissal moves between the editions in a full export', async () => {
  const memory = memoryStore();
  const browser = browserEdition(
    createBrowserApi(memory.store, calculate, catalog()),
    () => memory.data().saves,
  );
  const created = await browser.request<Created>('/api/profiles', {
    saveName: 'World',
    name: 'Balanced progression',
    settings: EDITED,
  });
  await browser.request(
    '/api/dismiss-rename-offer',
    {},
    { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId },
  );
  const fromBrowser = await browser.request<SaveExport>('/api/export-saves');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rename-offer-move-'));
  const docker = await dockerEdition(dir);
  try {
    await docker.edition.request('/api/import-saves', fromBrowser);
    assert.equal((await docker.edition.saves())[0]!.profiles[0]!.renameOfferDismissed, true);
    const fromDocker = await docker.edition.request<SaveExport>('/api/export-saves');
    await browser.request('/api/import-saves', fromDocker);
    assert.equal((await browser.saves()).at(-1)!.profiles[0]!.renameOfferDismissed, true);
  } finally {
    await docker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Saves from before the field.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const oldExport = () => JSON.parse(read('./fixtures/export-2026-09-13.json')) as SaveExport;
const comparable = (exported: SaveExport) =>
  exported.saves.map(save => ({
    name: save.name,
    profiles: save.profiles.map(({ id: _id, ...profile }) => ({
      ...profile,
      state: { ...profile.state, revision: 0 },
    })),
  }));

test('saves from before the field load, validate, export and import unchanged, without it', async () => {
  assert.ok(
    validateTransfer(oldExport()).saves.every(save =>
      save.profiles.every(p => !('renameOfferDismissed' in p)),
    ),
    'the oldest export validates without it',
  );
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
  assert.ok(summary.saves[0]!.profiles.every(p => !('renameOfferDismissed' in p)));
  assert.ok((await browser.saves())[0]!.profiles.every(p => !('renameOfferDismissed' in p)));
  const exported = await browser.request<SaveExport>('/api/export-saves');
  assert.ok(exported.saves[0]!.profiles.every(p => !('renameOfferDismissed' in p)));
  await browser.request('/api/import-saves', exported);
  const again = await browser.request<SaveExport>('/api/export-saves');
  assert.deepEqual(comparable(again).at(-1), comparable(exported)[0], 'imports unchanged');

  // The Docker server: a workspace.json as the release before wrote it, with a profile named
  // after its goal, loads with the offer and nothing written, and exports and imports unchanged.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rename-offer-old-'));
  let docker = await dockerEdition(dir);
  try {
    await docker.edition.request<Created>('/api/profiles', {
      saveName: 'World',
      name: 'Balanced progression',
      settings: EDITED,
    });
    await docker.close();
    const file = path.join(dir, 'workspace.json');
    const written = await fs.readFile(file, 'utf8');
    assert.equal(written.includes('renameOfferDismissed'), false);
    docker = await dockerEdition(dir);
    const cards = (await docker.edition.request<WorkspaceSummary>('/api/workspace')).saves[0]!
      .profiles;
    assert.equal(renameOffers(cards, goals).size, 1, 'the old profile is offered a name');
    assert.equal(await fs.readFile(file, 'utf8'), written, 'loading writes nothing');
    const before = await docker.edition.request<SaveExport>('/api/export-saves');
    assert.ok(before.saves[0]!.profiles.every(p => !('renameOfferDismissed' in p)));
    await docker.edition.request('/api/import-saves', before);
    const after = await docker.edition.request<SaveExport>('/api/export-saves');
    assert.deepEqual(comparable(after)[1], comparable(before)[0], 'imports unchanged');
  } finally {
    await docker.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the field is optional in a full export; any value but true is left out, not refused', () => {
  const exported = oldExport();
  const plain = validateTransfer(exported);
  const save = exported.saves[0]!;
  save.profiles[0] = { ...save.profiles[0]!, renameOfferDismissed: true };
  const flagged = validateTransfer(exported).saves[0]!.profiles[0]!;
  assert.equal(flagged.renameOfferDismissed, true);
  assert.deepEqual(without(flagged, 'renameOfferDismissed'), plain.saves[0]!.profiles[0]);
  for (const value of [false, 'yes', 1, null, {}] as unknown[]) {
    save.profiles[0] = {
      ...save.profiles[0]!,
      renameOfferDismissed: value,
    } as SaveExport['saves'][0]['profiles'][0];
    const checked = validateTransfer(exported).saves[0]!.profiles[0]!;
    assert.equal('renameOfferDismissed' in checked, false, JSON.stringify(value));
  }
});
