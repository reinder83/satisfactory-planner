// Cancelling a hard-drive ranking and watching its progress (BUG-7, #1332): rankAlternates stops
// between two alternates when asked to and keeps the ones checked, the browser worker is told to
// stop by the request's `stop` signal, and the Docker server answers GET /api/rank-progress and
// POST /api/rank-cancel while a ranking runs on its thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate, rankAlternates, rankAlternatesSteps } from '../planner.ts';
import { keptRanking } from '../public/state.ts';
import { createBrowserApi, workerJobs, type CalculatorWorker } from '../public/browser-api.ts';
import { seedLegacy } from './helpers/seed.ts';
import type {
  AlternatePayoff,
  AlternateRanking,
  BrowserWorkspace,
  Catalog,
  ContextReply,
  RankReply,
  StageKey,
  StoredCalculatedPlan,
  StoredPayoff,
} from '../public/types/index.ts';

// Every alternate allowed: each Phase 1 alternate is a hunting trial, so a ranking has many.
const SETTINGS = { phase: '1', goal: 'minimal', recipes: 'all', mamRecipes: true };
const RANK = { phase: '1', remaining: true, hunting: true };

test('a ranking stops before its next alternate when asked, keeping those checked', () => {
  let asked = 0;
  const ranking = rankAlternates(SETTINGS, {
    phase: '1',
    remaining: true,
    hunting: true,
    // True from the third question on: two alternates are checked.
    shouldStop: () => ++asked > 2,
  });
  assert.equal(ranking.candidates.length, 2);
  assert.ok(ranking.total > 2);
  assert.equal(ranking.stopped, true);
  // Not stopped: the same call without it checks them all.
  const full = rankAlternates(SETTINGS, { phase: '1', remaining: true, hunting: true });
  assert.equal(full.stopped, false);
  assert.equal(full.candidates.length, full.total);
  // What it did check is what the full ranking says of those two.
  assert.deepEqual(
    ranking.candidates.map(c => [c.id, c.status, c.buildings]),
    full.candidates.slice(0, 2).map(c => [c.id, c.status, c.buildings]),
  );
});

test('the steps of a ranking report how many alternates are done of the total', () => {
  const seen: number[][] = [];
  let asked = 0;
  const steps = rankAlternatesSteps(SETTINGS, {
    phase: '1',
    remaining: true,
    hunting: true,
    shouldStop: () => ++asked > 3,
  });
  let step = steps.next();
  while (!step.done) {
    seen.push([step.value.done, step.value.total]);
    step = steps.next();
  }
  const total = step.value.total;
  assert.deepEqual(seen, [
    [0, total],
    [1, total],
    [2, total],
    [3, total],
  ]);
});

test('aborting the stop signal tells the worker to cancel that ranking, and only while it runs', async () => {
  const posted: unknown[] = [];
  const worker: CalculatorWorker = {
    onmessage: null,
    onerror: null,
    postMessage: message => posted.push(message),
    terminate: () => {},
  };
  const { rank } = workerJobs(() => worker, 1000);
  const reply = (data: object) => worker.onmessage?.(new MessageEvent('message', { data }));
  const first = new AbortController();
  const running = Promise.resolve(rank({ n: 1 }, '3', undefined, undefined, first.signal));
  assert.equal(posted.length, 1);
  reply({ id: 1, done: 3, total: 9 });
  first.abort();
  assert.deepEqual(posted[1], { cancel: 1 });
  // The worker replies with the partial ranking, which is the request's result.
  reply({ id: 1, result: { phase: '3', candidates: [], stopped: true } });
  assert.deepEqual(await running, { phase: '3', candidates: [], stopped: true });
  // A signal aborted after the ranking finished posts nothing.
  const second = new AbortController();
  const done = Promise.resolve(rank({ n: 2 }, '3', undefined, undefined, second.signal));
  reply({ id: 2, result: { phase: '3', candidates: [] } });
  await done;
  const before = posted.length;
  second.abort();
  assert.equal(posted.length, before);
});

test('the browser edition stores a cancelled ranking as partial, and nothing for an empty one', async () => {
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
  let checked = 2;
  const stops: (AbortSignal | undefined)[] = [];
  const api = createBrowserApi(
    store,
    calculate,
    {} as Catalog,
    (planSettings, phase, _progress, scope, stop) => {
      stops.push(stop);
      let asked = 0;
      return rankAlternates(planSettings, {
        phase,
        ...scope,
        shouldStop: () => ++asked > checked,
      });
    },
  );
  const controller = new AbortController();
  const post = (body: unknown) =>
    api('/api/rank-alternates', { body: JSON.stringify(body), stop: controller.signal });
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'Cancel', name: 'All', settings: SETTINGS }),
  });
  const partial = (await post(RANK)) as StoredPayoff;
  assert.equal(stops[0], controller.signal, 'the signal reaches the ranker');
  assert.equal(partial.ranking.stopped, true);
  assert.equal(partial.ranking.candidates.length, 2);
  assert.deepEqual(((await api('/api/context')) as ContextReply).payoff, partial, 'stored');
  // Cancelled before the first alternate: the reply is empty and the stored ranking stays.
  checked = 0;
  const empty = (await post(RANK)) as StoredPayoff;
  assert.equal(empty.ranking.candidates.length, 0);
  assert.deepEqual(((await api('/api/context')) as ContextReply).payoff, partial, 'kept');
});

