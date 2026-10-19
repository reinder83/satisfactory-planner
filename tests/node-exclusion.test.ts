// Leaving resource nodes out of the plan (#1183, the third slice of #1079): the node survey's
// `excludedNodes` and `excludedWells` (settings.extraction), counts per resource and purity, each
// at most the survey's own count. The plan never taps them: the budgets the survey writes leave
// them out (extractionLimits), each phase's node kinds are the rest (phaseMining), a resource
// never plans with more than the rest give (leftOutCap, with or without mining per phase), so the
// "Tap the resource nodes" step and the upgrade before expanding (#1169) use only the rest, and a
// resource with every node left out is infeasible with its reason. It belongs to the plan
// snapshot, like recipeCost: absent when nothing is left out, so a plan without it, and every
// plan stored before it, calculates, loads, imports and exports exactly as before, in both
// editions. Nothing recalculates a plan for it: Review, the sidebar, a profile card and ADA say
// what a plan was calculated with.
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
import { createApp } from '../server.ts';
import {
  budgetLimit,
  budgetLimits,
  extractionLimits,
  leftOutCap,
  leftOutPool,
  presetSurvey,
  resourceAvailable,
  resourcePool,
  withinCounts,
} from '../public/preferences.ts';
import {
  leftOutNote,
  leftOutWords,
  miningStep,
  nodeUpgrades,
  stageBudget,
  stageMiningAdvice,
} from '../public/mining.ts';
import { adaRemarks } from '../public/ada.ts';
import type { AdaFacts } from '../public/ada.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { profileSummary, settingsChanges } from '../public/app/profile-edit.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { browserProfile, dockerProfile, newSaveRequest } from './helpers/editions.ts';
import type {
  CurrentCalculatedPlan,
  SaveExport,
  StoredCalculatedPlan,
  Survey,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// A plan without the time it was made, which is all that differs between two calculations.
const timeless = (plan: CurrentCalculatedPlan | StoredCalculatedPlan) =>
  JSON.stringify({ ...plan, createdAt: '' });
const fixture = (name: string): StoredCalculatedPlan => {
  const file = JSON.parse(
    fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'),
  ) as { plan?: StoredCalculatedPlan } & StoredCalculatedPlan;
  return file.plan ?? file;
};

// The default world's nodes, Miner Mk.3 at 250%: Iron Ore has 39 impure, 42 normal and 46 pure
// nodes, 300, 600 and 1,200/min each, 92,100/min in all.
const SURVEY = presetSurvey('vanilla');
const withLeftOut = (excluded: Partial<Survey>): Survey => ({ ...SURVEY, ...excluded });
const ALL_PURE_IRON = withLeftOut({
  excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: 46 } },
});
const EVERY_IRON = withLeftOut({
  excludedNodes: { 'Iron Ore': { impure: 39, normal: 42, pure: 46 } },
});
// A synthetic Phase 3 profile with mining per phase (Miner Mk.2 and Mk.4 belts in Phase 3,
// Mk.3 and Mk.5 in Phase 4), with the survey's budgets as the wizard writes them.
const BASE = fixture('plan-before-1169.json').settings;
const planFor = (extraction: Survey, extra: object = {}): CurrentCalculatedPlan =>
  calculate({
    ...BASE,
    extraction,
    limits: { ...BASE.limits, ...extractionLimits(extraction) },
    ...extra,
  });
const ironOf = (plan: CurrentCalculatedPlan, phase: '3' | '4' | '5') =>
  stageMiningAdvice(plan.stages[phase]).find(entry => entry.resource === 'Iron Ore')!;
const kindsOf = (plan: CurrentCalculatedPlan, phase: '3' | '4' | '5') =>
  plan.stages[phase].mining!.sources['Iron Ore']!.map(source => [source.kind, source.nodes]);

