// The built-machines counter (#1300): a production line's card, dialog and build-plan step count
// the machines built on it ("Built 41 / 58"). The count is saved by the builtCount update in the
// same `builtMachines` a carry keeps a grown line's machines in (state version 19, #1174), so no
// new state version: a counted line unticked is partly built exactly as a grown one is, a ticked
// one has all its machines and keeps its count for an untick, a later carry and a recalculation
// in place keep the count (and say so when the line's machines changed), and the next phase's
// handover starts from the counted machines. Profiles without counts load unchanged, and both
// editions keep the count through a reload, a full export and import and a progress backup, and
// leave it out of a share.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate } from '../planner.ts';
import {
  initialState,
  mutate,
  newProfileState,
  recalculatedProfile,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import {
  builtLine,
  countShare,
  countUpdate,
  countWords,
  counterTop,
  groupCount,
  groupCountText,
  countOfLine,
  recountedText,
} from '../public/app/built-lines.ts';
import {
  carriedLine,
  carriedMachinesText,
  carriedText,
  handoverLines,
  phaseCarry,
} from '../public/app/handover.ts';
import { tickStamped } from '../public/app/ticked-by.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version19 } from './types/fixtures.ts';
import type {
  CalcRow,
  Catalog,
  ContextReply,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const REFINERY = 'Recipe_ResidualFuel_C';
const KEY = 'calc-4-' + REFINERY;
const base = calculate({});
const row4 = base.stages['4'].rows!.find(row => row.id === REFINERY)!;

test('the default plan builds 5 Refineries for Residual Fuel in Phase 4', () => {
  assert.equal(row4.machines, 5);
});

test('builtCount saves the count in builtMachines, version 19, and 0 forgets it', () => {
  const blank = validateState(initialState());
  const counted = mutate(structuredClone(blank), { type: 'builtCount', key: KEY, value: 3 });
  assert.deepEqual(counted.builtMachines, { [KEY]: 3 });
  assert.equal(counted.version, 19, 'the version a grown line has, no new one');
  assert.equal(counted.checks[KEY], undefined, 'counting alone ticks nothing');
  // The same meaning as a grown line: unticked with fewer than it needs, it is partly built.
  assert.deepEqual(builtLine(counted.builtMachines, counted.checks, '4', row4), {
    built: 3,
    needed: 5,
    add: 2,
  });
  const again = mutate(structuredClone(counted), { type: 'builtCount', key: KEY, value: 4 });
  assert.deepEqual(again.builtMachines, { [KEY]: 4 });
  for (const value of [0, null]) {
    const cleared = mutate(structuredClone(again), { type: 'builtCount', key: KEY, value });
    assert.equal(cleared.builtMachines, undefined);
    assert.deepEqual(cleared, { ...blank, revision: cleared.revision }, 'back to the blank state');
  }
  // Another line's count stays.
  const two = mutate(structuredClone(again), {
    type: 'builtCount',
    key: 'calc-4-Recipe_IngotIron_C',
    value: 2,
  });
  const one = mutate(structuredClone(two), { type: 'builtCount', key: KEY, value: null });
  assert.deepEqual(one.builtMachines, { 'calc-4-Recipe_IngotIron_C': 2 });
});

test('builtCount refuses what is no count of a production line', () => {
  const blank = validateState(initialState());
  const bad = [
    { key: 'unlock-x', value: 1 },
    { key: 'calc-6-x', value: 1 },
    { key: 'calc-4-', value: 1 },
    { key: KEY, value: -1 },
    { key: KEY, value: 1.5 },
    { key: KEY, value: '3' },
    { key: KEY, value: 100001 },
    { key: KEY, value: 3, running: 'yes' },
    { key: 5, value: 3 },
  ];
  for (const update of bad)
    assert.throws(
      () => mutate(structuredClone(blank), { type: 'builtCount', ...update } as never),
      /Invalid count of built machines\./,
      JSON.stringify(update),
    );
});

test('the full count ticks the line in the same write, with who ticked it, and an untick keeps the count', () => {
  const blank = validateState(initialState());
  const op = tickStamped(
    { type: 'builtCount', key: KEY, value: 5, running: true },
    new Date('2026-11-04T10:00:00.000Z'),
  );
  assert.equal(op.type === 'builtCount' && op.ticked?.at, '2026-11-04T10:00:00.000Z');
  const full = mutate(structuredClone(blank), op);
  assert.equal(full.checks[KEY], true);
  assert.deepEqual(full.builtMachines, { [KEY]: 5 });
  assert.equal(full.tickedBy?.[KEY]?.at, '2026-11-04T10:00:00.000Z');
  // Unticking Running is an ordinary check: the count stays.
  const unticked = mutate(structuredClone(full), { type: 'check', key: KEY, value: false });
  assert.equal(unticked.checks[KEY], false);
  assert.deepEqual(unticked.builtMachines, { [KEY]: 5 });
  assert.equal(unticked.tickedBy, undefined);
  // Counting a ticked line below its machines unticks it.
  const lower = mutate(structuredClone(full), {
    type: 'builtCount',
    key: KEY,
    value: 4,
    running: false,
  });
  assert.equal(lower.checks[KEY], false);
  assert.deepEqual(lower.builtMachines, { [KEY]: 4 });
  // A tick by hand with a count below the line's keeps the count for the untick.
  const partly = mutate(structuredClone(blank), { type: 'builtCount', key: KEY, value: 3 });
  const ticked = mutate(structuredClone(partly), { type: 'check', key: KEY, value: true });
  assert.deepEqual(ticked.builtMachines, { [KEY]: 3 });
  assert.equal(countOfLine(ticked.builtMachines, ticked.checks, '4', row4).built, 5);
  const back = mutate(structuredClone(ticked), { type: 'check', key: KEY, value: false });
  assert.equal(countOfLine(back.builtMachines, back.checks, '4', row4).built, 3);
});

test('countOfLine and countUpdate: clamped whole counts, the tick at the top and the untick below it', () => {
  const none = countOfLine(undefined, {}, '4', row4);
  assert.deepEqual(none, { built: 0, needed: 5, floor: 0, ticked: false });
  assert.deepEqual(countUpdate(none, KEY, 1), { type: 'builtCount', key: KEY, value: 1 });
  assert.deepEqual(countUpdate(none, KEY, 2.4), { type: 'builtCount', key: KEY, value: 2 });
  assert.deepEqual(countUpdate(none, KEY, 99), {
    type: 'builtCount',
    key: KEY,
    value: 5,
    running: true,
  });
  assert.equal(countUpdate(none, KEY, -3), null, 'clamped to 0, which it is already');
  assert.equal(countUpdate(none, KEY, NaN), null);
  const three = countOfLine({ [KEY]: 3 }, {}, '4', row4);
  assert.equal(three.built, 3);
  assert.deepEqual(countUpdate(three, KEY, 0), { type: 'builtCount', key: KEY, value: null });
  assert.equal(countUpdate(three, KEY, 3), null);
  assert.equal(countWords(three, 'Refinery'), '3 of 5 Refineries built');
  assert.equal(countShare(three), 0.6);
  // Ticked: all of them stand, whatever the count; a lower count unticks.
  const ticked = countOfLine({ [KEY]: 3 }, { [KEY]: true }, '4', row4);
  assert.deepEqual(ticked, { built: 5, needed: 5, floor: 0, ticked: true });
  assert.equal(countUpdate(ticked, KEY, 5), null);
  assert.deepEqual(countUpdate(ticked, KEY, 4), {
    type: 'builtCount',
    key: KEY,
    value: 4,
    running: false,
  });
  // A spare count (more than the line needs, from a carry or a shrunk plan, #1305) is shown as it is,
  // ticked or not: 8 / 5. The counter goes down to the plan and back up to what stands, never
  // above it, and counting it down keeps the rest spare.
  const spare = countOfLine({ [KEY]: 8 }, {}, '4', row4);
  assert.deepEqual(spare, { built: 8, needed: 5, floor: 0, ticked: false });
  assert.equal(countOfLine({ [KEY]: 8 }, { [KEY]: true }, '4', row4).built, 8);
  assert.equal(counterTop(spare), 8);
  assert.equal(counterTop(three), 5);
  assert.deepEqual(countUpdate(spare, KEY, 7), { type: 'builtCount', key: KEY, value: 7 });
  assert.equal(countUpdate(spare, KEY, 99), null, 'no more than stands');
  assert.deepEqual(countUpdate(spare, KEY, 5), {
    type: 'builtCount',
    key: KEY,
    value: 5,
    running: true,
  });
  assert.equal(countWords(spare, 'Refinery'), '8 Refineries built, 5 needed: 3 spare');
  assert.equal(countShare(spare), 1);
  // A spare line adds no more than its plan to a factory's count.
  assert.deepEqual(
    groupCount(
      [row4],
      () => spare,
      () => 1,
    ),
    { built: 5, needed: 5 },
  );
  // The machines the phase before hands over are the lowest count, and are not stored again.
  const carried = countOfLine(undefined, {}, '4', row4, 2);
  assert.deepEqual(carried, { built: 2, needed: 5, floor: 2, ticked: false });
  assert.equal(countUpdate(carried, KEY, 0), null, 'clamped to the 2 handed over');
  assert.deepEqual(countUpdate(carried, KEY, 3), { type: 'builtCount', key: KEY, value: 3 });
  const above = countOfLine({ [KEY]: 3 }, {}, '4', row4, 2);
  assert.deepEqual(countUpdate(above, KEY, 2), { type: 'builtCount', key: KEY, value: null });
});

test('a factory heading counts its lines by their share: "312 / 641 machines built"', () => {
  const rows = [
    { ...row4, id: 'a', machines: 10 },
    { ...row4, id: 'b', machines: 6 },
    { ...row4, id: 'c', machines: 4 },
  ] as CalcRow[];
  const counts: Record<string, number> = { a: 10, b: 3, c: 4 };
  const total = groupCount(
    rows,
    row => ({ built: counts[row.id]!, needed: row.machines, floor: 0, ticked: false }),
    row => (row.id === 'c' ? 0.5 : row.id === 'b' ? 1 : 1),
  );
  assert.deepEqual(total, { built: 15, needed: 18 });
  assert.equal(groupCountText(total), '15 / 18 machines built');
  assert.equal(groupCountText({ built: 640.6, needed: 641 }), '640 / 641 machines built');
  assert.equal(groupCountText({ built: 641, needed: 641 }), '641 / 641 machines built');
  assert.equal(groupCountText({ built: 0, needed: 1 }), '0 / 1 machine built');
});

// A line of the default plan that Phases 3 and 4 both build, for the handover.
const both = base.stages['4'].rows!.find(
  row => row.machines > 2 && base.stages['3'].rows?.some(earlier => earlier.id === row.id),
)!;
const earlier = base.stages['3'].rows!.find(row => row.id === both.id)!;
const plan3: Pick<StoredCalculatedPlan, 'settings' | 'stages' | 'guide'> = {
  ...base,
  settings: { ...base.settings, phase: '3' },
};

test('the handover starts from a line the phase before left partly built', () => {
  assert.ok(both && earlier.machines >= 2, 'a line Phases 3 and 4 both build');
  const key3 = 'calc-3-' + both.id;
  // Without a tick or a count nothing is handed over, as before.
  assert.equal(carriedLine(plan3, {}, '4', both.id), null);
  assert.equal(carriedLine(plan3, {}, '4', both.id, {}), null);
  // Ticked, the whole line, as before.
  assert.deepEqual(carriedLine(plan3, { [key3]: true }, '4', both.id, { [key3]: 1 }), {
    from: '3',
    before: earlier,
  });
  // Counted, not ticked: the counted machines.
  const partly = carriedLine(plan3, {}, '4', both.id, { [key3]: 1 })!;
  assert.equal(partly.partly, true);
  assert.equal(partly.before.machines, 1);
  assert.equal(partly.before.equivalent, 1);
  assert.match(carriedText(partly, both), new RegExp(`^Built in Phase 3: 1 × ${earlier.machine}`));
  assert.match(carriedMachinesText(partly, both), /^Built in Phase 3: 1 of /);
  const carry = phaseCarry(plan3, {}, '4', { [key3]: 1 })!;
  assert.ok(carry.shares.get(both.id)! > 0 && carry.shares.get(both.id)! < 1);
  const lines = handoverLines(plan3, {}, '4', { [key3]: 1 })!;
  assert.equal(lines.lines.find(line => line.row.id === both.id)!.status, 'add');
  // All its machines counted, not ticked yet: handed over whole.
  assert.deepEqual(carriedLine(plan3, {}, '4', both.id, { [key3]: earlier.machines }), {
    from: '3',
    before: earlier,
  });
  // The next phase's counter starts from them.
  const count = countOfLine(undefined, {}, '4', both, partly.before.machines);
  assert.equal(count.built, 1);
  assert.equal(count.floor, 1);
});

// The default plan with Phase 4's Residual Fuel line at `machines` Refineries.
const planWith = (machines: number): StoredCalculatedPlan => {
  const plan = structuredClone(base);
  const row = plan.stages['4'].rows!.find(candidate => candidate.id === REFINERY)!;
  row.machines = machines;
  row.equivalent = machines;
  row.lastClock = 100;
  return plan;
};

test('a recalculation in place keeps a counted line and says when its machines changed', () => {
  const state = initialState();
  state.builtMachines = { [KEY]: 3 };
  const previous: StoredProfile = {
    id: 'p',
    name: 'Counted',
    kind: 'calculated',
    plan: planWith(5),
    state: validateState(state),
  };
  const done = recalculatedProfile(
    previous,
    planWith(6),
    'Counted',
    undefined,
    undefined,
    'b',
    'B',
  );
  assert.deepEqual(done.profile.state.builtMachines, { [KEY]: 3 });
  assert.notEqual(done.profile.state.checks[KEY], true);
  assert.deepEqual(done.recounted, [{ name: row4.name, built: 3, needed: 6 }]);
  assert.equal(done.reviewCount, 0);
  assert.deepEqual(done.backup.state.builtMachines, { [KEY]: 3 }, 'the backup keeps it too');
  assert.equal(recountedText(done.recounted), `${row4.name} keeps its count: 3 built, 6 needed.`);
  // The same machine count says nothing; a plan that needs no more than stand ticks it (#1181).
  const same = recalculatedProfile(
    previous,
    planWith(5),
    'Counted',
    undefined,
    undefined,
    'b',
    'B',
  );
  assert.deepEqual(same.recounted, []);
  assert.deepEqual(same.profile.state.builtMachines, { [KEY]: 3 });
  const fewer = recalculatedProfile(
    previous,
    planWith(3),
    'Counted',
    undefined,
    undefined,
    'b',
    'B',
  );
  assert.equal(fewer.profile.state.checks[KEY], true);
  assert.deepEqual(fewer.recounted, []);
  // A new profile carried from it keeps the count the same way.
  const carried = newProfileState(planWith(6), previous.state, previous.plan, undefined, undefined);
  assert.deepEqual(carried.state.builtMachines, { [KEY]: 3 });
  assert.equal(carried.recounted.length, 1);
  // A share leaves it out with the rest of the progress.
  assert.equal(shareState(previous.state).builtMachines, undefined);
});

test('the toast names two recounted lines and counts the rest', () => {
  assert.equal(recountedText([]), '');
  assert.equal(
    recountedText([
      { name: 'Rubber', built: 41, needed: 58 },
      { name: 'Plastic', built: 10, needed: 12 },
      { name: 'Fuel', built: 1, needed: 2 },
    ]),
    '3 partly built production lines keep their counts: Rubber 41 built, 58 needed; Plastic 10 built, 12 needed; and 1 more.',
  );
});

test('profiles without counts load unchanged, and an old grown count reads as a counted one', () => {
  for (const [state] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, (state as { version?: number }).version ?? 1);
    assert.deepEqual(
      clean.builtMachines,
      (state as { builtMachines?: Record<string, number> }).builtMachines,
    );
  }
  const grown = validateState(json(version19));
  assert.equal(grown.version, 19);
  for (const [key, count] of Object.entries(grown.builtMachines || {})) {
    const parts = /^calc-([1-5])-(.+)$/.exec(key)!;
    const row = { id: parts[2]!, machines: count + 1 };
    assert.equal(countOfLine(grown.builtMachines, {}, parts[1]!, row).built, count);
  }
});

// Both editions, through their own API: count a line, reload, export, import, back up and restore
// its progress, share it, and recalculate it in place.
type Request = (
  route: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<unknown>;
async function checkEdition(request: Request, reload: () => Promise<void>) {
  const scoped = (saveId: string, profileId: string) => ({
    'X-Save-Id': saveId,
    'X-Profile-Id': profileId,
  });
  const context = async (headers: Record<string, string>) =>
    (await request('/api/context', undefined, headers)) as ContextReply;
  const first = (await request('/api/profiles', {
    saveName: 'World',
    name: 'Counted',
    settings: {},
  })) as { saveId: string; profileId: string };
  const own = scoped(first.saveId, first.profileId);
  const blank = await context(own);
  assert.equal(blank.state.builtMachines, undefined);
  await request('/api/update', { type: 'builtCount', key: KEY, value: 3 }, own);
  await reload();
  let now = await context(own);
  assert.deepEqual(now.state.builtMachines, { [KEY]: 3 });
  assert.equal(now.state.version, 19);
  assert.equal(now.state.checks[KEY], undefined);

  // The full count ticks it, an untick keeps the count.
  await request('/api/update', { type: 'builtCount', key: KEY, value: 5, running: true }, own);
  now = await context(own);
  assert.equal(now.state.checks[KEY], true);
  assert.deepEqual(now.state.builtMachines, { [KEY]: 5 });
  await request('/api/update', { type: 'check', key: KEY, value: false }, own);
  await request('/api/update', { type: 'builtCount', key: KEY, value: 3 }, own);
  now = await context(own);
  assert.equal(now.state.checks[KEY], false);
  assert.deepEqual(now.state.builtMachines, { [KEY]: 3 });

  // A progress backup restores it.
  const backup = { format: 'satisfactory-planner-backup', state: json(now.state) };
  await request('/api/update', { type: 'builtCount', key: KEY, value: null }, own);
  assert.equal((await context(own)).state.builtMachines, undefined);
  await request('/api/import', backup, own);
  assert.deepEqual((await context(own)).state.builtMachines, { [KEY]: 3 });

  // A full export keeps it, and its import makes a copy that keeps it; a share leaves it out.
  const exported = (await request('/api/export-saves')) as SaveExport;
  assert.deepEqual(validateTransfer(exported).saves[0]!.profiles[0]!.state.builtMachines, {
    [KEY]: 3,
  });
  await request('/api/import-saves', exported);
  await reload();
  const all = (await request('/api/export-saves')) as SaveExport;
  const copies = all.saves
    .flatMap(save => save.profiles)
    .filter(profile => profile.name === 'Counted');
  assert.equal(copies.length, 2);
  for (const copy of copies) assert.deepEqual(copy.state.builtMachines, { [KEY]: 3 });
  const share = (await request(
    `/api/export-saves?save=${first.saveId}&profile=${first.profileId}&share=1`,
  )) as SaveExport;
  assert.equal(share.saves[0]!.profiles[0]!.state.builtMachines, undefined);

  // Recalculated in place with a plan that needs more: the count stays and the reply says so.
  const done = (await request(
    '/api/recalculate',
    {
      name: 'Counted',
      backupName: 'Counted (before edit)',
      settings: { storageRate: 5 },
      planCreatedAt: now.plan!.createdAt,
    },
    own,
  )) as { recounted?: { name: string; built: number; needed: number }[] };
  await reload();
  const after = await context(own);
  const needed = after.plan!.stages['4']!.rows!.find(row => row.id === REFINERY)!.machines;
  assert.ok(needed > 5, 'the new plan needs more Refineries');
  assert.deepEqual(after.state.builtMachines, { [KEY]: 3 });
  assert.deepEqual(done.recounted, [{ name: row4.name, built: 3, needed }]);
}

test('the Docker server keeps a counted line through reload, export, import and backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-1300-'));
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  let url = '';
  const listen = async () => {
    server = await createApp({ dataDir: dir, password: '' });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise<void>(resolve => server!.close(() => resolve()));
  const request: Request = async (route, body, headers = {}) => {
    const res = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
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
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps a counted line through reload, export, import and backup', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      {} as Catalog,
    );
  let api = open();
  await checkEdition(
    (route, body, headers) =>
      api(route, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(headers ? { headers } : {}),
      }),
    async () => {
      api = open();
    },
  );
});
