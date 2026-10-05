// One power model (#1064): the plan sizes its own generators, and every page reads the same
// figures (public/power.ts). Each phase from the profile's start on needs its production lines at
// their clocked power (the clock power exponent, a Particle Accelerator, Converter or Quantum
// Encoder at its peak), the utility allowance on them and the miners and extractors for the raw
// resources it draws; it has whole generators at 100% (kept from the phase before where it still
// fuels them), Phase 5's augmenters and the spare power. The planner charges extraction in its
// power constraint and every line at its full linear power, so a plan that fits never needs more
// than it has. A plan stored before #1064 has no grid and keeps the figures it was stored with
// until the user recalculates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calculate, catalog } from '../planner.ts';
import { amplified } from '../planner/recipes.ts';
import { phaseSteps } from '../public/progression.ts';
import {
  CLOCK_EXPONENT,
  VARIABLE_POWER,
  carryGenerators,
  extractionEquipment,
  lineLoad,
  powerView,
} from '../public/power.ts';
import { WATER_EXTRACTOR, extractionMWPerUnit } from '../public/preferences.ts';
import { initialState, validateState } from '../public/state.ts';
import { importableTransfer, validateTransfer } from '../public/transfer.ts';
import { loadWorkspace } from '../server/persistence.ts';
import { recipes } from './helpers/data.ts';
import { fakeIndexedDB } from './helpers/fake-indexeddb.ts';
import { createBrowserApi } from '../public/browser-api.ts';
import { openBrowserStore } from '../public/browser-store.ts';
import type {
  CalcRow,
  CurrentCalculatedPlan,
  Progression,
  SaveExport,
  StageGrid,
  StageKey,
  StoredCalculatedPlan,
} from '../public/types/index.ts';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const near = (a: number, b: number, tolerance = 1e-6) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
const PHASES: StageKey[] = ['1', '2', '3', '4', '5'];

test('one clock power exponent: the game data’s, as the Water Extractor advice uses it', () => {
  assert.equal(CLOCK_EXPONENT, WATER_EXTRACTOR.exponent);
  assert.equal(CLOCK_EXPONENT, 1.321929);
});

test('a line counts at its clocked power, a variable-power machine at its peak and average', () => {
  // Two Constructors at 100% and one at 50%: 4 MW × (2 + 0.5^1.321929).
  const constructor = { power: 4, machine: 'Constructor', machines: 3, lastClock: 50 };
  const clocked = 4 * (2 + 0.5 ** 1.321929);
  assert.ok(near(lineLoad(constructor).peak, clocked));
  assert.ok(lineLoad(constructor).peak < 4 * 2.5, 'less than the linear 2.5 machines');
  assert.equal(lineLoad(constructor).average, lineLoad(constructor).peak);
  // Two Particle Accelerators at 100% on Nuclear Pasta: 500 to 1,500 MW, 1,000 on average.
  const accelerator = {
    power: 1500,
    minPower: 500,
    machine: 'Particle Accelerator',
    machines: 2,
    lastClock: 100,
  };
  assert.deepEqual(lineLoad(accelerator), { peak: 3000, average: 2000 });
  // A generator draws nothing.
  assert.deepEqual(lineLoad({ ...constructor, power: -250 }), { peak: 0, average: 0 });
});

test('the variable-power recipes carry their range from the game data', () => {
  for (const recipe of recipes) {
    if (!VARIABLE_POWER.includes(recipe.machine)) {
      assert.equal(recipe.minPower, undefined, recipe.name);
      continue;
    }
    assert.ok(
      recipe.minPower !== undefined && recipe.minPower >= 0 && recipe.minPower < recipe.power,
      `${recipe.name}: ${recipe.minPower}–${recipe.power} MW`,
    );
  }
  const range = (name: string) => {
    const recipe = recipes.find(candidate => candidate.name === name)!;
    return [recipe.minPower, recipe.power];
  };
  assert.deepEqual(range('Nuclear Pasta'), [500, 1500]);
  assert.deepEqual(range('Diamonds'), [250, 750]);
  assert.deepEqual(range('Time Crystal'), [100, 400]);
  assert.deepEqual(range('Superposition Oscillator'), [0, 2000]);
  // An amplified twin draws four times the power over the whole range.
  const pasta = recipes.find(recipe => recipe.name === 'Nuclear Pasta')!;
  const twin = amplified(pasta);
  assert.deepEqual([twin.minPower, twin.power], [2000, 6000]);
});