test('settings keep the nodes a survey leaves out, within its counts, and refuse anything else', () => {
  const kept = settings({ extraction: ALL_PURE_IRON }).extraction!;
  assert.deepEqual(kept.excludedNodes, { 'Iron Ore': { impure: 0, normal: 0, pure: 46 } });
  assert.equal('excludedWells' in kept, false);
  // Well satellites too, and a row of none is dropped, as is a map of none.
  const wells = settings({
    extraction: withLeftOut({
      excludedNodes: { Coal: { impure: 0, normal: 0, pure: 0 } },
      excludedWells: { 'Nitrogen Gas': { impure: 2, normal: 0, pure: 1 } },
    }),
  }).extraction!;
  assert.equal('excludedNodes' in wells, false);
  assert.deepEqual(wells.excludedWells, { 'Nitrogen Gas': { impure: 2, normal: 0, pure: 1 } });
  // A purity left unsaid leaves none of it out.
  assert.deepEqual(
    settings({ extraction: withLeftOut({ excludedNodes: { Coal: { pure: 3 } as never } }) })
      .extraction!.excludedNodes,
    { Coal: { impure: 0, normal: 0, pure: 3 } },
  );
  // Without any, the survey is the record it always was: no field.
  assert.deepEqual(Object.keys(settings({ extraction: SURVEY }).extraction!), [
    'mark',
    'clock',
    'nodes',
    'wells',
    'used',
  ]);
  const refused = (excluded: object, message: string | RegExp) =>
    assert.throws(
      () => settings({ extraction: withLeftOut(excluded) }),
      (error: Error & { status?: number }) => {
        assert.equal(error.status, 400, JSON.stringify(excluded));
        if (typeof message === 'string') assert.equal(error.message, message);
        else assert.match(error.message, message);
        return true;
      },
    );
  const whole = 'Leave out whole numbers of nodes, from 0 up to the ones your survey counts.';
  for (const count of [-1, 1.5, '2', null, Number.NaN, Infinity, [1], { n: 1 }])
    refused({ excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: count } } }, whole);
  for (const map of ['Iron Ore', [], 3, null]) refused({ excludedNodes: map }, whole);
  refused({ excludedNodes: { 'Iron Ore': 4 } }, whole);
  refused(
    { excludedNodes: { Gold: { impure: 1, normal: 0, pure: 0 } } },
    'Gold is not a raw resource.',
  );
  // More than the survey counts, never cut down to it.
  refused(
    { excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: 47 } } },
    'Your survey counts 46 pure Iron Ore nodes, so it cannot leave out 47.',
  );
  refused(
    { excludedWells: { 'Crude Oil': { impure: 0, normal: 1, pure: 0 } } },
    'Your survey counts 0 normal Crude Oil well satellites, so it cannot leave out 1.',
  );
  // Water is never counted, so none of it can be left out.
  refused(
    { excludedNodes: { Water: { impure: 1, normal: 0, pure: 0 } } },
    'Your survey counts 0 impure Water nodes, so it cannot leave out 1.',
  );
});

test('the survey’s budgets leave the nodes out, and the plan never draws more than the rest give', () => {
  // 46 pure nodes give 55,200/min of the 92,100.
  assert.equal(resourcePool(ALL_PURE_IRON, 'Iron Ore'), 92100);
  assert.equal(leftOutPool(ALL_PURE_IRON, 'Iron Ore'), 55200);
  assert.equal(resourceAvailable(ALL_PURE_IRON, 'Iron Ore'), 36900);
  assert.equal(extractionLimits(ALL_PURE_IRON)['Iron Ore'], 36900);
  // What is committed comes off the nodes the plan may tap.
  assert.equal(
    resourceAvailable({ ...ALL_PURE_IRON, used: { 'Iron Ore': 900 } }, 'Iron Ore'),
    36000,
  );
  assert.equal(leftOutPool(SURVEY, 'Iron Ore'), 0);
  // The cap holds whatever budget was entered: the default map's 92,100 too.
  const entered = { limits: { 'Iron Ore': 92100, Coal: 42300 }, extraction: ALL_PURE_IRON };
  assert.equal(leftOutCap(entered, 'Iron Ore'), 36900);
  assert.equal(leftOutCap(entered, 'Coal'), null, 'none of its nodes left out');
  assert.equal(budgetLimit(entered, 'Iron Ore'), 36900);
  assert.equal(budgetLimit({ ...entered, limits: { 'Iron Ore': 20000 } }, 'Iron Ore'), 20000);
  assert.deepEqual(budgetLimits(entered), { 'Iron Ore': 36900, Coal: 42300 });
  const plain = { limits: { 'Iron Ore': 92100 }, extraction: SURVEY };
  assert.equal(budgetLimits(plain), plain.limits, 'the budgets themselves without left-out nodes');
  assert.equal(leftOutCap({ extraction: EVERY_IRON }, 'Iron Ore'), 0);
  // A stage without mining per phase reads the same budget.
  assert.equal(stageBudget(undefined, entered, 'Iron Ore'), 36900);
  assert.equal(stageBudget(undefined, plain, 'Iron Ore'), 92100);
});

