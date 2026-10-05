// Generation bounded by the phase's load (#1086). Generators burn fuel only for the power drawn,
// so a plan that makes more fuel than its phase draws backs the fuel chain up in the game, back
// to the Plastic and Rubber lines whose Heavy Oil Residue feeds it. Whole machines made that
// happen: a fluid line with a solid byproduct (Rocket Fuel with its Compacted Coal) was rounded to
// whole machines, and fluid byproducts of whole lines had to end as fuel. Now a fluid line keeps
// exact clocks whatever else it makes (roundsToWholeMachines in planner/model.ts), and a solve
// whose fuel gives more than one generator beyond the phase's need is solved again with its
// generation capped at that need (planner/load.ts), so the fuel covers the need and goes beyond it
// by less than one generator. A plan stored before keeps its numbers until the user recalculates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog, DATA } from '../planner.ts';
import { roundsToWholeMachines } from '../planner/model.ts';
import { primaryOutput } from '../planner/recipes.ts';
import { powerView } from '../public/power.ts';
import { fluidLines, roundsWholeLine } from '../public/app/exact-clocks.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  SaveExport,
  StageKey,
  StoredCalculatedPlan,
  StoredStage,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fluid = (item: string) => !!DATA.items[item]?.fluid;
const FLUIDS = new Set(Object.keys(DATA.items).filter(fluid));

// A stage's fuel against what the phase draws from its new generators, in MW: `fuelMW` what the
// generator lines are planned to burn (their equivalent, with Phase 5's boost), `drawMW` the need
// less the spare power and what the augmenters add, `unitMW` the largest generator of the stage.
function fuelOf(stage: StoredStage) {
  const grid = stage.grid!;
  const generators = (stage.rows || []).filter(row => row.power < 0);
  const boost = 1 + (stage.boost || 0);
  return {
    fuelMW: generators.reduce((sum, row) => sum - row.power * row.equivalent, 0) * boost,
    drawMW: Math.max(0, grid.needMW - grid.spareMW - grid.augmenterMW),
    unitMW: Math.max(0, ...generators.map(row => -row.power)) * boost,
    nuclear: generators.some(row => row.machine === 'Nuclear Power Plant'),
  };
}
// The phases a plan plans (from its start phase), with a stage that fits.
const planned = (plan: CurrentCalculatedPlan): [StageKey, StoredStage][] =>
  (['1', '2', '3', '4', '5'] as StageKey[])
    .filter(phase => Number(phase) >= Number(plan.settings.phase))
    .map((phase): [StageKey, StoredStage] => [phase, plan.stages[phase]])
    .filter(([, stage]) => stage.feasible);

test('a fluid line runs at exact clocks even when it also makes a solid', () => {
  for (const recipe of DATA.recipes) {
    const main = primaryOutput(recipe);
    if (main && fluid(main))
      assert.equal(roundsToWholeMachines(recipe), false, `${recipe.id} makes ${main}`);
  }
  const byId = (id: string) => DATA.recipes.find(recipe => recipe.id === id)!;
  // Rocket Fuel with its Compacted Coal, Fuel with its Polymer Resin: fluid lines.
  for (const id of ['Recipe_RocketFuel_C', 'Recipe_LiquidFuel_C', 'Recipe_AluminaSolution_C'])
    assert.equal(roundsToWholeMachines(byId(id)), false, id);
  // Plastic and Rubber make a solid first and Heavy Oil Residue beside it: they still round.
  for (const id of ['Recipe_Plastic_C', 'Recipe_Rubber_C', 'Recipe_PetroleumCoke_C'])
    assert.equal(roundsToWholeMachines(byId(id)), true, id);
});

test('the issue’s Phase 5 makes only the fuel its load burns (it built 90 GW for 73.9 GW)', () => {
  const plan = calculate({ phase: '3', wholeMachines: true });
  assert.equal(plan.exactFluidLines, true);
  const stage = plan.stages['5'];
  const { fuelMW, drawMW, unitMW } = fuelOf(stage);
  assert.ok(fuelMW >= drawMW - 0.01, `${fuelMW} covers ${drawMW}`);
  assert.ok(fuelMW <= drawMW + unitMW, `${fuelMW} within a generator of ${drawMW}`);
  // Whole generators at 100% give less than one generator beyond the need (90 GW before).
  const grid = stage.grid!;
  assert.ok(grid.generationMW - grid.needMW < 250, `${grid.generationMW} for ${grid.needMW}`);
  const rocketFuel = stage.rows!.find(row => row.id === 'Recipe_RocketFuel_C')!;
  assert.ok(rocketFuel.lastClock < 100, 'the Rocket Fuel line runs at exact clocks');
});