test('extraction draws its machines’ power per item, at the survey’s miner and clock', () => {
  const scale = (clock: number) => clock ** (CLOCK_EXPONENT - 1);
  // A Miner Mk.3 at 250% on a normal node: 45 MW × 2.5^1.321929 for 600 ore/min.
  assert.ok(near(extractionMWPerUnit('Iron Ore'), (45 * 2.5 ** CLOCK_EXPONENT) / 600));
  assert.ok(near(extractionMWPerUnit('Coal', { mark: 1, clock: 1 }), 5 / 60));
  assert.ok(near(extractionMWPerUnit('SAM', { mark: 2, clock: 1.5 }), (15 / 120) * scale(1.5)));
  assert.ok(near(extractionMWPerUnit('Crude Oil', { clock: 1 }), 40 / 120));
  assert.ok(near(extractionMWPerUnit('Water', { clock: 1 }), 20 / 120));
  // A Resource Well Pressurizer drives 118 / 17 satellites on average, 60 each on normal.
  assert.ok(near(extractionMWPerUnit('Nitrogen Gas', { clock: 1 }), 150 / (60 * (118 / 17))));
  // Without a survey the shipped budgets' Mk.3 at 250%.
  assert.deepEqual(extractionEquipment({ extraction: null }), { mark: 3, clock: 2.5 });
  assert.deepEqual(
    extractionEquipment({ extraction: { mark: 2, clock: 1, nodes: {}, wells: {}, used: {} } }),
    { mark: 2, clock: 1 },
  );
});

// Plans across the settings that change the power model: exact and whole machines, all
// alternates, spare power, Phase 5's augmenters, nuclear recycling, half the consumption and an
// early miner survey.
const PROFILES: [string, Record<string, unknown>][] = [
  ['default Phase 3', { phase: '3' }],
  ['whole machines', { phase: '3', wholeMachines: true }],
  ['all alternates from Phase 2', { phase: '2', recipes: 'all' }],
  ['spare power', { phase: '3', availablePowerGW: 2, installedPowerGW: 2 }],
  [
    'augmenters',
    { phase: '4', availablePowerGW: 3, installedPowerGW: 5, augmenters: 2, fueledAugmenters: 1 },
  ],
  ['nuclear recycling', { phase: '4', nuclear: 'recycle', wholeMachines: true }],
  ['half the consumption', { phase: '3', powerFactor: 0.5, utilityPercent: 35 }],
  [
    'Miner Mk.2 at 100%',
    { phase: '3', extraction: { mark: 2, clock: 1, nodes: {}, wells: {}, used: {} } },
  ],
];
const plans = new Map<string, CurrentCalculatedPlan>();
const planOf = (label: string) => {
  if (!plans.has(label)) plans.set(label, calculate(PROFILES.find(([name]) => name === label)![1]));
  return plans.get(label)!;
};
// The phases a profile builds: from its start phase on.
const planned = (plan: StoredCalculatedPlan) =>
  PHASES.filter(phase => Number(phase) >= Number(plan.settings.phase || 1));

test('each phase’s grid adds up from its own lines, raw draw and generators', () => {
  for (const [label] of PROFILES) {
    const plan = planOf(label);
    const factor = plan.settings.powerFactor;
    const equipment = extractionEquipment(plan.settings);
    for (const phase of planned(plan)) {
      const stage = plan.stages[phase];
      if (!stage.feasible) continue;
      const grid = stage.grid as StageGrid,
        where = `${label}, Phase ${phase}`;
      const rows = stage.rows as CalcRow[];
      const load = rows.reduce((sum, row) => sum + lineLoad(row).peak * factor, 0);
      assert.ok(near(grid.loadMW, load), `${where}: the lines at their clocked power`);
      assert.ok(near(grid.allowanceMW, (load * plan.settings.utilityPercent) / 100), where);
      const extraction = Object.entries(stage.raw)
        .filter(([, rate]) => rate > 1e-6)
        .reduce(
          (sum, [item, rate]) => sum + rate * extractionMWPerUnit(item, equipment) * factor,
          0,
        );
      assert.ok(near(grid.extractionMW, extraction), `${where}: the miners and extractors`);
      assert.ok(near(grid.needMW, load + grid.allowanceMW + extraction), where);
      // Whole generators at 100%, at least what the lines' fuel burns.
      for (const row of rows.filter(candidate => candidate.power < 0)) {
        assert.equal(row.lastClock, 100, `${where}: ${row.name} is whole`);
        assert.ok(Number.isInteger(row.machines) && row.machines >= row.equivalent - 1e-6);
      }
      for (const generator of grid.generators) {
        const own = rows
          .filter(row => row.power < 0 && row.machine === generator.machine)
          .reduce((sum, row) => sum + row.machines, 0);
        assert.equal(generator.own, own, `${where}: ${generator.machine}`);
        assert.equal(generator.machines, Math.max(own, generator.kept));
      }
      const capacity = grid.generators.reduce(
        (sum, entry) => sum + entry.machines * entry.unitMW,
        0,
      );
      assert.ok(near(grid.generationMW, capacity * (1 + (stage.boost || 0))), where);
      assert.ok(near(grid.availableMW, grid.generationMW + grid.augmenterMW + grid.spareMW), where);
      assert.equal(grid.spareMW, plan.settings.availablePowerGW * 1000);
    }
  }
});