test('leaving nodes out lowers each phase’s budget and nodes, and the plan taps the rest', () => {
  const plain = planFor(SURVEY),
    left = planFor(ALL_PURE_IRON);
  assert.deepEqual(left.settings.extraction!.excludedNodes, ALL_PURE_IRON.excludedNodes);
  for (const phase of ['3', '4', '5'] as const) {
    const before = plain.stages[phase].mining!,
      after = left.stages[phase].mining!;
    assert.ok(
      after.budgets['Iron Ore']! < before.budgets['Iron Ore']!,
      `Phase ${phase}: ${after.budgets['Iron Ore']} < ${before.budgets['Iron Ore']}`,
    );
    // The pure kind is gone; the others keep the nodes they had.
    assert.deepEqual(
      kindsOf(plain, phase).filter(([kind]) => kind !== 'pure'),
      kindsOf(left, phase),
    );
    assert.ok(kindsOf(plain, phase).some(([kind]) => kind === 'pure'));
    // Every other resource keeps its budget and nodes.
    assert.equal(after.budgets.Coal, before.budgets.Coal);
    assert.deepEqual(after.sources.Coal, before.sources.Coal);
  }
  // The same deliveries, tapped from normal nodes instead of the pure ones the plan used.
  for (const phase of ['3', '4', '5'] as const) {
    assert.deepEqual(
      ironOf(plain, phase).advice.runs.map(run => run.kind),
      ['pure'],
      `Phase ${phase} taps pure nodes`,
    );
    assert.ok(
      ironOf(left, phase).advice.runs.every(run => run.kind !== 'pure'),
      `Phase ${phase} taps no pure node`,
    );
    assert.ok(ironOf(left, phase).advice.nodes > ironOf(plain, phase).advice.nodes);
  }
  assert.match(ironOf(left, '3').words, /^Tap 8 normal nodes with Miner Mk\.2: /);
});

test('"Tap the resource nodes" and the upgrade before expanding use only the nodes left in', () => {
  const plain = planFor(SURVEY),
    left = planFor(ALL_PURE_IRON);
  const upgrade = (plan: CurrentCalculatedPlan) =>
    nodeUpgrades(plan.stages['3'], plan.stages['4'], 4)!;
  const iron = (plan: CurrentCalculatedPlan) =>
    upgrade(plan).resources.find(own => own.resource === 'Iron Ore')!;
  assert.deepEqual(iron(plain).tapped, [['pure', 5]]);
  // Phase 3 tapped 8 normal nodes: upgraded to Mk.5 belts and Miner Mk.3 they give 4,800/min.
  assert.deepEqual(iron(left).tapped, [['normal', 8]]);
  assert.equal(iron(left).before, 8 * 300);
  assert.equal(iron(left).after, 8 * 600);
  assert.ok(iron(left).nodes > iron(plain).nodes);
  // The mining step names the nodes left out, and its table counts only the others.
  const step = miningStep(left.stages['4'], '4', left.settings, upgrade(left))!;
  assert.ok(
    step.body.includes(
      'Left out of this plan in your node survey, never tapped here: 46 pure Iron Ore nodes.',
    ),
    step.body,
  );
  assert.equal(step.table.intro.endsWith('never tapped here: 46 pure Iron Ore nodes.'), true);
  const row = step.table.rows.find(cells => cells[0] === 'Iron Ore')!;
  assert.match(row[2]!, /^11 normal \(8 tapped in Phase 3, 3 new\)$/);
  // A plan that leaves nothing out says nothing of it.
  assert.doesNotMatch(
    miningStep(plain.stages['4'], '4', plain.settings, upgrade(plain))!.body,
    /Left out/,
  );
});

