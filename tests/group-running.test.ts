// "Mark all running" on a factory (#1163, public/app/group-running.ts): one `checks` update that
// marks every production line of a factory group running in the phase, the `calc-<phase>-<row id>`
// checks the cards' Running boxes write, and its reverse once all of them run. Only the group's
// lines are sent, a line already marked is not, and Undo puts each line back exactly as it was:
// ticked, deliberately unticked (`false`) or never ticked (forgotten with `value: null`). Nothing
// new is stored (the state keeps its version) and the plan is never recalculated; both editions
// apply it through the shared mutate().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { calculate, catalog } from '../planner.ts';
import { mutate, validateState } from '../public/state.ts';
import {
  groupRunningKeys,
  runningAction,
  runningChange,
  runningNews,
  undoNews,
  undoUpdates,
} from '../public/app/group-running.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  ContextReply,
  FactoryGroups,
  GroupAssignment,
  ProgressState,
  SavedState,
} from '../public/types/index.ts';

const groups: FactoryGroups = {
  groups: [
    { id: 'fg-alpha', name: 'Alpha' },
    { id: 'fg-beta', name: 'Beta' },
  ],
  assignments: {
    a1: [{ group: 'fg-alpha', rate: null }],
    a2: [{ group: 'fg-alpha', rate: 5 }],
    a3: [{ group: 'fg-alpha', rate: null }],
    // Split over both factories: a line of each.
    shared: [
      { group: 'fg-alpha', rate: 2 },
      { group: 'fg-beta', rate: null },
    ],
    b1: [{ group: 'fg-beta', rate: null }],
  },
};
const rows = ['a1', 'a2', 'a3', 'shared', 'b1', 'loose'].map(id => ({ id }));
const membershipsOf = (id: string): GroupAssignment[] => groups.assignments[id] ?? [];
const progress = (checks: Record<string, boolean>): SavedState => ({
  version: 3,
  revision: 4,
  settings: { phase: '3' },
  checks,
  notes: {},
  deliveries: {},
  customTasks: [],
  factoryGroups: structuredClone(groups),
});
const applyAll = (state: SavedState, updates: Parameters<typeof mutate>[1][]) =>
  updates.reduce<SavedState>((current, update) => mutate(structuredClone(current), update), state);

test('the keys are the group’s own lines in the phase shown, a split line included', () => {
  assert.deepEqual(groupRunningKeys(rows, 'fg-alpha', membershipsOf, '3'), [
    'calc-3-a1',
    'calc-3-a2',
    'calc-3-a3',
    'calc-3-shared',
  ]);
  assert.deepEqual(groupRunningKeys(rows, 'fg-beta', membershipsOf, 'post'), [
    'calc-post-shared',
    'calc-post-b1',
  ]);
  assert.deepEqual(groupRunningKeys(rows, 'fg-none', membershipsOf, '3'), []);
  assert.equal(runningChange([], {}), null, 'a factory without lines offers nothing');
});

test('marking sends only the lines not running yet, and the ticks already set stay', () => {
  const checks = {
    'calc-3-a1': true,
    'calc-3-a2': false,
    'calc-3-b1': false,
    'calc-2-a3': true,
    'unlock-x': true,
  };
  const keys = groupRunningKeys(rows, 'fg-alpha', membershipsOf, '3');
  const change = runningChange(keys, checks)!;
  assert.equal(change.value, true);
  assert.deepEqual(change.keys, ['calc-3-a2', 'calc-3-a3', 'calc-3-shared']);
  assert.deepEqual(change.previous, {
    'calc-3-a2': false,
    'calc-3-a3': null,
    'calc-3-shared': null,
  });
  assert.equal(change.lines, 4);
  assert.equal(change.already, 1);
  const before = progress(checks);
  const after = mutate(structuredClone(before), {
    type: 'checks',
    keys: change.keys,
    value: change.value,
  });
  assert.deepEqual(after.checks, {
    ...checks,
    'calc-3-a2': true,
    'calc-3-a3': true,
    'calc-3-shared': true,
  });
  // Exactly what ticking each card's Running box by hand stores.
  const byHand = applyAll(
    before,
    change.keys.map(key => ({ type: 'check' as const, key, value: true })),
  );
  assert.deepEqual(after.checks, byHand.checks);
  assert.equal(after.version, validateState(before).version, 'no new state version');
  assert.deepEqual(after.factoryGroups, before.factoryGroups, 'the groups are untouched');
  assert.equal(runningNews(change, 'Alpha'), 'Marked 3 lines of Alpha running; 1 already was.');
  assert.deepEqual(runningAction(change, 'Alpha'), {
    label: 'Mark all running',
    aria: 'Mark all 4 lines of Alpha running',
  });
});

test('undo restores the previous ticks exactly, and leaves a line changed since alone', () => {
  const checks = { 'calc-3-a1': true, 'calc-3-a2': false, 'calc-3-b1': true };
  const before = progress(checks);
  const change = runningChange(groupRunningKeys(rows, 'fg-alpha', membershipsOf, '3'), checks)!;
  const marked = mutate(structuredClone(before), {
    type: 'checks',
    keys: change.keys,
    value: true,
  });
  const undone = applyAll(marked, undoUpdates(change, marked.checks));
  assert.deepEqual(undone.checks, before.checks, 'absent stays absent, false stays false');
  assert.equal(Object.hasOwn(undone.checks, 'calc-3-a3'), false);
  assert.equal(undoNews(change, 3, 'Alpha'), 'Undone: 3 lines of Alpha are back as they were.');
  // A line unticked by hand after the press keeps that untick.
  const handEdited = mutate(structuredClone(marked), {
    type: 'check',
    key: 'calc-3-a3',
    value: false,
  });
  const updates = undoUpdates(change, handEdited.checks);
  assert.deepEqual(
    updates.flatMap(update => update.keys),
    ['calc-3-a2', 'calc-3-shared'],
  );
  const partly = applyAll(handEdited, updates);
  assert.deepEqual(partly.checks, { ...before.checks, 'calc-3-a3': false });
  assert.equal(
    undoNews(change, 2, 'Alpha'),
    'Undone: 2 lines of Alpha are back as they were; 1 changed since stays as it is.',
  );
  assert.equal(
    undoNews(change, 0, 'Alpha'),
    'Nothing to undo: the lines of Alpha were changed since.',
  );
});

