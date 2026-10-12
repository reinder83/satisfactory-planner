// "Create profile" stores the plan Review showed (#1060, public/reviewed-plans.ts): no second
// calculation, the same plan, and that plan is what a fresh calculate() gives for the same
// settings. Settings changed after Review, and live estimates, are calculated afresh. Both
// editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import {
  REVIEWED_PLAN_MS,
  REVIEWED_PLANS,
  reviewedPlans,
  reviewedReplacement,
} from '../public/reviewed-plans.ts';
import { seedLegacy } from './helpers/seed.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  CurrentCalculatedPlan,
} from '../public/types/index.ts';

const SETTINGS = { phase: '2', goal: 'minimal', wholeMachines: true };
const OTHER = { ...SETTINGS, phase: '3' };
// A plan without its creation time, which a fresh calculation sets anew.
const withoutTime = ({ createdAt, ...plan }: { createdAt?: string }) => (void createdAt, plan);
const fresh = (settings: object) => withoutTime(calculate(settings));

test('kept plans are copies, per owner and settings, the newest eight, for an hour', () => {
  let clock = 0;
  const plans = reviewedPlans<{ n: number; list: number[] }>(() => clock);
  const plan = { n: 1, list: [1] };
  plans.keep('a', SETTINGS, plan);
  plan.list.push(2);
  const taken = plans.take('a', SETTINGS)!;
  assert.deepEqual(taken, { n: 1, list: [1] }, 'kept as it was when kept');
  taken.list.push(3);
  assert.deepEqual(plans.take('a', SETTINGS), { n: 1, list: [1] }, 'each use gets its own copy');
  assert.equal(plans.take('b', SETTINGS), null, 'another owner has none');
  assert.equal(plans.take('a', OTHER), null, 'other settings have none');
  assert.equal(plans.take('a', { ...SETTINGS, goal: 'timed' }), null);
  // The newest REVIEWED_PLANS are kept; keeping one again makes it the newest.
  for (let i = 0; i < REVIEWED_PLANS; i++) plans.keep('a', { i }, { n: i, list: [] });
  assert.equal(plans.take('a', SETTINGS), null, 'the oldest went');
  plans.keep('a', { i: 0 }, { n: 0, list: [] });
  plans.keep('a', { i: 'new' }, { n: 9, list: [] });
  assert.ok(plans.take('a', { i: 0 }), 'kept again, so kept');
  assert.equal(plans.take('a', { i: 1 }), null, 'now the oldest went');
  clock += REVIEWED_PLAN_MS + 1;
  assert.equal(plans.take('a', { i: 0 }), null, 'an hour later it is gone');
});

