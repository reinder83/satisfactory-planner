// Mining and belts per phase (#1065). A plan with settings.phaseMining gives each phase the miner,
// clock, belts and pipes its HUB tiers unlock (Miner Mk.1 in Phase 1, Mk.2 from Phase 2, Mk.3
// from Phase 4; 100% in Phases 1–3 and 250% from Phase 4; Mk.2 belts up to Mk.6 belts), budgets
// that follow from them, and per raw resource the nodes its draw taps, whose power the plan's
// power model counts. The build plan asks for each belt, pipe, miner and extractor milestone the
// phase uses. A plan stored before #1065 has no phaseMining: it keeps its budgets, numbers and
// steps until the user recalculates, in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, settings } from '../planner.ts';
import { milestonesListedIn, phaseSteps } from '../public/progression.ts';
import { powerView } from '../public/power.ts';
import {
  BELT_MARKS,
  EXTRACTOR_TIERS,
  MINER_MARKS,
  PIPE_MARKS,
  bestMark,
  isWellKind,
  minerMarks,
  miningAdvice,
  miningLinearMW,
  miningMW,
  phaseForTier,
  phaseMining,
  sourceClock,
  sourceYield,
} from '../public/preferences.ts';
import {
  fluidClocks,
  miningBuildings,
  miningStepBody,
  phaseBudgetRows,
  stageBudget,
  stageMiningAdvice,
} from '../public/mining.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import type {
  CurrentCalculatedPlan,
  MiningSource,
  Progression,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];
const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);
const near = (a: number, b: number, tolerance = 1e-6) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

// Plans with mining per phase, calculated once: a default new plan, whole machines, maximum
// output (which draws budgets to their limits), all alternates from Phase 4, a node survey with
// Mk.2 miners at 150%, and a Mostly Impure world.
const plans: Record<string, CurrentCalculatedPlan> = {};
const planOf = (name: string): CurrentCalculatedPlan => {
  const inputs: Record<string, object> = {
    'default Phase 1': { phase: '1' },
    'whole machines Phase 3': { phase: '3', wholeMachines: true },
    'maximum Phase 2': { phase: '2', goal: 'maximum', limitsConfirmed: true },
    'all alternates Phase 4': { phase: '4', recipes: 'all', wholeMachines: true },
    'survey Mk.2 at 150%': {
      phase: '3',
      wholeMachines: true,
      extraction: {
        mark: 2,
        clock: 1.5,
        nodes: { 'Iron Ore': { impure: 4, normal: 6, pure: 2 }, Coal: { normal: 8 } },
        wells: {},
        used: {},
      },
      limits: { 'Iron Ore': 1800, Coal: 1440 },
    },
    'mostly impure': {
      phase: '3',
      purity: 'mostly-impure',
      goal: 'maximum',
      limitsConfirmed: true,
    },
  };
  return (plans[name] ??= calculate({ ...inputs[name], phaseMining: true }));
};
const PLAN_NAMES = [
  'default Phase 1',
  'whole machines Phase 3',
  'maximum Phase 2',
  'all alternates Phase 4',
  'survey Mk.2 at 150%',
  'mostly impure',
];
// Each feasible stage of a plan with its phase number.
const stagesOf = (plan: CurrentCalculatedPlan) =>
  PHASES.map(key => ({ phase: Number(key), key, stage: plan.stages[key] as StoredStage })).filter(
    ({ stage }) => stage.feasible && stage.mining,
  );

test('each phase plans with the miner, clock, belts and pipes its tiers unlock (#1065)', () => {
  const expected = [
    { miner: { mark: 1, clock: 1 }, belt: ['Mk.2', 120], pipe: ['Mk.1', 300] },
    { miner: { mark: 2, clock: 1 }, belt: ['Mk.3', 270], pipe: ['Mk.1', 300] },
    { miner: { mark: 2, clock: 1 }, belt: ['Mk.4', 480], pipe: ['Mk.2', 600] },
    { miner: { mark: 3, clock: 2.5 }, belt: ['Mk.5', 780], pipe: ['Mk.2', 600] },
    { miner: { mark: 3, clock: 2.5 }, belt: ['Mk.6', 1200], pipe: ['Mk.2', 600] },
  ];
  const config = settings({ phaseMining: true });
  for (const [index, want] of expected.entries()) {
    const mining = phaseMining(config, index + 1);
    assert.deepEqual(mining.miner, want.miner, `Phase ${index + 1} miner`);
    assert.deepEqual([mining.belt.mark, mining.belt.cap], want.belt, `Phase ${index + 1} belt`);
    assert.deepEqual([mining.pipe.mark, mining.pipe.cap], want.pipe, `Phase ${index + 1} pipe`);
  }
});