test('the all-alternates Phase 4 takes its Heavy Oil Residue to a disposal or the load', () => {
  // 72 generators, 18 GW for a 13.6 GW need before: two whole Nitro Rocket Fuel blenders, and the
  // Heavy Oil Residue of whole Rubber lines with only whole Petroleum Coke to take the rest.
  const plan = calculate({ phase: '4', wholeMachines: true, recipes: 'all' });
  const stage = plan.stages['4'];
  const { fuelMW, drawMW, unitMW } = fuelOf(stage);
  assert.ok(fuelMW >= drawMW - 0.01 && fuelMW <= drawMW + unitMW, `${fuelMW} for ${drawMW}`);
  const grid = stage.grid!;
  assert.ok(grid.generationMW - grid.needMW < 250, `${grid.generationMW} for ${grid.needMW}`);
});

// Profiles of every kind: whole machines and exact clocks, amplified, minimal construction, spare
// power, Phase 5's augmenters, a doubled cost, every power choice that burns fuel or coal.
const PROFILES: [string, object][] = [
  ['default whole, Phase 2', { phase: '2', wholeMachines: true }],
  ['default exact, Phase 2', { phase: '2' }],
  ['all alternates whole, Phase 4', { phase: '4', recipes: 'all', wholeMachines: true }],
  ['all alternates exact, Phase 3', { phase: '3', recipes: 'all' }],
  ['rocket fuel whole, Phase 3', { phase: '3', mainPower: 'rocket', wholeMachines: true }],
  ['turbofuel whole, Phase 3', { phase: '3', mainPower: 'turbofuel', wholeMachines: true }],
  ['fuel exact, Phase 3', { phase: '3', mainPower: 'fuel' }],
  ['coal whole, Phase 2', { phase: '2', mainPower: 'coal', wholeMachines: true }],
  [
    '5 GW spare, whole, Phase 3',
    { phase: '3', availablePowerGW: 5, installedPowerGW: 5, wholeMachines: true },
  ],
  ['4 augmenters, whole, Phase 5', { phase: '5', augmenters: 4, wholeMachines: true }],
  ['minimal, whole, Phase 3', { phase: '3', goal: 'minimal', wholeMachines: true }],
  ['minimal, exact, Phase 3', { phase: '3', goal: 'minimal' }],
  ['twice the costs, whole, Phase 3', { phase: '3', multiplier: 2, wholeMachines: true }],
  [
    'amplified, all alternates, whole, Phase 4',
    { phase: '4', recipes: 'all', somersloops: 40, amplifySloops: 20, wholeMachines: true },
  ],
  ['amplified, exact, Phase 3', { phase: '3', somersloops: 20, amplifySloops: 10 }],
];

test('every plan’s fuel covers its need and goes beyond it by less than one generator', () => {
  let checked = 0;
  for (const [label, input] of PROFILES) {
    const plan = calculate(input);
    for (const [phase, stage] of planned(plan)) {
      if (phase === '1') continue;
      const where = `${label}, Phase ${phase}`;
      const { fuelMW, drawMW, unitMW, nuclear } = fuelOf(stage);
      // Nuclear plants are whole by the owner's rules (#370), whatever the load.
      if (nuclear) continue;
      checked++;
      assert.ok(fuelMW >= drawMW - 0.01, `${where}: ${fuelMW} covers ${drawMW}`);
      assert.ok(fuelMW <= drawMW + unitMW + 0.01, `${where}: ${fuelMW} for ${drawMW}`);
      // Whole generators at 100%: each generator line rounds its fuel up by less than one.
      for (const row of (stage.rows || []).filter(candidate => candidate.power < 0))
        assert.equal(row.machines, Math.ceil(row.equivalent - 1e-6), `${where}: ${row.name}`);
      // And no fluid is made beyond what the lines and demands take: fluids balance exactly.
      const balance: Record<string, number> = {};
      for (const row of stage.rows || []) {
        for (const [item, rate] of Object.entries(row.outputs))
          if (fluid(item)) balance[item] = (balance[item] || 0) + rate;
        for (const [item, rate] of Object.entries(row.inputs))
          if (fluid(item)) balance[item] = (balance[item] || 0) - rate;
      }
      for (const [item, rate] of Object.entries(stage.raw || {}))
        if (fluid(item)) balance[item] = (balance[item] || 0) + rate;
      for (const [item, rate] of Object.entries(balance))
        assert.ok(Math.abs(rate) < 0.01, `${where}: ${item} ${rate}`);
    }
  }
  assert.ok(checked >= 35, `${checked} phases checked`);
});