test('the server reports a ranking’s progress and cancels it, replying with the partial ranking', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rank-cancel-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const created = await (
      await post('/api/profiles', { saveName: 'Rank', name: 'All', settings: SETTINGS })
    ).json();
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const progress = async () =>
      (await (await fetch(url + '/api/rank-progress', { headers })).json()) as {
        running: boolean;
        done?: number;
        total?: number;
      };
    assert.deepEqual(await progress(), { running: false });
    assert.deepEqual(await (await post('/api/rank-cancel', {}, headers)).json(), {
      cancelled: false,
    });

    const ranking = post('/api/rank-alternates', RANK, headers);
    // Wait for it to report a first alternate checked.
    let seen = await progress();
    for (let i = 0; i < 200 && !(seen.running && (seen.done ?? 0) >= 1); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      seen = await progress();
    }
    assert.equal(seen.running, true);
    assert.ok((seen.done ?? 0) >= 1);
    assert.ok((seen.total ?? 0) > (seen.done ?? 0), 'not finished yet');
    // A second ranking of the same profile meanwhile is refused.
    const second = await post('/api/rank-alternates', RANK, headers);
    assert.equal(second.status, 409);

    assert.deepEqual(await (await post('/api/rank-cancel', {}, headers)).json(), {
      cancelled: true,
    });
    const response = await ranking;
    assert.equal(response.status, 200, await response.clone().text());
    const stored = (await response.json()) as StoredPayoff;
    assert.equal(stored.ranking.stopped, true);
    assert.ok(stored.ranking.candidates.length >= 1);
    assert.ok(stored.ranking.candidates.length < stored.ranking.total);
    const context = (await (await fetch(url + '/api/context', { headers })).json()) as ContextReply;
    assert.equal(context.payoff?.ranking.candidates.length, stored.ranking.candidates.length);
    assert.deepEqual(await progress(), { running: false }, 'the job is gone');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the server ranking thread reports progress to its handle and honours a cancel', async () => {
  const { rankHandle, rankOffThread } = await import('../server/ranking.ts');
  const handle = rankHandle();
  const options = { phase: '1' as const, budgetMs: Infinity, remaining: true, hunting: true };
  const running: Promise<AlternateRanking> = rankOffThread({ settings: SETTINGS, options }, handle);
  assert.equal(handle.queued, false, 'a free thread starts it at once');
  for (let i = 0; i < 200 && handle.done < 1; i++)
    await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(handle.done >= 1);
  assert.ok(handle.total > handle.done);
  handle.cancel();
  const ranking = await running;
  assert.equal(ranking.stopped, true);
  assert.ok(ranking.candidates.length < ranking.total);
});

// A cancelled ranking does not replace a complete one (#1363 review).
const stored = (stopped: boolean, checked: number, phases?: StageKey[]): StoredPayoff => ({
  planCreatedAt: 'plan-1',
  rankedAt: '2026-11-11T12:00:00Z',
  ranking: {
    phase: '3',
    ...(phases ? { phases } : {}),
    base: { buildings: 1, rawTotal: 1, requiredMW: 1, hours: 1 },
    candidates: Array.from({ length: checked }, () => ({}) as AlternatePayoff),
    total: 9,
    stopped,
    elapsedMs: 1,
  },
});

test('keptRanking keeps a complete ranking of the same plan and phases against a cancelled one only', () => {
  const plan = { createdAt: 'plan-1' } as StoredCalculatedPlan;
  const profile = (payoff?: StoredPayoff) => ({ plan, payoff });
  const complete = profile(stored(false, 9));
  const cancelled = stored(true, 2).ranking;
  assert.equal(keptRanking(complete, cancelled, true), complete.payoff);
  // Not cancelled (the time limit), or not cut short: replaced as before.
  assert.equal(keptRanking(complete, cancelled, false), null);
  assert.equal(keptRanking(complete, stored(false, 9).ranking, true), null);
  // A partial one stored before is replaced by the new partial one.
  assert.equal(keptRanking(profile(stored(true, 5)), cancelled, true), null);
  // None, one for another plan, or one over other phases is replaced.
  assert.equal(keptRanking(profile(), cancelled, true), null);
  assert.equal(
    keptRanking({ plan, payoff: { ...stored(false, 9), planCreatedAt: 'old' } }, cancelled, true),
    null,
  );
  assert.equal(keptRanking(profile(stored(false, 9, ['3', '4'])), cancelled, true), null);
  const same = profile(stored(false, 9, ['3']));
  assert.equal(keptRanking(same, cancelled, true), same.payoff);
});