test('the budgets of each phase follow from its equipment: the issue’s 1,200/min per pure node only in Phase 5', () => {
  const config = settings({ phaseMining: true });
  const budget = (phase: number, resource: string) => phaseMining(config, phase).budgets[resource];
  // Iron Ore's 39 impure, 42 normal and 46 pure nodes: Mk.1 at 100% gives 30/60/120 a node, Mk.2
  // 60/120/240, Mk.3 at 250% 300/600/1,200 on Mk.6 belts, and in Phase 4 a pure node only the
  // 780/min its Mk.5 belt carries (owner's choice on #1096): 46 × 780 + 42 × 600 + 39 × 300.
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(phase => budget(phase, 'Iron Ore')),
    [9210, 18420, 18420, 72780, 92100],
  );
  assert.equal(
    Math.round((budget(4, 'Iron Ore')! / config.limits['Iron Ore']!) * 100),
    79,
    'Phase 4 gets about 79% of the Iron Ore budget, as #1065 estimated',
  );
  assert.equal(budget(5, 'Iron Ore'), config.limits['Iron Ore'], 'Phase 5 as the shipped budget');
  // Oil Extractors from Phase 3 (Tier 5), resource wells from Phase 4 (Tier 8).
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(phase => budget(phase, 'Crude Oil')),
    [0, 0, 3960, 9900, 9900],
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(phase => budget(phase, 'Nitrogen Gas')),
    [0, 0, 0, 12000, 12000],
  );
  // Water has no nodes: its allowance is the same in every phase.
  for (const phase of [1, 2, 3, 4, 5]) assert.equal(budget(phase, 'Water'), config.limits.Water);
  // No phase gets more than the entered budget.
  for (const phase of [1, 2, 3, 4, 5])
    for (const [resource, rate] of Object.entries(phaseMining(config, phase).budgets))
      assert.ok(rate <= config.limits[resource]! + 1e-9, `${resource} in Phase ${phase}`);
});

test('a lower entered budget gives each phase the same share of it', () => {
  const half = settings({ phaseMining: true, limits: { 'Iron Ore': 46050 } });
  assert.equal(phaseMining(half, 1).budgets['Iron Ore'], 4605);
  assert.equal(phaseMining(half, 4).budgets['Iron Ore'], 36390);
  assert.equal(phaseMining(half, 5).budgets['Iron Ore'], 46050);
});

test('a node survey’s miner and clock cap every phase’s, and are kept as stored', () => {
  const survey = {
    mark: 2,
    clock: 1.5,
    nodes: { 'Iron Ore': { impure: 0, normal: 10, pure: 0 } },
    wells: {},
    used: {},
  };
  const config = settings({ phaseMining: true, extraction: survey, limits: { 'Iron Ore': 1800 } });
  assert.deepEqual(config.extraction, survey, 'the survey is stored as it was entered');
  // Phase 1: Mk.1 at 100% (the phase's), Phase 5: Mk.2 at 150% (the survey's), never Mk.3 at 250%.
  assert.deepEqual(phaseMining(config, 1).miner, { mark: 1, clock: 1 });
  assert.deepEqual(phaseMining(config, 3).miner, { mark: 2, clock: 1 });
  assert.deepEqual(phaseMining(config, 5).miner, { mark: 2, clock: 1.5 });
  // Phase 4 overclocks to the survey's 150%, never to the phase's own 250%.
  assert.deepEqual(phaseMining(config, 4).miner, { mark: 2, clock: 1.5 });
  // 10 normal nodes: 60, 120, 120, 180 and 180 a node; the survey's budget is Phase 4's and 5's.
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(phase => phaseMining(config, phase).budgets['Iron Ore']),
    [600, 1200, 1200, 1800, 1800],
  );
});

