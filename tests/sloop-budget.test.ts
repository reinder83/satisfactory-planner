// The somersloop budget is a hard limit (#1059, public/somersloops.ts): settings that commit more
// somersloops than the save has (10 per augmenter, 1 per hand-fed use, the amplification budget)
// are refused before anything is calculated, in both editions, while a plan stored before keeps
// its numbers. And the augmenter fuel verdict records what the fuel adds to Phase 5's grid
// (`gainMW`), which Review weighs against the demand it adds, like with like.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate, settings } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { sloopCommitment, sloopOverWords } from '../public/somersloops.ts';
import type {
  BrowserWorkspace,
  Catalog,
  ContextReply,
  CurrentCalculatedPlan,
} from '../public/types/index.ts';

// The issue's 191 of 106: ten augmenters, the three hand-fed uses and 88 for amplification.
const OVER = {
  somersloops: 106,
  augmenters: 10,
  sloopReserved: ['shards', 'dna', 'biofuel'],
  amplifySloops: 88,
};
const REFUSAL =
  'This plan commits 191 somersloops (100 for 10 Alien Power Augmenters, 3 parked in hand-fed lines and 88 for production amplification), but only 106 are available to spend. Raise “Somersloops available to spend”, or commit fewer: build fewer augmenters, park fewer in hand-fed lines or lower the amplification budget (All settings, step 2).';
const refused = (error: Error & { status?: number }) =>
  error.status === 400 && error.message === REFUSAL;