test('with every line running the action is the reverse, and its undo ticks them again', () => {
  const checks = {
    'calc-3-a1': true,
    'calc-3-a2': true,
    'calc-3-a3': true,
    'calc-3-shared': true,
    'calc-3-b1': true,
  };
  const before = progress(checks);
  const change = runningChange(groupRunningKeys(rows, 'fg-alpha', membershipsOf, '3'), checks)!;
  assert.equal(change.value, false);
  assert.equal(change.already, 0);
  assert.equal(runningAction(change, 'Alpha').label, 'Mark all not running');
  assert.equal(runningNews(change, 'Alpha'), 'Marked 4 lines of Alpha not running.');
  const cleared = mutate(structuredClone(before), {
    type: 'checks',
    keys: change.keys,
    value: false,
  });
  assert.deepEqual(cleared.checks, {
    'calc-3-a1': false,
    'calc-3-a2': false,
    'calc-3-a3': false,
    'calc-3-shared': false,
    'calc-3-b1': true,
  });
  const undone = applyAll(cleared, undoUpdates(change, cleared.checks));
  assert.deepEqual(undone.checks, before.checks);
});

test('a checks update forgets keys with null and still refuses any other value', () => {
  const state = progress({ 'calc-3-a1': true, 'calc-3-a2': false, 'unlock-x': true });
  const forgotten = mutate(structuredClone(state), {
    type: 'checks',
    keys: ['calc-3-a1', 'calc-3-a2', 'calc-3-none'],
    value: null,
  });
  assert.deepEqual(forgotten.checks, { 'unlock-x': true });
  for (const value of [undefined, 'true', 1, {}])
    assert.throws(
      () => mutate(structuredClone(state), { type: 'checks', keys: ['calc-3-a1'], value } as never),
      /Invalid checklist update/,
    );
  assert.throws(
    () => mutate(structuredClone(state), { type: 'checks', keys: ['bad key!'], value: null }),
    /Invalid checklist update/,
  );
});

// The same press and undo in an edition: a new profile's default factories, two of the first
// factory's lines recorded by hand (one ticked, one unticked), then Mark all running, a reload,
// and Undo. The plan is the one stored, and the progress is what it was.
type Request = (route: string, body?: unknown) => Promise<unknown>;
async function checkEdition(request: Request, reload: () => Promise<void>) {
  await request('/api/profiles', { saveName: 'World', name: 'Lines', settings: { phase: '1' } });
  const context = async () => (await request('/api/context')) as ContextReply;
  const first = await context();
  const plan = first.plan!;
  const stageRows = plan.stages['1']!.rows!;
  const factory = first.state.factoryGroups!;
  const memberships = (id: string) => factory.assignments[id] ?? [];
  const group = factory.groups.find(
    candidate => groupRunningKeys(stageRows, candidate.id, memberships, '1').length >= 3,
  )!;
  assert.ok(group, 'a default factory with three or more lines');
  const keys = groupRunningKeys(stageRows, group.id, memberships, '1');
  const outside = stageRows.map(row => 'calc-1-' + row.id).filter(key => !keys.includes(key));
  assert.ok(outside.length, 'lines outside the factory');
  await request('/api/update', { type: 'check', key: keys[0], value: true });
  await request('/api/update', { type: 'check', key: keys[1], value: false });
  await request('/api/update', { type: 'check', key: outside[0], value: false });
  const before = (await context()).state;
  const change = runningChange(keys, before.checks)!;
  assert.deepEqual(change.keys, keys.slice(1), 'the line already running is not sent');
  await request('/api/update', { type: 'checks', keys: change.keys, value: change.value });
  await reload();
  const marked = await context();
  assert.deepEqual(marked.plan, plan, 'the stored plan is not recalculated');
  for (const key of keys) assert.equal(marked.state.checks[key], true, key);
  assert.equal(
    marked.state.checks[outside[0]!],
    false,
    'a line outside the factory keeps its record',
  );
  for (const key of outside.slice(1)) assert.equal(Object.hasOwn(marked.state.checks, key), false);
  assert.equal(marked.state.version, before.version, 'no new state version');
  for (const update of undoUpdates(change, marked.state.checks))
    await request('/api/update', update);
  await reload();
  const undone = await context();
  assert.deepEqual(undone.state.checks, before.checks, 'undo restores the ticks exactly');
  assert.deepEqual(stripRevision(undone.state), stripRevision(before), 'and nothing else changed');
  assert.deepEqual(undone.plan, plan);
}
const stripRevision = ({ revision: _revision, ...rest }: ProgressState) => rest;

test('the Docker server stores the press and its undo, and recalculates nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'satisfactory-group-running-'));
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
    assert.ok(res.ok, route + ' ' + res.status);
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

test('the browser edition stores the press and its undo in IndexedDB', async () => {
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