test('a node gives no more than its belt or pipe carries', () => {
  const pure: MiningSource = {
    kind: 'pure',
    machine: 'Miner Mk.3',
    nodes: 2,
    base: 480,
    cap: 780,
    machineMW: 45,
  };
  assert.equal(sourceYield(pure, 1), 480, 'under the belt');
  assert.equal(sourceYield(pure, 2.5), 780, 'a Mk.5 belt caps a pure node at 250%');
  assert.equal(sourceClock(pure, 2.5), 780 / 480, 'so it runs at 162.5%');
  const advice = miningAdvice(1000, [pure], 2.5);
  assert.deepEqual(
    advice.runs.map(run => [run.full, run.clock, run.last]),
    [[1, 780 / 480, (220 / 780) * (780 / 480)]],
  );
  assert.equal(advice.short, 0);
  // Beyond what the nodes give, the advice says what is left.
  assert.ok(near(miningAdvice(2000, [pure], 2.5).short, 2000 - 1560));
});

test('the belt, pipe, miner and extractor tiers are the game data’s (progression.json)', () => {
  const unlocking = (building: string) =>
    data.entries.find(entry => entry.recipes.includes(data.buildings[building]!));
  for (const lane of [...BELT_MARKS, ...PIPE_MARKS]) {
    const entry = data.entries.find(candidate => candidate.id === lane.entry)!;
    assert.equal(entry.tier, lane.tier, lane.building);
    if (lane.building !== 'Conveyor Belt Mk.1')
      assert.equal(unlocking(lane.building)?.id, lane.entry, lane.building);
  }
  for (const miner of MINER_MARKS)
    assert.equal(unlocking(`Miner Mk.${miner.mark}`)?.tier ?? 0, miner.tier, `Mk.${miner.mark}`);
  for (const [building, { tier, entry }] of Object.entries(EXTRACTOR_TIERS))
    assert.deepEqual([unlocking(building)?.id, unlocking(building)?.tier], [entry, tier], building);
  // The survey's miner choices name the same tiers: Miner Mk.3 is Tier 8.
  assert.deepEqual(
    minerMarks.map(([, label]) => label),
    MINER_MARKS.map(miner => `Mk.${miner.mark} — Tier ${miner.tier}`),
  );
});

test('property: no phase mines, belts or pipes with equipment before its tier', () => {
  for (const phase of [1, 2, 3, 4, 5]) {
    // The first mark is the fallback (Phase 1 has no pipes and needs none).
    const tiers: (readonly { tier: number }[])[] = [BELT_MARKS, PIPE_MARKS, MINER_MARKS];
    for (const marks of tiers) {
      const best = bestMark(marks, phase);
      assert.ok(phaseForTier(best.tier) <= phase || best === marks[0]);
    }
    for (const name of PLAN_NAMES) {
      const stage = planOf(name).stages[String(phase) as StageKey] as StoredStage;
      if (!stage.mining) continue;
      const belt = BELT_MARKS.find(mark => mark.mark === stage.mining!.belt.mark)!,
        pipe = PIPE_MARKS.find(mark => mark.mark === stage.mining!.pipe.mark)!;
      assert.ok(phaseForTier(belt.tier) <= phase, `${name}: belt in Phase ${phase}`);
      assert.ok(phaseForTier(pipe.tier) <= phase || pipe === PIPE_MARKS[0], `${name}: pipe`);
      assert.ok(
        phaseForTier(MINER_MARKS[stage.mining.miner.mark - 1]!.tier) <= phase,
        `${name}: miner in Phase ${phase}`,
      );
      for (const kinds of Object.values(stage.mining.sources))
        for (const kind of kinds)
          if (kind.machine === 'Oil Extractor') assert.ok(phase >= 3, `${name}: oil in ${phase}`);
          else if (isWellKind(kind.kind)) assert.ok(phase >= 4, `${name}: wells in ${phase}`);
    }
  }
});

