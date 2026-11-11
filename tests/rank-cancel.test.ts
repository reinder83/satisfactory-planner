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
import { createBrowserApi, workerJobs, type CalculatorWorker } from '../public/browser-api.ts';
import { seedLegacy } from './helpers/seed.ts';
import type {
  AlternateRanking,
  BrowserWorkspace,
  Catalog,
  ContextReply,
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