test('a phase with nuclear plants keeps its whole plants (#370)', () => {
  const plan = calculate({
    phase: '4',
    nuclear: 'recycle',
    mainPower: 'turbofuel-nuclear',
    wholeMachines: true,
  });
  const stage = plan.stages['5'];
  assert.equal(stage.nuclearPeriod, 20, 'the uranium plants come in blocks of the period');
  assert.ok(stage.grid!.generationMW > stage.grid!.needMW + 2500);
});

// The plan of a Phase 5 profile with whole machines and 2 GW of spare power, recorded on main
// before #1086: 360 Fuel Generators on 1,500 m³/min of Rocket Fuel from 15 whole Rocket Fuel
// blenders, 90 GW for a 73.87 GW need.
const stored: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync(new URL('./fixtures/fuel-plan-2026-10-05.json', import.meta.url), 'utf8'),
);
const storedRocketFuel = (plan: StoredCalculatedPlan) =>
  plan.stages['5'].rows!.find(row => row.id === 'Recipe_RocketFuel_C') as CalcRow;

test('a plan stored before #1086 keeps its numbers until the user recalculates', () => {
  assert.equal(stored.exactFluidLines, undefined);
  const stage = stored.stages['5'];
  const view = powerView(stage, stored.settings);
  assert.equal(view.generationMW, 90000);
  assert.ok(Math.abs(view.needMW - 73867.46) < 0.01, `${view.needMW}`);
  const rocketFuel = storedRocketFuel(stored);
  assert.deepEqual([rocketFuel.machines, rocketFuel.lastClock], [15, 100]);
  // Its dialog still offers exact clocks for the line it ran on whole machines.
  const sinkable = new Set(catalog().storageItems.map(item => item.name));
  assert.equal(roundsWholeLine(rocketFuel, sinkable, fluidLines(stored, FLUIDS)), true);
  // A recalculation from its settings plans the line at exact clocks and the fuel for the load.
  const recalculated = calculate(stored.settings);
  const line = storedRocketFuel(recalculated);
  assert.ok(line.lastClock < 100);
  assert.equal(roundsWholeLine(line, sinkable, fluidLines(recalculated, FLUIDS)), false);
  const again = fuelOf(recalculated.stages['5']);
  assert.ok(again.fuelMW <= again.drawMW + again.unitMW, `${again.fuelMW} for ${again.drawMW}`);
});

// A full export holding a plan, as a release froze it.
function exported(plan: StoredCalculatedPlan): SaveExport {
  return {
    format: 'satisfactory-planner-saves',
    version: 1,
    exportedAt: '2026-10-05T12:00:00.000Z',
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

test('a plan stored before #1086 and a new one load, import and export unchanged', async () => {
  const plans = [stored, json(calculate({ phase: '4', wholeMachines: true, recipes: 'all' }))];
  for (const plan of plans) {
    const file = exported(plan);
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    // The Docker edition loads workspace.json without touching it.
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-fuel-'));
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
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
  // The browser edition keeps both as they are, across a reload.
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
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  const planIn = (file: SaveExport) =>
    file.saves.map(save => JSON.stringify(save.profiles[0]!.plan));
  const first = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    planIn(first),
    plans.map(plan => JSON.stringify(plan)),
  );
  api = open();
  assert.deepEqual(planIn((await api('/api/export-saves')) as SaveExport), planIn(first));
});
