// What a plan keeps lowest (#1180, the second slice of #1079): settings.objective, 'power', 'raw'
// or a weighted mix of whole weights from 0 to 10 for buildings, power and raw resources, prices
// the LP's lines and raw sources (lineCost and sourceCost in planner/model.ts). It belongs to the
// plan snapshot, like recipeCost: absent for the fewest buildings, so such a plan, and every plan
// stored before it, calculates, loads, imports and exports exactly as before, in both editions.
// Nothing recalculates a plan for it: the pages and Review name the objective a plan was
// calculated with.
import './helpers/en-us-numbers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { calculate, catalog, settings } from '../planner.ts';
import { lineCost, sourceCost } from '../planner/model.ts';
import { recipePool } from '../planner/recipes.ts';
import { powerView } from '../public/power.ts';
import {
  OBJECTIVES,
  objectiveKind,
  objectiveWeights,
  objectiveWords,
} from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createApp } from '../server.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { defaultProfileName, profileSummary, settingsChanges } from '../public/app/profile-edit.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { browserProfile, dockerProfile, newSaveRequest } from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  SaveExport,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A plan without the time it was made, which is all that differs between two calculations.
const timeless = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) =>
  JSON.stringify({ ...plan, createdAt: '' });
const REFUSAL =
  'Choose what the plan keeps lowest: buildings, power, raw resources, or a weighted mix with whole weights from 0 to 10, at least one above 0.';

test('settings keep power, raw or a weighted mix, leave out the fewest buildings, and refuse any other value', () => {
  assert.equal('objective' in settings({}), false, 'absent unless chosen');
  assert.equal('objective' in settings({ objective: 'buildings' }), false, 'the default: absent');
  assert.equal(settings({ objective: 'power' }).objective, 'power');
  assert.equal(settings({ objective: 'raw' }).objective, 'raw');
  // The weights are copied in a fixed order, so equal choices give equal settings.
  assert.equal(
    JSON.stringify(settings({ objective: { raw: 1, power: 0, buildings: 10 } }).objective),
    '{"buildings":10,"power":0,"raw":1}',
  );
  for (const wrong of [
    'Power',
    'weighted',
    '',
    null,
    0,
    true,
    ['power'],
    {},
    { buildings: 0, power: 0, raw: 0 },
    { buildings: 1, power: 1 },
    { buildings: 1, power: 1, raw: 1, hours: 1 },
    { buildings: 11, power: 1, raw: 1 },
    { buildings: -1, power: 1, raw: 1 },
    { buildings: 1.5, power: 1, raw: 1 },
    { buildings: '1', power: 1, raw: 1 },
    { buildings: Number.NaN, power: 1, raw: 1 },
    { buildings: Infinity, power: 1, raw: 1 },
  ])
    assert.throws(
      () => settings({ objective: wrong }),
      (error: Error & { status?: number }) => error.status === 400 && error.message === REFUSAL,
      JSON.stringify(wrong),
    );
});

test('the objective in words, and the weights the LP prices it with', () => {
  assert.deepEqual(
    OBJECTIVES.map(([id, label]) => [id, label]),
    [
      ['buildings', 'Fewest buildings (default)'],
      ['power', 'Least power'],
      ['raw', 'Least raw resources'],
      ['weighted', 'Weighted mix'],
    ],
  );
  assert.equal(objectiveWeights(undefined), null, 'the fewest buildings keeps the old costs');
  assert.deepEqual(objectiveWeights('power'), { buildings: 0, power: 1, raw: 0 });
  assert.deepEqual(objectiveWeights('raw'), { buildings: 0, power: 0, raw: 1 });
  const mix = { buildings: 2, power: 1, raw: 0 };
  assert.equal(objectiveWeights(mix), mix);
  assert.deepEqual(
    [undefined, 'power', 'raw', mix].map(objective => [
      objectiveKind(objective as never),
      objectiveWords(objective as never),
      objectiveWords(objective as never, true),
    ]),
    [
      ['buildings', 'Fewest buildings', 'fewest buildings'],
      ['power', 'Least power', 'least power'],
      ['raw', 'Least raw resources', 'least raw resources'],
      [
        'weighted',
        'Weighted mix (buildings 2, power 1, raw 0)',
        'weighted mix (buildings 2, power 1, raw 0)',
      ],
    ],
  );
});

