// Co-op slice 3 (#1206, part of #1077): who ticked a step and when. A tick of a step not ticked
// yet keeps a record, `{ at, by? }` (by: the ticking device's "Your name", app/mine.ts), per check
// key in `tickedBy`; save() adds it to every update that ticks (tickStamped in app/ticked-by.ts),
// so a single tick and the bulk ticks ("Mark all running", an unlock group, a container) record the
// same who and when for each step. Unticking drops it, and a record is kept only while its step is
// ticked, so ticks made before have none. A state with a record is progress state version 21, and
// only while one exists. The co-op merge (#1160) carries the file's records, never the merging
// device's. Both editions: the Docker server (createApp, workspace.json) and the browser edition
// (createBrowserApi over openBrowserStore). The pages are in tests/ui/ticked-by.test.ts.
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
  recalculatedProfile,
  shareState,
  validateState,
} from '../public/state.ts';
import { validateTransfer } from '../public/transfer.ts';
import {
  mergeChunks,
  mergeUpdate,
  readProgressFile,
  ticksExport,
} from '../public/app/progress-merge.ts';
import { setMeName } from '../public/app/mine.ts';
import { tickStamp, tickStamped, tickedNote, tickedWords } from '../public/app/ticked-by.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { states, version21 } from './types/fixtures.ts';
import type {
  ProgressBackup,
  ProgressState,
  SaveExport,
  StoredCalculatedPlan,
  StoredProfile,
  TickRecord,
  UpdateOp,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// Midday in UTC, so the day is the same in every time zone the tests may run in.
const ANNA: TickRecord = { at: '2026-10-21T12:15:00.000Z', by: 'Anna' };
const BRAM: TickRecord = { at: '2026-10-20T12:40:00.000Z', by: 'Bram' };
const NAMELESS: TickRecord = { at: '2026-10-19T12:00:00.000Z' };
const tick = (key: string, ticked?: unknown): UpdateOp =>
  ({ type: 'check', key, value: true, ...(ticked ? { ticked } : {}) }) as UpdateOp;
const untick = (key: string): UpdateOp => ({ type: 'check', key, value: false });

test('a tick keeps who and when, reloads as it was, and unticking drops it', () => {
  let state = mutate(initialState(), tick('hub-1', { at: ANNA.at, by: '  Anna  ' }));
  assert.deepEqual(state.tickedBy, { 'hub-1': ANNA }, 'the name is kept trimmed');
  assert.equal(state.checks['hub-1'], true, 'the check means what it meant');
  assert.equal(state.version, 21);
  assert.deepEqual(validateState(json(state)), state, 'it loads again as it was');
  // A step already ticked keeps the record of its tick; another tick of it changes nothing.
  state = mutate(state, tick('hub-1', BRAM));
  assert.deepEqual(state.tickedBy, { 'hub-1': ANNA });
  // A tick without a record (an older page, a script) keeps none; a blank name is no name.
  state = mutate(state, tick('hub-2'));
  state = mutate(state, tick('hub-3', { at: NAMELESS.at, by: '   ' }));
  assert.equal(state.checks['hub-2'], true);
  assert.deepEqual(state.tickedBy, { 'hub-1': ANNA, 'hub-3': NAMELESS });
  // Unticking drops the record, and ticking it again records the new tick.
  state = mutate(state, untick('hub-1'));
  assert.deepEqual(state.tickedBy, { 'hub-3': NAMELESS });
  state = mutate(state, tick('hub-1', BRAM));
  assert.deepEqual(state.tickedBy!['hub-1'], BRAM);
  // The last record gone, version 21 goes with it.
  state = mutate(mutate(state, untick('hub-1')), untick('hub-3'));
  assert.equal('tickedBy' in state, false);
  assert.equal(state.version, 1);
});

test('bulk ticks record the same who and when for each step they tick', () => {
  let state = mutate(initialState(), tick('a', ANNA));
  state = mutate(state, { type: 'checks', keys: ['a', 'b', 'c'], value: true, ticked: BRAM });
  assert.deepEqual(state.tickedBy, { a: ANNA, b: BRAM, c: BRAM }, 'a was ticked already');
  // A merge's records per key win over the shared one; a key without one gets the shared one.
  state = mutate(state, {
    type: 'checks',
    keys: ['d', 'e'],
    value: true,
    ticked: NAMELESS,
    tickedBy: { d: ANNA },
  });
  assert.deepEqual(state.tickedBy!.d, ANNA);
  assert.deepEqual(state.tickedBy!.e, NAMELESS);
  // A merge sends `tickedBy` alone: a key it has no record for is ticked without one.
  state = mutate(state, { type: 'checks', keys: ['f', 'g'], value: true, tickedBy: { f: BRAM } });
  assert.deepEqual(state.tickedBy!.f, BRAM);
  assert.equal(state.checks.g, true);
  assert.equal('g' in state.tickedBy!, false);
  // Unticked (false) or forgotten (null, an Undo), the records go.
  state = mutate(state, { type: 'checks', keys: ['b', 'd'], value: false });
  state = mutate(state, { type: 'checks', keys: ['c', 'e'], value: null });
  assert.deepEqual(Object.keys(state.tickedBy!).sort(), ['a', 'f']);
  // A personal task removed with its tick takes its record along.
  state = mutate(state, { type: 'addTask', id: 'custom-1', title: 'Paint', phase: '3' });
  state = mutate(state, tick('custom-1', ANNA));
  state = mutate(state, { type: 'removeTask', id: 'custom-1' });
  assert.equal('custom-1' in state.tickedBy!, false);
  assert.equal(state.version, 21);
});

test('a malformed record is refused, in an update and in a stored state', () => {
  const state = initialState();
  const bad = [
    7,
    null,
    'Anna',
    [],
    {},
    { by: 'Anna' },
    { at: 'yesterday' },
    { at: '2026-13-45T12:00:00Z' },
    { at: 1760000000000 },
    { at: ANNA.at, by: 7 },
    { at: ANNA.at, by: 'x'.repeat(41) },
  ];
  for (const record of bad) {
    assert.throws(
      () => mutate(state, { type: 'check', key: 'hub-1', value: true, ticked: record } as never),
      /Invalid record of who ticked a step\./,
      JSON.stringify(record),
    );
    assert.throws(
      () =>
        mutate(state, {
          type: 'checks',
          keys: ['hub-1'],
          value: true,
          tickedBy: { 'hub-1': record },
        } as never),
      /Invalid record of who ticked a step\./,
      JSON.stringify(record),
    );
    assert.throws(
      () =>
        validateState({ ...json(state), checks: { 'hub-1': true }, tickedBy: { 'hub-1': record } }),
      /Invalid record of who ticked a step\./,
      JSON.stringify(record),
    );
  }
  assert.throws(
    () => mutate(state, { type: 'checks', keys: ['a'], value: true, tickedBy: [] } as never),
    /Invalid checklist update\./,
  );
  assert.throws(
    () => validateState({ ...json(state), tickedBy: [ANNA] }),
    /Invalid record of who ticked a step\./,
  );
  assert.throws(
    () => validateState({ ...json(state), checks: { 'a b': true }, tickedBy: { 'a b': ANNA } }),
    /Invalid record address\./,
  );
  // A record at the longest name and an unticking update carrying a malformed one are fine.
  const long = { at: ANNA.at, by: 'x'.repeat(40) };
  assert.deepEqual(mutate(state, tick('hub-1', long)).tickedBy, { 'hub-1': long });
  assert.equal(
    mutate(state, { type: 'check', key: 'hub-1', value: false, ticked: 7 } as never).version,
    1,
  );
  // A stored record of a step not ticked (unticked, forgotten) is dropped, never refused.
  const stale = validateState({
    ...json(state),
    checks: { x: false },
    tickedBy: { x: ANNA, y: BRAM },
  });
  assert.equal('tickedBy' in stale, false);
  assert.equal(stale.version, 1);
});

test('every released state loads unchanged; version 21 is set only while a record exists', () => {
  for (const [state, version] of states) {
    const clean = validateState(json(state));
    assert.equal(clean.version, version);
    assert.deepEqual(clean.checks, state.checks);
    if (version < 21) assert.equal('tickedBy' in clean, false, 'version ' + version);
  }
  const clean = validateState(json(version21));
  assert.deepEqual(clean.tickedBy, version21.tickedBy);
  assert.equal(tickedNote(clean, 'calc-3-Recipe_IronPlate_C'), '', 'ticked before: no record');
  // Without its records it is the version-20 state it was built on.
  const { tickedBy, ...rest } = json(version21);
  assert.ok(tickedBy);
  assert.equal(validateState(rest).version, 20);
  // Unticking every recorded step drops the version too, one step at a time.
  let state = mutate(clean, untick('calc-3-Recipe_Wire_C'));
  assert.equal(state.version, 21);
  state = mutate(state, untick('slot-C01-built'));
  assert.equal(state.version, 20);
  // Saying less than it holds is marked for what it holds; a higher version gets the update
  // message.
  assert.equal(validateState({ ...json(version21), version: 3 }).version, 21);
  assert.throws(
    () => validateState({ ...json(version21), version: 29 }),
    /newer planner version\. Update the app to import it\./,
  );
});

test('the co-op merge carries the file’s records, and never the merging device’s', () => {
  // Anna ticked hub-1 with a record; space-elevator-1 was ticked before the records were kept.
  const anna = mutate(mutate(initialState(), tick('hub-1', ANNA)), {
    type: 'checks',
    keys: ['space-elevator-1'],
    value: true,
  });
  const file = ticksExport(
    anna.checks,
    'Coop world',
    'Anna',
    new Date('2026-10-21T13:00:00Z'),
    anna.tickedBy,
  );
  assert.deepEqual(file.tickedBy, { 'hub-1': ANNA });
  const read = readProgressFile(json(file));
  assert.deepEqual(read.tickedBy, { 'hub-1': ANNA });
  // Bram ticked hub-2 himself; the merge ticks the two steps of Anna's he has not ticked.
  setMeName('Bram');
  let bram = mutate(initialState(), tick('hub-2', BRAM));
  for (const keys of mergeChunks(['hub-1', 'space-elevator-1', 'hub-2'], bram.checks)) {
    const update = mergeUpdate(keys, read);
    assert.equal(tickStamped(update), update, 'save() adds nothing to a merge');
    bram = mutate(bram, update);
  }
  setMeName('');
  assert.deepEqual(bram.tickedBy, { 'hub-1': ANNA, 'hub-2': BRAM });
  assert.equal(bram.checks['space-elevator-1'], true, 'ticked, without a record');
  // A progress backup and a save export with one profile carry their state's records.
  const backup: ProgressBackup = {
    format: 'satisfactory-planner-backup',
    exportedAt: '2026-10-21T13:00:00.000Z',
    saveName: 'Coop world',
    profileName: 'Anna',
    profileId: 'anna',
    state: json(anna),
  };
  assert.deepEqual(readProgressFile(json(backup)).tickedBy, { 'hub-1': ANNA });
  // A ticks file made before the records (or by a release without them) merges without any.
  const { tickedBy, ...older } = json(file);
  assert.ok(tickedBy);
  assert.deepEqual(readProgressFile(older).tickedBy, {});
  assert.deepEqual(mergeUpdate(['hub-1'], readProgressFile(older)).tickedBy, {});
  // Only records of the ids it ticks are read; a malformed one makes the file damaged.
  assert.deepEqual(
    readProgressFile({ ...json(file), tickedBy: { 'hub-1': ANNA, other: BRAM } }).tickedBy,
    { 'hub-1': ANNA },
  );
  for (const damaged of [{ 'hub-1': { at: 'noon' } }, [ANNA], 'Anna'])
    assert.throws(
      () => readProgressFile({ ...json(file), tickedBy: damaged }),
      /This progress file is damaged/,
    );
});

test('a carried tick keeps its record, in a new profile and in place; a share drops them', () => {
  const plan = calculate({ phase: '1', goal: 'timed', hours: 8, multiplier: 1, storage: 'none' });
  let source = mutate(initialState(), tick('unlock-Schematic_1-1_C', ANNA));
  source = mutate(source, tick('storage-ground-shell', BRAM));
  // Not a key any carry copies: it stays behind with its record.
  source = mutate(source, tick('space-elevator-9', NAMELESS));
  const carried = newProfileState(plan, source, plan, undefined, undefined).state;
  assert.deepEqual(carried.tickedBy, {
    'unlock-Schematic_1-1_C': ANNA,
    'storage-ground-shell': BRAM,
  });
  assert.equal(carried.version, 21);
  // Picking only the storage room, the unlock's record stays behind with its tick.
  const fewer = newProfileState(plan, source, plan, { storage: true }, undefined).state;
  assert.deepEqual(fewer.tickedBy, { 'storage-ground-shell': BRAM });
  // Recalculated in place: the profile keeps its carried records, the backup keeps them all.
  const previous: StoredProfile = {
    id: 'p1',
    name: 'Anna',
    kind: 'calculated',
    plan: json(plan) as StoredCalculatedPlan,
    state: source,
  };
  const { profile, backup } = recalculatedProfile(
    previous,
    plan,
    'Anna',
    undefined,
    undefined,
    'p2',
    'Anna (before edit)',
  );
  assert.deepEqual(profile.state.tickedBy, carried.tickedBy);
  assert.equal(profile.state.version, 21);
  assert.deepEqual(backup.state.tickedBy, source.tickedBy);
  // A share hands over the plan, not the progress, so not who ticked it either.
  const shared = shareState(source);
  assert.equal('tickedBy' in shared, false);
  assert.equal(shared.version, 1);
});

test('save() stamps every tick with this device’s name and the time, and nothing else', () => {
  const now = new Date('2026-10-21T12:15:00Z');
  setMeName('');
  assert.deepEqual(tickStamp(now), { at: '2026-10-21T12:15:00.000Z' });
  setMeName('  Anna ');
  assert.deepEqual(tickStamp(now), ANNA);
  const ticks: UpdateOp[] = [
    { type: 'check', key: 'a', value: true },
    { type: 'checks', keys: ['a', 'b'], value: true },
  ];
  for (const update of ticks)
    assert.deepEqual(tickStamped(update, now), { ...update, ticked: ANNA });
  const others: UpdateOp[] = [
    { type: 'check', key: 'a', value: false },
    { type: 'checks', keys: ['a'], value: false },
    { type: 'checks', keys: ['a'], value: null },
    { type: 'checks', keys: ['a'], value: true, tickedBy: {} },
    { type: 'check', key: 'a', value: true, ticked: BRAM },
    { type: 'note', key: 'a', value: 'x' },
  ];
  for (const update of others) assert.equal(tickStamped(update, now), update);
  setMeName('');
});

test('a ticked step says who and when in the locale’s date format, the year when not this one', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  assert.equal(tickedWords(ANNA, now, 'en-GB'), 'Ticked by Anna, 21 Oct');
  assert.equal(tickedWords(ANNA, now, 'en-US'), 'Ticked by Anna, Oct 21');
  assert.equal(tickedWords(ANNA, now, 'nl-NL'), 'Ticked by Anna, 21 okt');
  assert.equal(tickedWords(NAMELESS, now, 'en-GB'), 'Ticked 19 Oct');
  assert.equal(
    tickedWords(ANNA, new Date('2027-01-02T12:00:00Z'), 'en-GB'),
    'Ticked by Anna, 21 Oct 2026',
  );
  const state = mutate(mutate(initialState(), tick('a', ANNA)), tick('b'));
  assert.equal(tickedNote(state, 'a', now), tickedWords(ANNA, now));
  assert.equal(tickedNote(state, 'b', now), '', 'ticked before the records: nothing');
  assert.equal(tickedNote(state, 'c', now), '');
});