test('every node of a resource left out: the phase does not fit, and its draft says why', () => {
  // With mining per phase. (Phase 5 may convert SAM into Iron Ore, so it is left out here.)
  const plan = planFor(EVERY_IRON);
  for (const phase of ['3', '4'] as const) {
    const stage = plan.stages[phase];
    assert.equal(stage.feasible, false);
    assert.equal(stage.mining!.budgets['Iron Ore'], 0);
    assert.deepEqual(
      stage.shortfalls?.map(shortfall => [shortfall.name, shortfall.budget]),
      [['Iron Ore', 0]],
    );
    assert.match(
      String(stage.reason),
      /^This phase needs more Iron Ore than the entered budgets provide\. Your node survey leaves every Iron Ore node out of this plan, so it has none to mine\./,
    );
    // Its draft draws Iron Ore it has no node for, and says so.
    assert.equal(ironOf(plan, phase).advice.nodes, 0);
    assert.match(ironOf(plan, phase).words, /^No nodes to tap\. That is [\d,.]+\/min more than/);
  }
  // Without mining per phase, the entered budget is held to none as well.
  const flat = calculate({ phase: '3', extraction: EVERY_IRON });
  assert.equal(flat.settings.limits['Iron Ore'], 92100, 'the entered budget is kept as entered');
  assert.equal(flat.stages['3'].feasible, false);
  assert.match(
    String(flat.stages['3'].reason),
    /^This phase needs more Iron Ore than the entered budgets provide\. Your node survey leaves every Iron Ore node out of this plan, so it has none to mine\./,
  );
  // One node left in caps the budget at what it gives: 300/min, and the draft says how many
  // are left out.
  const one = calculate({
    phase: '3',
    extraction: withLeftOut({
      excludedNodes: { 'Iron Ore': { impure: 38, normal: 42, pure: 46 } },
    }),
  });
  assert.equal(one.stages['3'].feasible, false);
  assert.equal(one.stages['3'].shortfalls?.find(s => s.name === 'Iron Ore')?.budget, 300);
  assert.match(
    String(one.stages['3'].reason),
    /Your node survey leaves 126 of the 127 Iron Ore nodes out of this plan\./,
  );
  // The other phases a plan fits stay as they are.
  assert.equal(calculate({ phase: '3', extraction: SURVEY }).stages['3'].feasible, true);
});

test('a plan that leaves nothing out is the plan it was, byte for byte', () => {
  const plain = planFor(SURVEY);
  const nothing: Partial<Survey>[] = [
    {},
    { excludedNodes: {} },
    {
      excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: 0 } },
      excludedWells: { 'Crude Oil': { impure: 0, normal: 0, pure: 0 } },
    },
  ];
  for (const none of nothing) {
    const again = planFor({ ...SURVEY, ...none });
    assert.equal('excludedNodes' in again.settings.extraction!, false);
    assert.equal('excludedWells' in again.settings.extraction!, false);
    assert.equal(timeless(again), timeless(plain));
  }
  // A plan without a survey, as before.
  assert.equal(timeless(calculate({ phase: '2' })), timeless(calculate({ phase: '2' })));
  // A plan stored before the setting recalculates to the stages it stored.
  const before = fixture('plan-before-1065.json');
  assert.equal(JSON.stringify(calculate(before.settings).stages), JSON.stringify(before.stages));
});

test('the survey keeps what it leaves out within its counts', () => {
  assert.equal(withinCounts(SURVEY), SURVEY, 'a survey that leaves none out is itself');
  const lowered = withinCounts({
    ...SURVEY,
    nodes: { ...SURVEY.nodes, 'Iron Ore': { impure: 39, normal: 42, pure: 10 } },
    excludedNodes: {
      'Iron Ore': { impure: 1.7, normal: -2, pure: 46 },
      Coal: { impure: 0, normal: 0, pure: 0 },
    },
    excludedWells: { 'Crude Oil': { impure: 0, normal: 5, pure: 0 } },
  });
  assert.deepEqual(lowered.excludedNodes, { 'Iron Ore': { impure: 1, normal: 0, pure: 10 } });
  assert.equal('excludedWells' in lowered, false, 'no Crude Oil satellites are counted');
  // A preset filled in keeps them, within its counts: All Pure has no normal nodes.
  const pure = presetSurvey('pure', {
    ...SURVEY,
    excludedNodes: { 'Iron Ore': { impure: 0, normal: 5, pure: 3 } },
  });
  assert.deepEqual(pure.excludedNodes, { 'Iron Ore': { impure: 0, normal: 0, pure: 3 } });
});