test('property: the build plan asks for every belt, pipe, miner and extractor milestone a phase uses', () => {
  for (const name of PLAN_NAMES) {
    const plan = planOf(name);
    const start = Number(plan.settings.phase);
    const listed = new Map<string, number>();
    for (const phase of [1, 2, 3, 4, 5])
      for (const entry of milestonesListedIn(plan, { checks: {} }, data, phase))
        listed.set(entry.id, phase);
    for (const { phase, stage } of stagesOf(plan)) {
      if (phase < start) continue;
      for (const building of miningBuildings(stage)) {
        const entry = data.entries.find(candidate =>
          candidate.recipes.includes(data.buildings[building]!),
        );
        if (!entry) continue; // Mk.1 belts and miners come with the HUB.
        const at = listed.get(entry.id);
        assert.ok(at !== undefined && at <= phase, `${name}: ${building} in Phase ${phase}`);
      }
    }
  }
  // The issue's case: Phase 4 lists Tier 7 Logistics Mk.5 before its links use Mk.5 belts.
  const phase4 = phaseSteps(planOf('all alternates Phase 4'), { checks: {} }, data, '4');
  assert.ok(phase4.some(step => step.id === 'unlock-Schematic_7-2_C'));
  assert.ok(
    phase4.some(step => step.id === 'unlock-Schematic_8-4_C'),
    'Miner Mk.3',
  );
});

test('per resource, the nodes the advice taps add up to the plan’s raw draw, within the phase’s nodes', () => {
  let checked = 0;
  for (const name of PLAN_NAMES)
    for (const { phase, stage } of stagesOf(planOf(name))) {
      const mining = stage.mining!;
      for (const [resource, rate] of Object.entries(stage.raw || {})) {
        if (!(rate > 1e-6)) continue;
        // A feasible phase never draws beyond its budget.
        assert.ok(rate <= mining.budgets[resource]! + 1e-6, `${name}: ${resource} in ${phase}`);
        const sources = mining.sources[resource];
        if (!sources) continue;
        const advice = miningAdvice(rate, sources, mining.miner.clock);
        assert.equal(advice.short, 0, `${name}: ${resource} in Phase ${phase} fits its nodes`);
        let given = 0;
        for (const run of advice.runs) {
          const source = sources.find(kind => kind.kind === run.kind)!;
          given += isWellKind(run.kind)
            ? run.full * source.base * run.clock
            : run.full * sourceYield(source, mining.miner.clock) +
              (run.last === null ? 0 : run.last * source.base);
          const tapped = run.full + (run.last === null || isWellKind(run.kind) ? 0 : 1);
          assert.ok(tapped <= Math.ceil(source.nodes - 1e-9), `${name}: ${resource} ${run.kind}`);
          assert.ok(run.clock <= mining.miner.clock + 1e-9, 'never above the phase’s clock');
        }
        assert.ok(near(given, rate), `${name}: ${resource} in Phase ${phase}: ${given} ≠ ${rate}`);
        checked++;
      }
    }
  assert.ok(checked > 40, `checked ${checked} draws`);
});

test('mining power feeds the power model: each phase’s grid counts the nodes its draw taps', () => {
  for (const name of PLAN_NAMES) {
    const plan = planOf(name);
    for (const { phase, stage } of stagesOf(plan)) {
      const grid = stage.grid!;
      assert.deepEqual(grid.extractionAt, stage.mining!.miner);
      const counted = miningMW(stage.raw!, stage.mining!);
      for (const [resource, mw] of Object.entries(grid.extraction))
        assert.ok(near(mw, (counted[resource] ?? 0) * plan.settings.powerFactor), resource);
      // The advice the pages give for the same draw names the same MW.
      for (const entry of stageMiningAdvice(stage))
        assert.ok(near(entry.advice.mw, counted[entry.resource]!), entry.resource);
      // The planner charged each node kind its linear power, never less than the clocked power.
      assert.ok(miningLinearMW(stage.raw!, stage.mining!) >= grid.extractionMW - 1e-6);
      // From Phase 2 on, a plan that fits has the power it needs (#1064), mining included.
      if (phase >= 2) assert.ok(grid.needMW <= grid.availableMW + 0.01, `${name}: Phase ${phase}`);
    }
  }
});

test('the issue’s F8: a maximum plan no longer draws Mk.3-at-250% budgets in Phase 2', () => {
  const plan = planOf('maximum Phase 2');
  const stage = plan.stages['2'] as StoredStage;
  assert.ok(stage.feasible);
  assert.ok((stage.raw!['Iron Ore'] ?? 0) <= 18420 + 1e-6, 'Mk.2 at 100% on every Iron Ore node');
  // Without mining per phase the same plan draws far more: every phase had the endgame budgets.
  const before = calculate({ phase: '2', goal: 'maximum', limitsConfirmed: true });
  const drawn = (key: StageKey) =>
    Object.values(before.stages[key].raw || {}).reduce((sum, rate) => sum + rate, 0);
  const now = Object.values(stage.raw || {}).reduce((sum, rate) => sum + rate, 0);
  assert.ok(drawn('2') > now, `${drawn('2')} before against ${now}`);
});