test('settings that commit more somersloops than the save has are refused, with what to change', () => {
  assert.throws(() => settings(OVER), refused);
  assert.throws(() => calculate({ phase: '5', ...OVER }), refused, 'before anything is calculated');
  // Each part counts on its own, against no somersloops at all as well.
  assert.throws(() => settings({ augmenters: 1 }), /commits 10 somersloops .* none are available/);
  assert.throws(() => settings({ amplifySloops: 24 }), /24 for production amplification/);
  assert.throws(() => settings({ sloopReserved: ['dna'] }), /commits 1 somersloop \(1 parked/);
  // To the last somersloop it fits, and settings without any commitment are as they were.
  assert.equal(settings({ ...OVER, amplifySloops: 3 }).somersloops, 106);
  assert.equal(settings({}).somersloops, 0);
  // The other refusals come first, as before.
  assert.throws(() => settings({ augmenters: 1, fueledAugmenters: 2 }), /fueled/i);
  assert.throws(() => settings({ augmenters: 11 }), /number from 0 to 10/);
});

test('the commitment is counted and worded once for the ledger, the refusal and the notice', () => {
  const commitment = sloopCommitment(OVER);
  assert.deepEqual(commitment, {
    available: 106,
    committed: 191,
    augmenters: 10,
    augmenterSloops: 100,
    parked: 3,
    amplify: 88,
    over: 85,
  });
  assert.equal(REFUSAL.startsWith(sloopOverWords(commitment)), true);
  assert.equal(sloopCommitment({}).committed, 0);
  assert.equal(sloopCommitment({ augmenters: 1, somersloops: 10 }).over, 0);
});

// The issue's first verdict: with a large installed generation the fuel's extra 20% adds far more
// power than its fuel line draws, while the plan, which does not need that power, builds more.
// gainMW is what the fuel adds, measured as Review compares it with the demand it adds.
test('the fuel verdict records what the fuel adds to the grid, in the demand’s unit and phase', () => {
  const plan = calculate({
    phase: '5',
    somersloops: 106,
    augmenters: 1,
    fueledAugmenters: 1,
    installedPowerGW: 500,
  });
  const stage = plan.stages[5],
    verdict = stage.fuelVerdict!;
  const base = stage.grid!.generationMW / (1 + stage.boost!) + 500_000 + 500;
  assert.ok(Math.abs(verdict.gainMW! - 0.2 * base) < 1e-6, 'the extra 20% on the base production');
  const cost = verdict.requiredMW - verdict.requiredMWUnfueled!;
  assert.ok(verdict.gainMW! > cost, `${verdict.gainMW} MW added against ${cost} MW of demand`);
  assert.equal(verdict.worthIt, false, 'and yet the plan builds more with the fuel');
  assert.ok(verdict.buildings > verdict.buildingsUnfueled!);
  // At an ordinary scale the fuel line draws more than the fuel adds.
  const small = calculate({ phase: '5', somersloops: 10, augmenters: 1, fueledAugmenters: 1 })
    .stages[5].fuelVerdict!;
  assert.ok(small.gainMW! < small.requiredMW - small.requiredMWUnfueled!);
});

const SETTINGS = { phase: '4', goal: 'minimal', wholeMachines: true };
// A plan stored before the budget was a hard limit: these settings, as a release before #1059
// could store them, with its numbers.
const overCommitted = (plan: CurrentCalculatedPlan): CurrentCalculatedPlan => {
  const stored = structuredClone(plan);
  Object.assign(stored.settings, { ...OVER, sloopReserved: ['biofuel', 'dna', 'shards'] });
  return stored;
};

test('the Docker server refuses an over-commitment and keeps a stored one as it is', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-sloops-'));
  let server = await createApp({ dataDir: dir, password: '' });
  const listen = async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const close = () => new Promise(resolve => server.close(resolve));
  let url = await listen();
  const post = (endpoint: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const preview = await post('/api/preview', { settings: { ...SETTINGS, ...OVER } });
    assert.equal(preview.status, 400);
    assert.match(await preview.text(), /commits 191 somersloops/);
    const create = await post('/api/profiles', {
      saveName: 'S',
      name: 'P',
      settings: { ...SETTINGS, ...OVER },
    });
    assert.equal(create.status, 400, 'no profile is made');
    const created = (await (
      await post('/api/profiles', { saveName: 'S', name: 'P', settings: SETTINGS })
    ).json()) as { saveId: string; profileId: string };
    await close();
    // The plan as a release before #1059 stored it, over its budget.
    const file = path.join(dir, 'workspace.json');
    const workspace = JSON.parse(await fs.readFile(file, 'utf8'));
    const profile = workspace.saves[0].profiles[0];
    profile.plan = overCommitted(profile.plan);
    const stored = structuredClone(profile.plan);
    await fs.writeFile(file, JSON.stringify(workspace));
    server = await createApp({ dataDir: dir, password: '' });
    url = await listen();
    const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
    const context = async () =>
      ((await (await fetch(url + '/api/context', { headers })).json()) as ContextReply).plan;
    assert.deepEqual(await context(), stored, 'it loads with its numbers');
    const recalculation = await post(
      '/api/recalculate',
      {
        name: 'P',
        backupName: 'P (before edit)',
        settings: stored.settings,
        planCreatedAt: stored.createdAt,
      },
      headers,
    );
    assert.equal(recalculation.status, 400);
    assert.match(await recalculation.text(), /commits 191 somersloops/);
    assert.deepEqual(await context(), stored, 'a refused recalculation changes nothing');
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition refuses an over-commitment and keeps a stored one as it is', async () => {
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
  const api = createBrowserApi(store, input => calculate(input), {} as Catalog);
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    api(route, { body: JSON.stringify(body), headers });
  await assert.rejects(post('/api/preview', { settings: { ...SETTINGS, ...OVER } }), refused);
  await assert.rejects(
    post('/api/profiles', { saveName: 'S', name: 'P', settings: { ...SETTINGS, ...OVER } }),
    refused,
  );
  assert.equal(data.saves.length, 0, 'no profile is made');
  const created = (await post('/api/profiles', {
    saveName: 'S',
    name: 'P',
    settings: SETTINGS,
  })) as { saveId: string; profileId: string };
  const profile = data.saves[0]!.profiles[0]!;
  profile.plan = overCommitted(profile.plan as CurrentCalculatedPlan);
  const stored = structuredClone(profile.plan);
  const headers = { 'X-Save-Id': created.saveId, 'X-Profile-Id': created.profileId };
  const context = async () => ((await api('/api/context', { headers })) as ContextReply).plan;
  assert.deepEqual(await context(), stored, 'it loads with its numbers');
  await assert.rejects(
    post(
      '/api/recalculate',
      {
        name: 'P',
        backupName: 'P (before edit)',
        settings: stored.settings,
        planCreatedAt: stored.createdAt,
      },
      headers,
    ),
    refused,
  );
  assert.deepEqual(await context(), stored, 'a refused recalculation changes nothing');
  assert.equal(data.saves[0]!.profiles.length, 1, 'and keeps no backup');
});