// Both editions: a tick with a record saves the progress state only (version 21), never
// recalculates the plan, survives a reload, a progress backup, a full export and its import; a
// share drops it; unticking brings the version back; old saves import unchanged.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  reload: () => Promise<void>,
) {
  type Context = { plan: StoredCalculatedPlan; state: ProgressState };
  const context = async () => (await request('/api/context')) as Context;
  await request('/api/profiles', { saveName: 'Coop world', name: 'Shared', settings: {} });
  const before = await context();
  assert.ok(before.state.version < 21);
  const phase = before.state.settings.phase as '3';
  const keys = before.plan.stages[phase]!.rows!.slice(0, 3).map(row => `calc-${phase}-${row.id}`);
  await request('/api/update', tick(keys[0]!, ANNA));
  await request('/api/update', { type: 'checks', keys: keys.slice(1), value: true, ticked: BRAM });
  await reload();
  const after = await context();
  assert.deepEqual(after.plan, before.plan, 'the stored plan is not recalculated');
  assert.equal(after.state.version, 21);
  const records = { [keys[0]!]: ANNA, [keys[1]!]: BRAM, [keys[2]!]: BRAM };
  assert.deepEqual(after.state.tickedBy, records);
  // The progress backup and a full export carry them and pass the import's check.
  const backup = (await request('/api/export')) as ProgressBackup;
  assert.deepEqual(validateState(backup.state).tickedBy, records);
  const exported = (await request('/api/export-saves')) as SaveExport;
  const carried = validateTransfer(exported).saves[0]!.profiles[0]!.state;
  assert.equal(carried.version, 21);
  assert.deepEqual(carried.tickedBy, records);
  const save = exported.saves[0]!,
    profile = save.profiles[0]!;
  // A share has no progress, so no records.
  const share = (await request(
    `/api/export-saves?save=${save.id}&profile=${profile.id}&share=1`,
  )) as SaveExport;
  assert.equal('tickedBy' in share.saves[0]!.profiles[0]!.state, false);
  // Imported as a copy, with the records; and saves from before (versions 1, 3, 19 and 20) and a
  // version-21 one import as they were.
  const old: SaveExport = {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-21T10:00:00.000Z',
    saves: [
      {
        id: 'old',
        name: 'Old world',
        activeProfile: 'v1-0',
        profiles: [
          ...states
            .filter(([, version]) => [1, 3, 19, 20, 21].includes(version))
            .map(([state, version], i) => ({
              ...profile,
              id: 'v' + version + '-' + i,
              name: 'Version ' + version + ' #' + i,
              state: json(state),
            })),
          { ...profile, id: 'mine', name: 'This copy', state: json(after.state) },
        ],
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
    assert.deepEqual(got.tickedBy, sent.state.tickedBy, sent.name);
  }
  // Unticked again: the records go, and the open profile is readable by older releases again.
  await request('/api/update', untick(keys[0]!));
  await request('/api/update', { type: 'checks', keys: keys.slice(1), value: false });
  await reload();
  const cleared = await context();
  assert.ok(cleared.state.version < 21, 'version ' + cleared.state.version);
  assert.equal('tickedBy' in cleared.state, false);
}

test('the Docker server keeps who ticked in workspace.json and never recalculates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-ticked-by-'));
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
    // workspace.json holds the imported copies' records only, once the open profile's are gone.
    const disk = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8');
    assert.equal((disk.match(/"by":\s*"Bram"/g) || []).length, 2, 'the imported copy');
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition keeps who ticked in IndexedDB and never recalculates', async () => {
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