test('the build plan has a mining step per phase, after the milestones and before the lines', () => {
  const plan = planOf('whole machines Phase 3');
  for (const key of ['3', '4', '5'] as StageKey[]) {
    const steps = phaseSteps(plan, { checks: {} }, data, key);
    const index = steps.findIndex(step => step.id === 'mining-' + key);
    assert.ok(index > 0, `Phase ${key}`);
    assert.ok(steps.findIndex(step => step.id.startsWith('calc-' + key + '-')) > index);
    const body = steps[index]!.body;
    assert.equal(body, miningStepBody(plan.stages[key] as StoredStage, key));
    assert.match(body, /^Phase \d mines with Miner Mk\.\d at \d+% and carries on Mk\.\d belts/);
    assert.match(body, /Iron Ore [\d,.]+\/min: tap \d+ pure/);
  }
  // From Phase 4, Crude Oil gets its extractors at 100% and at 250%, as Water does (#1024);
  // Phase 3, whose budgets count on no Power Shards, only at 100% (owner's choice on #1096).
  const oil = (key: StageKey) =>
    stageMiningAdvice(plan.stages[key] as StoredStage).find(
      entry => entry.resource === 'Crude Oil',
    )!.words;
  assert.match(oil('4'), /^At 100%: tap .* with Oil Extractors: .*; at 250%: tap .*Power Shards/);
  assert.match(oil('3'), /^At 100%: tap .* with Oil Extractors: [^;]*\.$/);
  assert.doesNotMatch(oil('3'), /250%|Power Shard/);
});

test('no 250% extractor option before Phase 4: a fluid’s advice offers only the clocks its phase plans', () => {
  assert.deepEqual(fluidClocks(1), [1], 'Phases 1–3: 100% only');
  assert.deepEqual(fluidClocks(2.5), [1, 2.5], 'Phases 4 and 5: 100% and 250%');
  assert.deepEqual(fluidClocks(1.5), [1, 1.5], 'a survey at 150%: never above it');
  let fluids = 0;
  for (const name of PLAN_NAMES)
    for (const { phase, stage } of stagesOf(planOf(name)))
      for (const entry of stageMiningAdvice(stage).filter(entry => entry.fluid)) {
        fluids++;
        const offered = [...entry.words.matchAll(/at ([\d.,]+)%: /gi)].map(match =>
          Number(match[1]!.replace(',', '.')),
        );
        assert.deepEqual(
          offered,
          fluidClocks(stage.mining!.miner.clock).map(clock => clock * 100),
          `${name}: ${entry.resource} in Phase ${phase}`,
        );
        if (phase < 4) assert.doesNotMatch(entry.words, /250%|Power Shard/, `${name}: ${phase}`);
      }
  assert.ok(fluids > 5, `checked ${fluids} fluid draws`);
});

test('the wizard’s table gives each phase its share of the entered budgets', () => {
  const rows = phaseBudgetRows(settings({ phaseMining: true }), 1);
  assert.deepEqual(
    rows.map(row => [row.phase, Math.round(row.low * 1000) / 10, Math.round(row.high * 1000) / 10]),
    [
      [1, 10, 10],
      [2, 20, 20],
      [3, 20, 40],
      [4, 77.6, 100],
      [5, 100, 100],
    ],
  );
  assert.match(rows[0]!.equipment, /^Miner Mk\.1 at 100% · Mk\.2 belts \(120\/min\)/);
});

test('settings keep phaseMining only when it is on, so settings without it stay as they were', () => {
  assert.equal('phaseMining' in settings({}), false);
  assert.equal('phaseMining' in settings({ phaseMining: false }), false);
  assert.equal('phaseMining' in settings({ phaseMining: 'yes' }), false);
  assert.equal(settings({ phaseMining: true }).phaseMining, true);
  const plain = calculate({ phase: '3' });
  assert.equal('phaseMining' in plain.settings, false);
  for (const key of PHASES) assert.equal(plain.stages[key].mining, undefined);
});