test('the LP’s costs: the old ones for the fewest buildings, else the weights per building, 10 MW and 10 raw items', () => {
  const pool = recipePool(settings({ recipes: 'all' }), 5, false);
  const smelter = pool.find(recipe => recipe.id === 'Recipe_IngotIron_C')!;
  assert.ok(smelter.power > 0);
  const plain = settings({}),
    power = settings({ objective: 'power' }),
    raw = settings({ objective: 'raw' }),
    mix = settings({ objective: { buildings: 2, power: 3, raw: 4 } });
  // The fewest buildings: one per machine-equivalent plus the tiny power tie-break, exactly as
  // before, and a raw source its tiny cost.
  assert.equal(lineCost(plain, smelter, 40), 1 + smelter.power / 100000);
  assert.equal(sourceCost(plain, 'Iron Ore', 0.1, 0.0001), 0.0001);
  // Least power: a hundredth of a building (fewer buildings break a tie) plus 1 per 10 MW drawn.
  assert.equal(lineCost(power, smelter, 40), 0.01 + smelter.power / 100000 + 4);
  assert.equal(lineCost(power, smelter, -75), 0.01 + smelter.power / 100000, 'generation is free');
  assert.equal(sourceCost(power, 'Iron Ore', 0.5, 0.0001), 0.0001 + 0.05);
  // Least raw resources: 1 per 10 items mined, Water never.
  assert.equal(lineCost(raw, smelter, 40), 0.01 + smelter.power / 100000);
  assert.equal(sourceCost(raw, 'Iron Ore', 0.5, 0.0001), 0.0001 + 0.1);
  assert.equal(sourceCost(raw, 'Water', 0.5, 0.0001), 0.0001);
  // A mix adds each weight's part.
  assert.equal(lineCost(mix, smelter, 40), 2 + smelter.power / 100000 + 12);
  assert.equal(sourceCost(mix, 'Iron Ore', 0.5, 0.0001), 0.0001 + 0.4 + 0.15);
});

// The fixed case: Phase 3 with every alternate, so the LP has recipes to choose between.
const CASE = { phase: '3', recipes: 'all' } as const;
const feasibleStages = (plan: CurrentCalculatedPlan) =>
  Object.entries(plan.stages).filter(([, stage]) => stage.rows) as [string, StoredStage][];
const buildingsOf = (stage: StoredStage) =>
  (stage.rows || []).reduce((sum, row) => sum + row.machines, 0);
const powerOf = (plan: CurrentCalculatedPlan) => (stage: StoredStage) =>
  powerView(stage, plan.settings).needMW;
// What the plan mines per minute, Water left out (it never runs out, so no objective counts it).
const rawOf = (stage: StoredStage) =>
  Object.entries(stage.raw || {})
    .filter(([item]) => item !== 'Water')
    .reduce((sum, [, rate]) => sum + rate, 0);
// `plan`'s figure of every phase is at most `than`'s, and lower in at least one.
function noMore(
  plan: CurrentCalculatedPlan,
  than: CurrentCalculatedPlan,
  figure: (plan: CurrentCalculatedPlan) => (stage: StoredStage) => number,
  name: string,
) {
  let lower = 0;
  for (const [phase, stage] of feasibleStages(plan)) {
    const mine = figure(plan)(stage),
      theirs = figure(than)(than.stages[phase as '3']);
    assert.ok(mine <= theirs + 1e-6, `${name}, Phase ${phase}: ${mine} > ${theirs}`);
    if (mine < theirs - 1e-6) lower++;
  }
  assert.ok(lower > 0, `${name}: lower in some phase`);
}