test('the browser edition keeps a complete ranking when a re-rank is cancelled, and replaces a partial one', async () => {
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
  let checked = Infinity;
  const api = createBrowserApi(
    store,
    calculate,
    {} as Catalog,
    (planSettings, phase, _progress, scope) => {
      let asked = 0;
      return rankAlternates(planSettings, { phase, ...scope, shouldStop: () => ++asked > checked });
    },
  );
  const post = (stop?: AbortSignal) =>
    api('/api/rank-alternates', { body: JSON.stringify(RANK), stop }) as Promise<RankReply>;
  const context = async () => ((await api('/api/context')) as ContextReply).payoff;
  await api('/api/profiles', {
    body: JSON.stringify({ saveName: 'Keep', name: 'All', settings: SETTINGS }),
  });
  const complete = await post();
  assert.equal(complete.ranking.stopped, false);
  // Re-rank, cancelled after 2 alternates: the reply is the complete ranking, which stays stored.
  checked = 2;
  const controller = new AbortController();
  controller.abort();
  const again = await post(controller.signal);
  assert.equal(again.kept, true);
  assert.equal(again.ranking.stopped, false);
  assert.equal(again.rankedAt, complete.rankedAt);
  assert.deepEqual(await context(), complete);
  // The time limit (no cancel) still replaces it, as before.
  const limited = await post();
  assert.equal(limited.kept, undefined);
  assert.equal(limited.ranking.stopped, true);
  // A partial ranking stored before is replaced by a cancelled one.
  checked = 3;
  const next = await post(controller.signal);
  assert.equal(next.kept, undefined);
  assert.equal(next.ranking.candidates.length, 3);
  assert.deepEqual(await context(), next);
});

// A server on a temporary directory, with a POST helper that sends the CSRF header.
async function withServer(run: (url: string, post: Poster) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rank-extra-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post: Poster = (endpoint, body, headers = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  try {
    await run(url, post);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}
type Poster = (
  endpoint: string,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<Response>;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('the server keeps a complete ranking when a re-rank is cancelled', async () => {
  await withServer(async (url, post) => {
    const created = await (
      await post('/api/profiles', { saveName: 'Keep', name: 'All', settings: SETTINGS })
    ).json();
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const complete = (await (
      await post('/api/rank-alternates', RANK, headers)
    ).json()) as RankReply;
    assert.equal(complete.ranking.stopped, false);
    const again = post('/api/rank-alternates', RANK, headers);
    for (let i = 0; i < 200; i++) {
      const seen = await (await fetch(url + '/api/rank-progress', { headers })).json();
      if (seen.running && seen.done >= 1) break;
      await pause(50);
    }
    await post('/api/rank-cancel', {}, headers);
    const reply = (await (await again).json()) as RankReply;
    assert.equal(reply.kept, true);
    assert.equal(reply.ranking.stopped, false);
    assert.equal(reply.rankedAt, complete.rankedAt);
    const context = (await (await fetch(url + '/api/context', { headers })).json()) as ContextReply;
    assert.deepEqual(context.payoff, complete, 'the complete ranking is still stored');
  });
});

test('the progress and cancel routes answer for the profile they name, not for another', async () => {
  await withServer(async (url, post) => {
    const first = await (
      await post('/api/profiles', { saveName: 'Scope', name: 'One', settings: SETTINGS })
    ).json();
    const second = await (
      await post('/api/profiles', { saveId: first.saveId, name: 'Two', settings: SETTINGS })
    ).json();
    const one = { 'X-Save-Id': first.saveId, 'X-Profile-Id': first.profileId };
    const two = { 'X-Save-Id': first.saveId, 'X-Profile-Id': second.profileId };
    const ranking = post('/api/rank-alternates', RANK, one);
    const progress = async (headers: Record<string, string>) =>
      (await fetch(url + '/api/rank-progress', { headers })).json();
    for (let i = 0; i < 200 && !(await progress(one)).running; i++) await pause(50);
    assert.equal((await progress(one)).running, true);
    assert.deepEqual(await progress(two), { running: false });
    assert.deepEqual(await (await post('/api/rank-cancel', {}, two)).json(), { cancelled: false });
    assert.equal((await progress(one)).running, true, 'the other profile cancelled nothing');
    assert.deepEqual(await (await post('/api/rank-cancel', {}, one)).json(), { cancelled: true });
    await ranking;
  });
});