test('from Phase 2 on, a plan that fits has the power it needs (the issue’s E7, E8, R12)', () => {
  for (const [label] of PROFILES) {
    const plan = planOf(label);
    for (const phase of planned(plan)) {
      const stage = plan.stages[phase];
      if (!stage.feasible || phase === '1') continue;
      const view = powerView(stage, plan.settings);
      assert.ok(view.modelled, `${label}, Phase ${phase}`);
      assert.equal(
        view.shortMW,
        0,
        `${label}, Phase ${phase}: ${view.needMW} of ${view.availableMW}`,
      );
      // The extraction is in the planner's own power balance, and the generators' fuel covers
      // the need: the lines at their clocked power, with the allowance, and the extraction, less
      // the generators' output, within the spare power (with what the augmenters add). Since
      // #1086 the fuel follows that clocked need rather than the lines' full linear power
      // (planner/load.ts), so it is the need the fuel must cover, not the linear balance.
      const grid = stage.grid as StageGrid;
      const generation = (stage.rows as CalcRow[]).reduce((sum, row) => sum + row.generationMW, 0);
      const balance = grid.needMW - generation * (1 + (stage.boost || 0));
      assert.ok(
        balance <= grid.spareMW + grid.augmenterMW + 0.01 + 1e-6 * Math.abs(balance),
        `${label}, Phase ${phase}: ${balance} within ${grid.spareMW + grid.augmenterMW}`,
      );
    }
  }
});

test('a phase keeps the generators the phase before built where it still fuels them', () => {
  for (const [label] of PROFILES) {
    const plan = planOf(label);
    const start = Number(plan.settings.phase);
    for (const phase of planned(plan)) {
      const stage = plan.stages[phase],
        before = plan.stages[String(Number(phase) - 1) as StageKey];
      if (!stage.feasible) continue;
      const grid = stage.grid as StageGrid;
      for (const generator of grid.generators) {
        const earlier =
          Number(phase) > start && before?.feasible
            ? (before.grid?.generators.find(entry => entry.machine === generator.machine)
                ?.machines ?? 0)
            : 0;
        assert.equal(generator.kept, earlier, `${label}, Phase ${phase}: ${generator.machine}`);
      }
    }
  }
  // carryGenerators on its own: three Fuel Generators carried into a phase whose lines need two.
  const grid = (machines: number): StageGrid => ({
    loadMW: 0,
    variablePeakMW: 0,
    variableAverageMW: 0,
    extraction: {},
    extractionMW: 0,
    extractionAt: { mark: 3, clock: 2.5 },
    allowanceMW: 0,
    needMW: 400,
    generators: [{ machine: 'Fuel Generator', machines, own: machines, kept: 0, unitMW: 250 }],
    generationMW: machines * 250,
    augmenterMW: 0,
    spareMW: 0,
    availableMW: machines * 250,
  });
  const stages = {
    2: { feasible: true, grid: grid(3) },
    3: { feasible: true, grid: grid(2) },
    4: { feasible: true, grid: { ...grid(0), generators: [] } },
  };
  carryGenerators(stages, 2);
  assert.deepEqual(stages[3].grid.generators[0], {
    machine: 'Fuel Generator',
    machines: 3,
    own: 2,
    kept: 3,
    unitMW: 250,
  });
  assert.equal(stages[3].grid.availableMW, 750);
  assert.deepEqual(stages[4].grid.generators, [], 'a building the phase no longer fuels retires');
});