test('each objective moves the plan its way on a fixed case', () => {
  const plain = calculate(CASE),
    power = calculate({ ...CASE, objective: 'power' }),
    raw = calculate({ ...CASE, objective: 'raw' }),
    mix = calculate({ ...CASE, objective: { buildings: 1, power: 1, raw: 1 } });
  assert.equal(feasibleStages(plain).length, 5);
  for (const plan of [power, raw, mix]) {
    assert.equal(feasibleStages(plan).length, 5, 'every phase fits');
    assert.deepEqual(
      Object.keys(plan.stages['3'].delivery || {}),
      Object.keys(plain.stages['3'].delivery || {}),
      'the same deliveries',
    );
  }
  assert.equal(power.settings.objective, 'power');
  // Least power needs no more MW than the fewest buildings in any phase, and less in some.
  noMore(power, plain, powerOf, 'least power against the default');
  // Least raw resources mines no more than the fewest buildings, and less in some phase.
  noMore(raw, plain, () => rawOf, 'least raw against the default');
  // The fewest buildings builds no more than either.
  noMore(plain, power, () => buildingsOf, 'the default against least power');
  noMore(plain, raw, () => buildingsOf, 'the default against least raw');
  // An even mix lies between: it mines less than the default and least power, and builds fewer
  // and draws less than least raw resources.
  noMore(mix, plain, () => rawOf, 'the mix against the default');
  noMore(mix, power, () => rawOf, 'the mix against least power');
  noMore(mix, raw, () => buildingsOf, 'the mix against least raw (buildings)');
  noMore(mix, raw, powerOf, 'the mix against least raw (power)');
  // A mix of one weight is that objective's plan.
  const stagesOf = (plan: CurrentCalculatedPlan) => JSON.stringify(plan.stages);
  assert.equal(
    stagesOf(calculate({ ...CASE, objective: { buildings: 0, power: 1, raw: 0 } })),
    stagesOf(power),
  );
  assert.equal(
    stagesOf(calculate({ ...CASE, objective: { buildings: 0, power: 0, raw: 1 } })),
    stagesOf(raw),
  );
  assert.equal(
    stagesOf(calculate({ ...CASE, objective: { buildings: 1, power: 0, raw: 0 } })),
    stagesOf(plain),
  );
});

test('least power holds with whole machines too', () => {
  const whole = { ...CASE, wholeMachines: true, storageFromSurplus: true, phaseMining: true };
  const plain = calculate(whole),
    power = calculate({ ...whole, objective: 'power' });
  assert.equal(feasibleStages(power).length, 5);
  noMore(power, plain, powerOf, 'least power, whole machines');
});

test('the fewest buildings is the plan it was, byte for byte', () => {
  for (const base of [{ phase: '3' }, { ...CASE, wholeMachines: true, storageFromSurplus: true }]) {
    const plain = calculate(base);
    for (const absent of [undefined, 'buildings']) {
      const again = calculate({ ...base, objective: absent });
      assert.equal('objective' in again.settings, false);
      assert.equal(timeless(again), timeless(plain));
    }
  }
});

// A full export of one save holding `plan`.
const exported = (plan: StoredCalculatedPlan): SaveExport => ({
  format: 'satisfactory-planner-saves',
  version: 1,
  exportedAt: '2026-10-19T08:00:00.000Z',
  saves: [
    {
      id: 's1',
      name: 'World',
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
    },
  ],
});
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};
const before = fixture('plan-before-1065.json');
const powerPlan = (): StoredCalculatedPlan => json(calculate({ ...CASE, objective: 'power' }));
const mixPlan = (): StoredCalculatedPlan =>
  json(calculate({ phase: '2', objective: { buildings: 2, power: 1, raw: 3 } }));

