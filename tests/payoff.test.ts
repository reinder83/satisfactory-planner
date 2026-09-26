// Hard-drive payoff storage (#203): POST /api/rank-alternates ranks on request and stores the
// result with the profile, GET /api/context returns it while it matches the plan, and exports
// leave it out, on the server and in the browser edition.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { createBrowserApi, workerJobs, type CalculatorWorker } from '../public/browser-api.ts';
import { calculate, rankAlternates } from '../planner.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  SaveExport,
  StoredPayoff,
  WorkspaceFile,
} from '../public/types/index.ts';

const settings = { phase: '1', goal: 'minimal' };
async function start(dir: string, rankBudgetMs?: number) {
  const server = await createApp({ dataDir: dir, password: '', rankBudgetMs });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (endpoint: string, b: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(b),
    });
  const close = () => new Promise(r => server.close(r));
  return { url, post, close };
}
const json = async (r: Response) => {
  assert.ok(r.ok, await r.clone().text());
  return r.json();
};

test('the server ranks on request, stores the result with the profile and keeps it out of exports', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-payoff-'));
  let app = await start(dir);
  try {
    const a = await json(
      await app.post('/api/profiles', { saveName: 'Payoff', name: 'Minimal', settings }),
    );
    const ah = { 'X-Save-Id': a.saveId, 'X-Profile-Id': a.profileId };
    const ctx = async (h: Record<string, string>): Promise<ContextReply> =>
      json(await fetch(app.url + '/api/context', { headers: h }));
    assert.equal((await ctx(ah)).payoff, null, 'a profile starts without a ranking');
    const payoff: StoredPayoff = await json(
      await app.post('/api/rank-alternates', { phase: '1' }, ah),
    );
    const plan = (await ctx(ah)).plan!;
    assert.equal(payoff.planCreatedAt, plan.createdAt);
    assert.equal(payoff.ranking.phase, '1');
    assert.ok(payoff.ranking.total > 0 && !payoff.ranking.stopped);
    assert.deepEqual(payoff.ranking.candidates.length, payoff.ranking.total);
    assert.deepEqual((await ctx(ah)).payoff, payoff, 'stored and read back');
    // Progress is not touched: no revision bump.
    assert.equal((await ctx(ah)).state.revision, 0);
    // Exports and shares leave it out.
    for (const q of ['', `?profile=${a.profileId}&share=1`]) {
      const exported = await json(await fetch(app.url + '/api/export-saves' + q));
      assert.ok(!JSON.stringify(exported).includes('"payoff"'), 'export ' + q);
    }
    // Refusals: a bad phase, and the original handbook profile.
    assert.equal((await app.post('/api/rank-alternates', { phase: '9' }, ah)).status, 400);
    const original = { 'X-Save-Id': 'original-save', 'X-Profile-Id': 'original' };
    assert.equal((await app.post('/api/rank-alternates', { phase: '3' }, original)).status, 400);
    await app.close();
    // After a restart it is still there; a ranking of an older plan is not shown.
    app = await start(dir);
    assert.deepEqual((await ctx(ah)).payoff, payoff);
    await app.close();
    const file = path.join(dir, 'workspace.json');
    const db: WorkspaceFile = JSON.parse(await fs.readFile(file, 'utf8'));
    const stored = db.saves.find(s => s.id === a.saveId)!.profiles[0]!;
    stored.payoff!.planCreatedAt = '2020-01-01T00:00:00.000Z';
    await fs.writeFile(file, JSON.stringify(db));
    app = await start(dir);
    assert.equal((await ctx(ah)).payoff, null, 'a stale ranking is not returned');
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a server ranking stops at its time budget and counts as five calculations', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-payoff-'));
  const app = await start(dir, 0);
  try {
    const a = await json(
      await app.post('/api/profiles', { saveName: 'Payoff', name: 'Minimal', settings }),
    );
    const ah = { 'X-Save-Id': a.saveId, 'X-Profile-Id': a.profileId };
    const first: StoredPayoff = await json(
      await app.post('/api/rank-alternates', { phase: '1' }, ah),
    );
    assert.equal(first.ranking.stopped, true);
    assert.equal(first.ranking.candidates.length, 0);
    assert.ok(first.ranking.total > 0);
    // Profile creation used 1 of the 20 a minute, each ranking 5: the fourth is refused.
    for (let i = 0; i < 2; i++)
      assert.equal((await app.post('/api/rank-alternates', { phase: '1' }, ah)).status, 200);
    assert.equal((await app.post('/api/rank-alternates', { phase: '1' }, ah)).status, 429);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition ranks through its ranker and stores the result the same way', async () => {
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
  const progress: number[][] = [];
  const api = createBrowserApi(store, calculate, {} as Catalog, (s, phase, onProgress) =>
    rankAlternates(s, { phase, ...(onProgress ? { onProgress } : {}) }),
  );
  const post = (route: string, body: unknown) =>
    api(route, { body: JSON.stringify(body), onRankProgress: (d, t) => progress.push([d, t]) });
  await post('/api/profiles', { saveName: 'Payoff', name: 'Minimal', settings });
  assert.equal(((await api('/api/context')) as ContextReply).payoff, null);
  const payoff = (await post('/api/rank-alternates', { phase: '1' })) as StoredPayoff;
  assert.equal(progress.length, payoff.ranking.total, 'progress after each candidate');
  assert.deepEqual(progress.at(-1), [payoff.ranking.total, payoff.ranking.total]);
  const profile = data.saves[0]!.profiles[0]!;
  assert.deepEqual(profile.payoff, payoff, 'stored in the record');
  assert.equal(payoff.planCreatedAt, profile.plan!.createdAt);
  assert.deepEqual(((await api('/api/context')) as ContextReply).payoff, payoff);
  // Exports leave it out and leave the record alone.
  const full = (await api('/api/export-saves')) as SaveExport;
  assert.ok(!JSON.stringify(full).includes('"payoff"'));
  assert.ok(data.saves[0]!.profiles[0]!.payoff);
  // An import of that export starts without one.
  await post('/api/import-saves', full);
  assert.equal(((await api('/api/context')) as ContextReply).payoff, null);
  await assert.rejects(post('/api/rank-alternates', { phase: 'x' }), /Choose a phase from 1 to 5/);
  // A ranking of another plan is not shown.
  data.saves[0]!.profiles[0]!.payoff!.planCreatedAt = 'older';
  await post('/api/select', { saveId: data.saves[0]!.id, profileId: profile.id });
  assert.equal(((await api('/api/context')) as ContextReply).payoff, null);
  // Without a ranker the route is refused.
  const bare = createBrowserApi(store, calculate, {} as Catalog);
  await assert.rejects(
    bare('/api/rank-alternates', { body: '{"phase":"1"}' }),
    /needs a self-hosted server/,
  );
});

test('a ranking runs as a job on the calculator worker, with per-candidate progress', async () => {
  const posted: unknown[] = [];
  const worker: CalculatorWorker = {
    onmessage: null,
    onerror: null,
    postMessage: m => posted.push(m),
    terminate: () => {},
  };
  const { rank } = workerJobs(() => worker, 1000);
  const seen: number[][] = [];
  const done = Promise.resolve(rank({ n: 1 }, '3', (d, t) => seen.push([d, t])));
  assert.deepEqual(posted, [{ id: 1, settings: { n: 1 }, rank: { phase: '3', budgetMs: 120000 } }]);
  const reply = (data: object) => worker.onmessage?.(new MessageEvent('message', { data }));
  reply({ id: 1, done: 1, total: 2 });
  reply({ id: 1, done: 2, total: 2 });
  reply({ id: 1, result: { phase: '3', candidates: [] } });
  assert.deepEqual(await done, { phase: '3', candidates: [] });
  assert.deepEqual(seen, [
    [1, 2],
    [2, 2],
  ]);
});
