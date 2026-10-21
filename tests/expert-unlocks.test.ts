// Expert mode's grouped unlocks (#1197, public/app/unlock-groups.ts): the build plan's HUB
// milestones grouped by tier and its MAM research as one group, each with a tick ("Tier 1 done").
// A group's tick is one `checks` update with the keys ticking each open item would tick, so the
// stored progress is exactly what ticking the items one by one stores, and its untick unticks only
// the group's own ticked items. Nothing new is stored (the state keeps its version) and the plan is
// never recalculated; both editions apply it through the shared mutate().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { calculate, catalog } from '../planner.ts';
import { phaseSteps } from '../public/progression.ts';
import { mutate, validateState } from '../public/state.ts';
import { runningChange, undoUpdates } from '../public/app/group-running.ts';
import {
  groupDoneLabel,
  groupTickNews,
  groupUndoNews,
  itemTitle,
  unlockGroupOf,
  unlockGroups,
} from '../public/app/unlock-groups.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type { ContextReply, Progression, SavedState, UpdateOp } from '../public/types/index.ts';

const progression: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const hub = (tier: number) =>
  progression.entries.filter(entry => !entry.mam && !entry.alternate && entry.tier === tier);
const mam = progression.entries.filter(entry => entry.mam && !entry.alternate);
const step = (id: string) => ({ id, title: id });

test('unlock steps group by tier, MAM research last; other steps are not grouped', () => {
  const [t3a, t3b] = hub(3),
    [t1] = hub(1),
    [m1] = mam;
  const alternate = progression.entries.find(entry => entry.alternate)!;
  const steps = [
    step('unlock-' + t3a!.id),
    step('power-1'),
    step('unlock-' + m1!.id),
    step('unlock-' + t1!.id),
    step('calc-1-row'),
    step('recipe-unlock-Recipe_Alternate_X_C'),
    step('unlock-' + alternate.id),
    step('unlock-Unknown_C'),
    step('custom-1'),
    step('unlock-' + t3b!.id),
  ];
  const groups = unlockGroups(steps, progression);
  assert.deepEqual(
    groups.map(group => [group.key, group.label, group.items.map(item => item.id)]),
    [
      ['tier-1', 'Tier 1', ['unlock-' + t1!.id]],
      ['tier-3', 'Tier 3', ['unlock-' + t3a!.id, 'unlock-' + t3b!.id]],
      ['mam', 'MAM research', ['unlock-' + m1!.id]],
    ],
  );
  assert.equal(unlockGroupOf('power-1', progression), null);
  assert.equal(unlockGroupOf('unlock-' + alternate.id, progression), null);
  assert.equal(groupDoneLabel('Tier 3'), 'Tier 3 done');
  assert.equal(itemTitle('Tier 3: Coal Power', 'tier-3'), 'Coal Power');
  assert.equal(itemTitle('MAM: Caterium', 'mam'), 'Caterium');
  assert.equal(itemTitle('My own words', 'tier-3'), 'My own words', 'a rewritten title stays');
});

const progress = (checks: Record<string, boolean>): SavedState => ({
  version: 3,
  revision: 1,
  settings: { phase: '1' },
  checks,
  notes: {},
  deliveries: {},
  customTasks: [],
});
const applyAll = (state: SavedState, updates: UpdateOp[]) =>
  updates.reduce<SavedState>((current, update) => mutate(structuredClone(current), update), state);