test('migration: plans stored before the setting recalculate unchanged, as the fewest buildings', () => {
  for (const plan of [before, fixture('calculated-plan-2026-09-12.json')]) {
    assert.equal('objective' in plan.settings, false);
    assert.equal(objectiveKind(plan.settings.objective), 'buildings');
    assert.equal('objective' in settings(plan.settings), false);
  }
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('migration: plans with and without an objective load, import and export unchanged (Docker)', async () => {
  for (const plan of [before, powerPlan(), mixPlan()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-objective-'));
    try {
      const workspace = await loadWorkspace(dataDir, validateState);
      workspace.saves.push({
        id: 's1',
        name: 'World',
        userId: 'owner',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      });
      await fsp.writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(workspace));
      const loaded = await loadWorkspace(dataDir, validateState);
      assert.equal(JSON.stringify(loaded.saves[0]!.profiles[0]!.plan), JSON.stringify(plan));
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
});

// The browser edition over a fake IndexedDB that keeps `records` between opens.
const browserApi = (records: Map<string, unknown>) =>
  createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
      throw Error('not needed');
    }),
    calculate,
    catalog(),
  );

test('migration: the browser edition keeps the plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const plans = [before, powerPlan(), mixPlan()];
  let api = browserApi(records);
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = browserApi(records);
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

// The Docker server's answer to Create profile with `body`: its status and message.
async function dockerRefusal(body: object): Promise<{ status: number; text: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-objective-'));
  const server: Server = await createApp({ dataDir: dir, password: '' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const reply = await fetch(url + '/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Planner-Request': '1' },
      body: JSON.stringify(body),
    });
    return { status: reply.status, text: await reply.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('both editions create the same plan from the same request, and refuse an invalid objective', async () => {
  for (const objective of ['power', { buildings: 1, power: 2, raw: 3 }]) {
    const body = newSaveRequest({ phase: '2', recipes: 'all', objective });
    const docker = await dockerProfile(body),
      browser = await browserProfile(body);
    assert.deepEqual(docker.plan!.settings.objective, objective);
    assert.equal(JSON.stringify(browser.plan!.settings), JSON.stringify(docker.plan!.settings));
    assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
  }
  for (const objective of ['speed', { buildings: 0, power: 0, raw: 0 }, { buildings: 20 }]) {
    const body = newSaveRequest({ phase: '2', objective });
    const refused = await dockerRefusal(body);
    assert.equal(refused.status, 400, JSON.stringify(objective));
    assert.ok(refused.text.includes(REFUSAL), refused.text);
    await assert.rejects(browserProfile(body), (error: Error & { status?: number }) => {
      assert.equal(error.message, REFUSAL);
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test('Review, a profile card and a new profile’s name say which objective a plan was calculated with', () => {
  const goals = catalog().goals;
  const plain = json(calculate({ phase: '3' })).settings;
  const named = (from: object, to: object) =>
    settingsChanges(from, to, goals).changes.filter(change => change.label === 'Objective');
  assert.deepEqual(named(plain, { ...plain, objective: 'power' }), [
    { label: 'Objective', before: 'Fewest buildings', after: 'Least power' },
  ]);
  assert.deepEqual(
    named(
      { ...plain, objective: 'raw' },
      { ...plain, objective: { buildings: 1, power: 0, raw: 2 } },
    ),
    [
      {
        label: 'Objective',
        before: 'Least raw resources',
        after: 'Weighted mix (buildings 1, power 0, raw 2)',
      },
    ],
  );
  assert.deepEqual(named(plain, plain), []);
  assert.deepEqual(named({ ...plain, objective: 'power' }, { ...plain, objective: 'power' }), []);
  assert.equal(settingsChanges(plain, { ...plain, objective: 'power' }, goals).others, 0);
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1 }),
    'vanilla purity · 1× elevator · 1× power',
  );
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1, objective: 'power' }),
    'vanilla purity · 1× elevator · 1× power · least power',
  );
  const date = new Date('2026-10-19T12:00:00');
  assert.match(
    defaultProfileName({ goal: 'balanced', phase: '1', objective: 'raw' }, null, goals, date),
    /^Balanced progression · least raw resources · /,
  );
  assert.doesNotMatch(
    defaultProfileName({ goal: 'balanced', phase: '1' }, null, goals, date),
    /least|fewest/,
  );
});