test('Particle Accelerators, Converters and Quantum Encoders show their peak and average', () => {
  const plan = calculate({ phase: '5' });
  const stage = plan.stages['5'];
  assert.equal(stage.feasible, true);
  const grid = stage.grid as StageGrid;
  const variable = (stage.rows as CalcRow[]).filter(row => VARIABLE_POWER.includes(row.machine));
  assert.ok(variable.length > 0, 'Phase 5 builds variable-power machines');
  const peak = variable.reduce((sum, row) => sum + lineLoad(row).peak, 0),
    average = variable.reduce((sum, row) => sum + lineLoad(row).average, 0);
  assert.ok(near(grid.variablePeakMW, peak));
  assert.ok(near(grid.variableAverageMW, average));
  assert.ok(grid.variableAverageMW < grid.variablePeakMW);
  const view = powerView(stage, plan.settings);
  assert.deepEqual(view.variable?.peakMW, grid.variablePeakMW);
  assert.match(
    view.demand[0]!.caption,
    / at their [\d.,]+ (MW|GW) peak \([\d.,]+ (MW|GW) on average\)/,
  );
});

const data: Progression = JSON.parse(
  fs.readFileSync(new URL('../public/progression.json', import.meta.url), 'utf8'),
);

test('a generator line whose building the phase keeps is not retired', () => {
  // All alternates from Phase 2: Phase 3 plans Fuel Generators again, so Phase 2's are kept.
  const plan = planOf('all alternates from Phase 2');
  for (const phase of ['3', '4', '5'] as const) {
    const grid = plan.stages[phase].grid as StageGrid;
    const kept = grid.generators.filter(entry => entry.kept > 0).map(entry => entry.machine);
    const retire = phaseSteps(plan, { checks: {} }, data, phase).find(step =>
      step.id.startsWith('retire-'),
    );
    const before = (plan.stages[String(Number(phase) - 1) as StageKey].rows || []) as CalcRow[];
    for (const row of before.filter(
      candidate => candidate.power < 0 && kept.includes(candidate.machine),
    ))
      assert.ok(!retire?.body.includes(`× ${row.name} (`), `Phase ${phase} keeps ${row.name}`);
  }
});

// The plan the first release stored (a Phase 3 profile): no grid, so every page reads the
// figures it was stored with.
const stored: StoredCalculatedPlan = JSON.parse(
  fs.readFileSync(new URL('./fixtures/calculated-plan-2026-09-12.json', import.meta.url), 'utf8'),
);

test('a stored plan keeps its numbers until the user recalculates', () => {
  for (const phase of PHASES) {
    const stage = stored.stages[phase];
    assert.equal(stage.grid, undefined);
    const view = powerView(stage, stored.settings);
    assert.equal(view.modelled, false);
    assert.equal(view.needMW, stage.requiredMW, `Phase ${phase}`);
    assert.equal(
      view.availableMW,
      (stage.generationMW || 0) + stored.settings.availablePowerGW * 1000,
    );
    assert.ok(near(view.shortMW, stage.additionalHeadroomMW || 0), `Phase ${phase}`);
    assert.deepEqual(
      view.demand.map(part => part.label),
      ['Whole-machine peak', 'Utility allowance'],
    );
  }
  // Its generator lines keep their last generator underclocked as it was stored.
  const fuel = (stored.stages['3'].rows || []).find(row => row.power < 0)!;
  assert.ok(fuel.lastClock < 100);
  // A recalculation from its settings is a new plan with a grid.
  const recalculated = calculate(stored.settings);
  assert.ok(recalculated.stages['3'].grid);
});

// A full export holding the stored plan, as the first release froze it.
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

test('a stored plan and a new one load, import and export unchanged in both editions', async () => {
  for (const plan of [stored, json(planOf('default Phase 3'))]) {
    const file = exported(plan);
    // The import's check and conversion keep the plan byte for byte, grid or none.
    const checked = validateTransfer(json(file)).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(checked), JSON.stringify(plan));
    const imported = (await importableTransfer(json(file))).saves[0]!.profiles[0]!.plan!;
    assert.equal(JSON.stringify(imported), JSON.stringify(plan));
    // The Docker edition loads workspace.json without touching it.
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'planner-power-'));
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
});

test('the browser edition keeps a stored plan and a new one unchanged, across a reload', async () => {
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
  const plans = [stored, json(planOf('default Phase 3'))];
  for (const plan of plans)
    await api('/api/import-saves', { body: JSON.stringify(exported(plan)) });
  const planIn = (file: SaveExport) => file.saves.map(save => save.profiles[0]!.plan);
  const first = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(
    planIn(first).map(plan => JSON.stringify(plan)),
    plans.map(plan => JSON.stringify(plan)),
  );
  api = open();
  const reloaded = (await api('/api/export-saves')) as SaveExport;
  assert.deepEqual(planIn(reloaded), planIn(first));
});
