// The hard-drive ranking over the remaining phases, with the hunting alternates (#1075):
// rankAlternates' `remaining` and `hunting` options, which the plan page's ranking sends. A hunting
// recipe (allowed but not owned) is tried without it, so its deltas are what finding it saves; the
// figures are summed over the shown phase and every later one, with the buildings per phase. A
// request without the options ranks exactly as before. Both editions pass them through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { seedLegacy } from './helpers/seed.ts';
import { createBrowserApi, workerJobs, type CalculatorWorker } from '../public/browser-api.ts';
import { calculate, rankAlternates } from '../planner.ts';
import { rankScope } from '../public/state.ts';
import type {
  BrowserWorkspace,
  Catalog,
  RankScope,
  StageKey,
  StoredPayoff,
} from '../public/types/index.ts';

const CAST_SCREWS = 'Recipe_Alternate_Screw_C',
  STITCHED = 'Recipe_Alternate_ReinforcedIronPlate_2_C';
// Cast Screws hunting, Stitched Iron Plate owned.
const settings = {
  phase: '1',
  goal: 'minimal',
  recipes: 'custom',
  alternateRecipes: [CAST_SCREWS],
  plannerPicks: [CAST_SCREWS],
  ownedAlternates: [STITCHED],
  mamRecipes: true,
};
const buildings = (plan: ReturnType<typeof calculate>, phases: StageKey[]) =>
  phases.reduce(
    (sum, key) => sum + plan.stages[key]!.rows!.reduce((total, row) => total + row.machines, 0),
    0,
  );

test('#1075: a hunting recipe is ranked by what finding it saves, over the remaining phases', () => {
  const ranking = rankAlternates(settings, { phase: '1', remaining: true, hunting: true });
  const phases = ranking.phases!;
  assert.equal(phases[0], '1');
  assert.ok(phases.length > 1, phases.join());
  const hunt = ranking.candidates.find(c => c.id === CAST_SCREWS)!;
  assert.equal(hunt.hunting, true);
  // The plan with it minus the plan without it, summed over the phases.
  const base = calculate(settings);
  const without = calculate({ ...settings, alternateRecipes: [], plannerPicks: [] });
  assert.equal(hunt.buildings, buildings(base, phases) - buildings(without, phases));
  assert.equal(ranking.base.buildings, buildings(base, phases));
  assert.equal(
    Object.values(hunt.byPhase!).reduce((sum, value) => sum + value!, 0),
    hunt.buildings,
    'the phases add up',
  );
  assert.deepEqual(Object.keys(hunt.byPhase!), phases);
  // Owned alternates are never ranked; the others are, as additions.
  assert.ok(!ranking.candidates.some(c => c.id === STITCHED));
  const additions = ranking.candidates.filter(c => !c.hunting);
  assert.ok(additions.length > 0);
  assert.equal(ranking.total, additions.length + 1);
  // Without the options: the same additions over Phase 1 alone, no hunting entry, no phases.
  const before = rankAlternates(settings, { phase: '1' });
  assert.equal(before.phases, undefined);
  assert.ok(before.candidates.every(c => c.hunting === undefined && c.byPhase === undefined));
  assert.deepEqual(
    before.candidates.map(c => c.id),
    additions.map(c => c.id),
  );
  // Under All every alternate not owned is hunting; Standard has none.
  const all = rankAlternates(
    { ...settings, recipes: 'all' },
    { phase: '1', hunting: true, budgetMs: -1 },
  );
  assert.ok(all.total > 1 && all.candidates.length === 0, 'all hunting, none added');
  assert.equal(
    rankAlternates(
      { ...settings, recipes: 'standard' },
      { phase: '1', hunting: true, budgetMs: -1 },
    ).total,
    rankAlternates({ ...settings, recipes: 'standard' }, { phase: '1', budgetMs: -1 }).total,
  );
});

test('#1075: only true options count, in both editions and on the worker', async () => {
  assert.deepEqual(rankScope({ remaining: true, hunting: true }), {
    remaining: true,
    hunting: true,
  });
  assert.deepEqual(rankScope({ remaining: 'yes', hunting: 1 }), {});
  // The server.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-hunting-'));
  await seedLegacy(dir);
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = async (endpoint: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  try {
    const created = await post('/api/profiles', { saveName: 'Hunt', name: 'Minimal', settings });
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const payoff: StoredPayoff = await post(
      '/api/rank-alternates',
      { phase: '1', remaining: true, hunting: true },
      headers,
    );
    assert.ok(payoff.ranking.phases!.length > 1);
    assert.ok(payoff.ranking.candidates.some(c => c.id === CAST_SCREWS && c.hunting));
    const plain: StoredPayoff = await post(
      '/api/rank-alternates',
      { phase: '1', remaining: 'yes' },
      headers,
    );
    assert.equal(plain.ranking.phases, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
  // The browser edition hands them to its ranker.
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
  const scopes: (RankScope | undefined)[] = [];
  const api = createBrowserApi(store, calculate, {} as Catalog, (planSettings, phase, _, scope) => {
    scopes.push(scope);
    return rankAlternates(planSettings, { phase, ...scope, budgetMs: -1 });
  });
  const browserPost = (route: string, body: unknown) => api(route, { body: JSON.stringify(body) });
  await browserPost('/api/profiles', { saveName: 'Hunt', name: 'Minimal', settings });
  const ranked = (await browserPost('/api/rank-alternates', {
    phase: '1',
    remaining: true,
    hunting: true,
  })) as StoredPayoff;
  assert.ok(ranked.ranking.phases!.length > 1);
  await browserPost('/api/rank-alternates', { phase: '1' });
  assert.deepEqual(scopes, [{ remaining: true, hunting: true }, {}]);
  // The worker job carries them.
  const posted: { rank?: object }[] = [];
  const worker: CalculatorWorker = {
    onmessage: null,
    onerror: null,
    postMessage: message => posted.push(message as { rank?: object }),
    terminate: () => {},
  };
  void Promise.resolve(
    workerJobs(() => worker, 1000).rank(settings, '1', undefined, {
      remaining: true,
      hunting: true,
    }),
  ).catch(() => {});
  assert.deepEqual(posted[0]!.rank, {
    phase: '1',
    budgetMs: 120000,
    remaining: true,
    hunting: true,
  });
});