test('Review, the sidebar, a profile card and ADA say which nodes a plan leaves out', () => {
  const goals = catalog().goals;
  const plain = json(planFor(SURVEY)).settings,
    left = json(planFor(ALL_PURE_IRON)).settings;
  const named = (from: object, to: object) =>
    settingsChanges(from, to, goals).changes.filter(change => change.label === 'Nodes left out');
  assert.deepEqual(named(plain, left), [
    { label: 'Nodes left out', before: 'None', after: '46 pure Iron Ore nodes' },
  ]);
  assert.deepEqual(named(left, plain), [
    { label: 'Nodes left out', before: '46 pure Iron Ore nodes', after: 'None' },
  ]);
  assert.deepEqual(named(left, left), []);
  // A plan made without a survey counts as none left out.
  const none = json(calculate({ phase: '3' })).settings;
  assert.deepEqual(named(none, none), []);
  // The budgets change with them, and nothing else is counted twice.
  assert.equal(settingsChanges(plain, left, goals).others, 1, 'the budgets');
  assert.equal(
    settingsChanges(plain, { ...left, limits: plain.limits }, goals).others,
    0,
    'only the nodes left out: the survey is not counted again',
  );
  const both = withLeftOut({
    excludedNodes: { 'Iron Ore': { impure: 0, normal: 1, pure: 2 } },
    excludedWells: { 'Nitrogen Gas': { impure: 1, normal: 0, pure: 0 } },
  });
  assert.equal(
    leftOutWords(both),
    '1 normal Iron Ore node, 2 pure Iron Ore nodes and 1 impure Nitrogen Gas well satellite',
  );
  assert.equal(leftOutNote(both), '4 resource nodes left out');
  assert.equal(leftOutNote(SURVEY), '');
  assert.equal(leftOutNote(null), '');
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1, extraction: both }),
    'vanilla purity · 1× elevator · 1× power · 4 resource nodes left out',
  );
  assert.equal(
    profileSummary({ purity: 'vanilla', multiplier: 1, powerFactor: 1, extraction: SURVEY }),
    'vanilla purity · 1× elevator · 1× power',
  );
  for (const view of ['plan', 'resources']) {
    const line = (leftOutNodes?: string) => {
      const facts: Partial<AdaFacts> = {
        view,
        kind: 'calculated',
        steps: { done: 0, total: 1 },
        ...(leftOutNodes ? { leftOutNodes } : {}),
      };
      return adaRemarks(facts).find(remark => remark.id === 'left-out-nodes');
    };
    assert.equal(line(), undefined);
    assert.equal(line('46 pure Iron Ore nodes')!.tone, 'calm');
    assert.equal(
      line('46 pure Iron Ore nodes')!.text,
      'Your node survey leaves 46 pure Iron Ore nodes out of this plan: its budgets and the nodes it taps use only the rest, and every number here already counts it. What the plan cannot see, it cannot covet.',
    );
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
const leftPlan = (): StoredCalculatedPlan => json(planFor(ALL_PURE_IRON));

test('migration: plans with and without left-out nodes load, import and export unchanged (Docker)', async () => {
  for (const plan of [fixture('plan-before-1065.json'), leftPlan()]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-node-exclusion-'));
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

test('migration: the browser edition keeps both plans unchanged across a reload', async () => {
  const records = new Map<string, unknown>();
  const plans = [fixture('plan-before-1065.json'), leftPlan()];
  const browserApi = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = browserApi();
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  api = browserApi();
  const out = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    out.saves.map(save => JSON.stringify(save.profiles[0]!.plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
});

// The Docker server's answer to Create profile with `body`: its status and message.
async function dockerRefusal(body: object): Promise<{ status: number; text: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-node-exclusion-'));
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

test('both editions create the same plan from the same survey, and refuse invalid left-out nodes', async () => {
  const extraction = withLeftOut({
    excludedNodes: { 'Iron Ore': { impure: 0, normal: 2, pure: 46 } },
    excludedWells: { 'Nitrogen Gas': { impure: 1, normal: 0, pure: 0 } },
  });
  const body = newSaveRequest({
    phase: '2',
    phaseMining: true,
    extraction,
    limits: extractionLimits(extraction),
  });
  const docker = await dockerProfile(body),
    browser = await browserProfile(body);
  assert.deepEqual(docker.plan!.settings.extraction!.excludedNodes, extraction.excludedNodes);
  assert.deepEqual(docker.plan!.settings.extraction!.excludedWells, extraction.excludedWells);
  assert.equal(JSON.stringify(browser.plan!.settings), JSON.stringify(docker.plan!.settings));
  assert.equal(JSON.stringify(browser.plan!.stages), JSON.stringify(docker.plan!.stages));
  for (const [excluded, message] of [
    [
      { excludedNodes: { 'Iron Ore': { impure: 0, normal: 0, pure: 47 } } },
      'Your survey counts 46 pure Iron Ore nodes, so it cannot leave out 47.',
    ],
    [
      { excludedNodes: { 'Iron Ore': { impure: -1, normal: 0, pure: 0 } } },
      'Leave out whole numbers of nodes, from 0 up to the ones your survey counts.',
    ],
  ] as const) {
    const refusedBody = newSaveRequest({ phase: '2', extraction: withLeftOut(excluded) });
    const refused = await dockerRefusal(refusedBody);
    assert.equal(refused.status, 400, JSON.stringify(excluded));
    assert.ok(refused.text.includes(message), refused.text);
    await assert.rejects(browserProfile(refusedBody), (error: Error & { status?: number }) => {
      assert.equal(error.message, message);
      assert.equal(error.status, 400);
      return true;
    });
  }
});
