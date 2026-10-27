// Round up production and the hard-drive payoff ranking with a stale pin in the plan (#1273): both
// solve the stored plan's own settings, so a plan calculated with a Power Shard pin
// (`lineClocks`) or a somersloop pin (`sloopPins`) on a recipe a later game-data update removes
// (or, for somersloops, whose machine can no longer take them) failed with "Invalid line clocks."
// / "Invalid somersloop pins.". Both now leave those pins out (knownPlanSettings, as every
// recalculation does since #1271) and say so: round-up in the new plan's warnings, the ranking in
// its reply's `leftOut`, which is never stored. The other pins are planned and ranked as before,
// in both editions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, DATA, rankAlternates, settings } from '../planner.ts';
import { knownPlanSettings, recipeBook, roundUpInput, roundUpSettings } from '../public/state.ts';
import { staleRankNote, staleWarning } from '../public/state/stale-pins.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import type {
  BrowserWorkspace,
  LineClocks,
  RankReply,
  SloopPins,
  StoredCalculatedPlan,
  StoredPayoff,
} from '../public/types/index.ts';

const ROD = 'Recipe_IronRod_C';
const PLATE = 'Recipe_IronPlate_C';
// A recipe no game data has: as if an update removed it after the plan was calculated.
const GONE = 'Recipe_RemovedByAnUpdate_C';
// A recipe the game data has whose machine takes no somersloops.
const PACKAGER = DATA.recipes.find(recipe => recipe.machine === 'Packager' && !recipe.alternate)!;
// Under 'all' the ranking has no candidates, so it solves only the plan itself, quickly.
const BASE = {
  phase: '3',
  recipes: 'all',
  somersloops: 40,
  amplifySloops: 20,
  lineClocks: { '3': { [ROD]: 250 } },
  sloopPins: { '3': { [PLATE]: 1 } },
};
const book = recipeBook(catalog());
const KEPT_CLOCKS: LineClocks = BASE.lineClocks;
const KEPT_SLOOPS: SloopPins = BASE.sloopPins;
const STALE_CLOCKS: LineClocks = { '3': { [ROD]: 250, [GONE]: 200 } };
const STALE_SLOOPS: SloopPins = { '3': { [PLATE]: 1, [GONE]: 2, [PACKAGER.id]: 2 } };
const SLOOP_NAMES = [GONE, PACKAGER.id].sort().map(id => (id === GONE ? GONE : PACKAGER.name));
const SLOOP_REASON =
  'because this planner has no such recipe any more, or its machine can no longer take somersloops.';
const CLOCK_REASON = 'because this planner has no such recipe any more.';
const WARNINGS = [
  `This recalculation dropped the somersloop pins on ${SLOOP_NAMES.join(' in Phase 3 and ')} in Phase 3, ${SLOOP_REASON}`,
  `This recalculation dropped the Power Shard pin on ${GONE} in Phase 3, ${CLOCK_REASON}`,
];
const LEFT_OUT = [
  `This ranking left out the somersloop pins on ${SLOOP_NAMES.join(' in Phase 3 and ')} in Phase 3, ${SLOOP_REASON}`,
  `This ranking left out the Power Shard pin on ${GONE} in Phase 3, ${CLOCK_REASON}`,
];
// A ranking's figures, without the time it took.
const figures = ({ elapsedMs: _ms, ...ranking }: StoredPayoff['ranking']) => ranking;

test('settings without stale pins are the same settings; with them, the pins are named', () => {
  const plan = JSON.parse(JSON.stringify(calculate(settings(BASE)))) as StoredCalculatedPlan;
  const same = knownPlanSettings(plan, book, staleWarning);
  assert.equal(same.settings, plan.settings, 'the very same object');
  assert.deepEqual(same.stale, []);
  assert.deepEqual(roundUpInput(plan, book), {
    settings: roundUpSettings(plan.settings),
    stale: [],
  });
  const stale = { ...plan, settings: { ...plan.settings, lineClocks: STALE_CLOCKS } };
  stale.settings.sloopPins = STALE_SLOOPS;
  assert.deepEqual(knownPlanSettings(stale, book, staleRankNote), {
    settings: plan.settings,
    stale: LEFT_OUT,
  });
  // A kind left with no pins goes, as sloopPinsSettings leaves it out.
  const only = { ...plan, settings: { ...plan.settings, sloopPins: { '3': { [GONE]: 2 } } } };
  assert.equal('sloopPins' in knownPlanSettings(only, book, staleWarning).settings, false);
  // Without a catalog nothing is dropped for want of one.
  assert.equal(knownPlanSettings(stale, new Map(), staleWarning).settings, stale.settings);
});

