// Planner's choice's picks are recipes to hunt, not owned (#1058). Before, a new profile carried
// from another one with "Treat this plan's alternate recipes as unlocked" (on by default) ticked
// the unlock step of every pick, so after Planner's choice all of them looked owned and the
// hard-drive hunt steps showed as done. settings.plannerPicks (the picks Planner's choice made and
// the user left as they were) now keeps those steps open; recipes the user ticked themselves
// still count as owned, and a plan stored before the field counts every pick, as before. Both
// editions, through their real routes (POST /api/profiles with carryFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';
import { calculate, settings as normalised } from '../planner.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { phaseSteps } from '../public/progression.ts';
import { initialState, pickedRecipeUnlocks } from '../public/state.ts';
import type {
  BrowserWorkspace,
  Catalog,
  CurrentCalculatedPlan,
  Progression,
  SaveExport,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
// The hard-drive alternates an all-alternates Phase 3 plan uses there, as Planner's choice ticks.
const BASE = { phase: '3', mamRecipes: true };
const allPlan = calculate({ ...BASE, recipes: 'all' });
const PICKS = [
  ...new Set((allPlan.stages['3']!.rows || []).filter(row => row.alternate).map(row => row.id)),
]
  .filter(id => !id.includes(':'))
  .sort();
const [OWN, ...HUNT] = PICKS;
// Planner's choice's ticks, of which the user ticked the first again themselves.
const chosen = { ...BASE, recipes: 'custom', alternateRecipes: PICKS, plannerPicks: HUNT };
// The same picks from a release before #1058: no plannerPicks.
const before = { ...BASE, recipes: 'custom', alternateRecipes: PICKS };

test('#1058: the picks setting keeps only picks, sorted, and is absent otherwise', () => {
  assert.ok(PICKS.length >= 3, PICKS.join());
  assert.deepEqual(normalised(chosen).plannerPicks, HUNT);
  assert.deepEqual(
    normalised({ ...chosen, plannerPicks: [...HUNT].reverse() }).plannerPicks,
    HUNT,
    'sorted',
  );
  assert.deepEqual(
    normalised({ ...chosen, plannerPicks: [HUNT[0], 'Recipe_Alternate_Nonsense_C', 7] })
      .plannerPicks,
    [HUNT[0]],
    'only picks',
  );
  for (const none of [undefined, [], 'x', null, {}])
    assert.equal('plannerPicks' in normalised({ ...chosen, plannerPicks: none }), false);
  // The planner does not read it: the plan is the same with or without.
  assert.deepEqual(
    JSON.parse(JSON.stringify(calculate(chosen).stages)),
    JSON.parse(JSON.stringify(calculate(before).stages)),
  );
});

test("#1058: Planner's choice picks are not among the unlocks a carry ticks", () => {
  const plan = calculate(chosen);
  assert.deepEqual(pickedRecipeUnlocks(plan), [OWN]);
  // A plan stored before #1058 counts every pick, as it did.
  assert.deepEqual(pickedRecipeUnlocks(calculate(before)), PICKS);
});

// The source profile: a Standard plan for the same world, nothing ticked.
const exported = (name: string): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-11T09:00:00.000Z',
  saves: [
    {
      id: 's',
      name,
      activeProfile: 'p',
      profiles: [
        {
          id: 'p',
          name: 'Standard',
          kind: 'calculated',
          plan: calculate(BASE),
          state: initialState(),
        },
      ],
    },
  ],
});
// The hard-drive hunt of Phase 3 and its recipe steps in a carried profile.
function hunt(plan: StoredCalculatedPlan, checks: Record<string, boolean>) {
  const steps = phaseSteps(plan, { checks }, data, '3');
  const huntStep = steps.find(step => step.id === 'hard-drives-3');
  assert.ok(huntStep, 'Phase 3 lists the hard-drive hunt');
  return {
    satisfied: !!huntStep.satisfied || checks['hard-drives-3'] === true,
    owned: PICKS.filter(id => checks['recipe-unlock-' + id] === true),
  };
}
type Post = (route: string, body: unknown, headers?: Record<string, string>) => Promise<any>;
interface Made {
  plan: CurrentCalculatedPlan;
  state: { checks: Record<string, boolean> };
}
async function carried(post: Post, read: () => Promise<SaveExport>, settings: object) {
  const name = 'World ' + Math.random();
  await post('/api/import-saves', exported(name));
  const save = (await read()).saves.find(x => x.name.startsWith(name))!;
  const source = save.profiles[0]!.id;
  await post(
    '/api/profiles',
    { saveId: save.id, name: 'Picked', settings, carryFrom: source },
    { 'X-Save-Id': save.id, 'X-Profile-Id': source },
  );
  const all = await read();
  const made = all.saves
    .find(x => x.id === save.id)!
    .profiles.find(p => p.name === 'Picked') as unknown as Made;
  return hunt(made.plan, made.state.checks);
}

test("#1058: the Docker edition keeps the hunt for Planner's choice picks", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-picks-'));
  const server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post: Post = async (route, body, headers = {}) => {
    const response = await fetch(url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1', ...headers },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, route + ': ' + (await response.clone().text()));
    return response.json();
  };
  const read = async () => (await fetch(url + '/api/export-saves')).json();
  try {
    assert.deepEqual(await carried(post, read, chosen), { satisfied: false, owned: [OWN] });
    // Before #1058's field every pick counted as owned, and the hunt was done.
    assert.deepEqual(await carried(post, read, before), { satisfied: true, owned: PICKS });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("#1058: the Pages edition keeps the hunt for Planner's choice picks", async () => {
  let workspace: BrowserWorkspace = { version: 1, activeSave: null, saves: [], lastBackup: null };
  const store = {
    async transaction<T>(change?: (workspace: BrowserWorkspace) => T): Promise<T> {
      const copy = structuredClone(workspace);
      if (!change) return copy as T;
      const result = change(copy);
      workspace = copy;
      return structuredClone(result);
    },
  };
  const api = createBrowserApi(store, calculate, {} as Catalog);
  const post: Post = (route, body, headers = {}) =>
    api(route, { body: JSON.stringify(body), headers }) as Promise<any>;
  const read = async () => (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(await carried(post, read, chosen), { satisfied: false, owned: [OWN] });
  assert.deepEqual(await carried(post, read, before), { satisfied: true, owned: PICKS });
});
