// The Docker edition ranks the hard-drive payoff on a worker thread (#1156, server/ranking.ts):
// the server answers other requests while a ranking runs, a refusal keeps its status, and a
// profile recalculated meanwhile keeps its new plan while the ranking is refused (409).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { rankOffThread } from '../server/ranking.ts';
import { rankAlternates } from '../planner.ts';
import { seedLegacy } from './helpers/seed.ts';
import type { ContextReply, StageKey } from '../public/types/index.ts';

// Every alternate allowed: each of the Phase 1 alternates is ranked as a hunting one, which takes
// seconds, not milliseconds.
const SETTINGS = { phase: '1', goal: 'minimal', recipes: 'all', mamRecipes: true };
const RANK = { phase: '1', remaining: true, hunting: true };

test('#1156: the ranking thread gives what rankAlternates gives, and its refusals', async () => {
  const options = { phase: '1' as const, budgetMs: Infinity, remaining: true, hunting: true };
  const onThread = await rankOffThread({ settings: SETTINGS, options });
  const direct = rankAlternates(SETTINGS, options);
  const figures = (ranking: typeof direct) =>
    ranking.candidates.map(({ id, status, buildings, hunting }) => ({
      id,
      status,
      buildings,
      hunting,
    }));
  assert.ok(onThread.total > 1);
  assert.deepEqual(figures(onThread), figures(direct));
  await assert.rejects(
    rankOffThread({ settings: SETTINGS, options: { ...options, phase: '9' as StageKey } }),
    { message: 'This phase has no plan to compare alternates against.', status: 400 },
  );
});

test('#1156: the server answers other requests while a ranking runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-rank-thread-'));
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
    const context = async (): Promise<ContextReply> =>
      (await fetch(url + '/api/context', { headers })).json();
    const plan = (await context()).plan!;

    // A ranking runs; meanwhile the server answers a health check and the profile's context.
    let ranked = false;
    const ranking = post('/api/rank-alternates', RANK, headers).then(response => {
      ranked = true;
      return response;
    });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await fetch(url + '/health')).status, 200);
    assert.equal((await context()).plan!.createdAt, plan.createdAt);
    assert.equal(ranked, false, 'answered before the ranking finished');
    const response = await ranking;
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await context()).payoff?.planCreatedAt, plan.createdAt, 'stored');

    // A profile recalculated in place while it ranks keeps its new plan; the ranking is refused.
    const again = post('/api/rank-alternates', RANK, headers);
    await new Promise(resolve => setTimeout(resolve, 400));
    const recalculated = await post(
      '/api/recalculate',
      {
        name: 'All',
        backupName: 'All (before edit)',
        settings: SETTINGS,
        planCreatedAt: plan.createdAt,
      },
      headers,
    );
    assert.equal(recalculated.status, 200, await recalculated.clone().text());
    const refused = await again;
    assert.equal(refused.status, 409);
    assert.equal(
      ((await refused.json()) as { error: string }).error,
      'The profile changed while ranking. Rank again.',
    );
    const after = await context();
    assert.notEqual(after.plan!.createdAt, plan.createdAt);
    assert.equal(after.payoff, null, 'no ranking of the plan before is stored on the new one');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