test('the Docker server stores the reviewed plan without calculating again', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-reviewed-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = async (endpoint: string, body: unknown) => {
    const response = await fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const stored = async (created: { saveId: string; profileId: string }) => {
    const reply = (await (
      await fetch(`${url}/api/context?save=${created.saveId}&profile=${created.profileId}`)
    ).json()) as ContextReply;
    return reply.plan as CurrentCalculatedPlan;
  };
  try {
    const reviewed = (await post('/api/preview', { settings: SETTINGS })) as CurrentCalculatedPlan;
    const created = await post('/api/profiles', { saveName: 'S', name: 'P', settings: SETTINGS });
    const plan = await stored(created);
    // Created when Review calculated it: a second calculation would be stamped later.
    assert.deepEqual(plan, reviewed, 'the plan Review showed is the plan saved');
    assert.deepEqual(withoutTime(plan), fresh(SETTINGS), 'and a fresh calculation gives it');
    // Settings changed after Review: calculated for the new settings.
    const changed = await stored(
      await post('/api/profiles', { saveId: created.saveId, name: 'Q', settings: OTHER }),
    );
    assert.notEqual(changed.createdAt, reviewed.createdAt);
    assert.deepEqual(withoutTime(changed), fresh(OTHER));
    // A live estimate is not kept.
    const estimate = (await post('/api/preview?estimate=1', {
      settings: OTHER,
    })) as CurrentCalculatedPlan;
    const after = await stored(
      await post('/api/profiles', { saveId: created.saveId, name: 'R', settings: OTHER }),
    );
    assert.notEqual(after.createdAt, estimate.createdAt);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition stores the reviewed plan without calculating again', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  const calculated: unknown[] = [];
  const api = createBrowserApi(
    store,
    settings => {
      calculated.push(settings);
      return calculate(settings);
    },
    {} as Catalog,
  );
  const post = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  const planOf = (created: unknown) => {
    const { saveId, profileId } = created as { saveId: string; profileId: string };
    return data.saves.find(s => s.id === saveId)!.profiles.find(p => p.id === profileId)!.plan;
  };
  const reviewed = (await post('/api/preview', { settings: SETTINGS })) as CurrentCalculatedPlan;
  // The page may change the plan it was given; the kept plan stays as calculated.
  const shown = structuredClone(reviewed);
  reviewed.warnings.push('changed by the page');
  const created = await post('/api/profiles', { saveName: 'S', name: 'P', settings: SETTINGS });
  assert.equal(calculated.length, 1, 'Create profile did not calculate');
  assert.deepEqual(planOf(created), shown, 'the plan Review showed is the plan saved');
  assert.deepEqual(withoutTime(planOf(created)!), fresh(SETTINGS));
  // Settings changed after Review: calculated afresh, for those settings.
  const changed = await post('/api/profiles', { saveName: 'S2', name: 'Q', settings: OTHER });
  assert.deepEqual(calculated, [SETTINGS, OTHER]);
  assert.deepEqual(withoutTime(planOf(changed)!), fresh(OTHER));
  // A live estimate is not kept.
  const later = { ...OTHER, phase: '4' };
  await post('/api/preview?estimate=1', { settings: later });
  await post('/api/profiles', { saveName: 'S3', name: 'R', settings: later });
  assert.deepEqual(calculated, [SETTINGS, OTHER, later, later], 'the create calculated');
});

// Edit settings, "Recalculate in place" (#1138): Review's plan is reused the same way, so the
// recalculation stores the plan Review showed without calculating it again. Settings changed after
// Review, the plan's recalculation offers (which have no Review) and live estimates are calculated
// afresh, and so is a reviewed plan that is not newer than the profile's plan (the plan it has, or
// one it left behind): each recalculation gives the profile a plan of its own creation time, so a
// tab still on the previous plan is refused (409) as before. The server's calculations are not
// counted; the plans' creation times show them there (a calculation stamps its own).
const LATER = { ...SETTINGS, wholeMachines: false };
const ESTIMATED = { ...OTHER, wholeMachines: false };
interface Scoped {
  saveId: string;
  profileId: string;
}
// The requests of Edit settings against one profile, in either edition.
interface InPlace {
  preview(settings: object, estimate?: boolean): Promise<CurrentCalculatedPlan>;
  recalculate(settings: object, planCreatedAt: string): Promise<unknown>;
  plan(): Promise<CurrentCalculatedPlan>;
}
async function checkInPlace(edit: InPlace, calculations: () => number | null) {
  const counted = (expected: number, message: string) => {
    const count = calculations();
    if (count !== null) assert.equal(count, expected, message);
  };
  const start = await edit.plan();
  // Edit settings → Review → Recalculate in place: the plan Review showed, no second calculation.
  const reviewed = await edit.preview(OTHER);
  counted(1, 'Review calculated');
  await edit.recalculate(OTHER, start.createdAt);
  counted(1, 'Recalculate in place did not calculate');
  const stored = await edit.plan();
  assert.deepEqual(stored, reviewed, 'the plan Review showed is the plan stored');
  assert.deepEqual(withoutTime(stored), fresh(OTHER), 'and a fresh calculation gives it');
  // Settings changed after Review (as an offer's, which has no Review): calculated afresh.
  const earlier = await edit.preview(LATER);
  await edit.recalculate(SETTINGS, stored.createdAt);
  counted(3, 'other settings were calculated');
  const changed = await edit.plan();
  assert.deepEqual(withoutTime(changed), fresh(SETTINGS));
  // That Review of LATER came before the profile's plan was made: not used.
  await edit.recalculate(LATER, changed.createdAt);
  counted(4, "a plan reviewed before the profile's plan is calculated again");
  const recalculated = await edit.plan();
  assert.notEqual(recalculated.createdAt, earlier.createdAt);
  assert.deepEqual(withoutTime(recalculated), fresh(LATER));
  // A Review after it is used, for its exact settings.
  const later = await edit.preview(LATER);
  await edit.recalculate(LATER, recalculated.createdAt);
  counted(5, 'the plan reviewed for LATER was used');
  const reused = await edit.plan();
  assert.deepEqual(reused, later);
  // The same settings again: not the plan the profile already has, but a plan of its own, so a
  // tab still on that plan is refused.
  await edit.recalculate(LATER, reused.createdAt);
  counted(6, 'the plan the profile has is not stored again');
  const again = await edit.plan();
  assert.notEqual(again.createdAt, reused.createdAt);
  assert.deepEqual(withoutTime(again), fresh(LATER));
  await assert.rejects(
    async () => edit.recalculate(LATER, reused.createdAt),
    /recalculated in another tab/,
  );
  counted(6, 'a refused recalculation does not calculate');
  // Nor is a plan the profile left behind: it would bring that plan's creation time back.
  await edit.recalculate(OTHER, again.createdAt);
  counted(7, 'the plan the profile had first is calculated again');
  const back = await edit.plan();
  assert.notEqual(back.createdAt, reviewed.createdAt);
  assert.deepEqual(withoutTime(back), fresh(OTHER));
  // A live estimate is not kept.
  const estimate = await edit.preview(ESTIMATED, true);
  await edit.recalculate(ESTIMATED, back.createdAt);
  counted(9, 'the recalculation after an estimate calculated');
  const afterEstimate = await edit.plan();
  assert.notEqual(afterEstimate.createdAt, estimate.createdAt);
  assert.deepEqual(withoutTime(afterEstimate), fresh(ESTIMATED));
}

test('the Docker server recalculates in place with the reviewed plan (#1138)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-reviewed-recalc-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = async (endpoint: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(response.status + ' ' + (await response.text()));
    return response.json();
  };
  try {
    const created = (await post('/api/profiles', {
      saveName: 'S',
      name: 'P',
      settings: SETTINGS,
    })) as Scoped;
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    let edits = 0;
    await checkInPlace(
      {
        preview: async (settings, estimate) =>
          (await post('/api/preview' + (estimate ? '?estimate=1' : ''), {
            settings,
          })) as CurrentCalculatedPlan,
        recalculate: (settings, planCreatedAt) =>
          post(
            '/api/recalculate',
            { name: 'P', backupName: 'P (before edit ' + ++edits + ')', settings, planCreatedAt },
            headers,
          ),
        plan: async () =>
          ((await (await fetch(url + '/api/context', { headers })).json()) as ContextReply)
            .plan as CurrentCalculatedPlan,
      },
      () => null,
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition recalculates in place with the reviewed plan (#1138)', async () => {
  let data: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (data: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(data);
      if (!change) return copy as T;
      const result = change(copy);
      data = copy;
      return structuredClone(result);
    },
  };
  let calculated = 0;
  const api = createBrowserApi(
    store,
    settings => {
      calculated++;
      return calculate(settings);
    },
    {} as Catalog,
  );
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    api(route, { body: JSON.stringify(body), headers });
  const created = (await post('/api/profiles', {
    saveName: 'S',
    name: 'P',
    settings: SETTINGS,
  })) as Scoped;
  const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
  calculated = 0;
  let edits = 0;
  await checkInPlace(
    {
      preview: async (settings, estimate) =>
        (await post('/api/preview' + (estimate ? '?estimate=1' : ''), {
          settings,
        })) as CurrentCalculatedPlan,
      recalculate: (settings, planCreatedAt) =>
        post(
          '/api/recalculate',
          { name: 'P', backupName: 'P (before edit ' + ++edits + ')', settings, planCreatedAt },
          headers,
        ),
      plan: async () =>
        data.saves[0]!.profiles.find(p => p.id === created.profileId)!
          .plan as CurrentCalculatedPlan,
    },
    () => calculated,
  );
});

test('a recalculation in place takes only a plan reviewed after the plan it replaces', () => {
  const plans = reviewedPlans<{ createdAt: string }>();
  const plan = { createdAt: '2026-10-12T10:00:00.000Z' };
  plans.keep('a', SETTINGS, plan);
  const replace = (owner: string, settings: object, replacing: unknown) =>
    reviewedReplacement(plans, owner, settings, replacing);
  assert.deepEqual(replace('a', SETTINGS, '2026-10-12T09:59:59.999Z'), plan, 'reviewed after it');
  assert.equal(replace('a', SETTINGS, plan.createdAt), null, 'the plan the profile has');
  assert.equal(replace('a', SETTINGS, '2026-10-12T10:00:00.001Z'), null, 'reviewed before it');
  assert.equal(replace('a', SETTINGS, undefined), null, 'no plan named');
  assert.equal(replace('a', SETTINGS, 'not a time'), null);
  assert.equal(replace('b', SETTINGS, '2026-10-12T09:00:00.000Z'), null, 'another owner');
  assert.equal(replace('a', OTHER, '2026-10-12T09:00:00.000Z'), null, 'other settings');
});
