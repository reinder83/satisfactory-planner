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
import { REVIEWED_PLAN_MS, REVIEWED_PLANS, reviewedPlans } from '../public/reviewed-plans.ts';
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