type Context = { profile: { id: string }; plan: StoredCalculatedPlan };

// One edition: a profile calculated with the two kept pins, whose stored plan then also holds
// stale pins of both kinds (`stale` writes them, as a plan calculated before the game data lost
// the recipe has them). Round-up and the ranking succeed, name the stale pins, and give what the
// plan without them gives.
async function checkEdition(
  request: (route: string, body?: unknown) => Promise<unknown>,
  stale: () => Promise<void>,
) {
  await request('/api/profiles', { saveName: 'World', name: 'Stale', settings: BASE });
  const clean = (await request('/api/context')) as Context;
  assert.deepEqual(clean.plan.settings.lineClocks, KEPT_CLOCKS, 'calculated with the kept pins');
  assert.deepEqual(clean.plan.settings.sloopPins, KEPT_SLOOPS);
  await stale();
  const before = (await request('/api/context')) as Context;
  assert.deepEqual(before.plan.settings.lineClocks, STALE_CLOCKS, 'the plan holds stale pins');
  assert.deepEqual(before.plan.settings.sloopPins, STALE_SLOOPS);

  // The ranking: the plan without the stale pins, which the reply names; the stored payoff
  // leaves them out.
  const reply = (await request('/api/rank-alternates', { phase: '3' })) as RankReply;
  assert.deepEqual(reply.leftOut, LEFT_OUT);
  assert.deepEqual(
    figures(reply.ranking),
    figures(rankAlternates(clean.plan.settings, { phase: '3' })),
    'ranked as the plan with only the other pins',
  );
  const stored = (await request('/api/context')) as { payoff: StoredPayoff };
  assert.equal('leftOut' in stored.payoff, false, 'never stored');
  assert.deepEqual(stored.payoff.ranking, reply.ranking);

  // Round-up: a new plan without the stale pins, which its warnings name.
  const done = (await request('/api/round-up', {})) as { profileId: string };
  assert.notEqual(done.profileId, before.profile.id, 'a new profile');
  const rounded = (await request('/api/context')) as Context;
  assert.equal(rounded.profile.id, done.profileId);
  assert.deepEqual(rounded.plan.settings.lineClocks, KEPT_CLOCKS, 'the other pins are kept');
  assert.deepEqual(rounded.plan.settings.sloopPins, KEPT_SLOOPS);
  assert.equal(rounded.plan.settings.wholeMachines, true);
  const expected = calculate(roundUpSettings(clean.plan.settings));
  assert.deepEqual(
    rounded.plan.stages,
    JSON.parse(JSON.stringify(expected.stages)),
    'planned as the plan with only the other pins',
  );
  assert.deepEqual(rounded.plan.warnings, [...expected.warnings, ...WARNINGS], 'never silently');
}

// The stored plan, given the stale pins.
const withStalePins = (plan: { settings: { lineClocks?: LineClocks; sloopPins?: SloopPins } }) => {
  plan.settings.lineClocks = STALE_CLOCKS;
  plan.settings.sloopPins = STALE_SLOOPS;
};

test('the Docker server rounds up and ranks a plan with stale pins', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'satisfactory-stale-roundup-'));
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
    const reply = await res.json();
    assert.ok(res.ok, `${route} ${res.status} ${JSON.stringify(reply)}`);
    return reply;
  };
  await listen();
  try {
    await checkEdition(request, async () => {
      await close();
      const file = path.join(dir, 'workspace.json');
      const workspace = JSON.parse(await fsp.readFile(file, 'utf8'));
      withStalePins(workspace.saves[0].profiles[0].plan);
      await fsp.writeFile(file, JSON.stringify(workspace));
      await listen();
    });
  } finally {
    await close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the browser edition rounds up and ranks a plan with stale pins', async () => {
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
  const api = createBrowserApi(store, calculate, catalog(), async (planSettings, phase) =>
    rankAlternates(planSettings, { phase }),
  );
  await checkEdition(
    (route, body) => api(route, body === undefined ? undefined : { body: JSON.stringify(body) }),
    async () => {
      withStalePins(data.saves[0]!.profiles[0]!.plan!);
    },
  );
});