// A plan stored before #1065 (main at ce5b9ec, Phase 3 whole machines) and its build-plan step
// ids then, per phase.
const before: { plan: StoredCalculatedPlan; steps: Record<string, string[]> } = JSON.parse(
  fs.readFileSync(new URL('./fixtures/plan-before-1065.json', import.meta.url), 'utf8'),
);

test('a stored plan keeps its numbers, budgets and steps until the user recalculates', () => {
  const { plan, steps } = before;
  assert.equal('phaseMining' in plan.settings, false);
  for (const key of PHASES) {
    const stage = plan.stages[key];
    assert.equal(stage.mining, undefined);
    // Every page reads its budgets as entered, and its power as stored.
    for (const resource of Object.keys(plan.settings.limits))
      assert.equal(stageBudget(stage, plan.settings, resource), plan.settings.limits[resource]);
    assert.equal(powerView(stage, plan.settings).needMW, stage.grid!.needMW);
    assert.deepEqual(stageMiningAdvice(stage), []);
    assert.deepEqual(miningBuildings(stage), []);
  }
  // Its build plan is step for step what it was: no mining step, no new milestone.
  for (const [phase, ids] of Object.entries(steps))
    assert.deepEqual(
      phaseSteps(plan, { checks: {} }, data, phase).map(step => step.id),
      ids,
      `Phase ${phase}`,
    );
  // Recalculating its own settings gives the same plan: nothing changes until the user asks.
  const again = calculate(plan.settings);
  assert.deepEqual(json(again.stages), json(plan.stages));
  assert.deepEqual(again.warnings, plan.warnings);
  // Only a recalculation that asks for mining per phase plans with it.
  const asked = calculate({ ...plan.settings, phaseMining: true });
  assert.ok(asked.stages['3'].mining);
  assert.notDeepEqual(json(asked.stages['3'].raw), json(plan.stages['3'].raw));
});

// A full export of one save holding `plan`.
function exported(plan: StoredCalculatedPlan): SaveExport {
  return {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-06T08:00:00.000Z',
    saves: [
      {
        id: 's1',
        name: 'World',
        activeProfile: 'p1',
        profiles: [{ id: 'p1', name: 'Stored', kind: 'calculated', plan, state: initialState() }],
      },
    ],
  };
}

test('migration: a stored plan and a new one load, import and export unchanged (Docker edition)', async () => {
  for (const plan of [before.plan, json(planOf('whole machines Phase 3'))]) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-mining-'));
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
      // Its settings, read again, keep phaseMining exactly when the plan had it.
      assert.equal('phaseMining' in settings(plan.settings), 'phaseMining' in plan.settings);
    } finally {
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  }
});

test('migration: the browser edition keeps a stored plan and a new one unchanged, across a reload', async () => {
  const records = new Map<string, unknown>();
  const open = () =>
    createBrowserApi(
      openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
        throw Error('not needed');
      }),
      calculate,
      catalog(),
    );
  let api = open();
  const stored = [before.plan, json(planOf('whole machines Phase 3'))];
  for (const plan of stored)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  const planIn = (file: SaveExport) => file.saves.map(save => save.profiles[0]!.plan);
  const first = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    planIn(first).map(plan => JSON.stringify(plan)),
    stored.map(plan => JSON.stringify(plan)),
  );
  api = open();
  assert.deepEqual(planIn((await api('/api/export-saves')) as SaveExport), planIn(first));
});

test('the browser edition creates a new plan with mining per phase from the wizard’s settings', async () => {
  const records = new Map<string, unknown>();
  const api = createBrowserApi(
    openBrowserStore(fakeIndexedDB(2, records), undefined, async () => {
      throw Error('not needed');
    }),
    calculate,
    catalog(),
  );
  const created = (await api('/api/profiles', {
    body: JSON.stringify({
      saveId: null,
      saveName: 'World',
      name: 'New',
      settings: { phase: '2', phaseMining: true },
    }),
  })) as { saveId: string; profileId: string };
  const file = (await api('/api/export-saves')) as SaveExport;
  const plan = file.saves.find(save => save.id === created.saveId)!.profiles[0]!.plan!;
  assert.equal(plan.settings.phaseMining, true);
  assert.deepEqual(plan.stages['2'].mining!.miner, { mark: 2, clock: 1 });
});