test('a group tick stores exactly the per-item ticks, and its untick only the group’s own', () => {
  const tier = hub(2).map(entry => 'unlock-' + entry.id),
    other = 'unlock-' + hub(1)[0]!.id;
  assert.ok(tier.length >= 3);
  const checks = { [tier[0]!]: true, [tier[1]!]: false, [other]: false, 'calc-1-x': true };
  const before = progress(checks);
  const change = runningChange(tier, checks)!;
  assert.equal(change.value, true);
  assert.deepEqual(change.keys, tier.slice(1), 'the item already ticked is not sent');
  const grouped = mutate(structuredClone(before), {
    type: 'checks',
    keys: change.keys,
    value: true,
  });
  const byHand = applyAll(
    before,
    tier.filter(key => !checks[key]).map(key => ({ type: 'check' as const, key, value: true })),
  );
  assert.deepEqual(grouped.checks, byHand.checks);
  assert.equal(grouped.version, validateState(before).version, 'no new state version');
  assert.equal(
    groupTickNews(change, 'Tier 2'),
    `Tier 2 done: ${tier.length - 1} unlocks ticked; 1 already was.`,
  );
  // All done: the tick is the untick, of the group's items only.
  const untick = runningChange(tier, grouped.checks)!;
  assert.equal(untick.value, false);
  const cleared = mutate(structuredClone(grouped), {
    type: 'checks',
    keys: untick.keys,
    value: false,
  });
  const unByHand = applyAll(
    grouped,
    tier.map(key => ({ type: 'check' as const, key, value: false })),
  );
  assert.deepEqual(cleared.checks, unByHand.checks);
  assert.equal(cleared.checks[other], false, 'an item of another tier keeps its record');
  assert.equal(cleared.checks['calc-1-x'], true, 'a production line keeps its tick');
  assert.equal(
    groupTickNews(untick, 'Tier 2'),
    `Tier 2 not done: ${tier.length} unlocks unticked.`,
  );
  // Undo puts each item back as it was, never-ticked ones forgotten again.
  const undone = applyAll(grouped, undoUpdates(change, grouped.checks));
  assert.deepEqual(undone.checks, before.checks);
  assert.equal(
    groupUndoNews(change, change.keys.length, 'Tier 2'),
    `Undone: ${change.keys.length} unlocks of Tier 2 are back as they were.`,
  );
});

// The same group tick and untick in an edition: a new Phase 1 profile, two items of its largest
// unlock group recorded by hand (one ticked, one unticked), then the group ticked, a reload, the
// group unticked and a reload. Each time the stored progress is what ticking the items one by one
// stores, and the plan is the one stored.
type Request = (route: string, body?: unknown) => Promise<unknown>;
async function checkEdition(request: Request, reload: () => Promise<void>) {
  await request('/api/profiles', { saveName: 'World', name: 'Unlocks', settings: { phase: '1' } });
  const context = async () => (await request('/api/context')) as ContextReply;
  const first = await context();
  const plan = first.plan!;
  const groups = unlockGroups(phaseSteps(plan, first.state, progression, '1'), progression);
  const group = [...groups].sort((a, b) => b.items.length - a.items.length)[0]!;
  assert.ok(group.items.length >= 2, 'a group with two or more unlocks');
  const keys = group.items.map(item => item.id);
  const outside = groups.filter(other => other !== group).flatMap(other => other.items)[0]?.id;
  await request('/api/update', { type: 'check', key: keys[0], value: true });
  await request('/api/update', { type: 'check', key: keys[1], value: false });
  if (outside) await request('/api/update', { type: 'check', key: outside, value: false });
  const before = (await context()).state;
  const expected = applyAll(
    before,
    keys
      .filter(key => !before.checks[key])
      .map(key => ({ type: 'check' as const, key, value: true })),
  );
  const change = runningChange(keys, before.checks)!;
  await request('/api/update', { type: 'checks', keys: change.keys, value: change.value });
  await reload();
  const ticked = await context();
  assert.deepEqual(ticked.state.checks, expected.checks, 'the group tick equals the item ticks');
  assert.equal(ticked.state.version, before.version, 'no new state version');
  assert.deepEqual(ticked.plan, plan, 'the stored plan is not recalculated');
  const untick = runningChange(keys, ticked.state.checks)!;
  assert.equal(untick.value, false);
  await request('/api/update', { type: 'checks', keys: untick.keys, value: untick.value });
  await reload();
  const cleared = await context();
  const unByHand = applyAll(
    ticked.state,
    keys.map(key => ({ type: 'check' as const, key, value: false })),
  );
  assert.deepEqual(cleared.state.checks, unByHand.checks, 'the untick equals the item unticks');
  if (outside) assert.equal(cleared.state.checks[outside], false, 'another group is untouched');
  assert.deepEqual(cleared.plan, plan);
  return cleared.state.checks;
}

let dockerChecks: Record<string, boolean> | undefined;
let browserChecks: Record<string, boolean> | undefined;

test('the Docker server stores a group tick as the item ticks', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-expert-unlocks-'));
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
    dockerChecks = await checkEdition(request, async () => {
      await close();
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition stores a group tick as the item ticks, in IndexedDB', async () => {
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
  browserChecks = await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      api = open();
    },
  );
  assert.deepEqual(browserChecks, dockerChecks, 'both editions store the same ticks');
});
